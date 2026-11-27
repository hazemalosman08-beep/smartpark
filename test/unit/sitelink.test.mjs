import test from "node:test";
import assert from "node:assert/strict";
import { applyHomography, homographyFromPoints } from "../../src/lib/vision/geometry.js";
import { fitHomography, linkError, makeLink, cameraView, applyCameraEdit, cameraLotToSiteLot } from "../../src/lib/vision/siteLink.js";
import { deriveLot, makeStallRow } from "../../src/lib/vision/lot.js";

// A "true" camera: site % -> camera % is a perspective view (tilted camera).
const camQuad = [{ x: 20, y: 30 }, { x: 80, y: 30 }, { x: 98, y: 95 }, { x: 2, y: 95 }];
const siteQuad = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }];
const siteToCam = homographyFromPoints(siteQuad, camQuad);
const camToSite = homographyFromPoints(camQuad, siteQuad);

test("fit: 6 noisy point pairs recover the camera-to-site transform", () => {
  const sitePts = [{ x: 25, y: 25 }, { x: 75, y: 22 }, { x: 78, y: 78 }, { x: 22, y: 75 }, { x: 50, y: 50 }, { x: 40, y: 65 }];
  const pairs = sitePts.map((s, i) => { const c = applyHomography(siteToCam, s); return { from: { x: c.x + (i % 2 ? 0.1 : -0.1), y: c.y }, to: s }; });
  const H = fitHomography(pairs);
  assert.ok(linkError(H, pairs) < 0.3, `error ${linkError(H, pairs)}`);
  const probe = applyHomography(H, applyHomography(siteToCam, { x: 60, y: 40 }));
  assert.ok(Math.hypot(probe.x - 60, probe.y - 40) < 0.5);
  assert.equal(fitHomography(pairs.slice(0, 3)), null, "needs four");
});

const siteCal = {
  version: 2, view: "overhead", aspect: 1.5, lanes: [], buildings: [], footprints: [],
  stalls: [
    ...makeStallRow([{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 30 }, { x: 30, y: 30 }], 4, "A"),
    // A row outside the camera's view.
    ...makeStallRow([{ x: 30, y: 98 }, { x: 70, y: 98 }, { x: 70, y: 120 }, { x: 30, y: 120 }], 4, "B"),
  ],
  entrance: { x: 50, y: 60 },
};
const pairs = siteQuad.map((s, i) => ({ from: camQuad[i], to: s }));
const link = makeLink(pairs, { cameraAspect: 16 / 9, view: "angled" });

test("camera view: only the spaces the camera sees, with the site's ids", () => {
  const cam = cameraView(siteCal, link);
  assert.deepEqual(cam.stalls.map((s) => s.row), ["A", "A", "A", "A"]);
  assert.equal(cam.view, "overhead", "this camera barely squashes depth: seen from high up");
  const back = applyHomography(link.H, cam.stalls[0].poly[0]);
  assert.ok(Math.hypot(back.x - siteCal.stalls[0].poly[0].x, back.y - siteCal.stalls[0].poly[0].y) < 0.05);
  assert.ok(cam.entrance);
});

test("edits in the camera view land on the site map", () => {
  const before = cameraView(siteCal, link);
  const after = {
    ...before,
    stalls: [
      ...before.stalls.filter((s) => s.id !== before.stalls[1].id).map((s, i) => (i === 0 ? { ...s, kind: "accessible" } : s)),
      { id: "new-1", row: "C", index: 1, label: "C1", poly: [{ x: 40, y: 60 }, { x: 50, y: 60 }, { x: 50, y: 70 }, { x: 40, y: 70 }] },
    ],
    aspect: 1.333,
  };
  const r = applyCameraEdit(siteCal, link, before, after);
  assert.equal(r.site.stalls.length, siteCal.stalls.length, "one removed, one added");
  assert.ok(!r.site.stalls.some((s) => s.id === before.stalls[1].id));
  assert.equal(r.site.stalls.find((s) => s.id === before.stalls[0].id).kind, "accessible");
  assert.ok(r.site.stalls.some((s) => s.row === "B"), "spaces the camera does not see are kept");
  const c1 = r.site.stalls.find((s) => s.id === "new-1");
  const expect = applyHomography(camToSite, { x: 40, y: 60 });
  assert.ok(Math.hypot(c1.poly[0].x - expect.x, c1.poly[0].y - expect.y) < 0.1, "drawn into the site through the link");
  assert.equal(r.link.cameraAspect, 1.333);
});

test("a car seen by the camera is placed on the site plan", () => {
  const camLot = deriveLot(cameraView(siteCal, link));
  const siteLot = deriveLot(siteCal);
  const camPct = applyHomography(siteToCam, { x: 45, y: 35 });
  const ground = camLot.toLot(camPct);
  const s = cameraLotToSiteLot(camLot, siteLot, link, ground);
  const expect = siteLot.toLot({ x: 45, y: 35 });
  assert.ok(Math.hypot(s.x - expect.x, s.y - expect.y) < 0.1);
});

test("camera tilt from the link: steep camera -> overhead, low camera -> angled", () => {
  const steep = makeLink(siteQuad.map((sq, i) => ({ from: [{ x: 22, y: 22 }, { x: 78, y: 22 }, { x: 80, y: 80 }, { x: 20, y: 80 }][i], to: sq })), { cameraAspect: 1.5 });
  const low = makeLink(siteQuad.map((sq, i) => ({ from: [{ x: 42, y: 72 }, { x: 58, y: 72 }, { x: 99, y: 92 }, { x: 1, y: 92 }][i], to: sq })), { cameraAspect: 1.5 });
  assert.equal(cameraView(siteCal, steep).view, "overhead");
  assert.equal(cameraView(siteCal, low).view, "angled");
  assert.equal(cameraView(siteCal, { ...low, view: "overhead", viewManual: true }).view, "overhead", "a choice by hand wins");
});
