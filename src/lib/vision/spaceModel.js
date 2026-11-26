// Main-thread handle on the optional parking-space model (spaceModel.worker.js).
// The model is used only when /models/space-seg.onnx and its sidecar
// /models/space-seg.json are deployed; otherwise SmartPark works exactly as
// before (geometric detection only).
import { spacesFromMasks } from "./spaceMasks.js";

const BASE = `${import.meta.env?.BASE_URL || "/"}models/`;
let worker = null;
let metaPromise = null;
let loaded = null;
let nextId = 1;
const pending = new Map();

/** The model's description, or null when no model is deployed. */
export function spaceModelInfo() {
  if (!metaPromise) {
    metaPromise = fetch(`${BASE}space-seg.json`, { cache: "no-cache" })
      .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
      .catch(() => null);
  }
  return metaPromise;
}

function call(message, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL("./spaceModel.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      if (event.data.ok) p.resolve(event.data); else p.reject(new Error(event.data.error));
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });
}

/**
 * image: { data, width, height } (camera picture).
 * Returns [{ poly: [{x,y} x4] in camera %, confidence }] or null without a model.
 */
export async function detectSpacesWithModel(image) {
  const meta = await spaceModelInfo();
  if (!meta) return null;
  if (!loaded) loaded = call({ type: "load", url: `${BASE}${meta.file || "space-seg.onnx"}`, meta }).catch((e) => { loaded = null; throw e; });
  await loaded;
  const copy = new Uint8ClampedArray(image.data);
  const r = await call({ type: "run", image: { data: copy, width: image.width, height: image.height } }, [copy.buffer]);
  const spaces = spacesFromMasks({ interior: r.interior, boundary: r.boundary, W: r.S, H: r.S }, { threshold: meta.threshold ?? 0.5, minArea: meta.minArea ?? 30 });
  // Model input (letterboxed square) -> camera %.
  const toCamera = (p) => ({ x: (((p.x - r.ox) / r.scale) / image.width) * 100, y: (((p.y - r.oy) / r.scale) / image.height) * 100 });
  return spaces.map((s) => ({ poly: s.poly.map(toCamera), confidence: s.confidence }));
}
