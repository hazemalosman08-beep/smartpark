import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Navigation, Pencil, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import LotInfoDialog from "@/components/SmartPark/LotInfoDialog";

function directionsUrl(info) {
  if (!info) return "";
  if (info.latitude != null && info.longitude != null) {
    return `https://maps.apple.com/?daddr=${info.latitude},${info.longitude}`;
  }
  return `https://maps.apple.com/?daddr=${encodeURIComponent(info.address || "")}`;
}

export default function DirectionsQR() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    base44.entities.LotInfo.list({ limit: 1 })
      .then((page) => {
        if (!cancelled) setInfo(page.items[0] || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="h-[124px] rounded-xl border border-neutral-800 bg-[#1B221B] animate-pulse" />;
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-[#1B221B] p-3 flex items-center gap-4">
      {info ? (
        <>
          <div className="shrink-0 rounded-lg bg-white p-2">
            <QRCodeSVG value={directionsUrl(info)} size={92} level="M" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-green-400">
              <Navigation className="w-3.5 h-3.5" /> SCAN FOR DIRECTIONS
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-white">{info.name || "Parking lot"}</p>
            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-white/60">
              <MapPin className="mt-px w-3 h-3 shrink-0" />
              <span className="truncate">{info.address}</span>
            </p>
            <p className="mt-1 text-[10px] text-white/40">Turn-by-turn navigation in Maps</p>
          </div>
          <button
            onClick={() => setOpen(true)}
            aria-label="Edit lot address"
            className="shrink-0 rounded border border-neutral-700 p-1.5 text-neutral-400 hover:border-green-500 hover:text-green-400"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex flex-1 items-center justify-center gap-2 py-6 text-sm text-green-400 hover:text-green-300"
        >
          <MapPin className="w-4 h-4" /> Set lot address to show directions QR
        </button>
      )}

      <LotInfoDialog open={open} onOpenChange={setOpen} initial={info} onSaved={setInfo} />
    </div>
  );
}