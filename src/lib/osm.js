// A real place from OpenStreetMap (© OpenStreetMap contributors, ODbL):
// buildings with heights, roads, paths, parking lots and garages, grass, trees
// and water, in local metres, ready to animate in 3D.
//
// In the browser: places are suggested while typing (Photon, photon.komoot.io),
// then everything inside the chosen place (plus a margin) is read from the
// public Overpass API, with mirrors and openstreetmap.org as fall-backs.

export const ATTRIBUTION = "© OpenStreetMap contributors";

// Map data servers, tried in order (the public Overpass servers are often busy).
export const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
// Place search made for search-as-you-type, built on OpenStreetMap.
export const PHOTON = "https://photon.komoot.io/api/";
// OpenStreetMap's own server: the last resort for the map data.
export const OSM_API = "https://api.openstreetmap.org/api/0.6/map";

/**
 * Suggestions while typing, like a map app: [{ id, name, detail, kind,
 * bounds, centre }]. near: { lat, lon } to prefer results close to it.
 */
export async function searchPlaces(text, { signal, near = null, limit = 7, state = null, country = null } = {}) {
  const q = String(text || "").trim();
  if (q.length < 2) return [];
  const url = new URL(PHOTON);
  url.searchParams.set("q", q);
  // Within a country or state: search its area (or around its centre when
  // it has no usable box), ask for more (places in neighbours are dropped),
  // keep only places in it.
  const within = Boolean(state || country);
  url.searchParams.set("limit", String(within ? 40 : limit * 3));
  url.searchParams.set("lang", "en");
  const box = state?.bbox || country?.area?.bbox;
  const pad = state ? 0.3 : 0.5;
  if (box) {
    const [w, sth, e, n] = box;
    url.searchParams.set("bbox", [w - pad, sth - pad, e + pad, n + pad].map((v) => v.toFixed(2)).join(","));
  } else if (near && !within) { url.searchParams.set("lat", near.lat.toFixed(4)); url.searchParams.set("lon", near.lon.toFixed(4)); }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Place search is busy (${res.status}). Try again in a moment.`);
  let places = photonToPlaces(await res.json());
  if (country) places = places.filter((p) => p.countryCode === country.code);
  if (state) places = places.filter((p) => p.state === state.name);
  return rankPlaces(places, q).slice(0, limit);
}

/** Photon GeoJSON -> places (pure: tested without the network). */
export function photonToPlaces(geojson) {
  const seen = new Set();
  const out = [];
  for (const f of geojson?.features || []) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "";
    if (!name) continue;
    const id = `${p.osm_type || "?"}${p.osm_id || `${lat},${lon}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // Photon's extent is [west, north, east, south]; a point gets ~400 m around it.
    const e = p.extent;
    let bounds = e?.length === 4 ? { minlon: e[0], maxlat: e[1], maxlon: e[2], minlat: e[3] } : null;
    if (!bounds) {
      const d = 400 / 111320, dl = d / Math.cos((lat * Math.PI) / 180);
      bounds = { minlat: lat - d, maxlat: lat + d, minlon: lon - dl, maxlon: lon + dl };
    }
    const kind = String(p.osm_value || p.type || "").replace(/_/g, " ");
    const type = { N: "node", W: "way", R: "relation" }[p.osm_type];
    out.push({ id, name, detail: fullAddress(p), kind, bounds, centre: { lat, lon }, area: Boolean(e), osm: type && p.osm_id ? { type, id: p.osm_id } : null, state: p.state || "", country: p.country || "", countryCode: String(p.countrycode || "").toUpperCase() });
  }
  // Places with an outline (campuses, hospitals, buildings) before single
  // points (bus stops, bike stands); otherwise the search's own order.
  return out.map((p, i) => ({ p, i })).sort((a, b) => (b.p.area - a.p.area) || a.i - b.i).map((x) => x.p);
}

// Places SmartPark is for (a complex with parking) before the rest.
const CAMPUS_KIND = /^(university|college|hospital|clinic|school|stadium|sports centre|mall|place of worship|community centre|arts centre|theatre|townhall|library|museum|zoo|theme park|conference centre|exhibition centre|airport|aerodrome|parking)$/;

/**
 * Order suggestions: names that match what was typed, then complexes
 * (universities, hospitals, stadiums…), then places with an outline; the
 * search's own order otherwise. ("ohio state university" -> The Ohio State
 * University before the university's airport, a dam or a bus stop.)
 */
export function rankPlaces(places, text) {
  const norm = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim();
  const q = norm(text);
  const score = (p) => {
    const n = norm(p.name);
    const extra = n.startsWith(q) ? n.slice(q.length).trim() : null;
    return (n === q ? 4 : extra !== null && /^(main campus|campus)?$/.test(extra) ? 4 : extra !== null ? 1 : 0)
      + (CAMPUS_KIND.test(p.kind) ? 2 : 0) + (p.area ? 1 : 0);
  };
  return places.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

/**
 * The full address, like a map app: "2799 West Grand Boulevard, Detroit, MI
 * 48202, United States". Parts that are missing are left out; US states are
 * abbreviated.
 */
export function fullAddress(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const town = p.city || p.town || p.village || p.district || p.county || "";
  const state = p.country === "United States" && US_STATES[p.state] ? US_STATES[p.state] : p.state || "";
  const region = [state, p.postcode].filter(Boolean).join(" ");
  const parts = [street !== p.name ? street : "", town, region, p.country].filter(Boolean);
  return [...new Set(parts)].join(", ");
}

const US_STATES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
};

// Large places (a whole city) are cut to their middle: more would be too much
// to download and draw. About 3 x 3 km.
export const MAX_SPAN_M = 3000;
export const MIN_SPAN_M = 1500;
export function limitBounds(b, centre = null) {
  // The window's centre: the middle of the area, or for an area too big to
  // show, the place's own point (kept inside the area).
  let lat = (b.minlat + b.maxlat) / 2, lon = (b.minlon + b.maxlon) / 2;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
  // At least MIN_SPAN_M across, so a single building comes with its grounds
  // and the parking around it.
  const halfW = Math.max(MIN_SPAN_M, Math.min((b.maxlon - b.minlon) * kx, MAX_SPAN_M)) / 2 / kx;
  const halfH = Math.max(MIN_SPAN_M, Math.min((b.maxlat - b.minlat) * ky, MAX_SPAN_M)) / 2 / ky;
  const limited = halfW * 2 * kx < (b.maxlon - b.minlon) * kx - 1 || halfH * 2 * ky < (b.maxlat - b.minlat) * ky - 1;
  if (limited && centre && Number.isFinite(centre.lat)) {
    lat = Math.min(b.maxlat - halfH, Math.max(b.minlat + halfH, centre.lat));
    lon = Math.min(b.maxlon - halfW, Math.max(b.minlon + halfW, centre.lon));
  }
  return { bounds: { minlat: lat - halfH, maxlat: lat + halfH, minlon: lon - halfW, maxlon: lon + halfW }, limited };
}

/**
 * The bounds of the biggest piece of a place's outline (a university whose
 * outline also takes in a far-away airport and farms: the main campus).
 */
export function mainOutlineBounds(outline, bounds) {
  const parsed = parseOsm({ elements: [] }, bounds, { outline });
  const main = parsed.outline.map((p) => ({ p, a: Math.abs(polyArea(p.outer)) })).sort((x, y) => y.a - x.a)[0]?.p;
  if (!main) return null;
  const lat0 = (bounds.minlat + bounds.maxlat) / 2, lon0 = (bounds.minlon + bounds.maxlon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const xs = main.outer.map((q) => q.x), ys = main.outer.map((q) => q.y);
  return { minlon: lon0 + Math.min(...xs) / kx, maxlon: lon0 + Math.max(...xs) / kx, minlat: lat0 - Math.max(...ys) / ky, maxlat: lat0 - Math.min(...ys) / ky };
}

// Abort when the caller aborts or when we give up on this request.
function linked(signal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (signal?.aborted) ctl.abort(); else signal?.addEventListener("abort", stop, { once: true });
  return { signal: ctl.signal, abort: stop, done: () => signal?.removeEventListener("abort", stop) };
}

async function overpassOne(server, query, signal) {
  const res = await fetch(server, { method: "POST", body: new URLSearchParams({ data: query }), signal });
  if (!res.ok) throw new Error(`busy (${res.status})`);
  return res.json();
}

/**
 * Several sources tried in turn, each started after a short head start for
 * the one before (or at once if that one has failed), so one slow or hung
 * server never holds everything up. The first good answer wins and the rest
 * are cancelled. sources: [{ after: ms head start, run: (signal) => Promise }].
 */
export function race(sources, signal) {
  const own = linked(signal);
  return new Promise((resolve, reject) => {
    let failed = 0, started = 0, settled = false, timer = null;
    const errors = [];
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      own.abort();
      own.done();
      fn(v);
    };
    const startNext = () => {
      clearTimeout(timer);
      if (settled || started >= sources.length) return;
      const i = started++;
      if (started < sources.length) timer = setTimeout(startNext, sources[started].after ?? 0);
      Promise.resolve().then(() => sources[i].run(own.signal)).then((v) => finish(resolve, v), (err) => {
        errors[i] = err;
        failed += 1;
        if (signal?.aborted) return finish(reject, new DOMException("aborted", "AbortError"));
        if (failed === sources.length) return finish(reject, errors.find((e) => e?.message && e.name !== "AbortError") || new Error("map servers unavailable"));
        if (failed === started) startNext(); // everything running has failed: don't wait
      });
    };
    if (signal?.aborted) return finish(reject, new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => finish(reject, new DOMException("aborted", "AbortError")), { once: true });
    startNext();
  });
}

// ---- cache: an area downloaded once opens instantly afterwards ------------

const CACHE_DB = "smartpark-osm", CACHE_DAYS = 14;
const memory = new Map();

function cacheKey(box) {
  return [box.minlat, box.minlon, box.maxlat, box.maxlon].map((v) => v.toFixed(4)).join(",");
}

function openCache() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("areas");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function cacheGet(key) {
  if (memory.has(key)) return memory.get(key);
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("areas").objectStore("areas").get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && Date.now() - v.at < CACHE_DAYS * 864e5 ? v.data : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function cachePut(key, data) {
  memory.set(key, data);
  const db = await openCache();
  if (!db) return;
  try { db.transaction("areas", "readwrite").objectStore("areas").put({ at: Date.now(), data }, key); } catch { /* storage full or blocked: fine */ }
}

/** Everything needed for the 3D map inside the bounds (plus a margin, in metres). */
/** Map data (Overpass JSON elements) for a box; downloaded once, then cached. */
export async function fetchRaw(box, { signal, onStatus, fresh = false } = {}) {
  const key = cacheKey(box);
  let data = fresh ? null : await cacheGet(key);
  if (data) { onStatus?.("Opening the saved map…"); return data; }
  const bb = [box.minlat, box.minlon, box.maxlat, box.maxlon].map((v) => v.toFixed(6)).join(",");
  const q = `[out:json][timeout:25][bbox:${bb}];
(
  way["building"]; relation["building"]["type"="multipolygon"];
  way["building:part"];
  way["amenity"="parking"]; relation["amenity"="parking"]["type"="multipolygon"];
  way["amenity"="parking_space"];
  node["amenity"="parking"];
  way["highway"];
  way["leisure"~"^(park|garden|pitch|playground|track|sports_centre|stadium)$"];
  way["amenity"~"^(university|college|school|hospital|clinic|place_of_worship|community_centre|townhall|library|arts_centre|theatre)$"];
  relation["amenity"~"^(university|college|school|hospital)$"]["type"="multipolygon"];
  way["landuse"~"^(religious|education|institutional)$"];
  way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|flowerbed)$"];
  way["natural"~"^(wood|scrub|grassland|water)$"]; way["water"]; way["waterway"];
  node["natural"="tree"];
  node["name"]["amenity"]; node["name"]["building"]; node["name"]["office"]; node["name"]["healthcare"]; node["name"]["shop"]; node["name"]["tourism"];
  way["railway"~"^(rail|light_rail|tram|subway)$"];
);
out geom tags;`;
  onStatus?.("Downloading map data…");
  // The main Overpass server first; if it has not answered in a few
  // seconds a mirror joins, then OpenStreetMap's own server (in tiles).
  data = await race([
    { run: (s) => overpassOne(OVERPASS_SERVERS[0], q, s) },
    { after: 5000, run: (s) => overpassOne(OVERPASS_SERVERS[1], q, s) },
    { after: 3000, run: (s) => fetchFromOsmApi(box, { signal: s, onStatus }) },
    { after: 10000, run: (s) => overpassOne(OVERPASS_SERVERS[2], q, s) },
  ], signal);
  cachePut(key, data);
  return data;
}

const marginBox = (b, margin) => {
  const dLat = margin / 111320, dLon = margin / (111320 * Math.cos(((b.minlat + b.maxlat) / 2) * Math.PI / 180));
  return { minlat: b.minlat - dLat, minlon: b.minlon - dLon, maxlat: b.maxlat + dLat, maxlon: b.maxlon + dLon };
};

/** Everything needed for the 3D map inside the bounds (plus a margin, in metres). */
export async function fetchArea(bounds, { margin = 300, signal, onStatus, fresh = false, outlineOf = null } = {}) {
  const outlineP = outlineOf ? fetchOutline(outlineOf, { signal, fresh }).catch(() => null) : Promise.resolve(null);
  const box = marginBox(bounds, margin);
  const data = await fetchRaw(box, { signal, onStatus, fresh });
  const outline = await outlineP;
  onStatus?.("Building the 3D map…");
  return { ...parseOsm(data, bounds, { outline }), fetchedAt: new Date().toISOString(), bounds, margin, loaded: [box] };
}

/**
 * More of a big place: the box's data, in the same local metres as the map
 * already loaded, merged in (each feature once). Buildings and lots are in
 * the complex when they are inside its outline.
 */
export async function fetchMore(osm, box, { signal } = {}) {
  const data = await fetchRaw(box, { signal });
  return mergeOsm(osm, parseOsm(data, osm.bounds), box);
}

export function mergeOsm(base, extra, box) {
  const out = { ...base, loaded: [...(base.loaded || []), box] };
  const inOutline = (pt) => !base.outline?.length || base.outline.some((o) => inside(pt, o.outer) && !o.holes.some((h) => inside(pt, h)));
  for (const k of ["buildings", "parking", "roads", "paths", "green", "water", "trees", "rails"]) {
    const seen = new Set((base[k] || []).map((f) => f.id));
    const add = (extra[k] || []).filter((f) => !f.id || !seen.has(f.id));
    if (k === "buildings" || k === "parking") for (const f of add) f.inComplex = inOutline(interiorPoint(f.outer));
    out[k] = [...(base[k] || []), ...add];
  }
  return out;
}

// ---- tiles: more of a big place is loaded in small squares ----------------
// A fixed grid (about 0.9 x 0.85 km at 40°N): each square is downloaded
// once (and cached), the ones in view first.
export const TILE_LAT = 0.008, TILE_LON = 0.01;

export function tileBox(id) {
  const [i, j] = id.split(",").map(Number);
  return { minlat: i * TILE_LAT, maxlat: (i + 1) * TILE_LAT, minlon: j * TILE_LON, maxlon: (j + 1) * TILE_LON };
}

const overlaps = (a, b) => a.minlat < b.maxlat && b.minlat < a.maxlat && a.minlon < b.maxlon && b.minlon < a.maxlon;
const covers = (a, b) => a.minlat <= b.minlat && a.maxlat >= b.maxlat && a.minlon <= b.minlon && a.maxlon >= b.maxlon;

/**
 * Tiles within `radiusM` of a point and inside the place (`full`), that are
 * not loaded yet (not in `done`, not inside a loaded box), nearest first.
 */
export function tilesToLoad(at, radiusM, full, loaded = [], done = new Set()) {
  const dLat = radiusM / 111320, dLon = radiusM / (111320 * Math.cos((at.lat * Math.PI) / 180));
  const i0 = Math.floor((at.lat - dLat) / TILE_LAT), i1 = Math.floor((at.lat + dLat) / TILE_LAT);
  const j0 = Math.floor((at.lon - dLon) / TILE_LON), j1 = Math.floor((at.lon + dLon) / TILE_LON);
  const out = [];
  for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) {
    const id = `${i},${j}`;
    const box = tileBox(id);
    if (done.has(id) || (full && !overlaps(box, full)) || loaded.some((l) => covers(l, box))) continue;
    const c = { lat: (box.minlat + box.maxlat) / 2, lon: (box.minlon + box.maxlon) / 2 };
    out.push({ id, box, d: Math.hypot((c.lat - at.lat) / dLat, (c.lon - at.lon) / dLon) });
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Lat/lon box -> local metres of a map loaded for `bounds` (x east, y south). */
export function toLocalBox(bounds, b) {
  const lat0 = (bounds.minlat + bounds.maxlat) / 2, lon0 = (bounds.minlon + bounds.maxlon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return { minX: (b.minlon - lon0) * kx, maxX: (b.maxlon - lon0) * kx, minY: -(b.maxlat - lat0) * ky, maxY: -(b.minlat - lat0) * ky };
}

/** Local metres -> lat/lon (inverse of the projection in parseOsm). */
export function toLatLon(bounds, x, y) {
  const lat0 = (bounds.minlat + bounds.maxlat) / 2, lon0 = (bounds.minlon + bounds.maxlon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return { lat: lat0 - y / ky, lon: lon0 + x / kx };
}

/**
 * The place's own outline (a campus or hospital area, as drawn on
 * OpenStreetMap), as an Overpass-style element, or null for a point.
 */
export async function fetchOutline({ type, id }, { signal, fresh = false } = {}) {
  if (type !== "way" && type !== "relation") return null;
  const key = `outline:${type}/${id}`;
  const hit = fresh ? null : await cacheGet(key);
  if (hit) return hit;
  const res = await fetch(`${OSM_API.replace(/\/map$/, "")}/${type}/${id}/full`, { signal });
  if (!res.ok) return null;
  const nodes = new Map(), ways = new Map(), rels = new Map();
  osmXmlInto(await res.text(), nodes, ways, rels);
  const target = (type === "way" ? ways : rels).get(String(id));
  if (!target) return null;
  if (type === "relation") target.tags = { ...target.tags, type: "multipolygon" }; // boundary, site, …: outer ways all the same
  const one = new Map([[String(id), target]]);
  const el = osmToElements(nodes, type === "way" ? one : ways, type === "way" ? new Map() : one).elements.find((e) => e.type === type && e.id === +id);
  if (!el) return null;
  cachePut(key, el);
  return el;
}

/**
 * The same data from api.openstreetmap.org (OSM XML, at most 50 000 nodes per
 * call): the area is read in tiles, several at a time, and joined. A tile the
 * server refuses as too big is split in four.
 */
export async function fetchFromOsmApi(box, { signal, onStatus, tile = 0.008, parallel = 4 } = {}) {
  const nodes = new Map(), ways = new Map(), rels = new Map();
  const rows = Math.max(1, Math.ceil((box.maxlat - box.minlat) / tile));
  const cols = Math.max(1, Math.ceil((box.maxlon - box.minlon) / (tile * 1.33)));
  const queue = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    queue.push([
      box.minlon + ((box.maxlon - box.minlon) * c) / cols, box.minlat + ((box.maxlat - box.minlat) * r) / rows,
      box.minlon + ((box.maxlon - box.minlon) * (c + 1)) / cols, box.minlat + ((box.maxlat - box.minlat) * (r + 1)) / rows,
    ]);
  }
  let total = queue.length, done = 0;
  const worker = async () => {
    while (queue.length) {
      const [lo0, la0, lo1, la1] = queue.shift();
      const res = await fetch(`${OSM_API}?bbox=${lo0.toFixed(6)},${la0.toFixed(6)},${lo1.toFixed(6)},${la1.toFixed(6)}`, { signal });
      if (res.status === 400 && lo1 - lo0 > 0.001) {
        const mx = (lo0 + lo1) / 2, my = (la0 + la1) / 2;
        queue.push([lo0, la0, mx, my], [mx, la0, lo1, my], [lo0, my, mx, la1], [mx, my, lo1, la1]);
        total += 3;
        continue;
      }
      if (!res.ok) throw new Error(`OpenStreetMap is busy (${res.status}). Try again in a minute.`);
      osmXmlInto(await res.text(), nodes, ways, rels);
      done += 1;
      onStatus?.(`Downloading map data… ${Math.round((done / total) * 100)}%`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
  return osmToElements(nodes, ways, rels);
}

/** OSM XML -> collections (browser: DOMParser). */
export function osmXmlInto(xml, nodes, ways, rels) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const tags = (el) => Object.fromEntries([...el.getElementsByTagName("tag")].map((t) => [t.getAttribute("k"), t.getAttribute("v")]));
  for (const nd of doc.getElementsByTagName("node")) nodes.set(nd.getAttribute("id"), { lat: +nd.getAttribute("lat"), lon: +nd.getAttribute("lon"), tags: tags(nd) });
  for (const w of doc.getElementsByTagName("way")) ways.set(w.getAttribute("id"), { refs: [...w.getElementsByTagName("nd")].map((x) => x.getAttribute("ref")), tags: tags(w) });
  for (const r of doc.getElementsByTagName("relation")) rels.set(r.getAttribute("id"), { members: [...r.getElementsByTagName("member")].map((m) => ({ type: m.getAttribute("type"), ref: m.getAttribute("ref"), role: m.getAttribute("role") })), tags: tags(r) });
}

/** Collections -> Overpass-style elements with geometry (as parseOsm reads). */
export function osmToElements(nodes, ways, rels) {
  const geom = (refs) => refs.map((r) => nodes.get(r)).filter(Boolean).map((n) => ({ lat: n.lat, lon: n.lon }));
  const elements = [];
  for (const [id, n] of nodes) if (n.tags?.natural === "tree" || n.tags?.amenity === "parking" || isNamedPoint(n.tags)) elements.push({ type: "node", id: +id, lat: n.lat, lon: n.lon, tags: n.tags });
  for (const [id, w] of ways) if (Object.keys(w.tags).length) elements.push({ type: "way", id: +id, tags: w.tags, geometry: geom(w.refs) });
  for (const [id, r] of rels) {
    if (r.tags.type !== "multipolygon" && r.tags.type !== "boundary") continue;
    const members = r.members.filter((m) => m.type === "way" && ways.has(m.ref)).map((m) => ({ type: "way", role: m.role, geometry: geom(ways.get(m.ref).refs) }));
    elements.push({ type: "relation", id: +id, tags: r.tags, members });
  }
  return { elements };
}

/**
 * Overpass JSON -> features in local metres (x east, y south, origin at the
 * centre of the bounds). Pure: tested without the network.
 */
export function parseOsm(data, bounds, { outline = null } = {}) {
  const lat0 = (bounds.minlat + bounds.maxlat) / 2, lon0 = (bounds.minlon + bounds.maxlon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const P = (g) => ({ x: Math.round((g.lon - lon0) * kx * 10) / 10, y: Math.round(-(g.lat - lat0) * ky * 10) / 10 });
  const out = { buildings: [], parking: [], roads: [], paths: [], green: [], water: [], trees: [], rails: [], outline: [] };
  const points = [];
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
  const sites = [];
  for (const e of data.elements || []) {
    const t = e.tags || {};
    // Areas a place stands on (a mosque's grounds, a hospital's site).
    if (e.type !== "node" && !t.building && (SITE_AMENITY.test(t.amenity || "") || SITE_LANDUSE.test(t.landuse || "") || t.leisure === "stadium")) {
      for (const poly of polygons(e)) sites.push({ ...poly, name: t.name || "", area: Math.abs(polyArea(poly.outer)) });
    }
    const fid = `${e.type}/${e.id}`;
    if (e.type === "node" && t.natural === "tree") { out.trees.push({ ...P(e), id: fid }); continue; }
    if (e.type === "node" && t.amenity === "parking") {
      // Parking mapped as a single point: a square of about its size
      // (capacity x 25 m², else ~20 spaces) around it, marked approximate.
      const c = P(e);
      const half = Math.min(40, Math.max(10, Math.sqrt((parseInt(t.capacity, 10) || 20) * 25) / 2));
      out.parking.push({
        outer: [{ x: c.x - half, y: c.y - half }, { x: c.x + half, y: c.y - half }, { x: c.x + half, y: c.y + half }, { x: c.x - half, y: c.y + half }], holes: [],
        id: `node/${e.id}`, name: t.name || t.ref || "", space: false, point: true,
        kind: t.parking || "surface", capacity: parseInt(t.capacity, 10) || null,
        access: t.access || "", fee: t.fee || "", levels: parseFloat(t["building:levels"] || t.levels) || null,
      });
      continue;
    }
    if (e.type === "node") { if (isNamedPoint(t)) points.push({ ...P(e), name: t.name }); continue; }
    if (t.building || t["building:part"]) {
      if (t.building === "roof" && !t.height) continue;
      const levels = parseFloat(t["building:levels"]);
      const h = parseFloat(String(t.height || "").replace(/[^\d.]/g, ""));
      const minH = parseFloat(String(t.min_height || "").replace(/[^\d.]/g, "")) || (parseFloat(t["building:min_level"]) * 3.2) || 0;
      const height = Number.isFinite(h) && h > 0 ? h : Number.isFinite(levels) && levels > 0 ? levels * 3.2 + 1 : null;
      const garage = t.building === "parking" || t.parking === "multi-storey";
      const name = t.name || t.official_name || t.alt_name || t.short_name || t["addr:housename"] || "";
      for (const poly of polygons(e)) out.buildings.push({ ...poly, height, estimated: height === null, minHeight: minH, name, nameFrom: name ? "name" : "", address: streetAddress(t), type: t.building || "part", garage, part: Boolean(t["building:part"]), id: `${e.type}/${e.id}` });
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
      if (/^(footway|path|pedestrian|steps|cycleway|corridor|track|bridleway)$/.test(t.highway) || t.area === "yes") out.paths.push({ line, kind: t.highway, id: fid });
      else out.roads.push({ line, kind: t.highway, width: roadWidth(t), name: t.name || "", service: t.service || "", id: fid });
      continue;
    }
    if (t.railway && e.type === "way") { const line = ring(e.geometry); if (line.length >= 2) out.rails.push({ line, kind: t.railway, id: fid }); continue; }
    if (t.natural === "water" || t.water || t.waterway) {
      if (e.type === "way" && t.waterway) { const line = ring(e.geometry); if (line.length >= 2) out.water.push({ line, width: 8, id: fid }); continue; }
      polygons(e).forEach((poly, i) => out.water.push({ ...poly, id: `${fid}#${i}` }));
      continue;
    }
    if (GREEN_LEISURE.test(t.leisure || "") || GREEN_LANDUSE.test(t.landuse || "") || GREEN_NATURAL.test(t.natural || "")) {
      const kind = t.natural === "wood" || t.landuse === "forest" ? "wood" : t.leisure === "pitch" || t.leisure === "track" ? "pitch" : "grass";
      polygons(e).forEach((poly, i) => out.green.push({ ...poly, kind, id: `${fid}#${i}` }));
    }
  }
  // The complex's own outline: buildings inside it belong to the complex,
  // the rest is the neighbourhood around it. No outline: everything counts.
  let polys = outline ? polygons(outline).filter((p) => p.outer.length >= 3) : [];
  // A single building (or a point) as the place: its site is the smallest
  // mapped site area around it (a mosque's grounds with their parking).
  if (!polys.length || outline?.tags?.building) {
    const ref = polys.length ? interiorPoint(polys[0].outer) : { x: 0, y: 0 };
    const own = polys.length ? Math.abs(polyArea(polys[0].outer)) : 0;
    const site = sites.filter((st) => st.area > own * 1.5 && st.area < 9e6 && inside(ref, st.outer)).sort((a, b) => a.area - b.area)[0];
    if (site) polys = [{ outer: site.outer, holes: site.holes }];
  }
  out.outline = polys;
  const inOutline = (pt) => out.outline.some((o) => inside(pt, o.outer) && !o.holes.some((h) => inside(pt, h)));
  const outlineId = outline ? `${outline.type}/${outline.id}` : "";
  for (const b of out.buildings) b.inComplex = !out.outline.length || b.id === outlineId || inOutline(interiorPoint(b.outer));
  for (const p of out.parking) p.inComplex = !out.outline.length || inOutline(interiorPoint(p.outer));
  // Unnamed buildings: a named place inside them (a shop, an office, a
  // department mapped as a point) names them.
  for (const pt of points) {
    const b = out.buildings.find((x) => !x.name && !x.part && inside(pt, x.outer));
    if (b) { b.name = pt.name; b.nameFrom = "place"; }
  }
  // Heights still unknown: the median of the known ones nearby, else 3 floors.
  const known = out.buildings.filter((b) => !b.estimated).map((b) => b.height).sort((a, b) => a - b);
  const typical = known.length >= 5 ? known[Math.floor(known.length / 2)] : 10.6;
  for (const b of out.buildings) if (b.height === null) b.height = b.garage ? 12 : typical;
  return out;
}

