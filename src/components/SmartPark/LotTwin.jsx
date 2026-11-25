import React, { useMemo } from "react";
import { CarFront, LogIn, LogOut } from "lucide-react";
import TrackLabels from "@/components/SmartPark/TrackLabels";

const TONE = {
  free: {
    border: "1px solid rgba(51,204,102,0.85)",
    background: "rgba(51,204,102,0.10)",
    color: "#8bf0ac",
  },
  occupied: {
    border: "1px solid rgba(248,113,113,0.9)",
    background: "rgba(248,113,113,0.18)",
    color: "#fecaca",
  },
  estimated: {
    border: "1px dashed rgba(250,204,21,0.9)",
    background: "rgba(250,204,21,0.12)",
    color: "#fde68a",
  },
  unknown: {
    border: "1px dashed rgba(148,163,184,0.5)",
    background: "rgba(148,163,184,0.07)",
    color: "#94a3b8",
  },
};

const LEGEND = [
  { key: "free", label: "Available" },
  { key: "occupied", label: "Occupied" },
  { key: "estimated", label: "Estimated" },
  { key: "unknown", label: "Unverified" },
];

// A session on a space always wins over the layout's raw status: a confirmed
// session reads occupied, an estimated one reads estimated.
function toneFor(status, session) {
  if (session) return session.location_status === "confirmed" ? "occupied" : "estimated";
  if (status === "free") return "free";
  if (status === "occupied") return "occupied";
  return "unknown";
}

