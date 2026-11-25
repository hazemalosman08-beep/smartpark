import { useEffect, useMemo, useRef, useState } from "react";
import { buildScene, releaseScene } from "@/lib/vision/sceneStyle";
import { sceneFeatures } from "@/lib/vision/sceneFeatures";

// The camera picture read as a scene: the illustrated map (dark and light) and
// the geometry found in it (islands, buildings, trees, where cars cannot drive).
// Live video changes every frame but the surroundings do not: the scene is
// rebuilt at most every 30 seconds, and at once when a new lot is mapped.
export default function useScene(backdrop, lot) {
  const [scene, setScene] = useState(null);
  const at = useRef(0);
  const forStalls = useRef(null);
  const href = backdrop?.href;
  useEffect(() => {
    if (!href) { forStalls.current = null; setScene((old) => { releaseScene(old); return null; }); return undefined; }
    if (forStalls.current === lot.stalls && Date.now() - at.current < 30000) return undefined;
    const stalls = lot.stalls;
    let cancelled = false;
    const spaces = backdrop.w > 0 && backdrop.h > 0
      ? stalls.map((st) => st.poly.map((p) => ({ x: (p.x - backdrop.x) / backdrop.w, y: (p.y - backdrop.y) / backdrop.h }))) : [];
    buildScene(href, { spaces }).then((next) => {
      if (cancelled) { releaseScene(next); return; }
      at.current = Date.now();
      forStalls.current = stalls;
      setScene((old) => { if (old) setTimeout(() => releaseScene(old), 2000); return next; });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [href, lot.stalls]);

  const rectKey = backdrop ? `${backdrop.x},${backdrop.y},${backdrop.w},${backdrop.h}` : "";
  const rect = useMemo(() => (backdrop ? { x: backdrop.x, y: backdrop.y, w: backdrop.w, h: backdrop.h } : null), [rectKey]);
  const features = useMemo(() => {
    if (!scene || !rect) return null;
    try { return sceneFeatures(scene, rect, lot.stalls); } catch { return null; }
  }, [scene, rectKey, lot.stalls]);
  return { scene, features, rect };
}
