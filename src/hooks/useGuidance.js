import { useEffect, useMemo, useRef, useState } from "react";
import { recommendStall, routeToStall, walkDistance } from "@/lib/vision/lot";
import { buildManeuvers, routeSummary } from "@/lib/vision/navigation";
import { WALK_SPEED_MPS, walkPlanner } from "@/lib/vision/walking";

const MY_CAR_KEY = "smartpark.myCar";

export function loadMyCar() {
  try { return JSON.parse(localStorage.getItem(MY_CAR_KEY) || "null"); } catch { return null; }
}
function saveMyCar(value) {
  try { localStorage.setItem(MY_CAR_KEY, JSON.stringify(value)); } catch { /* storage blocked */ }
}

/**
 * Guidance for one driver: the space, the route and the turns.
 *   destinationId: which building the driver walks to (lot.buildings[].id)
 *   accessible:    the driver needs an accessible space
 *   driverId:      the camera track (vehicle ID) that is this driver's car,
 *                  when the driver chose it; without it there is no live
 *                  position and the route starts at the entrance.
 */
export default function useGuidance({ lot, graph, fromEntrance, statuses, tracks = [], features = null, destinationId = null, accessible = false, driverId = null }) {
  const obstacle = features?.obstacle || null;
  // The walk from each space to the chosen building, along walkways and
  // crossings read from the picture; it ranks the spaces.
  const navLot = useMemo(() => {
    const dest = lot.buildings?.find((b) => b.id === destinationId) || lot.buildings?.[0] || null;
    if (!dest) return { ...lot, destination: null, walker: null };
    let walker = null;
    try { walker = walkPlanner(lot, features, dest); } catch { walker = null; }
    return { ...lot, building: { x: dest.x, y: dest.y }, destination: dest, walker, walkDistanceFor: walker?.distanceFor };
  }, [lot, destinationId, features]);

  // The camera can lose a car for a moment (another car in front, a missed
  // frame): its last position is kept for a while, marked as not current.
  const seen = driverId ? tracks.find((t) => t.vehicle_id === driverId && t.ground) || null : null;
  const lastSeen = useRef(null);
  if (seen) lastSeen.current = { track: seen, at: Date.now() };
  const recent = lastSeen.current && lastSeen.current.track.vehicle_id === driverId && Date.now() - lastSeen.current.at < 15000;
  const driver = seen && seen.state !== "lost" ? seen : recent ? { ...lastSeen.current.track, stale: true, lastSeenAt: lastSeen.current.at } : null;
  const occupiedKey = lot.stalls.map((s) => (statuses?.get(s.id)?.status === "occupied" ? 1 : 0)).join("");
  const best = useMemo(
    () => recommendStall(navLot, graph, statuses, lot.entrance, fromEntrance, { accessible }),
    [navLot, graph, fromEntrance, occupiedKey, accessible],
  );

  // While a driver is being guided, their space is kept (no flipping between
  // two equally good spaces); it changes only when someone else takes it.
  const [held, setHeld] = useState(null);
  const [notice, setNotice] = useState(null);
  const heldStall = held ? lot.stalls.find((s) => s.id === held) : null;
  useEffect(() => {
    if (!driverId) { setHeld(null); return; }
    if (!heldStall) { setHeld(best?.id || null); return; }
    const st = statuses?.get(heldStall.id);
    if (st?.status === "occupied" && st.vehicle_id !== driverId) {
      if (best && best.id !== heldStall.id) {
        setNotice(`${heldStall.label} was just taken. New space: ${best.label}.`);
        setHeld(best.id);
      } else setHeld(null);
    }
  }, [driverId, best?.id, occupiedKey, heldStall?.id]);
  useEffect(() => { setHeld(null); }, [destinationId, accessible]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const target = driverId ? heldStall || best : best;

  // Route from the driver's live position (re-planned every metre or so),
  // otherwise from the entrance.
  const unit = lot.metersPerUnit > 0 ? 1 / lot.metersPerUnit : 1;
  const fromKey = driver ? `${Math.round(driver.ground.x / unit)},${Math.round(driver.ground.y / unit)}` : "entrance";
  const route = useMemo(() => {
    const from = driver?.ground || lot.entrance;
    if (!target || !from) return [];
    return routeToStall(navLot, graph, target, from, { obstacle });
  }, [navLot, graph, target?.id, fromKey, obstacle]);

  const maneuvers = useMemo(() => buildManeuvers(route, target, lot.metersPerUnit), [route, target, lot.metersPerUnit]);
  const summary = useMemo(() => routeSummary(route, lot.metersPerUnit), [route, lot.metersPerUnit]);

  // Arrival: the guided car stands still in a space (seen by the camera).
  const parkedIn = driver && driver.motion !== "moving" && driver.spot_label
    ? lot.stalls.find((s) => s.label === driver.spot_label) || null : null;
  const arrived = Boolean(parkedIn && target && parkedIn.id === target.id);
  // The walk from where the car is (or will be) parked, not from the entrance.
  const walkFrom = parkedIn || target;
  const walkInfo = useMemo(() => {
    if (!walkFrom || !navLot.building) return null;
    const r = navLot.walker?.routeFrom(walkFrom.centroid);
    const units = r ? r.length : walkDistance(navLot, walkFrom);
    const meters = Math.max(1, Math.round(units * lot.metersPerUnit));
    return {
      from: walkFrom, meters, seconds: meters / WALK_SPEED_MPS,
      path: r?.path || [walkFrom.centroid, navLot.building], walkway: Boolean(r?.walkway), crossing: Boolean(r?.crossing), planned: Boolean(r),
    };
  }, [walkFrom, navLot, lot.metersPerUnit]);
  const walk = walkInfo?.meters ?? null;
  const saved = useRef(null);
  useEffect(() => {
    if (!parkedIn || !driver) return;
    const key = `${driver.vehicle_id}:${parkedIn.label}`;
    if (saved.current === key) return;
    saved.current = key;
    saveMyCar({ vehicle_id: driver.vehicle_id, spot_label: parkedIn.label, at: new Date().toISOString() });
  }, [parkedIn, driver]);

  return { navLot, target, route, maneuvers, summary, walk, walkInfo, driver, parkedIn, arrived, notice };
}
