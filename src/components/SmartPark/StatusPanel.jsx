import React from "react";
import { Grid3x3 } from "lucide-react";

const STATUS_COLOR = {
  free: "#4CAF50",
  occupied: "#F44336",
  predicted: "#FFEB3B",
  blocked: "#2196F3",
};

function LegendItem({ color, label, gold }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={gold ? "inline-block rotate-45" : "inline-block"}
        style={{
          width: 14,
          height: 14,
          backgroundColor: color,
          border: gold ? "2px solid #FFD700" : "none",
        }}
      />
      <span className="text-xs text-neutral-300">{label}</span>
    </div>
  );
}

export default function StatusPanel({ stats, spots, onSimulateEnter, onSimulateLeave, frame, detecting, onDetect }) {
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Legend */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <LegendItem color="#4CAF50" label="Available" />
          <LegendItem color="#FFEB3B" label="Predicted" />
          <LegendItem color="#F44336" label="Occupied" />
          <LegendItem color="#2196F3" label="Blocked" />
          <LegendItem color="#222" label="High conf (>75%)" gold />
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        {stats.total === 0 ? (
          <p className="text-xs text-neutral-500">No spots placed yet — add them in Photo or Split view.</p>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold tracking-wide">LOT FILL</span>
            <span className="text-sm text-green-400 font-mono">
              {stats.free} / {stats.total} spots free
            </span>
          </div>
        )}
        <div className="mt-2 flex gap-3 text-[11px] text-neutral-400">
          <span>Occupied: {stats.occupied}</span>
          <span>Blocked: {stats.blocked}</span>
          <span>Predicted: {stats.predicted}</span>
        </div>
      </div>

      {/* Sim controls */}
      <div className="flex gap-2">
        <button
          onClick={onSimulateEnter}
          className="flex-1 text-xs px-3 py-2 rounded border border-green-500 text-green-400 hover:bg-green-500/10 transition-colors"
        >
          + Simulate car entering
        </button>
        <button
          onClick={onSimulateLeave}
          className="flex-1 text-xs px-3 py-2 rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          − Simulate car leaving
        </button>
      </div>

      {/* Detector feed */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold tracking-wide text-neutral-300">DETECTOR FEED</span>
          <button
            onClick={onDetect}
            disabled={detecting}
            className="text-[10px] px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:border-green-500 hover:text-green-400 disabled:opacity-40"
          >
            {detecting ? "Scanning…" : "Re-scan"}
          </button>
        </div>
        <p className="text-[10px] font-mono text-neutral-500">
          FRAME: {frame} | {spots.length} spaces tracked
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <Grid3x3 className="w-4 h-4 text-neutral-400" />
          <span className="text-xs font-semibold tracking-wide text-neutral-300">OCCUPANCY GRID</span>
        </div>
        {spots.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-neutral-600">Grid is empty — add or detect spots</p>
          </div>
        ) : (
          <GridDisplay spots={spots} />
        )}
        <p className="mt-3 text-[10px] text-neutral-600">
          Updates from the live camera feed or the loaded photo.
        </p>
      </div>
    </div>
  );
}

function GridDisplay({ spots }) {
  // group by row letter
  const rows = {};
  spots.forEach((s) => {
    const letter = (s.label || "Z").charAt(0);
    if (!rows[letter]) rows[letter] = [];
    rows[letter].push(s);
  });
  const letters = Object.keys(rows).sort();
  return (
    <div className="flex-1 flex flex-col gap-2 overflow-auto">
      {letters.map((letter) => (
        <div key={letter} className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-neutral-500 w-4">{letter}</span>
          <div className="flex gap-1.5 flex-wrap">
            {rows[letter]
              .sort((a, b) => (a.label || "").localeCompare((b.label || ""), undefined, { numeric: true }))
              .map((s) => (
                <div
                  key={s.id}
                  title={`${s.label || "spot"} — ${s.status}`}
                  className="w-7 h-7 rounded-sm border border-neutral-700 flex items-center justify-center text-[9px] font-bold text-white/90"
                  style={{ backgroundColor: STATUS_COLOR[s.status] }}
                >
                  {(s.label || "").replace(/^\D+/g, "")}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}