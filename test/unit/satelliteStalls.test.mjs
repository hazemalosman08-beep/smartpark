import test from "node:test";
import assert from "node:assert/strict";
import { findSatelliteStalls } from "../../src/lib/vision/satelliteStalls.js";

// A synthetic satellite lot: grey asphalt, two double rows of spaces with
// thin white lines 10 px apart, and some noise (cracks).
function lot() {
  const width = 400, height = 200, data = new Uint8ClampedArray(width * height * 4);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < width * height; i += 1) { const v = 110 + rnd() * 20; data.set([v, v, v, 255], i * 4); }
  const paint = (x, y) => { if (x >= 0 && y >= 0 && x < width && y < height) data.set([235, 235, 235, 255], (y * width + x) * 4); };
  for (const [y0, y1] of [[30, 70], [120, 160]]) {
    for (let x = 40; x <= 360; x += 10) for (let y = y0; y <= y1; y += 1) paint(x, y);
    for (let x = 40; x <= 360; x += 1) paint(x, (y0 + y1) >> 1); // back line between the two rows
  }
  return { data, width, height };
}

test("satellite picture: rows of thin painted lines become spaces", () => {
  const r = findSatelliteStalls(lot());
  assert.equal(r.spacing, 10);
  // 4 rows of 32 spaces = 128.
  assert.ok(r.stalls.length >= 110 && r.stalls.length <= 140, `${r.stalls.length}`);
  for (const s of r.stalls) assert.equal(s.poly.length, 4);
});
