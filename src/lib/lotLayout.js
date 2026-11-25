// The mapped lot (stalls, lanes, entrance/exit, lot corners) is saved on this
// device, so it is still there next time the app opens. The Find-my-car page
// reads a flattened top-down version of it.
import { deriveLot, normalizeCalibration } from "@/lib/vision/lot";

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

// The flattened top-down plan used by the Find-my-car page (same device).
export async function loadLotLayout() {
  const calibration = loadLocalCalibration();
  if (!calibration?.stalls?.length) return null;
  return { ...flatten(calibration), calibration };
}
