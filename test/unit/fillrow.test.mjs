import test from "node:test";
import assert from "node:assert/strict";
import { fillRowAt } from "../../src/lib/vision/fillRow.js";
import { buildAnnotation } from "../../src/lib/annotationExport.js";

// 600x400 grey picture with two rows of white dividers (space 30 px wide,
// 70 deep): row 1 at y 40-110 (mapped), row 2 at y 200-270 (missed).
function picture() {
  const W = 600, H = 400, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) { data[i * 4] = 90; data[i * 4 + 1] = 92; data[i * 4 + 2] = 95; data[i * 4 + 3] = 255; }
  const line = (x, y0, y1) => { for (let y = y0; y <= y1; y += 1) for (let dx = 0; dx < 3; dx += 1) { const i = (y * W + x + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 235; } };
  for (let k = 0; k <= 16; k += 1) { line(60 + k * 30, 40, 110); line(60 + k * 30, 200, 270); }
  return { data, width: W, height: H };
}
const pct = (x, y) => ({ x: (x / 600) * 100, y: (y / 400) * 100 });
const mapped = Array.from({ length: 16 }, (_, k) => ({
  id: `A${k + 1}`, row: "A", index: k + 1, label: `A${k + 1}`, auto: true,
  poly: [pct(61 + k * 30, 40), pct(91 + k * 30, 40), pct(91 + k * 30, 110), pct(61 + k * 30, 110)],
}));

test("fill row: one click fills the whole missed row from its lines", () => {
  const r = fillRowAt(picture(), pct(300, 235), mapped, []);
  assert.ok(r.method, "found something");
  assert.ok(r.stalls.length >= 14 && r.stalls.length <= 16, `got ${r.stalls.length}`);
  for (const s of r.stalls) {
    const cy = s.poly.reduce((a, p) => a + p.y, 0) / 4 * 4;
    assert.ok(cy > 190 && cy < 280, "in the clicked row");
    assert.ok(!s.auto && s.confidence > 0 && s.sources.includes("fill"));
  }
  assert.ok(r.stalls.every((s) => s.row === "B"), "a new row letter");
  const xs = r.stalls.map((s) => s.poly.reduce((a, p) => a + p.x, 0) / 4 * 6).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i += 1) assert.ok(Math.abs(xs[i] - xs[i - 1] - 30) < 6, "one space per gap between lines");
});

test("fill row: clicking an already mapped row adds nothing", () => {
  const r = fillRowAt(picture(), pct(300, 75), mapped, []);
  assert.equal(r.stalls.length, 0);
});

test("annotation export: pixel polygons, kinds, corrected flags, lot id", () => {
  const calibration = { view: "overhead", stalls: [{ ...mapped[0], kind: "accessible" }, { ...mapped[1], auto: false }], entrance: pct(10, 390) };
  const a = buildAnnotation({ calibration, statuses: new Map([["A1", { status: "occupied" }]]), image: { dataUrl: "data:,", width: 600, height: 400, fileName: "x.jpg" }, lotId: "North Lot #2" });
  assert.equal(a.format, "smartpark-annotation/v1");
  assert.equal(a.lot_id, "north-lot-2");
  assert.deepEqual(a.spaces[0].polygon[0], [61, 40]);
  assert.equal(a.spaces[0].kind, "accessible");
  assert.equal(a.spaces[0].occupied, true);
  assert.equal(a.spaces[0].corrected, false);
  assert.equal(a.spaces[1].corrected, true, "drawn by hand");
});
