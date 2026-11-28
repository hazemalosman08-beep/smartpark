import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cameraLotToSiteLot } from "@/lib/vision/siteLink";
import { areaCounts, complexStatuses, complexCalibration, loadComplex, newCamera, saveComplex } from "@/lib/complex";
import { loadPhoto, savePhoto } from "@/lib/photoStore";
import { CameraLinkDialog, ComplexBar } from "@/components/SmartPark/SitePanel";
import { feedPictures, loadFeeds, newFeed, readingFrom, saveFeeds } from "@/lib/campusFeeds";

const EMPTY_MAP = new Map();
const CampusView = lazy(() => import("@/components/SmartPark/CampusView"));

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

  // ------------------------------------------------------------- complex
  // Optional, for big places: a satellite picture of the whole complex,
  // animated in 3D, with every camera's lot placed on it. Each camera works
  // as a normal SmartPark camera; the calibration being edited is the active
  // camera's.
  const [complex, setComplexState] = useState(() => loadComplex());
  const setComplex = useCallback((next) => { setComplexState(next); saveComplex(next); }, []);
  const [satellite, setSatellite] = useState(null); // { blob, url }
  const [openPicture, setOpenPicture] = useState(null);
  const [linking, setLinking] = useState(false);
  const hasComplex = Boolean(complex);
  useEffect(() => {
    if (!hasComplex) { setSatellite(null); return undefined; }
    let gone = false;
    loadPhoto("complex").then((blob) => { if (!gone && blob) setSatellite((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; }); });
    return () => { gone = true; };
  }, [hasComplex]);
  const activeCam = complex?.cameras?.find((c) => c.id === complex.activeId) || null;
  const complexRef = useRef({});
  complexRef.current = { complex, activeCam, calibration };
  const addSatellite = async (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode();
    await savePhoto(file, "complex");
    setSatellite({ blob: file, url });
    // The lot already mapped becomes the complex's first camera.
    const first = newCamera("Camera 1", calibration);
    setComplex({ version: 1, aspect: img.naturalWidth / img.naturalHeight, cameras: [first], activeId: first.id });
  };
  const removeComplex = () => {
    if (!window.confirm("Remove the satellite picture? Every camera keeps working on its own; the camera on screen stays.")) return;
    setComplex(null);
  };
  // Switch camera: the current camera's map, picture and last reading are
  // kept; the other camera's map and picture come back.
  const switchCamera = async (id) => {
    const c = complexRef.current.complex;
    if (!c || id === c.activeId) return;
    const snapshot = liveRef.current.streaming && liveRef.current.statuses?.size ? { at: Date.now(), statuses: [...liveRef.current.statuses.entries()] } : undefined;
    const cameras = c.cameras.map((cam) => (cam.id === c.activeId ? { ...cam, calibration, ...(snapshot ? { snapshot } : {}) } : cam));
    const photo = await loadPhoto();
    if (photo && c.activeId) await savePhoto(photo, `cam:${c.activeId}`);
    const next = cameras.find((cam) => cam.id === id);
    setComplex({ ...c, cameras, activeId: id });
    setCalibrationState(normalizeCalibration(next.calibration));
    const blob = await loadPhoto(`cam:${id}`);
    if (blob) { await savePhoto(blob); setOpenPicture({ blob, nonce: Date.now() }); } else setOpenPicture({ stop: true, nonce: Date.now() });
  };
  const addCamera = async () => {
    const c = complexRef.current.complex;
    const name = window.prompt("Name of this camera's lot (e.g. North lot)", `Camera ${c.cameras.length + 1}`);
    if (name === null) return;
    const cam = newCamera(name || `Camera ${c.cameras.length + 1}`);
    const withNew = { ...c, cameras: [...c.cameras, cam] };
    setComplex(withNew);
    complexRef.current.complex = withNew;
    await switchCamera(cam.id);
  };
  const renameCamera = (id) => {
    const c = complexRef.current.complex;
    const cam = c.cameras.find((x) => x.id === id);
    const name = window.prompt("Name of this camera's lot", cam?.name || "");
    if (name) setComplex({ ...c, cameras: c.cameras.map((x) => (x.id === id ? { ...x, name: name.slice(0, 24) } : x)) });
  };
  const saveLink = (link) => {
    const c = complexRef.current.complex;
    setComplex({ ...c, cameras: c.cameras.map((x) => (x.id === c.activeId ? { ...x, link, calibration } : x)) });
    setLinking(false);
  };
  // The active camera's map is kept in the complex as it changes.
  useEffect(() => {
    const c = complexRef.current.complex;
    if (!c?.activeId) return;
    const t = setTimeout(() => setComplex({ ...c, cameras: c.cameras.map((x) => (x.id === c.activeId ? { ...x, calibration } : x)) }), 800);
    return () => clearTimeout(t);
  }, [calibration, setComplex]);
  // The whole complex as one map (satellite %), with occupancy.
  const complexView = useMemo(() => {
    if (!complex || !activeCam) return null;
    const { calibration: cal, areas } = complexCalibration(complex, { id: activeCam.id, calibration });
    if (!cal.stalls.length) return null;
    return { calibration: cal, lot: deriveLot(cal), areas };
  }, [complex, activeCam, calibration]);
  const graph = useMemo(() => buildLaneGraph(lot.lanes), [lot]);
  const fromEntrance = useMemo(() => distancesFrom(graph, lot.entrance), [graph, lot]);

  // ------------------------------------------------------------- live feed
  const pendingEvents = useRef([]);
  const lastIngest = useRef(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  // --------------------------------------------------- campus live feeds
  // Staff attach a camera to a lot of the campus map: the Camera tab maps
  // that lot; its readings become the lot's free spaces on the map.
  const [feeds, setFeedsState] = useState(() => loadFeeds());
  const setFeeds = useCallback((fn) => setFeedsState((prev) => { const next = typeof fn === "function" ? fn(prev) : fn; saveFeeds(next); return next; }), []);
  const [feedSetup, setFeedSetup] = useState(null); // the feed being set up in the Camera tab
  const [activeFeedId, setActiveFeedId] = useState(null); // the feed this camera is running as
  const activeFeed = feeds.find((f) => f.id === activeFeedId) || null;
  const addFeed = useCallback((osm, lot) => {
    setFeedSetup(newFeed(osm, lot));
    setActiveFeedId(null);
    setCalibrationState(normalizeCalibration(EMPTY_CALIBRATION));
    setOpenPicture({ stop: true, nonce: Date.now() });
    setTab("camera");
  }, []);
  const openFeed = useCallback(async (feed) => {
    setFeedSetup(feed);
    setActiveFeedId(null);
    setCalibrationState(normalizeCalibration(feed.calibration || EMPTY_CALIBRATION));
    const blob = await feedPictures.load(feed.id);
    setOpenPicture(blob ? { blob, nonce: Date.now() } : { stop: true, nonce: Date.now() });
    setTab("camera");
  }, []);
  const saveFeedSetup = useCallback(async () => {
    const f = feedSetup;
    if (!f) return;
    const live = liveRef.current;
    const reading = live.statuses?.size ? readingFrom(calibration, live.statuses) : f.reading;
    const saved = { ...f, calibration, reading, updatedAt: new Date().toISOString() };
    setFeeds((prev) => [...prev.filter((x) => x.id !== f.id), saved]);
    // The picture the lot was mapped on, to come back to it later.
    try {
      const blob = frame?.url ? await (await fetch(frame.url)).blob() : await loadPhoto();
      if (blob) await feedPictures.save(f.id, blob);
    } catch { /* the map still works without it */ }
    setActiveFeedId(f.id);
    setFeedSetup(null);
    setTab("staff");
  }, [feedSetup, calibration, frame, setFeeds]);
  const removeFeed = useCallback((feed) => {
    if (!window.confirm(`Remove the live feed from ${feed.lotName || "this lot"}?`)) return;
    setFeeds((prev) => prev.filter((x) => x.id !== feed.id));
    feedPictures.remove(feed.id);
    setActiveFeedId((id) => (id === feed.id ? null : id));
  }, [setFeeds]);
  // While this camera runs as a feed, its readings go to that lot (every 2 s).
  const lastFeedWrite = useRef(0);
  useEffect(() => {
    if (!activeFeedId || feedSetup || !live.statuses?.size || !(live.streaming || live.still)) return;
    const now = Date.now();
    if (now - lastFeedWrite.current < 2000) return;
    lastFeedWrite.current = now;
    const reading = readingFrom(calibration, live.statuses, now);
    setFeeds((prev) => prev.map((f) => (f.id === activeFeedId ? { ...f, calibration, reading } : f)));
  }, [live, activeFeedId, feedSetup, calibration, setFeeds]);

  const onLiveUpdate = useCallback((raw) => {
    if (raw.frame) { setFrame(raw.frame); return; }
    if (!raw.tracks) return;
    const update = raw;
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
  const occupiedKey = lot.stalls.map((s) => ({ occupied: 1, unknown: 2 }[shown.statuses.get(s.id)?.status] || 0)).join("");
  const recommended = useMemo(() => recommendStall(lot, graph, shown.statuses, lot.entrance, fromEntrance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lot, graph, fromEntrance, occupiedKey]);
  const route = useMemo(() => (recommended && lot.entrance ? routeToStall(lot, graph, recommended) : []), [lot, graph, recommended]);
  // The driver screen always follows the real lot (camera), not the demo
  // traffic; where the numbers come from is shown on it.
  const driverSource = live.streaming ? (live.still ? "photo" : "live") : "simulated";
  const driverTracks = useMemo(() => (live.streaming ? live.tracks.filter((t) => t.ground && t.vehicle_id) : []), [live]);
  // A complex: the Driver tab shows the whole complex on the satellite map.
  const complexLive = useMemo(() => {
    if (!complexView) return null;
    const { statuses, sources } = complexStatuses(complex, complexView.calibration, live.streaming ? { cameraId: complex.activeId, statuses: live.statuses } : null);
    const cam = activeCam?.link?.H ? activeCam : null;
    const tracks = cam && live.streaming
      ? driverTracks.map((t) => ({ ...t, ground: cameraLotToSiteLot(lot, complexView.lot, cam.link, t.ground) })).filter((t) => t.ground)
      : [];
    return { statuses, sources, tracks, areas: areaCounts(complexView.areas, statuses) };
  }, [complexView, complex, live, activeCam, driverTracks, lot]);
  const complexGraph = useMemo(() => (complexView ? buildLaneGraph(complexView.lot.lanes) : null), [complexView]);
  const complexFrom = useMemo(() => (complexView ? distancesFrom(complexGraph, complexView.lot.entrance) : null), [complexView, complexGraph]);
  const complexBackdrop = useMemo(() => (complexView && satellite ? { href: satellite.url, x: 0, y: 0, w: 100 * (complex.aspect || 1.5), h: 100 } : null), [complexView, satellite, complex?.aspect]);
  const showComplex = Boolean(complexView && complexBackdrop);
  const areasKey = JSON.stringify(complexLive?.areas?.map((a) => [a.open, a.taken, a.unknown]) || []);
  const driverLot = useMemo(() => (showComplex ? { ...complexView.lot, campus: true, areas: complexLive.areas } : lot),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showComplex, complexView, lot, areasKey]);
  const { scene, features, rect: sceneRect } = useScene(tab === "driver" ? (showComplex ? complexBackdrop : backdrop) : null, driverLot);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__smartparkComplex = () => ({ stalls: complexView?.calibration.stalls || [], statuses: [...(complexLive?.statuses || new Map()).entries()], areas: complexLive?.areas || [] });
    return () => { delete window.__smartparkComplex; };
  }, [complexView, complexLive]);
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
        {feedSetup && (
          <section className="rounded-xl border border-green-500/40 bg-green-500/[0.07] p-3 text-sm text-green-50">
            <p className="font-semibold">Live feed for {feedSetup.lotName || "a parking lot"} · {feedSetup.placeName}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-green-100/80">
              <li>Choose this lot&apos;s camera below: this device&apos;s camera, a phone, a video or a photo.</li>
              <li>Map the spaces (Find spaces, or draw them).</li>
              <li>Save: the lot on the Campus map then shows this camera&apos;s free spaces.</li>
            </ol>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={saveFeedSetup} disabled={!calibration.stalls.length}
                className="rounded-md bg-green-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                Save feed to lot{calibration.stalls.length ? ` (${calibration.stalls.length} spaces)` : ""}
              </button>
              <button onClick={() => { setFeedSetup(null); setTab("staff"); }} className="rounded-md px-3 py-1.5 text-xs text-green-100 ring-1 ring-green-400/40 hover:bg-white/5">Cancel</button>
              {!calibration.stalls.length && <span className="text-[11px] text-green-100/60">Map at least one space to save.</span>}
            </div>
          </section>
        )}
        {!feedSetup && activeFeed && (
          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/[0.05] px-3 py-2 text-xs text-green-100">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" /></span>
            This camera is the live feed for <b>{activeFeed.lotName || "a lot"}</b> · {activeFeed.placeName}
            {activeFeed.reading && <span className="text-green-200/70">· {activeFeed.reading.free} of {activeFeed.reading.total} free</span>}
            <button onClick={() => setActiveFeedId(null)} className="ml-auto rounded-md px-2 py-1 ring-1 ring-green-400/40 hover:bg-white/5">Stop feed</button>
          </section>
        )}
        <ComplexBar
          complex={complex}
          activeId={complex?.activeId}
          onAddSatellite={addSatellite}
          onRemove={removeComplex}
          onSwitch={switchCamera}
          onAddCamera={addCamera}
          onRename={renameCamera}
          onLink={() => setLinking(true)}
          canLink={Boolean(frame && satellite && calibration.stalls.length)}
          onShow={() => setTab("driver")}
        />
        {linking && frame && satellite && (
          <CameraLinkDialog
            cameraUrl={frame.url}
            siteUrl={satellite.url}
            cameraStalls={calibration.stalls}
            otherStalls={(complexView?.calibration.stalls || []).filter((s) => s.camera !== complex?.activeId)}
            initial={activeCam?.link}
            cameraAspect={frame.width / frame.height}
            onClose={() => setLinking(false)}
            onSave={saveLink}
          />
        )}
        <div className="flex min-h-[70vh] flex-1 flex-col">
          <LiveCamera
            calibration={calibration}
            onCalibrationChange={setCalibration}
            lot={lot}
            openPicture={openPicture}
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

      {(tab === "campus" || tab === "staff") && (
        <main className="flex flex-1 flex-col">
          <Suspense fallback={<p className="p-6 text-sm text-neutral-400">Loading 3D…</p>}>
            <CampusView mode={tab === "staff" ? "staff" : "user"} feeds={feeds} activeFeedId={activeFeedId}
              onAddFeed={addFeed} onOpenFeed={openFeed} onRemoveFeed={removeFeed} />
          </Suspense>
        </main>
      )}

      {tab === "driver" && (
        <main className="flex flex-1 flex-col">
          {lot.stalls.length || showComplex ? (
            <DriverView
              lot={driverLot}
              graph={showComplex ? complexGraph : graph}
              fromEntrance={showComplex ? complexFrom : fromEntrance}
              statuses={showComplex ? complexLive.statuses : realStatuses}
              tracks={showComplex ? complexLive.tracks : driverTracks}
              source={driverSource}
              backdrop={showComplex ? complexBackdrop : backdrop}
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
