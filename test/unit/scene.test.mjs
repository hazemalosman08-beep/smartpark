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
