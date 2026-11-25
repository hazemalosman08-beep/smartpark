import React, { useMemo } from "react";
import { dist } from "@/lib/vision/geometry";

// Clean, display-grade plan of the lot for drivers: the painted spaces, the
// parked cars lined up in them, the assigned space and the way there.
const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

const C = {
  bg: "#0b1014",
  surface: "#151c22",
  surfaceEdge: "#222c35",
  line: "rgba(226,232,240,0.55)",
  free: "#22c55e",
  freeFill: "rgba(34,197,94,0.16)",
  takenFill: "rgba(15,23,42,0.55)",
  car: "#94a3b8",
  carDark: "#64748b",
  glass: "#0f172a",
  target: "#4ade80",
};

// ---------------------------------------------------------------------------
// Display tidy-up: straight row edges, and spaces found from parked cars snapped
// into the row they stand in. Only the drawing changes, not the detection.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };

function fitLine(points) {
  const c = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  let sxx = 0, sxy = 0, syy = 0;
  points.forEach((p) => { sxx += (p.x - c.x) ** 2; sxy += (p.x - c.x) * (p.y - c.y); syy += (p.y - c.y) ** 2; });
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c, d: { x: Math.cos(t), y: Math.sin(t) } };
}

// Where the line through p with direction dir meets a fitted line.
function meet(p, dir, line) {
  const n = { x: -line.d.y, y: line.d.x };
  const den = dot(dir, n);
  if (Math.abs(den) < 1e-6) return p;
  const t = dot(sub(line.c, p), n) / den;
  return add(p, mul(dir, t));
}

function tidyStalls(stalls) {
  const byRow = new Map();
  // Painted rows define the layout; spaces inferred from parked cars follow them.
  stalls.filter((s) => !s.learned).forEach((s) => { if (!byRow.has(s.row)) byRow.set(s.row, []); byRow.get(s.row).push(s); });
  const rows = [];
  const out = new Map();
  for (const [row, list] of byRow) {
    if (list.length < 3) continue;
    const front = fitLine(list.flatMap((s) => [s.poly[0], s.poly[1]]));
    const back = fitLine(list.flatMap((s) => [s.poly[3], s.poly[2]]));
    const width = median(list.map((s) => dist(s.poly[0], s.poly[1])));
    const along = (p) => dot(sub(p, front.c), front.d);
    const span = list.map((s) => along(s.centroid));
    rows.push({ row, front, back, width, min: Math.min(...span), max: Math.max(...span), along });
    for (const s of list) {
      const sideL = norm(sub(s.poly[3], s.poly[0])), sideR = norm(sub(s.poly[2], s.poly[1]));
      const poly = [meet(s.poly[0], sideL, front), meet(s.poly[1], sideR, front), meet(s.poly[2], sideR, back), meet(s.poly[3], sideL, back)];
      out.set(s.id, reshape(s, poly));
    }
  }
  // Spaces from parked cars: snap into the row band they stand in.
  for (const s of stalls) {
    if (out.has(s.id)) continue;
    const host = rows.find((r) => {
      // One normal for both edges (the fitted directions can point either way).
      const n = { x: -r.front.d.y, y: r.front.d.x };
      const sf = dot(sub(s.centroid, r.front.c), n), sb = dot(sub(s.centroid, r.back.c), n);
      const a = r.along(s.centroid);
      return Math.sign(sf) !== Math.sign(sb) && a > r.min - r.width * 3 && a < r.max + r.width * 3;
    });
    if (!host) continue;
    const d = host.front.d;
    const c = s.centroid;
    const half = mul(d, host.width / 2);
    const across = norm(sub(meet(c, { x: -d.y, y: d.x }, host.back), meet(c, { x: -d.y, y: d.x }, host.front)));
    const poly = [
      meet(sub(c, half), across, host.front), meet(add(c, half), across, host.front),
      meet(add(c, half), across, host.back), meet(sub(c, half), across, host.back),
    ];
    out.set(s.id, reshape(s, poly));
  }
  // Spaces inferred from a parked car with no painted row around them: there
  // is no real outline to show, so only the car is drawn (one per spot).
  const placed = [];
  for (const s of stalls) {
    if (out.has(s.id)) continue;
    const w = dist(s.poly[0], s.poly[1]), h = dist(s.front, s.back);
    const size = Math.max(w, h);
    const dup = placed.some((p) => dist(p.centroid, s.centroid) < size * 0.55);
    // Seen from above, a car lies along the long side of its box.
    const along = s.poly[1].x - s.poly[0].x;
    const boxW = Math.abs(along), boxH = Math.abs(s.poly[3].y - s.poly[0].y);
    const heading = boxW > boxH ? 0 : -Math.PI / 2;
    const marked = { ...s, loose: true, hidden: dup, heading };
    placed.push(marked);
    out.set(s.id, marked);
  }
  return stalls.map((s) => out.get(s.id) || s);
}

