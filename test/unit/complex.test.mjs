import test from "node:test";
import assert from "node:assert/strict";
import { homographyFromPoints, applyHomography } from "../../src/lib/vision/geometry.js";
import { makeLink } from "../../src/lib/vision/siteLink.js";
import { makeStallRow } from "../../src/lib/vision/lot.js";
import { newCamera, complexCalibration, complexStatuses, areaCounts, splitId, SNAPSHOT_MAX_AGE_MS } from "../../src/lib/complex.js";

// Two cameras, each watching its own lot, placed on one satellite picture.
const camQuad = [{ x: 20, y: 30 }, { x: 80, y: 30 }, { x: 98, y: 95 }, { x: 2, y: 95 }];
const placeA = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }];
const placeB = [{ x: 60, y: 60 }, { x: 90, y: 60 }, { x: 90, y: 90 }, { x: 60, y: 90 }];
const lotRow = makeStallRow([{ x: 20, y: 80 }, { x: 80, y: 80 }, { x: 70, y: 50 }, { x: 30, y: 50 }], 5, "A");

function camera(name, place) {
  const c = newCamera(name, { stalls: lotRow, entrance: { x: 50, y: 95 } });
  c.link = makeLink(camQuad.map((p, i) => ({ from: p, to: place[i] })));
  return c;
}

test("complex: each camera's lot is placed on the satellite picture through its link", () => {
  const a = camera("North", placeA), b = camera("South", placeB);
  const complex = { aspect: 1.5, cameras: [a, b, newCamera("Unlinked")] };
  const { calibration, areas } = complexCalibration(complex);
  assert.equal(calibration.stalls.length, 10, "unlinked cameras add nothing");
  const H = homographyFromPoints(camQuad, placeA);
  const want = applyHomography(H, lotRow[0].poly[0]);
  assert.ok(Math.hypot(calibration.stalls[0].poly[0].x - want.x, calibration.stalls[0].poly[0].y - want.y) < 0.05);
  assert.ok(calibration.stalls[0].label.startsWith("North "), "labels name the lot");
  assert.equal(areas.length, 2);
  assert.ok(areas[1].x > 60 && areas[1].y > 60, "South lot is where its link puts it");
  assert.deepEqual(splitId(calibration.stalls[0].id), [a.id, lotRow[0].id]);
});

test("complex: live readings for the running camera, recent ones for others, else unknown", () => {
  const now = 1_000_000_000;
  const a = camera("North", placeA), b = camera("South", placeB), c = camera("East", placeB);
  b.snapshot = { at: now - 60_000, statuses: [[lotRow[0].id, { status: "occupied" }], [lotRow[1].id, { status: "free" }]] };
  c.snapshot = { at: now - SNAPSHOT_MAX_AGE_MS - 1, statuses: [[lotRow[0].id, { status: "occupied" }]] };
  const complex = { cameras: [a, b, c] };
  const { calibration, areas } = complexCalibration(complex);
  const live = { cameraId: a.id, statuses: new Map(lotRow.map((s, i) => [s.id, { status: i < 2 ? "occupied" : "free" }])) };
  const { statuses, sources } = complexStatuses(complex, calibration, live, now);
  assert.equal(sources[a.id].kind, "live");
  assert.equal(sources[b.id].kind, "recent");
  assert.equal(sources[c.id].kind, "none", "a stale reading is not shown as current");
  const counts = areaCounts(areas, statuses);
  assert.deepEqual(counts.map((x) => [x.taken, x.open, x.unknown]), [[2, 3, 0], [1, 1, 3], [0, 0, 5]]);
});
