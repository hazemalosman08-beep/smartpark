import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseOsm, parkingSummary } from "../../src/lib/osm.js";

const { bounds, data } = JSON.parse(fs.readFileSync(new URL("../fixtures/osm-sample.json", import.meta.url)));
const osm = parseOsm(data, bounds);

test("osm: buildings with real heights, holes, and estimated heights", () => {
  const lib = osm.buildings.find((b) => b.name === "Library");
  assert.equal(lib.height, 4 * 3.2 + 1, "from building:levels");
  assert.ok(!lib.estimated);
  const w = Math.max(...lib.outer.map((p) => p.x)) - Math.min(...lib.outer.map((p) => p.x));
  assert.ok(Math.abs(w - 60) < 1, `60 m wide, got ${w}`);
  const hall = osm.buildings.find((b) => b.name === "Courtyard Hall");
  assert.equal(hall.height, 18);
  assert.equal(hall.holes.length, 1, "multipolygon with a courtyard");
  const plain = osm.buildings.find((b) => b.id === "way/2");
  assert.ok(plain.estimated && plain.height > 0);
});

test("osm: parking lots and garages with names and capacity", () => {
  const lot = osm.parking.find((p) => p.name === "Lot 5");
  assert.equal(lot.capacity, 120);
  assert.equal(lot.kind, "surface");
  const garage = osm.parking.find((p) => p.name === "Structure 2");
  assert.equal(garage.kind, "multi-storey");
  assert.ok(osm.buildings.some((b) => b.garage && b.name === "Structure 2"), "a garage is also a building");
  assert.deepEqual(parkingSummary(osm), { lots: 2, garages: 1, surface: 1, capacity: 920, withCapacity: 2 });
});

test("osm: roads with widths, paths, green, water, trees", () => {
  const warren = osm.roads.find((r) => r.name === "Warren Ave");
  assert.ok(Math.abs(warren.width - 13.2) < 0.01, "4 lanes");
  assert.ok(osm.roads.some((r) => r.service === "parking_aisle"));
  assert.equal(osm.paths.length, 1);
  assert.equal(osm.green.length, 1);
  assert.equal(osm.water.length, 1);
  assert.equal(osm.trees.length, 1);
  // North is up: a point north of the centre has a smaller y.
  const t = osm.trees[0];
  assert.ok(t.y < osm.buildings.find((b) => b.name === "Library").outer[0].y);
});
