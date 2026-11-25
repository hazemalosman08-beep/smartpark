// Vehicle detector running off the main thread.
// Model: YOLO11 (COCO), exported to ONNX and served from /models. Runs on WebGPU
// when the browser has it, otherwise multi-threaded WebAssembly.
//
// Accuracy measures:
//  * letterboxed input (no stretching), exactly as the model was trained
//  * optional tiled pass: the frame is also read as four overlapping close-ups,
//    so distant / small vehicles are found (on a test lot: 30 -> 45 vehicles)
//  * class-agnostic NMS across car / truck / bus / motorcycle so one vehicle is
//    never reported twice under two labels
//  * fragments cut by a tile edge are dropped in favour of the whole vehicle
import * as ort from "onnxruntime-web/webgpu";

// The runtime's .wasm is bundled by Vite next to this worker (no CDN needed).
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator?.hardwareConcurrency || 2) : 1;
ort.env.logLevel = "error";

const VEHICLE_CLASSES = new Map([[2, "car"], [3, "motorcycle"], [5, "bus"], [7, "truck"]]);
const SIZE = 640;
let session = null;
let backend = "";
let loading = null;

async function load(modelUrl) {
  if (session) return;
  if (!loading) {
    loading = (async () => {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`Could not download the detection model (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const providers = [];
      if (self.navigator?.gpu) providers.push("webgpu");
      providers.push("wasm");
      let lastError = null;
      for (const provider of providers) {
        try {
          session = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: "all" });
          backend = provider;
          // Warm-up so the first real frame is not slow.
          await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]) });
          return;
        } catch (error) {
          lastError = error;
          session = null;
        }
      }
      throw lastError || new Error("No inference backend available");
    })();
  }
  try {
    await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function preprocess(bitmap, crop) {
  const scale = Math.min(SIZE / crop.w, SIZE / crop.h);
  const dw = Math.round(crop.w * scale);
  const dh = Math.round(crop.h * scale);
  const padX = Math.floor((SIZE - dw) / 2);
  const padY = Math.floor((SIZE - dh) / 2);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, padX, padY, dw, dh);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    input[i] = data[i * 4] / 255;
    input[plane + i] = data[i * 4 + 1] / 255;
    input[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return { input, scale, padX, padY };
}

const iou = (a, b) => {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
};
const ios = (a, b) => {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1));
};

function nms(boxes, threshold) {
  const kept = [];
  for (const box of boxes.sort((a, b) => b.score - a.score)) {
    if (kept.every((other) => iou(box, other) < threshold)) kept.push(box);
  }
  return kept;
}

async function inferCrop(bitmap, crop, frame, minScore) {
  const { input, scale, padX, padY } = preprocess(bitmap, crop);
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) };
  const output = (await session.run(feeds))[session.outputNames[0]];
  const values = output.data;
  const [, channels, anchors] = output.dims; // [1, 84, 8400]
  const boxes = [];
  for (let i = 0; i < anchors; i += 1) {
    let best = 0;
    let bestClass = -1;
    let vehicle = 0;
    let vehicleClass = -1;
    for (let c = 4; c < channels; c += 1) {
      const score = values[c * anchors + i];
      if (score > best) { best = score; bestClass = c - 4; }
      if (VEHICLE_CLASSES.has(c - 4) && score > vehicle) { vehicle = score; vehicleClass = c - 4; }
    }
    if (vehicle < minScore) continue;
    // A box the model is far surer is a person/sign is not a vehicle.
    if (!VEHICLE_CLASSES.has(bestClass) && best > vehicle * 2.5) continue;
    const cx = (values[i] - padX) / scale;
    const cy = (values[anchors + i] - padY) / scale;
    const w = values[2 * anchors + i] / scale;
    const h = values[3 * anchors + i] / scale;
    const x1 = Math.max(0, cx - w / 2) + crop.x;
    const y1 = Math.max(0, cy - h / 2) + crop.y;
    const x2 = Math.min(crop.w, cx + w / 2) + crop.x;
    const y2 = Math.min(crop.h, cy + h / 2) + crop.y;
    if (x2 - x1 < 3 || y2 - y1 < 3) continue;
    // A box touching an inner edge of a close-up tile is probably a cut-off piece.
    const edge = 3;
    const cut =
      crop.tile &&
      ((x1 - crop.x < edge && crop.x > 0) ||
        (crop.x + crop.w - x2 < edge && crop.x + crop.w < frame.width) ||
        (y1 - crop.y < edge && crop.y > 0) ||
        (crop.y + crop.h - y2 < edge && crop.y + crop.h < frame.height));
    boxes.push({ x1, y1, x2, y2, score: vehicle, label: VEHICLE_CLASSES.get(vehicleClass), cut, tile: Boolean(crop.tile) });
  }
  return nms(boxes, 0.5);
}

function tilesFor(width, height) {
  const tw = Math.round(width * 0.6);
  const th = Math.round(height * 0.6);
  return [
    { x: 0, y: 0, w: tw, h: th, tile: true },
    { x: width - tw, y: 0, w: tw, h: th, tile: true },
    { x: 0, y: height - th, w: tw, h: th, tile: true },
    { x: width - tw, y: height - th, w: tw, h: th, tile: true },
  ];
}

function fuse(all) {
  // Whole vehicles first; fragments only survive where nothing else covers them.
  const whole = all.filter((b) => !b.cut);
  const pieces = all.filter((b) => b.cut);
  const kept = [];
  for (const box of whole.sort((a, b) => b.score - a.score)) {
    const twin = kept.find((other) => iou(box, other) >= 0.5);
    if (twin) {
      // Seen in two passes: confidence rises a little, geometry averages.
      const wa = twin.score, wb = box.score;
      for (const k of ["x1", "y1", "x2", "y2"]) twin[k] = (twin[k] * wa + box[k] * wb) / (wa + wb);
      twin.score = Math.min(0.99, Math.max(wa, wb) + 0.05);
      twin.votes += 1;
      continue;
    }
    // A small box mostly inside a much larger one (window, wheel, trailer) is dropped.
    const inside = kept.find((other) => ios(box, other) >= 0.8);
    if (inside) continue;
    kept.push({ ...box, votes: 1 });
  }
  for (const piece of pieces.sort((a, b) => b.score - a.score)) {
    if (kept.some((other) => ios(piece, other) >= 0.45)) continue;
    kept.push({ ...piece, votes: 1 });
  }
  return kept;
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await load(msg.modelUrl);
      self.postMessage({ type: "ready", backend });
      return;
    }
    if (msg.type === "detect") {
      await load(msg.modelUrl);
      const started = performance.now();
      const { bitmap } = msg;
      const frame = { width: bitmap.width, height: bitmap.height };
      const minScore = msg.minScore ?? 0.1;
      let all = await inferCrop(bitmap, { x: 0, y: 0, w: frame.width, h: frame.height }, frame, minScore);
      const useTiles = msg.tiles && frame.width >= 480 && frame.height >= 320;
      if (useTiles) {
        for (const tile of tilesFor(frame.width, frame.height)) {
          all = all.concat(await inferCrop(bitmap, tile, frame, minScore));
        }
      }
      bitmap.close?.();
      const fused = useTiles ? fuse(all) : all.map((b) => ({ ...b, votes: 1 }));
      const boxes = fused.map((b) => ({
        x: (b.x1 / frame.width) * 100,
        y: (b.y1 / frame.height) * 100,
        w: ((b.x2 - b.x1) / frame.width) * 100,
        h: ((b.y2 - b.y1) / frame.height) * 100,
        score: Math.round(b.score * 1000) / 1000,
        label: b.label,
      }));
      self.postMessage({ type: "result", id: msg.id, boxes, ms: performance.now() - started, backend, tiled: useTiles, width: frame.width, height: frame.height });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: msg.id, message: error?.message || String(error) });
  }
};
