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

// ---- satellite model (space-sat.onnx): run over a satellite image in tiles.
let satWorker = null, satMeta = null, satLoaded = null, satNext = 1;
const satPending = new Map();

/** The satellite model's description, or null when none is deployed. */
export function satelliteModelInfo() {
  if (!satMeta) {
    satMeta = fetch(`${BASE}space-sat.json`, { cache: "no-cache" })
      .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
      .catch(() => null);
  }
  return satMeta;
}

function satCall(message, transfer = []) {
  if (!satWorker) {
    satWorker = new Worker(new URL("./spaceModel.worker.js", import.meta.url), { type: "module" });
    satWorker.onmessage = (event) => {
      const p = satPending.get(event.data.id);
      if (!p) return;
      satPending.delete(event.data.id);
      if (event.data.ok) p.resolve(event.data); else p.reject(new Error(event.data.error));
    };
  }
  const id = satNext++;
  return new Promise((resolve, reject) => { satPending.set(id, { resolve, reject }); satWorker.postMessage({ ...message, id }, transfer); });
}

/**
 * Spaces in a satellite image with the satellite model, or null without one.
 * canvas: the image; spacing: a space's width in its pixels (from the
 * rule-based finder). The image is scaled so a space is meta.spacePx wide
 * (as in training) and run in overlapping tiles.
 * Returns [{ poly: [{x,y} x4] in image %, confidence }].
 */
export async function detectSatelliteSpaces(canvas, spacing) {
  const meta = await satelliteModelInfo();
  if (!meta || !(spacing > 0)) return null;
  if (!satLoaded) satLoaded = satCall({ type: "load", url: `${BASE}${meta.file || "space-sat.onnx"}`, meta }).catch((e) => { satLoaded = null; throw e; });
  await satLoaded;
  const S = meta.input || 512, k = (meta.spacePx || 16) / spacing, overlap = Math.round(S / 8);
  const W = Math.round(canvas.width * k), H = Math.round(canvas.height * k);
  if (W * H > 4096 * 4096) return null; // too big to run here
  const big = document.createElement("canvas");
  big.width = W; big.height = H;
  const bx = big.getContext("2d", { willReadFrequently: true });
  bx.drawImage(canvas, 0, 0, W, H);
  const found = [];
  for (let ty = 0; ty < Math.max(1, H - overlap); ty += S - overlap) {
    for (let tx = 0; tx < Math.max(1, W - overlap); tx += S - overlap) {
      const tile = document.createElement("canvas");
      tile.width = S; tile.height = S;
      const t = tile.getContext("2d", { willReadFrequently: true });
      t.fillStyle = "#000"; t.fillRect(0, 0, S, S);
      t.drawImage(big, tx, ty, S, S, 0, 0, S, S);
      const img = t.getImageData(0, 0, S, S);
      const r = await satCall({ type: "run", image: { data: img.data, width: S, height: S } }, [img.data.buffer]);
      const spaces = spacesFromMasks({ interior: r.interior, boundary: r.boundary, W: S, H: S }, { threshold: meta.threshold ?? 0.5, minArea: meta.minArea ?? 30 });
      for (const sp of spaces) {
        const c = sp.poly.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
        // Each tile keeps the spaces in its middle part (no doubles at seams).
        const m = overlap / 2;
        if ((tx > 0 && c.x < m) || (ty > 0 && c.y < m) || (tx + S < W && c.x > S - m) || (ty + S < H && c.y > S - m)) continue;
        found.push({ poly: sp.poly.map((p) => ({ x: (((p.x + tx) / k) / canvas.width) * 100, y: (((p.y + ty) / k) / canvas.height) * 100 })), confidence: sp.confidence });
      }
    }
  }
  return found;
}
