// Hybrid detection: confidence for every space, and merging the geometric
// finder's spaces with the space model's (see docs/hybrid-detection).
import { paintMask } from "./stallFinder.js";
import { nextRowLetter, stallIoU } from "./lot.js";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const centre = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const inside = (p, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};

/**
 * Confidence (0..1) for spaces found without a model, from the evidence:
 *   drawn by hand                      1
 *   painted lines on both sides        high; one side: medium
 *   part of a long, regular row        raised
 *   a car standing in it               raised (a car parks in a space)
 *   inferred from a car only           0.55
 * image: camera pixels; stalls in camera %; vehicles in camera %.
 */
export function geometricConfidence(image, stalls, vehicles = []) {
  let mask = null;
  try { mask = paintMask(image, { vehicles }); } catch { mask = null; }
  const { width: W, height: H } = image;
  const near = (x, y, r) => {
    if (!mask) return false;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) return true;
    }
    return false;
  };
  const rowSize = new Map();
  for (const s of stalls) rowSize.set(s.row, (rowSize.get(s.row) || 0) + 1);
  const carIn = (s) => vehicles.some((v) => inside({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, s.poly));
  return stalls.map((s) => {
    if (!s.auto) return { ...s, confidence: 1, sources: s.sources || ["hand"] };
    if (s.learned) return { ...s, confidence: s.confidence ?? 0.55, sources: s.sources || ["car"] };
    const q = s.poly.map((p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H }));
    const width = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const r = Math.max(1, Math.round(width * 0.06));
    // Paint along the two dividers (front-left->back-left, front-right->back-right).
    const sideEvidence = [[q[0], q[3]], [q[1], q[2]]].map(([a, b]) => {
      let hit = 0;
      for (let k = 1; k <= 10; k += 1) {
        const t = 0.1 + (0.8 * k) / 11;
        if (near(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) hit += 1;
      }
      return hit / 10;
    });
    const lines = (Math.max(...sideEvidence) * 0.4 + Math.min(...sideEvidence) * 0.6);
    const regular = Math.min(1, ((rowSize.get(s.row) || 1) - 1) / 5);
    const conf = 0.3 + 0.4 * lines + 0.15 * regular + (carIn(s) ? 0.15 : 0);
    return { ...s, confidence: Math.round(clamp01(s.kindAuto ? Math.max(conf, 0.6) : conf) * 100) / 100, sources: s.sources || ["lines"] };
  });
}

/**
 * Merge the geometric spaces with the model's.
 *   both          -> geometric outline kept, confidence combined
 *   model only    -> added (spaces the rules missed), grouped into new rows
 *   geometric only-> kept; confidence lowered a little unless hand-drawn or
 *                    holding a car (the model may not have seen it either)
 * model: [{ poly (camera %), confidence }].
 */
export function mergeSpaces(stalls, model, { vehicles = [], minConfidence = 0.5 } = {}) {
  if (!model?.length) return { stalls, added: 0, confirmed: 0 };
  const used = new Set();
  let confirmed = 0;
  const carIn = (poly) => vehicles.some((v) => inside({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, poly));
  const merged = stalls.map((s) => {
    let best = -1, bestIoU = 0;
    model.forEach((m, i) => {
      if (used.has(i)) return;
      const iou = stallIoU(s, m);
      if (iou > bestIoU) { bestIoU = iou; best = i; }
    });
    if (best >= 0 && bestIoU >= 0.3) {
      used.add(best);
      confirmed += 1;
      const c = 1 - (1 - (s.confidence ?? 0.6)) * (1 - model[best].confidence);
      return { ...s, confidence: Math.round(c * 100) / 100, sources: [...new Set([...(s.sources || []), "model"])] };
    }
    if (!s.auto || carIn(s.poly)) return s;
    return { ...s, confidence: Math.round((s.confidence ?? 0.6) * 0.8 * 100) / 100 };
  });
  // Model-only spaces that do not overlap anything already mapped.
  const fresh = model
    .map((m, i) => ({ ...m, i }))
    .filter((m) => !used.has(m.i) && m.confidence >= minConfidence)
    .filter((m) => merged.every((s) => stallIoU(s, m) < 0.15 && !inside(centre(m.poly), s.poly)));
  // Group them into rows: neighbours with the same direction, side by side.
  const dir = (poly) => Math.atan2(poly[1].y - poly[0].y, poly[1].x - poly[0].x);
  const width = (poly) => Math.hypot(poly[1].x - poly[0].x, poly[1].y - poly[0].y);
  const parent = fresh.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < fresh.length; i += 1) for (let j = i + 1; j < fresh.length; j += 1) {
    const a = fresh[i], b = fresh[j];
    const dAng = Math.abs(((dir(a.poly) - dir(b.poly) + Math.PI * 1.5) % Math.PI) - Math.PI / 2);
    const ca = centre(a.poly), cb = centre(b.poly);
    if (dAng < 0.25 && Math.hypot(ca.x - cb.x, ca.y - cb.y) < (width(a.poly) + width(b.poly)) * 0.75) parent[find(i)] = find(j);
  }
  const groups = new Map();
  fresh.forEach((m, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); });
  const out = [...merged];
  for (const group of groups.values()) {
    const row = nextRowLetter(out);
    const d = dir(group[0].poly);
    group.sort((a, b) => {
      const ca = centre(a.poly), cb = centre(b.poly);
      return (ca.x * Math.cos(d) + ca.y * Math.sin(d)) - (cb.x * Math.cos(d) + cb.y * Math.sin(d));
    });
    group.forEach((m, k) => {
      out.push({
        id: `${row}${k + 1}-m${Math.random().toString(36).slice(2, 7)}`, row, index: k + 1, label: `${row}${k + 1}`,
        poly: m.poly.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
        auto: true, confidence: m.confidence, sources: ["model"],
      });
    });
  }
  return { stalls: out, added: fresh.length, confirmed };
}
