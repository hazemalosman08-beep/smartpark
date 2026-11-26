// Parking-space segmentation model, off the main thread.
// Model: U-Net (MobileNetV2 encoder) trained with notebooks/train_space_model.ipynb,
// exported to ONNX with a sidecar /models/space-seg.json:
//   { "input": 512, "classes": ["background","interior","boundary"],
//     "mean": [0.485,0.456,0.406], "std": [0.229,0.224,0.225], ... }
// Input: an RGBA picture. Output: interior and boundary probabilities.
import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator?.hardwareConcurrency || 2) : 1;
ort.env.logLevel = "error";

let session = null;
let meta = null;

async function load(url, metaIn) {
  if (session) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the space model (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Plain WebAssembly: every standard op is supported there.
  session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  meta = metaIn;
}

// Letterbox into a square, normalise, NCHW.
function prepare({ data, width: W, height: H }, S, mean, std) {
  const scale = Math.min(S / W, S / H);
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const ox = Math.floor((S - w) / 2), oy = Math.floor((S - h) / 2);
  const input = new Float32Array(3 * S * S);
  for (let c = 0; c < 3; c += 1) input.fill((0 - mean[c]) / std[c], c * S * S, (c + 1) * S * S);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(H - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(W - 1, Math.floor((x + 0.5) / scale));
      const i = (sy * W + sx) * 4, o = (y + oy) * S + (x + ox);
      for (let c = 0; c < 3; c += 1) input[c * S * S + o] = (data[i + c] / 255 - mean[c]) / std[c];
    }
  }
  return { input, scale, ox, oy };
}

self.onmessage = async (event) => {
  const { id, type, url, meta: m, image } = event.data;
  try {
    if (type === "load") { await load(url, m); self.postMessage({ id, ok: true }); return; }
    if (type === "run") {
      const S = meta.input || 512;
      const { input, scale, ox, oy } = prepare(image, S, meta.mean || [0.485, 0.456, 0.406], meta.std || [0.229, 0.224, 0.225]);
      const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, S, S]) };
      const out = (await session.run(feeds))[session.outputNames[0]];
      const C = out.dims[1], N = S * S, logits = out.data;
      const ci = (meta.classes || []).indexOf("interior"), cb = (meta.classes || []).indexOf("boundary");
      const interior = new Float32Array(N), boundary = new Float32Array(N);
      for (let k = 0; k < N; k += 1) {
        let mx = -Infinity;
        for (let c = 0; c < C; c += 1) mx = Math.max(mx, logits[c * N + k]);
        let sum = 0;
        for (let c = 0; c < C; c += 1) sum += Math.exp(logits[c * N + k] - mx);
        interior[k] = Math.exp(logits[(ci < 0 ? 1 : ci) * N + k] - mx) / sum;
        boundary[k] = Math.exp(logits[(cb < 0 ? 2 : cb) * N + k] - mx) / sum;
      }
      self.postMessage({ id, ok: true, interior, boundary, S, scale, ox, oy }, [interior.buffer, boundary.buffer]);
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
