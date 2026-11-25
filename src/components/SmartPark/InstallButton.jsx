import React, { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { isInstalled, isIos, onInstallAvailable, promptInstall } from "@/lib/pwa";

// "Install app": uses the browser's install prompt (Chrome, Edge, Android).
// iPhone/iPad Safari has no prompt, so it shows the two taps instead.
export default function InstallButton() {
  const [available, setAvailable] = useState(false);
  const [showIosTip, setShowIosTip] = useState(false);
  useEffect(() => onInstallAvailable(setAvailable), []);

  if (isInstalled()) return null;
  const ios = isIos();
  if (!available && !ios) return null;

  return (
    <div className="relative">
      <button
        onClick={() => (ios ? setShowIosTip((v) => !v) : promptInstall())}
        className="flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-green-400"
      >
        <Download className="h-3.5 w-3.5" /> Install app
      </button>
      {showIosTip && (
        <div role="dialog" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-200 shadow-xl">
          <button onClick={() => setShowIosTip(false)} className="absolute right-2 top-2 text-neutral-500 hover:text-white" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
          <p className="font-semibold text-white">Install on iPhone / iPad</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>Tap <Share className="inline h-3.5 w-3.5" /> <b>Share</b> in Safari's toolbar</li>
            <li>Choose <b>Add to Home Screen</b></li>
          </ol>
        </div>
      )}
    </div>
  );
}
