import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Map as MapIcon, Navigation, Radio } from "lucide-react";
import TopBar from "@/components/SmartPark/TopBar";
import LiveCamera from "@/components/SmartPark/LiveCamera";
import LotView from "@/components/SmartPark/LotView";
import DriverView from "@/components/SmartPark/DriverView";
import { EmptyLot, EventLog, GuidanceCard, OccupancyCard, SimulationCard, VehicleList } from "@/components/SmartPark/LotPanel";
import useVehicleSessions from "@/hooks/useVehicleSessions";
import useScene from "@/hooks/useScene";
import { loadLocalCalibration, saveLocalCalibration } from "@/lib/lotLayout";
import {
  EMPTY_CALIBRATION, buildLaneGraph, deriveLot, distancesFrom, normalizeCalibration, occupancyCounts, pathLength, recommendStall, stallCost,
  routeToStall, sampleCalibration,
} from "@/lib/vision/lot";
import { createSimulation } from "@/lib/vision/simulation";
import { warpFrameToPlan } from "@/lib/vision/warp";

const EMPTY_MAP = new Map();

export default function Home() {
  const [tab, setTab] = useState("camera");
  const [calibration, setCalibrationState] = useState(() => loadLocalCalibration() || normalizeCalibration(EMPTY_CALIBRATION));
  const [remoteCode, setRemoteCode] = useState("");
  const [live, setLive] = useState({ tracks: [], statuses: EMPTY_MAP, streaming: false });
  const [events, setEvents] = useState([]);
  const [source, setSource] = useState("auto"); // auto | camera | sim
  const [simRunning, setSimRunning] = useState(true);
  const [simRate, setSimRate] = useState(6);
  const [sim, setSim] = useState({ tracks: [], statuses: EMPTY_MAP });
  const [selected, setSelected] = useState(null);
  const [frame, setFrame] = useState(null); // latest camera picture { url, width, height }
  const [photo, setPhoto] = useState(true); // plan backdrop: real photo or clean map
  const [warped, setWarped] = useState(null);
  const vehicleSessions = useVehicleSessions();

  // ------------------------------------------------------------ calibration
  const setCalibration = useCallback((next) => setCalibrationState(normalizeCalibration(next)), []);

  useEffect(() => { saveLocalCalibration(calibration); }, [calibration]);

  const lot = useMemo(() => deriveLot(calibration), [calibration]);
  const graph = useMemo(() => buildLaneGraph(lot.lanes), [lot]);
  const fromEntrance = useMemo(() => distancesFrom(graph, lot.entrance), [graph, lot]);

  // ------------------------------------------------------------- live feed
  const pendingEvents = useRef([]);
  const lastIngest = useRef(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  const onLiveUpdate = useCallback((update) => {
    if (update.frame) { setFrame(update.frame); return; }
    if (!update.tracks) return;
    setLive({ tracks: update.tracks, statuses: update.statuses, streaming: update.streaming, still: update.still });
    if (update.events?.length) {
      pendingEvents.current.push(...update.events);
      setEvents((prev) => [...update.events.map((e, i) => ({ ...e, key: `${e.occurred_at}-${e.vehicle_id}-${e.type}-${i}` })), ...prev].slice(0, 60));
    }
    // Parking sessions are written at most once a second.
    const now = Date.now();
    if (now - lastIngest.current > 1000 || update.events?.some((e) => e.type === "exit")) {
      lastIngest.current = now;
      const batch = pendingEvents.current;
      pendingEvents.current = [];
      vehicleSessions.ingest(update.tracks.filter((t) => t.vehicle_id), batch);
    }
  }, [vehicleSessions.ingest]);

  const mode = source === "auto" ? (live.streaming ? "camera" : "sim") : source;

  // Photo backdrop in plan coordinates. Without lot corners the plan IS the
  // camera picture (scaled by its aspect); with them the picture is un-tilted.
  useEffect(() => {
    if (!frame || !lot.rectified) { setWarped(null); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      warpFrameToPlan(frame.url, lot).then((w) => {
        if (cancelled) { URL.revokeObjectURL(w.href); return; }
        setWarped((old) => { if (old) setTimeout(() => URL.revokeObjectURL(old.href), 2000); return w; });
      }).catch(() => {});
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [frame, lot]);
  const backdrop = useMemo(() => {
    if (!frame || calibration.sample) return null;
    if (lot.rectified) return warped;
    return { href: frame.url, x: 0, y: 0, w: 100 * (calibration.aspect || frame.width / frame.height), h: 100 };
  }, [frame, lot, warped, calibration.aspect, calibration.sample]);

  // ------------------------------------------------------------- simulation
  const simRef = useRef(null);
  // The guide demo starts from the real lot: the cars the camera sees parked
  // stay where they are (in their real colours), and new arrivals are guided
  // to the best free space along the aisles.
  const inSim = mode === "sim";
  useEffect(() => {
    if (!lot.stalls.length) { simRef.current = null; setSim({ tracks: [], statuses: EMPTY_MAP }); return; }
    const real = liveRef.current;
    let seed = null;
    if (real.statuses?.size) {
      seed = new Map();
      const byId = new Map(real.tracks.map((t) => [t.vehicle_id, t]));
      for (const [stallId, st] of real.statuses) {
        if (st.status === "occupied") seed.set(stallId, { vehicle_id: st.vehicle_id || undefined, color: byId.get(st.vehicle_id)?.color });
      }
    }
    // Guided arrivals take the same "best space" the guide recommends.
    const rank = lot.entrance || lot.building ? (stall) => stallCost(lot, graph, stall, fromEntrance) : null;
    simRef.current = createSimulation(lot, graph, { arrivalsPerMinute: simRate, seed, rank });
    setSim({ tracks: simRef.current.tracks(), statuses: simRef.current.statuses() });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot, graph, inSim]);
  useEffect(() => { simRef.current?.setRate(simRate); }, [simRate]);

  useEffect(() => {
    if (tab !== "lot" || mode !== "sim" || !simRunning || !simRef.current) return undefined;
    let raf;
    let last = performance.now();
    let lastPaint = 0;
    const loop = (t) => {
      const dt = (t - last) / 1000;
      last = t;
      const s = simRef.current;
      if (s) {
        const ev = s.step(dt);
        if (ev.length) setEvents((prev) => [...ev.map((e, i) => ({ ...e, key: `${e.occurred_at}-${e.vehicle_id}-${e.type}-${i}-${Math.random()}` })), ...prev].slice(0, 60));
        if (t - lastPaint > 33) {
          lastPaint = t;
          setSim({ tracks: s.tracks(), statuses: s.statuses() });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tab, mode, simRunning, lot]);

  const simManual = (fn) => {
    const s = simRef.current;
    if (!s) return;
    const ev = fn(s);
    if (ev.length) setEvents((prev) => [...ev.map((e, i) => ({ ...e, key: `${e.occurred_at}-${e.vehicle_id}-${i}-${Math.random()}` })), ...prev].slice(0, 60));
    setSim({ tracks: s.tracks(), statuses: s.statuses() });
  };

  // ------------------------------------------------------------- plan data
  const shown = mode === "camera" ? live : sim;
  // Real occupancy: the camera when it runs, otherwise the plan's own traffic.
  // Every number on every screen comes from this; the Guide demo only animates.
  const realStatuses = live.streaming ? live.statuses : sim.statuses;
  const counts = occupancyCounts(lot.stalls, realStatuses);
  const occupied = counts.taken;
  const occupiedKey = lot.stalls.map((s) => (shown.statuses.get(s.id)?.status === "occupied" ? 1 : 0)).join("");
  const recommended = useMemo(() => recommendStall(lot, graph, shown.statuses, lot.entrance, fromEntrance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lot, graph, fromEntrance, occupiedKey]);
  const route = useMemo(() => (recommended && lot.entrance ? routeToStall(lot, graph, recommended) : []), [lot, graph, recommended]);
  // The driver screen always follows the real lot (camera), not the demo
  // traffic; where the numbers come from is shown on it.
  const driverSource = live.streaming ? (live.still ? "photo" : "live") : "simulated";
  const driverTracks = useMemo(() => (live.streaming ? live.tracks.filter((t) => t.ground && t.vehicle_id) : []), [live]);
  const { scene, features, rect: sceneRect } = useScene(tab === "driver" ? backdrop : null, lot);
  const lotTracks = useMemo(() => shown.tracks.filter((t) => t.ground && t.vehicle_id), [shown.tracks]);
  const selectedTrack = lotTracks.find((t) => t.key === selected);

  const status = live.streaming
    ? `Camera: ${live.tracks.filter((t) => t.state !== "lost").length} vehicles tracked`
    : calibration.stalls.length ? `${calibration.stalls.length} stalls mapped` : "Lot not mapped yet";

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1311] text-white">
      <TopBar tab={tab} setTab={setTab} status={status} />

      {/* The camera keeps running while the plan is open, so the plan stays live. */}
      <main className={tab === "camera" ? "flex flex-1 flex-col gap-3 p-3 lg:p-4" : "hidden"}>
        <div className="flex min-h-[70vh] flex-1 flex-col">
          <LiveCamera
            calibration={calibration}
            onCalibrationChange={setCalibration}
            lot={lot}
            onUpdate={onLiveUpdate}
            assignVehicleId={vehicleSessions.assignVehicleId}
            remoteCode={remoteCode}
            onRemoteCodeChange={setRemoteCode}
            visible={tab === "camera"}
          />
        </div>
        {calibration.sample && (
          <p className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
            The sample lot is loaded. Use <b>Clear map</b> and draw your own stalls to map the lot in your camera picture.
          </p>
        )}
      </main>

      {tab === "driver" && (
        <main className="flex flex-1 flex-col">
          {lot.stalls.length ? (
            <DriverView
              lot={lot}
              graph={graph}
              fromEntrance={fromEntrance}
              statuses={realStatuses}
              tracks={driverTracks}
              source={driverSource}
              backdrop={backdrop}
              scene={scene}
              features={features}
              sceneRect={sceneRect}
            />
          ) : (
            <EmptyLot onSample={() => setCalibrationState(sampleCalibration())} onCamera={() => setTab("camera")} />
          )}
        </main>
      )}

      {tab === "lot" && (
        <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-4">
          <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-neutral-800 bg-[#121714]">
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
              <span className="text-[10px] font-semibold tracking-[0.2em] text-neutral-500">LOT PLAN</span>
              <span className="text-[11px] text-neutral-400">
                {calibration.sample ? "sample lot" : lot.rectified ? "true-to-scale (calibrated)" : "as seen by the camera"}
              </span>
              <div className="ml-auto flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5 text-[11px]">
                <SourceBtn active={mode === "camera"} disabled={!live.streaming} onClick={() => setSource("camera")} title={live.streaming ? "Cars from the camera" : "Start a camera on the Camera tab"}>
                  <Radio className="h-3 w-3" /> Live camera
                </SourceBtn>
                <SourceBtn active={mode === "sim"} onClick={() => setSource("sim")} title="Animated guide: new cars are led to the best free space">
                  <Navigation className="h-3 w-3" /> Guide demo
                </SourceBtn>
              </div>
              {backdrop && (
                <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5 text-[11px]">
                  <SourceBtn active={photo} onClick={() => setPhoto(true)} title="Show the real lot under the plan"><ImageIcon className="h-3 w-3" /> Photo</SourceBtn>
                  <SourceBtn active={!photo} onClick={() => setPhoto(false)} title="Clean drawn map"><MapIcon className="h-3 w-3" /> Map</SourceBtn>
                </div>
              )}
            </div>
            {!lot.rectified && lot.stalls.length > 0 && !calibration.sample && calibration.view !== "overhead" && (
              <p className="border-b border-neutral-800 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-200">
                The plan follows the camera's perspective. For a true-to-scale plan, use <b>Lot corners</b> (under More tools) on the Camera tab
                and enter the lot's size in metres.
              </p>
            )}
            {mode === "sim" && live.streaming && (
              <p className="border-b border-neutral-800 bg-violet-500/5 px-3 py-1.5 text-[11px] text-violet-200">
                Guide demo: the cars moving on this map are animated. The numbers on the right stay live from the camera.
              </p>
            )}
            <div className="relative flex-1">
              {lot.stalls.length ? (
                <div className="absolute inset-0 p-2">
                  <LotView
                    lot={lot}
                    statuses={shown.statuses}
                    tracks={lotTracks}
                    recommended={recommended}
                    route={route}
                    selected={selected}
                    onSelect={setSelected}
                    backdrop={backdrop}
                    photo={photo}
                  />
                </div>
              ) : (
                <EmptyLot onSample={() => setCalibrationState(sampleCalibration())} onCamera={() => setTab("camera")} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 px-3 py-2 text-[11px] text-neutral-400">
              <Legend color="rgba(74,222,128,0.8)" label="Free" />
              <Legend color="rgba(248,113,113,0.8)" label="Occupied" />
              <Legend color="#4ade80" label="Recommended + route" dashed />
              {mode === "camera" && <span className="flex items-center gap-1"><Camera className="h-3 w-3" /> Positions come from the camera tracker</span>}
              {selectedTrack && (
                <span className="ml-auto font-mono text-neutral-200">
                  {selectedTrack.vehicle_id} · {selectedTrack.motion}{selectedTrack.spot_label ? ` in ${selectedTrack.spot_label}` : ""}{selectedTrack.speed ? ` · ${Math.round(selectedTrack.speed * 3.6)} km/h` : ""}
                </span>
              )}
            </div>
          </section>

          <aside className="flex min-w-0 flex-col gap-3">
            <OccupancyCard total={lot.stalls.length} occupied={occupied} />
            <GuidanceCard
              recommended={recommended}
              distanceMeters={route.length ? pathLength(route) * lot.metersPerUnit : NaN}
              full={lot.stalls.length > 0 && occupied >= lot.stalls.length}
            />
            {mode === "sim" && lot.stalls.length > 0 && (
              <SimulationCard
                running={simRunning}
                onToggle={() => setSimRunning((v) => !v)}
                rate={simRate}
                onRate={setSimRate}
                onAdd={() => simManual((s) => s.addCar())}
                onRemove={() => simManual((s) => s.removeCar())}
              />
            )}
            <VehicleList tracks={lotTracks} selected={selected} onSelect={setSelected} />
            <EventLog events={events.filter((e) => (mode === "sim" ? e.source === "simulation" : e.source !== "simulation"))} />
          </aside>
        </main>
      )}
    </div>
  );
}

function SourceBtn({ active, disabled, onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 rounded px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function Legend({ color, label, dashed }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-4 rounded-sm" style={dashed ? { borderTop: `2px dashed ${color}` } : { background: color }} />
      {label}
    </span>
  );
}
