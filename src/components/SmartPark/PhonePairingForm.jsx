import React, { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { pairingFromLocation, parsePairCode } from "@/lib/cameraSession";

export default function PhonePairingForm({ onJoin, starting = false, error }) {
  const [pin, setPin] = useState("");
  const invitation = pairingFromLocation();
  const { room, version } = parsePairCode(invitation);
  const validRoom = /^[a-f0-9-]{36}$/i.test(room);
  return (
    <main className="dark min-h-dvh bg-background text-foreground flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Camera className="h-10 w-10 text-foreground" />
      <div><h1 className="text-xl font-semibold">Share this phone’s camera</h1>
        <p className="mt-2 text-sm text-muted-foreground">{validRoom ? "Enter the six-digit code shown on the computer." : "Scan the QR code shown on the computer to connect this phone."}</p></div>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (validRoom && pin.length === 6) onJoin(`${room}~${version || ""}~${pin}`); }}>
        <label htmlFor="pairing-code" className="text-sm font-medium">Pairing code from computer</label>
        <input id="pairing-code" aria-label="Pairing code from computer" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" disabled={starting || !validRoom} className="w-full rounded-lg border border-input bg-card px-4 py-4 text-center font-mono text-3xl tracking-widest text-foreground" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={!validRoom || pin.length !== 6 || starting} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">{starting && <Loader2 className="h-4 w-4 animate-spin" />}{starting ? "Opening camera…" : "Share camera"}</button>
      </form>
      <p className="max-w-sm text-xs text-muted-foreground">Allow camera access when asked. Only the camera picture is sent; all parking controls stay on the computer.</p>
    </main>
  );
}