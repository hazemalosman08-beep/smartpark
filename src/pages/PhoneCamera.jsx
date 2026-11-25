import React, { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { normalizeCode, sendPhoneCamera } from "@/lib/phoneLink";

// The phone's "security camera" page: opened by scanning the QR code on the
// computer. It only shows a preview; all detection runs on the computer.
export default function PhoneCamera() {
  const [code, setCode] = useState(() => normalizeCode(new URLSearchParams(window.location.search).get("code")));
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState({ state: "idle" });
  const [error, setError] = useState(null);
  const [facing, setFacing] = useState("environment");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const linkRef = useRef(null);

  const openCamera = async (mode) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page in Safari or Chrome to use the camera.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    return stream;
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await openCamera(facing);
      setActive(true);
      linkRef.current = sendPhoneCamera(code, stream, { onStatus: setStatus });
    } catch (err) {
      setError(err?.name === "NotAllowedError" ? "Allow camera access for this site, then try again." : err?.message || "Could not open the camera");
    }
  };

  const stop = () => {
    linkRef.current?.close();
    linkRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    setStatus({ state: "idle" });
  };

  const flip = async () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    try {
      const stream = await openCamera(next);
      linkRef.current?.setStream(stream);
    } catch (err) {
      setError(err?.message || "Could not switch camera");
    }
  };

  useEffect(() => () => stop(), []);

  // The preview element only exists once streaming starts.
  useEffect(() => {
    if (active && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [active]);

  // Keep the screen on while streaming.
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock;
    const grab = async () => {
      if (document.visibilityState !== "visible") return;
      try { lock = await navigator.wakeLock.request("screen"); } catch { /* optional */ }
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => { lock?.release?.(); document.removeEventListener("visibilitychange", grab); };
  }, [active]);

  if (!active) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#0f1311] px-6 text-center text-white">
        <Camera className="h-10 w-10 text-green-400" />
        <div>
          <h1 className="text-xl font-semibold">Use this phone as the camera</h1>
          <p className="mt-2 text-sm text-neutral-400">Enter the 6-digit code shown on the computer (scanning its QR code fills it in).</p>
        </div>
        <form className="flex w-full max-w-xs flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) start(); }}>
          <input
            aria-label="Code from the computer"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            placeholder="000000"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-4 text-center font-mono text-3xl tracking-[0.3em] text-white"
          />
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button disabled={code.length !== 6} className="rounded-lg bg-green-500 px-4 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-40">
            Start camera
          </button>
        </form>
        <p className="max-w-xs text-xs text-neutral-500">Tip: prop the phone up with a view of the "lot" and plug it in. The video goes straight to the computer.</p>
      </main>
    );
  }

  const connected = status.state === "connected";
  return (
    <main className="flex min-h-dvh flex-col bg-black text-white">
      <video ref={videoRef} autoPlay muted playsInline className="h-dvh w-full object-contain" onClick={(e) => e.currentTarget.play()} />
      <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs">
        {connected ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : status.state === "error" ? <X className="h-4 w-4 text-red-400" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        <span className={status.state === "error" ? "text-red-200" : ""}>
          {connected ? "Streaming to the computer" : status.message || (status.state === "error" ? "Connection problem" : "Connecting to the computer…")}
        </span>
        <span className="ml-auto font-mono text-neutral-400">{code}</span>
      </div>
      <div className="absolute inset-x-3 bottom-4 flex justify-center gap-3">
        <button onClick={flip} className="flex items-center gap-1.5 rounded-full bg-black/70 px-4 py-2.5 text-sm"><RefreshCw className="h-4 w-4" /> Flip</button>
        <button onClick={stop} className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold">Stop</button>
      </div>
    </main>
  );
}
