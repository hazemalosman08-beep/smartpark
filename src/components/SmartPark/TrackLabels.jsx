import React from "react";

const TONE = {
  confirmed: { border: "rgba(51,204,102,0.95)", color: "#8bf0ac" },
  estimated: { border: "rgba(250,204,21,0.95)", color: "#fde68a" },
  unknown: { border: "rgba(148,163,184,0.8)", color: "#cbd5e1" },
};

// The temporary visual ID of every car the cameras are following, pinned where the
// car is right now, so the label travels with it as it drives. `above` lifts the
// chip off the car instead of covering it.
export default function TrackLabels({ tracks = [], above = false }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {tracks.map((track) => {
        const tone = TONE[track.status] || TONE.unknown;
        return (
          <div
            key={track.key}
            className={`absolute -translate-x-1/2 ${
              above ? "-translate-y-full" : "-translate-y-1/2"
            }`}
            style={{
              left: `${(track.x || 0) + (track.w || 0) / 2}%`,
              top: `${above ? Math.max(0, track.y || 0) : (track.y || 0) + (track.h || 0) / 2}%`,
            }}
          >
            <span
              className="block whitespace-nowrap rounded-full border bg-black/75 px-1.5 py-[1px] font-mono text-[9px] leading-tight"
              style={{ borderColor: tone.border, color: tone.color }}
            >
              {track.vehicle_id || "…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}