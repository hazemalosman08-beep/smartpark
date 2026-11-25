// Geometry read from the picture (sceneStyle.classifyScene) for the 3D lot and
// for routing: planted islands/kerbs, building footprints and trees, all in lot
// coordinates. Only what the picture shows clearly is returned; small or
// uncertain patches are dropped rather than guessed.
import { contours } from "d3-contour";
import { SURFACE } from "./sceneStyle.js";
import { dist, pointInPolygon, polygonArea } from "./geometry.js";

/**
 * scene: { W, H, cls } (classes at picture resolution).
 * rect: where the picture lies in lot coordinates { x, y, w, h }.
 * stalls: lot stalls (lot coordinates).
 */
export function sceneFeatures(scene, rect, stalls = []) {
  if (!scene?.cls || !rect) return null;
  const widths = stalls.map((s) => dist(s.poly[0], s.poly[1])).filter((w) => w > 0).sort((a, b) => a - b);
  const stallW = widths.length ? widths[Math.floor(widths.length / 2)] : rect.w / 40;
  const stallArea = stallW * stallW * 2;
  // Working grid: about a third of a space wide, at most 320 cells across.
  const pxPerUnit = scene.W / rect.w;
  const f = Math.max(1, Math.min(Math.round((stallW * pxPerUnit) / 3), Math.ceil(scene.W / 120)), Math.ceil(scene.W / 320));
  const gw = Math.ceil(scene.W / f), gh = Math.ceil(scene.H / f);
  const counts = Array.from({ length: 7 }, () => new Uint16Array(gw * gh));
  for (let y = 0; y < scene.H; y += 1) for (let x = 0; x < scene.W; x += 1) {
    counts[scene.cls[y * scene.W + x]][Math.floor(y / f) * gw + Math.floor(x / f)] += 1;
  }
  const share = (k, i) => counts[k][i] / (f * f);
  const toLot = ([gx, gy]) => ({ x: rect.x + (gx * f * rect.w) / scene.W, y: rect.y + (gy * f * rect.h) / scene.H });
  const cellArea = ((f * rect.w) / scene.W) * ((f * rect.h) / scene.H);
  const inStall = (p) => stalls.some((s) => pointInPolygon(p, s.poly));

  // Planted ground: grass and soil (tree canopy is not ground: it hangs over
  // cars and lanes).
  const planted = new Float64Array(gw * gh);
  for (let i = 0; i < gw * gh; i += 1) planted[i] = share(SURFACE.GRASS, i) + share(SURFACE.EARTH, i) + 0.5 * share(SURFACE.TREE, i);
  const islands = shapes(planted, gw, gh, 0.5, toLot)
    .filter((poly) => polygonArea(poly.outer) >= stallArea * 0.35);

  // Buildings: large solid areas of built surface (roofs, brick, walls).
  // Seen from above a building is striped (pillars, windows, roof edges)
  // and mixed with soil-coloured brick, so built + soil cells are joined
  // into solid areas first. An area counts as a building only when it is
  // big (cars and painted symbols are far smaller), mostly built surface,
  // not planted (that is an island) and holds no mapped parking spaces.
  const solidity = Float64Array.from({ length: gw * gh }, (_, k) => share(SURFACE.BUILT, k) + share(SURFACE.EARTH, k));
  const raw = Uint8Array.from(solidity, (v) => (v >= 0.4 ? 1 : 0));
  const reach = Math.max(1, Math.round((stallW * gw) / rect.w / 2));
  const solid = erode(dilate(raw, gw, gh, reach), gw, gh, reach);
  const cellCentre = (k) => toLot([(k % gw) + 0.5, Math.floor(k / gw) + 0.5]);
  const stallCell = new Uint8Array(gw * gh);
  for (let k = 0; k < gw * gh; k += 1) if (solid[k] && inStall(cellCentre(k))) stallCell[k] = 1;
  const buildings = [];
  for (const cells of components(solid, gw, gh)) {
    if (cells.length * cellArea < stallArea * 6) continue;
    let built = 0, veg = 0, inSpaces = 0;
    for (const k of cells) {
      built += share(SURFACE.BUILT, k);
      veg += share(SURFACE.GRASS, k) + share(SURFACE.TREE, k);
      inSpaces += stallCell[k];
    }
    if (built / cells.length < 0.12 || veg / cells.length > 0.3 || inSpaces / cells.length > 0.15) continue;
    // Thick enough to be a building: kerbs, medians and planted strips are
    // narrow and vanish when shrunk by about one space width.
    const own = new Uint8Array(gw * gh);
    for (const k of cells) own[k] = 1;
    const core = erode(own, gw, gh, Math.max(1, Math.round(reach * 1.6)));
    let kept = 0;
    for (const k of cells) kept += core[k];
    if (kept / cells.length < 0.2) continue;
    const mask = new Float64Array(gw * gh);
    for (const k of cells) mask[k] = stallCell[k] ? 0 : 1;
    // Walls are straight: outlines are simplified and small gaps filled.
    buildings.push(...shapes(mask, gw, gh, 0.5, toLot)
      .filter((poly) => polygonArea(poly.outer) >= stallArea * 3)
      .map((poly) => ({ outer: straighten(poly.outer, stallW * 0.45), holes: [] }))
      .filter((poly) => poly.outer.length >= 3));
  }

  // Trees: canopy patches, one tree every ~1.6 space widths inside each.
  const trees = [];
  const spacing = stallW * 1.6;
  const canopy = shapes(Float64Array.from({ length: gw * gh }, (_, i) => share(SURFACE.TREE, i)), gw, gh, 0.5, toLot)
    .filter((poly) => polygonArea(poly.outer) >= stallArea * 0.25);
  for (const poly of canopy) {
    const xs = poly.outer.map((p) => p.x), ys = poly.outer.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const area = polygonArea(poly.outer);
    let placed = 0;
    for (let y = minY + spacing / 2; y < maxY; y += spacing) for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      if (trees.length >= 400) break;
      if (pointInPolygon({ x, y }, poly.outer)) { trees.push({ x, y, r: spacing * 0.55 }); placed += 1; }
    }
    if (!placed && trees.length < 400) {
      const c = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
      trees.push({ ...c, r: Math.max(stallW * 0.5, Math.sqrt(area / Math.PI)) });
    }
  }

  // ------------------------------------------------ pedestrian areas
  const { walkways, crossings } = pedestrianAreas(scene, { gw, gh, f, share, toLot, cellArea, stallW, stallArea, pxPerUnit, stalls, inStall, buildings, rect });

  // Surfaces: 1 planted island, 2 building, 3 walkway, 4 crossing (the last
  // drawn wins). Islands and buildings are not drivable.
  const blocked = new Uint8Array(gw * gh);
  const mark = (polys, value = 1) => {
    for (const poly of polys) {
      const xs = poly.outer.map((p) => p.x), ys = poly.outer.map((p) => p.y);
      const g0 = [Math.floor(((Math.min(...xs) - rect.x) / rect.w) * gw), Math.floor(((Math.min(...ys) - rect.y) / rect.h) * gh)];
      const g1 = [Math.ceil(((Math.max(...xs) - rect.x) / rect.w) * gw), Math.ceil(((Math.max(...ys) - rect.y) / rect.h) * gh)];
      for (let gy = Math.max(0, g0[1]); gy < Math.min(gh, g1[1]); gy += 1) for (let gx = Math.max(0, g0[0]); gx < Math.min(gw, g1[0]); gx += 1) {
        const p = toLot([gx + 0.5, gy + 0.5]);
        if (pointInPolygon(p, poly.outer) && !(poly.holes || []).some((h) => pointInPolygon(p, h))) blocked[gy * gw + gx] = value;
      }
    }
  };
  mark(islands, 1);
  mark(walkways, 3);
  mark(crossings, 4);
  mark(buildings, 2);
  const cellOf = (p) => {
    const gx = Math.floor(((p.x - rect.x) / rect.w) * gw), gy = Math.floor(((p.y - rect.y) / rect.h) * gh);
    return gx >= 0 && gy >= 0 && gx < gw && gy < gh ? gy * gw + gx : -1;
  };
  const SURF = [null, "planted", "building", "walkway", "crossing"];
  const surfaceAt = (p) => { const k = cellOf(p); return k < 0 ? null : SURF[blocked[k]]; };
  const obstacle = (p) => {
    const k = cellOf(p);
    // Raised walkways (kerbed) are not driven on either; crossings are.
    return k >= 0 && (blocked[k] === 1 || blocked[k] === 2 || (blocked[k] === 3 && walkways.raised)) && !inStall(p);
  };

  return { islands, buildings, trees, walkways, crossings, obstacle, surfaceAt, stallW, cellArea };
}