function reshape(s, poly) {
  const front = mul(add(poly[0], poly[1]), 0.5), back = mul(add(poly[2], poly[3]), 0.5);
  return { ...s, poly, front, back, centroid: mul(add(front, back), 0.5), heading: Math.atan2(back.y - front.y, back.x - front.x) };
}

export default function DriverMap({ lot, statuses, recommended, route = [], backdrop = null, photo = false }) {
  const stalls = useMemo(() => tidyStalls(lot.stalls), [lot]);
  const tidyTarget = recommended ? stalls.find((s) => s.id === recommended.id) || recommended : null;
  const geo = useMemo(() => {
    const pts = stalls.flatMap((s) => s.poly);
    if (lot.entrance) pts.push(lot.entrance);
    if (lot.building) pts.push(lot.building);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    const stallW = median(stalls.map((s) => dist(s.poly[0], s.poly[1])));
    const stallD = median(stalls.map((s) => dist(s.front, s.back)));
    return {
      box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
      stallW, stallD,
      stroke: Math.max(0.15, stallW * 0.045),
      font: Math.max(stallW * 0.42, (maxX - minX) / 90),
    };
  }, [stalls, lot.entrance, lot.building]);

  const { box, stroke, font } = geo;
  const showPhoto = Boolean(photo && backdrop);
  // End the route in the middle of the tidied space.
  const routeTidy = tidyTarget && route.length > 1 ? [...route.slice(0, -1), tidyTarget.centroid] : route;
  const routePts = routeTidy.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Parking lot map with your space">
      <defs>
        <filter id="dm-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={font * 0.35} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="dm-car" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={C.carDark} />
          <stop offset="0.5" stopColor={C.car} />
          <stop offset="1" stopColor={C.carDark} />
        </linearGradient>
        <marker id="dm-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={C.target} />
        </marker>
      </defs>

      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={C.bg} />
      {showPhoto ? (
        <image href={backdrop.href} x={backdrop.x} y={backdrop.y} width={backdrop.w} height={backdrop.h} preserveAspectRatio="none" opacity="0.55" />
      ) : (
        <rect x={box.x + font * 0.3} y={box.y + font * 0.3} width={box.w - font * 0.6} height={box.h - font * 0.6} rx={font * 0.8} fill={C.surface} stroke={C.surfaceEdge} strokeWidth={stroke} />
      )}

      {/* spaces */}
      {stalls.map((s) => {
        const taken = statuses?.get(s.id)?.status === "occupied";
        const isTarget = recommended?.id === s.id;
        if (s.loose && !isTarget) return s.hidden || !taken ? null : <Car key={s.id} stall={s} geo={geo} />;
        const pts = s.poly.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <g key={s.id}>
            <polygon points={pts} fill={isTarget ? "rgba(74,222,128,0.35)" : taken ? C.takenFill : C.freeFill} stroke="none" />
            {/* painted lines: both sides and the back, open to the aisle */}
            <polyline
              points={`${s.poly[0].x},${s.poly[0].y} ${s.poly[3].x},${s.poly[3].y} ${s.poly[2].x},${s.poly[2].y} ${s.poly[1].x},${s.poly[1].y}`}
              fill="none" stroke={C.line} strokeWidth={stroke} strokeLinejoin="round"
            />
            {!taken && !isTarget && <circle cx={s.centroid.x} cy={s.centroid.y} r={font * 0.16} fill={C.free} opacity="0.85" />}
            {taken && <Car stall={s} geo={geo} />}
          </g>
        );
      })}

      {/* the way to your space */}
      {recommended && route.length > 1 && (
        <g pointerEvents="none">
          <polyline points={routePts} fill="none" stroke={C.target} strokeOpacity="0.18" strokeWidth={font * 0.9} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={routePts} fill="none" stroke={C.target} strokeWidth={font * 0.22} strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#dm-arrow)" filter="url(#dm-glow)" />
          <polyline points={routePts} fill="none" stroke="#ecfdf5" strokeWidth={font * 0.12} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${font * 0.25} ${font * 0.9}`}>
            <animate attributeName="stroke-dashoffset" from={font * 2.3} to="0" dur="0.9s" repeatCount="indefinite" />
          </polyline>
        </g>
      )}

      {/* your space */}
      {tidyTarget && (
        <g pointerEvents="none">
          <polygon points={tidyTarget.poly.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.target} strokeWidth={stroke * 2.2} filter="url(#dm-glow)">
            <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
          </polygon>
          <circle cx={tidyTarget.centroid.x} cy={tidyTarget.centroid.y} r={font * 0.5} fill="none" stroke={C.target} strokeWidth={stroke * 1.4}>
            <animate attributeName="r" values={`${font * 0.4};${font * 1.4}`} dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <g transform={`translate(${tidyTarget.centroid.x},${tidyTarget.centroid.y})`}>
            <circle r={font * 0.62} fill={C.target} />
            <text fontSize={font * 0.72} textAnchor="middle" dominantBaseline="central" fill="#052e16" fontWeight="800" fontFamily="ui-sans-serif, system-ui">P</text>
          </g>
          <Pill x={tidyTarget.centroid.x} y={tidyTarget.centroid.y - Math.max(geo.stallD * 0.5, font * 1.3) - font * 0.9} text={tidyTarget.label} font={font} bg={C.target} fg="#052e16" />
        </g>
      )}

      {/* walk from your space to the building */}
      {lot.building && tidyTarget && (
        <line x1={tidyTarget.centroid.x} y1={tidyTarget.centroid.y} x2={lot.building.x} y2={lot.building.y}
          stroke="#fbbf24" strokeWidth={font * 0.14} strokeLinecap="round" strokeDasharray={`${font * 0.05} ${font * 0.35}`} opacity="0.9" />
      )}
      {lot.entrance && <Pill x={lot.entrance.x} y={lot.entrance.y} text="ENTRANCE" font={font * 0.7} bg="#e2e8f0" fg="#0f172a" />}
      {lot.building && <Pill x={lot.building.x} y={lot.building.y} text="BUILDING" font={font * 0.7} bg="#fbbf24" fg="#1c1917" />}
    </svg>
  );
}

function Pill({ x, y, text, font, bg, fg }) {
  const w = font * (0.62 * text.length + 1.2);
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-font * 0.75} width={w} height={font * 1.5} rx={font * 0.75} fill={bg} />
      <text fontSize={font * 0.95} textAnchor="middle" dominantBaseline="central" fill={fg} fontWeight="800" letterSpacing={font * 0.04} fontFamily="ui-sans-serif, system-ui">{text}</text>
    </g>
  );
}

// A neat top-down car, centred in its space and facing into it.
function Car({ stall, geo }) {
  // One car size for the whole lot, so the rows look orderly.
  const L = Math.min(geo.stallD * 0.8, geo.stallW * 2.6);
  const W = Math.min(geo.stallW * 0.74, L * 0.5);
  const deg = (stall.heading * 180) / Math.PI;
  const r = W * 0.32;
  return (
    <g transform={`translate(${stall.centroid.x},${stall.centroid.y}) rotate(${deg})`}>
      <rect x={-L / 2 + W * 0.06} y={-W / 2 + W * 0.1} width={L} height={W} rx={r} fill="rgba(0,0,0,0.45)" />
      <rect x={-L / 2} y={-W / 2} width={L} height={W} rx={r} fill="url(#dm-car)" stroke="rgba(15,23,42,0.6)" strokeWidth={geo.stroke * 0.6} />
      {/* windscreen, roof, rear window */}
      <path d={`M${L * 0.1},${-W * 0.38} Q${L * 0.24},${-W * 0.42} ${L * 0.27},${-W * 0.3} L${L * 0.27},${W * 0.3} Q${L * 0.24},${W * 0.42} ${L * 0.1},${W * 0.38} Z`} fill={C.glass} opacity="0.9" />
      <rect x={-L * 0.26} y={-W * 0.34} width={L * 0.36} height={W * 0.68} rx={W * 0.14} fill="rgba(255,255,255,0.08)" />
      <path d={`M${-L * 0.3},${-W * 0.34} L${-L * 0.38},${-W * 0.28} L${-L * 0.38},${W * 0.28} L${-L * 0.3},${W * 0.34} Z`} fill={C.glass} opacity="0.75" />
    </g>
  );
}
