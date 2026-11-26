import test from "node:test";
import assert from "node:assert/strict";
import { findAccessible } from "../../src/lib/vision/accessible.js";

// 400x200 picture of pavement. A row of 6 spaces (20 px wide, 60 deep) runs
// along x from 40 to 160. Past its end: a space with a blue symbol (160-180),
// a blue hatched aisle (180-196), another symbol space (196-216), then plain
// pavement. One mapped space (index 2) has a symbol painted in it.
function picture({ navyCar = false } = {}) {
  const W = 400, H = 200, data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, [128, 128, 130]);
  const blue = [70, 130, 210];
  const symbol = (cx, cy) => { for (let y = cy - 5; y <= cy + 5; y += 1) for (let x = cx - 5; x <= cx + 5; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= 25) put(x, y, blue); };
  symbol(170, 70);
  for (let y = 52; y < 108; y += 1) for (let x = 181; x < 195; x += 1) put(x, y, blue); // aisle
  symbol(206, 70);
  symbol(90, 70); // in mapped space 3 (80-100)
  if (navyCar) for (let y = 55; y < 105; y += 1) for (let x = 222; x < 236; x += 1) put(x, y, x % 7 === 0 ? [90, 110, 200] : [20, 25, 60]);
  return { data, width: W, height: H };
}
const row = Array.from({ length: 6 }, (_, k) => {
  const x0 = 40 + k * 20, x1 = x0 + 20;
  const pct = (x, y) => ({ x: (x / 400) * 100, y: (y / 200) * 100 });
  return { id: `A${k + 1}`, row: "A", index: k + 1, label: `A${k + 1}`, poly: [pct(x0, 50), pct(x1, 50), pct(x1, 110), pct(x0, 110)] };
});

test("accessible: symbol in a mapped space, and symbol spaces past the row's end", () => {
  const r = findAccessible(picture(), row, []);
  assert.deepEqual([...r.marked], ["A3"]);
  assert.equal(r.added.length, 2, "two accessible spaces past the end, none for the aisle");
  const xs = r.added.map((s) => ((s.poly[0].x + s.poly[1].x) / 2 / 100) * 400).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 170) < 6 && Math.abs(xs[1] - 206) < 6, `centres ${xs}`);
  assert.ok(r.added.every((s) => s.kind === "accessible" && s.row === "A"));
});

test("accessible: a dark blue car is not paint, and a car on the symbol hides it", () => {
  const r = findAccessible(picture({ navyCar: true }), row, [{ x: (80 / 400) * 100, y: (50 / 200) * 100, w: 5, h: 30 }]);
  assert.ok(!r.marked.has("A3"), "the space with a car on it is left alone");
  assert.equal(r.added.length, 2, "the navy car adds nothing");
});
