import React, { useRef, useState, useEffect, useCallback } from "react";
import { Video, VideoOff, Loader2, Smartphone } from "lucide-react";
import { base44 } from "@/api/base44Client";
import SpotCalibrator from "@/components/SmartPark/SpotCalibrator";
import RemoteCameraDialog from "@/components/SmartPark/RemoteCameraDialog";
import LiveCameraTools from "@/components/SmartPark/LiveCameraTools";
import TrackBoxes from "@/components/SmartPark/TrackBoxes";
import { buildSpotGrid } from "@/lib/spotGrid";
import { occupancyFromCars } from "@/lib/carDetect";
import { createDetectionState, detectCameraVehicles } from "@/lib/liveVehicleDetection";
import useRemoteCamera, { makePairCode } from "@/lib/useRemoteCamera";
import usePhoneFrames from "@/lib/usePhoneFrames";
import { captureCameraImage } from "@/lib/cameraSession";
import scanFrameFile from "@/lib/scanFrameFile";
import { createTrackState, stepTracks } from "@/lib/vehicleTracker";
import freezeDetectionFrame from "@/lib/freezeDetectionFrame";
import { Image as CameraImage } from "@/components/ui/image";

const EMPTY_LIST = [];
const SCAN_PAUSE_MS = 3000;

