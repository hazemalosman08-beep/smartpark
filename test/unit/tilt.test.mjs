import assert from "node:assert/strict";
import { estimateTilt } from "../../src/lib/vision/autoTilt.js";
import { applyHomography, homographyFromPoints } from "../../src/lib/vision/geometry.js";

// A pole camera (pinhole, tilted down) looking at a lot: cars 1.85 m wide on a
// grid of rows. Project them, estimate the tilt, and check that the
// straightened lot gives every car about the same width near and far.
const W = 1280, H = 720, f = 0.85 * W, camH = 8, pitch = 0.45; // radians below horizontal
const project = (X, Z) => {
  // camera at (0, camH, 0) looking along +Z, pitched down
  const y = -camH, c = Math.cos(pitch), s = Math.sin(pitch);
  const yc = y * c + Z * s, zc = -y * s + Z * c;
  return { x: W / 2 + (f * X) / zc, y: H / 2 - (f * yc) / zc };
};
const cars = [];
for (const Z of [10, 15, 20, 26, 32, 40]) for (let X = -12; X <= 12; X += 3) {
  const a = project(X - 0.92, Z), b = project(X + 0.92, Z), top = project(X, Z + 2.3), bot = project(X, Z - 2.3);
  cars.push({ x: (a.x / W) * 100, y: (top.y / H) * 100, w: ((b.x - a.x) / W) * 100, h: ((bot.y - top.y) / H) * 100 });
}
const visible = cars.filter((c) => c.x > 0 && c.x + c.w < 100 && c.y > 0 && c.y + c.h < 100);
const tilt = estimateTilt(visible, W, H);
assert.ok(tilt, "tilt found");
assert.ok(tilt.strength > 0.3, `clear perspective measured (${tilt.strength})`);
const g = tilt.ground;
const Hm = homographyFromPoints(g.quad, [{ x: 0, y: 0 }, { x: g.width, y: 0 }, { x: g.width, y: g.length }, { x: 0, y: g.length }]);
const widths = visible.map((c) => {
  const yb = c.y + c.h / 2;
  const L = applyHomography(Hm, { x: c.x, y: yb }), R = applyHomography(Hm, { x: c.x + c.w, y: yb });
  return Math.hypot(R.x - L.x, R.y - L.y);
});
const min = Math.min(...widths), max = Math.max(...widths);
assert.ok(max / min < 1.25, `straightened car widths even (${min.toFixed(2)}..${max.toFixed(2)} m)`);
// Straight down: no tilt to fix.
const flat = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 20 + 5, y: Math.floor(i / 4) * 25 + 10, w: 6, h: 12 }));
assert.equal(estimateTilt(flat, W, H), null);
console.log("tilt ok", tilt.strength, widths.length, "cars", min.toFixed(2), max.toFixed(2));
