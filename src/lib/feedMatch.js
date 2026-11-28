// Matching a lot's camera to its satellite picture automatically: which
// camera space is which satellite space.
//
// The camera's spaces are known as a top-down plan (the camera's lot map,
// straightened); the satellite picture's spaces are top-down already. The
// plan is placed on the satellite picture with a turn, a flip, a scale and
// a shift:
//   * scale: the width of a space in each;
//   * turn: rows along rows (two ways round), with or without a flip;
//   * shift: every pair (camera space, satellite space) votes for the shift
//     that would put one on the other; the shift with most votes wins, then
//     it is refined on the spaces it lines up.
// Painted lots repeat, so the best shift can be one space (or row) off: an
// anchor (one camera space and the same satellite space, clicked by staff)
// fixes the shift exactly.
import { deriveLot, normalizeCalibration } from "./vision/lot.js";

const centre = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const median = (v) => { const a = [...v].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };
// Row direction (along the front edge), as an angle mod PI.
const rowAngle = (poly) => { const a = Math.atan2(poly[1].y - poly[0].y, poly[1].x - poly[0].x); return ((a % Math.PI) + Math.PI) % Math.PI; };
const width = (poly) => Math.hypot(poly[1].x - poly[0].x, poly[1].y - poly[0].y);

function axisMedian(angles) {
  // Mean of directions mod PI (doubled-angle average).
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(2 * a); sy += Math.sin(2 * a); }
  return Math.atan2(sy, sx) / 2;
}

const mul = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
];

/**
 * cameraCal, aerialCal: calibrations (spaces in picture %). anchor: optional
 * { cameraId, aerialId }. Returns { H (camera % -> satellite %), matched,
 * total, pairs: Map cameraId -> aerialId, unsure } or null.
 */
export function autoLink(cameraCal, aerialCal, { anchor = null } = {}) {
  const camLot = deriveLot(normalizeCalibration(cameraCal));
  const aer = normalizeCalibration(aerialCal);
  const aspS = aer.aspect || 1.5;
  if (camLot.stalls.length < 2 || aer.stalls.length < 2) return null;
  // Camera: plan units. Satellite: % with x stretched by the aspect (square units).
  const cam = camLot.stalls.map((s) => ({ id: s.id, c: centre(s.poly), w: width(s.poly), a: rowAngle(s.poly) }));
  const sat = aer.stalls.map((s) => {
    const poly = s.poly.map((p) => ({ x: p.x * aspS, y: p.y }));
    return { id: s.id, c: centre(poly), w: width(poly), a: rowAngle(poly) };
  });
  const wc = median(cam.map((s) => s.w)), ws = median(sat.map((s) => s.w));
  if (!(wc > 0 && ws > 0)) return null;
  const scale = ws / wc;
  const base = axisMedian(sat.map((s) => s.a)) - axisMedian(cam.map((s) => s.a));
  const near = ws * 0.6, bin = ws * 0.5;
  const candidates = [];
  for (const flip of [false, true]) for (const k of [0, 1, 2, 3]) {
    // Flipping mirrors x, which also mirrors the camera's row angle.
    const camAxis = axisMedian(cam.map((s) => (flip ? Math.PI - s.a : s.a)));
    const rot = axisMedian(sat.map((s) => s.a)) - camAxis + (k * Math.PI) / 2;
    candidates.push({ flip, rot, k });
  }
  void base;
  const place = (cnd, p) => {
    const x = cnd.flip ? -p.x : p.x, y = p.y;
    const c = Math.cos(cnd.rot), s = Math.sin(cnd.rot);
    return { x: scale * (x * c - y * s), y: scale * (x * s + y * c) };
  };
  // Grid of satellite centres for nearest lookups.
  const cell = ws, grid = new Map();
  for (const s of sat) { const key = `${Math.floor(s.c.x / cell)},${Math.floor(s.c.y / cell)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(s); }
  const nearest = (p) => {
    let best = null, bd = near;
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const s of grid.get(`${gx + dx},${gy + dy}`) || []) {
      const d = Math.hypot(s.c.x - p.x, s.c.y - p.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  const evaluate = (cnd, t) => {
    let matched = 0, sx = 0, sy = 0;
    const pairs = new Map();
    for (const s of cam) {
      const q = place(cnd, s.c);
      const m = nearest({ x: q.x + t.x, y: q.y + t.y });
      if (m && Math.abs(Math.sin(((cnd.flip ? Math.PI - s.a : s.a) + cnd.rot) - m.a)) < 0.5) { matched += 1; pairs.set(s.id, m.id); sx += m.c.x - q.x; sy += m.c.y - q.y; }
    }
    return { matched, pairs, t: matched ? { x: sx / matched, y: sy / matched } : t };
  };
  const results = [];
  for (const cnd of candidates) {
    // Only turns that keep rows along rows (or exactly across, k odd, kept
    // as a fallback for plans whose rows were read the other way).
    let ts = [];
    if (anchor) {
      const ca = cam.find((s) => s.id === anchor.cameraId), sa = sat.find((s) => s.id === anchor.aerialId);
      if (!ca || !sa) return null;
      const q = place(cnd, ca.c);
      ts = [{ x: sa.c.x - q.x, y: sa.c.y - q.y }];
    } else {
      const votes = new Map();
      for (const s of cam) {
        const q = place(cnd, s.c);
        for (const m of sat) {
          const tx = m.c.x - q.x, ty = m.c.y - q.y;
          const key = `${Math.round(tx / bin)},${Math.round(ty / bin)}`;
          votes.set(key, (votes.get(key) || 0) + 1);
        }
      }
      ts = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => { const [i, j] = key.split(",").map(Number); return { x: i * bin, y: j * bin }; });
    }
    for (const t0 of ts) {
      let r = evaluate(cnd, t0);
      r = evaluate(cnd, r.t); // refine on the spaces it lines up
      results.push({ cnd, ...r });
    }
  }
  results.sort((a, b) => b.matched - a.matched);
  const best = results[0];
  if (!best || !best.matched) return null;
  const second = results.find((r) => r.cnd !== best.cnd || Math.hypot(r.t.x - best.t.x, r.t.y - best.t.y) > ws * 0.5);
  // camera % -> plan (the camera's lot map) -> satellite (square) -> satellite %.
  const c = Math.cos(best.cnd.rot), s = Math.sin(best.cnd.rot), f = best.cnd.flip ? -1 : 1;
  const M = [scale * c * f, -scale * s, best.t.x, scale * s * f, scale * c, best.t.y, 0, 0, 1];
  const D = [1 / aspS, 0, 0, 0, 1, 0, 0, 0, 1];
  const H = mul(D, mul(M, camLot.H));
  return { H, matched: best.matched, total: cam.length, pairs: best.pairs, unsure: Boolean(second && second.matched >= best.matched * 0.9) };
}
