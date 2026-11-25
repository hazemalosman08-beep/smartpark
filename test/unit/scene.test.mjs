import test from "node:test";
import assert from "node:assert/strict";
import { stylizePixels } from "../../src/lib/vision/sceneStyle.js";

// A picture of four surfaces: grass, asphalt, brick building, outside-of-picture.
test("scene map: each surface keeps its own look, from the picture alone", () => {
  const W = 40, H = 40, data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, [r, g, b, a = 255]) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (x < 20 && y < 20) put(x, y, [70, 120, 60]); // grass
    else if (x >= 20 && y < 20) put(x, y, [110, 112, 115]); // asphalt
    else if (x < 20) put(x, y, [150, 70, 55]); // brick
    else put(x, y, [0, 0, 0, 0]); // outside
  }
  const out = stylizePixels(data, W, H);
  const at = (x, y) => [...out.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
  const [gr, gg, gb] = at(8, 8), [ar, ag, ab] = at(30, 8), [br, bg, bb] = at(8, 30), [nr, ng, nb] = at(30, 30);
  assert.ok(gg > gr && gg > gb, "grass is green");
  assert.ok(Math.abs(ar - ag) < 20 && ab >= ar, "asphalt is a neutral/cool grey");
  assert.ok(br > bg && br > bb, "brick keeps its red hue");
  assert.ok(nr + ng + nb < 60, "outside the picture is background");
});

import { classifyScene } from "../../src/lib/vision/sceneStyle.js";
import { sceneFeatures } from "../../src/lib/vision/sceneFeatures.js";

// Asphalt picture with a striped brick building (brick + dark windows) and a
// long, thin mulch strip: only the building is a building.
test("buildings: a large, thick built area is found; a thin planted strip is not", () => {
  const W = 300, H = 200, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    let c = [112, 114, 117]; // asphalt
    if (x >= 200 && x < 260 && y >= 40 && y < 180) c = (x % 8 < 5) ? [150, 72, 55] : [60, 60, 64]; // brick + windows
    if (y >= 10 && y < 16 && x >= 20 && x < 180) c = [120, 90, 55]; // mulch strip
    const i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  const { cls } = classifyScene(data, W, H);
  // Spaces 10 px wide (lot units = pixels here), away from both.
  const stalls = [0, 1, 2, 3, 4].map((k) => ({ poly: [{ x: 30 + k * 10, y: 120 }, { x: 40 + k * 10, y: 120 }, { x: 40 + k * 10, y: 100 }, { x: 30 + k * 10, y: 100 }] }));
  const f = sceneFeatures({ W, H, cls }, { x: 0, y: 0, w: W, h: H }, stalls);
  assert.equal(f.buildings.length, 1, "one building");
  const xs = f.buildings[0].outer.map((p) => p.x);
  assert.ok(Math.min(...xs) > 185 && Math.max(...xs) < 275, "in the right place");
  assert.ok(f.obstacle({ x: 230, y: 110 }), "not drivable");
  assert.ok(!f.obstacle({ x: 100, y: 60 }), "the lot is drivable");
});
