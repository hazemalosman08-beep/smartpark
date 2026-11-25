import React from "react";
import {
  ArrowRight,
  Camera,
  Frame,
  MapPin,
  RefreshCw,
  Route,
  ScanLine,
  Smartphone,
  Square,
  Trash2,
  Video,
} from "lucide-react";

const ACTIVE_TONE = {
  cyan: "border-cyan-400 text-cyan-300 bg-cyan-400/10",
  magenta: "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-400/10",
  yellow: "border-yellow-400 text-yellow-300 bg-yellow-400/10",
  blue: "border-blue-400 text-blue-300 bg-blue-400/10",
  green: "border-green-400 text-green-300 bg-green-400/10",
  purple: "border-violet-400 text-violet-300 bg-violet-400/10",
};

function ToolButton({ children, active, onClick, disabled, tone = "neutral" }) {
  const activeClass = ACTIVE_TONE[tone] || ACTIVE_TONE.yellow;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 text-[11px] px-2 py-1.5 rounded border bg-neutral-900 transition-colors disabled:opacity-40 ${
        active ? activeClass : "border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500"
      }`}
    >
      {children}
    </button>
  );
}

// The drawing tools sit under the picture, so nothing covers the part of the lot
// the camera is pointed at.
export default function LiveCameraTools({
  tool,
  onTool,
  canClear,
  onClear,
  snapshot,
  onCapture,
  onScan,
  busy,
  calibrated,
  captured,
  onOpenSimulation,
  active,
  onStop,
  onStartCamera,
  remoteRole,
  remoteOpen,
  onOpenRemote,
  onSwitchCamera,
}) {
  const pick = (name) => onTool(tool === name ? "none" : name);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToolButton tone="cyan" active={tool === "spot"} onClick={() => pick("spot")}>
        <Square className="w-3 h-3" /> Stall size
      </ToolButton>
      <ToolButton tone="yellow" active={tool === "boundary"} onClick={() => pick("boundary")}>
        <Frame className="w-3 h-3" /> Boundary
      </ToolButton>
      <ToolButton tone="blue" active={tool === "street"} onClick={() => pick("street")}>
        <Route className="w-3 h-3" /> Street
      </ToolButton>
      <ToolButton tone="purple" active={tool === "zone"} onClick={() => pick("zone")}>
        <Video className="w-3 h-3" /> Camera zone
      </ToolButton>
      <ToolButton tone="green" active={tool === "entrance"} onClick={() => pick("entrance")}>
        <MapPin className="w-3 h-3" /> Entrance
      </ToolButton>
      <ToolButton onClick={onClear} disabled={!canClear}>
        <Trash2 className="w-3 h-3" /> Clear
      </ToolButton>

      {remoteRole === "viewer" && (
        <ToolButton active={remoteOpen} onClick={onOpenRemote}>
          <Smartphone className="w-3 h-3" /> Phone cam
        </ToolButton>
      )}
      {remoteRole === "camera" && (
        <ToolButton onClick={onSwitchCamera}>
          <RefreshCw className="w-3 h-3" /> Switch camera
        </ToolButton>
      )}

      <ToolButton active={Boolean(snapshot)} onClick={onCapture}>
        <Camera className="w-3 h-3" /> {snapshot ? "Back to live" : "Capture"}
      </ToolButton>

      <button
        onClick={onScan}
        disabled={busy}
        className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-green-500 text-green-400 bg-neutral-900 hover:bg-green-500/10 disabled:opacity-40"
      >
        <ScanLine className="w-3 h-3" />
        {busy ? "Scanning…" : calibrated ? "Scan now" : "Scan cars"}
      </button>

      {captured && onOpenSimulation && (
        <button
          onClick={onOpenSimulation}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded bg-green-500 text-neutral-900 font-semibold hover:bg-green-400"
        >
          Simulation <ArrowRight className="w-3 h-3" />
        </button>
      )}

      {!active && remoteRole !== "camera" && onStartCamera && (
        <button
          onClick={onStartCamera}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-green-500 text-green-400 bg-neutral-900 hover:bg-green-500/10"
        >
          <Video className="w-3 h-3" /> Start camera
        </button>
      )}

      {active && (
        <button
          onClick={onStop}
          className="ml-auto text-[11px] px-2.5 py-1.5 rounded border border-red-900 text-white bg-[#8B4242] hover:bg-[#9c5050]"
        >
          Stop
        </button>
      )}
    </div>
  );
}