const SITE_AMENITY = /^(university|college|school|hospital|clinic|place_of_worship|community_centre|townhall|library|arts_centre|theatre)$/;
const SITE_LANDUSE = /^(religious|education|institutional)$/;
const GREEN_LEISURE = /^(park|garden|pitch|playground|track|sports_centre|stadium|golf_course|common|dog_park)$/;
const GREEN_LANDUSE = /^(grass|meadow|forest|recreation_ground|village_green|flowerbed|cemetery)$/;
const GREEN_NATURAL = /^(wood|scrub|grassland|heath)$/;

/**
 * A point inside a polygon (the centre of a U- or L-shaped building can be
 * outside it): the area centroid if inside, else the middle of the widest
 * stretch of the polygon along the centroid's row.
 */
export function interiorPoint(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  const c = Math.abs(a) > 1e-9 ? { x: cx / (3 * a), y: cy / (3 * a) } : centre(poly);
  if (inside(c, poly)) return c;
  const xs = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if ((p.y > c.y) !== (q.y > c.y)) xs.push(p.x + ((c.y - p.y) * (q.x - p.x)) / (q.y - p.y));
  }
  xs.sort((u, v) => u - v);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? { x: (best[0] + best[1]) / 2, y: c.y } : c;
}

// Points worth naming a building after.
function isNamedPoint(t) {
  return Boolean(t?.name && (t.amenity || t.building || t.office || t.healthcare || t.shop || t.tourism) && t.amenity !== "parking" && t.amenity !== "bicycle_parking");
}

