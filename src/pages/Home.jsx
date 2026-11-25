import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import TopBar from "@/components/SmartPark/TopBar";
import ParkingCanvas from "@/components/SmartPark/ParkingCanvas";
import StatusPanel from "@/components/SmartPark/StatusPanel";
import LiveCamera from "@/components/SmartPark/LiveCamera";
import DriverGuide from "@/components/SmartPark/DriverGuide";
import LotMap from "@/components/SmartPark/LotMap";
import LotTwin from "@/components/SmartPark/LotTwin";
import SessionPanel from "@/components/SmartPark/SessionPanel";
import SessionDetailDialog from "@/components/SmartPark/SessionDetailDialog";
import TrackingPanel from "@/components/SmartPark/TrackingPanel";
import { buildLot, stepLot, recommendSpot } from "@/lib/lotSimulation";
import { saveLotLayout } from "@/lib/lotLayout";
import { makeVehicleId } from "@/lib/vehicleSessions";
import useVehicleSessions from "@/hooks/useVehicleSessions";
import { base44 } from "@/api/base44Client";
import { occupancyFromCars } from "@/lib/carDetect";
import { createTrackState, stepTracks } from "@/lib/vehicleTracker";
import { detectVehiclesWithAI } from "@/lib/aiDetect";
import scanFrameFile from "@/lib/scanFrameFile";

const STATUS_CYCLE = ["free", "occupied", "blocked"];
const STATUS_COLOR = {
  free: "#4CAF50",
  occupied: "#F44336",
  predicted: "#FFEB3B",
  blocked: "#2196F3",
};

