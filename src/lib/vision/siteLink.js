// One site map, seen by cameras.
//
// The site map is a top-down picture of the lot (aerial / satellite / drone):
// its spaces are mapped once, in site-picture percent. A camera is linked to
// it with 4+ matching points (camera % <-> site %), which gives a homography
// for the ground. Through it:
//   * the site's spaces are projected into the camera's view, so the camera
//     pipeline (detection, occupancy, overlay) works as for a single camera;
//   * what the camera reports (cars, occupancy, edits) lands on the site map.
import { applyHomography, invertHomography } from "./geometry.js";

/** Least-squares homography from >= 4 pairs [{ from:{x,y}, to:{x,y} }] (normalised DLT). */
export function fitHomography(pairs) {
  if (!pairs || pairs.length < 4) return null;
  const norm = (pts) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], apply: (p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }) };
  };
  const ns = norm(pairs.map((p) => p.from)), nd = norm(pairs.map((p) => p.to));
  // Normal equations for h0..h7 (h8 = 1).
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row, b) => {
    for (let i = 0; i < 8; i += 1) {
      Atb[i] += row[i] * b;
      for (let j = 0; j < 8; j += 1) AtA[i][j] += row[i] * row[j];
    }
  };
  for (const pr of pairs) {
    const { x, y } = ns.apply(pr.from), { x: u, y: v } = nd.apply(pr.to);
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  // H = Td^-1 * Hn * Ts
  const H = mul(mul(invertHomography(nd.T), Hn), ns.T);
  return H.map((v) => v / H[8]);
}

function mul(A, B) {
  const C = new Array(9).fill(0);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) for (let k = 0; k < 3; k += 1) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Mean distance (site %) between where the link puts each camera point and where it was clicked. */
export function linkError(H, pairs) {
  if (!H || !pairs?.length) return Infinity;
  return pairs.reduce((s, p) => { const q = applyHomography(H, p.from); return s + Math.hypot(q.x - p.to.x, q.y - p.to.y); }, 0) / pairs.length;
}

/** A link from its pairs: { pairs, H (camera % -> site %), error }. */
export function makeLink(pairs, extra = {}) {
  const H = fitHomography(pairs);
  return H ? { ...extra, pairs, H, error: Math.round(linkError(H, pairs) * 100) / 100 } : null;
}

// Site % -> camera %, or null when the point is behind the camera / off the plane.
function toCameraPoint(Hinv, sign, p) {
  const w = Hinv[6] * p.x + Hinv[7] * p.y + Hinv[8];
  if (Math.sign(w) !== sign || Math.abs(w) < 1e-9) return null;
  return { x: (Hinv[0] * p.x + Hinv[1] * p.y + Hinv[2]) / w, y: (Hinv[3] * p.x + Hinv[4] * p.y + Hinv[5]) / w };
}

const round = (p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
const inFrame = (p, m = 0) => p.x >= -m && p.y >= -m && p.x <= 100 + m && p.y <= 100 + m;

/**
 * The site map as this camera sees it: a calibration in camera % that the
 * camera pipeline can use as is. Only spaces the camera sees are included
 * (centre in the picture, all corners in front of the camera); ids are the
 * site's, so occupancy reported for them is occupancy of the site's spaces.
 */
export function cameraView(site, link) {
  const base = {
    ...site, stalls: [], lanes: [], footprints: [], ground: null, entrance: null, exit: null, building: null, buildings: [],
    aspect: link?.cameraAspect || 16 / 9, view: link?.view || "angled", site: undefined, sample: false,
  };
  if (!link?.H) return base;
  const Hinv = invertHomography(link.H);
  if (!Hinv) return base;
  // Which side of the plane the camera's own points are on.
  const s0 = link.pairs?.[0]?.to;
  const sign = s0 ? Math.sign(Hinv[6] * s0.x + Hinv[7] * s0.y + Hinv[8]) : 1;
  const pt = (p) => (p ? toCameraPoint(Hinv, sign, p) : null);
  const stalls = [];
  for (const st of site.stalls || []) {
    const poly = st.poly.map(pt);
    if (poly.some((p) => !p)) continue;
    const c = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, y: poly.reduce((a, p) => a + p.y, 0) / poly.length };
    if (!inFrame(c) || !poly.every((p) => inFrame(p, 60))) continue;
    stalls.push({ ...st, poly: poly.map(round) });
  }
  const point = (p) => { const q = pt(p); return q && inFrame(q) ? { ...p, ...round(q) } : null; };
  const view = link.viewManual ? link.view : cameraTilt(site, link, stalls);
  return { ...base, view, stalls, entrance: point(site.entrance), building: point(site.building) };
}

