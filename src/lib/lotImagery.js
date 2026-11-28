// The satellite image of a lot, fetched online from its outline on the map
// (no upload): imagery tiles covering the lot are stitched and cropped to it.
// The image's corners are known on the map (lat/lon), so it is placed on the
// 3D campus exactly.
//
// Source: Esri World Imagery (attribution required). Fine for trying
// SmartPark; commercial use needs an Esri (ArcGIS) key or another licensed
// imagery provider: change IMAGERY below.
export const IMAGERY = {
  url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  maxZoom: 19,
};

const TILE = 256;
const worldPx = (z) => TILE * 2 ** z;
export function toPixel(lat, lon, z) {
  const n = worldPx(z), r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}
export function toLatLon(x, y, z) {
  const n = worldPx(z);
  return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
}

/** Zoom and pixel box covering the outline (lat/lon) plus a margin (m), at most ~maxTiles tiles. */
export function imageryBox(outline, { marginM = 6, maxTiles = 64 } = {}) {
  const lats = outline.map((p) => p.lat), lons = outline.map((p) => p.lon);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / 111320, dLon = marginM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let z = IMAGERY.maxZoom; z >= 14; z -= 1) {
    const a = toPixel(Math.max(...lats) + dLat, Math.min(...lons) - dLon, z), b = toPixel(Math.min(...lats) - dLat, Math.max(...lons) + dLon, z);
    const tiles = (Math.floor(b.x / TILE) - Math.floor(a.x / TILE) + 1) * (Math.floor(b.y / TILE) - Math.floor(a.y / TILE) + 1);
    if (tiles <= maxTiles) return { z, x0: Math.floor(a.x), y0: Math.floor(a.y), x1: Math.ceil(b.x), y1: Math.ceil(b.y) };
  }
  return null;
}

/**
 * outline: [{ lat, lon }]. Returns { blob, geo: { minlat, maxlat, minlon, maxlon },
 * mask: outline in image % } (browser only: canvas).
 */
export async function fetchLotImage(outline, { signal } = {}) {
  const box = imageryBox(outline);
  if (!box) throw new Error("This lot is too big to fetch as one image.");
  const { z, x0, y0, x1, y1 } = box;
  const c = document.createElement("canvas");
  c.width = x1 - x0; c.height = y1 - y0;
  const ctx = c.getContext("2d");
  const jobs = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty += 1) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx += 1) {
      jobs.push((async () => {
        const res = await fetch(IMAGERY.url(z, tx, ty), { signal });
        if (!res.ok) throw new Error(`Imagery unavailable (${res.status})`);
        const bmp = await createImageBitmap(await res.blob());
        ctx.drawImage(bmp, tx * TILE - x0, ty * TILE - y0);
      })());
    }
  }
  await Promise.all(jobs);
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
  const nw = toLatLon(x0, y0, z), se = toLatLon(x1, y1, z);
  const mask = outline.map((p) => { const q = toPixel(p.lat, p.lon, z); return { x: ((q.x - x0) / c.width) * 100, y: ((q.y - y0) / c.height) * 100 }; });
  return { blob, geo: { minlat: se.lat, maxlat: nw.lat, minlon: nw.lon, maxlon: se.lon }, mask, zoom: z, size: [c.width, c.height] };
}
