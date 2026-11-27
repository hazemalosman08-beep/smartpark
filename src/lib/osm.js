// A real place from OpenStreetMap (© OpenStreetMap contributors, ODbL):
// buildings with heights, roads, paths, parking lots and garages, grass, trees
// and water, in local metres, ready to animate in 3D.
//
// The data is fetched in the browser from the public Overpass API
// (https://wiki.openstreetmap.org/wiki/Overpass_API): a place is found by name,
// then everything inside its area (plus a margin) is read.

export const OVERPASS = "https://overpass-api.de/api/interpreter";
export const ATTRIBUTION = "© OpenStreetMap contributors";

async function overpass(query, signal) {
  const res = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: query }), signal });
  if (!res.ok) throw new Error(`OpenStreetMap is busy (${res.status}). Try again in a minute.`);
  return res.json();
}

/** Places matching a name (campuses, hospitals, stadiums, malls, ...), with their bounds. */
export async function findPlaces(name, signal) {
  const safe = String(name).replace(/["\\]/g, "").trim();
  if (!safe) return [];
  const q = `[out:json][timeout:25];
(
  nwr["name"~"${safe}",i]["amenity"~"^(university|college|hospital|school)$"];
  nwr["name"~"${safe}",i]["leisure"~"^(stadium|sports_centre|park)$"];
  nwr["name"~"${safe}",i]["landuse"~"^(education|retail|commercial|institutional)$"];
  nwr["name"~"${safe}",i]["shop"="mall"];
);
out tags bb 20;`;
  const data = await overpass(q, signal);
  return (data.elements || [])
    .filter((e) => e.bounds)
    .map((e) => ({ id: `${e.type}/${e.id}`, name: e.tags?.name || "", kind: e.tags?.amenity || e.tags?.leisure || e.tags?.landuse || e.tags?.shop || "", bounds: e.bounds }))
    .sort((a, b) => area(b.bounds) - area(a.bounds));
}
const area = (b) => (b.maxlat - b.minlat) * (b.maxlon - b.minlon);

/** Everything needed for the 3D map inside the bounds (plus a margin, in metres). */
export async function fetchArea(bounds, { margin = 120, signal } = {}) {
  const dLat = margin / 111320, dLon = margin / (111320 * Math.cos(((bounds.minlat + bounds.maxlat) / 2) * Math.PI / 180));
  const bb = [bounds.minlat - dLat, bounds.minlon - dLon, bounds.maxlat + dLat, bounds.maxlon + dLon].map((v) => v.toFixed(6)).join(",");
  const q = `[out:json][timeout:90][bbox:${bb}];
(
  way["building"]; relation["building"]["type"="multipolygon"];
  way["building:part"];
  way["amenity"="parking"]; relation["amenity"="parking"]["type"="multipolygon"];
  way["amenity"="parking_space"];
  way["highway"];
  way["leisure"~"^(park|garden|pitch|playground|track|sports_centre|stadium)$"];
  way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|flowerbed)$"];
  way["natural"~"^(wood|scrub|grassland|water)$"]; way["water"]; way["waterway"];
  node["natural"="tree"];
  way["railway"~"^(rail|light_rail|tram|subway)$"];
);
out geom tags;`;
  const data = await overpass(q, signal);
  return { ...parseOsm(data, bounds), fetchedAt: new Date().toISOString(), bounds };
}

/**
 * Overpass JSON -> features in local metres (x east, y south, origin at the
 * centre of the bounds). Pure: tested without the network.
 */
export function parseOsm(data, bounds) {
  const lat0 = (bounds.minlat + bounds.maxlat) / 2, lon0 = (bounds.minlon + bounds.maxlon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const P = (g) => ({ x: Math.round((g.lon - lon0) * kx * 10) / 10, y: Math.round(-(g.lat - lat0) * ky * 10) / 10 });
  const out = { buildings: [], parking: [], roads: [], paths: [], green: [], water: [], trees: [], rails: [] };
  const ring = (geometry) => (geometry || []).filter(Boolean).map(P);
  const closed = (r) => r.length >= 4 && Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 0.5;
  const polygons = (e) => {
    if (e.type === "way") { const r = ring(e.geometry); return closed(r) ? [{ outer: r.slice(0, -1), holes: [] }] : []; }
    if (e.type === "relation") {
      const outers = joinRings((e.members || []).filter((m) => m.role !== "inner" && m.geometry).map((m) => ring(m.geometry)));
      const inners = joinRings((e.members || []).filter((m) => m.role === "inner" && m.geometry).map((m) => ring(m.geometry)));
      return outers.map((o) => ({ outer: o, holes: inners.filter((h) => inside(h[0], o)) }));
    }
    return [];
  };
  for (const e of data.elements || []) {
    const t = e.tags || {};
    if (e.type === "node" && t.natural === "tree") { out.trees.push(P(e)); continue; }
    if (t.building || t["building:part"]) {
      if (t.building === "roof" && !t.height) continue;
      const levels = parseFloat(t["building:levels"]);
      const h = parseFloat(String(t.height || "").replace(/[^\d.]/g, ""));
      const minH = parseFloat(String(t.min_height || "").replace(/[^\d.]/g, "")) || (parseFloat(t["building:min_level"]) * 3.2) || 0;
      const height = Number.isFinite(h) && h > 0 ? h : Number.isFinite(levels) && levels > 0 ? levels * 3.2 + 1 : null;
      const garage = t.building === "parking" || t.parking === "multi-storey";
      for (const poly of polygons(e)) out.buildings.push({ ...poly, height, estimated: height === null, minHeight: minH, name: t.name || "", garage, part: Boolean(t["building:part"]), id: `${e.type}/${e.id}` });
      if (!garage) continue;
    }
    if (t.amenity === "parking" || t.amenity === "parking_space") {
      for (const poly of polygons(e)) {
        out.parking.push({
          ...poly, id: `${e.type}/${e.id}`, name: t.name || t.ref || "", space: t.amenity === "parking_space",
          kind: t.parking || (t.building ? "multi-storey" : "surface"), capacity: parseInt(t.capacity, 10) || null,
          access: t.access || "", fee: t.fee || "", levels: parseFloat(t["building:levels"] || t.levels) || null,
        });
      }
      continue;
    }
    if (t.highway && e.type === "way") {
      const line = ring(e.geometry);
      if (line.length < 2) continue;
      if (/^(footway|path|pedestrian|steps|cycleway|corridor|track|bridleway)$/.test(t.highway) || t.area === "yes") out.paths.push({ line, kind: t.highway });
      else out.roads.push({ line, kind: t.highway, width: roadWidth(t), name: t.name || "", service: t.service || "" });
      continue;
    }
    if (t.railway && e.type === "way") { const line = ring(e.geometry); if (line.length >= 2) out.rails.push({ line, kind: t.railway }); continue; }
    if (t.natural === "water" || t.water || t.waterway) {
      if (e.type === "way" && t.waterway) { const line = ring(e.geometry); if (line.length >= 2) out.water.push({ line, width: 8 }); continue; }
      for (const poly of polygons(e)) out.water.push(poly);
      continue;
    }
    if (t.leisure || t.landuse || t.natural) {
      const kind = t.natural === "wood" || t.landuse === "forest" ? "wood" : t.leisure === "pitch" || t.leisure === "track" ? "pitch" : "grass";
      for (const poly of polygons(e)) out.green.push({ ...poly, kind });
    }
  }
  // Heights still unknown: the median of the known ones nearby, else 3 floors.
  const known = out.buildings.filter((b) => !b.estimated).map((b) => b.height).sort((a, b) => a - b);
  const typical = known.length >= 5 ? known[Math.floor(known.length / 2)] : 10.6;
  for (const b of out.buildings) if (b.height === null) b.height = b.garage ? 12 : typical;
  return out;
}

function roadWidth(t) {
  const lanes = parseInt(t.lanes, 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.min(30, lanes * 3.3);
  return { motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8.5, residential: 7, unclassified: 7, living_street: 6, service: 4.5 }[t.highway] || 5;
}

function inside(p, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

// Relation members are pieces of rings: join them end to end into closed rings.
function joinRings(pieces) {
  const rings = [];
  const rest = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
  while (rest.length) {
    let cur = rest.shift();
    let grew = true;
    while (!same(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < rest.length; i += 1) {
        const p = rest[i];
        const end = cur[cur.length - 1];
        if (same(end, p[0])) cur = [...cur, ...p.slice(1)];
        else if (same(end, p[p.length - 1])) cur = [...cur, ...[...p].reverse().slice(1)];
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur.slice(0, -1));
  }
  return rings;
}

/** Totals for the summary: parking lots, garages, known capacity. */
export function parkingSummary(osm) {
  const lots = osm.parking.filter((p) => !p.space);
  const garages = lots.filter((p) => /multi|underground|rooftop/.test(p.kind));
  const capacity = lots.reduce((s, p) => s + (p.capacity || 0), 0);
  return { lots: lots.length, garages: garages.length, surface: lots.length - garages.length, capacity, withCapacity: lots.filter((p) => p.capacity).length };
}
