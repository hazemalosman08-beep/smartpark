import React, { useEffect, useState } from "react";
import { CarFront, Loader2, LogIn, LogOut, Navigation } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { LOCATION_STATUS, formatClock, formatDuration } from "@/lib/vehicleSessions";

const EVENT = {
  entry: { icon: LogIn, label: "Entered facility", color: "text-blue-300" },
  move: { icon: Navigation, label: "Moved / guided", color: "text-yellow-300" },
  parked: { icon: CarFront, label: "Parking confirmed", color: "text-green-300" },
  exit: { icon: LogOut, label: "Exited facility", color: "text-neutral-300" },
};

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-800 py-1.5">
      <span className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</span>
      <span className="text-right text-xs text-neutral-200">{value}</span>
    </div>
  );
}

export default function SessionDetailDialog({ session, open, onOpenChange }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !session) return undefined;
    let cancelled = false;
    setLoading(true);
    setEvents([]);
    base44.entities.VehicleEvent.filter(
      { session_id: session.id },
      { sort: "occurred_at", limit: 100 }
    )
      .then((page) => {
        if (!cancelled) setEvents(page.items || []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  if (!session) return null;
  const tone = LOCATION_STATUS[session.location_status] || LOCATION_STATUS.unknown;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-neutral-800 bg-[#12160f] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-lg text-green-400">
            {session.vehicle_id}
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.border} ${tone.bg} ${tone.text}`}
            >
              {tone.label}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-400">
            Parking session activity and camera observations for this temporary ID.
          </DialogDescription>
        </DialogHeader>

        {session.source === "simulation" && (
          <p className="rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-[11px] text-purple-200">
            Simulated session — sample vehicle and sample camera events, not real detection.
          </p>
        )}

        <div>
          <Row label="Status" value={session.status === "active" ? "On site" : "Closed"} />
          <Row label="Parking spot" value={session.spot_label || "Not assigned"} />
          <Row label="Zone" value={session.zone || "—"} />
          <Row
            label="Confidence"
            value={
              Number.isFinite(session.confidence) && session.confidence > 0
                ? `${Math.round(session.confidence * 100)}%`
                : "—"
            }
          />
          <Row label="Entered" value={formatClock(session.entry_time)} />
          <Row
            label="Exited"
            value={session.exit_time ? formatClock(session.exit_time) : "Still on site"}
          />
          <Row
            label="Duration"
            value={formatDuration(session.entry_time, session.exit_time || Date.now())}
          />
          <Row label="Last camera" value={session.camera || "—"} />
        </div>

        <div>
          <p className="mb-2 mt-1 text-[10px] font-semibold tracking-widest text-neutral-500">
            OBSERVATION HISTORY
          </p>
          {loading ? (
            <p className="flex items-center gap-2 py-3 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading observations…
            </p>
          ) : events.length === 0 ? (
            <p className="text-xs text-neutral-600">No observations recorded for this session.</p>
          ) : (
            <ol className="max-h-64 space-y-2 overflow-auto pr-1">
              {events.map((event) => {
                const meta = EVENT[event.type] || EVENT.move;
                const Icon = meta.icon;
                return (
                  <li key={event.id} className="flex gap-2">
                    <span className={`mt-0.5 ${meta.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-neutral-200">{meta.label}</span>
                        <span className="font-mono text-[10px] text-neutral-500">
                          {formatClock(event.occurred_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400">{event.note}</p>
                      <p className="text-[10px] text-neutral-600">
                        {event.camera || "Camera"} · {event.location_status}
                        {Number.isFinite(event.confidence) && event.confidence > 0
                          ? ` · ${Math.round(event.confidence * 100)}%`
                          : ""}
                        {event.spot_label ? ` · ${event.spot_label}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}