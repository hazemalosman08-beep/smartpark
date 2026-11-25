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
