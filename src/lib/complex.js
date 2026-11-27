// A big complex (campus, hospital, stadium): one satellite / aerial picture of
// the whole place, animated in 3D, with every security camera's lot placed on
// it. Each camera works exactly like a single SmartPark camera (it maps and
// watches its own lot); its link (4+ ground point pairs, camera % -> satellite
// %) places its spaces, cars and occupancy on the complex map.
import { applyHomography } from "./vision/geometry.js";
import { normalizeCalibration, EMPTY_CALIBRATION } from "./vision/lot.js";

const KEY = "smartpark-complex-v1";
// Readings from a camera that is not running are kept for this long, then the
// lot is shown as unknown (gray) rather than with stale numbers.
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export function loadComplex() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveComplex(c) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* blocked */ }
}

let n = 0;
export function newCamera(name, calibration = null) {
  n += 1;
  return {
    id: `cam${Date.now().toString(36)}${n}`,
    name: String(name || "Camera").trim().slice(0, 24) || "Camera",
    calibration: calibration ? normalizeCalibration(calibration) : normalizeCalibration(EMPTY_CALIBRATION),
    link: null, // { pairs, H (camera % -> satellite %), error, cameraAspect }
    snapshot: null, // { statuses: [[stallId, {status}]], at }
  };
}

const SEP = "::";
export const complexId = (camId, stallId) => `${camId}${SEP}${stallId}`;
export const splitId = (id) => { const i = id.indexOf(SEP); return i < 0 ? [null, id] : [id.slice(0, i), id.slice(i + SEP.length)]; };

/**
 * The complex as one SmartPark calibration in satellite %: every linked
 * camera's spaces placed through its link (the active camera's live map is
 * used for it), plus each lot's name, entrance and buildings.
 * active: { id, calibration } for the camera open on the Camera tab.
 */
export function complexCalibration(complex, active = null) {
  const stalls = [];
  const buildings = [];
  let entrance = null;
  const areas = [];
  for (const cam of complex.cameras || []) {
    if (!cam.link?.H) continue;
    const cal = active && cam.id === active.id ? active.calibration : cam.calibration;
    if (!cal) continue;
    const toSite = (p) => { const q = applyHomography(cam.link.H, p); return { x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 }; };
    const prefix = (complex.cameras.filter((c) => c.link?.H).length > 1) ? `${cam.name} ` : "";
    const mine = [];
    for (const s of cal.stalls || []) {
      const st = { ...s, id: complexId(cam.id, s.id), label: `${prefix}${s.label}`, row: `${cam.id}:${s.row}`, camera: cam.id, poly: s.poly.map(toSite) };
      stalls.push(st);
      mine.push(st);
    }
    if (cal.entrance && !entrance) entrance = toSite(cal.entrance);
    for (const b of [cal.building && { ...cal.building, name: cal.building.name || `${cam.name} building` }, ...(cal.buildings || [])].filter(Boolean)) {
      buildings.push({ ...toSite(b), name: b.name || `${cam.name} building`, id: `${cam.id}-${buildings.length}` });
    }
    if (mine.length) {
      const pts = mine.flatMap((s) => s.poly);
      areas.push({ camera: cam.id, name: cam.name, x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length, stallIds: mine.map((s) => s.id) });
    }
  }
  if (complex.entrance) entrance = complex.entrance;
  const [main, ...more] = buildings;
  return {
    calibration: normalizeCalibration({
      version: 2, view: "overhead", aspect: complex.aspect || 1.5, stalls, lanes: [], entrance,
      building: main ? { x: main.x, y: main.y, name: main.name } : null, buildings: more, footprints: [],
    }),
    areas,
  };
}

/**
 * Occupancy of the whole complex: live for the running camera, the last
 * reading for the others (if recent), unknown otherwise. Returns a Map
 * keyed by complex stall id, and per-camera source info.
 */
export function complexStatuses(complex, calibration, live = null, now = Date.now()) {
  const out = new Map();
  const sources = {};
  for (const cam of complex.cameras || []) {
    if (!cam.link?.H) continue;
    let readings = null, kind = "none", at = null;
    if (live && live.cameraId === cam.id && live.statuses?.size) { readings = live.statuses; kind = "live"; at = now; }
    else if (cam.snapshot && now - cam.snapshot.at < SNAPSHOT_MAX_AGE_MS) { readings = new Map(cam.snapshot.statuses); kind = "recent"; at = cam.snapshot.at; }
    sources[cam.id] = { kind, at };
    for (const s of calibration.stalls) {
      if (s.camera !== cam.id) continue;
      const st = readings?.get(splitId(s.id)[1]);
      out.set(s.id, st ? { ...st } : { status: "unknown", confidence: 0 });
    }
  }
  return { statuses: out, sources };
}

/** Per-lot counts for the zoomed-out view. */
export function areaCounts(areas, statuses) {
  return areas.map((a) => {
    let open = 0, taken = 0, unknown = 0;
    for (const id of a.stallIds) {
      const st = statuses.get(id)?.status;
      if (st === "occupied") taken += 1; else if (st === "unknown" || !st) unknown += 1; else open += 1;
    }
    return { ...a, open, taken, unknown, total: a.stallIds.length };
  });
}
