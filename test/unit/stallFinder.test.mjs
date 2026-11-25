import assert from "node:assert/strict";
import { findStalls } from "../../src/lib/vision/stallFinder.js";
import { autoMapLot } from "../../src/lib/vision/autoMap.js";
import { guessView } from "../../src/lib/vision/lot.js";

// Synthetic top-down lot: grey asphalt, two rows of white stall dividers.
function syntheticLot({ angle = 0, dividers = 9, rowsY = [120, 330] } = {}) {
  const W = 640, H = 480;
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H; i += 1) {
    const g = 95 + rnd() * 20;
    data[i * 4] = g; data[i * 4 + 1] = g; data[i * 4 + 2] = g + 3; data[i * 4 + 3] = 255;
  }
  const line = (x0, y0, x1, y1, t = 2) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 0; k <= n; k += 1) {
      const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
      for (let dy = -t; dy <= t; dy += 1) for (let dx = -t; dx <= t; dx += 1) {
        const xx = Math.round(x + dx), yy = Math.round(y + dy);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = (yy * W + xx) * 4;
        data[i] = 235; data[i + 1] = 235; data[i + 2] = 235;
      }
    }
  };
  const len = 90, dx = Math.sin(angle) * len, dy = Math.cos(angle) * len;
  for (const y of rowsY) for (let i = 0; i < dividers; i += 1) line(60 + i * 60, y, 60 + i * 60 + dx, y + dy);
  return { data, width: W, height: H };
}

const straight = findStalls(syntheticLot());
assert.equal(straight.stalls.length, 16, `two rows of 9 dividers -> 16 stalls, got ${straight.stalls.length}`);
const rows = new Set(straight.stalls.map((s) => s.row));
assert.equal(rows.size, 2);

// Angled (herringbone-like) dividers.
const angled = findStalls(syntheticLot({ angle: 0.5 }));
assert.ok(angled.stalls.length >= 14 && angled.stalls.length <= 16, `angled stalls ${angled.stalls.length}`);

// A missing divider (under a car) is filled in from the row's spacing.
const img = syntheticLot();
// paint over the 5th divider of the first row with asphalt
for (let y = 110; y < 220; y += 1) for (let x = 290; x < 314; x += 1) { const i = (y * 640 + x) * 4; img.data[i] = 100; img.data[i + 1] = 100; img.data[i + 2] = 103; }
const gap = findStalls(img);
assert.equal(gap.stalls.length, 16, `hidden divider filled in, got ${gap.stalls.length}`);

// autoMapLot adds a stall for a parked car where no paint was found.
const res = autoMapLot({ image: syntheticLot({ rowsY: [120] }), vehicles: [{ x: 40, y: 70, w: 6, h: 12 }], view: "overhead" });
assert.equal(res.stats.painted, 8);
assert.equal(res.stats.fromCars, 1);
// Angled views do not read paint lines.
assert.equal(autoMapLot({ image: syntheticLot(), vehicles: [], view: "angled" }).stats.painted, 0);

// View guess
assert.equal(guessView([{ x: 1, y: 5, w: 5, h: 5 }, { x: 1, y: 20, w: 5, h: 5 }, { x: 1, y: 60, w: 5, h: 5 }, { x: 1, y: 80, w: 5, h: 5 }]), "overhead");
assert.equal(guessView([{ x: 1, y: 5, w: 1, h: 1 }, { x: 1, y: 20, w: 1.5, h: 1.5 }, { x: 1, y: 60, w: 6, h: 6 }, { x: 1, y: 80, w: 8, h: 8 }]), "angled");
console.log("stall finder ok", straight.stalls.length, angled.stalls.length, gap.stalls.length);