/**
 * How steeply the camera looks down, from the link: a space keeps its true
 * proportions (depth : width) when seen from straight above and is squashed
 * in depth from a low angle. Mostly true proportions -> "overhead" (cars are
 * judged by their whole outline), else "angled" (by the strip where the car
 * meets the ground).
 */
export function cameraTilt(site, link, cameraStalls) {
  const sa = site.aspect || 1.5, ca = link.cameraAspect || 16 / 9;
  const ratio = (poly, aspect) => {
    const w = Math.hypot((poly[1].x - poly[0].x) * aspect, poly[1].y - poly[0].y);
    const d = Math.hypot((poly[3].x - poly[0].x) * aspect, poly[3].y - poly[0].y);
    return w > 0 ? d / w : NaN;
  };
  const byId = new Map((site.stalls || []).map((s) => [s.id, s]));
  const f = cameraStalls.map((c) => ratio(c.poly, ca) / ratio(byId.get(c.id).poly, sa)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!f.length) return link.view || "angled";
  return f[Math.floor(f.length / 2)] >= 0.6 ? "overhead" : "angled";
}

/**
 * Apply an edit made in the camera view (new camera calibration) to the site
 * map. Spaces are matched by id: removed ones are removed, new ones are drawn
 * into the site through the link, changed types are kept; camera-only
 * settings (picture shape, angled/overhead) are stored on the link.
 */
export function applyCameraEdit(site, link, before, after) {
  const toSite = (p) => round(applyHomography(link.H, p));
  const seenBefore = new Set(before.stalls.map((s) => s.id));
  const byId = new Map((site.stalls || []).map((s) => [s.id, s]));
  const kept = [];
  const afterIds = new Set(after.stalls.map((s) => s.id));
  for (const s of site.stalls || []) {
    if (seenBefore.has(s.id) && !afterIds.has(s.id)) continue; // removed in the camera view
    kept.push(s);
  }
  const updated = kept.map((s) => {
    const a = after.stalls.find((x) => x.id === s.id);
    return a ? { ...s, kind: a.kind, label: a.label, row: a.row, index: a.index } : s;
  });
  const added = after.stalls.filter((s) => !byId.has(s.id)).map((s) => ({ ...s, poly: s.poly.map(toSite) }));
  const moved = (k) => after[k] && JSON.stringify(after[k]) !== JSON.stringify(before[k]);
  return {
    site: {
      ...site,
      stalls: [...updated, ...added],
      entrance: moved("entrance") ? toSite(after.entrance) : site.entrance,
      building: moved("building") ? toSite(after.building) : after.building === null && before.building ? null : site.building,
    },
    // A view chosen by hand (Angled / Overhead buttons) overrides the automatic one.
    link: after.view && after.view !== before.view
      ? { ...link, cameraAspect: after.aspect || link.cameraAspect, view: after.view, viewManual: true }
      : { ...link, cameraAspect: after.aspect || link.cameraAspect },
  };
}

/** A point in the camera's plan (camera lot units) -> site plan (site lot units). */
export function cameraLotToSiteLot(cameraLot, siteLot, link, p) {
  if (!p || !link?.H) return null;
  const cam = cameraLot.toCamera(p);
  return siteLot.toLot(applyHomography(link.H, cam));
}
