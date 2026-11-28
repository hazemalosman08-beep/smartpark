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
