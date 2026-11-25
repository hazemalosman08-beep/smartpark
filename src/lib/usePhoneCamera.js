import { useCallback, useEffect, useRef, useState } from "react";
import useRemoteCamera from "@/lib/useRemoteCamera";
import usePhoneFrames from "@/lib/usePhoneFrames";

export default function usePhoneCamera() {
  const videoRef = useRef(null);
  const sourceRef = useRef(null);
  const generation = useRef(0);
  const [code, setCode] = useState("");
  const [stream, setStream] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const remote = useRemoteCamera(code, "camera", stream);
  // A connected video channel does not mean the computer has decoded a picture.
  // Keep relaying pictures independently so playback never waits on that channel.
  usePhoneFrames(videoRef, Boolean(stream && remote.connected), remote.sendFrame);

  const stop = useCallback(() => {
    generation.current += 1;
    sourceRef.current?.getTracks().forEach((track) => track.stop());
    sourceRef.current = null;
    setStream(null); setCode(""); setStarting(false);
  }, []);
  const start = async (pairing) => {
    const attempt = ++generation.current;
    setStarting(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page in Safari or Chrome to use the phone camera.");
      const camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 },
      } });
      if (attempt !== generation.current) { camera.getTracks().forEach((track) => track.stop()); return; }
      sourceRef.current = camera;
      setStream(camera); setCode(pairing);
    } catch (failure) {
      if (attempt === generation.current) setError(failure.name === "NotAllowedError" ? "Allow camera access in your browser, then try again." : failure.message);
    } finally { if (attempt === generation.current) setStarting(false); }
  };
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => setError("Tap the camera picture to start the preview."));
  }, [stream]);
  useEffect(() => {
    if (remote.error) {
      sourceRef.current?.getTracks().forEach((track) => track.stop());
      sourceRef.current = null; setStream(null);
    }
  }, [remote.error]);
  useEffect(() => {
    if (!stream || !navigator.wakeLock) return;
    let lock;
    let disposed = false;
    const keepAwake = async () => {
      if (document.visibilityState !== "visible") return;
      try { const next = await navigator.wakeLock.request("screen"); if (disposed) await next.release(); else lock = next; } catch { /* A phone may decline the optional screen lock. */ }
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => { disposed = true; lock?.release(); document.removeEventListener("visibilitychange", keepAwake); };
  }, [stream]);
  useEffect(() => () => { generation.current += 1; sourceRef.current?.getTracks().forEach((track) => track.stop()); }, []);
  return { code, videoRef, starting, error: error || remote.error, connected: remote.receiving, joining: remote.connected, start, stop };
}