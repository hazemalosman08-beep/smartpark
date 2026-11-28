import test from "node:test";
import assert from "node:assert/strict";
import { createSimulation, estimateCapacity, occupancyLevel } from "../../src/lib/occupancySim.js";

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

test("capacity: mapped value, else estimated from the size (garages times floors)", () => {
  assert.deepEqual(estimateCapacity({ outer: rect(50, 50), capacity: 80, kind: "surface" }), { total: 80, estimated: false });
  assert.deepEqual(estimateCapacity({ outer: rect(50, 50), kind: "surface" }), { total: 100, estimated: true });
  assert.deepEqual(estimateCapacity({ outer: rect(50, 50), kind: "multi-storey", levels: 4 }), { total: 400, estimated: true });
});

test("simulation: every lot stays within 0..capacity, numbers move, same seed same numbers", () => {
  const osm = { buildings: [], parking: [
    { id: "a", outer: rect(40, 40), kind: "surface", capacity: 60 },
    { id: "b", outer: rect(80, 30), kind: "surface" },
    { id: "s", outer: rect(3, 5), kind: "surface", space: true },
  ] };
  const sim = createSimulation(osm, { seed: 1 });
  assert.equal(sim.lots.size, 2, "single mapped spaces are not lots");
  const first = sim.snapshot();
  let moved = false;
  for (let i = 0; i < 50; i += 1) {
    sim.step();
    for (const o of sim.snapshot().values()) assert.ok(o.free >= 0 && o.free <= o.total);
    if (sim.snapshot().get("a").free !== first.get("a").free) moved = true;
  }
  assert.ok(moved);
  assert.deepEqual([...createSimulation(osm, { seed: 1 }).snapshot()], [...first]);
});

test("levels", () => {
  assert.equal(occupancyLevel({ free: 0, total: 50 }), "full");
  assert.equal(occupancyLevel({ free: 4, total: 50 }), "almost");
  assert.equal(occupancyLevel({ free: 12, total: 50 }), "filling");
  assert.equal(occupancyLevel({ free: 30, total: 50 }), "plenty");
});
