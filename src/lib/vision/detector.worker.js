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
//  * high-resolution pass: the whole frame is also read at 1600 px (the model
//    accepts any input size), which finds small, distant and crowded cars the
//    640 px pass misses (dense test lot: 42 -> 83 cars, side-angle lot 28 -> 43)
import * as ort from "onnxruntime-web/webgpu";
import { polygonArea, polygonOverlapArea } from "./geometry.js";

// The runtime's .wasm is bundled by Vite next to this worker (no CDN needed).
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator?.hardwareConcurrency || 2) : 1;
ort.env.logLevel = "error";

const VEHICLE_CLASSES = new Map([[2, "car"], [3, "motorcycle"], [5, "bus"], [7, "truck"]]);
// Seen straight from above, cars look like small dark rectangles, and a general
// model (trained mostly on side views) calls them "cell phone", "remote",
// "suitcase", "book", "laptop" or "train". These are kept as look-alikes and
// accepted on the main thread only when they form a consistent group of
// car-sized objects (see vehicleDetector.js).
const LOOKALIKE_CLASSES = new Set([6, 28, 63, 65, 67, 73]);
const SIZE = 640; // normal pass
const HIRES = 1600; // high-resolution pass (long side)
let session = null;
let backend = "";
let loading = null;
// Aerial model (YOLO11-OBB, trained on aerial photos: "small/large vehicle"
// with rotated boxes). Street-photo models barely see cars from straight above.
let aerial = null;
let aerialLoading = null;

async function loadAerial(url) {
  if (aerial) return;
  if (!aerialLoading) {
    aerialLoading = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not download the aerial model (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const providers = self.navigator?.gpu ? ["webgpu", "wasm"] : ["wasm"];
      let lastError = null;
      for (const provider of providers) {
        try {
          aerial = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: "all" });
          return;
        } catch (error) { lastError = error; aerial = null; }
      }
      throw lastError || new Error("No inference backend for the aerial model");
    })();
  }
  try { await aerialLoading; } catch (error) { aerialLoading = null; throw error; }
}

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

// Letterbox to `size` on the long side. Square for the normal pass (as the
// model was trained); for the high-resolution pass only the padding needed to
// reach a multiple of 32, so no compute is wasted on grey borders.
function preprocess(bitmap, crop, size = SIZE, square = true) {
  const scale = Math.min(size / crop.w, size / crop.h);
  const dw = Math.round(crop.w * scale);
  const dh = Math.round(crop.h * scale);
  const W = square ? size : Math.ceil(dw / 32) * 32;
  const H = square ? size : Math.ceil(dh / 32) * 32;
  const padX = Math.floor((W - dw) / 2);
  const padY = Math.floor((H - dh) / 2);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, padX, padY, dw, dh);
  const { data } = ctx.getImageData(0, 0, W, H);
  const plane = W * H;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    input[i] = data[i * 4] / 255;
    input[plane + i] = data[i * 4 + 1] / 255;
    input[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return { input, scale, padX, padY, W, H };
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

async function inferCrop(bitmap, crop, frame, minScore, lookalikes = true, size = SIZE) {
  const square = size === SIZE;
  const { input, scale, padX, padY, W, H } = preprocess(bitmap, crop, size, square);
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, H, W]) };
  const output = (await session.run(feeds))[session.outputNames[0]];
  const values = output.data;
  const [, channels, anchors] = output.dims; // [1, 84, 8400]
  const boxes = [];
  for (let i = 0; i < anchors; i += 1) {
    let best = 0;
    let bestClass = -1;
    let vehicle = 0;
    let vehicleClass = -1;
    let alike = 0;
    for (let c = 4; c < channels; c += 1) {
      const score = values[c * anchors + i];
      if (score > best) { best = score; bestClass = c - 4; }
      if (VEHICLE_CLASSES.has(c - 4) && score > vehicle) { vehicle = score; vehicleClass = c - 4; }
      if (LOOKALIKE_CLASSES.has(c - 4) && score > alike) alike = score;
    }
    let lookalike = false;
    if (lookalikes && LOOKALIKE_CLASSES.has(bestClass) && alike * 0.9 > vehicle) {
      vehicle = alike * 0.9;
      vehicleClass = 2;
      lookalike = true;
    }
    if (vehicle < minScore) continue;
    // A box the model is far surer is a person/sign is not a vehicle.
    if (!lookalike && !VEHICLE_CLASSES.has(bestClass) && best > vehicle * 2.5) continue;
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
    boxes.push({ x1, y1, x2, y2, score: vehicle, label: VEHICLE_CLASSES.get(vehicleClass), lookalike, cut, tile: Boolean(crop.tile) });
  }
  // 0.7, not 0.5: in a crowded row neighbouring cars overlap a lot from an angle,
  // and a stricter threshold deletes real neighbours.
  return nms(boxes, 0.7);
}

// ---- aerial (rotated-box) model -------------------------------------------
const AERIAL_SIZE = 1024;
const AERIAL_VEHICLES = new Map([[9, "truck"], [10, "car"]]);

