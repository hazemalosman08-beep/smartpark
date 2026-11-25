import assert from "node:assert/strict";
import * as g from "../../src/lib/vision/geometry.js";

// Hungarian: classic example
const pairs = g.hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
const cost = pairs.reduce((s, [r, c]) => s + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][r][c], 0);
assert.equal(cost, 5);
// rectangular both ways
assert.equal(g.hungarian([[1, 9], [9, 1], [5, 5]]).length, 2);
assert.equal(g.hungarian([[1, 9, 3]]).length, 1);
assert.deepEqual(g.hungarian([[5, 1, 9]]), [[0, 1]]);

// Homography roundtrip
const src = [{ x: 10, y: 20 }, { x: 90, y: 25 }, { x: 95, y: 90 }, { x: 5, y: 80 }];
const dst = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }];
const H = g.homographyFromPoints(src, dst);
src.forEach((p, i) => {
  const q = g.applyHomography(H, p);
  assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
});
const Hi = g.invertHomography(H);
const back = g.applyHomography(Hi, g.applyHomography(H, { x: 40, y: 50 }));
assert.ok(Math.abs(back.x - 40) < 1e-6 && Math.abs(back.y - 50) < 1e-6);

// Polygon clip
const sq = g.boxToPolygon({ x: 0, y: 0, w: 10, h: 10 });
assert.equal(g.polygonOverlapArea(g.boxToPolygon({ x: 5, y: 5, w: 10, h: 10 }), sq), 25);
assert.equal(g.polygonOverlapArea(g.boxToPolygon({ x: 20, y: 20, w: 1, h: 1 }), sq), 0);
assert.equal(g.polygonOverlapArea(sq, [...sq].reverse()), 100);
assert.ok(g.pointInPolygon({ x: 5, y: 5 }, sq));
assert.ok(!g.pointInPolygon({ x: 15, y: 5 }, sq));
console.log("geometry ok");
