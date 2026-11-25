import assert from "node:assert/strict";
import * as L from "../../src/lib/vision/lot.js";
import { createSimulation } from "../../src/lib/vision/simulation.js";
const lot = L.deriveLot(L.sampleCalibration());
const graph = L.buildLaneGraph(lot.lanes);
const sim = createSimulation(lot, graph, { arrivalsPerMinute: 20 });
const counts = {};
let now = 0;
for (let i = 0; i < 3000; i++) {
  now += 100;
  for (const e of sim.step(0.1, now)) counts[e.type] = (counts[e.type] || 0) + 1;
  const st = sim.statuses();
  const occ = [...st.values()].filter((s) => s.status === "occupied").length;
  assert.ok(occ <= lot.stalls.length);
  // no two parked cars in one stall
  const parked = sim.tracks().filter((t) => t.motion === "parked").map((t) => t.spot_label);
  assert.equal(new Set(parked).size, parked.length);
  for (const t of sim.tracks()) assert.ok(Number.isFinite(t.ground.x) && Number.isFinite(t.heading));
}
console.log(counts, "cars now", sim.tracks().length);
assert.ok(counts.entry > 5 && counts.parked > 5 && counts.exit > 5);
console.log("sim ok");