function rotatedCorners(cx, cy, w, h, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

function rotatedIoU(a, b) {
  const inter = polygonOverlapArea(a.corners, b.corners);
  if (!inter) return 0;
  return inter / (polygonArea(a.corners) + polygonArea(b.corners) - inter);
}

async function inferAerial(bitmap, crop, frame, minScore) {
  const { input, scale, padX, padY, W, H } = preprocess(bitmap, crop, AERIAL_SIZE, false);
  const out = (await aerial.run({ [aerial.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, H, W]) }))[aerial.outputNames[0]];
  const v = out.data;
  const [, channels, n] = out.dims; // [1, 20, N]: cx cy w h, 15 classes, angle
  const boxes = [];
  for (let i = 0; i < n; i += 1) {
    let best = 0, cls = -1;
    for (let c = 4; c < channels - 1; c += 1) {
      const sc = v[c * n + i];
      if (sc > best) { best = sc; cls = c - 4; }
    }
    if (!AERIAL_VEHICLES.has(cls) || best < minScore) continue;
    const cx = (v[i] - padX) / scale + crop.x, cy = (v[n + i] - padY) / scale + crop.y;
    const w = v[2 * n + i] / scale, h = v[3 * n + i] / scale;
    const angle = v[(channels - 1) * n + i];
    if (w < 3 || h < 3) continue;
    const corners = rotatedCorners(cx, cy, w, h, angle);
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    boxes.push({
      x1: Math.max(0, Math.min(...xs)), y1: Math.max(0, Math.min(...ys)),
      x2: Math.min(frame.width, Math.max(...xs)), y2: Math.min(frame.height, Math.max(...ys)),
      score: best, label: AERIAL_VEHICLES.get(cls), corners, aerial: true,
    });
  }
  const kept = [];
  for (const b of boxes.sort((a, c) => c.score - a.score)) if (kept.every((k) => rotatedIoU(b, k) < 0.5)) kept.push(b);
  return kept;
}


function toPercent(b, frame) {
  return {
    x: (b.x1 / frame.width) * 100,
    y: (b.y1 / frame.height) * 100,
    w: ((b.x2 - b.x1) / frame.width) * 100,
    h: ((b.y2 - b.y1) / frame.height) * 100,
    // Found in two passes / by both models: very likely a real vehicle.
    score: Math.round((b.votes >= 2 ? Math.max(b.score, 0.3) : b.score) * 1000) / 1000,
    label: b.label,
    lookalike: Boolean(b.lookalike),
    aerial: Boolean(b.aerial),
    // Rotated outline of the car (aerial model), in % of the frame.
    corners: b.corners ? b.corners.map((p) => ({ x: (p.x / frame.width) * 100, y: (p.y / frame.height) * 100 })) : undefined,
  };
}

// Aerial-model cars first (tight rotated boxes); a street-model box covering
// the same car is merged into it, others are kept as they are.
function mergeAerial(aerialBoxes, general) {
  const out = aerialBoxes.map((b) => ({ ...b, votes: 1 }));
  for (const g of general) {
    const twin = out.find((a) => iou(a, g) >= 0.4 || ios(a, g) >= 0.7);
    if (twin) {
      twin.votes += 1;
      twin.score = Math.min(0.99, Math.max(twin.score, g.score) + 0.05);
      continue;
    }
    out.push(g);
  }
  return out;
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
  const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
  for (const box of whole.sort((a, b) => b.score - a.score)) {
    const twin = kept.find((other) => iou(box, other) >= 0.55);
    if (twin) {
      // Seen in two passes: confidence rises a little, geometry averages.
      const wa = twin.score, wb = box.score;
      for (const k of ["x1", "y1", "x2", "y2"]) twin[k] = (twin[k] * wa + box[k] * wb) / (wa + wb);
      twin.score = Math.min(0.99, Math.max(wa, wb) + 0.05);
      twin.lookalike = twin.lookalike && box.lookalike;
      twin.votes += 1;
      continue;
    }
    // One box swallowing another of very different size: a fragment (window,
    // truck bed) or a loose box around a group. Neighbouring cars of similar
    // size can overlap a lot and are kept.
    const inside = kept.find((other) => ios(box, other) >= 0.85 && Math.max(area(box), area(other)) / Math.min(area(box), area(other)) >= 1.8);
    if (inside) continue;
    kept.push({ ...box, votes: 1 });
  }
  for (const piece of pieces.sort((a, b) => b.score - a.score)) {
    if (kept.some((other) => ios(piece, other) >= 0.6)) continue;
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
      const minScore = msg.minScore ?? 0.12;
      const whole = { x: 0, y: 0, w: frame.width, h: frame.height };
      let aerialBoxes = [];
      if (msg.aerial && msg.aerialUrl) {
        try {
          await loadAerial(msg.aerialUrl);
          aerialBoxes = await inferAerial(bitmap, whole, frame, Math.max(0.2, minScore));
        } catch {
          aerialBoxes = [];
        }
      }
      if (msg.aerial === "only") {
        bitmap.close?.();
        const boxes = aerialBoxes.map((b) => toPercent(b, frame));
        self.postMessage({ type: "result", id: msg.id, boxes, ms: performance.now() - started, backend, tiled: false, hires: false, aerial: true, width: frame.width, height: frame.height });
        return;
      }
      let all = await inferCrop(bitmap, whole, frame, minScore);
      // Small pictures need the close-ups most, so tiles are used at any size.
      const useTiles = Boolean(msg.tiles);
      const useHires = Boolean(msg.hires);
      if (useHires) {
        try {
          all = all.concat(await inferCrop(bitmap, whole, frame, minScore, true, HIRES));
        } catch {
          // A fixed-size (older) model file cannot take other input sizes.
        }
      }
      if (useTiles) {
        for (const tile of tilesFor(frame.width, frame.height)) {
          all = all.concat(await inferCrop(bitmap, tile, frame, minScore));
        }
      }
      bitmap.close?.();
      let fused = useTiles || useHires ? fuse(all) : all.map((b) => ({ ...b, votes: 1 }));
      if (aerialBoxes.length) fused = mergeAerial(aerialBoxes, fused);
      const boxes = fused.map((b) => toPercent(b, frame));
      self.postMessage({ type: "result", id: msg.id, boxes, ms: performance.now() - started, backend, tiled: useTiles, hires: useHires, aerial: aerialBoxes.length > 0, width: frame.width, height: frame.height });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: msg.id, message: error?.message || String(error) });
  }
};
