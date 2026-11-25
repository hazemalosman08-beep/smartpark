// One-click lot mapping: painted stall lines + parked cars -> stalls, aisles and
// an entrance, ready for counting and for the top-down plan.
import { findStallsCombined as findStalls } from "./stallFinder.js";
import { dedupeStalls, nextRowLetter, stallsFromVehicles } from "./lot.js";

/**
 * image: { data, width, height }; vehicles: boxes in % (parked/standing cars);
 * keep: stalls/lanes the user drew by hand (never replaced).
 */
export function autoMapLot({ image, vehicles = [], view = "overhead", keepStalls = [], keepLanes = [], entrance = null }) {
  // Painted lines are read from overhead pictures only: from a low side angle
  // trees, kerbs and far rows look like stall lines. Angled cameras use the
  // parked cars (and hand-drawn rows) instead.
  const found = view === "overhead" ? findStalls(image, { vehicles }) : { stalls: [], aisles: [], debug: { rows: 0 } };
  // Painted stalls that clash with a hand-drawn stall are dropped.
  const inside = (p, poly) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  const centre = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
  let stalls = [...keepStalls];
  // Re-letter painted rows after the hand-drawn ones.
  const rename = new Map();
  for (const s of found.stalls) {
    if (keepStalls.some((k) => inside(centre(s.poly), k.poly) || inside(centre(k.poly), s.poly))) continue;
    if (!rename.has(s.row)) rename.set(s.row, nextRowLetter([...stalls, ...[...rename.values()].map((row) => ({ row }))]));
    const row = rename.get(s.row);
    stalls.push({ ...s, row, label: `${row}${s.index}`, id: `${row}${s.index}-${Math.random().toString(36).slice(2, 7)}`, auto: true });
  }
  const painted = stalls.length - keepStalls.length;
  // Cars standing where no painted stall was found (lines hidden under cars).
  const fromCars = stallsFromVehicles(vehicles, view, stalls, { auto: true });
  stalls = dropOddShapes(dedupeStalls([...stalls, ...fromCars]));

  const lanes = [...keepLanes, ...found.aisles.map((a) => ({ ...a, auto: true }))];
  // Entrance guess: the aisle end nearest the bottom of the picture.
  let autoEntrance = entrance;
  if (!entrance && found.aisles.length) {
    const ends = found.aisles.flatMap((a) => [a.points[0], a.points[a.points.length - 1]]);
    const best = ends.reduce((p, q) => (q.y > p.y ? q : p));
    autoEntrance = { x: best.x, y: Math.min(99, best.y), auto: true };
  }
  return { stalls, lanes, entrance: autoEntrance, stats: { painted: stalls.filter((x) => x.auto && !x.learned).length, fromCars: stalls.filter((x) => x.learned).length, rows: found.debug.rows } };
}

// A "space" far smaller or thinner than the lot's normal spaces is a piece of
// kerb or marking, not a parking space. Hand-drawn spaces are always kept.
function dropOddShapes(stalls) {
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const dims = stalls.map((s) => {
    const w = (len(s.poly[0], s.poly[1]) + len(s.poly[3], s.poly[2])) / 2;
    const d = (len(s.poly[0], s.poly[3]) + len(s.poly[1], s.poly[2])) / 2;
    return { short: Math.min(w, d), long: Math.max(w, d) };
  });
  // Painted spaces are compared with each other; spaces inferred from a parked
  // car are car-sized by nature and kept.
  const painted = (s) => s.auto && !s.learned;
  const auto = dims.filter((_, i) => painted(stalls[i]));
  if (auto.length < 5) return stalls;
  const med = (arr) => { const v = [...arr].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const mShort = med(auto.map((d) => d.short)), mLong = med(auto.map((d) => d.long));
  return stalls.filter((s, i) => !painted(s) || (dims[i].short >= mShort * 0.55 && dims[i].long >= mLong * 0.55));
}
