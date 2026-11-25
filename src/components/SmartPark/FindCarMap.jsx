import React, { useMemo } from "react";
import { nearestLane } from "@/lib/streets";

const GREEN = "#33cc66";

function gridSize(spots) {
  const letters = spots
    .map((spot) => String(spot.label ?? "").charAt(0).toUpperCase())
    .filter(Boolean);
  const rows = letters.length ? new Set(letters).size : 2;
  const indexes = spots
    .map((spot) => parseInt(String(spot.label ?? "").replace(/^\D+/, ""), 10))
    .filter(Number.isFinite);
  const cols = indexes.length ? Math.max(...indexes) : 6;
  return { rows: Math.max(1, rows), cols: Math.max(1, cols) };
}

// The driver's view of the mapped lot: their own car marked, everything else just
// an outline, plus the way in.
export default function FindCarMap({ layout, session }) {
  const view = useMemo(() => {
    const spots = layout?.spots || [];
    const target = session?.spot_label
      ? spots.find((spot) => String(spot.label) === String(session.spot_label)) || null
      : null;
    const fallback =
      Number.isFinite(session?.position_x) && Number.isFinite(session?.position_y)
        ? { x: session.position_x, y: session.position_y, label: "last seen" }
        : null;
    const marker = target || fallback;
    if (!marker) return null;

    const { rows, cols } = gridSize(spots);
    const spotW = Math.min(16, (100 / cols) * 0.8);
    const spotH = Math.min(32, (100 / rows) * 0.62);
    const lane = target ? nearestLane(layout?.streets || [], target) : null;
    return {
      spots,
      target,
      marker,
      spotW,
      spotH,
      laneY: lane ? lane.lane.y + lane.lane.h / 2 : null,
      entrance: layout?.entrance || null,
    };
  }, [layout, session]);

  if (!view) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-2xl border border-dashed border-neutral-700">
        <p className="px-6 text-center text-xs text-neutral-500">
          No map is available for this location yet. The parking space is shown above.
        </p>
      </div>
    );
  }

  const { spots, target, marker, spotW, spotH, laneY, entrance } = view;

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-neutral-800 bg-[#121614]">
      {entrance && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${entrance.x}%`, top: `${entrance.y}%` }}
        >
          <div className="h-2.5 w-2.5 rounded-full border border-black/70 bg-green-400" />
          <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[8px] font-bold text-green-300">
            IN
          </span>
        </div>
      )}

      {spots.map((spot) => {
        const isTarget = target && String(spot.label) === String(target.label);
        return (
          <div
            key={spot.label}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[3px] text-[9px] font-bold leading-none"
            style={{
              left: `${spot.x}%`,
              top: `${spot.y}%`,
              width: `${spotW}%`,
              height: `${spotH}%`,
              border: isTarget ? `2px solid ${GREEN}` : "1px solid rgba(255,255,255,0.18)",
              backgroundColor: isTarget ? GREEN : "rgba(255,255,255,0.04)",
              color: isTarget ? "#0b0f0b" : "rgba(255,255,255,0.45)",
            }}
          >
            {spot.label}
          </div>
        );
      })}

      {!target && (
        <div
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
        >
          <div className="h-3 w-3 rounded-full border-2 border-black bg-green-400" />
          <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/80 px-1.5 py-0.5 text-[8px] font-bold text-green-300">
            LAST SEEN
          </span>
        </div>
      )}

      {target && entrance && laneY !== null && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute"
            style={{
              left: `${entrance.x}%`,
              top: `${Math.min(entrance.y, laneY)}%`,
              height: `${Math.abs(entrance.y - laneY)}%`,
              borderLeft: `2px dashed ${GREEN}`,
            }}
          />
          <div
            className="absolute"
            style={{
              left: `${Math.min(entrance.x, target.x)}%`,
              width: `${Math.abs(target.x - entrance.x)}%`,
              top: `${laneY}%`,
              borderTop: `2px dashed ${GREEN}`,
            }}
          />
          <div
            className="absolute"
            style={{
              left: `${target.x}%`,
              top: `${Math.min(laneY, target.y)}%`,
              height: `${Math.abs(laneY - target.y)}%`,
              borderLeft: `2px dashed ${GREEN}`,
            }}
          />
        </div>
      )}

      {target && (
        <div
          className="absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: `${target.x}%`, top: `${target.y - spotH / 2}%` }}
        >
          <span className="whitespace-nowrap rounded-full bg-green-400 px-2 py-0.5 text-[9px] font-bold text-black">
            YOUR CAR · {target.label}
          </span>
        </div>
      )}
    </div>
  );
}