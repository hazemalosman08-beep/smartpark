import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CarFront, Loader2, Search } from "lucide-react";
import { db } from "@/lib/localStore";
import { loadLotLayout } from "@/lib/lotLayout";
import { LOCATION_STATUS, formatClock, formatDuration } from "@/lib/vehicleSessions";
import FindCarMap from "@/components/SmartPark/FindCarMap";
import { loadMyCar } from "@/hooks/useGuidance";

// Drivers only: look up the temporary visual ID from the entry display and see
// where the car is. Nothing else about the lot is exposed here.
const normalizeId = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^SP-\d+$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `SP-${digits}` : raw;
};

export default function FindMyCar() {
  // The car the driver guide saw you park (on this device) is filled in.
  const [query, setQuery] = useState(() => loadMyCar()?.vehicle_id || "");
  const [session, setSession] = useState(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [layout, setLayout] = useState(null);

  useEffect(() => {
    loadLotLayout()
      .then((value) => setLayout(value))
      .catch(() => setLayout(null));
  }, []);

  const search = async (event) => {
    event.preventDefault();
    const id = normalizeId(query);
    if (!id) return;
    setBusy(true);
    setError(null);
    setSearched(true);
    try {
      const page = await db.ParkingSession.filter(
        { vehicle_id: id },
        { sort: "-entry_time", limit: 1 }
      );
      setSession(page.items?.[0] || null);
    } catch (err) {
      setError(err?.message || "Could not look up that vehicle");
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  const tone = session ? LOCATION_STATUS[session.location_status] || LOCATION_STATUS.unknown : null;
  const onSite = session?.status === "active";

  return (
    <div className="min-h-screen bg-[#121212] text-white">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the lot dashboard
        </Link>

        <p className="text-[10px] font-semibold tracking-[0.28em] text-neutral-500">
          PARKVISION DRIVER
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Find my car
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-400">
          Enter the temporary vehicle ID from the entry display. You will see the last place the
          cameras saw your car and how sure that location is.
        </p>

        <form onSubmit={search} className="mt-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SP-1042"
              inputMode="numeric"
              className="w-full rounded-xl border border-neutral-800 bg-[#181c19] py-3 pl-10 pr-3 font-mono text-base tracking-wider text-white placeholder:text-neutral-600 focus:border-green-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-green-400 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CarFront className="h-4 w-4" />}
            Find
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {searched && !busy && !session && !error && (
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-700 px-5 py-8 text-center">
            <p className="text-sm text-neutral-300">No vehicle with that ID</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
              Check the ID on the entry display. Temporary IDs are only kept for the time a vehicle
              stays in the lot.
            </p>
          </div>
        )}

        {session && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-[#141a16]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div>
                <p className="font-mono text-xl font-bold text-green-400">{session.vehicle_id}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Temporary visual ID · not a licence plate
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone.border} ${tone.bg} ${tone.text}`}
              >
                {tone.label}
              </span>
            </div>

            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <div>
                <p className="text-[9px] tracking-widest text-neutral-500">LAST PARKED SPACE</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {session.spot_label || "Not parked"}
                </p>
                <p className="text-[11px] text-neutral-500">
                  {session.zone ? `Zone ${session.zone}` : "Zone unknown"}
                </p>
              </div>
              <div>
                <p className="text-[9px] tracking-widest text-neutral-500">LAST SEEN</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {formatClock(session.last_seen_at)}
                </p>
                <p className="text-[11px] text-neutral-500">
                  {onSite ? "Still in the lot" : `Left at ${formatClock(session.exit_time)}`}
                </p>
              </div>
              <div>
                <p className="text-[9px] tracking-widest text-neutral-500">CONFIDENCE</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {Number.isFinite(session.confidence) && session.confidence > 0
                    ? `${Math.round(session.confidence * 100)}%`
                    : "—"}
                </p>
                <p className="text-[11px] text-neutral-500">
                  On site {formatDuration(session.entry_time, session.exit_time || Date.now())}
                </p>
              </div>
            </div>

            <div className="px-5 pb-5">
              <FindCarMap layout={layout} session={session} />
              {session.location_status !== "confirmed" && (
                <p className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[11px] leading-relaxed text-yellow-200">
                  This location is estimated. A camera has not confirmed the car in this space, so
                  treat it as a guide rather than an exact spot.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}