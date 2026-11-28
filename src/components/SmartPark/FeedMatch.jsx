import React, { useMemo, useState } from "react";
import { Check, Link2, X } from "lucide-react";
import { autoLink } from "@/lib/feedMatch";
import { applyHomography } from "@/lib/vision/geometry";

/**
 * Step 3 of a lot's live feed: the camera's spaces are matched to the
 * satellite picture's spaces automatically. Blue = where each camera space
 * lands. If it is off, staff click one space in the camera picture and the
 * same space on the satellite picture.
 */
export default function FeedMatch({ cameraUrl, aerialUrl, cameraCal, aerialCal, onSave, onBack, onManual }) {
  const [anchor, setAnchor] = useState(null); // { cameraId, aerialId }
  const [pick, setPick] = useState(null); // camera space id waiting for its satellite space
  const link = useMemo(() => autoLink(cameraCal, aerialCal, { anchor }), [cameraCal, aerialCal, anchor]);
  const projected = useMemo(() => (link ? cameraCal.stalls.map((s) => ({ id: s.id, poly: s.poly.map((p) => applyHomography(link.H, p)) })) : []), [link, cameraCal]);
  const matchedAerial = useMemo(() => new Set(link ? [...link.pairs.values()] : []), [link]);

  const hit = (stalls, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
    let best = null, bd = Infinity;
    for (const s of stalls) {
      const c = { x: s.poly.reduce((a, q) => a + q.x, 0) / s.poly.length, y: s.poly.reduce((a, q) => a + q.y, 0) / s.poly.length };
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  const poly = (s, props) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} {...props} />;
  const pane = (title, url, onClick, children) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</p>
      <div className="relative cursor-crosshair select-none overflow-hidden rounded-lg ring-1 ring-white/10" onClick={onClick}>
        <img src={url} alt="" className="block w-full" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">{children}</svg>
      </div>
    </div>
  );

  const status = !link
    ? "Could not match the camera's spaces to the satellite picture. Click one space in the camera picture, then the same space on the satellite picture."
    : pick
      ? "Now click the same space on the satellite picture."
      : `Matched ${link.matched} of ${link.total} camera spaces${anchor ? " (using the space you clicked)" : " automatically"}. Blue shows where each camera space lands on the satellite picture.${link.unsure && !anchor ? " Lots repeat, so it may be a space or row off: if the blue is off, click one space in the camera picture, then the same space on the satellite picture." : " If it is off, click one space in the camera picture, then the same space on the satellite picture."}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-black/90 p-3 sm:p-5">
      <div className="flex items-center gap-3 text-white">
        <Link2 className="h-5 w-5 text-green-300" />
        <h2 className="text-lg font-semibold">3 · Match the camera to the satellite picture</h2>
        <button onClick={onBack} className="ml-auto rounded-md p-1.5 text-neutral-300 hover:bg-white/10" aria-label="Back"><X className="h-5 w-5" /></button>
      </div>
      <p className={`text-sm ${link ? "text-green-100" : "text-amber-200"}`}>{status}</p>
      <div className="flex flex-col gap-3 lg:flex-row">
        {pane("Camera", cameraUrl, (e) => { const s = hit(cameraCal.stalls, e); if (s) setPick(s.id); },
          cameraCal.stalls.map((s) => poly(s, { fill: s.id === pick || s.id === anchor?.cameraId ? "rgba(250,204,21,0.45)" : link?.pairs.has(s.id) ? "rgba(56,189,248,0.18)" : "rgba(239,68,68,0.15)", stroke: s.id === pick ? "#facc15" : "rgba(56,189,248,0.8)", strokeWidth: 0.25 })))}
        {pane("Satellite picture", aerialUrl, (e) => { if (!pick) return; const s = hit(aerialCal.stalls, e); if (s) { setAnchor({ cameraId: pick, aerialId: s.id }); setPick(null); } },
          <>
            {aerialCal.stalls.map((s) => poly(s, { fill: s.id === anchor?.aerialId ? "rgba(250,204,21,0.45)" : matchedAerial.has(s.id) ? "rgba(56,189,248,0.25)" : "none", stroke: "rgba(255,255,255,0.35)", strokeWidth: 0.12 }))}
            {projected.map((s) => poly(s, { fill: "none", stroke: "#38bdf8", strokeWidth: 0.3 }))}
          </>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => link && onSave({ H: link.H, auto: !anchor, matched: link.matched, total: link.total })} disabled={!link}
          className="flex items-center gap-1.5 rounded-md bg-green-500 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40"><Check className="h-4 w-4" /> Looks right: save</button>
        {anchor && <button onClick={() => setAnchor(null)} className="rounded-md px-3 py-2 text-sm text-green-100 ring-1 ring-white/15 hover:bg-white/5">Back to automatic</button>}
        <button onClick={onManual} className="ml-auto text-xs text-neutral-400 underline hover:text-white">Match with 4 ground points instead</button>
      </div>
    </div>
  );
}
