import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, LogOut, Search, UserPlus } from "lucide-react";
import { LOCATION_STATUS, formatDuration } from "@/lib/vehicleSessions";

function StatusChip({ status }) {
  const tone = LOCATION_STATUS[status] || LOCATION_STATUS.unknown;
  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.border} ${tone.bg} ${tone.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

export default function SessionPanel({
  active = [],
  closed = [],
  ready = true,
  busy = false,
  error,
  onEnter,
  onConfirm,
  onExit,
  onOpen,
}) {
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const needle = query.trim().toUpperCase();
  const matches = (s) => !needle || String(s.vehicle_id || "").toUpperCase().includes(needle);
  const shownActive = active.filter(matches);
  const shownClosed = closed.filter(matches).slice(0, 6);
  const confirmed = active.filter((s) => s.location_status === "confirmed").length;

  return (
    <div className="flex h-full min-h-[440px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-[#1B221B] lg:min-h-[560px]">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">
            VEHICLE SESSIONS
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-white">Temporary vehicle IDs</h2>
        </div>
        <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-purple-300">
          SIMULATION
        </span>
      </div>

      <div className="border-b border-neutral-800 px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => onEnter?.()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-green-500 px-3 py-2 text-xs font-semibold text-green-400 transition-colors hover:bg-green-500/10 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Simulate entry
          </button>
          <button
            onClick={() => onExit?.(active[0])}
            disabled={busy || !active.length}
            className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-red-500 hover:text-red-400 disabled:opacity-40"
          >
            <LogOut className="h-3.5 w-3.5" /> Exit oldest
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
          Sample vehicles and sample camera events. No camera detection is running in this panel.
        </p>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vehicle ID"
            className="w-full rounded-md border border-neutral-700 bg-[#12160f] py-1.5 pl-7 pr-2 text-xs text-white placeholder:text-neutral-600 focus:border-green-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="rounded-lg border border-neutral-800 px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-white">{active.length}</div>
          <div className="text-[9px] tracking-widest text-neutral-500">ACTIVE</div>
        </div>
        <div className="rounded-lg border border-green-500/30 px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-green-400">{confirmed}</div>
          <div className="text-[9px] tracking-widest text-neutral-500">CONFIRMED</div>
        </div>
        <div className="rounded-lg border border-yellow-500/30 px-2 py-1.5 text-center">
          <div className="text-lg font-bold text-yellow-300">{active.length - confirmed}</div>
          <div className="text-[9px] tracking-widest text-neutral-500">ESTIMATED</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        {error && (
          <p className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
            {error}
          </p>
        )}

        {!ready ? (
          <p className="flex items-center gap-2 py-6 text-xs text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sessions…
          </p>
        ) : (
          <>
            <p className="mb-2 text-[10px] font-semibold tracking-widest text-neutral-500">
              ON SITE
            </p>
            {shownActive.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-700 px-3 py-6 text-center text-xs text-neutral-500">
                {active.length
                  ? "No vehicle matches that ID."
                  : "No vehicles on site. Simulate an entry to create a temporary ID."}
              </p>
            ) : (
              shownActive.map((session) => (
                <div
                  key={session.id}
                  className="mb-2 rounded-lg border border-neutral-800 bg-[#12160f] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onOpen?.(session)}
                      className="font-mono text-sm font-bold text-green-400 hover:underline"
                    >
                      {session.vehicle_id}
                    </button>
                    <StatusChip status={session.location_status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-400">
                    <span>{session.spot_label ? `Spot ${session.spot_label}` : "No spot assigned"}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(session.entry_time, now)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {session.location_status !== "confirmed" && (
                      <button
                        onClick={() => onConfirm?.(session)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded border border-green-500/50 px-2 py-1 text-[10px] text-green-300 transition-colors hover:bg-green-500/10 disabled:opacity-40"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Confirm spot
                      </button>
                    )}
                    <button
                      onClick={() => onExit?.(session)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:border-red-500 hover:text-red-400 disabled:opacity-40"
                    >
                      <LogOut className="h-3 w-3" /> Exit
                    </button>
                  </div>
                </div>
              ))
            )}

            <p className="mb-2 mt-4 text-[10px] font-semibold tracking-widest text-neutral-500">
              RECENTLY CLOSED
            </p>
            {shownClosed.length === 0 ? (
              <p className="text-xs text-neutral-600">Closed sessions will appear here.</p>
            ) : (
              shownClosed.map((session) => (
                <button
                  key={session.id}
                  onClick={() => onOpen?.(session)}
                  className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-neutral-800 px-2.5 py-2 text-left transition-colors hover:border-neutral-600"
                >
                  <span className="font-mono text-xs text-neutral-300">{session.vehicle_id}</span>
                  <span className="text-[10px] text-neutral-500">
                    {session.spot_label || "—"} ·{" "}
                    {formatDuration(session.entry_time, session.exit_time)}
                  </span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <p className="border-t border-neutral-800 px-4 py-2 text-[10px] leading-relaxed text-neutral-600">
        A location stays estimated until an observation confirms it. Estimated spots are never
        shown as confirmed.
      </p>
    </div>
  );
}