export default function LotTwin({
  spots = [],
  sessions = [],
  tracks = [],
  zones = [],
  streets = [],
  entrance = null,
  onLoadSample,
}) {
  const layout = useMemo(() => {
    const usable = spots.filter(
      (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.label
    );
    if (!usable.length) return null;

    // Photo/detection coordinates can be pixel-like; bring them into the frame.
    const wide = usable.some((s) => s.x > 100 || s.y > 100);
    let mapped = usable;
    if (wide) {
      const xs = usable.map((s) => s.x);
      const ys = usable.map((s) => s.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      mapped = usable.map((s) => ({
        ...s,
        x: 14 + ((s.x - minX) / spanX) * 72,
        y: 16 + ((s.y - minY) / spanY) * 68,
      }));
    }

    const cols = Math.max(
      1,
      ...mapped.map((s) => parseInt(String(s.label).replace(/^\D+/, ""), 10) || 1)
    );
    const rows = Math.max(1, new Set(mapped.map((s) => String(s.label).charAt(0))).size);
    const spotW = Math.max(5.5, Math.min(11, 82 / cols));
    const spotH = Math.max(11, Math.min(20, (70 / rows) * 0.6));

    const byLabel = new Map(
      sessions.filter((s) => s.spot_label).map((s) => [String(s.spot_label), s])
    );
    const placed = mapped.map((spot) => ({
      ...spot,
      session: byLabel.get(String(spot.label)) || null,
    }));
    const roaming = sessions.filter(
      (s) => !s.spot_label || !mapped.some((spot) => String(spot.label) === String(s.spot_label))
    );
    const zones = [...new Set(mapped.map((s) => String(s.label).charAt(0)))].map((letter) => {
      const inZone = mapped.filter((s) => String(s.label).charAt(0) === letter);
      const free = inZone.filter(
        (s) => s.status === "free" && !byLabel.has(String(s.label))
      ).length;
      return { letter, total: inZone.length, free };
    });

    return { mapped: placed, spotW, spotH, roaming, zones };
  }, [spots, sessions]);

  const entry = entrance || { x: 50, y: 93 };

  return (
    <div className="flex h-full min-h-[440px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-[#0f1310] lg:min-h-[560px]">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">
            DIGITAL LOT TWIN
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-white">Every space, one live map</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-neutral-400">
            {sessions.length} active
          </span>
          <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-green-300">
            LIVE MAP
          </span>
        </div>
      </div>

      {!layout ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <CarFront className="h-8 w-8 text-neutral-600" />
          <p className="text-sm text-neutral-300">No parking spaces mapped yet</p>
          <p className="max-w-sm text-xs leading-relaxed text-neutral-500">
            Load a photo or start the live feed to map your lot, or open a sample layout to
            explore the digital twin.
          </p>
          {onLoadSample && (
            <button
              onClick={onLoadSample}
              className="rounded-md border border-green-500 px-4 py-2 text-xs text-green-400 transition-colors hover:bg-green-500/10"
            >
              Load sample lot
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 p-4">
          <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-xl border border-neutral-800 bg-[#121614]">
            {zones.map((zone, i) => (
              <div
                key={`zone-${i}`}
                className="absolute rounded-[3px]"
                style={{
                  left: `${zone.x}%`,
                  top: `${zone.y}%`,
                  width: `${zone.w}%`,
                  height: `${zone.h}%`,
                  border: "1px dotted rgba(167,139,250,0.7)",
                  backgroundColor: "rgba(167,139,250,0.06)",
                }}
              >
                <span className="absolute left-0 top-0 px-1 text-[8px] font-bold text-violet-300">
                  {zone.camera || `CAM ${i + 1}`} · ZONE {zone.name || String.fromCharCode(65 + i)}
                </span>
              </div>
            ))}

            {streets.map((lane, i) => (
              <div
                key={`lane-${i}`}
                className="absolute rounded-[2px]"
                style={{
                  left: `${lane.x}%`,
                  top: `${lane.y}%`,
                  width: `${lane.w}%`,
                  height: `${lane.h}%`,
                  backgroundColor: "rgba(96,165,250,0.10)",
                  border: "1px dashed rgba(96,165,250,0.55)",
                }}
              >
                <span className="absolute left-0 top-0 px-1 text-[8px] font-bold text-blue-200">
                  LANE {i + 1}
                </span>
              </div>
            ))}

            <div
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
            >
              <div className="flex items-center gap-1 rounded-full border border-green-500/60 bg-black/70 px-1.5 py-0.5">
                <LogIn className="h-2.5 w-2.5 text-green-400" />
                <span className="text-[8px] font-bold tracking-widest text-green-300">IN</span>
              </div>
            </div>

            <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-dashed border-neutral-600 bg-black/60 px-1.5 py-0.5">
              <LogOut className="h-2.5 w-2.5 text-neutral-400" />
              <span className="text-[8px] font-bold tracking-widest text-neutral-400">
                OUT · NOT CALIBRATED
              </span>
            </div>

            {layout.mapped.map((spot) => {
              const tone = TONE[toneFor(spot.status, spot.session)];
              const session = spot.session;
              // Parked cars carry their ID from the session, or from the simulation.
              const vehicle = session?.vehicle_id || spot.vehicle_id || "";
              return (
                <div
                  key={spot.id || spot.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${spot.x}%`,
                    top: `${spot.y}%`,
                    width: `${layout.spotW}%`,
                    height: `${layout.spotH}%`,
                  }}
                >
                  <div
                    title={`${spot.label} — ${
                      session ? `${session.vehicle_id} (${session.location_status})` : spot.status
                    }`}
                    style={{ border: tone.border, background: tone.background, color: tone.color }}
                    className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[4px] text-[9px] font-bold leading-none"
                  >
                    <span>{spot.label}</span>
                    {vehicle && (
                      <span className="max-w-full truncate px-0.5 font-mono text-[7px] font-normal opacity-90">
                        {vehicle}
                      </span>
                    )}
                  </div>
                  {session && (
                    <span
                      className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-[1px] font-mono text-[7px]"
                      style={{
                        background: "rgba(0,0,0,0.75)",
                        color: tone.color,
                        border: tone.border,
                      }}
                    >
                      {session.location_status === "confirmed" ? "CONFIRMED" : "ESTIMATED"}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Vehicles the cameras are following right now, wherever they drive */}
            <TrackLabels tracks={tracks} />
          </div>
        </div>
      )}

      <div className="border-t border-neutral-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ border: TONE[item.key].border, background: TONE[item.key].background }}
              />
              {item.label}
            </span>
          ))}
        </div>

        {layout?.zones.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {layout.zones.map((zone) => (
              <span
                key={zone.letter}
                className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300"
              >
                Zone {zone.letter} · {zone.free}/{zone.total} free
              </span>
            ))}
          </div>
        )}

        {layout?.roaming.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-neutral-500">In transit:</span>
            {layout.roaming.map((s) => (
              <span
                key={s.id}
                className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 font-mono text-[10px] text-yellow-300"
              >
                {s.vehicle_id} · {s.location_status}
              </span>
            ))}
          </div>
        )}

        <p className="mt-2 text-[10px] leading-relaxed text-neutral-600">
          The entry point follows your camera calibration. Space occupancy comes from the mapped
          lot; vehicle IDs come from parking sessions.
        </p>
      </div>
    </div>
  );
}