import React, { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Eraser, FileVideo, Grid3x3, Loader2, MapPin, Pause, Play, Route, ScanSearch,
  Smartphone, Sparkles, Square, SquareDashed, Trash2, Video, VideoOff, LogOut as ExitIcon,
} from "lucide-react";
import RemoteCameraDialog from "@/components/SmartPark/RemoteCameraDialog";
import { makePairCode, receivePhoneCamera } from "@/lib/phoneLink";
import { detectVehiclesLocal, onDetectorStatus, preloadDetector, setDetectorModel, MODELS } from "@/lib/vision/vehicleDetector";
import { createTracker } from "@/lib/vision/tracker";
import {
  assignVehiclesToStalls, createOccupancy, groundPoint, guessView, makeStallRow, nextRowLetter,
} from "@/lib/vision/lot";
import { drawOverlay } from "@/lib/vision/overlay";
import { autoMapLot } from "@/lib/vision/autoMap";
import { imagePixels, stallAppearance } from "@/lib/vision/stallFinder";
import { pointInPolygon, projectOnSegment } from "@/lib/vision/geometry";

const TOOLS = {
  row: { label: "Stall row", icon: Grid3x3, points: 4, color: "#22d3ee", hint: ["Click the front-left corner of the row (aisle side)", "Front-right corner", "Back-right corner", "Back-left corner"] },
  stall: { label: "Single stall", icon: Square, points: 4, color: "#22d3ee", hint: ["Front-left corner (aisle side)", "Front-right corner", "Back-right corner", "Back-left corner"] },
  lane: { label: "Driving lane", icon: Route, points: Infinity, color: "#60a5fa", hint: ["Click along the centre of the lane, in driving direction. Double-click or press Enter to finish."] },
  entrance: { label: "Entrance", icon: MapPin, points: 1, color: "#4ade80", hint: ["Click where cars enter the lot"] },
  exit: { label: "Exit", icon: ExitIcon, points: 1, color: "#f472b6", hint: ["Click where cars leave the lot"] },
  ground: { label: "Lot corners", icon: SquareDashed, points: 4, color: "#38bdf8", hint: ["Click the far-left corner of the paved lot", "Far-right corner", "Near-right corner", "Near-left corner"] },
  erase: { label: "Erase", icon: Eraser, points: 0, color: "#f87171", hint: ["Click a stall or lane to remove it"] },
};

const SOURCES_IDLE = "none";

