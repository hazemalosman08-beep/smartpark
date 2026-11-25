// The parking lot: stalls, driving lanes, entrance/exit and the mapping from the
// camera picture to a top-down plan of the lot.
//
// Everything the operator draws is stored in CAMERA space (percent of the frame).
// `deriveLot` turns it into LOT space for the top-down view:
//   * with a ground calibration (four lot corners + real size) the picture is
//     rectified with a homography, so the plan is metric and undistorted;
//   * without one, the frame itself is used (aspect ratio preserved).
import {
  applyHomography, boxToPolygon, center, clamp, dist, homographyFromPoints, invertHomography,
  hungarian, pointInPolygon, polygonArea, polygonCentroid, polygonOverlapArea, projectOnSegment,
} from "./geometry.js";

export const EMPTY_CALIBRATION = {
  version: 2,
  view: "angled", // "angled" (pole / building camera) or "overhead" (drone / top-down)
  aspect: 16 / 9,
  stalls: [],
  lanes: [],
  entrance: null,
  exit: null,
  ground: null, // { quad: [4 points in camera %], width: metres, length: metres }
};

export function normalizeCalibration(value) {
  const c = { ...EMPTY_CALIBRATION, ...(value || {}) };
  c.stalls = Array.isArray(c.stalls) ? c.stalls.filter((s) => s?.poly?.length >= 3) : [];
  c.lanes = Array.isArray(c.lanes) ? c.lanes.filter((l) => l?.points?.length >= 2) : [];
  if (!(c.aspect > 0)) c.aspect = 16 / 9;
  return c;
}

// ---------------------------------------------------------------------------
// Stalls

const UNIT_SQUARE = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export const rowLetter = (n) => (n < 26 ? String.fromCharCode(65 + n) : `${String.fromCharCode(65 + Math.floor(n / 26) - 1)}${String.fromCharCode(65 + (n % 26))}`);

export function nextRowLetter(stalls = []) {
  const used = new Set(stalls.map((s) => s.row));
  for (let i = 0; i < 52; i += 1) if (!used.has(rowLetter(i))) return rowLetter(i);
  return "Z";
}

/**
 * Split a row of stalls drawn as one quadrilateral into `count` stalls, following
 * the perspective of the picture (far stalls come out narrower, as they should).
 * quad: [frontLeft, frontRight, backRight, backLeft] — "front" is the aisle side.
 */
export function makeStallRow(quad, count, row, startIndex = 1) {
  const H = homographyFromPoints(UNIT_SQUARE, quad);
  if (!H || count < 1) return [];
  const at = (u, v) => applyHomography(H, { x: u, y: v });
  return Array.from({ length: count }, (_, i) => {
    const u0 = i / count, u1 = (i + 1) / count;
    return {
      id: `${row}${startIndex + i}-${Math.random().toString(36).slice(2, 7)}`,
      row,
      index: startIndex + i,
      label: `${row}${startIndex + i}`,
      poly: [at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)].map(roundPoint),
    };
  });
}

