import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { autoMapLot } from "@/lib/vision/autoMap";
import { imagePixels } from "@/lib/vision/stallFinder";
import { EMPTY_CALIBRATION, normalizeCalibration } from "@/lib/vision/lot";

/**
 * Step 1 of a lot's live feed: drop a satellite / aerial image of the lot.
 * Its spaces are found automatically (painted lines seen from above); the
 * image becomes the lot's 3D animation. onReady({ blob, calibration }) or null.
 */
export default function AerialDrop({ onReady }) {
  const inputRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [found, setFound] = useState(null); // { calibration }
  const [error, setError] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const take = async (file) => {
    if (!file || !file.type.startsWith("image/")) { setError("Drop an image (a satellite or aerial picture of the lot)."); return; }
    setError(""); setFound(null); onReady(null); setBusy(true);
    const u = URL.createObjectURL(file);
    setUrl(u);
    try {
      const img = new Image();
      img.src = u;
      await img.decode();
      const result = autoMapLot({ image: imagePixels(img), vehicles: [], view: "overhead" });
      const calibration = normalizeCalibration({ ...EMPTY_CALIBRATION, stalls: result.stalls, lanes: result.lanes, entrance: result.entrance || null, view: "overhead", aspect: img.naturalWidth / img.naturalHeight });
      setFound({ calibration });
      onReady({ blob: file, calibration });
    } catch (err) {
      setError(err?.message || "Could not read this image.");
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        className={`relative flex min-h-[340px] cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed text-center transition ${over ? "border-green-400 bg-green-500/10" : "border-green-500/40 bg-white/[0.02] hover:bg-white/[0.04]"}`}
      >
        {url ? (
          <div className="relative w-full">
            <img src={url} alt="Satellite image of the lot" className="block w-full" />
            {found && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                {found.calibration.stalls.map((s) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} fill="rgba(34,197,94,0.25)" stroke="#4ade80" strokeWidth="0.2" />)}
              </svg>
            )}
          </div>
        ) : (
          <>
            <ImagePlus className="h-10 w-10 text-green-300" />
            <p className="text-lg font-semibold text-white">Add satellite image</p>
            <p className="max-w-md text-sm text-green-100/70">Drop a satellite or aerial picture of this lot here, or click to choose one. A screenshot from a map works; crop it to the lot so it fits the lot exactly.</p>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <p className="text-sm text-green-100/80">
        {busy ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Finding the spaces…</span>
          : error ? <span className="text-rose-200">{error}</span>
          : found ? <>Found <b>{found.calibration.stalls.length}</b> spaces. Click the image to use a different one, or press <b>Next</b>.</>
          : null}
      </p>
    </div>
  );
}
