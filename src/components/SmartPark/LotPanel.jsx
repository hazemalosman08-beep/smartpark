import React, { useEffect, useState } from "react";
import { Car, Gauge, ListOrdered, MapPinned, Minus, Navigation, Pause, Play, Plus } from "lucide-react";
import { idColor } from "@/lib/vision/overlay";
import { formatClock, formatDuration } from "@/lib/vehicleSessions";

const MOTION = {
  moving: { label: "Driving", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  stopped: { label: "Stopped", cls: "text-yellow-300 border-yellow-500/40 bg-yellow-500/10" },
  parked: { label: "Parked", cls: "text-green-300 border-green-500/40 bg-green-500/10" },
};

const EVENT_TONE = { entry: "text-sky-300", parked: "text-green-300", move: "text-yellow-300", exit: "text-neutral-400" };

export function OccupancyCard({ total, occupied }) {
  const pct = total ? Math.round((occupied / total) * 100) : 0;
  const tone = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-400" : "bg-green-500";
  return (
    <section className="rounded-xl border border-neutral-800 bg-[#151b17] p-4">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-neutral-500"><Gauge className="h-3.5 w-3.5" /> OCCUPANCY</h3>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="font-mono text-4xl font-black leading-none text-white">{pct}<span className="text-xl">%</span></div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat value={total - occupied} label="free" cls="text-green-400" />
          <Stat value={occupied} label="taken" cls="text-red-400" />
          <Stat value={total} label="stalls" cls="text-neutral-200" />
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

const Stat = ({ value, label, cls }) => (
  <div>
    <div className={`font-mono text-lg font-bold ${cls}`}>{value}</div>
    <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
  </div>
);

export function GuidanceCard({ recommended, distanceMeters, full }) {
  return (
    <section className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-green-400/80"><Navigation className="h-3.5 w-3.5" /> NEXT DRIVER</h3>
      {recommended ? (
        <p className="mt-1.5 text-sm text-neutral-200">
          Go to <span className="rounded bg-green-500 px-1.5 py-0.5 font-mono font-bold text-neutral-950">{recommended.label}</span>
          {Number.isFinite(distanceMeters) && <span className="text-neutral-400"> · about {Math.round(distanceMeters)} m from the entrance</span>}
        </p>
      ) : (
        <p className="mt-1.5 text-sm font-semibold text-red-300">{full ? "Lot full — no free stall" : "Add an entrance to get directions"}</p>
      )}
    </section>
  );
}

export function SimulationCard({ running, onToggle, rate, onRate, onAdd, onRemove }) {
  return (
    <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-[0.2em] text-violet-300">GUIDE DEMO</h3>
        <button onClick={onToggle} className="flex items-center gap-1 rounded-full border border-violet-400/50 px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-500/10">
          {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {running ? "Pause" : "Run"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
        New cars
        <input type="range" min={1} max={30} value={rate} onChange={(e) => onRate(Number(e.target.value))} className="flex-1 accent-violet-400" />
        <span className="w-14 text-right font-mono text-neutral-200">{rate}/min</span>
      </label>
      <div className="mt-3 flex gap-2">
        <button onClick={onAdd} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-green-500/60 py-1.5 text-xs text-green-300 hover:bg-green-500/10"><Plus className="h-3 w-3" /> Car arrives</button>
        <button onClick={onRemove} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-red-500/60 py-1.5 text-xs text-red-300 hover:bg-red-500/10"><Minus className="h-3 w-3" /> Car leaves</button>
      </div>
    </section>
  );
}

export function VehicleList({ tracks, selected, onSelect }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const list = [...tracks].filter((t) => t.vehicle_id).sort((a, b) => String(a.vehicle_id).localeCompare(String(b.vehicle_id)));
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-neutral-800 bg-[#151b17]">
      <h3 className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2.5 text-[10px] font-semibold tracking-[0.2em] text-neutral-500">
        <Car className="h-3.5 w-3.5" /> VEHICLES <span className="ml-auto font-mono text-neutral-300">{list.length}</span>
      </h3>
      <div className="max-h-64 overflow-auto p-2">
        {!list.length && <p className="px-2 py-3 text-xs text-neutral-500">No vehicles yet.</p>}
        {list.map((t) => {
          const m = MOTION[t.motion] || MOTION.stopped;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(selected === t.key ? null : t.key)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${selected === t.key ? "bg-white/10" : "hover:bg-white/5"}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: t.color || idColor(t.vehicle_id) }} />
              <span className="font-mono font-bold text-white">{t.vehicle_id}</span>
              <span className={`rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase ${m.cls}`}>{m.label}</span>
              <span className="truncate text-neutral-400">
                {t.motion === "parked" ? (t.spot_label ? `in ${t.spot_label}` : "") : t.target_label ? `→ ${t.target_label}` : t.speed ? `${Math.round(t.speed * 3.6)} km/h` : ""}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">{formatDuration(t.first_seen, now)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function EventLog({ events }) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-neutral-800 bg-[#151b17]">
      <h3 className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2.5 text-[10px] font-semibold tracking-[0.2em] text-neutral-500">
        <ListOrdered className="h-3.5 w-3.5" /> ACTIVITY
      </h3>
      <div className="max-h-56 overflow-auto px-4 py-2">
        {!events.length && <p className="py-1 text-xs text-neutral-500">Nothing yet.</p>}
        {events.map((e) => (
          <p key={e.key} className="flex items-baseline gap-2 py-0.5 text-[11px]">
            <span className="shrink-0 font-mono text-[10px] text-neutral-600">{formatClock(e.occurred_at)}</span>
            <span className="font-mono font-bold text-white">{e.vehicle_id}</span>
            <span className={`truncate ${EVENT_TONE[e.type] || "text-neutral-300"}`}>{e.note || e.type}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

export function EmptyLot({ onSample, onCamera }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <MapPinned className="h-10 w-10 text-neutral-600" />
      <p className="text-sm text-neutral-200">The lot hasn't been mapped yet</p>
      <p className="max-w-md text-xs leading-relaxed text-neutral-500">
        Open the Camera tab and draw the stall rows, driving lanes and entrance on the picture. This plan is then built from
        exactly that layout and shows every car where it really is. You can also explore a sample lot.
      </p>
      <div className="flex gap-2">
        <button onClick={onCamera} className="rounded-md border border-green-500 px-4 py-2 text-xs text-green-300 hover:bg-green-500/10">Map my lot</button>
        <button onClick={onSample} className="rounded-md border border-neutral-600 px-4 py-2 text-xs text-neutral-300 hover:border-neutral-400">Load sample lot</button>
      </div>
    </div>
  );
}
