import React from "react";
import { Loader2 } from "lucide-react";
import PhonePairingForm from "@/components/SmartPark/PhonePairingForm";
import usePhoneCamera from "@/lib/usePhoneCamera";

export default function PhoneCamera() {
  const camera = usePhoneCamera();
  if (!camera.code) return <PhonePairingForm onJoin={camera.start} starting={camera.starting} error={camera.error} />;
  return (
    <main className="dark min-h-dvh bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border p-4">
        <div><h1 className="text-sm font-semibold">Phone camera</h1><p className="mt-1 text-xs text-muted-foreground">{camera.connected ? "Camera picture is displayed on the computer" : "Connecting to the computer…"}</p></div>
        <button onClick={camera.stop} className="shrink-0 rounded-md border border-border px-3 py-2 text-sm">{camera.error ? "Try again" : "Stop sharing"}</button>
      </header>
      <div className="relative flex flex-1 items-center justify-center">
        <video ref={camera.videoRef} autoPlay muted playsInline onClick={(event) => event.currentTarget.play()} className="h-[calc(100dvh-9rem)] w-full object-contain" />
        {camera.error ? <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-card p-4 text-center text-sm text-destructive">{camera.error}</p> : !camera.connected && <div role="status" className="absolute inset-x-4 top-4 flex items-center justify-center gap-2 rounded-lg bg-card/90 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{camera.joining ? "Sending camera picture…" : "Connecting to the computer…"}</div>}
      </div>
      <p className="p-3 text-center text-xs text-muted-foreground">Keep this page open and the phone unlocked.</p>
    </main>
  );
}