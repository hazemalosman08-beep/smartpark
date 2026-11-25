import React, { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import TrackBoxes from "@/components/SmartPark/TrackBoxes";
import { Image } from "@/components/ui/image";

const STATUS_COLOR = {
  free: "#4CAF50",
  occupied: "#F44336",
  predicted: "#FFEB3B",
  blocked: "#2196F3",
};

export default function ParkingCanvas({ photoUrl, spots, tracks = [], onAddSpot, onSpotClick, onDeleteSpot, addSpots }) {
  const imgRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const handleImgLoad = () => {
    if (imgRef.current) {
      setDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    }
  };

  const handleClick = (e) => {
    if (!photoUrl || !addSpots) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onAddSpot(x, y);
  };

  return (
    <div className="relative w-full h-full min-h-[300px] rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 flex items-center justify-center">
      {photoUrl ? (
        <div className="relative w-full" onClick={handleClick}>
          <Image
            ref={imgRef}
            src={photoUrl}
            alt="Parking lot"
            onLoad={handleImgLoad}
            className="block w-full h-auto select-none"
            fittingType="fit"
            draggable={false}
          />
          {!addSpots && <TrackBoxes tracks={tracks} />}
          {tracks.some((track) => track.vehicle_id && !track.missed) && <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 font-mono text-xs text-foreground">{tracks.filter((track) => track.vehicle_id && !track.missed).length} vehicles identified</span>}
          {(addSpots || !tracks.length ? spots : []).map((s) => (
            <button
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) onDeleteSpot(s.id);
                else onSpotClick(s.id, false);
              }}
              title={`${s.label || "spot"} — ${s.status}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 shadow-lg flex items-center justify-center text-[9px] font-bold text-white hover:scale-125 transition-transform"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: 22,
                height: 22,
                backgroundColor: STATUS_COLOR[s.status],
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center text-neutral-500 px-6 py-16">
          <ImagePlus className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Paste a photo (Ctrl/Cmd+V) or click "Load photo" to begin</p>
        </div>
      )}
    </div>
  );
}