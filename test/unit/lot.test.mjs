import assert from "node:assert/strict";
import * as L from "../../src/lib/vision/lot.js";

const cal = L.sampleCalibration();
assert.equal(cal.stalls.length, 36);
const lot = L.deriveLot(cal);
assert.equal(lot.stalls.length, 36);
const graph = L.buildLaneGraph(lot.lanes);
assert.ok(graph.nodes.length > 50);
const target = lot.stalls.find((s) => s.label === "B6");
const route = L.routeToStall(lot, graph, target);
assert.ok(route.length >= 3);
console.log("route to B6", route.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" -> "));

// Occupancy: a car box sitting in stall A3 (camera space, overhead view)
const a3 = cal.stalls.find((s) => s.label === "A3");
const b = { x: Math.min(...a3.poly.map((p) => p.x)) + 0.5, y: 7, w: 5, h: 16 };
const occ = L.createOccupancy();
let res;
for (let t = 0; t < 10; t++) res = occ.update(cal.stalls, [{ ...b, vehicle_id: "SP-001", motion: "parked" }], { view: "overhead", now: 1000 + t * 500 });
assert.equal(res.get(a3.id).status, "occupied");
assert.equal(res.get(a3.id).vehicle_id, "SP-001");
assert.equal([...res.values()].filter((r) => r.status === "occupied").length, 1);
// a single missed frame must not free it
res = occ.update(cal.stalls, [], { view: "overhead", now: 6500 });
assert.equal(res.get(a3.id).status, "occupied");
for (let t = 0; t < 12; t++) res = occ.update(cal.stalls, [], { view: "overhead", now: 7000 + t * 500 });
assert.equal(res.get(a3.id).status, "free");

// Perspective row: far stalls narrower
const rowStalls = L.makeStallRow([{ x: 10, y: 80 }, { x: 90, y: 80 }, { x: 70, y: 50 }, { x: 30, y: 50 }], 4, "A");
assert.equal(rowStalls.length, 4);

// Ground rectification
const rect = L.deriveLot({ ...cal, ground: { quad: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 95, y: 95 }, { x: 5, y: 95 }], width: 50, length: 30 } });
const corner = rect.toLot({ x: 95, y: 95 });
assert.ok(Math.abs(corner.x - 50) < 1e-6 && Math.abs(corner.y - 30) < 1e-6);
const rec = L.recommendStall(lot, graph, new Map());
console.log("recommended", rec.label);
console.log("lot ok");

// Directions: right turn then the space on the left
{
  const route = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  const stall = { label: "B2", centroid: { x: 8, y: 10 } };
  const steps = L.directionsFor([...route.slice(0, 3), { x: 10, y: 9 }, { x: 11, y: 9 }], { label: "B2", centroid: { x: 11, y: 9 } }, 1);
  console.log(steps.map((s) => s.text).join(" | "));
  assert.equal(steps[0].text, "Drive 10 m");
  assert.equal(steps[1].text, "Turn right");
  assert.equal(steps.at(-1).kind, "park");
  void stall;
}

// Building: the guide picks the free space with the shortest walk to it.
{
  const cal = L.sampleCalibration();
  const plain = L.deriveLot(cal);
  const g = L.buildLaneGraph(plain.lanes);
  const nearEntrance = L.recommendStall(plain, g, new Map());
  const withBuilding = L.deriveLot({ ...cal, building: { x: 90, y: 5 } }); // top-right corner
  const pick = L.recommendStall(withBuilding, L.buildLaneGraph(withBuilding.lanes), new Map());
  const d = (s) => Math.hypot(s.centroid.x - withBuilding.building.x, s.centroid.y - withBuilding.building.y);
  assert.ok(withBuilding.stalls.every((s) => d(s) >= d(pick) - 1e-9), "closest walk to the building");
  assert.notEqual(pick.label, nearEntrance.label);
  // A taken space next to the building is skipped.
  const taken = new Map([[pick.id, { status: "occupied" }]]);
  assert.notEqual(L.recommendStall(withBuilding, L.buildLaneGraph(withBuilding.lanes), taken).id, pick.id);
  console.log("building ok:", nearEntrance.label, "->", pick.label);
}

// A space the lanes do not reach is still a candidate (straight-line fallback).
{
  const cal = L.sampleCalibration();
  const lot = L.deriveLot({ ...cal, building: { x: 90, y: 5 } });
  const graph = L.buildLaneGraph([{ id: "x", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }].map((l) => ({ ...l, points: l.points.map(lot.toLot) })));
  const cost = L.stallCost(lot, graph, lot.stalls[0]);
  assert.ok(Number.isFinite(cost));
  console.log("unreachable fallback ok");
}
