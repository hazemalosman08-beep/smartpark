import React from "react";
import { CheckCircle2, Play, Pause, Gauge } from "lucide-react";

const TONE = {
  green: { border: "border-green-500/40", text: "text-green-400", bar: "bg-green-500" },
  yellow: { border: "border-yellow-500/40", text: "text-yellow-400", bar: "bg-yellow-400" },
  red: { border: "border-red-500/40", text: "text-red-400", bar: "bg-red-500" },
};

export default function DriverGuide({
  spots = [],
  stats,
  simRunning,
  onToggleSim,
  onSimulateEnter,
  onSimulateLeave,
}) {
  const occupancy = stats.total ? Math.round((stats.occupied / stats.total) * 100) : 0;
  const tone = TONE[occupancy >= 90 ? "red" : occupancy >= 70 ? "yellow" : "green"];
  const freeSpots = spots.filter((s) => s.status === "free");

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* How full the lot is */}
      <div
        className={`flex-1 rounded-2xl border ${tone.border} bg-[#1B221B] p-6 flex flex-col items-center justify-center text-center`}
      >
        <div className={`flex items-center gap-2 text-sm font-semibold tracking-widest mb-4 ${tone.text}`}>
          <Gauge className="w-4 h-4" /> LOT OCCUPANCY
        </div>
        <div className="text-7xl font-black text-white font-mono leading-none">
          {occupancy}
          <span className="text-3xl align-top">%</span>
        </div>
        <p className="mt-4 text-sm text-white/70">
          {stats.occupied} of {stats.total} spots taken
        </p>
        <div className="w-full h-2 mt-4 rounded-full bg-neutral-800 overflow-hidden">
          <div
            className={`h-full ${tone.bar} transition-all duration-500`}
            style={{ width: `${occupancy}%` }}
          />
        </div>
        <p className={`mt-4 text-xs font-bold tracking-widest ${stats.free ? tone.text : "text-red-400"}`}>
          {stats.free ? `${stats.free} SPOTS AVAILABLE` : "LOT FULL"}
        </p>
      </div>

      {/* Simulation controls */}
      <div className="rounded-lg border border-neutral-800 bg-[#1B221B] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white tracking-wide">SIMULATION</span>
          <button
            onClick={onToggleSim}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              simRunning
                ? "border-green-500 text-green-400 bg-green-500/10"
                : "border-neutral-700 text-neutral-400 hover:text-white"
            }`}
          >
            {simRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {simRunning ? "Auto ON" : "Auto OFF"}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSimulateEnter}
            className="flex-1 text-xs px-3 py-2 rounded border border-green-500 text-green-400 hover:bg-green-500/10 transition-colors"
          >
            + Car in
          </button>
          <button
            onClick={onSimulateLeave}
            className="flex-1 text-xs px-3 py-2 rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            − Car out
          </button>
        </div>
      </div>

      {/* Availability summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-green-500/50 bg-[#1B221B] p-3 text-center">
          <div className="text-2xl font-bold text-white">{stats.free}</div>
          <div className="text-[11px] text-neutral-400 tracking-wide">FREE</div>
        </div>
        <div className="rounded-xl border border-red-500/50 bg-[#1B221B] p-3 text-center">
          <div className="text-2xl font-bold text-white">{stats.occupied}</div>
          <div className="text-[11px] text-neutral-400 tracking-wide">TAKEN</div>
        </div>
        <div className="rounded-xl border border-neutral-600 bg-[#1B221B] p-3 text-center">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-[11px] text-neutral-400 tracking-wide">TOTAL</div>
        </div>
      </div>

      {/* Free spots */}
      {freeSpots.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-[#1B221B] p-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-xs font-semibold text-white tracking-wide">FREE SPOTS</span>
          </div>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-auto">
            {freeSpots.map((s) => (
              <span
                key={s.id}
                className="px-2.5 py-1 rounded-full text-xs font-mono font-bold text-neutral-900 bg-green-500"
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}