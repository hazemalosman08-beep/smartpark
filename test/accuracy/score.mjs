// Scores the app's parking spaces and occupancy against a hand-labelled truth file.
//   node test/accuracy/score.mjs <truth.json> <app-result.json>
// app-result.json: { stalls: [{id,label,poly:[{x,y}...] in %}], statuses: [[id,{status}]...] }
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const inside = (p, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};

// Overlap of two polygons as intersection-over-union, by sampling (test only).
function polyIoU(a, b) {
  const xs = [...a, ...b].map((p) => p.x), ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let inter = 0, uni = 0;
  const n = 40;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const p = { x: x0 + ((i + 0.5) / n) * (x1 - x0), y: y0 + ((j + 0.5) / n) * (y1 - y0) };
    const ia = inside(p, a), ib = inside(p, b);
    if (ia && ib) inter += 1;
    if (ia || ib) uni += 1;
  }
  return uni ? inter / uni : 0;
}

export function overlappingPairs(stalls, threshold = 0.3) {
  let n = 0;
  for (let i = 0; i < stalls.length; i += 1) for (let j = i + 1; j < stalls.length; j += 1) {
    if (polyIoU(stalls[i].poly, stalls[j].poly) > threshold) n += 1;
  }
  return n;
}

export function score(truth, app) {
  const W = truth.width, H = truth.height;
  const stalls = app.stalls.map((s) => ({ ...s, px: s.poly.map((p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H })) }));
  const status = new Map(app.statuses);
  const covering = truth.spaces.map((t) => stalls.filter((s) => inside(t, s.px)));
  const found = covering.filter((c) => c.length >= 1).length;
  const duplicates = covering.reduce((n, c) => n + Math.max(0, c.length - 1), 0);
  const usedIds = new Set(covering.flat().map((s) => s.id));
  // One app space covering two or more real spaces (too wide, or two rows as one).
  const merged = stalls.filter((s) => truth.spaces.filter((t) => inside(t, s.px)).length > 1).length;
  // Extra: an app space covering no labelled space, but lying inside the labelled
  // rows' area (spaces outside it, e.g. cut off by the picture edge, are ignored).
  const xs = truth.spaces.length ? truth.spaces.map((t) => t.x) : [0], ys = truth.spaces.length ? truth.spaces.map((t) => t.y) : [0];
  const area = { x0: Math.min(...xs) - 20, x1: Math.max(...xs) + 20, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 40 };
  const extra = stalls.filter((s) => {
    if (usedIds.has(s.id)) return false;
    const c = { x: s.px.reduce((a, p) => a + p.x, 0) / s.px.length, y: s.px.reduce((a, p) => a + p.y, 0) / s.px.length };
    return c.x > area.x0 && c.x < area.x1 && c.y > area.y0 && c.y < area.y1;
  }).length;
  let occRight = 0, occChecked = 0;
  const wrong = [];
  truth.spaces.forEach((t, i) => {
    const c = covering[i];
    if (!c.length) return;
    occChecked += 1;
    const appTaken = c.some((s) => status.get(s.id)?.status === "occupied");
    if (appTaken === t.occupied) occRight += 1;
    else wrong.push(`${t.label}:${t.occupied ? "taken→shown open" : "open→shown taken"}`);
  });
  const truthTaken = truth.spaces.filter((t) => t.occupied).length;
  const overlaps = overlappingPairs(app.stalls);
  const appTotal = stalls.length;
  const appTaken = stalls.filter((s) => status.get(s.id)?.status === "occupied").length;
  return {
    spaces: { truth: truth.spaces.length, found, missed: truth.spaces.length - found, duplicates, extra, merged, appTotal, overlaps },
    occupancy: { correct: occRight, checked: occChecked, truthTaken, appTaken, wrong },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const truth = JSON.parse(fs.readFileSync(process.argv[2]));
  const app = JSON.parse(fs.readFileSync(process.argv[3]));
  const r = score(truth, app);
  console.log(JSON.stringify(r, null, 1));
}
