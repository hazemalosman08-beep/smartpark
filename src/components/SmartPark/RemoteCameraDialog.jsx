import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pairingLink, parsePairCode } from "@/lib/cameraSession";

export default function RemoteCameraDialog({ open, onOpenChange, code, ready = false, cameras = 0, receiving = false, error, onStop, onNewCode }) {
  const link = ready && !error && code ? pairingLink(code) : "";
  const { pin } = parsePairCode(code);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Show your phone camera here</DialogTitle>
          <DialogDescription>Scan with your phone. On the phone page, type these six digits into “Pairing code from computer”, then tap Share camera and allow camera access.</DialogDescription></DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {link && <>
            <div className="rounded-xl bg-background p-3 text-foreground"><QRCodeSVG value={link} size={176} level="M" bgColor="transparent" fgColor="currentColor" /></div>
            <div className="text-center"><p className="text-xs text-muted-foreground">Enter this code on your phone</p><p className="mt-2 font-mono text-4xl font-bold tracking-widest text-foreground">{pin.slice(0, 3)} {pin.slice(3)}</p></div>
          </>}
          <div role="status" className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            {error ? <span role="alert" className="text-destructive">{error}</span> : !ready ? <><Loader2 className="h-4 w-4 shrink-0 animate-spin" />Preparing the computer connection…</> : receiving ? <><CheckCircle2 className="h-4 w-4 shrink-0" />Phone camera is displayed on this computer</> : cameras ? <><Loader2 className="h-4 w-4 shrink-0 animate-spin" />Phone connected. Starting the picture…</> : <><Smartphone className="h-4 w-4 shrink-0" />Waiting for your phone</>}
          </div>
          <p className="text-center text-xs text-muted-foreground">The phone is only a camera. All parking tools stay here.</p>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onNewCode}>New code</Button>
          <Button variant="outline" onClick={onStop}>Stop</Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}