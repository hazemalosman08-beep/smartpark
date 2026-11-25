import React, { useMemo } from "react";
import { CarFront } from "lucide-react";
import { nearestLane } from "@/lib/streets";
import TrackLabels from "@/components/SmartPark/TrackLabels";

const GREEN = "#33cc66";
const CAR_COLOR = "#8899aa";

// Spot size follows how many spots share the frame, so the map mirrors the lot.
function gridSize(spots) {
  const letters = spots
    .map((s) => String(s.label ?? "").charAt(0).toUpperCase())
    .filter(Boolean);
  const rows = letters.length ? new Set(letters).size : 2;
  const indexes = spots
    .map((s) => parseInt(String(s.label ?? "").replace(/^\D+/, ""), 10))
    .filter(Number.isFinite);
  const cols = indexes.length ? Math.max(...indexes) : 6;
  return { rows: Math.max(1, rows), cols: Math.max(1, cols) };
}

export default function LotMap({
  spots = [],
  recommended,
  streets = [],
  entrance = null,
  sessions = [],
  tracks = [],
}) {
  const layout = useMemo(() => {
    const mapped = spots.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
    if (!mapped.length) return null;

    const { rows, cols } = gridSize(mapped);
    const spotW = Math.min(16, (100 / cols) * 0.8);
    const spotH = Math.min(32, (100 / rows) * 0.62);
    const target = recommended ? mapped.find((s) => s.id === recommended.id) || null : null;

    // The route starts where drivers come in, follows the marked lane, then pulls into the spot.
    let route = null;
    if (target) {
      const lane = nearestLane(streets, target);
      const laneY = lane ? lane.lane.y + lane.lane.h / 2 : Math.min(96, target.y + spotH * 0.8);
      route = {
        laneIndex: lane ? lane.index : null,
        laneY,
        startX: entrance ? entrance.x : lane ? lane.lane.x + lane.lane.w / 2 : target.x,
        startY: entrance ? entrance.y : 100,
        toX: target.x,
        tipY: Math.min(target.y + spotH * 0.22, laneY - 4),
      };
    }

    const byLabel = new Map(
      sessions.filter((s) => s.spot_label).map((s) => [String(s.spot_label), s])
    );

    return { mapped, spotW, spotH, target, route, byLabel };
  }, [spots, recommended, streets, entrance, sessions]);

  return (
    <div className="rounded-2xl border border-neutral-700 bg-[#2e3440] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-white/60">LOT MAP</span>
        {layout?.target && (
          <span className="text-[11px] font-mono font-bold" style={{ color: GREEN }}>
            {layout.target.label}
          </span>
        )}
      </div>

      {!layout ? (
        <div className="aspect-[16/9] flex items-center justify-center">
          <p className="text-xs text-neutral-400">No spots mapped yet.</p>
        </div>
      ) : (
        <div className="relative w-full aspect-[16/10]">
          {entrance && (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
              style={{ left: `${entrance.x}%`, top: `${entrance.y}%` }}
            >
              <div className="w-3 h-3 rounded-full bg-green-400 border border-black/70" />
              <span className="absolute left-1/2 -translate-x-1/2 top-3.5 text-[8px] font-bold text-green-300 whitespace-nowrap">
                IN
              </span>
            </div>
          )}

          {streets.map((lane, i) => (
            <div
              key={`lane-${i}`}
              className="absolute rounded-[2px]"
              style={{
                left: `${lane.x}%`,
                top: `${lane.y}%`,
                width: `${lane.w}%`,
                height: `${lane.h}%`,
                backgroundColor: "rgba(96,165,250,0.16)",
                border: "1px dashed rgba(96,165,250,0.8)",
              }}
            >
              <span className="absolute top-0 left-0 px-1 text-[8px] font-bold text-blue-200">
                LANE {i + 1}
              </span>
            </div>
          ))}

          {layout.mapped.map((spot) => {
            const isTarget = layout.target?.id === spot.id;
            const isFree = spot.status === "free";
            const isOccupied = spot.status === "occupied";
            const session = layout.byLabel.get(String(spot.label)) || null;
            // The car's temporary ID comes from its parking session, or from the
            // simulated car standing in the space.
            const vehicle = session?.vehicle_id || spot.vehicle_id || "";
            const unsure = session && session.location_status !== "confirmed";

            const border = isTarget
              ? `2px solid ${GREEN}`
              : isFree
              ? `1px solid ${GREEN}`
              : spot.status === "blocked"
              ? "1px solid #2196F3"
              : spot.status === "predicted"
              ? "1px solid #FFEB3B"
              : "1px solid rgba(255,255,255,0.3)";

            return (
              <div
                key={spot.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  width: `${layout.spotW}%`,
                  height: `${layout.spotH}%`,
                }}
              >
                <div
                  title={`${spot.label} — ${vehicle || spot.status}`}
                  style={{
                    border,
                    backgroundColor: isTarget ? GREEN : "rgba(255,255,255,0.05)",
                    color: isTarget ? "#0b0f0b" : isFree ? GREEN : "rgba(255,255,255,0.55)",
                  }}
                  className="flex h-full w-full items-center justify-center rounded-[3px] text-[9px] font-bold leading-none overflow-hidden"
                >
                  {isOccupied ? (
                    <CarFront className="w-3 h-3" style={{ color: CAR_COLOR }} />
                  ) : isTarget ? (
                    "FREE"
                  ) : (
                    spot.label
                  )}
                </div>
                {vehicle && (
                  <span
                    className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full border bg-black/80 px-1 py-[1px] font-mono text-[8px] leading-none"
                    style={{
                      borderColor: unsure
                        ? "rgba(250,204,21,0.9)"
                        : "rgba(51,204,102,0.85)",
                      color: unsure ? "#fde68a" : "#8bf0ac",
                    }}
                  >
                    {vehicle}
                  </span>
                )}
              </div>
            );
          })}

          {/* Cars the cameras are following right now, labelled where they are */}
          <TrackLabels tracks={tracks} />

          {layout.route && (
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="absolute"
                style={{
                  left: `${layout.route.startX}%`,
                  top: `${Math.min(layout.route.startY, layout.route.laneY)}%`,
                  height: `${Math.abs(layout.route.startY - layout.route.laneY)}%`,
                  borderLeft: `2px dashed ${GREEN}`,
                }}
              />
              {Math.abs(layout.route.toX - layout.route.startX) > 0.5 && (
                <div
                  className="absolute"
                  style={{
                    left: `${Math.min(layout.route.startX, layout.route.toX)}%`,
                    width: `${Math.abs(layout.route.toX - layout.route.startX)}%`,
                    top: `${layout.route.laneY}%`,
                    borderTop: `2px dashed ${GREEN}`,
                  }}
                />
              )}
              <div
                className="absolute"
                style={{
                  left: `${layout.route.toX}%`,
                  top: `${layout.route.tipY}%`,
                  height: `${Math.max(0, layout.route.laneY - layout.route.tipY)}%`,
                  borderLeft: `2px dashed ${GREEN}`,
                }}
              />
              <div
                className="absolute"
                style={{
                  left: `${layout.route.toX}%`,
                  top: `${layout.route.tipY}%`,
                  transform: "translate(-50%, -100%)",
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderBottom: `9px solid ${GREEN}`,
                }}
              />
              <span
                className="absolute text-[10px] font-medium text-white/80 whitespace-nowrap"
                style={{
                  left: `${layout.route.startX}%`,
                  top: `${layout.route.laneY}%`,
                  transform: "translate(-50%, -150%)",
                }}
              >
                {layout.route.laneIndex !== null
                  ? `Lane ${layout.route.laneIndex + 1}`
                  : "Optimal route"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}