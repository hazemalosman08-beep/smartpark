import assert from "node:assert/strict";
import { createOccupancy, makeStallRow } from "../../src/lib/vision/lot.js";

// Side-angle camera, two rows of spaces: near row (bottom of picture) and the
// row behind it. All coordinates in % of the picture.
const near = makeStallRow([{ x: 10, y: 88 }, { x: 70, y: 88 }, { x: 68, y: 72 }, { x: 12, y: 72 }], 5, "A");
const far = makeStallRow([{ x: 12, y: 66 }, { x: 68, y: 66 }, { x: 66, y: 54 }, { x: 14, y: 54 }], 5, "B");

// A tall SUV standing in near space A3: its wheels are in A3 (box bottom at
// 87%), but its roof reaches far up the picture, over space B3 behind it.
const suv = { x: 35.5, y: 52, w: 11, h: 35, vehicle_id: "SUV", motion: "parked" };

function decide(stalls, vehicles) {
  const occ = createOccupancy();
  let out;
  for (let t = 0; t < 8; t += 1) out = occ.update(stalls, vehicles, { view: "angled", now: 1000 + t * 500 });
  return out;
}
const label = (stalls, res, l) => res.get(stalls.find((s) => s.label === l).id).status;

// 1. Both rows mapped: the SUV takes A3 only; B3 behind it stays open.
{
  const stalls = [...near, ...far];
  const res = decide(stalls, [suv]);
  assert.equal(label(stalls, res, "A3"), "occupied");
  assert.equal(label(stalls, res, "B3"), "free", "space behind a tall SUV must stay open");
}
// 2. Only the far row mapped (the SUV's own space was missed): the SUV must
//    not be counted in the space behind it.
{
  const res = decide(far, [suv]);
  assert.equal(label(far, res, "B3"), "free", "SUV roof over an unmapped row must not take the space behind");
}
// 3. A normal car really parked in B3 still counts.
{
  const car = { x: 35, y: 54, w: 10, h: 11, vehicle_id: "C", motion: "parked" };
  const res = decide(far, [car]);
  assert.equal(label(far, res, "B3"), "occupied");
}
// 4. Back-to-back rows (no aisle between them) and a very tall vehicle whose
//    own space is not mapped: its roof covers most of the space behind it.
{
  const back = makeStallRow([{ x: 12, y: 72 }, { x: 68, y: 72 }, { x: 66, y: 58 }, { x: 14, y: 58 }], 5, "C");
  const van = { x: 35.5, y: 40, w: 11, h: 47, vehicle_id: "VAN", motion: "parked" };
  const res = decide(back, [van]);
  assert.equal(label(back, res, "C3"), "free", "tall van in front must not take the back-to-back space behind it");
}
console.log("angled occupancy ok");
