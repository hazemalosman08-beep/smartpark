import { useEffect, useMemo, useState } from "react";
import useScene from "@/hooks/useScene";
import { buildLaneGraph, routeToStall } from "@/lib/vision/lot";
import { warpFrameToPlan } from "@/lib/vision/warp";
import { feedPictures } from "@/lib/campusFeeds";

// Realistic paint for parked cars (the camera's colour is not kept in a feed).
const PAINT = ["#d1d5db", "#f3f4f6", "#1f2937", "#6b7280", "#9ca3af", "#1e3a8a", "#7f1d1d", "#e5e7eb", "#374151"];
const paintFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAINT[h % PAINT.length]; };

/**
 * One live lot on the campus map, drawn like its driver guide: works out the
 * lot's scene from the picture it was mapped on (ground, islands, trees) and
 * hands it to the campus 3D map with the spaces' statuses, the parked cars,
 * where it sits on the map, and the route to the chosen space.
 */
export default function FeedGuide({ engine, feed, lot, statuses, placement, targetId }) {
  const [picture, setPicture] = useState(null);
  useEffect(() => {
    let url = null, gone = false, tries = 0, timer = null;
    // Just saved: the picture may still be being written; try again shortly.
    const load = () => feedPictures.load(feed.id).then(async (blob) => {
      if (gone) return;
      if (!blob) { if (tries++ < 10) timer = setTimeout(load, 800); return; }
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (!gone) setPicture({ url, width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    });
    load();
    return () => { gone = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [feed.id]);
  const [warped, setWarped] = useState(null);
  useEffect(() => {
    if (!picture || !lot.rectified) { setWarped(null); return undefined; }
    let cancelled = false;
    warpFrameToPlan(picture.url, lot).then((w) => { if (!cancelled) setWarped(w); }).catch(() => {});
    return () => { cancelled = true; };
  }, [picture, lot]);
  const aspect = feed.calibration?.aspect;
  const backdrop = useMemo(() => {
    if (!picture) return null;
    if (lot.rectified) return warped;
    return { href: picture.url, x: 0, y: 0, w: 100 * (aspect || picture.width / picture.height), h: 100 };
  }, [picture, lot, warped, aspect]);
  const { scene, features, rect } = useScene(backdrop, lot);
  const sceneImages = useMemo(() => (scene ? { dark: scene.dark, light: scene.light } : null), [scene]);
  const graph = useMemo(() => buildLaneGraph(lot.lanes), [lot]);
  const cars = useMemo(() => lot.stalls.filter((s) => statuses.get(s.id)?.status === "occupied")
    .map((s) => ({ key: `stall:${s.id}`, x: s.centroid.x, y: s.centroid.y, heading: s.heading, color: paintFor(s.id) })), [lot, statuses]);
  const target = useMemo(() => lot.stalls.find((s) => s.id === targetId) || null, [lot, targetId]);
  const route = useMemo(() => (target && lot.entrance ? routeToStall(lot, graph, target) : []), [lot, graph, target]);

  useEffect(() => {
    engine.current?.setLiveGuide(feed.id, { lotId: feed.lotId, lot, features, sceneImages, rect, statuses, cars, placement, route, target });
  }, [engine, feed.id, lot, features, sceneImages, rect, statuses, cars, placement, route, target]);
  useEffect(() => () => engine.current?.setLiveGuide(feed.id, null), [engine, feed.id]);
  return null;
}
