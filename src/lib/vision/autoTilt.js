// Automatic "un-tilt": measures how a tilted camera sees the ground plane and
// builds the ground calibration (lot corners + size in metres) without clicks.
//
// Idea: cars all have about the same real width. Seen by a tilted camera, a
// car's width in pixels shrinks in proportion to its distance from the horizon
// line: width_px = a * (y - yh). Fitting that line over the parked cars gives
// the horizon yh and the scale a. From there, every pixel maps to the ground:
//   lateral X (m) = (x - cx) * carWidth / (a * (y - yh))
//   depth   Z (m) = C / (y - yh)
// C (how strongly depth is foreshortened) is chosen so the cars come out with a
// normal car's length. Everything is a plain perspective, so the result is an
// exact homography that the rest of the app already understands.

const CAR_WIDTH = 1.85; // metres
const CAR_LENGTH = 4.6;

function robustLine(points) {
  let use = points;
  let fit = null;
  for (let iter = 0; iter < 4; iter += 1) {
    const n = use.length;
    if (n < 3) return null;
    const mx = use.reduce((s, p) => s + p.y, 0) / n, my = use.reduce((s, p) => s + p.s, 0) / n;
    let sxx = 0, sxy = 0;
    use.forEach((p) => { sxx += (p.y - mx) ** 2; sxy += (p.y - mx) * (p.s - my); });
    if (!sxx) return null;
    const a = sxy / sxx;
    fit = { a, b: my - a * mx };
    const res = points.map((p) => Math.abs(p.s - (fit.a * p.y + fit.b)) / Math.max(1, p.s));
    const next = points.filter((_, i) => res[i] < 0.3);
    if (next.length === use.length || next.length < 3) break;
    use = next;
  }
  // Goodness: how much of the size change the line explains.
  const n = use.length;
  const my = use.reduce((s, p) => s + p.s, 0) / n;
  const tot = use.reduce((s, p) => s + (p.s - my) ** 2, 0);
  const err = use.reduce((s, p) => s + (p.s - (fit.a * p.y + fit.b)) ** 2, 0);
  return { ...fit, r2: tot ? 1 - err / tot : 0, used: use };
}

/**
 * vehicles: boxes in % of the picture; width/height: picture size in px.
 * Returns { ground, strength } or null when the picture shows no clear tilt.
 * ground: { quad (camera %), width (m), length (m), auto: true }.
 */
export function estimateTilt(vehicles, width, height) {
  const cars = vehicles.filter((v) => v.w > 0 && v.h > 0);
  if (cars.length < 6) return null;
  const pts = cars.map((v) => ({ x: ((v.x + v.w / 2) / 100) * width, y: ((v.y + v.h / 2) / 100) * height, s: (v.w / 100) * width, h: (v.h / 100) * height }));
  const ys = pts.map((p) => p.y);
  const spread = Math.max(...ys) - Math.min(...ys);
  if (spread < height * 0.3) return null; // cars all at one distance: no way to measure
  const fit = robustLine(pts);
  if (!fit || fit.a <= 0 || fit.r2 < 0.3) return null;
  const yh = -fit.b / fit.a; // horizon line (px)
  const yTop = Math.min(...fit.used.map((p) => p.y));
  if (yh >= yTop - 2) return null;
  // How much smaller far cars look than near ones across the cars' range.
  const yBottom = Math.max(...fit.used.map((p) => p.y));
  const strength = 1 - (yTop - yh) / (yBottom - yh);
  if (strength < 0.15) return null; // practically straight down: nothing to fix

  const facing = median(pts.map((p) => p.h / p.s)) >= 0.8; // nose/tail toward the camera
  const lateralSize = facing ? CAR_WIDTH : CAR_LENGTH;
  const depthSize = facing ? CAR_LENGTH : CAR_WIDTH;
  const cx = width / 2;
  const a = fit.a;
  const params = { yh, a, cx, lateralSize, depthSize, width, height, yTop, yBottom, used: fit.used };
  return { strength: Math.round(strength * 100) / 100, params, ground: groundFor(params, yh) };
}

