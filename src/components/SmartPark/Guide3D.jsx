import React, { useEffect, useMemo, useRef } from "react";
import { LotScene } from "@/lib/three/lotScene";

// Realistic paint colours for cars whose colour the camera could not read.
const PAINT = ["#d1d5db", "#f3f4f6", "#1f2937", "#6b7280", "#9ca3af", "#1e3a8a", "#7f1d1d", "#e5e7eb", "#374151"];
const paintFor = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PAINT[h % PAINT.length];
};

/**
 * The 3D lot. Cars: one per occupied space (in the colour the camera saw when
 * a tracked car holds it) plus every tracked car that is not in a space,
 * gliding between tracker positions. Nothing moves unless the tracker says so.
 */
export default function Guide3D({ lot, features, scene, rect, statuses, tracks = [], guidance, destinationId, theme = "dark", mode = "bird", onProgress }) {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  useEffect(() => {
    const canvas = canvasRef.current;
    const lotScene = new LotScene(canvas, { onProgress: (m) => progressRef.current?.(m) });
    engine.current = lotScene;
    const parent = canvas.parentElement;
    const ro = new ResizeObserver(() => lotScene.resize(parent.clientWidth, parent.clientHeight));
    ro.observe(parent);
    lotScene.resize(parent.clientWidth, parent.clientHeight);
    lotScene.start();
    return () => { ro.disconnect(); lotScene.dispose(); engine.current = null; };
  }, []);

  const sceneImages = useMemo(() => (scene ? { dark: scene.dark, light: scene.light } : null), [scene]);
  useEffect(() => { engine.current?.setTheme(theme); }, [theme]);
  useEffect(() => { engine.current?.setDestination(destinationId || null); }, [destinationId]);
  useEffect(() => { engine.current?.setLot({ lot, features, sceneImages, rect }); }, [lot, features, sceneImages, rect]);
  useEffect(() => { engine.current?.setStatuses(statuses); }, [statuses]);
  useEffect(() => { engine.current?.setMode(mode); }, [mode]);

  const driverId = guidance?.driver?.vehicle_id || null;
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const cars = [];
    const placed = new Set();
    const byId = new Map(tracks.map((t) => [t.vehicle_id, t]));
    for (const s of lot.stalls) {
      const st = statuses?.get?.(s.id);
      if (st?.status !== "occupied") continue;
      const t = st.vehicle_id ? byId.get(st.vehicle_id) : null;
      // A tracked car still driving is drawn where it is, not in the space.
      if (t && t.motion === "moving") continue;
      const key = st.vehicle_id || `stall:${s.id}`;
      placed.add(key);
      cars.push({ key, x: s.centroid.x, y: s.centroid.y, heading: s.heading, color: t?.color || paintFor(s.id), you: key === driverId });
    }
    for (const t of tracks) {
      // Only cars the camera currently sees are drawn moving about.
      if (placed.has(t.vehicle_id) || !t.ground || (t.state === "lost" && t.vehicle_id !== driverId)) continue;
      cars.push({ key: t.vehicle_id, x: t.ground.x, y: t.ground.y, heading: t.heading ?? undefined, color: t.color || paintFor(t.vehicle_id), you: t.vehicle_id === driverId });
    }
    e.setCars(cars);
  }, [lot, statuses, tracks, driverId]);

  const route = guidance?.route;
  const target = guidance?.target;
  const live = Boolean(guidance?.driver);
  useEffect(() => {
    engine.current?.setRoute(route || [], target || null, { live });
  }, [route, target, live]);
  const walkPath = guidance?.walkInfo?.path || null;
  useEffect(() => { engine.current?.setWalk(walkPath); }, [walkPath]);
  const driver = guidance?.driver;
  useEffect(() => {
    if (!driver?.ground) { engine.current?.setEgo(null); return; }
    const r = route || [];
    const heading = Number.isFinite(driver.heading) ? driver.heading : r.length > 1 ? Math.atan2(r[1].y - r[0].y, r[1].x - r[0].x) : 0;
    engine.current?.setEgo({ x: driver.ground.x, y: driver.ground.y, heading });
  }, [driver, route]);

  return <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="3D parking lot with your route" />;
}
