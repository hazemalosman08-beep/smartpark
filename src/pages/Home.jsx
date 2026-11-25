import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Radio, Shuffle } from "lucide-react";
import TopBar from "@/components/SmartPark/TopBar";
import LiveCamera from "@/components/SmartPark/LiveCamera";
import LotView from "@/components/SmartPark/LotView";
import { EmptyLot, EventLog, GuidanceCard, OccupancyCard, SimulationCard, VehicleList } from "@/components/SmartPark/LotPanel";
import useVehicleSessions from "@/hooks/useVehicleSessions";
import { loadLocalCalibration, saveLocalCalibration } from "@/lib/lotLayout";
import {
  EMPTY_CALIBRATION, buildLaneGraph, deriveLot, distancesFrom, normalizeCalibration, pathLength, recommendStall,
  routeToStall, sampleCalibration,
} from "@/lib/vision/lot";
import { createSimulation } from "@/lib/vision/simulation";

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

  // ------------------------------------------------------------- simulation
  const simRef = useRef(null);
  useEffect(() => {
    simRef.current = lot.stalls.length ? createSimulation(lot, graph, { arrivalsPerMinute: simRate }) : null;
    setSim({ tracks: simRef.current?.tracks() || [], statuses: simRef.current?.statuses() || EMPTY_MAP });
  }, [lot, graph]);
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
  const occupied = lot.stalls.filter((s) => shown.statuses.get(s.id)?.status === "occupied").length;
  const occupiedKey = lot.stalls.map((s) => (shown.statuses.get(s.id)?.status === "occupied" ? 1 : 0)).join("");
  const recommended = useMemo(() => recommendStall(lot, graph, shown.statuses, lot.entrance, fromEntrance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lot, graph, fromEntrance, occupiedKey]);
  const route = useMemo(() => (recommended && lot.entrance ? routeToStall(lot, graph, recommended) : []), [lot, graph, recommended]);
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
                <SourceBtn active={mode === "sim"} onClick={() => setSource("sim")}>
                  <Shuffle className="h-3 w-3" /> Simulation
                </SourceBtn>
              </div>
            </div>
            {!lot.rectified && lot.stalls.length > 0 && !calibration.sample && calibration.view !== "overhead" && (
              <p className="border-b border-neutral-800 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-200">
                The plan follows the camera's perspective. For a true-to-scale plan, use <b>Lot corners</b> on the Camera tab
                and enter the lot's size in metres.
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