// Ground rectangle (camera quad + size in metres) for a given horizon line.
export function groundFor(params, yh, C = null) {
  const { cx, lateralSize, depthSize, width, height, used, yTop, yBottom } = params;
  // Scale a so a car's width matches at the cars' middle distance; C so its length does.
  const ymid = (yTop + yBottom) / 2;
  const sMid = params.a * (ymid - params.yh);
  const a = sMid / (ymid - yh);
  // Depth from the standard camera model (pinhole, no roll): for a lens with
  // focal length f (px), depth/lateral = f / (x - cx). Typical phone and CCTV
  // lenses (60-70 degrees wide) have f around 0.85 x picture width. Box heights
  // are not used: from a low angle they are mostly the car's height.
  if (C === null) C = (params.focal || width * 0.85) * lateralSize / a;
  void depthSize;
  const toGround = (x, y) => { const d = y - yh; return { X: ((x - cx) * lateralSize) / (a * d), Z: C / d }; };
  const toImage = (X, Z) => { const d = C / Z; return { x: cx + (X * a * d) / lateralSize, y: yh + d }; };

  // Ground rectangle: from the bottom of the picture up to a little above the
  // farthest car (never up to the horizon, which is infinitely far away).
  // Far limit: well past the farthest car (empty far rows still count), but not
  // up to the horizon (infinitely far: trees, buildings, sky).
  const farY = Math.max(yh + (height - yh) * 0.15, yTop - (yBottom - yTop) * 0.6, 0);
  const near = toGround(cx, height), far = toGround(cx, farY);
  const farLeft = toGround(0, farY), farRight = toGround(width, farY);
  // Sideways: the cars' spread plus a margin (a low camera sees far beyond the
  // lot at the sides), never narrower than the near edge of the picture.
  const carX = used.map((p) => toGround(p.x ?? cx, p.y).X);
  const spreadX = Math.max(...carX) - Math.min(...carX);
  const nearLeft = toGround(0, height), nearRight = toGround(width, height);
  const X0 = Math.min(nearLeft.X, Math.max(farLeft.X, Math.min(...carX) - spreadX * 0.25));
  const X1 = Math.max(nearRight.X, Math.min(farRight.X, Math.max(...carX) + spreadX * 0.25));
  const corners = [toImage(X0, far.Z), toImage(X1, far.Z), toImage(X1, near.Z), toImage(X0, near.Z)];
  const pct = (p) => ({ x: Math.round((p.x / width) * 10000) / 100, y: Math.round((p.y / height) * 10000) / 100 });
  return { quad: corners.map(pct), width: Math.round((X1 - X0) * 10) / 10, length: Math.round((far.Z - near.Z) * 10) / 10, auto: true, yh, c: C };
}

