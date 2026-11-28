// PREVIEW ONLY: made-up occupancy for every lot of a complex, so the Campus
// map can show what live camera data will look like before any camera is
// connected. Nothing here is measured. The app labels it "simulated"
// wherever it is shown.
//
// Capacity: the lot's mapped capacity, else an estimate from its area
// (about 25 m² per space including aisles; garages times their floors).
// Occupancy: each lot starts at its own fill level and drifts as cars
// arrive and leave.

const M2_PER_SPACE = 25;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) { const q = poly[(i + 1) % poly.length]; a += poly[i].x * q.y - q.x * poly[i].y; }
  return Math.abs(a / 2);
}

export const isGarage = (lot) => /multi|underground|rooftop/.test(lot.kind || "");

/** Spaces in a lot: mapped capacity, else estimated from its size. */
export function estimateCapacity(lot, garageHeight = 0) {
  if (lot.capacity) return { total: lot.capacity, estimated: false };
  const floors = isGarage(lot) ? lot.levels || Math.max(2, Math.round((garageHeight || 9) / 3)) : 1;
  return { total: Math.max(4, Math.round((area(lot.outer) / M2_PER_SPACE) * floors)), estimated: true };
}

/**
 * Start a simulation for the complex's lots (spaces mapped one by one are
 * left out). Returns { lots: Map(id -> state), step(), snapshot() }.
 */
export function createSimulation(osm, { seed = 7 } = {}) {
  const rand = rng(seed);
  const lots = new Map();
  for (const lot of osm.parking) {
    if (lot.space) continue;
    const garage = isGarage(lot) ? osm.buildings.find((b) => b.garage && b.name && b.name === lot.name) : null;
    const { total, estimated } = estimateCapacity(lot, garage?.height);
    // Busy lots and quiet lots, a few nearly full.
    const fill = rand() < 0.2 ? 0.9 + rand() * 0.1 : 0.3 + rand() * 0.6;
    lots.set(lot.id, { total, estimated, occupied: Math.round(total * fill), target: fill, trend: 0 });
  }
  const step = () => {
    for (const s of lots.values()) {
      // The lot's own level wanders slowly; cars come and go around it.
      if (rand() < 0.08) s.target = Math.min(1, Math.max(0.15, s.target + (rand() - 0.5) * 0.4));
      const want = s.target * s.total;
      const churn = Math.max(1, Math.round(s.total * 0.02));
      const delta = Math.round((want - s.occupied) * 0.15 + (rand() - 0.5) * 2 * churn);
      const before = s.occupied;
      s.occupied = Math.min(s.total, Math.max(0, s.occupied + delta));
      s.trend = Math.sign(s.occupied - before);
    }
  };
  const snapshot = () => {
    const out = new Map();
    for (const [id, s] of lots) out.set(id, { total: s.total, free: s.total - s.occupied, estimated: s.estimated, trend: s.trend });
    return out;
  };
  return { lots, step, snapshot };
}

/** Status of a lot from its free spaces: plenty / filling / full. */
export function occupancyLevel(o) {
  if (!o || !o.total) return "unknown";
  const f = o.free / o.total;
  if (o.free === 0) return "full";
  if (f <= 0.1) return "almost";
  if (f <= 0.3) return "filling";
  return "plenty";
}

export const LEVEL_COLOR = { plenty: "#22c55e", filling: "#f59e0b", almost: "#ef4444", full: "#dc2626", unknown: "#64748b" };
