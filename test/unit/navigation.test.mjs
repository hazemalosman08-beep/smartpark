import test from "node:test";
import assert from "node:assert/strict";
import { buildManeuvers, nextManeuver, pointAlong, routeSummary } from "../../src/lib/vision/navigation.js";
import { deriveLot, gridRoute, makeStallRow, recommendStall, routeToStall, buildLaneGraph } from "../../src/lib/vision/lot.js";

const stall = { label: "A1", centroid: { x: 20, y: 5 }, front: { x: 20, y: 8 }, back: { x: 20, y: 2 } };

test("maneuvers: straight, a right turn (plan y points down), then the space", () => {
  // East 10, then south 10, then into the space.
  const route = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, stall.front, stall.centroid];
  const m = buildManeuvers(route, stall, 1);
  assert.equal(m[0].kind, "right");
  assert.equal(Math.round(m[0].at), 10);
  assert.equal(m[m.length - 1].kind, "park");
  const n = nextManeuver(m, 4);
  assert.equal(Math.round(n.inMeters), 6);
  assert.equal(Math.round(routeSummary(route, 2).meters), Math.round(2 * (10 + 10 + Math.hypot(10, 2) + 3)));
  const p = pointAlong(route, 15);
  assert.deepEqual([Math.round(p.x), Math.round(p.y)], [10, 5]);
});

function lotWith(stalls, extra = {}) {
  return deriveLot({ version: 2, view: "overhead", aspect: 2, stalls, lanes: [], entrance: { x: 2, y: 50 }, building: { x: 98, y: 50 }, ...extra });
}

test("reserved spaces are never recommended; accessible ones only when needed", () => {
  const row = makeStallRow([{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 20 }, { x: 30, y: 20 }], 5, "A");
  row[4] = { ...row[4], kind: "reserved" };
  row[3] = { ...row[3], kind: "accessible" };
  const lot = lotWith(row);
  const graph = buildLaneGraph(lot.lanes);
  const free = new Map();
  const normal = recommendStall(lot, graph, free, lot.entrance, null);
  assert.ok(normal && !normal.kind, "a normal space for most drivers");
  const acc = recommendStall(lot, graph, free, lot.entrance, null, { accessible: true });
  assert.equal(acc.kind, "accessible");
  const all = new Map(lot.stalls.filter((s) => !s.kind).map((s) => [s.id, { status: "occupied" }]));
  const none = recommendStall(lot, graph, all, lot.entrance, null);
  assert.equal(none, null, "the reserved and accessible spaces are not offered instead");
});

test("routes go around islands and buildings read from the picture", () => {
  const row = makeStallRow([{ x: 120, y: 60 }, { x: 160, y: 60 }, { x: 160, y: 40 }, { x: 120, y: 40 }], 4, "A");
  const lot = lotWith(row);
  // A wall (island) across the middle of the lot with a gap at the bottom.
  const obstacle = (p) => p.x > 90 && p.x < 100 && p.y < 85;
  const target = lot.stalls[0];
  const route = routeToStall(lot, buildLaneGraph(lot.lanes), target, { x: 20, y: 50 }, { obstacle });
  for (let i = 1; i < route.length - 2; i += 1) {
    const a = route[i - 1], b = route[i];
    for (let t = 0; t <= 1; t += 0.05) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      assert.ok(!obstacle(p), `route crosses the island at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
  }
  assert.ok(route.some((p) => p.y >= 85), "it drives round through the gap");
  // Without obstacles the direct way is taken.
  const direct = gridRoute(lot, { x: 20, y: 50 }, { x: 140, y: 70 });
  assert.ok(direct.every((p) => p.y < 85));
});

test("scale: without a measured lot, space width (2.5 m) sets metres", () => {
  const row = makeStallRow([{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 20 }, { x: 30, y: 20 }], 4, "A");
  const lot = lotWith(row);
  const w = Math.hypot(lot.stalls[0].poly[1].x - lot.stalls[0].poly[0].x, lot.stalls[0].poly[1].y - lot.stalls[0].poly[0].y);
  assert.equal(lot.scaleSource, "estimated");
  assert.ok(Math.abs(w * lot.metersPerUnit - 2.5) < 1e-6);
  assert.equal(lot.buildings.length, 1);
});
