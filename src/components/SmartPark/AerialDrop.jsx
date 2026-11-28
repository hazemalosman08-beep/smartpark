import React, { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { autoMapLot } from "@/lib/vision/autoMap";
import { imagePixels } from "@/lib/vision/stallFinder";
import { findSatelliteStalls } from "@/lib/vision/satelliteStalls";

// Spaces seen from above: the satellite finder (rows of thin painted lines),
// or the general finder if that finds more (big, close-up aerial photos).
function findSpaces(img) {
  const max = 1600;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const sat = findSatelliteStalls(x.getImageData(0, 0, c.width, c.height));
  const satStalls = sat.stalls.map((st) => ({ ...st, label: `${st.row}${st.index}`, id: `${st.row}${st.index}-${Math.random().toString(36).slice(2, 7)}`, auto: true }));
  let general = { stalls: [], lanes: [], entrance: null };
  try { general = autoMapLot({ image: imagePixels(img), vehicles: [], view: "overhead" }); } catch { /* the satellite result stands */ }
  return general.stalls.length > satStalls.length ? general : { stalls: satStalls, lanes: [], entrance: null };
}
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
  // Crop: drag a box around the lot; only that part is kept (spaces are
  // found inside it, and it is what fills the lot on the 3D map).
  const [cropping, setCropping] = useState(false);
  const [box, setBox] = useState(null); // { x0, y0, x1, y1 } in % of the picture
  const drag = useRef(null);
  const original = useRef(null); // the image before cropping
  const [cropped, setCropped] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) };
  };
  const applyCrop = async () => {
    if (!box) return;
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    if (x1 - x0 < 3 || y1 - y0 < 3) { setError("Drag a bigger box around the lot."); return; }
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const sx = Math.round((x0 / 100) * W), sy = Math.round((y0 / 100) * H), sw = Math.round(((x1 - x0) / 100) * W), sh = Math.round(((y1 - y0) / 100) * H);
    // Kept at the picture's own resolution (enlarging blurs the thin lines).
    const k = 1;
    const c = document.createElement("canvas");
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    setCropping(false); setBox(null);
    take(new File([blob], "satellite-cropped.png", { type: "image/png" }), { keepOriginal: true });
  };

  // An image dragged from another web page arrives as a link, not a file.
  const fromDrop = async (dt) => {
    const f = [...(dt.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) return take(f);
    const link = dt.getData("text/uri-list") || dt.getData("text/plain") || (dt.getData("text/html").match(/src="([^"]+)"/) || [])[1];
    if (!link) return setError("Drop an image file (a satellite or aerial picture of the lot).");
    try {
      const blob = await (await fetch(link)).blob();
      if (!blob.type.startsWith("image/")) throw new Error("not an image");
      return take(new File([blob], "satellite", { type: blob.type }));
    } catch {
      return setError("That website does not let its images be copied. Save the image (or take a screenshot) and drop the file, or paste it with Cmd/Ctrl + V.");
    }
  };
  // A screenshot pasted with Cmd/Ctrl + V.
  useEffect(() => {
    const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); take(f); } };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  const take = async (file, { keepOriginal = false } = {}) => {
    if (!file || !file.type.startsWith("image/")) { setError("Drop an image (a satellite or aerial picture of the lot)."); return; }
    if (!keepOriginal) original.current = file;
    setCropped(keepOriginal);
    setError(""); setFound(null); onReady(null); setBusy(true);
    const u = URL.createObjectURL(file);
    setUrl(u);
    try {
      const img = new Image();
      img.src = u;
      await img.decode();
      const result = findSpaces(img);
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
        onClick={() => { if (!url) inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); fromDrop(e.dataTransfer); }}
        className={`relative flex min-h-[340px] ${url ? "" : "cursor-pointer"} flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed text-center transition ${over ? "border-green-400 bg-green-500/10" : "border-green-500/40 bg-white/[0.02] hover:bg-white/[0.04]"}`}
      >
        {url ? (
          <div className="relative w-full">
            <img src={url} alt="Satellite image of the lot" className="block w-full" />
            {found && !cropping && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                {found.calibration.stalls.map((s) => <polygon key={s.id} points={s.poly.map((q) => `${q.x},${q.y}`).join(" ")} fill="rgba(34,197,94,0.25)" stroke="#4ade80" strokeWidth="0.2" />)}
              </svg>
            )}
            {cropping && (
              <div className="absolute inset-0 cursor-crosshair select-none" aria-label="Drag a box around the lot"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); drag.current = p; setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
                onPointerMove={(e) => { if (!drag.current) return; const p = at(e); setBox({ x0: drag.current.x, y0: drag.current.y, x1: p.x, y1: p.y }); }}
                onPointerUp={() => { drag.current = null; }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  {box ? (() => {
                    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
                    return (
                      <>
                        <path d={`M0,0H100V100H0Z M${x0},${y0}V${y1}H${x1}V${y0}Z`} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
                        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#4ade80" strokeWidth="0.4" strokeDasharray="1.5 1" />
                      </>
                    );
                  })() : <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.35)" />}
                </svg>
                {!box && <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-base font-semibold text-white drop-shadow">Drag a box around the lot</p>}
              </div>
            )}
          </div>
        ) : (
          <>
            <ImagePlus className="h-10 w-10 text-green-300" />
            <p className="text-lg font-semibold text-white">Add satellite image</p>
            <p className="max-w-md text-sm text-green-100/70">Drop a satellite or aerial picture of this lot here, click to choose one, or paste a screenshot (Cmd/Ctrl + V). Crop it to the lot so it fits the lot exactly.</p>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {url && (
        <div className="flex flex-wrap items-center gap-2">
          {cropping ? (
            <>
              <button onClick={applyCrop} disabled={!box} className="flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 disabled:opacity-40"><Crop className="h-4 w-4" /> Crop</button>
              <button onClick={() => { setCropping(false); setBox(null); }} className="rounded-md px-3 py-1.5 text-sm text-green-100 ring-1 ring-green-400/40 hover:bg-white/5">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => { setCropping(true); setBox(null); }} className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white ring-1 ring-white/15 hover:bg-white/15"><Crop className="h-4 w-4" /> Crop to the lot</button>
              {cropped && original.current && (
                <button onClick={() => take(original.current)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-green-100 ring-1 ring-white/15 hover:bg-white/5"><RotateCcw className="h-4 w-4" /> Undo crop</button>
              )}
              <button onClick={() => inputRef.current?.click()} className="rounded-md px-3 py-1.5 text-sm text-green-100 ring-1 ring-white/15 hover:bg-white/5">Choose another image</button>
            </>
          )}
        </div>
      )}
      <p className="text-sm text-green-100/80">
        {busy ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Finding the spaces…</span>
          : error ? <span className="text-rose-200">{error}</span>
          : found ? <>Found <b>{found.calibration.stalls.length}</b> spaces. Use <b>Crop to the lot</b> so only the lot is searched and it fills the lot on the map exactly, then press <b>Next</b>.</>
          : null}
      </p>
    </div>
  );
}
