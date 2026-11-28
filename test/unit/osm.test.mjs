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

import { destinations, searchDestinations, nearestParking } from "../../src/lib/osm.js";

test("where are you going: building search and the closest parking", () => {
  const list = destinations(osm);
  assert.deepEqual(list.map((d) => d.name), ["Courtyard Hall", "Library"], "named buildings, no garages");
  assert.equal(searchDestinations(list, "lib")[0].name, "Library");
  assert.equal(searchDestinations(list, "hall court")[0].name, "Courtyard Hall", "words in any order");
  assert.equal(searchDestinations(list, "zzz").length, 0);
  const lib = list.find((d) => d.name === "Library");
  const near = nearestParking(osm, lib, 2);
  // Library x 0..60; Lot 5 ends at x -60 (60 m away), Structure 2 starts at 160 (100 m away).
  assert.equal(near[0].lot.name, "Lot 5");
  assert.ok(Math.abs(near[0].distance - 60) <= 1, `${near[0].distance}`);
  assert.equal(near[1].lot.name, "Structure 2");
  assert.ok(near[0].walkMeters >= near[0].distance && near[0].walkMinutes >= 1);
  assert.ok(Math.abs(near[0].from.x - -60) < 1 && Math.abs(near[0].to.x) < 1, "the walk goes edge to edge");
});

test("closest parking: lots a visitor may use come first", () => {
  const lib = destinations(osm).find((d) => d.name === "Library");
  const permitLot = { ...osm.parking.find((p) => p.name === "Lot 5"), access: "permit", id: "x" };
  const custLot = { ...osm.parking.find((p) => p.name === "Structure 2"), access: "customers", id: "y" };
  const o2 = { ...osm, parking: [permitLot, custLot] };
  assert.equal(nearestParking(o2, lib, 2, { permit: false })[0].lot.id, "y", "no permit: the customers lot before the permit lot");
  assert.equal(nearestParking(o2, lib, 2, { permit: true })[0].lot.id, "x", "with a permit: the closest");
});

import { photonToPlaces, limitBounds, osmToElements } from "../../src/lib/osm.js";

test("place search: suggestions with names, places, types and outlines", () => {
  const json = JSON.parse(fs.readFileSync(new URL("../fixtures/photon-henry-ford.json", import.meta.url)));
  const places = photonToPlaces(json);
  assert.equal(places[0].name, "Henry Ford Hospital");
  assert.match(places[0].detail, /Detroit, Michigan/);
  assert.equal(places[0].kind, "hospital");
  assert.ok(places[0].bounds.maxlat > places[0].bounds.minlat && places[0].bounds.maxlon > places[0].bounds.minlon);
  assert.equal(places[places.length - 1].kind, "bicycle rental", "points without an outline come last");
  assert.ok(places.at(-1).bounds.maxlat - places.at(-1).bounds.minlat > 0.005, "a point gets an area around it");
});

test("large places are cut to their middle 3 x 3 km", () => {
  const city = { minlat: 42.2, maxlat: 42.5, minlon: -83.3, maxlon: -82.9 };
  const { bounds, limited } = limitBounds(city);
  assert.ok(limited);
  assert.ok(Math.abs((bounds.maxlat - bounds.minlat) * 111320 - 3000) < 5);
  assert.ok(Math.abs((bounds.minlat + bounds.maxlat) / 2 - 42.35) < 1e-9, "centred");
  assert.equal(limitBounds({ minlat: 42.35, maxlat: 42.36, minlon: -83.07, maxlon: -83.06 }).limited, false);
});

test("openstreetmap.org data (fall-back) becomes the same elements", () => {
  const nodes = new Map([["1", { lat: 42.0, lon: -83.0, tags: {} }], ["2", { lat: 42.0, lon: -82.999, tags: {} }], ["3", { lat: 42.001, lon: -82.999, tags: {} }], ["4", { lat: 42.0005, lon: -83.0005, tags: { natural: "tree" } }]]);
  const ways = new Map([["10", { refs: ["1", "2", "3", "1"], tags: { building: "yes", "building:levels": "2" } }], ["11", { refs: ["1", "2"], tags: {} }]]);
  const { elements } = osmToElements(nodes, ways, new Map());
  assert.equal(elements.filter((e) => e.type === "way").length, 1, "untagged ways are only parts of others");
  const bounds = { minlat: 41.999, maxlat: 42.002, minlon: -83.002, maxlon: -82.998 };
  const osm = parseOsm({ elements }, bounds);
  assert.equal(osm.buildings.length, 1);
  assert.equal(osm.trees.length, 1);
});
