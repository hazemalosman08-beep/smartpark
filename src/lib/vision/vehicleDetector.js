// Main-thread handle on the in-browser vehicle detector (see detector.worker.js).
// One worker for the whole app; requests are serialized so frames never pile up.

export const MODELS = {
  accurate: { file: "models/yolo11s.onnx", label: "YOLO11-S (accurate)" },
  fast: { file: "models/yolo11n.onnx", label: "YOLO11-N (fast)" },
};

let worker = null;
let nextId = 1;
const pending = new Map();
let status = { state: "idle", backend: "", error: null, model: "accurate" };
const listeners = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
}

export function onDetectorStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export const getDetectorStatus = () => status;

function modelUrl(model = status.model) {
  const base = import.meta.env?.BASE_URL || "/";
  return new URL(`${base}${(MODELS[model] || MODELS.accurate).file}`, window.location.href).toString();
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./detector.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "ready") setStatus({ state: "ready", backend: msg.backend, error: null });
    if (msg.type === "result" || msg.type === "error") {
      const request = pending.get(msg.id);
      if (!request) {
        if (msg.type === "error") setStatus({ state: "error", error: msg.message });
        return;
      }
      pending.delete(msg.id);
      if (msg.type === "error") {
        setStatus({ state: "error", error: msg.message });
        request.reject(new Error(msg.message));
      } else {
        setStatus({ state: "ready", backend: msg.backend, error: null });
        request.resolve(msg);
      }
    }
  };
  worker.onerror = (event) => {
    setStatus({ state: "error", error: event.message || "Detector crashed" });
    pending.forEach((request) => request.reject(new Error("Detector crashed")));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function preloadDetector(model = status.model) {
  if (status.state === "ready" && status.model === model) return;
  setStatus({ state: "loading", model });
  ensureWorker().postMessage({ type: "init", modelUrl: modelUrl(model) });
}

export function setDetectorModel(model) {
  if (!MODELS[model] || model === status.model) return;
  // A new model needs a fresh worker (sessions are not swapped in place).
  worker?.terminate();
  worker = null;
  pending.forEach((request) => request.reject(new Error("Model changed")));
  pending.clear();
  setStatus({ state: "idle", backend: "", model });
  preloadDetector(model);
}

/**
 * Detect vehicles in a video, image or canvas.
 * Returns { boxes: [{x,y,w,h,score,label}] in % of the frame, ms, backend, tiled }.
 */
export async function detectVehiclesLocal(source, { tiles = true, minScore = 0.1 } = {}) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return { boxes: [], ms: 0, backend: status.backend, tiled: false };
  const bitmap = await createImageBitmap(source);
  const id = nextId++;
  if (status.state === "idle") setStatus({ state: "loading" });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ type: "detect", id, bitmap, tiles, minScore, modelUrl: modelUrl() }, [bitmap]);
  });
}
