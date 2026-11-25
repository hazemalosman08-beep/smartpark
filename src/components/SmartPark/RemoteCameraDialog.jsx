import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { phoneLink } from "@/lib/phoneLink";

export default function RemoteCameraDialog({ open, onOpenChange, code, status = {}, onStop, onNewCode }) {
  const link = code ? phoneLink(code) : "";
  const state = status.state || "starting";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Use your phone as the camera</DialogTitle>
          <DialogDescription>
            Scan this with your phone's camera, then tap <b>Start camera</b> and allow camera access. Or open
            <span className="font-mono"> {window.location.host}/phone-camera</span> and type the code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {link && (
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={link} size={184} level="M" />
            </div>
          )}
          <p className="font-mono text-4xl font-bold tracking-[0.25em]">{code.slice(0, 3)} {code.slice(3)}</p>
          <div role="status" className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            {state === "error" ? (
              <span role="alert" className="text-destructive">{status.message}</span>
            ) : state === "connected" ? (
              <><CheckCircle2 className="h-4 w-4 text-green-500" /> Phone connected — picture is live</>
            ) : state === "waiting" ? (
              <><Smartphone className="h-4 w-4" /> {status.message || "Waiting for your phone…"}</>
            ) : (
              <><Loader2 className="h-4 w-4 animate-spin" /> Getting ready…</>
            )}
          </div>
          <p className="text-center text-[11px] text-muted-foreground">Works best with both devices on the same Wi-Fi. The video goes straight from the phone to this computer.</p>
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
