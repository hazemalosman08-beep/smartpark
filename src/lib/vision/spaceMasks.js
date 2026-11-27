// From the space model's pixel map to individual parking spaces.
//
// The model (see docs/hybrid-detection) labels every pixel as background,
// space interior or space boundary (painted lines and the edges between
// neighbouring spaces, also under cars). Spaces are the connected regions of
// interior that the boundary separates; each becomes an oriented rectangle
// with a confidence: the mean interior probability inside it, lowered when its
// size or shape is unlike the other spaces.

/**
 * interior, boundary: Float32Array probabilities (0..1), size W*H.
 * Returns [{ poly: [{x,y} x4] in pixel coords, confidence, area }].
 */
export function spacesFromMasks({ interior, boundary, W, H }, { threshold = 0.5, minArea = 30, split = true, big = 1.7, depth = 0.6, seedBoundary = 0.25 } = {}) {
  const N = W * H;
  const on = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) on[i] = interior[i] >= threshold && interior[i] > boundary[i] ? 1 : 0;
  const label = new Int32Array(N).fill(-1);
  const regions = [];
  for (let s = 0; s < N; s += 1) {
    if (!on[s] || label[s] >= 0) continue;
    const id = regions.length;
    const stack = [s];
    label[s] = id;
    const pts = [];
    let sum = 0;
    while (stack.length) {
      const k = stack.pop();
      const x = k % W, y = (k - x) / W;
      pts.push([x, y]);
      sum += interior[k];
      if (x > 0 && on[k - 1] && label[k - 1] < 0) { label[k - 1] = id; stack.push(k - 1); }
      if (x < W - 1 && on[k + 1] && label[k + 1] < 0) { label[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && on[k - W] && label[k - W] < 0) { label[k - W] = id; stack.push(k - W); }
      if (y < H - 1 && on[k + W] && label[k + W] < 0) { label[k + W] = id; stack.push(k + W); }
    }
    regions.push({ pts, mean: sum / pts.length });
  }
  if (split && regions.length >= 3) splitMerged(regions, { interior, boundary, W, H, label, minArea, big, depth, seedBoundary });
  const out = [];
  for (const r of regions) {
    if (r.pts.length < minArea) continue;
    const rect = minAreaRect(r.pts);
    if (!rect) continue;
    const fill = r.pts.length / Math.max(1, rect.area);
    out.push({ poly: rect.poly, confidence: r.mean * Math.min(1, fill / 0.8), area: r.pts.length, w: rect.w, h: rect.h });
  }
  // Size and shape against the typical space: much smaller or odd-shaped
  // regions are less likely to be real spaces.
  if (out.length >= 3) {
    const med = (v) => { const a = [...v].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
    const area = med(out.map((s) => s.area));
    const aspect = med(out.map((s) => Math.max(s.w, s.h) / Math.max(1e-6, Math.min(s.w, s.h))));
    for (const s of out) {
      const a = s.area / area;
      const asp = Math.max(s.w, s.h) / Math.max(1e-6, Math.min(s.w, s.h));
      const sizeOk = a < 0.4 || a > 2.5 ? 0.5 : 1;
      const shapeOk = Math.abs(Math.log(asp / aspect)) > 0.6 ? 0.7 : 1;
      s.confidence *= sizeOk * shapeOk;
    }
  }
  return out.map(({ poly, confidence, area }) => ({ poly, confidence: Math.round(confidence * 1000) / 1000, area }));
}

// Blobs much bigger than a typical space are rows merged through gaps in the
// predicted lines: seeds are the deepest parts of the blob (away from its edge
// and from predicted lines), each grows until it meets its neighbours. The
// split is kept only if every piece is space-sized. Same rule as
// tools/spacemodel/evaluate.py.
function splitMerged(regions, { interior, boundary, W, H, minArea, big, depth, seedBoundary }) {
  const sizes = regions.map((r) => r.pts.length).filter((n) => n >= minArea).sort((a, b) => a - b);
  if (!sizes.length) return;
  const typical = sizes[Math.floor(sizes.length / 2)];
  const added = [];
  for (let ri = 0; ri < regions.length; ri += 1) {
    const r = regions[ri];
    if (r.pts.length <= big * typical) continue;
    // Local grid around the blob.
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const [x, y] of r.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 3, h = y1 - y0 + 3;
    const blob = new Uint8Array(w * h), core = new Uint8Array(w * h);
    for (const [x, y] of r.pts) {
      const k = (y - y0 + 1) * w + (x - x0 + 1);
      blob[k] = 1;
      if (boundary[y * W + x] < seedBoundary) core[k] = 1;
    }
    // Shrink the core by a pixel, then its distance to the edge (chamfer 3-4).
    const shrunk = new Uint8Array(w * h);
    for (let k = w; k < w * h - w; k += 1) if (core[k] && core[k - 1] && core[k + 1] && core[k - w] && core[k + w]) shrunk[k] = 1;
    const d = new Float32Array(w * h);
    for (let k = 0; k < w * h; k += 1) d[k] = shrunk[k] ? 1e9 : 0;
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
      const k = y * w + x; if (!d[k]) continue;
      d[k] = Math.min(d[k], d[k - 1] + 3, d[k - w] + 3, d[k - w - 1] + 4, d[k - w + 1] + 4);
    }
    let dmax = 0;
    for (let y = h - 2; y >= 1; y -= 1) for (let x = w - 2; x >= 1; x -= 1) {
      const k = y * w + x; if (!d[k]) continue;
      d[k] = Math.min(d[k], d[k + 1] + 3, d[k + w] + 3, d[k + w + 1] + 4, d[k + w - 1] + 4);
      dmax = Math.max(dmax, d[k]);
    }
    if (!dmax) continue;
    // Seeds: connected deep parts.
    const seed = new Int32Array(w * h);
    let m = 0;
    for (let k = 0; k < w * h; k += 1) {
      if (seed[k] || d[k] < depth * dmax) continue;
      m += 1;
      const stack = [k];
      seed[k] = m;
      while (stack.length) {
        const q = stack.pop();
        for (const nb of [q - 1, q + 1, q - w, q + w]) if (!seed[nb] && d[nb] >= depth * dmax) { seed[nb] = m; stack.push(nb); }
      }
    }
    if (m < 2) continue;
    // Grow every seed through the blob, one ring at a time.
    let frontier = [];
    for (let k = 0; k < w * h; k += 1) if (seed[k]) frontier.push(k);
    while (frontier.length) {
      const next = [];
      for (const q of frontier) for (const nb of [q - 1, q + 1, q - w, q + w]) if (blob[nb] && !seed[nb]) { seed[nb] = seed[q]; next.push(nb); }
      frontier = next;
    }
    const pieces = Array.from({ length: m }, () => ({ pts: [], sum: 0 }));
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
      const sid = seed[y * w + x];
      if (!sid || !blob[y * w + x]) continue;
      const gx = x + x0 - 1, gy = y + y0 - 1;
      pieces[sid - 1].pts.push([gx, gy]);
      pieces[sid - 1].sum += interior[gy * W + gx];
    }
    if (pieces.some((p) => p.pts.length < 0.4 * typical)) continue;
    regions[ri] = null;
    for (const p of pieces) added.push({ pts: p.pts, mean: p.sum / p.pts.length });
  }
  for (let i = regions.length - 1; i >= 0; i -= 1) if (!regions[i]) regions.splice(i, 1);
  regions.push(...added);
}

// Smallest-area rectangle around a set of pixel points (rotating calipers on
// the convex hull). Corners are ordered so the first edge is a short side
// (the space's front): front-left, front-right, back-right, back-left.
export function minAreaRect(points) {
  const hull = convexHull(points.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 })));
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    // Pixel regions are inclusive: half a pixel of padding on each side.
    const area = (u1 - u0 + 1) * (v1 - v0 + 1);
    if (!best || area < best.area) best = { ux, uy, u0: u0 - 0.5, u1: u1 + 0.5, v0: v0 - 0.5, v1: v1 + 0.5, area };
  }
  const { ux, uy, u0, u1, v0, v1 } = best;
  const P = (u, v) => ({ x: u * ux - v * uy, y: u * uy + v * ux });
  const w = u1 - u0, h = v1 - v0;
  // First edge along the short side.
  const poly = w <= h ? [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)] : [P(u0, v1), P(u0, v0), P(u1, v0), P(u1, v1)];
  return { poly, area: best.area, w, h };
}

function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i -= 1) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