// The live feed measures the lot from what you draw. Only the reference spot
// and lot boundaries are overlaid; detection results stay off the camera image.
export default function LiveCamera({
  lockedLayout,
  onLockLayout,
  onSpotsUpdate,
  onFrameUpdate,
  onOpenSimulation,
  calibration,
  onCalibrationChange,
  remoteCode = "",
  onRemoteCodeChange,
  onPhoneDisplay,
  remoteRole = "viewer",
  autoStart = false,
  onTracksUpdate,
  assignVehicleId,
  snapshot = null,
  onSnapshotChange,
  trackingStateRef,
}) {
  const videoRef = useRef(null);
  const boxRef = useRef(null);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [captured, setCaptured] = useState(false);
  const [cars, setCars] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [grid, setGrid] = useState([]);
  const [tool, setTool] = useState("none");
  // The captured frame lives in the page, not in this view, so it survives a switch
  // to another tab and is still here when the live view comes back.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const setSnapshot = useCallback(
    (next) => {
      snapshotRef.current = next;
      onSnapshotChange?.(next);
    },
    [onSnapshotChange]
  );
  const [snapshotSize, setSnapshotSize] = useState(null);
  const [frameRect, setFrameRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const scanningRef = useRef(false);
  const remoteImgRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [remoteVideoPlaying, setRemoteVideoPlaying] = useState(false);
  const displayedCodeRef = useRef("");
  const snapshotImgRef = useRef(null);
  const facingRef = useRef("environment");
  const readingRef = useRef(false);
  const autoLayoutRef = useRef([]);
  const mapLotRef = useRef(null);
  const mappingRef = useRef(false);
  const detectorRef = useRef(createDetectionState());
  const [remoteOpen, setRemoteOpen] = useState(false);
  const localTrackerRef = useRef(createTrackState());
  const trackerRef = trackingStateRef || localTrackerRef;
  const lastReadAtRef = useRef(0);
  const scanContextRef = useRef(null);
  const zonesRef = useRef([]);
  const issuedRef = useRef(new Set());
  const remote = useRemoteCamera(remoteCode, remoteRole);
  const { frame: remoteFrame, stream: remoteStream, cameras: remoteCameras, receiving: remoteReceiving } = remote;
  const useRemoteVideo = Boolean(remoteStream && remoteVideoPlaying);
  const remoteActive = Boolean(useRemoteVideo || remoteFrame);
  const streaming = active || remoteActive || Boolean(snapshot);
  usePhoneFrames(videoRef, active && remoteRole === "camera" && remote.connected, remote.sendFrame);

  const displayPhonePicture = () => {
    measure();
    remote.acknowledge();
    setRemoteOpen(false);
    if (displayedCodeRef.current === remoteCode) return;
    displayedCodeRef.current = remoteCode;
    setSnapshot(null);
    setSnapshotSize(null);
    onPhoneDisplay?.();
  };

  useEffect(() => {
    if (remote.calibration) onCalibrationChange?.(remote.calibration);
  }, [remote.calibration, onCalibrationChange]);
  useEffect(() => {
    if (!remote.spots) return;
    onLockLayout?.(remote.spots);
    onSpotsUpdate?.(remote.spots);
    setCaptured(remote.spots.length > 0);
    if (calibration?.spot && calibration?.boundaries?.length) {
      const statuses = new Map(remote.spots.map((spot) => [spot.id, spot.status]));
      setGrid(buildSpotGrid(calibration.spot, calibration.boundaries).map((cell, i) => ({
        ...cell, status: statuses.get(`cam-${i}`) || cell.status,
      })));
    }
  }, [remote.spots, onLockLayout, onSpotsUpdate, calibration]);
  useEffect(() => {
    if (remote.snapshot) { setSnapshot(remote.snapshot.data); setSnapshotSize(null); }
  }, [remote.snapshot]);

  const openRemote = () => {
    if (!remoteCode) onRemoteCodeChange?.(makePairCode());
    setRemoteOpen(true);
  };
  const stopRemote = () => {
    remote.endSession();
    onRemoteCodeChange?.("");
    setRemoteOpen(false);
    setSnapshot(null);
    setSnapshotSize(null);
    setTool("none");
  };

  const spotBox = calibration?.spot || null;
  const boundaries = calibration?.boundaries || EMPTY_LIST;
  const streets = calibration?.streets || EMPTY_LIST;
  zonesRef.current = calibration?.zones || EMPTY_LIST;
  scanContextRef.current = { spotBox, boundaries };

  const updateCalibration = (next) => {
    onCalibrationChange?.(next);
    remote.publishCalibration(next);
  };

  // The video letterboxes inside its box; keep the overlay exactly on the picture.
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const video = useRemoteVideo ? remoteVideoRef.current : videoRef.current;
    const img = snapshot ? snapshotImgRef.current : !useRemoteVideo ? remoteImgRef.current : null;
    const useImage = Boolean(snapshot || (!useRemoteVideo && remoteFrame));
    const vw = useImage ? img?.naturalWidth : video?.videoWidth;
    const vh = useImage ? img?.naturalHeight : video?.videoHeight;
    if (!vw || !vh) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const ratio = vw / vh;
    const width = cw / ch > ratio ? ch * ratio : cw;
    const height = cw / ch > ratio ? ch : cw / ratio;
    setFrameRect({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
  }, [remoteActive, useRemoteVideo, snapshot]);

  useEffect(() => {
    setRemoteVideoPlaying(false);
    const video = remoteVideoRef.current;
    if (!video) return;
    video.srcObject = remoteStream || null;
    if (remoteStream) video.play().catch(() => setScanError("Click the phone picture to start playback."));
  }, [remoteStream]);

  useEffect(() => {
    if (!streaming) return;
    measure();
    const observer = new ResizeObserver(measure);
    if (boxRef.current) observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, [streaming, measure]);

  const startCamera = async () => {
    setError(null);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingRef.current, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setTimeout(measure, 300);
    } catch (err) {
      setError(err.message || "Could not access camera");
    }
  };

  const stopCamera = (resetTracking = true) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActive(false);
    setScanning(false);
    setTool("none");
    setTracks([]);
    setCars([]);
    if (resetTracking) trackerRef.current = createTrackState();
    detectorRef.current = createDetectionState();
    scanningRef.current = false;
  };

  // Capture whichever source is actually on screen, including the phone feed.
  const captureFrame = async () => {
    if (remoteFrameRef.current && !remoteStreamRef.current && !snapshotRef.current) {
      setSnapshot(remoteFrameRef.current);
      setSnapshotSize(null);
      remote.sendSnapshot(remoteFrameRef.current);
      return;
    }
    const frame = await frameSource();
    if (!frame) return;
    const image = captureCameraImage(frame.source, frame.width, frame.height);
    setSnapshot(image.data);
    setSnapshotSize({ width: image.width, height: image.height });
    remote.sendSnapshot(image.data);
  };

  useEffect(() => { if (autoStart) startCamera(); }, [autoStart]);
  useEffect(() => () => stopCamera(false), []);

  // The still frame (if captured) or the live video, in its own pixel size.
  // Frame sources live in refs so a streaming phone does not re-arm detection
  // on every frame it delivers.
  const snapshotSizeRef = useRef(snapshotSize);
  const remoteFrameRef = useRef(remoteFrame);
  const remoteStreamRef = useRef(null);
  remoteStreamRef.current = useRemoteVideo ? remoteStream : null;
  snapshotSizeRef.current = snapshotSize;
  remoteFrameRef.current = remoteFrame;

  const frameSource = useCallback(async () => {
    const still = snapshotRef.current;
    if (still) {
      const img = new window.Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = still;
      });
      return {
        source: img,
        width: img.naturalWidth || snapshotSizeRef.current?.width || 0,
        height: img.naturalHeight || snapshotSizeRef.current?.height || 0,
      };
    }
    if (remoteStreamRef.current) {
      const video = remoteVideoRef.current;
      if (video?.readyState >= 2 && video.videoWidth) return freezeDetectionFrame(video, video.videoWidth, video.videoHeight);
    }
    if (remoteFrameRef.current) {
      const img = remoteImgRef.current;
      if (!img || !img.complete || !img.naturalWidth) return null;
      return freezeDetectionFrame(img, img.naturalWidth, img.naturalHeight);
    }
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return freezeDetectionFrame(video, video.videoWidth, video.videoHeight);
  }, []);

  // One layout feeds the map, the status panel and the paired phone. It is only
  // sent when a stall actually changed, so a quiet lot stays quiet.
  const layoutSignatureRef = useRef("");
  const publishLayout = (spots) => {
    if (!spots.length) return;
    const layout = spots.map((sp, i) => ({
      id: `cam-${i}`,
      x: Number(sp.x) || 50,
      y: Number(sp.y) || 50,
      status: sp.status || "free",
      label: `${sp.row ?? "A"}${sp.index ?? i + 1}`,
      confidence: sp.confidence,
    }));
    const signature = layout.map((s) => s.status).join("");
    if (signature === layoutSignatureRef.current) return;
    layoutSignatureRef.current = signature;
    onLockLayout?.(layout);
    onSpotsUpdate?.(layout);
    remote.publishSpots(layout);
    setCaptured(true);
  };
  const publishLayoutRef = useRef(null);
  publishLayoutRef.current = publishLayout;

  // One tracking beat: the vehicles just found are matched to the vehicles already
  // being followed, so a car keeps its temporary ID while it drives across the lot
  // and from one camera zone into the next.
  const trackStepRef = useRef(null);
  trackStepRef.current = (found, cells, observedSources) => {
    const result = stepTracks(trackerRef.current, {
      detections: found,
      observedSources,
      singleFrame: Boolean(snapshotRef.current),
      zones: zonesRef.current,
      cells,
      now: Date.now(),
      // Two cars stamped in the same beat must never share an ID, so the IDs
      // already handed out in this session are passed in with the request.
      assignId: () => {
        const issued = [...issuedRef.current];
        const id = assignVehicleId
          ? assignVehicleId(issued)
          : `SP-${String(issued.length + 1).padStart(3, "0")}`;
        issuedRef.current.add(id);
        return id;
      },
    });
    trackerRef.current = result.state;
    setTracks(result.tracks);
    // The vehicles counted on the frame are exactly the ones occupancy was decided from.
    setCars(found);
    onTracksUpdate?.(result.tracks, result.events);
  };

  // Recognition is the only writer of vehicle geometry.
  const readFrame = useCallback(async (frame, cells, { forceVision = false } = {}) => {
    const result = await detectCameraVehicles(detectorRef.current, frame, {
      forceVision,
      still: Boolean(snapshotRef.current),
    });
    return { ...result, spots: occupancyFromCars(cells, result.cars) };
  }, []);

  // The one box drawn on the lot is only the size of a stall: the stalls are tiled
  // from it, and every one of them is then decided by the vehicles the AI finds.
  const applyStallSize = (box) => {
    updateCalibration({ ...calibration, spot: box, spotRef: null, occupied: null, occupiedRef: null });
    setCars([]);
    setTool("none");
    if (!box || !boundaries.length) return;
    const cells = buildSpotGrid(box, boundaries);
    setGrid(cells);
    publishLayout(cells);
  };

  // With no mapped lot there are no stalls to measure, so the frame is mapped
  // once by the AI instead.
  const mapLotWithAI = async (frame) => {
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d").drawImage(frame.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not grab a frame from the camera");
    const file = new File([blob], `frame-${Date.now()}.jpg`, { type: "image/jpeg" });
    const { file_uri, file_url } = await scanFrameFile(file);
    const { data } = await base44.functions.invoke("analyzeParkingFrame", {
      file_uri,
      file_url,
      width: canvas.width,
      height: canvas.height,
      layout_only: true,
    });
    return data?.spots || [];
  };
  mapLotRef.current = mapLotWithAI;

  const scanFrame = useCallback(async () => {
    if (scanningRef.current || readingRef.current) return;
    scanningRef.current = true;
    readingRef.current = true;
    setScanning(true);
    setScanError(null);
    remote.publishScan(true);
    let failure = null;
    try {
      const cells = spotBox && boundaries.length ? buildSpotGrid(spotBox, boundaries) : [];
      const frame = await frameSource();
      if (!frame) {
        failure = "Camera is still warming up — try again in a second.";
        setScanError(failure);
        return;
      }

      const detector = detectorRef.current;
      const result = await readFrame(frame, cells, { forceVision: true });
      if (detector !== detectorRef.current) return;
      setScanError(result.warning || null);
      trackStepRef.current?.(result.cars, cells, result.observedSources);
      let spots = result.spots;
      if (!cells.length) {
        // Layout mapping is separate; it never supplies vehicle boxes or occupancy.
        const mapped = await mapLotWithAI(frame);
        if (detector !== detectorRef.current) return;
        autoLayoutRef.current = mapped;
        spots = occupancyFromCars(mapped, result.cars);
      }

      setGrid(spots);
      layoutSignatureRef.current = "";
      publishLayout(spots);
      onFrameUpdate?.();
    } catch (err) {
      console.error("Frame analysis failed", err);
      failure = err?.message || "Could not analyze this frame";
      setScanError(failure);
    } finally {
      lastReadAtRef.current = Date.now();
      setScanning(false);
      scanningRef.current = false;
      readingRef.current = false;
      remote.publishScan(false, failure);
    }
  }, [onFrameUpdate, spotBox, boundaries, frameSource, readFrame]);

  // One serialized scan, then a three-second rest. Incoming phone frames, layout
  // edits and ordinary renders cannot re-arm the timer or start another scan.
  useEffect(() => {
    if (!streaming) return undefined;
    let cancelled = false;
    let timer;
    const read = async () => {
      if (cancelled) return;
      const remaining = SCAN_PAUSE_MS - (Date.now() - lastReadAtRef.current);
      if (readingRef.current || remaining > 0) {
        timer = setTimeout(read, Math.max(SCAN_PAUSE_MS, remaining));
        return;
      }
      readingRef.current = true;
      setDetecting(true);
      const detector = detectorRef.current;
      try {
        const frame = await frameSource();
        if (!frame || cancelled) return;
        const { spotBox: spot, boundaries: areas } = scanContextRef.current;
        let cells = spot && areas.length ? buildSpotGrid(spot, areas) : autoLayoutRef.current;
        // Without a drawn layout the lot is mapped once from the live frame, so the
        // occupancy grid follows the feed instead of holding an earlier result.
        if (!cells.length && !mappingRef.current) {
          mappingRef.current = true;
          try {
            const mapped = await mapLotRef.current?.(frame);
            if (mapped?.length) autoLayoutRef.current = mapped;
            cells = mapped || [];
          } finally {
            mappingRef.current = false;
          }
          if (cancelled) return;
        }
        const result = await readFrame(frame, cells);
        if (cancelled || detector !== detectorRef.current) return;
        setScanError(result.warning || null);
        trackStepRef.current?.(result.cars, cells, result.observedSources);
        setGrid(result.spots);
        publishLayoutRef.current?.(result.spots);
      } catch (err) {
        if (!cancelled) setScanError(err?.message || "The vehicle detector could not run.");
      } finally {
        lastReadAtRef.current = Date.now();
        readingRef.current = false;
        if (!cancelled) {
          setDetecting(false);
          if (!snapshot) timer = setTimeout(read, SCAN_PAUSE_MS);
        }
      }
    };
    read();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [streaming, snapshot, frameSource, readFrame]);

  const calibrated = Boolean(spotBox && boundaries.length);

  return (
    <div className="flex w-full h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div
        ref={boxRef}
        className="relative w-full flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-800 bg-black flex items-center justify-center"
      >
      <video
        ref={videoRef}
        playsInline
        muted
        onLoadedMetadata={measure}
        className="w-full h-full object-contain"
        style={{ display: active && !remoteActive ? "block" : "none" }}
      />
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={measure}
        onPlaying={() => { setRemoteVideoPlaying(true); displayPhonePicture(); }}
        onWaiting={() => setRemoteVideoPlaying(false)}
        onPause={() => setRemoteVideoPlaying(false)}
        onEmptied={() => setRemoteVideoPlaying(false)}
        onClick={(event) => event.currentTarget.play()}
        className={`absolute inset-0 w-full h-full object-contain ${useRemoteVideo ? "" : "opacity-0 pointer-events-none"}`}
      />

      {remoteFrame && !useRemoteVideo && (
        <CameraImage
          ref={remoteImgRef}
          src={remoteFrame}
          alt="Phone camera feed"
          fittingType="fit"
          onLoad={displayPhonePicture}
          className="absolute inset-0 w-full h-full object-contain"
        />
      )}

      {snapshot && (
        <CameraImage
          ref={snapshotImgRef}
          src={snapshot}
          alt="Captured frame"
          fittingType="fit"
          onLoad={measure}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
      )}

      {/* Everything inside this layer is in percentages of the video frame */}
      {streaming && (
        <div
          className="absolute"
          style={{
            left: frameRect.left,
            top: frameRect.top,
            width: frameRect.width,
            height: frameRect.height,
          }}
        >
          {tool !== "none" && <SpotCalibrator
            tool={tool}
            spotBox={spotBox}
            boundaries={boundaries}
            streets={streets}
            zones={calibration?.zones || []}
            entrance={calibration?.entrance}
            onAddZone={(box) => {
              const zones = calibration?.zones || [];
              updateCalibration({
                ...calibration,
                zones: [
                  ...zones,
                  {
                    name: String.fromCharCode(65 + zones.length),
                    camera: `CAM ${zones.length + 1}`,
                    ...box,
                  },
                ],
              });
              setTool("none");
            }}
            onRemoveZone={(index) =>
              updateCalibration({
                ...calibration,
                zones: (calibration?.zones || []).filter((_, i) => i !== index),
              })
            }
            grid={grid}
            onEntrance={(point) => {
              updateCalibration({ ...calibration, entrance: point });
              setTool("none");
            }}
            onSpotBox={applyStallSize}
            onAddBoundary={(box) => {
              updateCalibration({ ...calibration, boundaries: [...boundaries, box] });
              setCars([]);
            }}
            onRemoveBoundary={(index) =>
              updateCalibration({
                ...calibration,
                boundaries: boundaries.filter((_, i) => i !== index),
              })
            }
            onAddStreet={(box) =>
              updateCalibration({ ...calibration, streets: [...streets, box] })
            }
            onRemoveStreet={(index) =>
              updateCalibration({
                ...calibration,
                streets: streets.filter((_, i) => i !== index),
              })
            }
          />}
          {tool === "none" && <TrackBoxes tracks={tracks} />}
        </div>
      )}

      {streaming && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur px-2.5 py-1.5 rounded-full">
          <span
            className={`w-2 h-2 rounded-full ${
              snapshot ? "bg-yellow-400" : "bg-red-500 animate-pulse"
            }`}
          />
          <span className="text-[11px] font-mono text-white">
            {snapshot ? "CAPTURED" : remoteRole === "camera" ? (remoteReceiving ? "PHONE CONNECTED" : "WAITING FOR COMPUTER") : active ? "LIVE" : "PHONE"}
          </span>
          {(scanning || detecting) && (
            <span className="flex items-center gap-1 text-[11px] text-green-400">
              <Loader2 className="w-3 h-3 animate-spin" /> detecting
            </span>
          )}
        </div>
      )}

      {streaming && (
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur px-2.5 py-1.5 rounded-full text-[11px] font-mono" aria-busy={detecting || scanning}>
          <span className="text-green-400">
            {grid.length > 0 && <>{grid.filter((s) => s.status === "occupied").length}/{grid.length} taken · {grid.filter((s) => s.status === "free").length} free · </>}{cars.length} vehicles
          </span>
        </div>
      )}

      {streaming && (scanError || remote.scanError || remote.error) && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 max-w-[90%] text-center bg-red-500/20 border border-red-500/50 text-red-200 text-[11px] px-3 py-1.5 rounded-full">
          {scanError || remote.scanError || remote.error}
        </div>
      )}

      {!streaming && (
        <div className="text-center px-6 py-16">
          {error ? (
            <>
              <VideoOff className="w-10 h-10 mx-auto mb-3 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
              <button
                onClick={startCamera}
                className="mt-4 text-xs px-4 py-2 rounded border border-green-500 text-green-400 hover:bg-green-500/10"
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <Video className="w-10 h-10 mx-auto mb-3 text-green-400" />
              <p className="text-sm text-neutral-300 mb-1">Live feed → simulation</p>
              <p className="text-xs text-neutral-500 mb-4">
                Point the camera at vehicles to detect them automatically. Parking-space mapping is optional.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={startCamera}
                  className="text-xs px-4 py-2 rounded border border-green-500 text-green-400 hover:bg-green-500/10"
                >
                  Start live feed
                </button>
                <button
                  onClick={openRemote}
                  className="flex items-center gap-1.5 text-xs px-4 py-2 rounded border border-neutral-600 text-neutral-300 hover:border-green-500 hover:text-green-400"
                >
                  <Smartphone className="w-3.5 h-3.5" /> Use phone as camera
                </button>
              </div>
            </>
          )}
        </div>
      )}

      </div>

      {streaming && (
        <LiveCameraTools
          tool={tool}
          onTool={(next) => {
            setCars([]);
            setTool(next);
          }}
          canClear={Boolean(
            spotBox || boundaries.length || streets.length || calibration?.entrance
          )}
          onClear={() => {
            updateCalibration({
              spot: null,
              boundaries: [],
              streets: [],
              zones: [],
              entrance: null,
            });
            autoLayoutRef.current = [];
            setGrid([]);
            setCars([]);
            setCaptured(false);
            trackerRef.current = createTrackState();
            issuedRef.current = new Set();
                    detectorRef.current = createDetectionState();
            setTracks([]);
            onTracksUpdate?.([], []);
            layoutSignatureRef.current = "";
            onLockLayout?.([]);
            onSpotsUpdate?.([]);
            remote.publishSpots([]);
          }}
          snapshot={snapshot}
          onCapture={() => {
            if (snapshot) {
              setSnapshot(null);
              setSnapshotSize(null);
              remote.resume();
            } else {
              captureFrame();
            }
          }}
          onScan={scanFrame}
          busy={scanning || remote.scanning || detecting}
          calibrated={calibrated}
          captured={captured}
          onOpenSimulation={onOpenSimulation}
          active={active}
          onStop={stopCamera}
          onStartCamera={() => {
            // A kept capture would sit over the feed, so it is put away first.
            setSnapshot(null);
            setSnapshotSize(null);
            startCamera();
          }}
          remoteRole={remoteRole}
          remoteOpen={remoteOpen}
          onOpenRemote={openRemote}
          onSwitchCamera={() => {
            facingRef.current = facingRef.current === "environment" ? "user" : "environment";
            setSnapshot(null);
            remote.resume();
            startCamera();
          }}
        />
      )}

      <RemoteCameraDialog
        open={remoteOpen}
        onOpenChange={setRemoteOpen}
        code={remoteCode}
        ready={remote.connected}
        cameras={remoteCameras}
        receiving={remoteReceiving}
        error={remote.error}
        onStop={stopRemote}
        onNewCode={() => {
          remote.endSession();
          setSnapshot(null);
          setSnapshotSize(null);
          onRemoteCodeChange?.(makePairCode());
        }}
      />
    </div>
  );
}