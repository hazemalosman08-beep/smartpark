// A camera's mapped lot (its top-down plan, in plan units) placed inside the
// lot's outline on the campus map (local metres, x east, y south; the plan
// is y-down too, so no mirror is needed by default).
//
// Automatic: the plan's long side along the outline's long side, spaces at
// their real size (a painted space is ~2.5 m wide) unless that does not fit,
// centred in the lot. Staff can turn it (90°), flip it, move and resize it:
// a camera's picture can face any way.

const SPACE_WIDTH_M = 2.5;

function hull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i -= 1) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Smallest rectangle around points: centre, angle of its long side, long and short size. */
export function orientedRect(pts) {
  const h = hull(pts);
  let best = null;
  for (let i = 0; i < h.length; i += 1) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of h) { const u = p.x * c + p.y * s, v = -p.x * s + p.y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const w = u1 - u0, hh = v1 - v0;
      best = { area, cx: uc * c - vc * s, cy: uc * s + vc * c, angle: w >= hh ? ang : ang + Math.PI / 2, long: Math.max(w, hh), short: Math.min(w, hh) };
    }
  }
  return best || { cx: 0, cy: 0, angle: 0, long: 1, short: 1, area: 1 };
}

/**
 * Placement of a plan's stalls (each with poly) in a lot outline (metres),
 * with staff adjustments { rot (quarter turns), flip, size (x), dx, dy (m) }.
 */
export function placementFor(stalls, lotOuter, adjust = {}) {
  const pp = stalls.flatMap((s) => s.poly);
  const a = orientedRect(pp), b = orientedRect(lotOuter);
  // Real size from the spaces' widths (their short sides), capped to fit.
  const widths = stalls.map((s) => {
    const q = s.poly;
    const e1 = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), e2 = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
    return Math.min(e1, e2);
  }).filter((w) => w > 0).sort((x, y) => x - y);
  const real = widths.length ? SPACE_WIDTH_M / widths[Math.floor(widths.length / 2)] : 1;
  const fit = Math.min(b.long / a.long, b.short / a.short);
  const scale = Math.min(real, fit) * (adjust.size || 1);
  return {
    pcx: a.cx, pcy: a.cy, cx: b.cx + (adjust.dx || 0), cy: b.cy + (adjust.dy || 0),
    angle: b.angle - a.angle + ((adjust.rot || 0) * Math.PI) / 2, scale, flip: Boolean(adjust.flip),
  };
}

/** A plan point -> campus metres. */
export function toCampus(p, pl) {
  let x = p.x - pl.pcx;
  const y = p.y - pl.pcy;
  if (pl.flip) x = -x;
  const c = Math.cos(pl.angle), s = Math.sin(pl.angle);
  return { x: pl.cx + pl.scale * (x * c - y * s), y: pl.cy + pl.scale * (x * s + y * c) };
}

/** Distance from a point to a polygon (0 inside), and the closest point on it. */
export function pointToPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  let best = { d: Infinity, at: p };
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, at: q };
  }
  return inside ? { d: 0, at: best.at } : best;
}
