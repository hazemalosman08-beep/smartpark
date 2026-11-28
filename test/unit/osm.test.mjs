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
  assert.deepEqual(parkingSummary(osm), { onSite: 2, lots: 2, garages: 1, surface: 1, capacity: 920, withCapacity: 2 });
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
  assert.equal(places[0].detail, "2799 West Grand Boulevard, Detroit, MI 48202, United States", "full address");
  assert.equal(places.find((p) => /Rochester/.test(p.name)).detail, "1101 West University Drive, Rochester Hills, MI 48307, United States");
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

test("race: a hung source does not hold up the next, and the loser is cancelled", async () => {
  const { race } = await import("../../src/lib/osm.js");
  let cancelled = false;
  const hung = (signal) => new Promise((_, rej) => signal.addEventListener("abort", () => { cancelled = true; rej(new DOMException("a", "AbortError")); }));
  const t0 = Date.now();
  const v = await race([{ run: hung }, { after: 50, run: async () => "second" }]);
  assert.equal(v, "second");
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(cancelled, "the hung request is aborted");
});

test("race: a failure starts the next source at once; all failing gives the real error", async () => {
  const { race } = await import("../../src/lib/osm.js");
  const t0 = Date.now();
  const v = await race([{ run: async () => { throw new Error("busy (429)"); } }, { after: 60000, run: async () => "fallback" }]);
  assert.equal(v, "fallback");
  assert.ok(Date.now() - t0 < 1000, "did not wait for the head start");
  await assert.rejects(race([{ run: async () => { throw new Error("busy (504)"); } }, { after: 10, run: async () => { throw new TypeError("Failed to fetch"); } }]), /busy \(504\)/);
});

test("complex outline: buildings inside count, the neighbourhood does not; points and addresses name buildings", async () => {
  const { parseOsm, buildingCounts, destinations, searchDestinations } = await import("../../src/lib/osm.js");
  const sq = (lat, lon, d = 0.0002) => [{ lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon }];
  const data = { elements: [
    { type: "way", id: 1, tags: { building: "university", name: "Old Main" }, geometry: sq(42.000, -83.000) },
    { type: "way", id: 2, tags: { building: "yes" }, geometry: sq(42.001, -83.000) }, // named by a point inside
    { type: "node", id: 9, lat: 42.0011, lon: -82.9999, tags: { amenity: "library", name: "Science Library" } },
    { type: "way", id: 3, tags: { building: "yes", "addr:housenumber": "5050", "addr:street": "Cass Avenue" }, geometry: sq(42.002, -83.000) },
    { type: "way", id: 4, tags: { building: "shed" }, geometry: sq(42.0025, -83.000, 0.00005) },
    { type: "way", id: 5, tags: { building: "house", name: "Smith House" }, geometry: sq(42.010, -83.010) }, // outside
    { type: "way", id: 6, tags: { building: "house" }, geometry: sq(42.011, -83.010) }, // outside
  ] };
  const outline = { type: "way", id: 100, tags: { amenity: "university", name: "Test U" }, geometry: sq(41.999, -83.001, 0.005) };
  const bounds = { minlat: 41.99, maxlat: 42.02, minlon: -83.02, maxlon: -82.99 };
  const osm = parseOsm(data, bounds, { outline });
  assert.equal(osm.outline.length, 1);
  assert.deepEqual(buildingCounts(osm), { complex: 3, named: 2, around: 2, hasOutline: true }, "the shed is not a building people go to");
  const lib = osm.buildings.find((b) => b.id === "way/2");
  assert.equal(lib.name, "Science Library");
  assert.equal(lib.nameFrom, "place");
  const list = destinations(osm);
  assert.deepEqual(list.map((d) => d.name), ["Old Main", "Science Library", "Smith House", "5050 Cass Avenue"]);
  assert.equal(list.find((d) => d.name === "5050 Cass Avenue").byAddress, true);
  assert.equal(searchDestinations(list, "cass")[0].name, "5050 Cass Avenue");
  // No outline (a point place): every building in view counts.
  assert.deepEqual(buildingCounts(parseOsm(data, bounds)), { complex: 5, named: 3, around: 0, hasOutline: false });
});

test("photon results keep the OSM object (for the outline)", async () => {
  const { photonToPlaces } = await import("../../src/lib/osm.js");
  const places = photonToPlaces(JSON.parse(fs.readFileSync(new URL("../fixtures/photon-henry-ford.json", import.meta.url))));
  assert.ok(places[0].osm && /^(way|relation|node)$/.test(places[0].osm.type) && places[0].osm.id > 0);
});

test("interiorPoint: inside a U-shaped building (its average corner is not)", async () => {
  const { interiorPoint } = await import("../../src/lib/osm.js");
  const U = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 30 }, { x: 0, y: 30 }];
  const p = interiorPoint(U);
  const inU = (p.y < 8 && p.x > 0 && p.x < 30) || (p.y >= 8 && p.y < 30 && ((p.x > 0 && p.x < 10) || (p.x > 20 && p.x < 30)));
  assert.ok(inU, JSON.stringify(p));
});

test("a single building as the place: its site area becomes the complex; only green land is green", async () => {
  const { parseOsm, buildingCounts } = await import("../../src/lib/osm.js");
  const sq = (lat, lon, d) => [{ lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon }];
  const mosque = { type: "way", id: 7, tags: { building: "mosque", amenity: "place_of_worship", name: "Mosque" }, geometry: sq(41.9998, -83.0002, 0.0004) };
  const data = { elements: [
    mosque,
    { type: "way", id: 8, tags: { landuse: "religious" }, geometry: sq(41.999, -83.001, 0.002) }, // the grounds
    { type: "way", id: 9, tags: { building: "yes", name: "Hall" }, geometry: sq(42.0005, -82.9995, 0.0002) }, // on the grounds
    { type: "way", id: 10, tags: { building: "house" }, geometry: sq(42.003, -82.997, 0.0002) }, // next door
    { type: "way", id: 11, tags: { landuse: "residential" }, geometry: sq(41.99, -83.01, 0.02) },
    { type: "way", id: 12, tags: { leisure: "park" }, geometry: sq(42.002, -83.003, 0.0005) },
  ] };
  const bounds = { minlat: 41.9998, maxlat: 42.0002, minlon: -83.0002, maxlon: -82.9998 };
  const osm = parseOsm(data, bounds, { outline: mosque });
  assert.deepEqual(buildingCounts(osm), { complex: 2, named: 2, around: 1, hasOutline: true });
  assert.equal(osm.green.length, 1, "the park is green; residential and religious land are not");
});

test("limitBounds: a single building gets at least 600 m around it", async () => {
  const { limitBounds } = await import("../../src/lib/osm.js");
  const { bounds, limited } = limitBounds({ minlat: 42.4986, maxlat: 42.4993, minlon: -83.4018, maxlon: -83.4006 });
  assert.equal(limited, false);
  assert.ok(Math.abs((bounds.maxlat - bounds.minlat) * 111320 - 600) < 1);
});
