import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Accessibility, ArrowUp, ArrowUpLeft, ArrowUpRight, Box, Building2, Camera, CarFront, CornerUpLeft, CornerUpRight, Expand, Eye,
  Footprints, Map as MapIcon, Minimize, Moon, Move3d, Navigation, ParkingSquare, RotateCcw, Sun,
} from "lucide-react";
import DriverMap from "@/components/SmartPark/DriverMap";
import { webglAvailable } from "@/lib/three/webgl";
import useGuidance from "@/hooks/useGuidance";
import { directionsFor, occupancyCounts } from "@/lib/vision/lot";
import { nextManeuver } from "@/lib/vision/navigation";

const Guide3D = lazy(() => import("@/components/SmartPark/Guide3D"));

const STEP_ICON = { straight: ArrowUp, left: CornerUpLeft, right: CornerUpRight, park: ParkingSquare, uturn: RotateCcw, walk: Footprints };
const MANEUVER_ICON = { left: CornerUpLeft, right: CornerUpRight, "slight-left": ArrowUpLeft, "slight-right": ArrowUpRight, uturn: RotateCcw, park: ParkingSquare };

const SOURCE = {
  live: { label: "Live camera", tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30", dot: "bg-emerald-400 animate-pulse" },
  photo: { label: "Photo snapshot", tone: "bg-sky-500/15 text-sky-200 ring-sky-400/30", dot: "bg-sky-400" },
  simulated: { label: "Simulated data", tone: "bg-violet-500/15 text-violet-200 ring-violet-400/30", dot: "bg-violet-400" },
};

const loadPref = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

// The screen drivers see: a 3D guide (or the flat map) with the way to a space.
export default function DriverView({ lot, graph, fromEntrance, statuses, tracks = [], source = "simulated", backdrop, scene, features, sceneRect }) {
  const rootRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const can3d = useMemo(() => webglAvailable(), []);
  const [dim, setDim] = useState(() => (can3d ? loadPref("smartpark.guide.dim", "3d") : "2d"));
  const [view, setView] = useState(() => loadPref("smartpark.guide.view", "driver"));
  const [theme, setTheme] = useState(() => loadPref("smartpark.guide.theme", "dark"));
  const [photo, setPhoto] = useState(false);
  const [destinationId, setDestinationId] = useState(null);
  const [accessible, setAccessible] = useState(false);
  const [driverId, setDriverId] = useState(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => savePref("smartpark.guide.dim", dim), [dim]);
  useEffect(() => savePref("smartpark.guide.view", view), [view]);
  useEffect(() => savePref("smartpark.guide.theme", theme), [theme]);

  const g = useGuidance({ lot, graph, fromEntrance, statuses, tracks, features, destinationId, accessible, driverId });
  const { total, open, unknown, percent: pct } = occupancyCounts(lot.stalls, statuses);
  const full = total > 0 && open === 0;
  const steps = useMemo(() => directionsFor(g.route, g.target, lot.metersPerUnit), [g.route, g.target, lot.metersPerUnit]);
  const wk = g.walkInfo;
  const via = wk?.crossing && wk?.walkway ? " using the walkway and crossing" : wk?.crossing ? " using the crossing" : wk?.walkway ? " along the walkway" : "";
  const allSteps = wk ? [...steps, { kind: "walk", text: `Walk ${walkTime(wk.seconds)} (${wk.meters} m) to ${g.navLot.destination?.name || "the building"}${via}` }] : steps;
  // Progress along the route: the preview car's, or zero (the route is
  // re-planned from your live position).
  const previewing = !g.driver && dim === "3d";
  const done = previewing ? progress : 0;
  const next = nextManeuver(g.maneuvers, done);
  const remaining = Math.max(0, g.summary.meters - done);

  // Cars the camera sees moving: one of them is the driver being guided.
  const candidates = tracks.filter((t) => (t.state !== "lost" && t.motion === "moving") || t.vehicle_id === driverId).slice(0, 6);
  // A stopped camera means no live position any more.
  useEffect(() => { if (driverId && source === "simulated") setDriverId(null); }, [source, driverId]);
  useEffect(() => { setProgress(0); }, [g.target?.id, g.route]);

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

  const light = theme === "light" && dim === "3d";
  const src = SOURCE[source] || SOURCE.simulated;
  const ManeuverIcon = next ? MANEUVER_ICON[next.kind] || ArrowUp : ArrowUp;
  const scale = lot.scaleSource === "measured" ? "" : " (estimated)";

  return (
    <div ref={rootRef} className="flex h-full min-h-[calc(100vh-57px)] flex-col bg-[#070b0e] text-slate-100">
      {/* header strip */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3 sm:px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-sm font-black text-emerald-950">P</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-wide">Parking guidance</p>
          <p className="text-[11px] text-slate-400">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 ${src.tone}`} title="Where the occupancy comes from">
          <span className={`h-1.5 w-1.5 rounded-full ${src.dot}`} /> {src.label}
        </span>
        {can3d && (
          <Segmented value={dim} onChange={setDim} options={[["3d", <><Box className="h-3.5 w-3.5" /> 3D</>], ["2d", <><MapIcon className="h-3.5 w-3.5" /> 2D</>]]} />
        )}
        <button onClick={toggleFullscreen} className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" title="Full screen for an entrance display">
          {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />} <span className="hidden sm:inline">{fullscreen ? "Exit" : "Full screen"}</span>
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-3 sm:p-4 lg:flex-row lg:p-5">
        {/* map: first on phones */}
        <section className={`relative order-first h-[68vh] w-full overflow-hidden rounded-2xl ring-1 lg:order-last lg:h-auto lg:min-h-[60vh] lg:flex-1 ${light ? "bg-[#e8edf2] ring-black/10" : "bg-[#0a0f14] ring-white/5"}`}>
          {dim === "3d" ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">Loading 3D view…</div>}>
              <Guide3D
                lot={lot} features={features} scene={scene} rect={sceneRect} statuses={statuses} tracks={tracks}
                guidance={g} destinationId={g.navLot.destination?.id} theme={theme} mode={view} onProgress={setProgress}
              />
            </Suspense>
          ) : (
            <div className="absolute inset-0 p-1 sm:p-3">
              <DriverMap lot={g.navLot} statuses={statuses} recommended={g.target} route={g.route} backdrop={backdrop} photo={photo} scene={scene?.dark || null} walkPath={wk?.path} />
            </div>
          )}

          {/* next turn */}
          {g.target && next && (
            <div className="pointer-events-none absolute left-1/2 top-14 z-10 w-[min(92%,420px)] -translate-x-1/2 md:top-3 md:w-[min(52%,420px)]">
              <div className="flex items-center gap-3 rounded-2xl bg-[#0f5132]/95 px-4 py-3 text-white shadow-xl ring-1 ring-emerald-300/30 backdrop-blur">
                <ManeuverIcon className="h-9 w-9 shrink-0" strokeWidth={2.4} />
                <div className="min-w-0 leading-tight">
                  <p className="text-2xl font-bold tabular-nums">{next.kind === "park" && next.inMeters < 3 ? "Arriving" : `${Math.max(1, Math.round(next.inMeters))} m`}</p>
                  <p className="truncate text-sm text-emerald-100">{next.text}</p>
                </div>
              </div>
            </div>
          )}

          {/* data honesty */}
          <div className="absolute left-3 top-3 z-10 hidden flex-col items-start gap-1.5 text-[11px] md:flex">
            {g.driver?.stale ? (
              <Chip tone="bg-amber-500/25 text-amber-100"><Navigation className="h-3 w-3" /> {g.driver.vehicle_id} out of view · last seen {Math.max(1, Math.round((Date.now() - g.driver.lastSeenAt) / 1000))} s ago</Chip>
            ) : g.driver ? (
              <Chip tone="bg-emerald-500/20 text-emerald-200"><Navigation className="h-3 w-3" /> Following {g.driver.vehicle_id} · live</Chip>
            ) : driverId ? (
              <Chip tone="bg-amber-500/25 text-amber-100"><Eye className="h-3 w-3" /> {driverId} not in view · route from the entrance</Chip>
            ) : (
              <Chip tone="bg-black/55 text-slate-200"><Eye className="h-3 w-3" /> Route preview · no live position</Chip>
            )}
            {!lot.rectified && lot.calibration?.view !== "overhead" && <Chip tone="bg-amber-500/20 text-amber-100">Layout follows the camera's angle</Chip>}
          </div>

          {/* view controls */}
          <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
            {dim === "3d" ? (
              <>
                <Segmented
                  dark={!light}
                  value={view}
                  onChange={setView}
                  options={[["driver", <><Navigation className="h-3.5 w-3.5" /><span className="hidden sm:inline">Driver</span></>], ["bird", <><Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline">Bird's-eye</span></>], ["free", <><Move3d className="h-3.5 w-3.5" /><span className="hidden sm:inline">Free</span></>]]}
                />
                <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={`rounded-lg p-2 ring-1 backdrop-blur ${light ? "bg-white/80 text-slate-700 ring-black/10" : "bg-black/50 text-slate-200 ring-white/10"}`} title={theme === "dark" ? "Light mode" : "Dark mode"}>
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </>
            ) : backdrop && (
              <Segmented value={photo} onChange={setPhoto} options={[[false, "Map"], [true, "Photo"]]} />
            )}
          </div>

          {/* trip summary */}
          {g.target && (
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-2xl bg-black/65 px-4 py-2.5 text-white ring-1 ring-white/10 backdrop-blur sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
              <span className="rounded-lg bg-emerald-400 px-2.5 py-0.5 text-lg font-extrabold text-emerald-950">{g.target.label}</span>
              {wk && (
                <span className="flex items-center gap-2 leading-tight">
                  <Footprints className="h-5 w-5 text-amber-300" />
                  <span>
                    <span className="block text-base font-bold tabular-nums text-amber-200">{walkTime(wk.seconds)} walk</span>
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">{wk.meters} m to {g.navLot.destination?.name || "the building"}</span>
                  </span>
                </span>
              )}
              <Stat value={`${Math.round(remaining)} m`} label={`drive${scale}`} />
            </div>
          )}

          {g.notice && (
            <div className="absolute inset-x-3 bottom-20 z-20 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-lg sm:left-1/2 sm:right-auto sm:-translate-x-1/2">{g.notice}</div>
          )}
          {g.parkedIn && (
            <div className="absolute inset-x-3 bottom-20 z-20 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm text-emerald-950 shadow-lg sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
              <b>Parked in {g.parkedIn.label}.</b>{wk ? ` ${walkTime(wk.seconds)} walk (${wk.meters} m) to ${g.navLot.destination?.name || "the building"}.` : ""} Saved for <Link to="/find" className="underline">Find my car</Link> (ID {g.driver?.vehicle_id}).
            </div>
          )}
        </section>

        {/* information */}
        <aside className="flex flex-col gap-3 lg:w-[340px] lg:shrink-0">
          <section className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/5">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Spaces available</p>
            <div className="mt-2 flex items-end gap-2">
              <span className={`text-6xl font-bold tabular-nums leading-none ${full ? "text-rose-400" : "text-emerald-400"}`}>{open}</span>
              <span className="pb-1 text-sm text-slate-400">of {total}</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
              <div className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{full ? "The lot is full" : `${pct}% occupied`} · {src.label.toLowerCase()}</p>
            {unknown > 0 && <p className="mt-1 text-xs text-slate-400">{unknown} space{unknown === 1 ? "" : "s"} not covered by a camera (shown gray)</p>}
          </section>

          {/* trip options */}
          <section className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/5 text-sm">
            {lot.buildings?.length > 1 && (
              <label className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-300" />
                <span className="text-slate-400">Going to</span>
                <select value={g.navLot.destination?.id || ""} onChange={(e) => setDestinationId(e.target.value)} className="ml-auto max-w-[60%] rounded-md border border-white/10 bg-[#0d1318] px-2 py-1 text-slate-100">
                  {lot.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {lot.buildings?.length === 1 && (
              <p className="flex items-center gap-2 text-slate-300"><Building2 className="h-4 w-4 text-amber-300" /> Going to {lot.buildings[0].name}</p>
            )}
            <label className="flex cursor-pointer items-center gap-2">
              <Accessibility className="h-4 w-4 text-sky-300" />
              <span className="text-slate-300">I need an accessible space</span>
              <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} className="ml-auto h-4 w-4 accent-sky-400" />
            </label>
            {accessible && !lot.stalls.some((s) => s.kind === "accessible") && (
              <p className="text-xs text-amber-200/80">No accessible spaces are marked for this lot yet (Camera tab → More tools → Space type).</p>
            )}
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-slate-400"><CarFront className="h-4 w-4" /> Your car</p>
              {source !== "live" ? (
                <p className="text-xs text-slate-500">Live position needs a running camera. Until then the route starts at the entrance.</p>
              ) : candidates.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((t) => (
                    <button key={t.vehicle_id} onClick={() => setDriverId(driverId === t.vehicle_id ? null : t.vehicle_id)}
                      className={`rounded-md px-2 py-1 font-mono text-xs ring-1 ${driverId === t.vehicle_id ? "bg-sky-500 text-white ring-sky-300" : "bg-white/5 text-slate-200 ring-white/10 hover:bg-white/10"}`}>
                      {t.vehicle_id}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No moving car in view. Pick yours when it drives in.</p>
              )}
            </div>
          </section>

          {g.target ? (
            <section className="rounded-2xl bg-emerald-500/10 p-5 ring-1 ring-emerald-400/30">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">Your space</p>
              <div className="mt-2 flex items-center gap-4">
                <span className="rounded-xl bg-emerald-400 px-4 py-1.5 text-5xl font-extrabold tracking-tight text-emerald-950">{g.target.label}</span>
                <span className="text-sm leading-snug text-slate-300">
                  {g.target.kind === "accessible" && <span className="mb-1 flex items-center gap-1 text-sky-300"><Accessibility className="h-3.5 w-3.5" /> Accessible</span>}
                  {wk ? (
                    <>
                      <span className="flex items-center gap-1 text-base font-semibold text-amber-200"><Footprints className="h-4 w-4" /> {walkTime(wk.seconds)} walk</span>
                      <span className="text-slate-500">{wk.meters} m from this space to {g.navLot.destination?.name || "the building"}</span><br />
                    </>
                  ) : null}
                  <span className="text-slate-400">Drive {Math.round(g.summary.meters)} m</span> <span className="text-slate-500">{g.driver ? "from your car" : "from the entrance"}</span>
                </span>
              </div>
              <ol className="mt-5 space-y-2.5">
                {allSteps.map((step, i) => {
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
              {full ? "Every space is taken right now. Please wait a moment or use another lot." : !lot.entrance ? "Directions appear once an entrance is set on the Camera tab." : "No suitable space is free right now."}
            </section>
          )}

          <div className="mt-auto hidden flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500 lg:flex">
            <Legend swatch="bg-emerald-500/50" label="Available" />
            <Legend swatch="bg-rose-500/60" label="Occupied" />
            <Legend swatch="bg-blue-500/60" label="Reserved" />
            <Legend swatch="bg-slate-500/60" label="Not verified" />
            <span className="flex items-center gap-1"><Camera className="h-3 w-3" /> Cars move only when the camera sees them move</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Walking time, rounded the way people say it.
const walkTime = (seconds) => (seconds < 55 ? `${Math.max(10, Math.round(seconds / 10) * 10)} sec` : `${Math.max(1, Math.round(seconds / 60))} min`);

function Segmented({ value, onChange, options, dark = true }) {
  return (
    <div className={`flex rounded-lg p-0.5 text-[11px] ring-1 backdrop-blur ${dark ? "bg-black/50 ring-white/10" : "bg-white/80 ring-black/10"}`}>
      {options.map(([v, label]) => (
        <button key={String(v)} onClick={() => onChange(v)}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${value === v ? (dark ? "bg-white/15 text-white" : "bg-slate-900 text-white") : dark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Chip({ tone, children }) {
  return <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-white/10 backdrop-blur ${tone}`}>{children}</span>;
}

function Stat({ value, label }) {
  return (
    <span className="leading-tight">
      <span className="block text-base font-bold tabular-nums">{value}</span>
      <span className="block text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
    </span>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} /> {label}
    </span>
  );
}
