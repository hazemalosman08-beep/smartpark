import test from "node:test";
import assert from "node:assert/strict";
import { autoLink } from "../../src/lib/feedMatch.js";

// Satellite: an irregular lot (rows of different lengths and offsets), spaces 2 x 4 (% units, aspect 1).
const sq = (id, x, y, w = 2, h = 4) => ({ id, poly: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const aerial = { aspect: 1, stalls: [] };
const rows = [[10, 10, 12], [14, 20, 7], [8, 30, 15], [20, 40, 5]];
rows.forEach(([x0, y, n], r) => { for (let i = 0; i < n; i += 1) aerial.stalls.push(sq(`s${r}-${i}`, x0 + i * 2, y)); });

// Camera: the same spaces seen turned a quarter, 3x bigger, shifted (no lot corners: plan = camera %).
function cameraOf(keep) {
  const stalls = [];
  for (const s of aerial.stalls.filter(keep)) {
    const poly = s.poly.map((p) => ({ x: 90 - 3 * (p.y - 5) * 0.6, y: 3 * (p.x - 5) * 0.6 }));
    // keep front edge first: after the turn the front edge is still poly[0]->poly[1]
    stalls.push({ id: `c-${s.id}`, poly });
  }
  return { aspect: 1, stalls };
}

const apply = (H, p) => { const w = H[6] * p.x + H[7] * p.y + H[8]; return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }; };

test("camera spaces matched to the satellite's automatically (turned, scaled, shifted)", () => {
  const camera = cameraOf((s) => s.id.startsWith("s1-") || s.id.startsWith("s2-"));
  const r = autoLink(camera, aerial);
  assert.ok(r, "a match");
  assert.equal(r.matched, r.total);
  for (const [cid, aid] of r.pairs) assert.equal(cid, `c-${aid}`);
  const c = camera.stalls[0].poly[0];
  const p = apply(r.H, c);
  assert.ok(Math.abs(p.x - aerial.stalls.find((s) => `c-${s.id}` === camera.stalls[0].id).poly[0].x) < 0.6);
});

test("an anchor (one space clicked in both) fixes the match", () => {
  const camera = cameraOf((s) => s.id.startsWith("s2-") && Number(s.id.split("-")[1]) < 6); // part of a long uniform row: ambiguous
  const r = autoLink(camera, aerial, { anchor: { cameraId: "c-s2-0", aerialId: "s2-0" } });
  for (const [cid, aid] of r.pairs) assert.equal(cid, `c-${aid}`);
});
