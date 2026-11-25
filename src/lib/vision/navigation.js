// Turn-by-turn guidance along a planned route (lot units in, metres out).
import { dist } from "./geometry.js";

// Typical driving speed inside a parking lot (about 8 km/h).
export const LOT_SPEED_MPS = 2.2;

/**
 * route: points from the driver (or entrance) to the space; the last two
 * points are the space's front and centre (the turn into the space).
 * Returns maneuvers with the distance (m) from the route start where each one happens.
 */
export function buildManeuvers(route, stall, metersPerUnit = 1) {
  if (!route || route.length < 2 || !stall) return [];
  const drive = route.slice(0, Math.max(2, route.length - 2));
  const out = [];
  let along = 0;
  let heading = null;
  for (let i = 1; i < drive.length; i += 1) {
    const a = drive[i - 1], b = drive[i];
    const len = dist(a, b) * metersPerUnit;
    if (len < 1e-6) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    if (heading !== null) {
      const delta = ((h - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const deg = (delta * 180) / Math.PI;
      if (Math.abs(deg) >= 30) {
        // Plan y points down, so a positive (clockwise) change is a right turn.
        const side = deg > 0 ? "right" : "left";
        const kind = Math.abs(deg) > 120 ? "uturn" : Math.abs(deg) < 60 ? `slight-${side}` : side;
        out.push({ kind, side, at: along, text: kind === "uturn" ? `Make a U-turn to the ${side}` : kind.startsWith("slight") ? `Keep ${side}` : `Turn ${side}` });
      }
    }
    heading = h;
    along += len;
  }
  const last = drive[drive.length - 1];
  let side = "ahead";
  if (heading !== null) {
    const cross = Math.cos(heading) * (stall.centroid.y - last.y) - Math.sin(heading) * (stall.centroid.x - last.x);
    side = cross > 0 ? "right" : "left";
  }
  out.push({ kind: "park", side, at: along, text: side === "ahead" ? `Park in ${stall.label}` : `${stall.label} is on your ${side}` });
  return out;
}

/** The next maneuver after `progress` metres, with the distance to it. */
export function nextManeuver(maneuvers, progress = 0) {
  const m = maneuvers.find((x) => x.at >= progress - 0.5) || maneuvers[maneuvers.length - 1];
  if (!m) return null;
  return { ...m, inMeters: Math.max(0, m.at - progress) };
}

/** Remaining distance (m) and an arrival estimate (s) at lot driving speed. */
export function routeSummary(route, metersPerUnit = 1, progress = 0) {
  let total = 0;
  for (let i = 1; i < (route?.length || 0); i += 1) total += dist(route[i - 1], route[i]);
  const meters = Math.max(0, total * metersPerUnit - progress);
  return { meters, seconds: meters / LOT_SPEED_MPS };
}

/** Point and heading at `d` lot units along a polyline. */
export function pointAlong(route, d) {
  if (!route?.length) return null;
  let left = Math.max(0, d);
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1], b = route[i];
    const len = dist(a, b);
    if (left <= len || i === route.length - 1) {
      const t = len ? Math.min(1, left / len) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x), done: left >= len && i === route.length - 1 };
    }
    left -= len;
  }
  return { ...route[0], heading: 0, done: true };
}

export const formatEta = (seconds) => (seconds < 60 ? "< 1 min" : `${Math.round(seconds / 60)} min`);