function streetAddress(t) {
  return [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
}

function centre(poly) {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

// Structures nobody walks to: not counted as buildings or offered as destinations.
const MINOR = /^(shed|garage|garages|carport|roof|hut|kiosk|cabin|container|transformer_tower|toilets|service|bunker|tent|ruins|construction)$/;

/** Buildings of the complex (inside its outline) and the ones around it. */
export function buildingCounts(osm) {
  const real = osm.buildings.filter((b) => !b.part && !b.garage && !MINOR.test(b.type || ""));
  const mine = real.filter((b) => b.inComplex !== false);
  return {
    complex: mine.length,
    named: mine.filter((b) => b.name).length,
    around: real.length - mine.length,
    hasOutline: Boolean(osm.outline?.length),
  };
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
  return { onSite: lots.filter((p) => p.inComplex !== false).length, lots: lots.length, garages: garages.length, surface: lots.length - garages.length, capacity, withCapacity: lots.filter((p) => p.capacity).length };
}

// ---------------------------------------------------------------------------
// "Where are you going?": named buildings, and the parking closest to one.

/**
 * Buildings people can go to, A-Z: named ones, and unnamed ones with a
 * street address (listed by the address). Parts, garages and sheds are left
 * out; the complex's own buildings come first in searches.
 */
export function destinations(osm) {
  const seen = new Map();
  for (const b of osm.buildings) {
    if (b.part || b.garage || MINOR.test(b.type || "")) continue;
    const label = b.name || b.address;
    if (!label) continue;
    const key = label.trim().toLowerCase();
    const area = Math.abs(polyArea(b.outer));
    const prev = seen.get(key);
    if (!prev || (b.inComplex !== false) > (prev.inComplex !== false) || ((b.inComplex !== false) === (prev.inComplex !== false) && prev.area < area)) {
      seen.set(key, { ...b, name: label, byAddress: !b.name, area });
    }
  }
  return [...seen.values()].sort((a, b) => (a.byAddress - b.byAddress) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Search destinations by words in any order ("eng bldg" finds "Engineering Building"). */
export function searchDestinations(list, text, max = 8) {
  const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return list
    .map((d) => { const n = d.name.toLowerCase(), all = `${n} ${(d.address || "").toLowerCase()}`; return { d, ok: words.every((w) => all.includes(w)), starts: n.startsWith(words[0]) }; })
    .filter((x) => x.ok)
    .sort((a, b) => ((b.d.inComplex !== false) - (a.d.inComplex !== false)) || (a.d.byAddress - b.d.byAddress) || (b.starts - a.starts) || a.d.name.length - b.d.name.length)
    .slice(0, max)
    .map((x) => x.d);
}

const WALK_SPEED = 1.3; // m/s
// Streets are a grid: people walk around blocks, not in straight lines.
const DETOUR = 1.3;

/**
 * Parking closest to a building: distance between the outlines (edge to
 * edge), walking estimate, and the two closest points (for drawing the walk).
 * Lots the driver may not use come after the others; spaces mapped one by
 * one are left out.
 */
export function nearestParking(osm, building, n = 5, { permit = true } = {}) {
  const lots = osm.parking.filter((p) => !p.space && p.outer?.length >= 3);
  return lots
    .map((lot) => {
      const { d, a, b } = polygonGap(lot.outer, building.outer);
      const walkMeters = Math.round(d * DETOUR);
      const access = lot.access || "";
      const priv = /^(private|no)$/.test(access);
      const permitOnly = /permit/.test(access);
      const customers = /customers|destination|visitors/.test(access);
      // Who may park here. Visitor lots are for people going to the place,
      // which is exactly who asks. Permit lots need a permit; private lots
      // on the site are its staff/student lots, so a permit opens them too.
      const allowed = priv ? permit && lot.inComplex !== false && building.inComplex !== false : permitOnly ? permit : true;
      return { lot, distance: Math.round(d), walkMeters, walkMinutes: Math.max(1, Math.round(walkMeters / WALK_SPEED / 60)), from: a, to: b, private: priv, permitOnly, customers, allowed, tier: allowed ? 0 : priv ? 2 : 1 };
    })
    // The closest lot the driver may use; the others after it.
    .sort((x, y) => x.tier - y.tier || x.distance - y.distance)
    .slice(0, n);
}

function polyArea(p) {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i, i += 1) s += p[j].x * p[i].y - p[i].x * p[j].y;
  return s / 2;
}

// Smallest distance between two polygons (0 if they touch or overlap), and
// the closest pair of points.
function polygonGap(A, B) {
  if (A.some((p) => inside(p, B)) || B.some((p) => inside(p, A))) {
    const c = A.find((p) => inside(p, B)) || B.find((p) => inside(p, A));
    return { d: 0, a: c, b: c };
  }
  let best = { d: Infinity, a: A[0], b: B[0] };
  const scan = (P, Q, swap) => {
    for (const p of P) for (let i = 0; i < Q.length; i += 1) {
      const q0 = Q[i], q1 = Q[(i + 1) % Q.length];
      const dx = q1.x - q0.x, dy = q1.y - q0.y, L = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - q0.x) * dx + (p.y - q0.y) * dy) / L));
      const c = { x: q0.x + dx * t, y: q0.y + dy * t };
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < best.d) best = swap ? { d, a: c, b: p } : { d, a: p, b: c };
    }
  };
  scan(A, B, false);
  scan(B, A, true);
  return best;
}
