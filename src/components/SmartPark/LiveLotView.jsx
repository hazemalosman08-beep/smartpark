import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import DriverView from "@/components/SmartPark/DriverView";
import useScene from "@/hooks/useScene";
import { buildLaneGraph, deriveLot, distancesFrom, normalizeCalibration } from "@/lib/vision/lot";
import { warpFrameToPlan } from "@/lib/vision/warp";
import { feedPictures, feedStatuses } from "@/lib/campusFeeds";

// Inside one lot of the campus: the lot's own 3D guide (the Driver screen)
// from its live feed: every space free or taken as the camera sees it, the
// best free space and the route to it from the entrance.
export default function LiveLotView({ feed, lotName, onBack }) {
  const calibration = useMemo(() => normalizeCalibration(feed.calibration), [feed.calibration]);
  const lot = useMemo(() => deriveLot(calibration), [calibration]);
  const graph = useMemo(() => buildLaneGraph(lot.lanes), [lot]);
  const fromEntrance = useMemo(() => distancesFrom(graph, lot.entrance), [graph, lot]);
  const statuses = useMemo(() => feedStatuses(feed), [feed]);

  // The picture the lot was mapped on: the ground under the 3D lot.
  const [picture, setPicture] = useState(null); // { url, width, height }
  useEffect(() => {
    let url = null, gone = false;
    feedPictures.load(feed.id).then(async (blob) => {
      if (!blob || gone) return;
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (!gone) setPicture({ url, width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [feed.id]);
  const [warped, setWarped] = useState(null);
  useEffect(() => {
    if (!picture || !lot.rectified) { setWarped(null); return undefined; }
    let cancelled = false;
    warpFrameToPlan(picture.url, lot).then((w) => { if (!cancelled) setWarped(w); }).catch(() => {});
    return () => { cancelled = true; };
  }, [picture, lot]);
  const backdrop = useMemo(() => {
    if (!picture) return null;
    if (lot.rectified) return warped;
    return { href: picture.url, x: 0, y: 0, w: 100 * (calibration.aspect || picture.width / picture.height), h: 100 };
  }, [picture, lot, warped, calibration.aspect]);
  const { scene, features, rect } = useScene(backdrop, lot);

  const r = feed.reading;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#0b1117]">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-neutral-200 ring-1 ring-white/10 hover:bg-white/5"><ArrowLeft className="h-4 w-4" /> Campus map</button>
        <span className="font-semibold text-white">{lotName || feed.lotName || "Parking lot"}</span>
        {r && <span className="text-xs text-green-300">● LIVE · {r.free} of {r.total} free</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {lot.stalls.length ? (
          <DriverView lot={lot} graph={graph} fromEntrance={fromEntrance} statuses={statuses} tracks={[]} source="live"
            backdrop={backdrop} scene={scene} features={features} sceneRect={rect} embedded />
        ) : (
          <p className="p-6 text-sm text-neutral-400">This lot&apos;s camera has no spaces mapped yet.</p>
        )}
      </div>
    </div>
  );
}
