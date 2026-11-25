import React, { useRef, useState } from "react";

const clamp = (v) => Math.max(0, Math.min(100, v));

const PREVIEW_COLOR = {
  spot: "#22d3ee",
  occupied: "#e879f9",
  boundary: "#facc15",
  street: "#60a5fa",
  zone: "#a78bfa",
};
const PREVIEW_FILL = {
  spot: "rgba(34,211,238,0.12)",
  occupied: "rgba(232,121,249,0.12)",
  boundary: "rgba(250,204,21,0.12)",
  street: "rgba(96,165,250,0.12)",
  zone: "rgba(167,139,250,0.12)",
};

const CELL_TONE = {
  free: { border: "rgba(255,255,255,0.55)", fill: "rgba(255,255,255,0.08)" },
  occupied: { border: "rgba(248,113,113,0.9)", fill: "rgba(248,113,113,0.25)" },
  blocked: { border: "rgba(96,165,250,0.9)", fill: "rgba(96,165,250,0.22)" },
  predicted: { border: "rgba(250,204,21,0.9)", fill: "rgba(250,204,21,0.22)" },
};

// Draw rectangles directly on the camera frame: one stall-size box + any number of lot boundaries.
export default function SpotCalibrator({
  tool,
  spotBox,
  boundaries,
  streets = [],
  zones = [],
  entrance,
  grid = [],
  onEntrance,
  onSpotBox,
  onAddBoundary,
  onRemoveBoundary,
  onAddStreet,
  onRemoveStreet,
  onAddZone,
  onRemoveZone,
}) {
  const layerRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const drawing =
    tool === "spot" ||
    tool === "boundary" ||
    tool === "street" ||
    tool === "zone" ||
    tool === "entrance";

  const pointFrom = (e) => {
    const rect = layerRef.current.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * 100),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100),
    };
  };

  const finish = () => {
    if (!drag) return;
    const box = {
      x: Math.min(drag.x1, drag.x2),
      y: Math.min(drag.y1, drag.y2),
      w: Math.abs(drag.x2 - drag.x1),
      h: Math.abs(drag.y2 - drag.y1),
    };
    setDrag(null);
    if (box.w < 1 || box.h < 1) return;
    if (tool === "spot") onSpotBox(box);
    else if (tool === "boundary") onAddBoundary(box);
    else if (tool === "street") onAddStreet(box);
    else if (tool === "zone") onAddZone?.(box);
  };

  const preview = drag && {
    left: Math.min(drag.x1, drag.x2),
    top: Math.min(drag.y1, drag.y2),
    width: Math.abs(drag.x2 - drag.x1),
    height: Math.abs(drag.y2 - drag.y1),
  };

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 select-none"
      style={{ cursor: drawing ? "crosshair" : "default", touchAction: drawing ? "none" : "auto" }}
      onPointerDown={(e) => {
        if (!drawing) return;
        e.preventDefault();
        // The entrance is a single point, so one tap drops it.
        if (tool === "entrance") {
          onEntrance(pointFrom(e));
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pointFrom(e);
        setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = pointFrom(e);
        setDrag((d) => ({ ...d, x2: p.x, y2: p.y }));
      }}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      {/* The stalls tiled from the reference spot — preview before a scan, results after */}
      <div className="absolute inset-0 pointer-events-none">
        {grid.map((cell, i) => {
          const tone = CELL_TONE[cell.status] || CELL_TONE.free;
          return (
            <div
              key={`cell-${cell.row || ""}${cell.index || i}`}
              className="absolute rounded-sm"
              style={{
                left: `${(cell.x ?? 0) - (cell.w ?? 0) / 2}%`,
                top: `${(cell.y ?? 0) - (cell.h ?? 0) / 2}%`,
                width: `${cell.w || 0}%`,
                height: `${cell.h || 0}%`,
                border: `1px solid ${tone.border}`,
                backgroundColor: tone.fill,
              }}
            >
              <span className="absolute top-0 left-0 px-0.5 text-[8px] font-mono font-bold leading-tight bg-white/85 text-black rounded-br-sm whitespace-nowrap">
                {cell.row}
                {cell.index}
              </span>
            </div>
          );
        })}
      </div>

      {streets.map((s, i) => (
        <div
          key={`street-${i}`}
          className="absolute rounded"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            border: "2px dashed #60a5fa",
            backgroundColor: "rgba(96,165,250,0.14)",
          }}
        >
          <span className="absolute -top-4 left-0 px-1 rounded text-[9px] font-mono font-bold bg-blue-400 text-black whitespace-nowrap">
            LANE {i + 1}
          </span>
          <button
            onClick={() => onRemoveStreet(i)}
            className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-blue-400 text-black text-[11px] font-bold leading-none flex items-center justify-center hover:bg-blue-300"
            title="Remove lane"
          >
            ×
          </button>
        </div>
      ))}

      {zones.map((zone, i) => (
        <div
          key={`zone-${i}`}
          className="absolute rounded"
          style={{
            left: `${zone.x}%`,
            top: `${zone.y}%`,
            width: `${zone.w}%`,
            height: `${zone.h}%`,
            border: "2px dotted #a78bfa",
            backgroundColor: "rgba(167,139,250,0.10)",
          }}
        >
          <span className="absolute -top-4 left-0 px-1 rounded text-[9px] font-mono font-bold bg-violet-400 text-black whitespace-nowrap">
            {zone.camera || `CAM ${i + 1}`} · ZONE {zone.name || String.fromCharCode(65 + i)}
          </span>
          <button
            onClick={() => onRemoveZone?.(i)}
            className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-violet-400 text-black text-[11px] font-bold leading-none flex items-center justify-center hover:bg-violet-300"
            title="Remove camera zone"
          >
            ×
          </button>
        </div>
      ))}

      {boundaries.map((b, i) => (
        <div
          key={`boundary-${i}`}
          className="absolute rounded"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: `${b.w}%`,
            height: `${b.h}%`,
            border: "2px dashed #facc15",
            backgroundColor: "rgba(250,204,21,0.08)",
          }}
        >
          <span className="absolute -top-4 left-0 px-1 rounded text-[9px] font-mono font-bold bg-yellow-400 text-black whitespace-nowrap">
            LOT {i + 1}
          </span>
          <button
            onClick={() => onRemoveBoundary(i)}
            className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-yellow-400 text-black text-[11px] font-bold leading-none flex items-center justify-center hover:bg-yellow-300"
            title="Remove boundary"
          >
            ×
          </button>
        </div>
      ))}

      {entrance && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${entrance.x}%`, top: `${entrance.y}%` }}
        >
          <div className="w-4 h-4 rounded-full bg-green-400 border-2 border-black/70 shadow-lg" />
          <span className="absolute left-1/2 -translate-x-1/2 top-5 px-1 rounded text-[9px] font-mono font-bold bg-green-400 text-black whitespace-nowrap">
            ENTRANCE
          </span>
        </div>
      )}

      {spotBox && (
        <div
          className="absolute rounded-sm"
          style={{
            left: `${spotBox.x}%`,
            top: `${spotBox.y}%`,
            width: `${spotBox.w}%`,
            height: `${spotBox.h}%`,
            border: "2px solid #22d3ee",
            backgroundColor: "rgba(34,211,238,0.15)",
          }}
        >
          <span className="absolute -top-4 left-0 px-1 rounded text-[9px] font-mono font-bold bg-cyan-400 text-black whitespace-nowrap">
            STALL
          </span>
        </div>
      )}

      {preview && (
        <div
          className="absolute rounded-sm"
          style={{
            left: `${preview.left}%`,
            top: `${preview.top}%`,
            width: `${preview.width}%`,
            height: `${preview.height}%`,
            border: `2px dashed ${PREVIEW_COLOR[tool] || "#facc15"}`,
            backgroundColor: PREVIEW_FILL[tool] || "rgba(250,204,21,0.12)",
          }}
        />
      )}
    </div>
  );
}