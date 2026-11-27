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
  building: null, // where drivers walk to (building entrance), camera %
  buildings: [], // more destinations: [{ id, x, y, name }] in camera %
  footprints: [], // building outlines drawn by hand: [{ id, points }] in camera %
  exit: null,
  ground: null, // { quad: [4 points in camera %], width: metres, length: metres }
};

export function normalizeCalibration(value) {
  const c = { ...EMPTY_CALIBRATION, ...(value || {}) };
  c.stalls = Array.isArray(c.stalls) ? c.stalls.filter((s) => s?.poly?.length >= 3) : [];
  c.lanes = Array.isArray(c.lanes) ? c.lanes.filter((l) => l?.points?.length >= 2) : [];
  c.footprints = Array.isArray(c.footprints) ? c.footprints.filter((f) => f?.points?.length >= 3) : [];
  c.buildings = Array.isArray(c.buildings) ? c.buildings.filter((b) => Number.isFinite(b?.x) && Number.isFinite(b?.y)) : [];
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

// The part of a vehicle used to decide which space it occupies. From an angle
// only the bottom 35% of the box is the car's contact with the ground; the rest
// is body and roof, which on a tall SUV or van covers the space behind it.
// From above the whole box is the footprint.
export function occupancyFootprint(box, view = "angled") {
  if (view === "overhead") return vehicleFootprint(box, view);
  return boxToPolygon({ x: box.x + box.w * 0.1, y: box.y + box.h * 0.65, w: box.w * 0.8, h: box.h * 0.35 });
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
  const building = c.building ? toLot(c.building) : null;
  const exit = c.exit ? toLot(c.exit) : null;
  // Every destination drivers can pick; the first is the main building.
  const footprints = c.footprints.map((f) => ({ id: f.id, points: f.points.map(toLot) }));
  const buildings = [
    ...(c.building ? [{ id: "main", name: c.building.name || "Main building", ...building }] : []),
    ...c.buildings.map((b, i) => ({ id: b.id || `b${i + 2}`, name: b.name || `Building ${i + 2}`, ...toLot(b) })),
  ];
  // Real-world scale. Without a measured lot, painted spaces are about 2.5 m
  // wide: that is a far better yardstick than an assumed frame width.
  let scaleSource = quad?.length === 4 && c.ground?.width > 0 ? (c.ground.auto ? "estimated" : "measured") : "assumed";
  // An automatic (estimated) straightening is checked the same way: if it
  // makes spaces narrower than 2 m or wider than 3.2 m, its size is wrong.
  if (scaleSource !== "measured" && stalls.length >= 3) {
    const widths = stalls.map((st) => dist(st.poly[0], st.poly[1])).filter((w) => w > 0).sort((a, b) => a - b);
    const w = widths[Math.floor(widths.length / 2)];
    const metres = w * metersPerUnit;
    if (w > 0 && (scaleSource === "assumed" || metres < 2 || metres > 3.2)) { metersPerUnit = 2.5 / w; scaleSource = "estimated"; }
  }

  // Bounds: the ground rectangle (grown to include anything drawn outside it).
  // Without a ground calibration the plan is cropped to what was mapped, so sky
  // and buildings in the camera picture do not take up the plan.
  const pts = [...stalls.flatMap((s) => s.poly), ...lanes.flatMap((l) => l.points), entrance, exit, ...buildings].filter(Boolean)
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
    stalls, lanes, entrance, exit, building, buildings, footprints, scaleSource,
    rectified,
  };
}

// ---------------------------------------------------------------------------
// Stall occupancy with temporal hysteresis.

