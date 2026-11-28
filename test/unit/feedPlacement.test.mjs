import test from "node:test";
import assert from "node:assert/strict";
import { orientedRect, placementFor, pointToPolygon, toCampus } from "../../src/lib/feedPlacement.js";

const stall = (x, y, w, h) => ({ poly: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });

test("a camera's lot plan lands inside the lot, along its long side, at real size", () => {
  // Plan: a row of 10 spaces, 4 units wide, 8 deep (long side along x).
  const stalls = Array.from({ length: 10 }, (_, i) => stall(i * 4, 0, 4, 8));
  // The lot on the campus map: 60 m x 20 m, long side north-south (y).
  const lot = [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 100, y: 60 }];
  const pl = placementFor(stalls, lot);
  assert.ok(Math.abs(pl.scale - 2.5 / 4) < 1e-9, "a space is 2.5 m wide");
  const pts = stalls.flatMap((s) => s.poly.map((p) => toCampus(p, pl)));
  for (const p of pts) assert.ok(p.x >= 99.9 && p.x <= 120.1 && p.y >= -0.1 && p.y <= 60.1, JSON.stringify(p));
  const r = orientedRect(pts);
  assert.ok(Math.abs(Math.abs(Math.cos(r.angle))) < 1e-6, "the row runs north-south, like the lot");
  // Staff adjustments: a quarter turn and a move.
  const turned = placementFor(stalls, lot, { rot: 1, dx: 5 });
  assert.ok(Math.abs(turned.angle - pl.angle - Math.PI / 2) < 1e-9 && turned.cx === pl.cx + 5);
});

test("too big for the lot: shrunk to fit", () => {
  const stalls = Array.from({ length: 40 }, (_, i) => stall(i * 4, 0, 4, 8));
  const lot = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 20 }, { x: 0, y: 20 }];
  const pl = placementFor(stalls, lot);
  assert.ok(pl.scale < 2.5 / 4 && Math.abs(pl.scale * 160 - 50) < 1e-6);
});

test("point to polygon", () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointToPolygon({ x: 5, y: 5 }, sq).d, 0);
  const o = pointToPolygon({ x: 13, y: 5 }, sq);
  assert.equal(o.d, 3);
  assert.deepEqual(o.at, { x: 10, y: 5 });
});

test("a satellite picture of the lot fills the lot's outline exactly", async () => {
  const { placementFor, toCampus } = await import("../../src/lib/feedPlacement.js");
  const lot = [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 100, y: 60 }]; // 20 x 60 m, long north-south
  const pl = placementFor([], lot, {}, { fill: { w: 300, h: 100 } }); // picture 300 x 100 (wide)
  const corners = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 0, y: 100 }].map((p) => toCampus(p, pl));
  const xs = corners.map((p) => Math.round(p.x)), ys = corners.map((p) => Math.round(p.y));
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [100, 120, 0, 60]);
});
