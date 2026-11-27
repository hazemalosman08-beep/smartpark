import React, { useMemo, useRef, useState } from "react";
import { Box, Camera, Link2, Map as MapIcon, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { applyHomography } from "@/lib/vision/geometry";
import { makeLink } from "@/lib/vision/siteLink";

// Big complexes: a satellite picture of the whole place, and the cameras placed
// on it. Without one, SmartPark works camera by camera as always.
export function ComplexBar({ complex, activeId, onAddSatellite, onRemove, onSwitch, onAddCamera, onRename, onLink, canLink, onShow }) {
  const fileRef = useRef(null);
  if (!complex) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[12px] text-neutral-300">
        <MapIcon className="h-4 w-4 text-sky-300" />
        <span><b>Big complex?</b> Add a satellite or aerial picture of the whole place: it becomes a 3D map with every camera&apos;s lot on it.</span>
        <button onClick={() => fileRef.current?.click()} className="rounded-md bg-sky-500 px-2.5 py-1 font-semibold text-white">Add satellite picture</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onAddSatellite(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    );
  }
  const active = complex.cameras.find((c) => c.id === activeId);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-900/60 bg-sky-950/30 px-3 py-2 text-[12px] text-neutral-200">
      <MapIcon className="h-4 w-4 text-sky-300" />
      <b>Complex</b>
      <div className="flex flex-wrap items-center gap-1 rounded-md bg-black/40 p-0.5">
        {complex.cameras.map((c) => (
          <button key={c.id} onClick={() => onSwitch(c.id)} title={c.link ? "Placed on the satellite map" : "Not placed on the satellite map yet"}
            className={`flex items-center gap-1 rounded px-2 py-1 ${c.id === activeId ? "bg-sky-600 text-white" : "text-neutral-300 hover:text-white"}`}>
            <Camera className="h-3.5 w-3.5" /> {c.name}
            <span className={`h-1.5 w-1.5 rounded-full ${c.link ? "bg-emerald-400" : "bg-amber-400"}`} />
          </button>
        ))}
        <button onClick={onAddCamera} className="flex items-center gap-1 rounded px-2 py-1 text-neutral-300 hover:text-white" title="Add another camera (another lot)"><Plus className="h-3.5 w-3.5" /> Camera</button>
      </div>
      {active && <button onClick={() => onRename(active.id)} className="rounded p-1 text-neutral-400 hover:text-white" title="Rename this camera's lot"><Pencil className="h-3.5 w-3.5" /></button>}
      <span className={active?.link ? "text-emerald-300" : "text-amber-300"}>
        {active?.link ? `${active.name} is on the map` : `Place ${active?.name || "this camera"} on the map`}
      </span>
      <button disabled={!canLink} onClick={onLink} className="flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
        title={canLink ? "Click 4+ matching ground points in the camera picture and on the satellite picture" : "Open this camera's picture or stream and map its spaces first"}>
        <Link2 className="h-3.5 w-3.5" /> {active?.link ? "Re-place" : "Place on map"}
      </button>
      <button onClick={onShow} className="flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-neutral-200 hover:bg-white/5"><Box className="h-3.5 w-3.5" /> See complex in 3D</button>
      <button onClick={onRemove} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-neutral-400 hover:bg-white/5 hover:text-white" title="Remove the satellite picture (cameras keep working on their own)">
        <Trash2 className="h-3.5 w-3.5" /> Remove satellite
      </button>
    </div>
  );
}

const COLORS = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#a3e635", "#22d3ee"];

/**
 * Place a camera on the satellite map: click the same ground point in the
 * camera picture and on the satellite picture, 4 or more times (corners of
 * painted lines, kerb corners: points on the ground, spread far apart). The
 * camera's spaces are drawn on the satellite picture as you go.
 */
export function CameraLinkDialog({ cameraUrl, siteUrl, cameraStalls = [], otherStalls = [], initial, cameraAspect, onSave, onClose }) {
  const [pairs, setPairs] = useState(initial?.pairs || []);
  const [pending, setPending] = useState(null); // { side: "camera" | "site", p }
  const link = useMemo(() => (pairs.length >= 4 ? makeLink(pairs, { cameraAspect }) : null), [pairs, cameraAspect]);
  const placed = useMemo(() => (link ? cameraStalls.map((s) => ({ id: s.id, poly: s.poly.map((p) => applyHomography(link.H, p)) })) : []), [link, cameraStalls]);

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
    ? `Now click point ${nextNumber} on the ${pending.side === "camera" ? "satellite picture" : "camera picture"}.`
    : pairs.length < 4
      ? `Click a point on the ground in the camera picture, then the same point on the satellite picture (${pairs.length}/4).`
      : "Check the blue outlines on the satellite picture: they should sit on the real spaces. Add more points to improve it.";

  const marker = ({ p, i, color }) => (
    <g>
      <circle cx={p.x} cy={p.y} r="1.4" fill={color} stroke="#000" strokeWidth="0.3" />
      <text x={p.x + 1.8} y={p.y - 1.2} fontSize="3.2" fontWeight="800" fill={color} stroke="#000" strokeWidth="0.25" paintOrder="stroke">{i}</text>
    </g>
  );
  const poly = (s, props) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} {...props} />;
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
        <h2 className="text-lg font-semibold">Place this camera on the satellite map</h2>
        <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-neutral-300 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <p className="text-sm text-sky-100">{hint}</p>
      <div className="flex flex-col gap-3 lg:flex-row">
        {pane({ title: "Camera", url: cameraUrl, side: "camera", children: cameraStalls.map((s) => poly(s, { fill: "none", stroke: "rgba(56,189,248,0.7)", strokeWidth: 0.25 })) })}
        {pane({
          title: "Satellite picture", url: siteUrl, side: "site",
          children: [
            ...otherStalls.map((s) => poly(s, { fill: "none", stroke: "rgba(255,255,255,0.35)", strokeWidth: 0.2 })),
            ...placed.map((s) => poly(s, { fill: "rgba(56,189,248,0.15)", stroke: "#38bdf8", strokeWidth: 0.3 })),
          ],
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => { if (pending) setPending(null); else setPairs((l) => l.slice(0, -1)); }} disabled={!pending && !pairs.length} className="flex items-center gap-1 rounded-md border border-white/15 px-3 py-1.5 text-neutral-200 disabled:opacity-40"><Undo2 className="h-4 w-4" /> Undo</button>
        <button onClick={() => { setPairs([]); setPending(null); }} disabled={!pairs.length} className="rounded-md border border-white/15 px-3 py-1.5 text-neutral-200 disabled:opacity-40">Start over</button>
        {link && <span className={link.error < 1.5 ? "text-emerald-300" : link.error < 4 ? "text-amber-300" : "text-rose-300"}>
          Fit error {link.error.toFixed(1)}%{link.error >= 4 ? " — a point is probably wrong (undo it)" : link.error >= 1.5 ? " — add a point or two" : " — good"}
        </span>}
        <button onClick={() => onSave(link)} disabled={!link} className="ml-auto rounded-md bg-sky-500 px-4 py-1.5 font-semibold text-white disabled:opacity-40">Save</button>
      </div>
      <p className="text-[11px] text-neutral-500">Use points on the ground (line ends, kerb corners), spread across the picture. Points on cars, poles or roofs are not on the ground and make the placement wrong.</p>
    </div>
  );
}
