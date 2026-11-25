import { useCallback, useEffect, useRef, useState } from "react";
import { cameraClient, parsePairCode, sendCameraImage, MAX_IMAGE_CHARS, IMAGE_PART_SIZE } from "@/lib/cameraSession";
import createCameraPeer from "@/lib/cameraPeer";
export { makePairCode } from "@/lib/cameraSession";

export default function useRemoteCamera(code, role = "viewer", sourceStream = null) {
  const roomRef = useRef(null);
  const peerRef = useRef(null);
  const sourceRef = useRef(sourceStream);
  const readyRef = useRef(false);
  const pendingRef = useRef(null);
  const [frame, setFrame] = useState(null);
  const [stream, setStream] = useState(null);
  const [peerStatus, setPeerStatus] = useState("waiting");
  const [cameras, setCameras] = useState(0);
  const [viewers, setViewers] = useState(0);
  const [joinedCode, setJoinedCode] = useState("");
  const connected = Boolean(code && joinedCode === code);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [spots, setSpots] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  sourceRef.current = sourceStream;

  useEffect(() => { peerRef.current?.setStream(sourceStream); }, [sourceStream]);
  useEffect(() => {
    setFrame(null); setStream(null); setPeerStatus("waiting"); setCameras(0); setViewers(0);
    setJoinedCode(""); setReceiving(false); setError(null); setCalibration(null); setSpots(null); setSnapshot(null);
    readyRef.current = false; pendingRef.current = null;
    if (!code) return undefined;
    let cancelled = false;
    const incoming = new Map();
    const client = cameraClient(code, (failure) => {
      if (!cancelled) setError(failure.status === 404
        ? "The camera connection is missing from this version. Publish the latest changes, then open the live app on the computer and create a new QR code."
        : `Camera connection failed: ${failure.message}`);
    });
    const pairing = parsePairCode(code);
    const key = `parkvision-camera-${role}`;
    let id = sessionStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
    const room = client.actors.CameraStream(pairing.room).connect({ id });
    roomRef.current = room;
    const register = () => room.send({ type: "role", role, pin: pairing.pin, owner: pairing.owner });
    const peer = createCameraPeer({ role,
      send: (signal) => { if (readyRef.current) room.send({ type: "signal", ...signal }); },
      onStream: (value) => { if (!cancelled) setStream(value); },
      onStatus: (value) => { if (!cancelled) setPeerStatus(value); },
    });
    peerRef.current = peer;
    peer.setStream(sourceRef.current);
    const timeout = setTimeout(() => {
      if (!readyRef.current && !cancelled) setError((current) => current || (role === "viewer"
        ? "Camera pairing could not start. Publish the latest changes, then open the live app on this computer and try again."
        : "The computer did not respond to this invitation. Create a new code on the computer and scan its new QR code."));
    }, 15000);
    const sub = room.subscribe((msg) => {
      if (!msg || cancelled) return;
      if (msg.type === "welcome") {
        readyRef.current = false; setJoinedCode(""); pendingRef.current = null;
        register();
      } else if (msg.type === "host_needed" && role === "viewer") {
        register();
      } else if (msg.type === "host_ready" && role === "camera" && !readyRef.current) {
        register();
      } else if (msg.type === "pairing_waiting") {
        setError(null);
      } else if (msg.type === "joined") {
        clearTimeout(timeout); readyRef.current = true; setJoinedCode(code); setError(null);
      } else if (msg.type === "pairing_error" || msg.type === "session_ended") {
        clearTimeout(timeout); readyRef.current = false; setJoinedCode(""); setReceiving(false);
        setFrame(null); peer.unpair(); setError(msg.message || "The computer stopped this camera session.");
      } else if (msg.type === "paired") peer.pair();
      else if (msg.type === "signal") peer.receive(msg);
      else if (msg.type === "presence") {
        setCameras(Number(msg.cameras) || 0); setViewers(Number(msg.viewers) || 0);
        if (role === "camera" ? !msg.viewers : !msg.cameras) {
          setReceiving(false); setFrame(null); pendingRef.current = null; peer.unpair();
        }
      } else if (msg.type === "session") {
        setCalibration(msg.calibration); setSpots(msg.spots); setScanning(Boolean(msg.scanning));
      } else if (msg.type === "calibration") setCalibration(msg.value);
      else if (msg.type === "spots") setSpots(msg.value);
      else if (msg.type === "scan_state") { setScanning(Boolean(msg.busy)); setScanError(msg.error || null); }
      else if (msg.type === "snapshot_clear") setSnapshot({ data: null });
      else if (msg.type === "frame_ack") {
        if (pendingRef.current?.id === msg.id) pendingRef.current = null;
      } else if (msg.type === "displayed") setReceiving(true);
      else if (msg.type === "image_part") {
        if (!["frame", "capture"].includes(msg.kind) || !Number.isInteger(msg.total) || msg.total < 1 || msg.total > 10 || !Number.isInteger(msg.index) || msg.index < 0 || msg.index >= msg.total || typeof msg.data !== "string" || msg.data.length > IMAGE_PART_SIZE) return;
        let image = incoming.get(msg.kind);
        if (image?.id !== msg.id) { image = { id: msg.id, parts: Array(msg.total) }; incoming.set(msg.kind, image); }
        if (image.parts.length !== msg.total) return;
        image.parts[msg.index] = msg.data;
        if (image.parts.filter((part) => typeof part === "string").length !== msg.total) return;
        incoming.delete(msg.kind);
        const data = image.parts.join("");
        if (data.length > MAX_IMAGE_CHARS || !data.startsWith("data:image/jpeg;base64,")) return;
        if (msg.kind === "capture") setSnapshot({ data, id: msg.id });
        else { setFrame(data); setReceiving(true); setError(null); }
      }
    });
    return () => {
      cancelled = true; clearTimeout(timeout); peer.close(); sub.unsubscribe(); room.close(); client.cleanup();
      roomRef.current = null; peerRef.current = null; readyRef.current = false;
    };
  }, [code, role]);

  const sendFrame = useCallback((data) => {
    if (!readyRef.current || !roomRef.current || (pendingRef.current && Date.now() - pendingRef.current.at < 1500)) return;
    const id = sendCameraImage(roomRef.current, "frame", data);
    pendingRef.current = { id, at: Date.now() };
  }, []);
  const sendSnapshot = useCallback((data) => {
    if (readyRef.current && roomRef.current) sendCameraImage(roomRef.current, "capture", data);
  }, []);
  const resume = useCallback(() => roomRef.current?.send({ type: "resume" }), []);
  const acknowledge = useCallback(() => roomRef.current?.send({ type: "displayed" }), []);
  const endSession = useCallback(() => roomRef.current?.send({ type: "end" }), []);
  const publishCalibration = useCallback((value) => roomRef.current?.send({ type: "calibration", value }), []);
  const publishSpots = useCallback((value) => roomRef.current?.send({ type: "spots", value }), []);
  const publishScan = useCallback((busy, error = null) => roomRef.current?.send({ type: "scan_state", busy, error }), []);
  return { frame, stream: peerStatus === "connected" ? stream : null, peerStatus, cameras, viewers, connected, receiving, error, calibration, spots, snapshot, scanning, scanError, sendFrame, sendSnapshot, resume, acknowledge, endSession, publishCalibration, publishSpots, publishScan };
}