function claimScore(stall, box, view) {
  const foot = occupancyFootprint(box, view);
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
      // A space that clearly does not look like empty pavement counts as taken
      // even without a detected car (cars under trees, very dark cars).
      // Next to a space with a detected car, overhang and its shadow spill
      // over: stronger evidence is needed there.
      const besideCar = looks !== undefined && !hit && stall.row && stalls.some((o) => o.row === stall.row && Math.abs((o.index ?? NaN) - (stall.index ?? NaN)) === 1 && assigned.get(o.id));
      if (looks !== undefined && looks >= (besideCar ? 2 : 1.4) && !hit) target = Math.max(target, 0.85);
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
export function routeToStall(lot, graph, stall, from = lot.entrance, { obstacle = null } = {}) {
  if (!stall || !from) return [];
  const aisle = { x: stall.front.x + (stall.front.x - stall.back.x) * 0.35, y: stall.front.y + (stall.front.y - stall.back.y) * 0.35 };
  // Lanes drawn by hand are followed exactly; otherwise the route is planned
  // over the open pavement between the spaces (found aisles can be incomplete).
  const manualLanes = lot.lanes.some((l) => !l.auto);
  let path = manualLanes ? routeBetween(graph, from, aisle) : gridRoute(lot, from, aisle, { ignore: stall.id, obstacle });
  // Islands/buildings read from the picture are avoided; if they seem to wall
  // the space off completely, the picture was misread: plan without them.
  if (!manualLanes && obstacle && path.length <= 2) path = gridRoute(lot, from, aisle, { ignore: stall.id });
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

// Driving distance from the entrance to a stall (lot units).
export function driveDistance(lot, graph, stall, from = lot.entrance, distances = null) {
  if (!from) return 0;
  const table = graph.nodes.length ? distances || distancesFrom(graph, from) : null;
  if (!table) return dist(from, stall.centroid);
  const aisle = { x: stall.front.x + (stall.front.x - stall.back.x) * 0.35, y: stall.front.y + (stall.front.y - stall.back.y) * 0.35 };
  const node = nearestNode(graph, aisle);
  const viaLanes = table[node] + dist(graph.nodes[node], aisle) + dist(aisle, stall.centroid);
  // A row the detected aisles do not reach still exists: use the straight line.
  return Number.isFinite(viaLanes) ? viaLanes : dist(from, stall.centroid) * 1.3;
}

// Walking distance from a stall to the building (straight line, lot units).
// With a walking planner (walking.js) on the lot, the real walk is used.
export const walkDistance = (lot, stall) => {
  if (!lot.building) return null;
  return lot.walkDistanceFor ? lot.walkDistanceFor(stall) : dist(stall.centroid, lot.building);
};

// How good a stall is for a driver: with a building set, the shortest walk to
// it wins (people care about walking more than about a few metres of driving);
// otherwise the shortest drive from the entrance.
export function stallCost(lot, graph, stall, distances = null) {
  const drive = driveDistance(lot, graph, stall, lot.entrance, distances);
  if (lot.building) return walkDistance(lot, stall) + drive * 0.1;
  return drive;
}

// Recommended free stall.
// Reserved spaces are never recommended; accessible spaces only to drivers who
// need one (and then first).
export function recommendStall(lot, graph, statuses, from = lot.entrance, distances = null, { accessible = false, exclude = null } = {}) {
  // A space no camera sees ("unknown") is not offered: it may be taken.
  let free = lot.stalls.filter((s) => !["occupied", "unknown"].includes(statuses?.get(s.id)?.status) && !s.blocked && s.kind !== "reserved" && !exclude?.has(s.id));
  if (accessible) {
    const acc = free.filter((s) => s.kind === "accessible");
    if (acc.length) free = acc;
  } else free = free.filter((s) => s.kind !== "accessible");
  if (!free.length) return null;
  if (!from && !lot.building) return free[0];
  const table = from && graph.nodes.length ? distances || distancesFrom(graph, from) : null;
  let best = null;
  let bestCost = Infinity;
  for (const stall of free) {
    const cost = stallCost(lot, graph, stall, table);
    if (cost < bestCost) { best = stall; bestCost = cost; }
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

// ---------------------------------------------------------------------------
// Duplicate spaces: any two spaces overlapping by more than 30% (intersection
// over union) are one space. The more trustworthy source wins: drawn by hand,
// then painted lines, then inferred from a parked car. Two spaces inferred from
// parked cars are only merged when the cars stand in the same place (angled
// neighbours' boxes overlap a lot but are two real spaces).
const stallRank = (s) => (!s.auto && !s.learned ? 0 : s.learned ? 2 : 1);

export function stallIoU(a, b) {
  const inter = polygonOverlapArea(a.poly, b.poly);
  if (!inter) return 0;
  return inter / (polygonArea(a.poly) + polygonArea(b.poly) - inter);
}

export function dedupeStalls(stalls, threshold = 0.3) {
  const order = stalls.map((s, i) => ({ s, i })).sort((a, b) => stallRank(a.s) - stallRank(b.s) || a.i - b.i);
  const kept = [];
  for (const { s } of order) {
    const clash = kept.some((k) => {
      if (stallIoU(s, k) <= threshold) return false;
      // A space inferred from a parked car is the same space only if the car
      // stands in the middle of the other one (both centres close together).
      // Angled neighbours, or an oversized neighbouring space reaching over the
      // car's box, overlap a lot but are separate real spaces.
      if (stallRank(s) === 2 || stallRank(k) === 2) {
        const size = Math.sqrt(Math.min(polygonArea(s.poly), polygonArea(k.poly)));
        return dist(polygonCentroid(s.poly), polygonCentroid(k.poly)) < size * 0.5;
      }
      return true;
    });
    if (!clash) kept.push(s);
  }
  // Keep the original order (row/number order) for everything that stays.
  const keep = new Set(kept);
  return stalls.filter((s) => keep.has(s));
}

// The one place open/taken numbers are counted. Every screen (camera counter,
// Lot tab, Driver screen) calls this with the same spaces and statuses, so they
// always agree.
// Spaces marked "unknown" (no camera covers them, e.g. a site map seen by one
// camera) are neither open nor taken.
export function occupancyCounts(stalls = [], statuses) {
  let taken = 0, unknown = 0;
  for (const s of stalls) {
    const st = statuses?.get?.(s.id)?.status;
    if (st === "occupied") taken += 1;
    else if (st === "unknown") unknown += 1;
  }
  const total = stalls.length;
  const seen = total - unknown;
  return { total, taken, open: seen - taken, unknown, percent: seen ? Math.round((taken / seen) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Route over open pavement: a grid over the lot where every parking space is
// an obstacle, searched with A* (8 directions, turns cost extra so the route
// keeps to straight aisles), then straightened into a few segments.

function simplifyRDP(points, eps) {
  if (points.length < 3) return points;
  let worst = 0, index = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = projectOnSegment(points[i], a, b).distance;
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= eps) return [a, b];
  return [...simplifyRDP(points.slice(0, index + 1), eps).slice(0, -1), ...simplifyRDP(points.slice(index), eps)];
}

export function gridRoute(lot, from, to, { ignore = null, obstacle = null } = {}) {
  if (!from || !to) return [];
  const widths = lot.stalls.map((s) => dist(s.poly[0], s.poly[1])).filter(Number.isFinite).sort((x, y) => x - y);
  const stallW = widths.length ? widths[Math.floor(widths.length / 2)] : lot.bounds.w / 40;
  const cell = Math.max(stallW * 0.5, Math.max(lot.bounds.w, lot.bounds.h) / 220);
  const b = lot.bounds;
  const nx = Math.max(2, Math.ceil(b.w / cell)), ny = Math.max(2, Math.ceil(b.h / cell));
  const blocked = new Uint8Array(nx * ny);
  for (const s of lot.stalls) {
    if (ignore && s.id === ignore) continue;
    const xs = s.poly.map((p) => p.x), ys = s.poly.map((p) => p.y);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - b.x) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - b.x) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - b.y) / cell)), j1 = Math.min(ny - 1, Math.floor((Math.max(...ys) - b.y) / cell));
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
      if (pointInPolygon({ x: b.x + (i + 0.5) * cell, y: b.y + (j + 0.5) * cell }, s.poly)) blocked[j * nx + i] = 1;
    }
  }
  // Islands, kerbs and buildings (from the picture): not drivable.
  if (obstacle) {
    for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      if (!blocked[j * nx + i] && obstacle({ x: b.x + (i + 0.5) * cell, y: b.y + (j + 0.5) * cell })) blocked[j * nx + i] = 1;
    }
  }
  const toCell = (p) => [Math.max(0, Math.min(nx - 1, Math.floor((p.x - b.x) / cell))), Math.max(0, Math.min(ny - 1, Math.floor((p.y - b.y) / cell)))];
  // Nearest open cell to a point.
  const open = (p) => {
    const [ci, cj] = toCell(p);
    for (let r = 0; r < Math.max(nx, ny); r += 1) {
      let best = null, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j += 1) for (let i = ci - r; i <= ci + r; i += 1) {
        if (i < 0 || j < 0 || i >= nx || j >= ny || blocked[j * nx + i]) continue;
        const d = (i - ci) ** 2 + (j - cj) ** 2;
        if (d < bd) { bd = d; best = [i, j]; }
      }
      if (best) return best;
    }
    return null;
  };
  const s0 = open(from), g0 = open(to);
  if (!s0 || !g0) return [from, to];
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const N = nx * ny * 8;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const heap = [];
  const push = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const h = (i, j) => Math.hypot(i - g0[0], j - g0[1]);
  for (let d = 0; d < 8; d += 1) { const s = (s0[1] * nx + s0[0]) * 8 + d; gScore[s] = 0; push(h(s0[0], s0[1]), s); }
  let goal = -1;
  let guard = 0;
  while (heap.length && guard++ < 2e6) {
    const [, s] = pop();
    const c = s >> 3, d = s & 7, i = c % nx, j = (c - i) / nx;
    if (i === g0[0] && j === g0[1]) { goal = s; break; }
    for (let nd = 0; nd < 8; nd += 1) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || blocked[nj * nx + ni]) continue;
      // No cutting a corner between two blocked cells.
      if (DIRS[nd][0] && DIRS[nd][1] && (blocked[j * nx + ni] || blocked[nj * nx + i])) continue;
      const turn = nd === d ? 0 : Math.min((nd - d + 8) % 8, (d - nd + 8) % 8) * 0.6;
      // Diagonals cost a little extra: drivers follow straight aisles.
      const cost = gScore[s] + (DIRS[nd][0] && DIRS[nd][1] ? 2.6 : 1) + turn;
      const ns = (nj * nx + ni) * 8 + nd;
      if (cost < gScore[ns]) { gScore[ns] = cost; came[ns] = s; push(cost + h(ni, nj), ns); }
    }
  }
  if (goal < 0) return [from, to];
  const cells = [];
  for (let s = goal; s >= 0; s = came[s]) { const c = s >> 3; cells.unshift({ x: b.x + ((c % nx) + 0.5) * cell, y: b.y + (Math.floor(c / nx) + 0.5) * cell }); }
  return simplifyRDP([from, ...cells, to], cell * 0.9);
}
