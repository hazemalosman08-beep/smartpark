// Walking from a parked car to the building, the way people walk: along
// walkways and crossings where they exist, between parked cars, across a
// driving aisle where needed, around buildings and (mostly) around planted
// islands. One run from the building gives the walk from every space.
import { dist, pointInPolygon } from "./geometry.js";

export const WALK_SPEED_MPS = 1.3;

// Effort per metre on each surface (lower is preferred).
const EFFORT = { walkway: 1, crossing: 1, space: 1.3, aisle: 1.8, planted: 5 };

/**
 * lot: deriveLot() result; features: sceneFeatures() result or null;
 * destination: { x, y } in lot units (the building entrance).
 */
export function walkPlanner(lot, features, destination) {
  if (!destination || !lot?.stalls?.length) return null;
  const widths = lot.stalls.map((s) => dist(s.poly[0], s.poly[1])).filter((w) => w > 0).sort((a, b) => a - b);
  const stallW = widths[Math.floor(widths.length / 2)] || lot.bounds.w / 40;
  // Area: the lot plus room around the building.
  const pts = [...lot.stalls.flatMap((s) => s.poly), destination, ...(lot.entrance ? [lot.entrance] : [])];
  const pad = stallW * 4;
  const x0 = Math.min(...pts.map((p) => p.x)) - pad, y0 = Math.min(...pts.map((p) => p.y)) - pad;
  const x1 = Math.max(...pts.map((p) => p.x)) + pad, y1 = Math.max(...pts.map((p) => p.y)) + pad;
  const cell = Math.max(stallW * 0.4, Math.max(x1 - x0, y1 - y0) / 260);
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  const at = (i, j) => ({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell });

  // Surface of every cell.
  const effort = new Float32Array(nx * ny);
  const kind = new Uint8Array(nx * ny); // 1 walkway, 2 crossing (for the directions)
  const inSpace = new Uint8Array(nx * ny);
  for (const s of lot.stalls) {
    const xs = s.poly.map((p) => p.x), ys = s.poly.map((p) => p.y);
    for (let j = Math.max(0, Math.floor((Math.min(...ys) - y0) / cell)); j <= Math.min(ny - 1, Math.floor((Math.max(...ys) - y0) / cell)); j += 1) {
      for (let i = Math.max(0, Math.floor((Math.min(...xs) - x0) / cell)); i <= Math.min(nx - 1, Math.floor((Math.max(...xs) - x0) / cell)); i += 1) {
        if (pointInPolygon(at(i, j), s.poly)) inSpace[j * nx + i] = 1;
      }
    }
  }
  const footprints = (lot.footprints || []).map((f) => f.points);
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
    const k = j * nx + i, p = at(i, j);
    const surface = features?.surfaceAt?.(p) || null;
    let e = inSpace[k] ? EFFORT.space : EFFORT.aisle;
    if (surface === "walkway") { e = EFFORT.walkway; kind[k] = 1; } else if (surface === "crossing") { e = EFFORT.crossing; kind[k] = 2; } else if (surface === "planted" && !inSpace[k]) e = EFFORT.planted;
    if (surface === "building" || footprints.some((f) => pointInPolygon(p, f))) e = Infinity;
    effort[k] = e;
  }
  // The building entrance itself (and a little around it) is open.
  const [di, dj] = [Math.floor((destination.x - x0) / cell), Math.floor((destination.y - y0) / cell)];
  const door = Math.ceil((stallW * 1.2) / cell);
  for (let j = dj - door; j <= dj + door; j += 1) for (let i = di - door; i <= di + door; i += 1) {
    if (i >= 0 && j >= 0 && i < nx && j < ny && !Number.isFinite(effort[j * nx + i])) effort[j * nx + i] = EFFORT.aisle;
  }

  // Effort from the building to every cell (Dijkstra, 8 neighbours).
  const cost = new Float64Array(nx * ny).fill(Infinity);
  const next = new Int32Array(nx * ny).fill(-1);
  const heap = [];
  const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  if (di < 0 || dj < 0 || di >= nx || dj >= ny) return null;
  const start = dj * nx + di;
  cost[start] = 0;
  push(0, start);
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [c, k] = pop();
    if (c > cost[k]) continue;
    const i = k % nx, j = (k - i) / nx;
    for (const [dx, dy, len] of STEPS) {
      const a = i + dx, b = j + dy;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (!Number.isFinite(effort[n])) continue;
      const nc = c + len * cell * (effort[n] + effort[k]) / 2;
      if (nc < cost[n]) { cost[n] = nc; next[n] = k; push(nc, n); }
    }
  }

  const cellOf = (p) => {
    const i = Math.floor((p.x - x0) / cell), j = Math.floor((p.y - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    let k = j * nx + i;
    // Inside a building cell (shouldn't happen for a space): nearest open cell.
    if (!Number.isFinite(cost[k])) {
      let best = -1, bd = Infinity;
      for (let r = 1; r < 6 && best < 0; r += 1) for (let b = j - r; b <= j + r; b += 1) for (let a = i - r; a <= i + r; a += 1) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const m = b * nx + a;
        const d = (a - i) ** 2 + (b - j) ** 2;
        if (Number.isFinite(cost[m]) && d < bd) { bd = d; best = m; }
      }
      k = best;
    }
    return k;
  };

  /** Walking route (lot units) from p to the building, with what it uses. */
  const routeFrom = (p) => {
    let k = cellOf(p);
    if (k < 0 || !Number.isFinite(cost[k])) return null;
    const cells = [];
    let uses = { walkway: false, crossing: false };
    for (let guard = 0; k >= 0 && guard < nx * ny; guard += 1) {
      cells.push(k);
      if (kind[k] === 1) uses = { ...uses, walkway: true };
      if (kind[k] === 2) uses = { ...uses, crossing: true };
      k = next[k];
    }
    const pts = [p, ...cells.slice(1, -1).map((c) => at(c % nx, Math.floor(c / nx))), destination];
    const path = simplify(pts, cell * 0.6);
    let length = 0;
    for (let i = 1; i < path.length; i += 1) length += dist(path[i - 1], path[i]);
    return { path, length, ...uses };
  };

  // Walking distance (lot units) for each space, cached.
  const memo = new Map();
  const distanceFor = (stall) => {
    if (!memo.has(stall.id)) memo.set(stall.id, routeFrom(stall.centroid)?.length ?? dist(stall.centroid, destination) * 1.4);
    return memo.get(stall.id);
  };
  return { routeFrom, distanceFor };
}

function simplify(points, eps) {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
  let worst = 0, index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = Math.abs((points[i].x - a.x) * (b.y - a.y) - (points[i].y - a.y) * (b.x - a.x)) / len;
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= eps) return [a, b];
  return [...simplify(points.slice(0, index + 1), eps).slice(0, -1), ...simplify(points.slice(index), eps)];
}