function median(v) {
  const s = v.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

// ---------------------------------------------------------------------------
// Straighten the picture itself: re-sample the ground rectangle as a top-down
// image (lines parallel again, far spaces full size) for the space finder.
import { applyHomography, homographyFromPoints, invertHomography } from "./geometry.js";

export function rectify(image, ground, maxSide = 720) {
  const { data, width: W, height: H } = image;
  const rw = ground.width >= ground.length ? maxSide : Math.max(1, Math.round((maxSide * ground.width) / ground.length));
  const rh = ground.width >= ground.length ? Math.max(1, Math.round((maxSide * ground.length) / ground.width)) : maxSide;
  // camera % -> rectified %
  const Hc = homographyFromPoints(ground.quad, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  const Hi = invertHomography(Hc);
  if (!Hc || !Hi) return null;
  const out = new Uint8ClampedArray(rw * rh * 4);
  for (let v = 0; v < rh; v += 1) {
    for (let u = 0; u < rw; u += 1) {
      const p = applyHomography(Hi, { x: ((u + 0.5) / rw) * 100, y: ((v + 0.5) / rh) * 100 });
      const x = Math.floor((p.x / 100) * W), y = Math.floor((p.y / 100) * H);
      const o = (v * rw + u) * 4;
      if (x < 0 || y < 0 || x >= W || y >= H) { out[o] = 40; out[o + 1] = 44; out[o + 2] = 40; out[o + 3] = 255; continue; }
      const i = (y * W + x) * 4;
      out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = 255;
    }
  }
  const toRect = (p) => applyHomography(Hc, p);
  const toCamera = (p) => applyHomography(Hi, p);
  const boxToRect = (b) => {
    const pts = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map(toRect);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    return { ...b, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  return { image: { data: out, width: rw, height: rh }, toRect, toCamera, boxToRect };
}

// Fine-tune the tilt with the painted spaces: real spaces in a lot are all the
// same width, so the right correction makes them come out equal near and far.
// Tries a few horizons around the car-based estimate and keeps the one with the
// most even space widths (among those that find nearly the most spaces).
export function refineTilt(image, tilt, findRows) {
  if (!tilt?.params) return tilt?.ground || null;
  const { params } = tilt;
  const D = params.yTop - params.yh;
  const trials = [0.45, 0.6, 0.75, 0.9, 1, 1.2, 1.5].map((f) => {
    const yh = params.yTop - D * f;
    const ground = groundFor(params, yh);
    const flat = rectify(image, ground, 600);
    if (!flat) return null;
    const r = findRows(flat.image, {});
    const widths = r.stalls.map((st) => ({
      w: Math.hypot(st.poly[1].x - st.poly[0].x, st.poly[1].y - st.poly[0].y),
      y: (st.poly[0].y + st.poly[2].y) / 2,
    }));
    if (widths.length < 6) return { f, ground, count: widths.length, score: Infinity };
    // Width trend with distance: slope of width against vertical position.
    const n = widths.length, my = widths.reduce((t, w) => t + w.y, 0) / n, mw = widths.reduce((t, w) => t + w.w, 0) / n;
    let sxx = 0, sxy = 0;
    widths.forEach((w) => { sxx += (w.y - my) ** 2; sxy += (w.y - my) * (w.w - mw); });
    const slope = sxx ? sxy / sxx : 0; // width change per % of height
    return { f, ground, count: n, score: Math.abs(slope * 50) / mw, stalls: r.stalls };
  }).filter(Boolean);
  const most = Math.max(...trials.map((t) => t.count));
  const best = trials.filter((t) => t.count >= most * 0.85).sort((x, y) => x.score - y.score)[0];
  if (!best || !Number.isFinite(best.score)) return tilt.ground;
  // Depth: painted spaces are about twice as long as wide (5 m x 2.5 m).
  // Stretch the depth so the measured spaces come out that way.
  const g = best.ground;
  const aspects = best.stalls.map((st) => {
    const m = (p, q) => Math.hypot(((q.x - p.x) * g.width) / 100, ((q.y - p.y) * g.length) / 100);
    const w = m(st.poly[0], st.poly[1]);
    const d = m(st.poly[0], st.poly[3]);
    return w > 0 ? d / w : NaN;
  });
  const aspect = median(aspects);
  if (!(aspect > 0.4 && aspect < 8)) return g;
  const fixed = groundFor(params, g.yh, g.c * (2 / aspect));
  // Scale: a space is about 2.5 m wide (the side-to-side width does not depend
  // on the depth stretch above, so it can be measured on the first plan).
  const widthM = median(best.stalls.map((st) => Math.hypot(((st.poly[1].x - st.poly[0].x) * g.width) / 100, ((st.poly[1].y - st.poly[0].y) * g.length) / 100)));
  const k = widthM > 0 ? 2.5 / widthM : 1;
  if (!(k > 0.2 && k < 5)) return fixed;
  return { ...fixed, width: Math.round(fixed.width * k * 10) / 10, length: Math.round(fixed.length * k * 10) / 10 };
}
