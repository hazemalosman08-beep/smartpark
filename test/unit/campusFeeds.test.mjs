import test from "node:test";
import assert from "node:assert/strict";
import { feedOccupancy, feedStatuses, newFeed, placeKey, readingFrom, READING_MAX_AGE_MS } from "../../src/lib/campusFeeds.js";

test("a feed's reading: free, occupied and unknown spaces of its mapped lot", () => {
  const cal = { stalls: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };
  const st = new Map([["a", { status: "occupied" }], ["b", { status: "free" }], ["c", { status: "unknown" }]]); // d: no reading yet
  const r = readingFrom(cal, st, 5);
  assert.deepEqual({ ...r, spaces: undefined }, { at: 5, total: 4, occupied: 1, unknown: 2, free: 1, spaces: undefined });
  assert.deepEqual(r.spaces, [["a", "o"], ["b", "f"], ["c", "u"], ["d", "u"]]);
  const back = feedStatuses({ reading: r });
  assert.equal(back.get("a").status, "occupied");
  assert.equal(back.get("b").status, "free");
  assert.equal(back.get("d").status, "unknown");
});

test("feeds become the lots' occupancy for their place only; old readings are stale", () => {
  const osm = { name: "Test U", bounds: { minlat: 42, maxlat: 42.01, minlon: -83.01, maxlon: -83 } };
  const f1 = { ...newFeed(osm, { id: "way/1", name: "Lot A" }), reading: { at: 1000, total: 40, free: 12, occupied: 28, unknown: 0 } };
  const f2 = { ...newFeed({ ...osm, name: "Other" }, { id: "way/2" }), reading: { at: 1000, total: 10, free: 1, occupied: 9, unknown: 0 } };
  const occ = feedOccupancy([f1, f2], placeKey(osm), 2000);
  assert.deepEqual([...occ.keys()], ["way/1"]);
  assert.equal(occ.get("way/1").free, 12);
  assert.equal(occ.get("way/1").stale, false);
  assert.equal(feedOccupancy([f1], placeKey(osm), 1000 + READING_MAX_AGE_MS + 1).get("way/1").stale, true);
});

test("camera spaces carried onto the satellite picture's spaces through the link", async () => {
  const { mapToAerial } = await import("../../src/lib/campusFeeds.js");
  const sq = (id, x, y) => ({ id, poly: [{ x, y }, { x: x + 4, y }, { x: x + 4, y: y + 8 }, { x, y: y + 8 }] });
  const aerial = { stalls: [sq("s1", 10, 10), sq("s2", 14, 10), sq("s3", 18, 10)] };
  // Camera picture = satellite picture shifted by (+50, +20).
  const camera = { stalls: [sq("c1", 60, 30), sq("c2", 64, 30)] };
  const link = { H: [1, 0, -50, 0, 1, -20, 0, 0, 1] };
  const st = new Map([["c1", { status: "occupied" }], ["c2", { status: "free" }]]);
  const m = mapToAerial(aerial, camera, link, st);
  assert.equal(m.get("s1").status, "occupied");
  assert.equal(m.get("s2").status, "free");
  assert.equal(m.has("s3"), false, "no camera space lands there: unknown");
});
