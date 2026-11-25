import assert from "node:assert/strict";
import { dedupeStalls, makeStallRow, stallFromVehicle } from "../../src/lib/vision/lot.js";

// Painted row found automatically, then the same row drawn by hand on top.
const auto = makeStallRow([{ x: 10, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 30 }, { x: 10, y: 30 }], 5, "A").map((s) => ({ ...s, auto: true }));
const manual = makeStallRow([{ x: 11, y: 51 }, { x: 61, y: 51 }, { x: 61, y: 31 }, { x: 11, y: 31 }], 5, "B");
const merged = dedupeStalls([...auto, ...manual]);
assert.equal(merged.length, 5, "one space per real space");
assert.ok(merged.every((s) => !s.auto), "hand-drawn spaces win");

// Neighbouring spaces never merge.
assert.equal(dedupeStalls(auto).length, 5);

// A space inferred from a car on top of a painted space is dropped.
const car = { ...stallFromVehicle({ x: 20, y: 30, w: 10, h: 20 }, "overhead", "Z", 1), auto: true };
assert.equal(dedupeStalls([...auto, car]).length, 5);

// Two angled neighbours inferred from cars: boxes overlap ~40% but they are two spaces.
const c1 = { ...stallFromVehicle({ x: 20, y: 20, w: 20, h: 12 }, "overhead", "Y", 1), auto: true };
const c2 = { ...stallFromVehicle({ x: 26, y: 23, w: 20, h: 12 }, "overhead", "Y", 2), auto: true };
assert.equal(dedupeStalls([c1, c2]).length, 2);
// …but the same car found twice is one space.
const c3 = { ...stallFromVehicle({ x: 20.5, y: 20.3, w: 20, h: 12 }, "overhead", "Y", 3), auto: true };
assert.equal(dedupeStalls([c1, c3]).length, 1);
console.log("dedupe ok");

// An oversized painted space overlapping a parked car's space by >30% while
// the car stands outside it: both are real spaces.
{
  const bigPainted = { id: "P", row: "P", index: 1, label: "P1", auto: true, poly: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
  const carSpace = { ...stallFromVehicle({ x: 12, y: 6, w: 14, h: 10 }, "overhead", "Q", 1), auto: true };
  assert.equal(dedupeStalls([bigPainted, carSpace]).length, 2, "car standing outside the painted space keeps its own space");
}
console.log("dedupe edge ok");