export default function LiveCamera({
  calibration,
  onCalibrationChange,
  lot,
  onUpdate,
  assignVehicleId,
  remoteCode = "",
  onRemoteCodeChange,
  visible = true,
}) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const webcamRef = useRef(null);
  const phoneVideoRef = useRef(null);
  const fileVideoRef = useRef(null);
  const fileImgRef = useRef(null);
  const frozenRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const [source, setSource] = useState(SOURCES_IDLE); // none | webcam | phone | image | video
  const [fileUrl, setFileUrl] = useState(null);
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [detector, setDetector] = useState({ state: "idle" });
  const [perf, setPerf] = useState({ fps: 0, ms: 0, tiled: false });
  const [counts, setCounts] = useState({ vehicles: 0, free: 0, occupied: 0 });
  const [tiling, setTiling] = useState("auto"); // auto | on | off
  const [tool, setTool] = useState(null);
  const [draft, setDraft] = useState([]);
  const [rowCount, setRowCount] = useState(8);
  const [groundSize, setGroundSize] = useState({ width: 60, length: 40 });
  const [frameRect, setFrameRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [remoteOpen, setRemoteOpen] = useState(false);

  const [phoneStream, setPhoneStream] = useState(null);
  const [phoneStatus, setPhoneStatus] = useState({ state: "starting" });
  const [phoneVideoPlaying, setPhoneVideoPlaying] = useState(false);

  // Wait for the phone while the phone source is selected.
  useEffect(() => {
    if (source !== "phone" || !remoteCode) return undefined;
    setPhoneStatus({ state: "starting" });
    const link = receivePhoneCamera(remoteCode, { onStream: setPhoneStream, onStatus: setPhoneStatus });
    return () => link.close();
  }, [source, remoteCode]);

  const trackerRef = useRef(createTracker());
  const occupancyRef = useRef(createOccupancy());
  const issuedRef = useRef(new Set()); // IDs handed out in this camera session
  const cycleRef = useRef(0);
  const autoDoneRef = useRef(new Set()); // sources already mapped automatically
  const sourceKeyRef = useRef("");
  const sourceStartRef = useRef(0);
  const findSpacesRef = useRef(null);
  const appearanceRef = useRef(null);
  const appearanceAt = useRef(0);
  const liveRef = useRef({ tracks: [], pending: [], statuses: new Map(), lastBoxes: [] });
  const cursorRef = useRef(null);
  const calRef = useRef(calibration);
  calRef.current = calibration;
  const lotRef = useRef(lot);
  lotRef.current = lot;
  const assignRef = useRef(assignVehicleId);
  assignRef.current = assignVehicleId;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => onDetectorStatus(setDetector), []);

  // ---------------------------------------------------------------- sources
  const media = useCallback(() => {
    if (frozen && frozenRef.current) return frozenRef.current;
    if (source === "webcam") return webcamRef.current;
    if (source === "video") return fileVideoRef.current;
    if (source === "image") return fileImgRef.current;
    if (source === "phone") return phoneVideoPlaying ? phoneVideoRef.current : null;
    return null;
  }, [source, frozen, phoneVideoPlaying]);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const mediaSize = (el) => ({
    width: el?.videoWidth || el?.naturalWidth || el?.width || 0,
    height: el?.videoHeight || el?.naturalHeight || el?.height || 0,
  });
  const mediaReady = (el) => {
    if (!el) return false;
    if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
    if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0;
    return el.width > 0;
  };

  const resetTracking = useCallback(() => {
    trackerRef.current.reset();
    occupancyRef.current.reset();
    issuedRef.current = new Set();
    colorsRef.current = new Map();
    liveRef.current = { tracks: [], pending: [], statuses: new Map(), lastBoxes: [] };
    setCounts({ vehicles: 0, free: 0, occupied: 0 });
    onUpdateRef.current?.({ tracks: [], statuses: new Map(), events: [], streaming: false });
  }, []);

  const stopAll = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(null);
    setFrozen(false);
    setSource(SOURCES_IDLE);
    setError(null);
    resetTracking();
  }, [fileUrl, resetTracking]);

  const startWebcam = async (facing = "environment") => {
    stopAll();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setSource("webcam");
      requestAnimationFrame(() => {
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          webcamRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(err?.message || "Could not open the camera");
    }
  };

  const openFile = (file) => {
    if (!file) return;
    stopAll();
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    setSource(file.type.startsWith("video/") ? "video" : "image");
  };

  const openPhone = () => {
    stopAll();
    if (!remoteCode) onRemoteCodeChange?.(makePairCode());
    setSource("phone");
    setRemoteOpen(true);
  };

  useEffect(() => {
    const video = phoneVideoRef.current;
    setPhoneVideoPlaying(false);
    if (!video) return;
    video.srcObject = phoneStream || null;
    if (phoneStream) video.play().catch(() => {});
  }, [phoneStream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    sourceKeyRef.current = `${source}:${fileUrl || remoteCode}`;
    sourceStartRef.current = Date.now();
    lastFrameAt.current = 0;
  }, [source, fileUrl, remoteCode]);
  useEffect(() => { preloadDetector(); }, []);

  // Paste an image/video straight into the page.
  useEffect(() => {
    const onPaste = (e) => {
      if (!visible) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/") || i.type.startsWith("video/"));
      if (item) openFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const freeze = () => {
    if (frozen) { setFrozen(false); return; }
    const el = mediaRef.current();
    if (!mediaReady(el)) return;
    const { width, height } = mediaSize(el);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(el, 0, 0, width, height);
    frozenRef.current = canvas;
    setFrozen(true);
  };

  // ------------------------------------------------------------- layout fit
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const el = mediaRef.current();
    if (!stage) return;
    const { width: vw, height: vh } = mediaSize(el);
    if (!vw || !vh) return;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const ratio = vw / vh;
    const width = cw / ch > ratio ? ch * ratio : cw;
    const height = cw / ch > ratio ? ch : cw / ratio;
    setFrameRect((prev) => {
      const next = { left: (cw - width) / 2, top: (ch - height) / 2, width, height };
      return Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 ? prev : next;
    });
    // Keep the frame aspect in the calibration (used when no ground plane is set).
    const aspect = Math.round((vw / vh) * 1000) / 1000;
    if (Math.abs((calRef.current?.aspect || 0) - aspect) > 0.01 && !calRef.current?.sample) {
      onCalibrationChange?.({ ...calRef.current, aspect });
    }
  }, [onCalibrationChange]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const timer = setInterval(measure, 1000);
    return () => { observer.disconnect(); clearInterval(timer); };
  }, [measure]);

  // ---------------------------------------------------------- detection loop
  const still = source === "image" || frozen;
  // Real paint colour of each tracked car (used to draw it on the plan).
  const colorsRef = useRef(new Map());
  const sampleCanvas = useRef(null);
  const sampleColors = (el, tracks, every) => {
    if (!sampleCanvas.current) sampleCanvas.current = document.createElement("canvas");
    const c = sampleCanvas.current;
    c.width = 1; c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const { width, height } = mediaSize(el);
    for (const t of tracks) {
      if (t.state === "lost" || (colorsRef.current.has(t.key) && !every)) continue;
      // Centre of the body (roof / bonnet), averaged down to one pixel.
      const x = ((t.x + t.w * 0.3) / 100) * width, y = ((t.y + t.h * 0.3) / 100) * height;
      const w = Math.max(1, (t.w * 0.4 / 100) * width), h = Math.max(1, (t.h * 0.4 / 100) * height);
      try {
        ctx.drawImage(el, x, y, w, h, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        colorsRef.current.set(t.key, `rgb(${r},${g},${b})`);
      } catch { /* frame not readable yet */ }
    }
    for (const key of colorsRef.current.keys()) if (!tracks.some((t) => t.key === key)) colorsRef.current.delete(key);
  };

  // A recent picture of the lot for the plan's photo backdrop.
  const lastFrameAt = useRef(0);
  const frameUrlRef = useRef(null);
  const snapshotFrame = (el, isStill) => {
    const now = Date.now();
    if (now - lastFrameAt.current < (isStill ? 0 : 1500)) return null;
    lastFrameAt.current = now;
    const { width, height } = mediaSize(el);
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(el, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const old = frameUrlRef.current;
      frameUrlRef.current = url;
      onUpdateRef.current?.({ frame: { url, width: canvas.width, height: canvas.height } });
      if (old) setTimeout(() => URL.revokeObjectURL(old), 4000);
    }, "image/jpeg", 0.82);
    return true;
  };

  const process = useCallback((result, isStill, el) => {
    const cal = calRef.current;
    const lotNow = lotRef.current;
    const view = cal.view || "angled";
    const now = Date.now();
    const { tracks, events } = trackerRef.current.update(result.boxes, {
      now,
      still: isStill,
      assignId: (taken) => {
        const id = assignRef.current?.([...taken, ...issuedRef.current]);
        if (id) issuedRef.current.add(id);
        return id;
      },
      toGround: (box) => lotNow.toLot(groundPoint(box, view)),
      metersPerUnit: lotNow.metersPerUnit,
      hasStalls: cal.stalls.length > 0,
      locateAll: (list) => {
        const byStall = assignVehiclesToStalls(cal.stalls, list, view);
        const out = new Map();
        for (const [stallId, { vehicle }] of byStall) out.set(vehicle.key, cal.stalls.find((st) => st.id === stallId));
        return out;
      },
    });
    // Hidden parked cars still occupy their stall; lost moving ones do not.
    const present = tracks.filter((t) => t.state !== "lost" || t.motion === "parked");
    // Seen from above, also check whether each stall looks like empty pavement
    // (about once a second; every time for a photo).
    if (el && view === "overhead" && cal.stalls.length >= 4 && (isStill || now - appearanceAt.current > 1000)) {
      appearanceAt.current = now;
      try { appearanceRef.current = stallAppearance(imagePixels(el, 640), cal.stalls); } catch { appearanceRef.current = null; }
    }
    const statuses = occupancyRef.current.update(cal.stalls, present, {
      view, now, still: isStill, appearance: view === "overhead" ? appearanceRef.current : null,
    });
    liveRef.current = { tracks, pending: trackerRef.current.pending(), statuses, lastBoxes: result.boxes };
    const occupied = [...statuses.values()].filter((s) => s.status === "occupied").length;
    setCounts({ vehicles: tracks.filter((t) => t.state !== "lost").length, occupied, free: statuses.size - occupied });
    if (el) {
      sampleColors(el, tracks, cycleRef.current % 20 === 0);
      snapshotFrame(el, isStill);
    }
    const coloured = tracks.map((t) => ({ ...t, color: colorsRef.current.get(t.key) }));
    liveRef.current.tracks = coloured;
    onUpdateRef.current?.({ tracks: coloured, statuses, events, streaming: true, still: isStill });
    // First look at a new picture with no spaces mapped: find them automatically.
    const key = sourceKeyRef.current;
    const settled = isStill || Date.now() - sourceStartRef.current > 4000;
    if (el && settled && !autoDoneRef.current.has(key) && !cal.stalls.length && tracks.length) {
      autoDoneRef.current.add(key);
      findSpacesRef.current?.(el, false);
    }
  }, []);

  useEffect(() => {
    if (source === SOURCES_IDLE) return undefined;
    let cancelled = false;
    let lastStillKey = "";
    let frames = 0;
    let windowStart = performance.now();
    let cycle = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!cancelled) {
        const el = mediaRef.current();
        if (!mediaReady(el)) { await sleep(150); continue; }
        const isStill = source === "image" || frozen;
        const key = isStill ? `${source}:${frozen}:${fileUrl}:${calRef.current.view}` : "";
        if (isStill && key === lastStillKey) { await sleep(250); continue; }
        cycle += 1;
        // Small-vehicle boost (tiled pass): always on photos; on video every frame
        // with a GPU, otherwise every 4th frame so tracking stays responsive.
        const tiles = tiling === "on" || isStill || (tiling === "auto" && (detector.backend === "webgpu" || cycle % 4 === 0));
        try {
          // High-resolution pass: always on photos; on video with the small-car
          // boost (every frame on a GPU, every 4th frame otherwise).
          const boost = tiling !== "off" && tiles;
          const result = await detectVehiclesLocal(el, {
            tiles: isStill || (boost && detector.backend === "webgpu"),
            hires: isStill || boost,
            overhead: calRef.current.view === "overhead",
          });
          if (cancelled) break;
          cycleRef.current = cycle;
          process(result, isStill, el);
          if (isStill) lastStillKey = key;
          frames += 1;
          const elapsed = performance.now() - windowStart;
          if (elapsed > 1500) {
            setPerf({ fps: Math.round((frames / elapsed) * 10000) / 10, ms: Math.round(result.ms), tiled: result.tiled });
            frames = 0;
            windowStart = performance.now();
          }
          setError(null);
        } catch (err) {
          if (cancelled) break;
          setError(err?.message || "Vehicle detection failed");
          await sleep(1500);
        }
        await sleep(isStill ? 50 : 10);
      }
    })();
    return () => { cancelled = true; };
  }, [source, frozen, fileUrl, tiling, detector.backend, process]);

  // New camera->plan mapping: old trails are in the old plan coordinates.
  useEffect(() => { trackerRef.current.clearTrails(); }, [lot]);

  // Calibration changed: re-decide stalls from the vehicles already found.
  useEffect(() => {
    if (source === SOURCES_IDLE) return;
    const { tracks } = liveRef.current;
    const view = calibration.view || "angled";
    occupancyRef.current.reset();
    const present = tracks.filter((t) => t.state !== "lost" || t.motion === "parked");
    let appearance = null;
    const el = mediaRef.current();
    if (view === "overhead" && calibration.stalls.length >= 4 && mediaReady(el)) {
      try { appearance = stallAppearance(imagePixels(el, 640), calibration.stalls); } catch { appearance = null; }
    }
    appearanceRef.current = appearance;
    const statuses = occupancyRef.current.update(calibration.stalls, present, { view, still: true, appearance });
    liveRef.current = { ...liveRef.current, statuses };
    const occupied = [...statuses.values()].filter((s) => s.status === "occupied").length;
    setCounts((c) => ({ ...c, occupied, free: statuses.size - occupied }));
    onUpdateRef.current?.({ tracks, statuses, events: [], streaming: true, still });
  }, [calibration.stalls, calibration.view]);

  // --------------------------------------------------------------- drawing
  useEffect(() => {
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas && frameRect.width) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(frameRect.width * dpr), h = Math.round(frameRect.height * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const t = tool ? TOOLS[tool] : null;
        let preview = [];
        if (tool === "row" && draft.length === 3 && cursorRef.current) {
          preview = makeStallRow([...draft, cursorRef.current], Math.max(1, rowCount), "?").map((s) => s.poly);
        }
        drawOverlay(ctx, {
          width: frameRect.width,
          height: frameRect.height,
          calibration: calRef.current,
          statuses: liveRef.current.statuses,
          tracks: liveRef.current.tracks,
          pending: liveRef.current.pending,
          lotToCamera: lotRef.current?.toCamera,
          draft: t && t.points ? { points: draft, cursor: cursorRef.current, color: t.color, closed: t.points === 4, preview, labels: tool === "ground" ? ["1", "2", "3", "4"] : tool === "row" || tool === "stall" ? ["FL", "FR", "BR", "BL"] : null } : null,
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frameRect, tool, draft, rowCount]);

  // --------------------------------------------------------------- tools
  const pointFrom = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };

  const update = (patch) => onCalibrationChange?.({ ...calRef.current, ...patch, sample: false });

  const finishLane = (points = draft) => {
    if (points.length >= 2) update({ lanes: [...calibration.lanes, { id: `lane-${Date.now()}`, points }] });
    setDraft([]);
  };

  const commit = (points) => {
    const cal = calRef.current;
    if (tool === "row" || tool === "stall") {
      const row = nextRowLetter(cal.stalls);
      const stalls = makeStallRow(points, tool === "row" ? Math.max(1, Math.min(60, rowCount)) : 1, row);
      update({ stalls: [...cal.stalls, ...stalls] });
    } else if (tool === "entrance") update({ entrance: points[0] });
    else if (tool === "exit") update({ exit: points[0] });
    else if (tool === "ground") update({ ground: { quad: points, width: groundSize.width, length: groundSize.length } });
    setDraft([]);
    if (tool === "entrance" || tool === "exit" || tool === "ground") setTool(null);
  };

  const onPointerDown = (e) => {
    if (!tool) return;
    e.preventDefault();
    const p = pointFrom(e);
    if (tool === "erase") {
      const cal = calRef.current;
      const stall = [...cal.stalls].reverse().find((s) => pointInPolygon(p, s.poly));
      if (stall) { update({ stalls: cal.stalls.filter((s) => s.id !== stall.id) }); return; }
      const lane = cal.lanes.find((l) => l.points.some((a, i) => i && projectOnSegment(p, l.points[i - 1], a).distance < 1.5));
      if (lane) update({ lanes: cal.lanes.filter((l) => l !== lane) });
      return;
    }
    const spec = TOOLS[tool];
    const next = [...draft, p];
    if (next.length >= spec.points) commit(next);
    else setDraft(next);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!tool) return;
      if (e.key === "Escape") { setDraft([]); setTool(null); }
      if (e.key === "Enter" && tool === "lane") finishLane();
      if (e.key === "Backspace" && draft.length) setDraft(draft.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Find the parking spaces automatically: painted stall lines (overhead
  // pictures) plus every parked car that is not inside a found space.
  const findSpaces = (el = mediaRef.current(), manual = true) => {
    if (!mediaReady(el)) return;
    const cal = calRef.current;
    const vehicles = liveRef.current.tracks.filter((t) => t.state !== "lost" && (still || t.motion !== "moving"));
    // First automatic run on an empty map: work out whether the camera looks
    // straight down or from the side.
    const view = (!manual && !cal.stalls.length && guessView(vehicles)) || cal.view || "angled";
    try {
      const result = autoMapLot({
        image: imagePixels(el),
        vehicles,
        view,
        keepStalls: cal.stalls.filter((st) => !st.auto),
        keepLanes: cal.lanes.filter((l) => !l.auto),
        entrance: cal.entrance && !cal.entrance.auto ? cal.entrance : null,
      });
      update({ stalls: result.stalls, lanes: result.lanes, entrance: result.entrance ?? cal.entrance, view });
      const { painted, fromCars } = result.stats;
      setNotice(
        result.stalls.length
          ? `Found ${result.stalls.length} spaces — ${painted} from painted lines, ${fromCars} from parked cars.${view !== "overhead" ? " Painted lines are read in Overhead view only." : ""} Fix any with Erase / Stall row.`
          : manual ? "No spaces found. Draw a row with Stall row, or switch Camera view to Overhead for a top-down picture." : null,
      );
    } catch (err) {
      setNotice(err?.message || "Could not find spaces in this picture");
    }
  };
  findSpacesRef.current = findSpaces;

  const streaming = source !== SOURCES_IDLE;
  const spec = tool ? TOOLS[tool] : null;
  const hint = spec ? spec.hint[Math.min(draft.length, spec.hint.length - 1)] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Source bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Btn active={source === "webcam"} onClick={() => (source === "webcam" ? stopAll() : startWebcam())}><Video className="h-3.5 w-3.5" /> Webcam</Btn>
        <Btn active={source === "phone"} onClick={() => (source === "phone" ? setRemoteOpen(true) : openPhone())}><Smartphone className="h-3.5 w-3.5" /> Phone camera</Btn>
        <Btn active={source === "image" || source === "video"} onClick={() => fileInputRef.current?.click()}><FileVideo className="h-3.5 w-3.5" /> Photo / video file</Btn>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
        {streaming && source !== "image" && (
          <Btn active={frozen} onClick={freeze}>{frozen ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {frozen ? "Resume" : "Freeze frame"}</Btn>
        )}
        {streaming && <Btn onClick={stopAll}><VideoOff className="h-3.5 w-3.5" /> Stop</Btn>}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-neutral-400">
          <Cpu className="h-3.5 w-3.5" />
          <select
            value={detector.model || "accurate"}
            onChange={(e) => setDetectorModel(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-200"
            title="Detection model"
          >
            {Object.entries(MODELS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select
            value={tiling}
            onChange={(e) => setTiling(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-200"
            title="Small / distant vehicle boost: also scans four zoomed tiles of the frame"
          >
            <option value="auto">Small-car boost: auto</option>
            <option value="on">Small-car boost: always</option>
            <option value="off">Small-car boost: off</option>
          </select>
        </div>
      </div>

      {/* Stage */}
      <div ref={stageRef} className="relative min-h-[45vh] flex-1 overflow-hidden rounded-xl border border-neutral-800 bg-black">
        <video ref={webcamRef} playsInline muted onLoadedMetadata={measure} className="absolute inset-0 h-full w-full object-contain" style={{ display: source === "webcam" && !frozen ? "block" : "none" }} />
        {source === "video" && fileUrl && (
          <video ref={fileVideoRef} src={fileUrl} autoPlay loop muted playsInline onLoadedMetadata={measure} className="absolute inset-0 h-full w-full object-contain" style={{ display: frozen ? "none" : "block" }} />
        )}
        {source === "image" && fileUrl && (
          <img ref={fileImgRef} src={fileUrl} alt="Parking lot" onLoad={measure} className="absolute inset-0 h-full w-full object-contain" />
        )}
        <video
          ref={phoneVideoRef}
          autoPlay playsInline muted
          onLoadedMetadata={measure}
          onPlaying={() => { setPhoneVideoPlaying(true); setRemoteOpen(false); }}
          onEmptied={() => setPhoneVideoPlaying(false)}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ display: source === "phone" && phoneVideoPlaying && !frozen ? "block" : "none" }}
        />
        {frozen && frozenRef.current && (
          <FrozenFrame canvas={frozenRef.current} onReady={measure} />
        )}

        {streaming && (
          <div
            className="absolute"
            style={{ left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height, cursor: tool ? "crosshair" : "default", touchAction: tool ? "none" : "auto" }}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => { cursorRef.current = tool ? pointFrom(e) : null; }}
            onPointerLeave={() => { cursorRef.current = null; }}
            onDoubleClick={() => tool === "lane" && finishLane(draft.slice(0, -1).length >= 2 ? draft.slice(0, -1) : draft)}
          >
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
        )}

        {streaming && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-mono text-white">
            <span className={`h-2 w-2 rounded-full ${still ? "bg-yellow-400" : "animate-pulse bg-red-500"}`} />
            {still ? (source === "image" ? "PHOTO" : "FROZEN") : source === "phone" ? "PHONE" : source === "video" ? "VIDEO" : "LIVE"}
            {detector.state === "loading" && <span className="flex items-center gap-1 text-cyan-300"><Loader2 className="h-3 w-3 animate-spin" /> loading model</span>}
            {detector.state === "ready" && !still && <span className="text-neutral-400">{perf.fps} fps · {perf.ms} ms · {detector.backend?.toUpperCase()}</span>}
          </div>
        )}
        {streaming && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-stretch gap-1.5 text-right font-mono">
            {calibration.stalls.length > 0 && (
              <>
                <div className="rounded-lg bg-black/75 px-3 py-1.5">
                  <div className="text-lg font-bold leading-none text-white">{calibration.stalls.length}</div>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">spaces</div>
                </div>
                <div className="rounded-lg bg-green-500/90 px-3 py-1.5 text-neutral-950">
                  <div className="text-lg font-bold leading-none">{counts.free}</div>
                  <div className="text-[9px] uppercase tracking-wider">open</div>
                </div>
                <div className="rounded-lg bg-red-500/85 px-3 py-1.5 text-white">
                  <div className="text-lg font-bold leading-none">{counts.occupied}</div>
                  <div className="text-[9px] uppercase tracking-wider">taken</div>
                </div>
              </>
            )}
            <div className="rounded-lg bg-black/75 px-3 py-1.5 text-green-300">
              <div className="text-lg font-bold leading-none">{counts.vehicles}</div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">cars</div>
            </div>
          </div>
        )}
        {hint && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[92%] -translate-x-1/2 rounded-full border border-white/20 bg-black/80 px-3 py-1.5 text-center text-[11px] text-white">
            <b style={{ color: spec.color }}>{spec.label}:</b> {hint} <span className="text-neutral-400">· Esc to cancel{draft.length ? " · Backspace to undo" : ""}</span>
          </div>
        )}
        {source === "phone" && !phoneVideoPlaying && !remoteOpen && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-sm text-neutral-300">
            <Smartphone className="h-8 w-8 text-green-400" />
            {phoneStatus.state === "error" ? <span className="text-red-300">{phoneStatus.message}</span> : <span>Waiting for your phone… code <b className="font-mono">{remoteCode}</b></span>}
            <button onClick={() => setRemoteOpen(true)} className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs hover:border-neutral-400">Show QR code</button>
          </div>
        )}
        {error && (
          <div className="absolute bottom-12 left-1/2 max-w-[90%] -translate-x-1/2 rounded-full border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-center text-[11px] text-red-200">{error}</div>
        )}

        {!streaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <ScanSearch className="h-10 w-10 text-green-400" />
            <p className="text-sm text-neutral-200">Point a camera at the lot, or open a photo or video of it</p>
            <p className="max-w-md text-xs leading-relaxed text-neutral-500">
              Vehicles are detected on this device with a YOLO11 model (no upload needed), tracked frame to frame with a
              stable ID, and matched to the stalls you draw. You can also paste an image (Ctrl/Cmd+V).
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Btn onClick={() => startWebcam()}><Video className="h-3.5 w-3.5" /> Start webcam</Btn>
              <Btn onClick={openPhone}><Smartphone className="h-3.5 w-3.5" /> Use phone as camera</Btn>
              <Btn onClick={() => fileInputRef.current?.click()}><FileVideo className="h-3.5 w-3.5" /> Open photo / video</Btn>
            </div>
            {detector.state === "error" && <p className="text-xs text-red-300">Detector: {detector.error}</p>}
          </div>
        )}
      </div>

      {/* Lot mapping tools */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold tracking-[0.18em] text-neutral-500">MAP THE LOT</span>
        {Object.entries(TOOLS).map(([key, t]) => (
          <Btn key={key} disabled={!streaming} active={tool === key} tone={t.color} onClick={() => { setDraft([]); setTool(tool === key ? null : key); }}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </Btn>
        ))}
        {tool === "row" && (
          <label className="flex items-center gap-1 text-[11px] text-neutral-300">
            stalls in row
            <input type="number" min={1} max={60} value={rowCount} onChange={(e) => setRowCount(Number(e.target.value) || 1)} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-white" />
          </label>
        )}
        {tool === "lane" && draft.length >= 2 && <Btn onClick={() => finishLane()}>Finish lane</Btn>}
        {tool === "ground" && (
          <span className="flex items-center gap-1 text-[11px] text-neutral-300">
            lot size
            <input type="number" min={5} value={groundSize.width} onChange={(e) => setGroundSize((s) => ({ ...s, width: Number(e.target.value) || 1 }))} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-white" /> m wide (1→2) ×
            <input type="number" min={5} value={groundSize.length} onChange={(e) => setGroundSize((s) => ({ ...s, length: Number(e.target.value) || 1 }))} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-white" /> m deep (2→3)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold tracking-[0.18em] text-neutral-500">AUTO</span>
        <Btn disabled={!streaming} onClick={() => findSpaces()}><Sparkles className="h-3.5 w-3.5" /> Find spaces automatically</Btn>
        <span className="ml-2 text-[11px] text-neutral-400">Camera view:</span>
        <Btn active={calibration.view !== "overhead"} onClick={() => update({ view: "angled" })}>Angled</Btn>
        <Btn active={calibration.view === "overhead"} onClick={() => update({ view: "overhead" })}>Overhead</Btn>
        <Btn
          disabled={!calibration.stalls.length && !calibration.lanes.length && !calibration.entrance && !calibration.ground}
          onClick={() => { if (window.confirm("Remove all stalls, lanes, entrance/exit and the lot corners?")) update({ stalls: [], lanes: [], entrance: null, exit: null, ground: null }); }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear map
        </Btn>
        {notice && <span className="text-[11px] text-cyan-200">{notice}</span>}
      </div>

      <RemoteCameraDialog
        open={remoteOpen}
        onOpenChange={setRemoteOpen}
        code={remoteCode}
        status={phoneStatus}
        onStop={() => { onRemoteCodeChange?.(""); setRemoteOpen(false); stopAll(); }}
        onNewCode={() => { setPhoneStream(null); onRemoteCodeChange?.(makePairCode()); }}
      />
    </div>
  );
}

function FrozenFrame({ canvas, onReady }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.width = canvas.width;
    el.height = canvas.height;
    el.getContext("2d").drawImage(canvas, 0, 0);
    onReady?.();
  }, [canvas, onReady]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full object-contain" />;
}

function Btn({ children, active, onClick, disabled, tone }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-green-500 bg-green-500/10 text-green-300" : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500 hover:text-white"
      }`}
      style={active && tone ? { borderColor: tone, color: tone, backgroundColor: `${tone}1a` } : undefined}
    >
      {children}
    </button>
  );
}
