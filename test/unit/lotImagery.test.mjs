import test from "node:test";
import assert from "node:assert/strict";
import { imageryBox, toLatLon, toPixel } from "../../src/lib/lotImagery.js";

test("web-mercator pixels and back", () => {
  const p = toPixel(42.3538, -83.0756, 19);
  const q = toLatLon(p.x, p.y, 19);
  assert.ok(Math.abs(q.lat - 42.3538) < 1e-9 && Math.abs(q.lon + 83.0756) < 1e-9);
});

test("a lot's image box: highest zoom that stays within the tile budget", () => {
  const lot = [{ lat: 42.353174, lon: -83.076912 }, { lat: 42.3545985, lon: -83.0743565 }];
  const b = imageryBox(lot);
  assert.equal(b.z, 19);
  const big = [{ lat: 42.3, lon: -83.1 }, { lat: 42.35, lon: -83.0 }];
  assert.ok(imageryBox(big).z < 17);
});
