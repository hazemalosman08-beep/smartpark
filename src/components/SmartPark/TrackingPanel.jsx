import React from "react";
import { ArrowRightLeft, CameraOff, Radar } from "lucide-react";
import { LOCATION_STATUS, formatClock } from "@/lib/vehicleSessions";

// What the cameras are following right now: temporary IDs, which camera zone each
// vehicle is in, and every handoff between zones.
export default function TrackingPanel({ tracks = [], sessions = [], log = [], zones = [], onOpen }) {
  const stamped = tracks.filter((track) => track.vehicle_id);
  const uncertain = stamped.filter((track) => track.status !== "confirmed");
  const handoffs = log.filter((entry) => /handoff/i.test(entry.note || ""));
  const sessionByVehicle = new Map(sessions.map((session) => [session.vehicle_id, session]));

  const counts = new Map();
  stamped.forEach((track) => counts.set(track.zone, (counts.get(track.zone) || 0) + 1));
  const zoneList = zones.length
    ? zones.map((zone) => ({ name: zone.name, camera: zone.camera }))
    : [...counts.keys()].map((name) => ({ name, camera: "" }));

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#141a16]">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">
            VEHICLE TRACKING
          </p>
          <h2 className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
            <Radar className="h-3.5 w-3.5 text-green-400" /> Visual IDs &amp; handoffs
          </h2>
        </div>
        <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-violet-300">
          {zoneList.length} ZONES
        </span>
      </div>

      <div className="px-4 py-3">
        {stamped.length === 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-dashed border-neutral-700 px-3 py-3 text-[11px] leading-relaxed text-neutral-500">
            <CameraOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No vehicle is being tracked. Tracking starts as soon as a camera feed is open, the
            lot is calibrated and a car is in view.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {zoneList.map((zone, index) => (
                <span
                  key={`${zone.name}-${index}`}
                  className="rounded-full border border-violet-500/30 bg-violet-500/5 px-2 py-0.5 text-[10px] text-violet-200"
                >
                  {zone.camera || `CAM ${index + 1}`} · {zone.name} ·{" "}
                  {counts.get(zone.name) || 0} car{(counts.get(zone.name) || 0) === 1 ? "" : "s"}
                </span>
              ))}
            </div>

            <div className="mt-2 space-y-1.5">
              {stamped.slice(0, 4).map((track) => {
                const tone = LOCATION_STATUS[track.status] || LOCATION_STATUS.unknown;
                const session = sessionByVehicle.get(track.vehicle_id);
                return (
                  <button
                    key={track.key}
                    onClick={() => session && onOpen?.(session)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-left transition-colors hover:border-neutral-600"
                  >
                    <span className="font-mono text-xs font-bold text-green-400">
                      {track.vehicle_id}
                    </span>
                    <span className="truncate text-[10px] text-neutral-400">
                      {track.spot_label ? `Spot ${track.spot_label}` : `Driving · ${track.zone}`}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${tone.border} ${tone.bg} ${tone.text}`}
                    >
                      {tone.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {handoffs.length > 0 && (
              <div className="mt-2.5">
                <p className="mb-1 text-[9px] font-semibold tracking-widest text-neutral-500">
                  RECENT HANDOFFS
                </p>
                {handoffs.slice(0, 3).map((entry) => (
                  <p
                    key={entry.key}
                    className="flex items-center gap-1.5 truncate text-[10px] text-neutral-400"
                  >
                    <ArrowRightLeft className="h-3 w-3 shrink-0 text-violet-300" />
                    <span className="font-mono text-neutral-300">{entry.vehicle_id}</span>
                    <span className="truncate">{entry.note}</span>
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-neutral-600">
                      {formatClock(entry.occurred_at)}
                    </span>
                  </p>
                ))}
              </div>
            )}

            {uncertain.length > 0 && (
              <p className="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-2 py-1 text-[10px] leading-relaxed text-yellow-200">
                {uncertain.length} location{uncertain.length === 1 ? "" : "s"} estimated — a handoff
                without overlapping views, or the vehicle is briefly out of sight.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}