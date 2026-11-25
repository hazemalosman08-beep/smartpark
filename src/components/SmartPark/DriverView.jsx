import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, CornerUpLeft, CornerUpRight, Expand, Minimize, ParkingSquare, RotateCcw } from "lucide-react";
import LotView from "@/components/SmartPark/LotView";
import { directionsFor, pathLength } from "@/lib/vision/lot";

const STEP_ICON = { straight: ArrowUp, left: CornerUpLeft, right: CornerUpRight, park: ParkingSquare, uturn: RotateCcw };

// What drivers see (entrance screen or a phone): how many spaces are open,
// which one to take, and an animation of the way there on the real lot.
export default function DriverView({ lot, statuses, tracks = [], recommended, route, backdrop, photo, onPhotoChange }) {
  const rootRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = lot.stalls.length;
  const open = lot.stalls.filter((s) => statuses?.get(s.id)?.status !== "occupied").length;
  const steps = useMemo(() => directionsFor(route, recommended, lot.metersPerUnit), [route, recommended, lot.metersPerUnit]);
  const meters = route?.length ? Math.round(pathLength(route) * lot.metersPerUnit) : null;

  // Loop: the guide car drives the route at a steady pace, waits at the space, repeats.
  const routeKey = route?.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";");
  useEffect(() => {
    if (!route || route.length < 2) return undefined;
    const drive = Math.min(8000, Math.max(3500, (meters || 40) * 90));
    const hold = 1600;
    const start = performance.now();
    let raf;
    const loop = (t) => {
      const e = (t - start) % (drive + hold);
      const x = Math.min(1, e / drive);
      setProgress(x < 1 ? x * x * (3 - 2 * x) : 1); // ease in/out
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  const full = total > 0 && open === 0;
  return (
    <div ref={rootRef} className="flex h-full min-h-[75vh] flex-col gap-3 bg-[#0b0f0d] p-3 text-white lg:flex-row lg:p-4">
      {/* Message panel */}
      <section className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-[#111814] p-5 lg:w-[360px] lg:shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.3em] text-green-400">SMARTPARK</p>
          <button onClick={toggleFullscreen} className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:text-white" title="Full screen for an entrance display">
            {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />} {fullscreen ? "Exit" : "Full screen"}
          </button>
        </div>

        <div className={`rounded-xl px-4 py-4 text-center ${full ? "bg-red-500/15" : "bg-green-500/10"}`}>
          <div className={`font-mono text-6xl font-black leading-none ${full ? "text-red-400" : "text-green-400"}`}>{open}</div>
          <div className="mt-1 text-sm font-semibold uppercase tracking-widest text-neutral-300">
            {full ? "Lot full" : `space${open === 1 ? "" : "s"} open`}
          </div>
          {total > 0 && <div className="mt-0.5 text-xs text-neutral-500">of {total}</div>}
        </div>

        {recommended ? (
          <>
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-neutral-400">Please park in</p>
              <p className="mt-1 inline-block rounded-xl bg-green-500 px-6 py-2 font-mono text-5xl font-black text-neutral-950">{recommended.label}</p>
              {meters !== null && <p className="mt-2 text-sm text-neutral-400">about {meters} m from the entrance</p>}
            </div>
            <ol className="flex flex-col gap-2">
              {steps.map((step, i) => {
                const Icon = STEP_ICON[step.text.startsWith("Make a U-turn") ? "uturn" : step.kind] || ArrowUp;
                return (
                  <li key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-base ${step.kind === "park" ? "bg-green-500/15 font-semibold text-green-200" : "bg-white/5 text-neutral-100"}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/40"><Icon className="h-5 w-5" /></span>
                    {step.text}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="text-center text-sm text-neutral-400">
            {full ? "Every space is taken right now. Please wait or try another lot." : "Set an entrance on the Camera tab to show directions."}
          </p>
        )}
        <p className="mt-auto text-center text-[11px] text-neutral-500">Updates live from the camera. If this space is taken, the next best one is shown.</p>
      </section>

      {/* Animated plan */}
      <section className="relative min-h-[50vh] flex-1 overflow-hidden rounded-2xl border border-neutral-800 bg-[#121714]">
        {backdrop && onPhotoChange && (
          <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-md border border-neutral-700 bg-black/70 p-0.5 text-[11px]">
            {[["Photo", true], ["Map", false]].map(([label, value]) => (
              <button key={label} onClick={() => onPhotoChange(value)} className={`rounded px-2 py-1 ${photo === value ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>{label}</button>
            ))}
          </div>
        )}
        <div className="absolute inset-0 p-2">
          <LotView
            lot={lot}
            statuses={statuses}
            tracks={tracks}
            recommended={recommended}
            route={[]}
            backdrop={backdrop}
            photo={photo}
            showTags={false}
            quiet
            guide={recommended && route?.length > 1 ? { route, stall: recommended, progress } : null}
          />
        </div>
      </section>
    </div>
  );
}
