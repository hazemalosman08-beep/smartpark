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

  // Buildings: large areas of built surface (roofs, walls). Cars and coloured
  // paint are built surface too, but far smaller; spaces are never buildings.
  const built = new Float64Array(gw * gh);
  for (let i = 0; i < gw * gh; i += 1) built[i] = share(SURFACE.BUILT, i);
  const buildings = shapes(built, gw, gh, 0.5, toLot)
    .filter((poly) => polygonArea(poly.outer) >= stallArea * 5)
    .filter((poly) => {
      const pts = poly.outer;
      const inside = pts.filter(inStall).length;
      return inside / pts.length < 0.3;
    });

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

  // Not drivable: islands and buildings.
  const blocked = new Uint8Array(gw * gh);
  const mark = (polys) => {
    for (const poly of polys) {
      const xs = poly.outer.map((p) => p.x), ys = poly.outer.map((p) => p.y);
      const g0 = [Math.floor(((Math.min(...xs) - rect.x) / rect.w) * gw), Math.floor(((Math.min(...ys) - rect.y) / rect.h) * gh)];
      const g1 = [Math.ceil(((Math.max(...xs) - rect.x) / rect.w) * gw), Math.ceil(((Math.max(...ys) - rect.y) / rect.h) * gh)];
      for (let gy = Math.max(0, g0[1]); gy < Math.min(gh, g1[1]); gy += 1) for (let gx = Math.max(0, g0[0]); gx < Math.min(gw, g1[0]); gx += 1) {
        const p = toLot([gx + 0.5, gy + 0.5]);
        if (pointInPolygon(p, poly.outer) && !poly.holes.some((h) => pointInPolygon(p, h))) blocked[gy * gw + gx] = 1;
      }
    }
  };
  mark(islands);
  mark(buildings);
  const obstacle = (p) => {
    const gx = Math.floor(((p.x - rect.x) / rect.w) * gw), gy = Math.floor(((p.y - rect.y) / rect.h) * gh);
    return gx >= 0 && gy >= 0 && gx < gw && gy < gh && blocked[gy * gw + gx] === 1 && !inStall(p);
  };

  return { islands, buildings, trees, obstacle, stallW, cellArea };
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
