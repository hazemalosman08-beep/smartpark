// One-click lot mapping: painted stall lines + parked cars -> stalls, aisles and
// an entrance, ready for counting and for the top-down plan.
import { findStallsCombined as findStalls } from "./stallFinder.js";
import { dedupeStalls, nextRowLetter, stallsFromVehicles } from "./lot.js";
import { rectify } from "./autoTilt.js";
import { polygonArea, polygonOverlapArea } from "./geometry.js";

/**
 * image: { data, width, height }; vehicles: boxes in % (parked/standing cars);
 * keep: stalls/lanes the user drew by hand (never replaced).
 */
export function autoMapLot({ image, vehicles = [], view = "overhead", ground = null, keepStalls = [], keepLanes = [], entrance = null }) {
  // A tilted camera: find the spaces in the straightened (top-down) picture,
  // where painted lines are parallel again, then map them back.
  const flat = ground ? rectify(image, ground) : null;
  let found;
  if (flat) {
    const r = findStalls(flat.image, { vehicles: vehicles.map(flat.boxToRect) });
    const back = (poly) => poly.map(flat.toCamera).map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
    found = { ...r, stalls: r.stalls.map((st) => ({ ...st, poly: back(st.poly) })), aisles: r.aisles.map((a) => ({ ...a, points: back(a.points) })) };
  } else if (view === "overhead") {
    found = findStalls(image, { vehicles });
  } else {
    // Painted lines are not read from a low side angle without straightening:
    // trees, kerbs and far rows look like stall lines. Parked cars are used.
    found = { stalls: [], aisles: [], debug: { rows: 0 } };
  }
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
  // Sizes are compared on the ground (far spaces look smaller on a tilted camera).
  stalls = dropOddShapes(dedupeStalls([...stalls, ...fromCars]), flat ? (p) => flat.toRect(p) : (p) => p);
  // Spaces partly outside the picture cannot be judged (half the space is not
  // visible); hand-drawn ones are kept.
  stalls = stalls.filter((st) => !st.auto || visibleShare(st.poly) >= 0.85);

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
function dropOddShapes(stalls, project = (p) => p) {
  const len = (a, b) => { const p = project(a), q = project(b); return Math.hypot(p.x - q.x, p.y - q.y); };
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

function visibleShare(poly) {
  const frame = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const total = polygonArea(poly);
  return total ? polygonOverlapArea(poly, frame) / total : 0;
}
