import React, { useMemo, useState } from "react";
import { Camera, Link2, Map as MapIcon, Trash2, Undo2, X } from "lucide-react";
import { cameraView, makeLink } from "@/lib/vision/siteLink";

// The site map (one aerial picture of the lot, spaces mapped once) and the
// camera linked to it. Shown above the camera on the Camera tab.
export function SiteBar({ site, mode, onMode, canMakeSite, onMakeSite, onRemoveSite, onLink, linked, linkError, canLink }) {
  if (!site) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[12px] text-neutral-300">
        <MapIcon className="h-4 w-4 text-sky-300" />
        <span><b>Site map</b> (for many cameras): open an aerial / satellite / drone photo of the lot, map its spaces, then</span>
        <button disabled={!canMakeSite} onClick={onMakeSite} className="rounded-md bg-sky-500 px-2.5 py-1 font-semibold text-white disabled:opacity-40" title={canMakeSite ? "" : "Open an aerial photo (Photo / video file) first"}>
          Make this picture the site map
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-900/60 bg-sky-950/30 px-3 py-2 text-[12px] text-neutral-200">
      <MapIcon className="h-4 w-4 text-sky-300" />
      <b>Site map</b>
      <div className="flex rounded-md bg-black/40 p-0.5">
        {[["site", <><MapIcon className="h-3.5 w-3.5" /> Site map</>], ["camera", <><Camera className="h-3.5 w-3.5" /> Camera</>]].map(([m, label]) => (
          <button key={m} onClick={() => onMode(m)} className={`flex items-center gap-1 rounded px-2 py-1 ${mode === m ? "bg-sky-600 text-white" : "text-neutral-400 hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {mode === "site" ? (
        <span className="text-neutral-400">Map or fix the spaces here. They are shared by every camera.</span>
      ) : (
        <>
          <span className={linked ? "text-emerald-300" : "text-amber-300"}>
            {linked ? `Camera linked (fit error ${linkError?.toFixed(1)}%)` : "This camera is not linked yet"}
          </span>
          <button disabled={!canLink} onClick={onLink} className="flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 font-semibold text-white disabled:opacity-40" title={canLink ? "" : "Open the camera's picture or stream first"}>
            <Link2 className="h-3.5 w-3.5" /> {linked ? "Re-link camera" : "Link camera"}
          </button>
        </>
      )}
      <button onClick={onRemoveSite} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-neutral-400 hover:bg-white/5 hover:text-white" title="Back to one camera without a site map (the spaces stay)">
        <Trash2 className="h-3.5 w-3.5" /> Remove site map
      </button>
    </div>
  );
}

const COLORS = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#a3e635", "#22d3ee"];

/**
 * Link a camera to the site map: click the same ground point in the camera
 * picture and on the site map, 4 or more times (corners of painted lines,
 * kerb corners, drain covers: points on the ground, spread far apart).
 */
export function CameraLinkDialog({ cameraUrl, siteUrl, site, initial, cameraAspect, onSave, onClose }) {
  const [pairs, setPairs] = useState(initial?.pairs || []);
  const [pending, setPending] = useState(null); // { side: "camera" | "site", p }
  const link = useMemo(() => (pairs.length >= 4 ? makeLink(pairs, { cameraAspect, view: initial?.view || "angled" }) : null), [pairs, cameraAspect, initial?.view]);
  const preview = useMemo(() => (link ? cameraView(site, link).stalls : []), [link, site]);

  const click = (side) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
    if (!pending || pending.side === side) { setPending({ side, p }); return; }
    const pair = side === "site" ? { from: pending.p, to: p } : { from: p, to: pending.p };
    setPairs((list) => [...list, pair]);
    setPending(null);
  };
  const nextNumber = pairs.length + 1;
  const hint = pending
    ? `Now click point ${nextNumber} on the ${pending.side === "camera" ? "site map" : "camera picture"}.`
    : pairs.length < 4
      ? `Click a point on the ground in the camera picture, then the same point on the site map (${pairs.length}/4).`
      : "Check the outlines on the camera picture: they should sit on the real spaces. Add more points to improve it.";

  const marker = ({ p, i, color }) => (
    <g>
      <circle cx={p.x} cy={p.y} r="1.4" fill={color} stroke="#000" strokeWidth="0.3" />
      <text x={p.x + 1.8} y={p.y - 1.2} fontSize="3.2" fontWeight="800" fill={color} stroke="#000" strokeWidth="0.25" paintOrder="stroke">{i}</text>
    </g>
  );
  const pane = ({ title, url, side, children }) => (
    <div key={side} className="flex min-w-0 flex-1 flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</p>
      <div className="relative cursor-crosshair select-none overflow-hidden rounded-lg ring-1 ring-white/10" onClick={click(side)}>
        <img src={url} alt="" className="block w-full" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {children}
          {pairs.map((pr, i) => <React.Fragment key={i}>{marker({ p: side === "camera" ? pr.from : pr.to, i: i + 1, color: COLORS[i % COLORS.length] })}</React.Fragment>)}
          {pending?.side === side && marker({ p: pending.p, i: nextNumber, color: "#fff" })}
        </svg>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-black/85 p-3 sm:p-5">
      <div className="flex items-center gap-3 text-white">
        <Link2 className="h-5 w-5 text-sky-300" />
        <h2 className="text-lg font-semibold">Link this camera to the site map</h2>
        <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-neutral-300 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <p className="text-sm text-sky-100">{hint}</p>
      <div className="flex flex-col gap-3 lg:flex-row">
        {pane({ title: "Camera", url: cameraUrl, side: "camera", children: preview.map((s) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} fill="rgba(56,189,248,0.12)" stroke="#38bdf8" strokeWidth="0.35" />) })}
        {pane({ title: "Site map", url: siteUrl, side: "site", children: site.stalls.map((s) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.25" />) })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => { if (pending) setPending(null); else setPairs((l) => l.slice(0, -1)); }} disabled={!pending && !pairs.length} className="flex items-center gap-1 rounded-md border border-white/15 px-3 py-1.5 text-neutral-200 disabled:opacity-40"><Undo2 className="h-4 w-4" /> Undo</button>
        <button onClick={() => { setPairs([]); setPending(null); }} disabled={!pairs.length} className="rounded-md border border-white/15 px-3 py-1.5 text-neutral-200 disabled:opacity-40">Start over</button>
        {link && <span className={link.error < 1.5 ? "text-emerald-300" : link.error < 4 ? "text-amber-300" : "text-rose-300"}>
          Fit error {link.error.toFixed(1)}% of the site map{link.error >= 4 ? " — a point is probably wrong (undo it)" : link.error >= 1.5 ? " — add a point or two" : " — good"}
        </span>}
        <span className="text-neutral-400">{preview.length} site spaces visible in this camera</span>
        <button onClick={() => onSave(link)} disabled={!link} className="ml-auto rounded-md bg-sky-500 px-4 py-1.5 font-semibold text-white disabled:opacity-40">Save link</button>
      </div>
      <p className="text-[11px] text-neutral-500">Use points on the ground (line ends, kerb corners), spread across the picture. Points on cars, poles or roofs are not on the ground and make the link wrong.</p>
    </div>
  );
}