export default function Home() {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoTracks, setPhotoTracks] = useState([]);
  const [detectionError, setDetectionError] = useState(null);
  // The captured frame is held here so it stays put while other tabs are open.
  const [snapshot, setSnapshot] = useState(null);
  const [spots, setSpots] = useState([]); // { id, x, y, status, label }
  const [lockedLayout, setLockedLayout] = useState(null); // fixed spot layout for live detection
  const [remoteCode, setRemoteCode] = useState("");
  const [calibration, setCalibration] = useState({
    spot: null,
    occupied: null,
    boundaries: [],
    streets: [],
    zones: [],
    entrance: null,
  }); // drawn empty spot, full spot, lot boundaries, lanes, camera zones + entrance
  const [view, setView] = useState("photo"); // photo | split | grid
  const [addSpots, setAddSpots] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [frame, setFrame] = useState(88992);
  const [present, setPresent] = useState(false);
  // The lot only moves on its own when the simulation is switched on, so a
  // non-live lot keeps a steady occupancy percentage.
  const [simRunning, setSimRunning] = useState(false);
  const vehicleSessions = useVehicleSessions();
  const [openSession, setOpenSession] = useState(null);
  const fileInputRef = useRef(null);
  const idCounter = useRef(0);
  const photoTrackerRef = useRef(createTrackState());
  const cameraTrackerRef = useRef(createTrackState());
  const photoScanRef = useRef(false);

  // Esc to exit present mode
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setPresent(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nextId = () => `spot-${idCounter.current++}`;

  // Auto-arrange spots into lettered rows based on y position
  const arrangeSpots = useCallback((list) => {
    if (list.length === 0) return list;
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    // group into rows by y proximity
    const rows = [];
    sorted.forEach((s) => {
      const row = rows.find((r) => Math.abs(r[0].y - s.y) < 40);
      if (row) row.push(s);
      else rows.push([s]);
    });
    rows.sort((a, b) => a[0].y - b[0].y);
    let labelIdx = 0;
    const updated = [];
    rows.forEach((row, ri) => {
      row.sort((a, b) => a.x - b.x);
      const letter = String.fromCharCode(65 + ri);
      row.forEach((s, ci) => {
        updated.push({ ...s, label: `${letter}${ci + 1}` });
      });
    });
    return updated;
  }, []);

  const handleAddSpot = (x, y) => {
    if (!addSpots) return;
    setSpots((prev) => arrangeSpots([...prev, { id: nextId(), x, y, status: "free", label: "" }]));
  };

  const handleSpotClick = (id, shift) => {
    setSpots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (shift) return null; // delete handled below
        const idx = STATUS_CYCLE.indexOf(s.status);
        return { ...s, status: STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] };
      }).filter(Boolean)
    );
  };

  const handleDeleteSpot = (id) => {
    setSpots((prev) => arrangeSpots(prev.filter((s) => s.id !== id)));
  };

  const clearSpots = () => {
    photoTrackerRef.current = createTrackState();
    setSpots([]);
    setPhotoTracks([]);
    setDetectionError(null);
    setSnapshot(null);
    setLockedLayout(null);
    setCalibration({
      spot: null,
      occupied: null,
      boundaries: [],
      streets: [],
      zones: [],
      entrance: null,
    });
  };

  const onFileSelected = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      photoTrackerRef.current = createTrackState();
      setPhotoUrl(e.target.result);
      setPhotoTracks([]);
      setDetectionError(null);
      setSpots([]);
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        onFileSelected(file);
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // Rescanning the same photo updates its tracks; it does not rename its cars.
  const runDetection = async () => {
    if (!photoUrl || photoScanRef.current) return;
    photoScanRef.current = true;
    const scanState = photoTrackerRef.current;
    setDetecting(true);
    setDetectionError(null);
    try {
      const image = new window.Image();
      image.src = photoUrl;
      await image.decode();
      const cars = await detectVehiclesWithAI({ source: image, width: image.naturalWidth, height: image.naturalHeight });
      if (photoTrackerRef.current !== scanState) return;
      const tracked = stepTracks(scanState, { detections: cars, singleFrame: true, observedSources: ["vision"] });
      photoTrackerRef.current = tracked.state;
      setPhotoTracks(tracked.tracks);
      setAddSpots(false);
      const blob = await (await fetch(photoUrl)).blob();
      const file = new File([blob], "parking.jpg", { type: blob.type || "image/jpeg" });
      const { file_uri, file_url } = await scanFrameFile(file);
      const { data } = await base44.functions.invoke("analyzeParkingFrame", { file_uri, file_url, width: image.naturalWidth, height: image.naturalHeight, layout_only: true });
      if (photoTrackerRef.current !== tracked.state) return;
      const res = data || {};

      if (res && res.spots) {
        // Keep actual image coordinates; only detected vehicle bodies decide occupancy.
        const newSpots = occupancyFromCars(res.spots, cars).map((sp) => {
          return {
            id: nextId(),
            x: sp.x,
            y: sp.y,
            status: sp.status,
            label: `${sp.row}${sp.index}`,
            confidence: sp.confidence,
          };
        });
        setSpots(newSpots);
      }
    } catch (err) {
      setDetectionError(err?.message || "The vehicle detector could not run.");
    } finally {
      photoScanRef.current = false;
      setDetecting(false);
      setFrame((f) => f + 1);
    }
  };

  // A simulated car gets its own temporary ID, so every car on screen is labelled.
  const simulateEnter = () => {
    setSpots((prev) => {
      const free = prev.find((s) => s.status === "free");
      if (!free) return prev;
      const vehicle_id = makeVehicleId(prev.map((s) => s.vehicle_id).filter(Boolean));
      return prev.map((s) =>
        s.id === free.id ? { ...s, status: "occupied", vehicle_id } : s
      );
    });
  };

  const simulateLeave = () => {
    setSpots((prev) => {
      const occ = prev.find((s) => s.status === "occupied");
      if (!occ) return prev;
      return prev.map((s) =>
        s.id === occ.id ? { ...s, status: "free", vehicle_id: "" } : s
      );
    });
  };

  const handleFrameUpdate = useCallback(() => setFrame((f) => f + 1), []);
  const handlePhoneDisplay = useCallback(() => setView("live"), []);

  const recommended = useMemo(() => recommendSpot(spots), [spots]);

  // The twin starts empty every time it is opened: it only carries the vehicles
  // being followed right now plus the ones seen since this page loaded, so IDs
  // left over from an earlier run never reappear on the map.
  const twinSinceRef = useRef(Date.now());
  const lotSessions = useMemo(() => {
    const labels = new Set(spots.map((s) => String(s.label)));
    const tracked = new Set(
      vehicleSessions.tracks.filter((t) => t.vehicle_id).map((t) => t.vehicle_id)
    );
    return vehicleSessions.active.filter((s) => {
      if (spots.length && s.spot_label && !labels.has(String(s.spot_label))) return false;
      if (tracked.has(s.vehicle_id)) return true;
      const seen = new Date(s.last_seen_at || s.entry_time || 0).getTime();
      return seen >= twinSinceRef.current;
    });
  }, [spots, vehicleSessions.active, vehicleSessions.tracks]);

  // Opening the twin starts its vehicle list from scratch.
  useEffect(() => {
    if (view === "twin") twinSinceRef.current = Date.now();
  }, [view]);

  // Guide view runs itself: seed a lot on entry, then keep cars moving.
  useEffect(() => {
    if (view !== "guide") return;
    setSpots((prev) => (prev.length ? prev : buildLot()));
  }, [view]);

  useEffect(() => {
    if (view !== "guide" || !simRunning) return;
    const timer = setInterval(() => {
      setSpots((prev) => (prev.length ? stepLot(prev) : buildLot()));
    }, 3500);
    return () => clearInterval(timer);
  }, [view, simRunning]);

  // The mapped lot is saved, so the driver view can draw the same map the
  // operator calibrated without needing a camera.
  const layoutSignature = useMemo(
    () =>
      JSON.stringify({
        spots: spots.map((s) => `${s.label}:${Math.round(s.x)}:${Math.round(s.y)}`),
        streets: calibration.streets,
        zones: calibration.zones,
        entrance: calibration.entrance,
      }),
    [spots, calibration]
  );

  useEffect(() => {
    if (!spots.length) return undefined;
    const timer = setTimeout(() => {
      saveLotLayout({
        spots,
        streets: calibration.streets || [],
        zones: calibration.zones || [],
        entrance: calibration.entrance,
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [layoutSignature]);

  const stats = {
    total: spots.length,
    free: spots.filter((s) => s.status === "free").length,
    occupied: spots.filter((s) => s.status === "occupied").length,
    blocked: spots.filter((s) => s.status === "blocked").length,
    predicted: spots.filter((s) => s.status === "predicted").length,
  };

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col">
      {!present && (
        <TopBar
          view={view}
          setView={setView}
          addSpots={addSpots}
          setAddSpots={setAddSpots}
          onLoadPhoto={() => fileInputRef.current?.click()}
          onClearSpots={clearSpots}
          onDetect={runDetection}
          detecting={detecting}
          onPresent={() => setPresent(true)}
        />
      )}
      {detectionError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{detectionError}</p>}
      {present && (
        <button
          onClick={() => setPresent(false)}
          className="fixed top-3 right-3 z-50 text-xs text-neutral-400 hover:text-white border border-neutral-700 rounded px-2 py-1 bg-neutral-900/80"
        >
          Exit Present (Esc)
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFileSelected(e.target.files?.[0])}
      />

      <main className={`flex-1 flex flex-col ${view === "guide" || view === "twin" ? "" : "lg:flex-row"} gap-4 p-4 ${present ? "p-0 gap-0" : ""}`}>
        {(view === "live" || view === "guide" || Boolean(remoteCode)) && (
          <div
            className={
              view === "live"
                ? "lg:w-1/2 min-h-0"
                : view === "guide"
                ? "order-last h-[230px] flex-none min-h-0 overflow-hidden"
                : "hidden"
            }
          >
            <LiveCamera
              trackingStateRef={cameraTrackerRef}
              snapshot={snapshot}
              onSnapshotChange={setSnapshot}
              remoteCode={remoteCode}
              onRemoteCodeChange={setRemoteCode}
              onPhoneDisplay={handlePhoneDisplay}
              onTracksUpdate={vehicleSessions.ingest}
              assignVehicleId={vehicleSessions.assignVehicleId}
              lockedLayout={lockedLayout}
              onLockLayout={setLockedLayout}
              onSpotsUpdate={setSpots}
              onFrameUpdate={handleFrameUpdate}
              onOpenSimulation={view === "live" ? () => setView("guide") : undefined}
              calibration={calibration}
              onCalibrationChange={setCalibration}
            />
          </div>
        )}
        {view === "guide" && (
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="lg:w-2/3 flex flex-col gap-4 min-w-0">
                <LotMap
                  spots={spots}
                  recommended={recommended}
                  streets={calibration.streets || []}
                  entrance={calibration.entrance}
                  sessions={vehicleSessions.active}
                  tracks={vehicleSessions.tracks}
                />
              </div>
              <div className="lg:w-1/3 min-w-0">
                <DriverGuide
                  spots={spots}
                  stats={stats}
                  recommended={recommended}
                  streets={calibration.streets || []}
                  entrance={calibration.entrance}
                  simRunning={simRunning}
                  onToggleSim={() => setSimRunning((v) => !v)}
                  onSimulateEnter={simulateEnter}
                  onSimulateLeave={simulateLeave}
                />
              </div>
            </div>

          </div>
        )}
        {view === "twin" && (
          <div className="flex-1 min-w-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_370px]">
            <LotTwin
              spots={spots}
              sessions={lotSessions}
              tracks={vehicleSessions.tracks}
              zones={calibration.zones || []}
              streets={calibration.streets || []}
              entrance={calibration.entrance}
              onLoadSample={spots.length ? undefined : () => setSpots(buildLot())}
            />
            <div className="flex min-h-0 flex-col gap-4">
              <SessionPanel
                active={lotSessions}
                closed={vehicleSessions.closed}
                ready={vehicleSessions.ready}
                busy={vehicleSessions.busy}
                error={vehicleSessions.error}
                onEnter={() => vehicleSessions.enter(spots)}
                onConfirm={vehicleSessions.confirm}
                onExit={vehicleSessions.exit}
                onOpen={setOpenSession}
              />
              <TrackingPanel
                tracks={vehicleSessions.tracks}
                sessions={lotSessions}
                log={vehicleSessions.log}
                zones={calibration.zones || []}
                onOpen={setOpenSession}
              />
            </div>
          </div>
        )}
        {(view === "photo" || view === "split") && (
          <div className={`relative ${view === "split" ? "lg:w-1/2" : "lg:w-1/2"} ${present ? "w-1/2" : ""}`}>
            <ParkingCanvas
              photoUrl={photoUrl}
              tracks={photoTracks}
              spots={spots}
              onAddSpot={handleAddSpot}
              onSpotClick={handleSpotClick}
              onDeleteSpot={handleDeleteSpot}
              addSpots={addSpots}
              hide={view === "grid"}
            />
          </div>
        )}
        {(view === "grid" || view === "split" || view === "live") && (
          <div className={`flex-1 ${view === "split" ? "lg:w-1/2" : ""}`}>
            <StatusPanel
              stats={stats}
              spots={spots}
              onSimulateEnter={simulateEnter}
              onSimulateLeave={simulateLeave}
              frame={frame}
              detecting={detecting}
              onDetect={runDetection}
            />
          </div>
        )}
      </main>

      <SessionDetailDialog
        session={openSession}
        open={Boolean(openSession)}
        onOpenChange={(next) => !next && setOpenSession(null)}
      />
    </div>
  );
}