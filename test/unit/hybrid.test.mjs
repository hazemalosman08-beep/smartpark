import test from "node:test";
import assert from "node:assert/strict";
import { spacesFromMasks, minAreaRect } from "../../src/lib/vision/spaceMasks.js";
import { mergeSpaces } from "../../src/lib/vision/hybrid.js";
import { makeStallRow } from "../../src/lib/vision/lot.js";

// A synthetic model output: a double row of 2 x 5 spaces (20 x 40 px), each
// separated by a 2 px boundary, with one space shaded as if a car hid it.
function masks() {
  const W = 160, H = 120, interior = new Float32Array(W * H), boundary = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const k = y * W + x;
    const inRows = x >= 20 && x < 120 && y >= 20 && y < 100;
    if (!inRows) { boundary[k] = 0.05; continue; }
    const edge = (x - 20) % 20 < 2 || y === 59 || y === 60;
    if (edge) { boundary[k] = 0.9; interior[k] = 0.05; } else { interior[k] = x >= 62 && x < 80 && y < 59 ? 0.7 : 0.95; boundary[k] = 0.03; }
  }
  return { interior, boundary, W, H };
}

test("model masks become one oriented space each, with a confidence", () => {
  const spaces = spacesFromMasks(masks());
  assert.equal(spaces.length, 10, "two rows of five");
  for (const s of spaces) {
    assert.equal(s.poly.length, 4);
    const w = Math.hypot(s.poly[1].x - s.poly[0].x, s.poly[1].y - s.poly[0].y);
    const d = Math.hypot(s.poly[3].x - s.poly[0].x, s.poly[3].y - s.poly[0].y);
    assert.ok(w < d, "first edge is the short (front) side");
    assert.ok(s.confidence > 0.5 && s.confidence <= 1);
  }
  const hidden = spaces.find((s) => s.poly.every((p) => p.x >= 60 && p.x <= 81 && p.y < 60));
  const clear = spaces.find((s) => s.poly.every((p) => p.x >= 20 && p.x <= 41 && p.y < 60));
  assert.ok(hidden.confidence < clear.confidence, "less sure where the model was less sure");
});

test("minAreaRect fits a rotated rectangle", () => {
  const pts = [];
  for (let u = 0; u < 30; u += 1) for (let v = 0; v < 10; v += 1) {
    const a = 0.5;
    pts.push([Math.round(50 + u * Math.cos(a) - v * Math.sin(a)), Math.round(50 + u * Math.sin(a) + v * Math.cos(a))]);
  }
  const r = minAreaRect(pts);
  assert.ok(Math.abs(Math.max(r.w, r.h) - 30) < 3 && Math.abs(Math.min(r.w, r.h) - 10) < 3, `${r.w} x ${r.h}`);
});

test("merge: confirmed spaces gain confidence, missed spaces are added as a row", () => {
  const geo = makeStallRow([{ x: 10, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 30 }, { x: 10, y: 30 }], 4, "A")
    .map((s) => ({ ...s, auto: true, confidence: 0.6, sources: ["lines"] }));
  const fromModel = [
    ...geo.slice(0, 2).map((s) => ({ poly: s.poly.map((p) => ({ x: p.x + 0.3, y: p.y })), confidence: 0.8 })),
    // A row the rules missed (60..80 %), and a weak, doubtful blob.
    ...[0, 1].map((k) => ({ poly: [{ x: 60 + k * 10, y: 50 }, { x: 70 + k * 10, y: 50 }, { x: 70 + k * 10, y: 30 }, { x: 60 + k * 10, y: 30 }], confidence: 0.75 })),
    { poly: [{ x: 85, y: 80 }, { x: 90, y: 80 }, { x: 90, y: 70 }, { x: 85, y: 70 }], confidence: 0.3 },
  ];
  const r = mergeSpaces(geo, fromModel);
  assert.equal(r.confirmed, 2);
  assert.equal(r.added, 2, "the weak blob is not added");
  assert.ok(r.stalls[0].confidence > 0.6 && r.stalls[0].sources.includes("model"));
  assert.ok(r.stalls[3].confidence < 0.6, "not seen by the model: a little less sure");
  const added = r.stalls.filter((s) => s.sources?.[0] === "model");
  assert.equal(new Set(added.map((s) => s.row)).size, 1, "added side by side as one row");
  assert.notEqual(added[0].row, "A");
});
