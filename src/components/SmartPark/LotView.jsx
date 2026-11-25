import React, { useEffect, useMemo, useRef, useState } from "react";
import { idColor } from "@/lib/vision/overlay";
import { dist } from "@/lib/vision/geometry";

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

// Smoothly glide every vehicle to its latest position (camera updates arrive a
// few times per second; the plan animates at display rate in between).
function useSmoothed(tracks) {
  const shown = useRef(new Map());
  const targets = useRef(tracks);
  targets.current = tracks;
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf;
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const k = 1 - Math.exp(-dt * 9);
      const next = new Map();
      for (const tr of targets.current) {
        if (!tr.ground) continue;
        const prev = shown.current.get(tr.key);
        if (!prev) { next.set(tr.key, { x: tr.ground.x, y: tr.ground.y, heading: tr.heading ?? null }); continue; }
        let heading = prev.heading;
        if (tr.heading !== null && tr.heading !== undefined) {
          if (heading === null) heading = tr.heading;
          else heading += ((((tr.heading - heading) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
        }
        next.set(tr.key, { x: prev.x + (tr.ground.x - prev.x) * k, y: prev.y + (tr.ground.y - prev.y) * k, heading });
      }
      shown.current = next;
      setTick((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return shown.current;
}

// backdrop: { href, x, y, w, h } — the real camera picture in plan coordinates.
// photo:    show it, so the plan looks exactly like the lot; real cars are then
//           visible in the picture and only get their ID tag and outline.
export default function LotView({ lot, statuses, tracks = [], recommended = null, route = [], selected = null, onSelect, highlightStall = null, backdrop = null, photo = false, guide = null, showCars = true, showTags = true, quiet = false }) {
  const showPhoto = Boolean(photo && backdrop);
  const geometry = useMemo(() => {
    const widths = lot.stalls.map((s) => dist(s.poly[0], s.poly[1]));
    const depths = lot.stalls.map((s) => dist(s.front, s.back));
    const unit = 1 / (lot.metersPerUnit || 1);
    const stallW = median(widths) || 2.6 * unit;
    const stallD = median(depths) || 5.2 * unit;
    return {
      carL: Math.min(stallD * 0.84, 5 * unit * 1.2),
      carW: Math.min(stallW * 0.74, 2.1 * unit * 1.2),
      laneW: Math.max(stallW * 2, stallD * 1.1),
      font: Math.max(stallW * 0.34, lot.bounds.w / 120),
    };
  }, [lot]);

  const smooth = useSmoothed(tracks);
  const { bounds } = lot;
  const stallById = useMemo(() => new Map(lot.stalls.map((s) => [s.label, s])), [lot]);

  return (
    <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Top-down plan of the parking lot">
      <defs>
        <pattern id="asphalt" width={geometry.carW} height={geometry.carW} patternUnits="userSpaceOnUse">
          <rect width={geometry.carW} height={geometry.carW} fill="#24282c" />
          <circle cx={geometry.carW * 0.2} cy={geometry.carW * 0.3} r={geometry.carW * 0.03} fill="#2c3136" />
          <circle cx={geometry.carW * 0.7} cy={geometry.carW * 0.75} r={geometry.carW * 0.025} fill="#1e2225" />
        </pattern>
        <marker id="route-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4ade80" />
        </marker>
        <marker id="lane-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.55)" />
        </marker>
      </defs>

      {/* ground */}
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="#141a16" />
      {showPhoto ? (
        <image href={backdrop.href} x={backdrop.x} y={backdrop.y} width={backdrop.w} height={backdrop.h} preserveAspectRatio="none" opacity="0.95" />
      ) : (
        <rect x={0} y={0} width={lot.width} height={lot.height} fill="url(#asphalt)" rx={geometry.carW * 0.3} />
      )}

      {/* lanes */}
      {!showPhoto && lot.lanes.map((lane) => {
        const d = lane.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
        return (
          <g key={lane.id}>
            <path d={d} stroke="#2f353b" strokeWidth={geometry.laneW} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d={d} stroke="rgba(250,204,21,0.55)" strokeWidth={geometry.font * 0.12} strokeDasharray={`${geometry.font * 1.4} ${geometry.font}`} fill="none" />
            {lane.points.slice(1).map((p, i) => {
              const a = lane.points[i];
              const m = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
              const len = dist(a, p);
              if (len < geometry.laneW * 1.2) return null;
              const ux = (p.x - a.x) / len, uy = (p.y - a.y) / len;
              return <path key={i} d={`M${m.x - ux * geometry.font},${m.y - uy * geometry.font} L${m.x + ux * geometry.font},${m.y + uy * geometry.font}`} stroke="rgba(255,255,255,0.45)" strokeWidth={geometry.font * 0.18} markerEnd="url(#lane-arrow)" />;
            })}
          </g>
        );
      })}

      {/* stalls */}
      {lot.stalls.map((s) => {
        const st = statuses?.get(s.id);
        const occupied = st?.status === "occupied";
        const isRec = recommended?.id === s.id;
        const isHi = highlightStall === s.label;
        const fill = showPhoto
          ? isRec ? "rgba(74,222,128,0.55)" : occupied ? "rgba(239,68,68,0.28)" : st ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.08)"
          : isRec ? "rgba(74,222,128,0.35)" : occupied ? "rgba(248,113,113,0.12)" : st ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.03)";
        const pts = s.poly.map((p) => `${p.x},${p.y}`).join(" ");
        const labelAt = { x: s.back.x + (s.front.x - s.back.x) * 0.18, y: s.back.y + (s.front.y - s.back.y) * 0.18 };
        return (
          <g key={s.id}>
            <title>{`${s.label} — ${occupied ? `occupied${st?.vehicle_id ? ` by ${st.vehicle_id}` : ""}` : st ? "free" : "unknown"}`}</title>
            <polygon points={pts} fill={fill} stroke={showPhoto ? (occupied ? "rgba(239,68,68,0.9)" : "rgba(74,222,128,0.9)") : "none"} strokeWidth={geometry.font * 0.08} />
            {/* painted lines: the two sides and the back, open towards the aisle */}
            {!showPhoto && <polyline points={`${s.poly[0].x},${s.poly[0].y} ${s.poly[3].x},${s.poly[3].y} ${s.poly[2].x},${s.poly[2].y} ${s.poly[1].x},${s.poly[1].y}`} fill="none" stroke={isRec || isHi ? "#4ade80" : "rgba(255,255,255,0.8)"} strokeWidth={geometry.font * (isRec || isHi ? 0.22 : 0.1)} />}
            {!quiet && <text x={labelAt.x} y={labelAt.y} fontSize={geometry.font * 0.8} textAnchor="middle" dominantBaseline="middle" fill={occupied ? "rgba(255,255,255,0.35)" : isRec ? "#bbf7d0" : "rgba(255,255,255,0.7)"} fontFamily="ui-monospace, monospace" fontWeight="700">{s.label}</text>}
            {!quiet && !occupied && st && !isRec && (
              <circle cx={s.centroid.x} cy={s.centroid.y} r={geometry.font * 0.28} fill="rgba(74,222,128,0.75)" />
            )}
            {!showPhoto && occupied && !tracks.some((t) => t.spot_label === s.label) && (
              // Occupied, but no tracked vehicle to draw (e.g. a car parked before tracking started)
              <CarShape x={s.centroid.x} y={s.centroid.y} heading={s.heading} L={geometry.carL} W={geometry.carW} color="#6b7280" muted />
            )}
          </g>
        );
      })}

      {/* route to the recommended stall */}
      {route.length > 1 && (
        <polyline
          points={route.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke="#4ade80" strokeWidth={geometry.font * 0.3} strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={`${geometry.font * 0.9} ${geometry.font * 0.6}`} markerEnd="url(#route-arrow)" opacity="0.9"
        >
          <animate attributeName="stroke-dashoffset" from={geometry.font * 3} to="0" dur="1s" repeatCount="indefinite" />
        </polyline>
      )}

      {lot.entrance && <Gate p={lot.entrance} text="IN" color="#4ade80" size={geometry.font} />}
      {lot.exit && <Gate p={lot.exit} text="OUT" color="#f472b6" size={geometry.font} />}

      {/* driver guidance: glowing route, pulsing space, a car showing the way */}
      {guide && <GuideLayer guide={guide} geometry={geometry} />}

      {/* where each guided car is being sent */}
      {tracks.filter((t) => t.route?.length > 1).map((t) => (
        <polyline key={`guide-${t.key}`} points={t.route.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={idColor(t.vehicle_id)} strokeOpacity="0.8" strokeWidth={geometry.font * 0.16} strokeDasharray={`${geometry.font * 0.5} ${geometry.font * 0.4}`} strokeLinecap="round" />
      ))}

      {/* trails */}
      {tracks.filter((t) => t.motion !== "parked" && t.trail?.length > 2).map((t) => (
        <polyline key={`trail-${t.key}`} points={t.trail.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={t.color || idColor(t.vehicle_id)} strokeOpacity="0.35" strokeWidth={geometry.font * 0.18} strokeLinecap="round" />
      ))}

      {/* vehicles */}
      {showCars && tracks.map((t) => {
        const pos = smooth.get(t.key) || t.ground;
        if (!pos) return null;
        const stall = t.spot_label ? stallById.get(t.spot_label) : null;
        // Facing: the stall it is in, its direction of travel, or (seen from above)
        // the long side of its box.
        const boxHeading = t.w && t.h ? ((t.w * (lot.rectified ? 1 : lot.calibration.aspect || 1)) > t.h ? 0 : -Math.PI / 2) : -Math.PI / 2;
        const heading = t.motion === "parked" && stall ? stall.heading : pos.heading ?? t.heading ?? (stall ? stall.heading : boxHeading);
        // A real car is already visible in the photo: tag it instead of drawing over it.
        const inPhoto = showPhoto && (t.real || !t.phase);
        const color = t.color || idColor(t.vehicle_id);
        const tag = idColor(t.vehicle_id); // always bright, readable on dark paint
        const isSel = selected === t.key;
        return (
          <g key={t.key} onClick={() => onSelect?.(isSel ? null : t.key)} style={{ cursor: "pointer" }} opacity={t.state === "lost" ? 0.45 : 1}>
            {inPhoto ? (showTags && <circle cx={pos.x} cy={pos.y} r={geometry.carW * 0.7} fill="none" stroke={tag} strokeWidth={geometry.font * (isSel ? 0.16 : 0.08)} />
            ) : (
              <CarShape x={pos.x} y={pos.y} heading={heading} L={geometry.carL} W={geometry.carW} color={color} selected={isSel} />
            )}
            {showTags && <g transform={`translate(${pos.x},${pos.y - geometry.carL * 0.55})`}>
              <rect x={-geometry.font * 1.35} y={-geometry.font * 0.38} width={geometry.font * 2.7} height={geometry.font * 0.76} rx={geometry.font * 0.2} fill="rgba(0,0,0,0.8)" stroke={tag} strokeWidth={geometry.font * 0.05} />
              <text fontSize={geometry.font * 0.5} textAnchor="middle" dominantBaseline="central" fill={tag} fontFamily="ui-monospace, monospace" fontWeight="700">{t.vehicle_id || "…"}</text>
            </g>}
          </g>
        );
      })}
    </svg>
  );
}

// Point at distance d along a polyline, with its direction.
function along(points, d) {
  let left = d;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const len = dist(a, b);
    if (left <= len || i === points.length - 1) {
      const t = len ? Math.min(1, left / len) : 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    left -= len;
  }
  const last = points[points.length - 1];
  return { ...last, heading: 0 };
}

function GuideLayer({ guide, geometry }) {
  const { route, stall, progress } = guide;
  if (!route || route.length < 2) return null;
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += dist(route[i - 1], route[i]);
  const pos = along(route, total * progress);
  const f = geometry.font;
  const pts = route.map((p) => `${p.x},${p.y}`).join(" ");
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
  return (
    <g pointerEvents="none">
      {stall && (
        <>
          <polygon points={stall.poly.map((p) => `${p.x},${p.y}`).join(" ")} fill={`rgba(74,222,128,${0.35 + 0.35 * pulse})`} stroke="#bbf7d0" strokeWidth={f * 0.2} />
          <circle cx={stall.centroid.x} cy={stall.centroid.y} r={geometry.carL * (0.6 + 0.25 * pulse)} fill="none" stroke="#4ade80" strokeWidth={f * 0.15} opacity={1 - pulse * 0.6} />
        </>
      )}
      <polyline points={pts} fill="none" stroke="rgba(74,222,128,0.25)" strokeWidth={f * 1.1} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts} fill="none" stroke="#4ade80" strokeWidth={f * 0.35} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${f * 0.9} ${f * 0.6}`}>
        <animate attributeName="stroke-dashoffset" from={f * 3} to="0" dur="0.8s" repeatCount="indefinite" />
      </polyline>
      <CarShape x={pos.x} y={pos.y} heading={pos.heading} L={geometry.carL * 1.1} W={geometry.carW * 1.1} color="#22c55e" selected />
      {stall && (
        <g transform={`translate(${stall.centroid.x},${stall.centroid.y - geometry.carL * 0.95})`}>
          <rect x={-f * 1.6} y={-f * 0.7} width={f * 3.2} height={f * 1.4} rx={f * 0.35} fill="#22c55e" />
          <text fontSize={f * 0.95} textAnchor="middle" dominantBaseline="central" fill="#052e16" fontWeight="800" fontFamily="ui-sans-serif, system-ui">{stall.label}</text>
        </g>
      )}
    </g>
  );
}

function Gate({ p, text, color, size }) {
  return (
    <g transform={`translate(${p.x},${p.y})`}>
      <rect x={-size * 1.4} y={-size * 0.6} width={size * 2.8} height={size * 1.2} rx={size * 0.3} fill="rgba(0,0,0,0.75)" stroke={color} strokeWidth={size * 0.08} />
      <text fontSize={size * 0.8} textAnchor="middle" dominantBaseline="central" fill={color} fontWeight="800" fontFamily="ui-sans-serif, system-ui">{text}</text>
    </g>
  );
}

// A top-down car, nose pointing along `heading` (radians, lot space).
function CarShape({ x, y, heading, L, W, color, selected, muted }) {
  const deg = (heading * 180) / Math.PI;
  return (
    <g transform={`translate(${x},${y}) rotate(${deg})`}>
      {selected && <rect x={-L * 0.62} y={-W * 0.75} width={L * 1.24} height={W * 1.5} rx={W * 0.4} fill="none" stroke="#fff" strokeWidth={W * 0.08} strokeDasharray={`${W * 0.25} ${W * 0.15}`} />}
      <rect x={-L / 2 + L * 0.02} y={-W / 2 + W * 0.06} width={L} height={W} rx={W * 0.28} fill="rgba(0,0,0,0.35)" />
      <rect x={-L / 2} y={-W / 2} width={L} height={W} rx={W * 0.28} fill={color} stroke="rgba(0,0,0,0.6)" strokeWidth={W * 0.04} opacity={muted ? 0.7 : 1} />
      {/* windscreen (front) and rear window */}
      <path d={`M${L * 0.12},${-W * 0.38} L${L * 0.28},${-W * 0.32} L${L * 0.28},${W * 0.32} L${L * 0.12},${W * 0.38} Z`} fill="rgba(15,23,42,0.85)" />
      <path d={`M${-L * 0.3},${-W * 0.34} L${-L * 0.38},${-W * 0.3} L${-L * 0.38},${W * 0.3} L${-L * 0.3},${W * 0.34} Z`} fill="rgba(15,23,42,0.75)" />
      <rect x={-L * 0.3} y={-W * 0.36} width={L * 0.42} height={W * 0.72} rx={W * 0.12} fill="rgba(255,255,255,0.12)" />
      {/* headlights */}
      <rect x={L * 0.44} y={-W * 0.42} width={L * 0.05} height={W * 0.18} rx={W * 0.05} fill="#fef9c3" />
      <rect x={L * 0.44} y={W * 0.24} width={L * 0.05} height={W * 0.18} rx={W * 0.05} fill="#fef9c3" />
    </g>
  );
}