const roundPoint = (p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

// Where a vehicle touches the ground, in camera %. For an angled camera the box
// also covers the car's roof and the pavement behind it, so the footprint is the
// lower part of the box.
export function groundPoint(box, view = "angled") {
  return view === "overhead"
    ? center(box)
    : { x: box.x + box.w / 2, y: box.y + box.h * 0.8 };
}

export function vehicleFootprint(box, view = "angled") {
  if (view === "overhead") {
    return boxToPolygon({ x: box.x + box.w * 0.08, y: box.y + box.h * 0.08, w: box.w * 0.84, h: box.h * 0.84 });
  }
  return boxToPolygon({ x: box.x + box.w * 0.1, y: box.y + box.h * 0.45, w: box.w * 0.8, h: box.h * 0.55 });
}

// A stall shaped like the footprint of a vehicle parked there (used to learn
// stalls from parked cars where the paint is not visible).
export function stallFromVehicle(box, view, row, index) {
  const poly = vehicleFootprint(box, view).map(roundPoint);
  return { id: `${row}${index}-${Math.random().toString(36).slice(2, 7)}`, row, index, label: `${row}${index}`, poly, learned: true };
}

// Overhead or angled? From above, cars at the top and bottom of the picture are
// about the same size; from a low angle, far cars are much smaller.
export function guessView(vehicles = []) {
  if (vehicles.length < 4) return null;
  const sorted = [...vehicles].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const k = Math.max(2, Math.floor(sorted.length / 3));
  const size = (list) => list.reduce((s, v) => s + Math.sqrt(v.w * v.h), 0) / list.length;
  const ratio = size(sorted.slice(0, k)) / size(sorted.slice(-k));
  return ratio > 0.6 ? "overhead" : "angled";
}

// Stalls for parked cars that are not inside any stall yet, grouped into rows
// (used where the paint is hidden under cars or not visible at all).
export function stallsFromVehicles(vehicles, view = "angled", existing = [], { auto = false } = {}) {
  const rows = [];
  [...vehicles].sort((a, b) => groundPoint(a, view).y - groundPoint(b, view).y).forEach((v) => {
    const g = groundPoint(v, view);
    const row = rows.find((r) => Math.abs(r.y - g.y) < v.h * 0.5);
    if (row) { row.items.push(v); row.y = (row.y * (row.items.length - 1) + g.y) / row.items.length; } else rows.push({ y: g.y, items: [v] });
  });
  const stalls = [...existing];
  const added = [];
  rows.forEach((r) => {
    const letter = nextRowLetter(stalls);
    let index = 1;
    r.items.sort((a, b) => a.x - b.x).forEach((v) => {
      if (stalls.some((s) => pointInPolygon(groundPoint(v, view), s.poly))) return;
      if (stallUnder(stalls, v, view)) return;
      const stall = { ...stallFromVehicle(v, view, letter, index), auto };
      // Not on top of a stall that is already there.
      const c = polygonCentroid(stall.poly);
      if (stalls.some((s) => pointInPolygon(c, s.poly))) return;
      index += 1;
      stalls.push(stall);
      added.push(stall);
    });
  });
  return added;
}

// Stall centres from the AI layout mapper -> stall polygons sized by spacing.
export function stallsFromCenters(centers = []) {
  const byRow = new Map();
  centers.forEach((c) => {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
    const row = String(c.row || "A").toUpperCase();
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(c);
  });
  const stalls = [];
  for (const [row, list] of byRow) {
    list.sort((a, b) => a.x - b.x);
    const gaps = list.slice(1).map((c, i) => c.x - list[i].x).filter((g) => g > 0.3).sort((a, b) => a - b);
    const w = clamp(gaps.length ? gaps[Math.floor(gaps.length / 2)] * 0.95 : 6, 1.5, 20);
    const h = clamp(w * 1.6, 3, 30);
    list.forEach((c, i) => {
      stalls.push({
        id: `${row}${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
        row, index: i + 1, label: `${row}${i + 1}`,
        poly: boxToPolygon({ x: c.x - w / 2, y: c.y - h / 2, w, h }).map(roundPoint),
      });
    });
  }
  return stalls;
}

// ---------------------------------------------------------------------------
// Camera space -> lot space

export function deriveLot(calibration) {
  const c = normalizeCalibration(calibration);
  let H = null;
  let width;
  let height;
  let metersPerUnit;
  const quad = c.ground?.quad;
  if (quad?.length === 4 && c.ground.width > 0 && c.ground.length > 0) {
    width = c.ground.width;
    height = c.ground.length;
    H = homographyFromPoints(quad, [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]);
    metersPerUnit = 1;
  }
  if (!H) {
    width = 100 * c.aspect;
    height = 100;
    H = [c.aspect, 0, 0, 0, 1, 0, 0, 0, 1];
    // Without a measured lot, assume the frame spans roughly 60 m.
    metersPerUnit = 60 / width;
  }
  const Hinv = invertHomography(H);
  const toLot = (p) => applyHomography(H, p);
  const toCamera = (p) => applyHomography(Hinv, p);

  const stalls = c.stalls.map((s) => {
    const poly = s.poly.map(toLot);
    const front = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 };
    const back = { x: (poly[2].x + poly[3].x) / 2, y: (poly[2].y + poly[3].y) / 2 };
    return { ...s, cameraPoly: s.poly, poly, centroid: polygonCentroid(poly), front, back, heading: Math.atan2(back.y - front.y, back.x - front.x) };
  });
  const lanes = c.lanes.map((l) => ({ ...l, points: l.points.map(toLot) }));
  const entrance = c.entrance ? toLot(c.entrance) : null;
  const exit = c.exit ? toLot(c.exit) : null;

  // Bounds: the ground rectangle (grown to include anything drawn outside it).
  // Without a ground calibration the plan is cropped to what was mapped, so sky
  // and buildings in the camera picture do not take up the plan.
  const pts = [...stalls.flatMap((s) => s.poly), ...lanes.flatMap((l) => l.points), entrance, exit].filter(Boolean)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const rectified = Boolean(quad?.length === 4 && c.ground.width > 0);
  let minX = 0, minY = 0, maxX = width, maxY = height;
  if (!rectified && pts.length >= 3 && !c.sample) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
    const padC = Math.max(spanX, spanY) * 0.12 + 2;
    minX = Math.max(0, Math.min(...xs) - padC); maxX = Math.min(width, Math.max(...xs) + padC);
    minY = Math.max(0, Math.min(...ys) - padC); maxY = Math.min(height, Math.max(...ys) + padC);
  } else {
    const pad = Math.max(width, height) * 0.03;
    minX = Math.min(0, ...pts.map((p) => p.x - pad));
    minY = Math.min(0, ...pts.map((p) => p.y - pad));
    maxX = Math.max(width, ...pts.map((p) => p.x + pad));
    maxY = Math.max(height, ...pts.map((p) => p.y + pad));
  }

  return {
    calibration: c, H, toLot, toCamera, width, height, metersPerUnit,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    stalls, lanes, entrance, exit,
    rectified,
  };
}

// ---------------------------------------------------------------------------
// Stall occupancy with temporal hysteresis.

function claimScore(stall, box, view) {
  const foot = vehicleFootprint(box, view);
  const stallArea = polygonArea(stall.poly);
  const footArea = polygonArea(foot);
  if (!stallArea || !footArea) return 0;
  const overlap = polygonOverlapArea(foot, stall.poly);
  const g = groundPoint(box, view);
  const inside = pointInPolygon(g, stall.poly) ? 1 : 0;
  if (!overlap && !inside) return 0;
  // Fraction of the stall covered, fraction of the car inside the stall, and
  // whether the car's ground point is in it.
  return 0.35 * Math.min(1, overlap / stallArea) + 0.4 * (overlap / footArea) + 0.25 * inside;
}

/** Assign each vehicle to at most one stall and each stall to at most one vehicle. */
export function assignVehiclesToStalls(stalls, vehicles, view = "angled", minScore = 0.3) {
  if (!stalls.length || !vehicles.length) return new Map();
  const scores = stalls.map((s) => vehicles.map((v) => claimScore(s, v, view)));
  const costs = scores.map((row) => row.map((v) => 1 - v));
  const result = new Map();
  for (const [si, vi] of hungarian(costs)) {
    if (scores[si][vi] >= minScore) result.set(stalls[si].id, { vehicle: vehicles[vi], score: scores[si][vi] });
  }
  return result;
}

export function createOccupancy({ timeConstantMs = 1800, onAt = 0.62, offAt = 0.32 } = {}) {
  const state = new Map(); // stall id -> { evidence, occupied, since, vehicle_id, score }
  let lastNow = 0;

  /**
   * stalls: camera-space stalls; vehicles: [{x,y,w,h,vehicle_id?,motion?}] in camera %.
   * still: a single photo (decide immediately).
   */
  /**
   * appearance: optional Map(stallId -> score) from stallAppearance(); a stall
   * that clearly does not look like empty pavement counts as occupied even when
   * no vehicle was detected in it (dark cars seen from above are easy to miss).
   */
  function update(stalls, vehicles, { view = "angled", now = Date.now(), still = false, appearance = null } = {}) {
    const dt = lastNow ? Math.max(0, now - lastNow) : timeConstantMs;
    lastNow = now;
    const alpha = still ? 1 : 1 - Math.exp(-dt / timeConstantMs);
    const assigned = assignVehiclesToStalls(stalls, vehicles, view);
    const out = new Map();
    for (const stall of stalls) {
      const hit = assigned.get(stall.id);
      // A car merely driving past a stall is weaker evidence than one standing in it.
      let target = hit ? (hit.vehicle.motion === "moving" ? 0.45 : 1) * Math.min(1, 0.4 + hit.score) : 0;
      const looks = appearance?.get(stall.id);
      if (looks !== undefined && looks >= 1.35) target = Math.max(target, 0.85);
      const prev = state.get(stall.id) || { evidence: still ? target : 0, occupied: false, since: now };
      const evidence = prev.evidence + (target - prev.evidence) * alpha;
      let occupied = prev.occupied;
      if (still) occupied = evidence >= 0.5;
      else if (!occupied && evidence >= onAt) occupied = true;
      else if (occupied && evidence <= offAt) occupied = false;
      const next = {
        evidence,
        occupied,
        since: occupied !== prev.occupied ? now : prev.since,
        vehicle_id: occupied ? hit?.vehicle?.vehicle_id || (hit ? "" : prev.vehicle_id) || "" : "",
        score: hit?.score || 0,
      };
      state.set(stall.id, next);
      out.set(stall.id, {
        status: occupied ? "occupied" : "free",
        confidence: Math.round((occupied ? evidence : 1 - evidence) * 100) / 100,
        vehicle_id: next.vehicle_id,
        since: next.since,
        changing: occupied ? evidence < onAt : evidence > offAt,
      });
    }
    for (const id of state.keys()) if (!stalls.some((s) => s.id === id)) state.delete(id);
    return out;
  }

  return { update, reset: () => { state.clear(); lastNow = 0; } };
}

// The stall a vehicle stands in (camera space), if any.
export function stallUnder(stalls, box, view = "angled") {
  let best = null;
  let bestScore = 0.35;
  for (const s of stalls) {
    const score = claimScore(s, box, view);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Routing along the drawn lanes (lot space).

export function buildLaneGraph(lanes, { step, snap } = {}) {
  const nodes = [];
  const edges = new Map();
  const add = (a, b) => {
    const d = dist(nodes[a], nodes[b]);
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a).push([b, d]);
    edges.get(b).push([a, d]);
  };
  const all = lanes.flatMap((l) => l.points);
  if (!all.length) return { nodes, edges };
  const span = Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y));
  const s = step || Math.max(0.5, span / 120);
  const joinDist = snap || s * 2.5;
  const laneOf = [];
  lanes.forEach((lane, li) => {
    let prev = -1;
    for (let i = 0; i < lane.points.length - 1; i += 1) {
      const a = lane.points[i], b = lane.points[i + 1];
      const n = Math.max(1, Math.ceil(dist(a, b) / s));
      for (let k = i === 0 ? 0 : 1; k <= n; k += 1) {
        nodes.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
        laneOf.push(li);
        const id = nodes.length - 1;
        if (prev >= 0) add(prev, id);
        prev = id;
      }
    }
  });
  // Junctions: samples of different lanes close to each other are connected.
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (laneOf[i] !== laneOf[j] && dist(nodes[i], nodes[j]) <= joinDist) add(i, j);
    }
  }
  // Lane ends: a lane that stops short of another (found aisles rarely touch)
  // is joined to the nearest point of every other lane within reach, so the
  // whole lot is drivable.
  const ends = [];
  lanes.forEach((_, li) => {
    const ids = laneOf.map((l, i) => (l === li ? i : -1)).filter((i) => i >= 0);
    if (ids.length) ends.push(ids[0], ids[ids.length - 1]);
  });
  const reach = Math.max(joinDist, span * 0.12);
  for (const e of ends) {
    const nearestByLane = new Map();
    nodes.forEach((n, i) => {
      if (laneOf[i] === laneOf[e]) return;
      const d = dist(nodes[e], n);
      if (d <= reach && d < (nearestByLane.get(laneOf[i])?.d ?? Infinity)) nearestByLane.set(laneOf[i], { i, d });
    });
    for (const { i } of nearestByLane.values()) add(e, i);
  }
  return { nodes, edges };
}

function nearestNode(graph, p) {
  let best = -1, bd = Infinity;
  graph.nodes.forEach((n, i) => { const d = dist(n, p); if (d < bd) { bd = d; best = i; } });
  return best;
}

export function routeBetween(graph, from, to) {
  if (!graph.nodes.length || !from || !to) return from && to ? [from, to] : [];
  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  const distTo = new Float64Array(graph.nodes.length).fill(Infinity);
  const prev = new Int32Array(graph.nodes.length).fill(-1);
  const done = new Uint8Array(graph.nodes.length);
  distTo[start] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < distTo.length; i += 1) if (!done[i] && distTo[i] < best) { best = distTo[i]; u = i; }
    if (u < 0 || u === goal) break;
    done[u] = 1;
    for (const [v, w] of graph.edges.get(u) || []) {
      if (distTo[u] + w < distTo[v]) { distTo[v] = distTo[u] + w; prev[v] = u; }
    }
  }
  if (!Number.isFinite(distTo[goal])) return [from, to];
  const path = [];
  for (let u = goal; u >= 0; u = prev[u]) path.unshift(graph.nodes[u]);
  return simplifyPath([from, ...path, to]);
}

function simplifyPath(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const { distance } = projectOnSegment(b, a, c);
    if (distance > 0.05 * Math.max(0.5, dist(a, c) * 0.02) && dist(a, b) > 1e-6) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

// The route a driver takes to a stall: lanes to the point in front of it, then in.
export function routeToStall(lot, graph, stall, from = lot.entrance) {
  if (!stall || !from) return [];
  const aisle = { x: stall.front.x + (stall.front.x - stall.back.x) * 0.35, y: stall.front.y + (stall.front.y - stall.back.y) * 0.35 };
  const path = routeBetween(graph, from, aisle);
  return [...path, stall.front, stall.centroid];
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  return total;
}

// Driving distance from one point to every lane node (single Dijkstra run).
export function distancesFrom(graph, from) {
  const n = graph.nodes.length;
  const d = new Float64Array(n).fill(Infinity);
  if (!n || !from) return d;
  const start = nearestNode(graph, from);
  d[start] = dist(from, graph.nodes[start]);
  const done = new Uint8Array(n);
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i += 1) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const [v, w] of graph.edges.get(u) || []) if (d[u] + w < d[v]) d[v] = d[u] + w;
  }
  return d;
}

// Recommended free stall: the shortest drive from the entrance.
export function recommendStall(lot, graph, statuses, from = lot.entrance, distances = null) {
  const free = lot.stalls.filter((s) => statuses?.get(s.id)?.status !== "occupied" && !s.blocked);
  if (!free.length) return null;
  if (!from) return free[0];
  const table = graph.nodes.length ? distances || distancesFrom(graph, from) : null;
  let best = null;
  let bestLen = Infinity;
  for (const stall of free) {
    let len;
    if (table) {
      const aisle = { x: stall.front.x + (stall.front.x - stall.back.x) * 0.35, y: stall.front.y + (stall.front.y - stall.back.y) * 0.35 };
      const node = nearestNode(graph, aisle);
      len = table[node] + dist(graph.nodes[node], aisle) + dist(aisle, stall.centroid);
    } else len = dist(from, stall.centroid);
    if (len < bestLen) { best = stall; bestLen = len; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// A sample lot so the plan can be explored without a camera.

export function sampleCalibration() {
  const stalls = [];
  const row = (letter, x0, x1, frontY, backY, count) => {
    stalls.push(...makeStallRow([{ x: x0, y: frontY }, { x: x1, y: frontY }, { x: x1, y: backY }, { x: x0, y: backY }], count, letter));
  };
  row("A", 12, 88, 24, 6, 12);
  row("B", 12, 88, 40, 57, 12);
  row("C", 12, 88, 74, 57, 12);
  return normalizeCalibration({
    view: "overhead",
    aspect: 1.6,
    stalls,
    lanes: [
      { id: "lane-1", points: [{ x: 5, y: 96 }, { x: 5, y: 32 }, { x: 95, y: 32 }, { x: 95, y: 96 }] },
      { id: "lane-2", points: [{ x: 5, y: 84 }, { x: 95, y: 84 }] },
    ],
    entrance: { x: 5, y: 97 },
    exit: { x: 95, y: 97 },
    sample: true,
  });
}

// ---------------------------------------------------------------------------
// Driver directions from a route (lot space): "Drive 20 m", "Turn left", …

export function directionsFor(route, stall, metersPerUnit = 1) {
  if (!route || route.length < 2 || !stall) return [];
  // The last two points are the stall front and centre: the turn into the space.
  const drive = route.slice(0, Math.max(2, route.length - 2));
  const steps = [];
  let run = 0;
  let heading = null;
  const turnName = (delta) => {
    const deg = (delta * 180) / Math.PI;
    if (Math.abs(deg) < 30) return null;
    // Screen/plan y points down, so a positive (clockwise) change is a right turn.
    const side = deg > 0 ? "right" : "left";
    return Math.abs(deg) > 120 ? `Make a U-turn to the ${side}` : `Turn ${side}`;
  };
  for (let i = 1; i < drive.length; i += 1) {
    const a = drive[i - 1], b = drive[i];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    if (heading !== null) {
      const delta = ((h - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turn = turnName(delta);
      if (turn) {
        if (run * metersPerUnit >= 1) steps.push({ kind: "straight", text: `Drive ${Math.max(1, Math.round(run * metersPerUnit))} m` });
        steps.push({ kind: delta > 0 ? "right" : "left", text: turn });
        run = 0;
      }
    }
    heading = h;
    run += len;
  }
  if (run * metersPerUnit >= 1) steps.push({ kind: "straight", text: `Drive ${Math.max(1, Math.round(run * metersPerUnit))} m` });
  // Which side the space is on, relative to the last driving direction.
  if (heading !== null) {
    const last = drive[drive.length - 1];
    const cross = Math.cos(heading) * (stall.centroid.y - last.y) - Math.sin(heading) * (stall.centroid.x - last.x);
    steps.push({ kind: "park", text: `${stall.label} is on your ${cross > 0 ? "right" : "left"}` });
  } else {
    steps.push({ kind: "park", text: `Park in ${stall.label}` });
  }
  return steps;
}
