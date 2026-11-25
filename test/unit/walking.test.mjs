import test from "node:test";
import assert from "node:assert/strict";
import { walkPlanner } from "../../src/lib/vision/walking.js";
import { deriveLot, makeStallRow, recommendStall, buildLaneGraph } from "../../src/lib/vision/lot.js";

// A row of spaces on the left, a building on the right with a wall (another
// building) in between that has a gap at the bottom.
function setup(surface) {
  const row = makeStallRow([{ x: 10, y: 60 }, { x: 50, y: 60 }, { x: 50, y: 40 }, { x: 10, y: 40 }], 5, "A");
  const lot = deriveLot({ version: 2, view: "overhead", aspect: 2, stalls: row, lanes: [], entrance: { x: 2, y: 90 }, building: { x: 150, y: 50 } });
  const features = { surfaceAt: surface };
  const dest = lot.buildings[0];
  return { lot, walker: walkPlanner(lot, features, dest), dest };
}

test("walk: around a building in the way, from the parked space", () => {
  const { lot, walker } = setup((p) => (p.x > 90 && p.x < 100 && p.y < 80 ? "building" : null));
  const r = walker.routeFrom(lot.stalls[0].centroid);
  assert.ok(r, "a walk is found");
  assert.ok(r.path.some((p) => p.y >= 80), "round the end of the building in the way");
  for (const p of r.path) assert.ok(!(p.x > 90 && p.x < 100 && p.y < 80), "never through it");
  assert.ok(r.length > Math.hypot(150 - lot.stalls[0].centroid.x, 0), "longer than the straight line");
  // Spaces nearer the building have a shorter walk.
  assert.ok(walker.distanceFor(lot.stalls[4]) < walker.distanceFor(lot.stalls[0]));
});

test("walk: a walkway is preferred and reported", () => {
  // A walkway band from the row to the building a little off the straight line.
  const { lot, walker } = setup((p) => (p.y > 62 && p.y < 66 && p.x > 30 && p.x < 152 ? "walkway" : null));
  const r = walker.routeFrom(lot.stalls[2].centroid);
  assert.ok(r.walkway, "the walk uses the walkway");
});

test("the recommended space is the one with the shortest real walk", () => {
  const { lot, walker } = setup((p) => (p.x > 90 && p.x < 100 && p.y < 80 ? "building" : null));
  const navLot = { ...lot, walkDistanceFor: walker.distanceFor };
  const best = recommendStall(navLot, buildLaneGraph(lot.lanes), new Map(), lot.entrance, null);
  const walks = lot.stalls.map((s) => walker.distanceFor(s));
  assert.equal(walks[lot.stalls.indexOf(best)], Math.min(...walks));
});
