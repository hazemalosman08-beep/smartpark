import assert from "node:assert/strict";
import { createTracker } from "../../src/lib/vision/tracker.js";
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (s) => (rnd() - 0.5) * 2 * s;
const tr = createTracker();
let n = 0; const assignId = () => `SP-${String(++n).padStart(3, "0")}`;
// Car A drives left->right, car B right->left on the same row (they cross), car C parked.
const ids = { A: new Set(), B: new Set(), C: new Set() };
let falsePositiveIds = 0;
const all = [];
for (let f = 0; f < 150; f++) {
  const now = 1000 + f * 200; // 5 fps
  const ax = 5 + f * 0.55, bx = 85 - f * 0.55;
  const truth = { A: { x: ax, y: 40, w: 8, h: 5 }, B: { x: bx, y: 41, w: 8, h: 5 }, C: { x: 30, y: 70, w: 9, h: 6 } };
  const dets = [];
  for (const [k, b] of Object.entries(truth)) {
    if (rnd() < 0.15) continue; // missed detection
    const occluded = k !== "C" && Math.abs(ax - bx) < 6; // overlap when crossing: weaker score
    dets.push({ x: b.x + noise(0.4), y: b.y + noise(0.3), w: b.w + noise(0.4), h: b.h + noise(0.3), score: occluded ? 0.3 : 0.6 + rnd() * 0.3, truth: k });
  }
  if (rnd() < 0.1) dets.push({ x: rnd() * 90, y: rnd() * 90, w: 5, h: 4, score: 0.5, truth: "FP" });
  const { tracks } = tr.update(dets, { now, assignId });
  for (const t of tracks) {
    if (!t.vehicle_id || t.state === "lost") continue;
    // which truth is nearest
    let best = null, bd = 1e9;
    for (const [k, b] of Object.entries(truth)) { const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd) { bd = d; best = k; } }
    if (bd < 4) ids[best].add(t.vehicle_id); else all.push(t.vehicle_id);
  }
}
console.log("ids per car", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, [...v]])), "stray", [...new Set(all)]);
assert.equal(ids.C.size, 1, "parked car keeps one ID");
assert.ok(ids.A.size <= 1 && ids.B.size <= 1, "crossing cars keep IDs");
console.log("tracker ok");
// Many vehicles confirmed in the same frame must get distinct IDs even if the
// ID source keeps returning the same value.
const tr2 = createTracker();
let last;
for (let f = 0; f < 4; f++) {
  last = tr2.update(Array.from({ length: 6 }, (_, i) => ({ x: i * 15, y: 10, w: 8, h: 5, score: 0.9 })), { now: f * 200, assignId: () => "SP-001" });
}
const idsNow = last.tracks.map((t) => t.vehicle_id);
assert.equal(new Set(idsNow).size, 6, `distinct ids ${idsNow}`);
console.log("unique ids ok", idsNow.join(","));
