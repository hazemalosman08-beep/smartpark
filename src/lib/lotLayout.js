// The mapped lot is saved so the driver view (Find my car) can draw the same plan
// the operator calibrated, without needing the camera.
//
// Stored JSON:
//   calibration — the full lot map in camera space (stalls, lanes, entrance, exit,
//                 ground plane); the operator screen restores it from here
//   spots / streets / entrance — a flattened top-down plan in 0-100 %, kept for
//                 the Find-my-car map
import { base44 } from "@/api/base44Client";
import { deriveLot, normalizeCalibration } from "@/lib/vision/lot";

const NAME = "Main lot";
const LOCAL_KEY = "smartpark-calibration-v2";

export function loadLocalCalibration() {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? normalizeCalibration(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocalCalibration(calibration) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(calibration));
  } catch {
    // Storage can be unavailable (private mode); the server copy still exists.
  }
}

// Lot space -> 0-100 % of the plan bounds.
function flatten(calibration) {
  const lot = deriveLot(calibration);
  const b = lot.bounds;
  const pct = (p) => ({ x: Math.round(((p.x - b.x) / b.w) * 1000) / 10, y: Math.round(((p.y - b.y) / b.h) * 1000) / 10 });
  const spots = lot.stalls.map((s) => ({ label: s.label, ...pct(s.centroid) }));
  const streets = lot.lanes.flatMap((lane) =>
    lane.points.slice(1).map((p, i) => {
      const a = pct(lane.points[i]);
      const c = pct(p);
      const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y);
      return { x: x - 1, y: y - 1, w: Math.abs(c.x - a.x) + 2, h: Math.abs(c.y - a.y) + 2 };
    })
  );
  return { spots, streets, zones: [], entrance: lot.entrance ? pct(lot.entrance) : null };
}

export async function saveLotLayout(calibration) {
  const cal = normalizeCalibration(calibration);
  const layout = { ...flatten(cal), calibration: cal };
  const payload = {
    name: NAME,
    layout: JSON.stringify(layout),
    spot_count: layout.spots.length,
    zone_count: 0,
  };
  const existing = await base44.entities.LotLayout.filter({ name: NAME }, { limit: 1 });
  const current = existing.items?.[0];
  if (current) return base44.entities.LotLayout.update(current.id, payload);
  return base44.entities.LotLayout.create(payload);
}

export async function loadLotLayout() {
  const page = await base44.entities.LotLayout.filter({ name: NAME }, { limit: 1 });
  const record = page.items?.[0];
  if (!record?.layout) return null;
  try {
    const parsed = JSON.parse(record.layout);
    return {
      spots: Array.isArray(parsed.spots) ? parsed.spots : [],
      streets: Array.isArray(parsed.streets) ? parsed.streets : [],
      zones: Array.isArray(parsed.zones) ? parsed.zones : [],
      entrance: parsed.entrance || null,
      calibration: parsed.calibration ? normalizeCalibration(parsed.calibration) : null,
    };
  } catch {
    return null;
  }
}
