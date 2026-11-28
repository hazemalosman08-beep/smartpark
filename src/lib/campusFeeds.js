// Live feeds on a campus: the complex's staff attach a camera to a parking
// lot of the 3D map. The camera is set up like any SmartPark camera (its
// lot mapped space by space in the Camera tab); its readings give that
// lot's free spaces on the Campus map.
//
// Kept on this device (not cleared when the app starts clean). For now one
// camera runs at a time in this browser; the others show their last reading
// until it is too old. (A SmartPark server running every camera comes later.)
import { pictureStore } from "./photoStore.js";

const KEY = "smartpark-campus-feeds-v1";
export const READING_MAX_AGE_MS = 15 * 60 * 1000;
export const feedPictures = pictureStore("smartpark-feeds");

export function loadFeeds() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveFeeds(feeds) {
  try { localStorage.setItem(KEY, JSON.stringify(feeds)); } catch { /* storage full or blocked */ }
}

/** One key per place (its name and where it is), so feeds stay with it. */
export function placeKey(osm) {
  const b = osm?.bounds;
  if (!b) return osm?.name || "";
  return `${osm.name || ""}@${((b.minlat + b.maxlat) / 2).toFixed(3)},${((b.minlon + b.maxlon) / 2).toFixed(3)}`;
}

export function newFeed(osm, lot) {
  return {
    id: `feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    place: placeKey(osm), placeName: osm.name || "", lotId: lot.id, lotName: lot.name || "",
    calibration: null, reading: null, createdAt: new Date().toISOString(),
  };
}

/**
 * A reading from the camera's space statuses (Map stallId -> { status }):
 * free / occupied / unknown counts over the mapped spaces.
 */
export function readingFrom(calibration, statuses, at = Date.now()) {
  const stalls = calibration?.stalls || [];
  let occupied = 0, unknown = 0;
  for (const s of stalls) {
    const st = statuses?.get(s.id)?.status;
    if (st === "occupied") occupied += 1;
    else if (st !== "free") unknown += 1;
  }
  // Each space's status too (o / f / u), for the lot's own 3D view.
  const spaces = stalls.map((s) => [s.id, ({ occupied: "o", free: "f" })[statuses?.get(s.id)?.status] || "u"]);
  return { at, total: stalls.length, occupied, unknown, free: stalls.length - occupied - unknown, spaces };
}

/**
 * Feeds of one place -> occupancy per lot (as the Campus map shows it):
 * Map lotId -> { free, total, live: true, at, stale }.
 */
export function feedOccupancy(feeds, key, now = Date.now()) {
  const out = new Map();
  for (const f of feeds) {
    if (f.place !== key || !f.reading?.total) continue;
    const stale = now - f.reading.at > READING_MAX_AGE_MS;
    out.set(f.lotId, { free: f.reading.free, total: f.reading.total, unknownCount: f.reading.unknown, live: true, at: f.reading.at, stale, feedId: f.id });
  }
  return out;
}

/** A feed's per-space statuses as the lot views read them: Map id -> { status }. */
export function feedStatuses(feed) {
  const m = new Map();
  for (const [id, c] of feed?.reading?.spaces || []) m.set(id, { status: c === "o" ? "occupied" : c === "f" ? "free" : "unknown", confidence: 1, vehicle_id: "" });
  return m;
}