// Outlines of where `values` >= level, as { outer, holes } polygons in lot units.
function shapes(values, gw, gh, level, toLot) {
  const out = [];
  const [mp] = contours().size([gw, gh]).thresholds([level])(Array.from(values));
  const eps = dist(toLot([0, 0]), toLot([1, 0])) * 0.35;
  for (const polygon of mp?.coordinates || []) {
    const [outer, ...holes] = polygon.map((ring) => simplify(ring.map(toLot), eps));
    if (outer?.length >= 3) out.push({ outer, holes: holes.filter((h) => h.length >= 3) });
  }
  return out;
}

// Drop points that barely change the outline (keeps shapes light for 3D).
function simplify(ring, eps) {
  if (ring.length < 8) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i += 1) {
    const a = out[out.length - 1], b = ring[i], c = ring[i + 1];
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1e-9;
    const off = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
    if (off > eps) out.push(b);
  }
  return out;
}

function dilate(m, w, h, r) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

function erode(m, w, h, r) {
  const inv = Uint8Array.from(m, (v) => 1 - v);
  return Uint8Array.from(dilate(inv, w, h, r), (v) => 1 - v);
}

// Connected areas (4-neighbour) of a 0/1 grid, as lists of cell indexes.
function components(m, w, h) {
  const seen = new Uint8Array(m.length);
  const out = [];
  for (let s = 0; s < m.length; s += 1) {
    if (!m[s] || seen[s]) continue;
    const cells = [], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const x = k % w, y = (k - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (m[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    out.push(cells);
  }
  return out;
}

// Douglas-Peucker on a closed ring.
function straighten(ring, eps) {
  if (ring.length < 5) return ring;
  const rdp = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    let worst = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = Math.abs((pts[i].x - a.x) * (b.y - a.y) - (pts[i].y - a.y) * (b.x - a.x)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst <= eps) return [a, b];
    return [...rdp(pts.slice(0, at + 1)).slice(0, -1), ...rdp(pts.slice(at))];
  };
  // Split at the point farthest from the first one, so both halves are open.
  let far = 0, fd = 0;
  ring.forEach((p, i) => { const d = Math.hypot(p.x - ring[0].x, p.y - ring[0].y); if (d > fd) { fd = d; far = i; } });
  const first = rdp(ring.slice(0, far + 1)), second = rdp([...ring.slice(far), ring[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

// Pedestrian areas in the picture.
//  * Walkways and sidewalks: wide strips of surface clearly lighter than the
//    lot's own pavement (concrete next to asphalt), or light tan concrete.
//    Thin painted lines are not walkways (they vanish when the mask is opened).
//  * Crossings: zebra crossings and hatched walk zones, i.e.
//    parallel painted marks (four or more), close together, outside the
//    parking spaces.
function pedestrianAreas(scene, g) {
  const { gw, gh, f, toLot, stallW, stallArea, pxPerUnit, stalls, inStall, buildings } = g;
  const { W, H, cls } = scene;
  const lum = scene.lum;
  const out = { walkways: [], crossings: [] };
  if (!lum) return out;
  // The lot's pavement brightness: inside the mapped spaces.
  const inside = [];
  for (const st of stalls) {
    const c = st.poly.reduce((a, p) => ({ x: a.x + p.x / st.poly.length, y: a.y + p.y / st.poly.length }), { x: 0, y: 0 });
    for (const p of st.poly) {
      const q = { x: c.x + (p.x - c.x) * 0.5, y: c.y + (p.y - c.y) * 0.5 };
      const px = Math.round((q.x - g.rect.x) * pxPerUnit), py = Math.round((q.y - g.rect.y) * (H / g.rect.h));
      if (px >= 0 && py >= 0 && px < W && py < H && cls[py * W + px] === SURFACE.PAVE) inside.push(lum[py * W + px]);
    }
  }
  if (inside.length < 8) return out;
  inside.sort((a, b) => a - b);
  const base = inside[Math.floor(inside.length / 2)];
  const spread = Math.max(6, inside[Math.floor(inside.length * 0.85)] - base);

  // Walkways.
  const light = new Uint8Array(gw * gh);
  const cnt = new Uint16Array(gw * gh);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x, c = cls[i], L = lum[i];
    const concrete = (c === SURFACE.PAVE && L > base + spread + 10) || (c === SURFACE.EARTH && L > base + 5) || c === SURFACE.PAINT;
    if (concrete) cnt[Math.floor(y / f) * gw + Math.floor(x / f)] += 1;
  }
  for (let k = 0; k < gw * gh; k += 1) light[k] = cnt[k] / (f * f) >= 0.55 ? 1 : 0;
  // Opening: anything narrower than about a third of a space (painted lines) goes.
  const r = Math.max(1, Math.round((stallW * gw) / g.rect.w / 5));
  const opened = dilate(erode(light, gw, gh, r), gw, gh, r);
  const centre = (k) => toLot([(k % gw) + 0.5, Math.floor(k / gw) + 0.5]);
  for (const cells of components(opened, gw, gh)) {
    if (cells.length * g.cellArea < stallArea * 0.8) continue;
    let inSpaces = 0, inBuilding = 0;
    for (const k of cells) {
      const p = centre(k);
      if (inStall(p)) inSpaces += 1;
      else if (buildings.some((b) => pointInPolygon(p, b.outer))) inBuilding += 1;
    }
    if ((inSpaces + inBuilding) / cells.length > 0.3) continue;
    // A walkway is a straight strip: long compared with its width, and it
    // fills its own rectangle (stains and worn patches are ragged blobs).
    let mx = 0, my = 0;
    for (const k of cells) { mx += k % gw; my += Math.floor(k / gw); }
    mx /= cells.length; my /= cells.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const k of cells) { const dx = (k % gw) - mx, dy = Math.floor(k / gw) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const t = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(t), uy = Math.sin(t);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const k of cells) {
      const x = k % gw, y = Math.floor(k / gw);
      const a = x * ux + y * uy, b = -x * uy + y * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const len = a1 - a0 + 1, wid = b1 - b0 + 1;
    if (len < wid * 2.5 || cells.length / (len * wid) < 0.45) continue;
    const mask = new Float64Array(gw * gh);
    for (const k of cells) mask[k] = 1;
    out.walkways.push(...shapes(mask, gw, gh, 0.5, toLot).filter((poly) => polygonArea(poly.outer) >= stallArea * 0.5));
  }
  // A walkway between rows of spaces is a kerbed, raised strip.
  out.walkways.raised = true;

  // Crossings: painted marks grouped by direction and spacing.
  const stallPx = stallW * pxPerUnit;
  const label = new Int32Array(W * H).fill(-1);
  const marks = [];
  for (let s0 = 0; s0 < W * H; s0 += 1) {
    if (cls[s0] !== SURFACE.PAINT || label[s0] >= 0) continue;
    const stack = [s0], pix = [];
    label[s0] = marks.length;
    while (stack.length && pix.length < 4000) {
      const k = stack.pop();
      pix.push(k);
      const x = k % W, y = (k - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (cls[n] === SURFACE.PAINT && label[n] < 0) { label[n] = marks.length; stack.push(n); }
      }
    }
    if (pix.length < 5) { marks.push(null); continue; }
    // Orientation and size from second moments.
    let mx = 0, my = 0;
    for (const k of pix) { mx += k % W; my += Math.floor(k / W); }
    mx /= pix.length; my /= pix.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const k of pix) { const dx = (k % W) - mx, dy = Math.floor(k / W) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const l1 = (sxx + syy) / 2 / pix.length, d = Math.sqrt(((sxx - syy) / 2 / pix.length) ** 2 + (sxy / pix.length) ** 2);
    const length = Math.sqrt(12 * (l1 + d)), width = Math.sqrt(12 * Math.max(0, l1 - d));
    const lot = toLot([mx / f, my / f]);
    // Space dividers are long (a space deep); crossing bars and hatching are short.
    if (length > stallPx * 1.7 || length < stallPx * 0.35 || inStall(lot)) { marks.push(null); continue; }
    marks.push({ x: mx, y: my, angle, length, width, pix });
  }
  const real = marks.filter(Boolean);
  const parent = real.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < real.length; i += 1) for (let j = i + 1; j < real.length; j += 1) {
    const a = real[i], b = real[j];
    const dAng = Math.abs(((a.angle - b.angle + Math.PI * 1.5) % Math.PI) - Math.PI / 2);
    if (dAng > 0.2) continue;
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    if (gap > stallPx * 0.6 || gap < 1.5) continue;
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.5) continue;
    parent[find(i)] = find(j);
  }
  const groups = new Map();
  real.forEach((m, i) => { const r0 = find(i); if (!groups.has(r0)) groups.set(r0, []); groups.get(r0).push(m); });
  for (const group of groups.values()) {
    if (group.length < 4) continue;
    // The area they cover: the rectangle along the marks' direction.
    const t = group[0].angle, ux = Math.cos(t), uy = Math.sin(t);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const m of group) for (const k of m.pix) {
      const x = k % W, y = Math.floor(k / W);
      const a = x * ux + y * uy, b = -x * uy + y * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const corner = (a, b) => toLot([(a * ux - b * uy) / f, (a * uy + b * ux) / f]);
    out.crossings.push({ outer: [corner(a0, b0), corner(a1, b0), corner(a1, b1), corner(a0, b1)], holes: [], marks: group.length });
  }
  return out;
}
