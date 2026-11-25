import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, CornerUpLeft, CornerUpRight, Expand, Minimize, ParkingSquare, RotateCcw } from "lucide-react";
import DriverMap from "@/components/SmartPark/DriverMap";
import { directionsFor, pathLength } from "@/lib/vision/lot";

const STEP_ICON = { straight: ArrowUp, left: CornerUpLeft, right: CornerUpRight, park: ParkingSquare, uturn: RotateCcw };

// The screen drivers see: an entrance display (full screen) or a phone.
export default function DriverView({ lot, statuses, recommended, route, backdrop }) {
  const rootRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const total = lot.stalls.length;
  const open = lot.stalls.filter((s) => statuses?.get(s.id)?.status !== "occupied").length;
  const pct = total ? Math.round(((total - open) / total) * 100) : 0;
  const steps = useMemo(() => directionsFor(route, recommended, lot.metersPerUnit), [route, recommended, lot.metersPerUnit]);
  const meters = route?.length ? Math.round(pathLength(route) * lot.metersPerUnit) : null;
  const full = total > 0 && open === 0;

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15000);
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => { clearInterval(t); document.removeEventListener("fullscreenchange", onChange); };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-[calc(100vh-57px)] flex-col bg-[#070b0e] text-slate-100">
      {/* header strip */}
      <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-sm font-black text-emerald-950">P</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-wide">Parking guidance</p>
          <p className="text-[11px] text-slate-400">Live availability</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live · {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <button onClick={toggleFullscreen} className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" title="Full screen for an entrance display">
          {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />} <span className="hidden sm:inline">{fullscreen ? "Exit full screen" : "Full screen"}</span>
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-5">
        {/* information */}
        <aside className="flex flex-col gap-4 lg:w-[340px] lg:shrink-0">
          <section className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/5">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Spaces available</p>
            <div className="mt-2 flex items-end gap-2">
              <span className={`text-6xl font-bold tabular-nums leading-none ${full ? "text-rose-400" : "text-emerald-400"}`}>{open}</span>
              <span className="pb-1 text-sm text-slate-400">of {total}</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
              <div className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{full ? "The lot is full" : `${pct}% occupied`}</p>
          </section>

          {recommended ? (
            <section className="rounded-2xl bg-emerald-500/10 p-5 ring-1 ring-emerald-400/30">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">Your space</p>
              <div className="mt-2 flex items-center gap-4">
                <span className="rounded-xl bg-emerald-400 px-4 py-1.5 text-5xl font-extrabold tracking-tight text-emerald-950">{recommended.label}</span>
                {meters !== null && <span className="text-sm text-slate-300">{meters} m<br /><span className="text-slate-500">from entrance</span></span>}
              </div>
              <ol className="mt-5 space-y-2.5">
                {steps.map((step, i) => {
                  const Icon = STEP_ICON[step.text.startsWith("Make a U-turn") ? "uturn" : step.kind] || ArrowUp;
                  const last = step.kind === "park";
                  return (
                    <li key={i} className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${last ? "bg-emerald-400 text-emerald-950" : "bg-white/5 text-slate-200"}`}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className={`text-[15px] ${last ? "font-semibold text-emerald-200" : "text-slate-200"}`}>{step.text}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : (
            <section className="rounded-2xl bg-white/[0.03] p-5 text-sm text-slate-400 ring-1 ring-white/5">
              {full ? "Every space is taken right now. Please wait a moment or use another lot." : "Directions appear once an entrance is set on the Camera tab."}
            </section>
          )}

          <div className="mt-auto hidden items-center gap-4 px-1 text-[11px] text-slate-500 lg:flex">
            <Legend swatch="bg-emerald-500/40 ring-emerald-400" label="Available" />
            <Legend swatch="bg-slate-800 ring-slate-500" label="Occupied" />
            <Legend swatch="bg-emerald-400 ring-emerald-300" label="Your space" />
          </div>
        </aside>

        {/* map */}
        <section className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[#0b1014] ring-1 ring-white/5 lg:aspect-auto lg:min-h-[55vh] lg:flex-1">
          {backdrop && (
            <div className="absolute right-3 top-3 z-10 flex rounded-lg bg-black/50 p-0.5 text-[11px] ring-1 ring-white/10 backdrop-blur">
              {[["Map", false], ["Photo", true]].map(([label, value]) => (
                <button key={label} onClick={() => setPhoto(value)} className={`rounded-md px-2.5 py-1 ${photo === value ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>{label}</button>
              ))}
            </div>
          )}
          <div className="absolute inset-0 p-1 sm:p-3">
            <DriverMap lot={lot} statuses={statuses} recommended={recommended} route={route} backdrop={backdrop} photo={photo} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ring-1 ${swatch}`} /> {label}
    </span>
  );
}
