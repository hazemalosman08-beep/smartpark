// Automatic parking-space finder: reads the painted stall lines in a picture of
// the lot and turns them into stall polygons (no drawing needed).
//
// Steps
//  1. Paint mask: pixels clearly brighter than the asphalt around them and not
//     coloured (white / yellow-ish paint), found with a local "top-hat" filter.
//  2. Main line directions: the angles at which the mask pixels line up best.
//  3. Line segments along each direction (thin runs of paint).
//  4. Stall dividers: segments that have parallel neighbours of similar length
//     side by side, at stall spacing. Neighbours are grouped into rows.
//  5. Stalls: the space between two neighbouring dividers. Where a divider is
//     hidden (under a car, worn paint) the row's regular spacing fills it in.
//
// Works on { data: RGBA bytes, width, height } and returns stalls in percent of
// the picture, plus aisle centre lines for routing.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = (arr) => {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

function boxBlur(src, w, h, r) {
  // Integral-image mean filter.
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

export function paintMask({ data, width: w, height: h }, { vehicles = [] } = {}) {
  const gray = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = mx ? (mx - mn) / mx : 0;
  }
  const radius = Math.max(4, Math.round(Math.max(w, h) / 45));
  const bg = boxBlur(gray, w, h, radius);
  // Pavement only: grey, not too bright (sky, clouds) and not coloured (grass, trees).
  const satBg = boxBlur(sat, w, h, radius);
  // Global contrast: threshold relative to how bright paint is in this picture.
  const diffs = [];
  for (let i = 0; i < w * h; i += 7) diffs.push(gray[i] - bg[i]);
  diffs.sort((a, b) => a - b);
  const p98 = diffs[Math.floor(diffs.length * 0.98)] || 40;
  const thr = clamp(p98 * 0.45, 14, 60);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const d = gray[i] - bg[i];
    // White paint (low saturation) or yellow paint (warm hue, moderate saturation).
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const yellow = r > 150 && g > 120 && b < g * 0.75 && sat[i] < 0.7;
    if (d > thr && (sat[i] < 0.28 || yellow) && bg[i] > 35 && bg[i] < 185 && satBg[i] < 0.45) mask[i] = 1;
  }
  // The middle of each vehicle is not paint (white car roofs, reflections).
  for (const v of vehicles) {
    const x0 = Math.round(((v.x + v.w * 0.22) / 100) * w), x1 = Math.round(((v.x + v.w * 0.78) / 100) * w);
    const y0 = Math.round(((v.y + v.h * 0.22) / 100) * h), y1 = Math.round(((v.y + v.h * 0.78) / 100) * h);
    const xa = clamp(x0, 0, w), xb = clamp(x1, 0, w);
    if (xb <= xa) continue;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y += 1) mask.fill(0, y * w + xa, y * w + xb);
  }
  return mask;
}

// Angles (degrees, 0..180) at which mask pixels line up into lines.
function dominantAngles(points, max = 3) {
  const scores = new Float64Array(180);
  const step = Math.max(1, Math.floor(points.length / 25000));
  let maxR = 0;
  for (const [x, y] of points) maxR = Math.max(maxR, Math.hypot(x, y));
  const size = Math.ceil(maxR) * 2 + 3;
  const hist = new Float64Array(size);
  for (let a = 0; a < 180; a += 1) {
    const t = (a * Math.PI) / 180;
    const nx = -Math.sin(t), ny = Math.cos(t);
    hist.fill(0);
    for (let i = 0; i < points.length; i += step) hist[Math.round(points[i][0] * nx + points[i][1] * ny + maxR + 1)] += 1;
    // Peakiness, not mass: each bin is compared with its neighbourhood, so the
    // shape of the picture (wide vs tall) does not favour any angle.
    let s = 0, run = 0;
    const win = 6;
    for (let k = 0; k < size; k += 1) {
      run += hist[k] - (k - 2 * win - 1 >= 0 ? hist[k - 2 * win - 1] : 0);
      const c = k - win;
      if (c < 0) continue;
      const local = run / (2 * win + 1);
      const excess = hist[c] - local;
      if (excess > 0) s += excess * excess;
    }
    scores[a] = s;
  }
  const base = 0;
  const peaks = [];
  for (let a = 0; a < 180; a += 1) {
    let isMax = true;
    for (let d = -8; d <= 8 && isMax; d += 1) if (d && scores[(a + d + 180) % 180] > scores[a]) isMax = false;
    if (isMax) peaks.push({ a, s: scores[a] - base });
  }
  peaks.sort((x, y) => y.s - x.s);
  const top = peaks[0]?.s || 0;
  return peaks.filter((p) => p.s > top * 0.25).slice(0, max).map((p) => p.a);
}

// Thin runs of paint along one direction.
function segmentsAlong(points, maskW, maskH, angleDeg, { minLen, gap = 4, maxThick = 9 }) {
  const t = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(t), uy = Math.sin(t), nx = -uy, ny = ux;
  const bins = new Map();
  for (const [x, y] of points) {
    const r = Math.round(x * nx + y * ny);
    if (!bins.has(r)) bins.set(r, []);
    bins.get(r).push(x * ux + y * uy);
  }
  const runs = [];
  for (const [r, list] of bins) {
    list.sort((a, b) => a - b);
    let start = list[0], prev = list[0], count = 1;
    for (let i = 1; i <= list.length; i += 1) {
      const v = list[i];
      if (i < list.length && v - prev <= gap) { prev = v; count += 1; continue; }
      if (prev - start >= minLen && count >= (prev - start) * 0.55) runs.push({ r, a: start, b: prev });
      start = v; prev = v; count = 1;
    }
  }
  // Merge runs from neighbouring offsets (one painted line is several pixels thick).
  runs.sort((p, q) => p.r - q.r || p.a - q.a);
  const used = new Uint8Array(runs.length);
  const segs = [];
  for (let i = 0; i < runs.length; i += 1) {
    if (used[i]) continue;
    const group = [runs[i]];
    used[i] = 1;
    let last = runs[i].r;
    for (let j = i + 1; j < runs.length && runs[j].r <= last + 2; j += 1) {
      if (used[j]) continue;
      const g = group[group.length - 1];
      const overlap = Math.min(g.b, runs[j].b) - Math.max(g.a, runs[j].a);
      if (runs[j].r - last <= 2 && overlap > 0.4 * Math.min(g.b - g.a, runs[j].b - runs[j].a)) {
        group.push(runs[j]); used[j] = 1; last = runs[j].r;
      }
    }
    const thick = group[group.length - 1].r - group[0].r + 1;
    if (thick > maxThick) continue;
    const r = group.reduce((s, g) => s + g.r, 0) / group.length;
    const a = median(group.map((g) => g.a)), b = median(group.map((g) => g.b));
    if (b - a < minLen) continue;
    segs.push({
      angle: angleDeg,
      p: { x: a * ux + r * nx, y: a * uy + r * ny },
      q: { x: b * ux + r * nx, y: b * uy + r * ny },
      len: b - a,
      thick,
    });
  }
  return segs.filter((s) => s.p.x >= -2 && s.p.y >= -2 && s.q.x <= maskW + 2 && s.q.y <= maskH + 2);
}

const mid = (s) => ({ x: (s.p.x + s.q.x) / 2, y: (s.p.y + s.q.y) / 2 });

// Straight front and back edges for a row: where each divider starts and ends
// (along its own direction) is fitted as a straight line across the row, robust
// to dividers that look short because paint is hidden or worn.
function straightenEnds(dividers, ux, uy) {
  if (dividers.length < 3) return dividers;
  const fit = (pick) => {
    const pts = dividers.map((d) => ({ k: d.key, u: pick(d).x * ux + pick(d).y * uy }));
    let line = { a: 0, b: 0 };
    let use = pts;
    for (let iter = 0; iter < 3; iter += 1) {
      const n = use.length;
      const mk = use.reduce((s, p) => s + p.k, 0) / n, mu = use.reduce((s, p) => s + p.u, 0) / n;
      let sxx = 0, sxy = 0;
      use.forEach((p) => { sxx += (p.k - mk) ** 2; sxy += (p.k - mk) * (p.u - mu); });
      const b = sxx ? sxy / sxx : 0;
      line = { a: mu - b * mk, b };
      const res = pts.map((p) => Math.abs(p.u - (line.a + line.b * p.k)));
      const tol = Math.max(3, median(res) * 2.5);
      const next = pts.filter((_, i) => res[i] <= tol);
      if (next.length < 2 || next.length === use.length) break;
      use = next;
    }
    return line;
  };
  const fa = fit((d) => d.a), fb = fit((d) => d.b);
  return dividers.map((d) => {
    const ua = d.a.x * ux + d.a.y * uy, ub = d.b.x * ux + d.b.y * uy;
    const ta = fa.a + fa.b * d.key, tb = fb.a + fb.b * d.key;
    // Move each end along the divider's own line to the fitted edge.
    const a = { x: d.a.x + ux * (ta - ua), y: d.a.y + uy * (ta - ua) };
    const b = { x: d.b.x + ux * (tb - ub), y: d.b.y + uy * (tb - ub) };
    return { ...d, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
}

function crossing(a, b) {
  const d1x = a.q.x - a.p.x, d1y = a.q.y - a.p.y, d2x = b.q.x - b.p.x, d2y = b.q.y - b.p.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.p.x - a.p.x) * d2y - (b.p.y - a.p.y) * d2x) / den;
  const u = ((b.p.x - a.p.x) * d1y - (b.p.y - a.p.y) * d1x) / den;
  return { t, u };
}

function splitAtCrossings(segs) {
  const out = [];
  for (const s of segs) {
    const cuts = [];
    for (const o of segs) {
      if (o === s || o.len < s.len * 1.5) continue; // only long "row" lines cut
      let dAng = Math.abs(((s.angle - o.angle) % 180 + 180) % 180);
      dAng = Math.min(dAng, 180 - dAng);
      if (dAng < 35) continue;
      const c = crossing(s, o);
      // The long line must really pass through this divider's middle part.
      const margin = 4 / s.len;
      if (c && c.t > 0.2 && c.t < 0.8 && c.u > -margin && c.u < 1 + margin) cuts.push(c.t);
    }
    if (!cuts.length) { out.push(s); continue; }
    const ts = [0, ...cuts.sort((x, y) => x - y), 1];
    for (let i = 0; i < ts.length - 1; i += 1) {
      const a = ts[i], b = ts[i + 1];
      if ((b - a) * s.len < 8) continue;
      const p = { x: s.p.x + (s.q.x - s.p.x) * a, y: s.p.y + (s.q.y - s.p.y) * a };
      const q = { x: s.p.x + (s.q.x - s.p.x) * b, y: s.p.y + (s.q.y - s.p.y) * b };
      out.push({ ...s, p, q, len: (b - a) * s.len });
    }
  }
  return out;
}

function mergeCollinear(list) {
  let segs = list.map((s) => ({ ...s }));
  for (let changed = true; changed;) {
    changed = false;
    segs.sort((a, b) => b.len - a.len);
    outer: for (let i = 0; i < segs.length; i += 1) {
      const A = segs[i];
      const t = Math.atan2(A.q.y - A.p.y, A.q.x - A.p.x);
      const ux = Math.cos(t), uy = Math.sin(t);
      for (let j = i + 1; j < segs.length; j += 1) {
        const B = segs[j];
        const tb = Math.atan2(B.q.y - B.p.y, B.q.x - B.p.x);
        let d = Math.abs(t - tb) % Math.PI;
        d = Math.min(d, Math.PI - d);
        if (d > 0.08) continue;
        const off = (p) => Math.abs((p.x - A.p.x) * -uy + (p.y - A.p.y) * ux);
        if (off(B.p) > 3 || off(B.q) > 3) continue;
        const proj = (p) => (p.x - A.p.x) * ux + (p.y - A.p.y) * uy;
        const b0 = Math.min(proj(B.p), proj(B.q)), b1 = Math.max(proj(B.p), proj(B.q));
        const gap = Math.max(b0 - A.len, -b1, 0);
        if (gap > Math.max(8, 0.2 * A.len)) continue;
        const lo = Math.min(0, b0), hi = Math.max(A.len, b1);
        segs[i] = {
          ...A,
          p: { x: A.p.x + ux * lo, y: A.p.y + uy * lo },
          q: { x: A.p.x + ux * hi, y: A.p.y + uy * hi },
          len: hi - lo,
        };
        segs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  // Keep the angle field consistent with the merged geometry (degrees, 0..180).
  return segs.map((s) => ({ ...s, angle: ((Math.atan2(s.q.y - s.p.y, s.q.x - s.p.x) * 180) / Math.PI + 180) % 180 }));
}

/**
 * Find stalls in an image.
 * image: { data, width, height } (any size; it is processed at <= 720 px)
 * vehicles: detected vehicle boxes in % (used to ignore car roofs and to fill rows)
 */
export function findStalls(image, { vehicles = [] } = {}) {
  const { width: W, height: H } = image;
  const mask = paintMask(image, { vehicles });
  const points = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (mask[y * W + x]) points.push([x, y]);
  if (points.length < 50) return { stalls: [], aisles: [], debug: { points: points.length } };

  const minLen = Math.max(10, Math.min(W, H) * 0.035);
  const angles = dominantAngles(points);
  // Every direction in 2° steps: painted lines can run at any angle, and under
  // perspective the lines of one row are not exactly parallel.
  let segs = [];
  for (let a = 0; a < 180; a += 2) segs.push(...segmentsAlong(points, W, H, a, { minLen }));
  // De-duplicate near-identical segments found at neighbouring angles (keep the longest).
  segs.sort((a, b) => b.len - a.len);
  const kept = [];
  for (const s of segs) {
    const m = mid(s);
    const dup = kept.some((k) => {
      const dAng = Math.abs(((k.angle - s.angle + 90 + 180) % 180) - 90);
      if (dAng > 5) return false;
      const t = (k.angle * Math.PI) / 180;
      const off = Math.abs((m.x - k.p.x) * -Math.sin(t) + (m.y - k.p.y) * Math.cos(t));
      const along = (m.x - k.p.x) * Math.cos(t) + (m.y - k.p.y) * Math.sin(t);
      return off < 4 && along > -s.len * 0.3 && along < k.len + s.len * 0.3;
    });
    if (!dup) kept.push(s);
  }
  // Join pieces of the same painted line (breaks from wear, shadows, angle steps).
  segs = mergeCollinear(kept);

  // A divider that runs straight through a double row (across the line between
  // the two rows) belongs to two stalls: split it where a long line crosses it.
  segs = splitAtCrossings(segs);

  // Segments whose middle sits inside a vehicle are reflections / car edges.
  const inCar = (p) => vehicles.some((v) => {
    const x = (p.x / W) * 100, y = (p.y / H) * 100;
    return x > v.x + v.w * 0.2 && x < v.x + v.w * 0.8 && y > v.y + v.h * 0.2 && y < v.y + v.h * 0.8;
  });
  segs = segs.filter((s) => !inCar(mid(s)) && s.len >= minLen * 1.6);

  // --- Group dividers into rows -------------------------------------------
  const n = segs.length;
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unit = (s) => { const t = (s.angle * Math.PI) / 180; return { ux: Math.cos(t), uy: Math.sin(t) }; };
  const neighbour = (i, j, maxFactor) => {
    const a = segs[i], b = segs[j];
    const dAng = Math.abs(((a.angle - b.angle + 90 + 180) % 180) - 90);
    if (dAng > 8) return null;
    const ratio = a.len / b.len;
    if (ratio < 0.55 || ratio > 1.8) return null;
    const { ux, uy } = unit(a);
    const ma = mid(a), mb = mid(b);
    const dx = mb.x - ma.x, dy = mb.y - ma.y;
    const along = Math.abs(dx * ux + dy * uy);
    const across = Math.abs(-dx * uy + dy * ux);
    const L = (a.len + b.len) / 2;
    // Side by side: the start points line up. Angled (herringbone) rows shift a
    // little per stall, but never by a whole stall depth (that is the next row).
    if (along > L * 0.25 + across * 0.9) return null;
    if (across < L * 0.18 || across > L * maxFactor) return null;
    return { across, along };
  };
  const links = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const nb = neighbour(i, j, 0.95);
      if (nb) links.push({ i, j, ...nb });
    }
  }
  // Each divider links to its closest neighbour on each side only.
  links.sort((a, b) => a.across - b.across);
  const degree = new Map();
  for (const l of links) {
    if ((degree.get(l.i) || 0) >= 2 || (degree.get(l.j) || 0) >= 2) continue;
    degree.set(l.i, (degree.get(l.i) || 0) + 1);
    degree.set(l.j, (degree.get(l.j) || 0) + 1);
    parent[find(l.i)] = find(l.j);
  }
  const groups = new Map();
  segs.forEach((_, i) => {
    if (!degree.get(i)) return;
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });

  // Typical stall spacing (perpendicular to the dividers) from linked pairs.
  const usedLinks = links.filter((l) => find(l.i) === find(l.j) && degree.get(l.i) && degree.get(l.j));
  const spacing = median(usedLinks.map((l) => l.across));

  const rows = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const list = members.map((i) => segs[i]);
    // Orient all dividers the same way.
    const ref = unit(list[0]);
    const oriented = list.map((s) => {
      const dot = (s.q.x - s.p.x) * ref.ux + (s.q.y - s.p.y) * ref.uy;
      return dot >= 0 ? { a: s.p, b: s.q, len: s.len } : { a: s.q, b: s.p, len: s.len };
    });
    // Row direction: from the first to the last divider middle, by PCA.
    const mids = oriented.map((s) => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }));
    const cx = mids.reduce((s, p) => s + p.x, 0) / mids.length, cy = mids.reduce((s, p) => s + p.y, 0) / mids.length;
    let sxx = 0, sxy = 0, syy = 0;
    mids.forEach((p) => { sxx += (p.x - cx) ** 2; sxy += (p.x - cx) * (p.y - cy); syy += (p.y - cy) ** 2; });
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const rx = Math.cos(theta), ry = Math.sin(theta);
    // Perpendicular spacing direction (across the dividers).
    const px = -ref.uy, py = ref.ux;
    const sorted = oriented
      .map((s, k) => ({ ...s, m: mids[k], key: mids[k].x * px + mids[k].y * py }))
      .sort((a, b) => a.key - b.key);
    // A chain of neighbours can zig-zag into the next row: cut it wherever the
    // start points jump by more than one stall's worth of shift.
    const runs = [[sorted[0]]];
    for (let k = 1; k < sorted.length; k += 1) {
      const prev = sorted[k - 1], cur = sorted[k];
      const ua = (p) => p.x * ref.ux + p.y * ref.uy;
      const shiftA = Math.abs(ua(cur.a) - ua(prev.a)), shiftB = Math.abs(ua(cur.b) - ua(prev.b));
      const L = (prev.len + cur.len) / 2;
      const allowed = 0.3 * L + 0.8 * (cur.key - prev.key);
      if (Math.min(shiftA, shiftB) > allowed) runs.push([cur]);
      else runs[runs.length - 1].push(cur);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      rows.push({ dividers: straightenEnds(run, ref.ux, ref.uy), rx, ry, px, py, ux: ref.ux, uy: ref.uy });
    }
  }

  // Join rows that continue each other across a hidden divider (car on the line).
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < rows.length; i += 1) {
      for (let j = 0; j < rows.length; j += 1) {
        if (i === j) continue;
        const A = rows[i], B = rows[j];
        const last = A.dividers[A.dividers.length - 1], first = B.dividers[0];
        const dAng = Math.abs(Math.atan2(A.uy, A.ux) - Math.atan2(B.uy, B.ux)) % Math.PI;
        if (Math.min(dAng, Math.PI - dAng) > 0.14) continue;
        const dx = first.m.x - last.m.x, dy = first.m.y - last.m.y;
        const across = dx * A.px + dy * A.py;
        const along = Math.abs(dx * A.ux + dy * A.uy);
        if (across <= 0 || across > spacing * 4.5 || along > (last.len + first.len) * 0.1 + across * 0.75) continue;
        if (Math.abs(last.len / first.len - 1) > 0.6) continue;
        // Both ends of the next divider must continue the row's two end lines.
        if (A.dividers.length >= 2) {
          const f0 = A.dividers[0], f1 = last;
          const lineDist = (p, a, b) => {
            const lx = b.x - a.x, ly = b.y - a.y, L = Math.hypot(lx, ly) || 1;
            return Math.abs((p.x - a.x) * ly - (p.y - a.y) * lx) / L;
          };
          // One end (usually the back / apex) must line up closely; the other end
          // only roughly, since a divider partly under a car looks shorter.
          const da = lineDist(first.a, f0.a, f1.a) / first.len, db = lineDist(first.b, f0.b, f1.b) / first.len;
          if (Math.min(da, db) > 0.15 || Math.max(da, db) > 0.45) continue;
        }
        A.dividers = [...A.dividers, ...B.dividers];
        rows.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }

  // --- Stalls between neighbouring dividers ---------------------------------
  const pct = (p) => ({ x: Math.round(clamp((p.x / W) * 100, 0, 100) * 100) / 100, y: Math.round(clamp((p.y / H) * 100, 0, 100) * 100) / 100 });
  const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const sampleMask = (p) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) return 1;
    }
    return 0;
  };

  const out = [];
  const aisles = [];
  rows.forEach((row) => {
    const d = row.dividers;
    const rowSpacing = median(d.slice(1).map((s, i) => s.key - d[i].key).filter((g) => g > spacing * 0.6 && g < spacing * 1.5)) || spacing;
    const cells = [];
    for (let i = 0; i < d.length - 1; i += 1) {
      const g = d[i + 1].key - d[i].key;
      const k = Math.round(g / rowSpacing);
      if (k < 1 || k > 4) continue;
      for (let s = 0; s < k; s += 1) {
        cells.push({
          a0: lerp(d[i].a, d[i + 1].a, s / k), a1: lerp(d[i].a, d[i + 1].a, (s + 1) / k),
          b0: lerp(d[i].b, d[i + 1].b, s / k), b1: lerp(d[i].b, d[i + 1].b, (s + 1) / k),
        });
      }
    }
    // A single "stall" on its own is usually road markings or kerb lines.
    if (cells.length < 2) return;
    // Which end is the aisle? The back end usually has a painted line or the next
    // row's stalls right behind it; the front opens onto empty asphalt.
    const beyond = (end) => {
      let hits = 0, total = 0;
      for (const s of d) {
        const from = end === "a" ? s.a : s.b, to = end === "a" ? s.b : s.a;
        const dir = { x: (from.x - to.x) / s.len, y: (from.y - to.y) / s.len };
        for (let t = 0.05; t <= 0.35; t += 0.05) {
          total += 1;
          hits += sampleMask({ x: from.x + dir.x * s.len * t, y: from.y + dir.y * s.len * t });
        }
        // a painted line running along the row at this end
        const side = { x: row.px * rowSpacing * 0.5, y: row.py * rowSpacing * 0.5 };
        total += 2;
        hits += sampleMask({ x: from.x + side.x, y: from.y + side.y }) + sampleMask({ x: from.x - side.x, y: from.y - side.y });
      }
      return total ? hits / total : 0;
    };
    const frontIsA = beyond("a") <= beyond("b");
    const depth = median(d.map((s) => s.len));
    cells.forEach((c) => {
      const f0 = frontIsA ? c.a0 : c.b0, f1 = frontIsA ? c.a1 : c.b1;
      const k0 = frontIsA ? c.b0 : c.a0, k1 = frontIsA ? c.b1 : c.a1;
      out.push({ poly: [f0, f1, k1, k0], row });
    });
    // Aisle centre line in front of the row.
    const fronts = cells.flatMap((c) => (frontIsA ? [c.a0, c.a1] : [c.b0, c.b1]));
    const outward = frontIsA ? { x: -row.ux, y: -row.uy } : { x: row.ux, y: row.uy };
    const off = depth * 0.65;
    const along = (p) => p.x * row.px + p.y * row.py;
    const ordered = fronts.sort((p, q) => along(p) - along(q));
    const first = ordered[0], last = ordered[ordered.length - 1];
    const ext = rowSpacing * 0.8;
    aisles.push({
      points: [
        { x: first.x + outward.x * off - row.px * ext, y: first.y + outward.y * off - row.py * ext },
        { x: last.x + outward.x * off + row.px * ext, y: last.y + outward.y * off + row.py * ext },
      ].map(pct),
    });
  });

  // Drop stalls that overlap an already accepted one (two rows sharing paint).
  const area = (poly) => {
    let s = 0;
    for (let i = 0; i < poly.length; i += 1) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  };
  const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
  const inside = (p, poly) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  const accepted = [];
  const typical = median(out.map((s) => area(s.poly)));
  for (const s of out.sort((a, b) => area(b.poly) - area(a.poly))) {
    const A = area(s.poly);
    if (A < typical * 0.4 || A > typical * 1.8) continue;
    const c = centroid(s.poly);
    if (accepted.some((t) => inside(c, t.poly) || inside(centroid(t.poly), s.poly))) continue;
    accepted.push(s);
  }

  // Name rows A, B, C… top to bottom then left to right, stalls along the row.
  const rowList = [...new Set(accepted.map((s) => s.row))];
  const rowCenter = (row) => {
    const cs = accepted.filter((s) => s.row === row).map((s) => centroid(s.poly));
    return { x: cs.reduce((a, p) => a + p.x, 0) / cs.length, y: cs.reduce((a, p) => a + p.y, 0) / cs.length };
  };
  const centers = new Map(rowList.map((r) => [r, rowCenter(r)]));
  rowList.sort((a, b) => centers.get(a).x - centers.get(b).x || centers.get(a).y - centers.get(b).y);
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
  const stalls = [];
  rowList.forEach((row, ri) => {
    const L = letter(ri);
    const along = (s) => { const c = centroid(s.poly); return c.x * row.px + c.y * row.py; };
    accepted.filter((s) => s.row === row).sort((a, b) => along(a) - along(b)).forEach((s, i) => {
      stalls.push({
        id: `${L}${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
        row: L, index: i + 1, label: `${L}${i + 1}`,
        poly: s.poly.map(pct),
        auto: true,
      });
    });
  });

  return {
    stalls,
    aisles: aisles.filter((a, i) => rowList.length ? i < rows.length : false).map((a, i) => ({ id: `auto-aisle-${i}`, points: a.points, auto: true })),
    debug: { points: points.length, angles, segments: segs.length, rows: rows.length, spacing },
    segments: segs.map((s) => ({ p: pct(s.p), q: pct(s.q) })),
  };
}

// Read an image/video/canvas into pixels at a working size.
export function imagePixels(source, maxSide = 720) {
  const w0 = source.videoWidth || source.naturalWidth || source.width;
  const h0 = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Does each stall look like empty pavement? A parked car changes the stall's
// brightness and adds texture (windows, roof edges, shadows), even when the
// object detector does not recognise it from above.
// Returns Map(stallId -> score); about 1 means "looks occupied".
export function stallAppearance({ data, width: W, height: H }, stalls) {
  // Blue paint (the accessible symbol) is not a car.
  const BLUE = -1;
  const gray = (x, y) => {
    const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y)));
    const i = (yi * W + xi) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (b > r + 35 && b > g + 10 && b > 90) return BLUE;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const grayOf = (x, y) => {
    const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y)));
    const i = (yi * W + xi) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const feats = stalls.map((s) => {
    const [p0, p1, p2, p3] = s.poly.map((p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H }));
    const grid = [];
    // Inner 20%..80% of the stall, away from the painted lines.
    for (let i = 0; i < 9; i += 1) for (let j = 0; j < 9; j += 1) {
      const u = 0.2 + (0.6 * i) / 8, v = 0.2 + (0.6 * j) / 8;
      const top = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
      const bot = { x: p3.x + (p2.x - p3.x) * u, y: p3.y + (p2.y - p3.y) * u };
      const x = top.x + (bot.x - top.x) * v, y = top.y + (bot.y - top.y) * v;
      const val = gray(x, y);
      grid.push({ blue: val === BLUE, g: val === BLUE ? grayOf(x, y) : val });
    }
    // An accessible space whose symbol is in sight is free: a parked car
    // would cover it. (Elsewhere blue is judged like any colour: blue cars,
    // reflections.)
    if (s.kind === "accessible" && grid.filter((c) => c.blue && c.g >= 85).length >= 3) return { id: s.id, free: true };
    const vals = grid.map((c) => c.g);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { id: s.id, row: s.row, mean, sd };
  });
  const usable = feats.filter((f) => !f.free);
  if (usable.length < 4) return new Map();
  // The typical empty stall: the quieter half of the stalls.
  const baseline = (list) => {
    const quiet = [...list].sort((a, b) => a.sd - b.sd).slice(0, Math.max(2, Math.ceil(list.length / 2)));
    const m0 = median(quiet.map((f) => f.mean));
    const s0 = median(quiet.map((f) => f.sd));
    const spread = Math.max(6, median(quiet.map((f) => Math.abs(f.mean - m0))) * 2.5);
    const score = (f) => Math.max(Math.abs(f.mean - m0) / (spread * 2.2), (f.sd - s0) / Math.max(10, s0 * 2.2));
    return score;
  };
  const lotWide = baseline(usable);
  return new Map(feats.map((f) => [f.id, f.free ? 0 : lotWide(f)]));
}

// ===========================================================================
// Row-based space finder.
//
// Parking lots are regular: within a row, the dividers are parallel, start and
// end at the same lines, and repeat at a fixed spacing. Instead of building
// each space from whatever lines happen to touch, this finder
//   1. finds the divider direction(s) (many parallel lines of similar length),
//   2. groups dividers into row bands that share the same start/end,
//   3. measures the row's spacing from the dividers themselves,
//   4. makes a space between each pair of neighbouring dividers; a gap of two
//      spacings is a divider hidden under a car (three only with a car in it);
//      anything wider is an island or road and splits the row,
//   5. takes the row's depth from where most dividers start and end (one stray
//      long line or a kerb cannot stretch it),
//   6. adds a space past the last divider only where a car is parked there.
// ===========================================================================

function collectSegments(points, W, H, minLen) {
  let segs = [];
  for (let a = 0; a < 180; a += 2) segs.push(...segmentsAlong(points, W, H, a, { minLen }));
  segs.sort((a, b) => b.len - a.len);
  const kept = [];
  for (const s of segs) {
    const m = mid(s);
    const dup = kept.some((k) => {
      const dAng = Math.abs(((k.angle - s.angle + 90 + 180) % 180) - 90);
      if (dAng > 5) return false;
      const t = (k.angle * Math.PI) / 180;
      const off = Math.abs((m.x - k.p.x) * -Math.sin(t) + (m.y - k.p.y) * Math.cos(t));
      const along = (m.x - k.p.x) * Math.cos(t) + (m.y - k.p.y) * Math.sin(t);
      return off < 4 && along > -s.len * 0.3 && along < k.len + s.len * 0.3;
    });
    if (!dup) kept.push(s);
  }
  return mergeCollinear(kept);
}

const angleDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

// Divider directions: angles shared by many segments of similar length that
// stand side by side (a row), weighted by how many such neighbours they have.
function dividerDirections(segs) {
  const score = new Float64Array(180);
  segs.forEach((s, i) => {
    let neighbours = 0;
    for (let j = 0; j < segs.length; j += 1) {
      if (i === j) continue;
      const o = segs[j];
      if (angleDiff(s.angle, o.angle) > 6) continue;
      const r = s.len / o.len;
      if (r < 0.6 || r > 1.65) continue;
      const t = (s.angle * Math.PI) / 180;
      const d = { x: mid(o).x - mid(s).x, y: mid(o).y - mid(s).y };
      const along = Math.abs(d.x * Math.cos(t) + d.y * Math.sin(t));
      const across = Math.abs(-d.x * Math.sin(t) + d.y * Math.cos(t));
      if (along < s.len * 0.35 && across > s.len * 0.15 && across < s.len * 1.2) neighbours += 1;
    }
    if (neighbours >= 1) score[Math.round(s.angle) % 180] += Math.min(neighbours, 2);
  });
  const smooth = (a) => { let t = 0; for (let d = -4; d <= 4; d += 1) t += score[(a + d + 180) % 180]; return t; };
  const sm = Array.from({ length: 180 }, (_, a) => smooth(a));
  const peaks = [];
  for (let a = 0; a < 180; a += 1) {
    let isMax = sm[a] > 0;
    for (let d = -10; d <= 10 && isMax; d += 1) if (d && sm[(a + d + 180) % 180] > sm[a]) isMax = false;
    if (isMax && !peaks.some((p) => angleDiff(p.a, a) < 15)) peaks.push({ a, s: sm[a] });
  }
  peaks.sort((x, y) => y.s - x.s);
  const top = peaks[0]?.s || 0;
  return peaks.filter((p) => p.s >= Math.max(6, top * 0.3)).slice(0, 2).map((p) => p.a);
}

// Share of a row cell that is vegetation or bare earth (not asphalt/concrete).
function planted({ data, width: W, height: H }, a, b, v0, v1, r) {
  let n = 0, t = 0;
  for (let i = 1; i < 8; i += 1) for (let j = 1; j < 8; j += 1) {
    const u = a + ((b - a) * i) / 8, v = v0 + ((v1 - v0) * j) / 8;
    const x = Math.round(v * r.ux + u * r.px), y = Math.round(v * r.uy + u * r.py);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const k = (y * W + x) * 4;
    const R = data[k], G = data[k + 1], B = data[k + 2];
    t += 1;
    const green = G > R + 6 && G > B + 6;
    const earth = R > B + 22 && G > B + 8 && R - G < 45; // brown soil / mulch
    if (green || earth) n += 1;
  }
  return t ? n / t : 0;
}

export function findStallsByRows(image, { vehicles = [] } = {}) {
  const { width: W, height: H } = image;
  const mask = paintMask(image, { vehicles });
  const points = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (mask[y * W + x]) points.push([x, y]);
  if (points.length < 50) return { stalls: [], aisles: [], debug: { points: points.length, rows: 0 }, segments: [] };
  const minLen = Math.max(10, Math.min(W, H) * 0.035);
  // Dividers running straight through a double row (or across a kerb between
  // two rows) are cut where a long line crosses them: each half is one row.
  const raw = collectSegments(points, W, H, minLen);
  const dirs = dividerDirections(splitAtCrossings(raw).filter((s) => s.len >= minLen * 1.4));
  // Cut dividers at row boundaries: kerb edges, back lines and centre lines run
  // across the dividers. They are often broken (trees, worn paint), so every
  // crossing piece nearby counts, not only one long unbroken line.
  const all = [];
  for (const sg of raw) {
    const dir = dirs.find((d) => angleDiff(sg.angle, d) <= 8);
    if (dir === undefined) { all.push(sg); continue; }
    const t = (sg.angle * Math.PI) / 180;
    const ux = Math.cos(t), uy = Math.sin(t), px = -uy, py = ux;
    const sv0 = sg.p.x * ux + sg.p.y * uy, sv1 = sg.q.x * ux + sg.q.y * uy;
    const lo = Math.min(sv0, sv1), hi = Math.max(sv0, sv1);
    const su = mid(sg).x * px + mid(sg).y * py;
    const reach = Math.max(minLen * 2, sg.len * 0.9);
    const cuts = [];
    for (const o of raw) {
      if (o === sg || angleDiff(o.angle, (dir + 90) % 180) > 15 || o.len < minLen * 0.8) continue;
      const ou0 = o.p.x * px + o.p.y * py, ou1 = o.q.x * px + o.q.y * py;
      if (su < Math.min(ou0, ou1) - reach || su > Math.max(ou0, ou1) + reach) continue;
      const ov = (mid(o).x * ux + mid(o).y * uy);
      if (ov > lo + sg.len * 0.15 && ov < hi - sg.len * 0.15) cuts.push(ov);
    }
    if (!cuts.length) { all.push(sg); continue; }
    cuts.sort((a, b) => a - b);
    // Several pieces of one boundary line count once.
    const merged = [];
    for (const c of cuts) if (!merged.length || c - merged[merged.length - 1] > minLen * 0.5) merged.push(c);
    const ts = [lo, ...merged, hi];
    for (let i = 0; i < ts.length - 1; i += 1) {
      const a = ts[i] + (i ? 2 : 0), b = ts[i + 1] - (i < ts.length - 2 ? 2 : 0);
      if (b - a < minLen * 1.4) continue;
      // point on the divider at v: start point shifted along its direction
      const at = (v) => ({ x: (sv0 < sv1 ? sg.p.x : sg.q.x) + ux * (v - lo), y: (sv0 < sv1 ? sg.p.y : sg.q.y) + uy * (v - lo) });
      all.push({ ...sg, p: at(a), q: at(b), len: b - a });
    }
  }
  for (let i = all.length - 1; i >= 0; i -= 1) if (all[i].len < minLen * 1.4) all.splice(i, 1);
  const sampleMask = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < H && mask[yi * W + xi] ? 1 : 0;
  };
  const carsPx = vehicles.map((v) => ({ x: ((v.x + v.w / 2) / 100) * W, y: ((v.y + v.h / 2) / 100) * H }));

  const rows = [];
  for (const dir of dirs) {
    const members = all.filter((s) => angleDiff(s.angle, dir) <= 7);
    const theta = (median(members.map((s) => ((s.angle - dir + 90 + 180) % 180) - 90)) + dir) * Math.PI / 180;
    const ux = Math.cos(theta), uy = Math.sin(theta); // along the dividers
    const px = -uy, py = ux; // along the row
    const divs = members.map((s) => {
      const a = s.p.x * ux + s.p.y * uy, b = s.q.x * ux + s.q.y * uy;
      const m = mid(s);
      return { v0: Math.min(a, b), v1: Math.max(a, b), u: m.x * px + m.y * py, len: s.len };
    });
    // Row bands: dividers overlapping along their length and sharing an end.
    const parent = divs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < divs.length; i += 1) {
      for (let j = i + 1; j < divs.length; j += 1) {
        const a = divs[i], b = divs[j];
        const L = Math.min(a.len, b.len);
        const overlap = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
        if (overlap < 0.6 * L) continue;
        if (Math.abs(a.v0 - b.v0) < 0.2 * L || Math.abs(a.v1 - b.v1) < 0.2 * L) parent[find(i)] = find(j);
      }
    }
    const bands = new Map();
    divs.forEach((d, i) => { const r = find(i); if (!bands.has(r)) bands.set(r, []); bands.get(r).push(d); });
    // Rows inside a band, from paint coverage: at each depth step, how many of
    // the band's dividers have paint there. A row is a stretch where many do;
    // an aisle is where none do. A long painted line across the band (the line
    // between the two halves of a double row) also ends a row. This holds up
    // when worn paint breaks every divider into short pieces.
    const Lall = median(divs.map((d) => d.len));
    const rowLines = all.filter((sg) => angleDiff(sg.angle, (dir + 90) % 180) <= 10 && sg.len >= Lall * 1.5).map((sg) => {
      const u0 = sg.p.x * px + sg.p.y * py, u1 = sg.q.x * px + sg.q.y * py;
      return { v: mid(sg).x * ux + mid(sg).y * uy, u0: Math.min(u0, u1), u1: Math.max(u0, u1) };
    });
    const split = [];
    for (const band of bands.values()) {
      if (band.length < 3) continue;
      // Pieces with the same position along the row are one divider.
      const sorted = [...band].sort((a2, b2) => a2.u - b2.u);
      const dividers = [];
      for (const d of sorted) {
        const last = dividers[dividers.length - 1];
        if (last && d.u - last.u < Lall * 0.15) { last.pieces.push(d); last.u = (last.u * (last.pieces.length - 1) + d.u) / last.pieces.length; } else dividers.push({ u: d.u, pieces: [d] });
      }
      if (dividers.length < 3) continue;
      const vmin = Math.floor(Math.min(...band.map((d) => d.v0))), vmax = Math.ceil(Math.max(...band.map((d) => d.v1)));
      const cover = new Float32Array(vmax - vmin + 1);
      for (const dv of dividers) {
        const hit = new Uint8Array(cover.length);
        for (const pc of dv.pieces) for (let v = Math.max(vmin, Math.floor(pc.v0)); v <= Math.min(vmax, Math.ceil(pc.v1)); v += 1) hit[v - vmin] = 1;
        hit.forEach((h, k) => { cover[k] += h; });
      }
      // Lines across the band cut the coverage there.
      const bu0 = dividers[0].u, bu1 = dividers[dividers.length - 1].u;
      const lineHere = new Float32Array(cover.length);
      for (const l of rowLines) {
        const k = Math.round(l.v) - vmin;
        if (k < 0 || k >= cover.length) continue;
        lineHere[k] += Math.max(0, Math.min(l.u1, bu1) - Math.max(l.u0, bu0));
      }
      const need = Math.max(2, dividers.length * 0.35);
      const runs = [];
      let start = -1;
      for (let k = 0; k <= cover.length; k += 1) {
        const lineCut = k < cover.length && (lineHere[k] + (lineHere[k - 1] || 0) + (lineHere[k + 1] || 0)) > (bu1 - bu0) * 0.4;
        const on = k < cover.length && cover[k] >= need && !lineCut;
        if (on && start < 0) start = k;
        if (!on && start >= 0) { runs.push([start + vmin, k - 1 + vmin]); start = -1; }
      }
      for (const [r0, r1] of runs) {
        if (r1 - r0 < Lall * 0.6) continue;
        const members2 = band.filter((d) => Math.min(d.v1, r1) - Math.max(d.v0, r0) > (r1 - r0) * 0.2);
        if (members2.length < 3) continue;
        // Per divider position, one representative piece spanning the row.
        const reps = [];
        for (const dv of dividers) {
          const inRow = dv.pieces.filter((d) => members2.includes(d));
          if (inRow.length) reps.push({ u: dv.u, v0: r0, v1: r1, len: r1 - r0 });
        }
        const sub = reps;
        sub.v0 = r0; sub.v1 = r1;
        split.push(sub);
      }
    }
    for (const band of split) {
      if (band.length < 3) continue;
      const L = median(band.map((d) => d.len));
      band.sort((a, b) => a.u - b.u);
      // Two detections of one divider: keep the longer.
      const uniq = [];
      for (const d of band) {
        const last = uniq[uniq.length - 1];
        if (last && d.u - last.u < L * 0.12) { if (d.len > last.len) uniq[uniq.length - 1] = d; } else uniq.push(d);
      }
      const gaps = uniq.slice(1).map((d, i) => d.u - uniq[i].u).filter((g) => g > L * 0.22 && g < L * 0.95);
      if (gaps.length < 2) continue;
      // Spacing: the most common gap (median of the smallest half guards against
      // gaps containing hidden dividers).
      const sorted = [...gaps].sort((a, b) => a - b);
      const pitch = median(sorted.slice(0, Math.max(2, Math.ceil(sorted.length * 0.6))));
      // Depth from the ends most dividers agree on.
      // Depth: the band's own extent when it was cut from paint coverage,
      // otherwise where most dividers start and end.
      const v0 = band.v0 ?? median(uniq.map((d) => d.v0)), v1 = band.v1 ?? median(uniq.map((d) => d.v1));
      const inBand = (c) => {
        const v = c.x * ux + c.y * uy;
        return v > v0 - (v1 - v0) * 0.1 && v < v1 + (v1 - v0) * 0.1;
      };
      const carU = carsPx.filter(inBand).map((c) => c.x * px + c.y * py);
      // Share of the stretch a..b (along the row) covered by painted lines that
      // run along this row (its front, back or centre line).
      const rowLineCover = (a, b, rv0, rv1) => {
        const margin = (rv1 - rv0) * 0.15;
        const spans = rowLines.filter((l) => l.v >= rv0 - margin && l.v <= rv1 + margin).map((l) => [Math.max(a, l.u0), Math.min(b, l.u1)]).filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0]);
        let covered = 0, end = a;
        for (const [x, y] of spans) { if (y <= end) continue; covered += y - Math.max(x, end); end = y; }
        return b > a ? covered / (b - a) : 0;
      };
      // Runs of neighbouring dividers at the row's spacing.
      let run = [uniq[0].u];
      const runs = [];
      for (let i = 1; i < uniq.length; i += 1) {
        const a = uniq[i - 1].u, b = uniq[i].u;
        const ratio = (b - a) / pitch;
        const k = Math.round(ratio);
        const carInside = carU.some((u) => u > a && u < b);
        // A wider gap is still part of the row when a painted line runs along
        // the row across it (faint dividers); a road or island has no such line.
        const lineAcross = k <= 10 && rowLineCover(a, b, v0, v1) >= 0.75;
        const ok = k >= 1 && Math.abs(ratio - k) < 0.3 && (k <= 2 || (k === 3 && carInside) || lineAcross);
        if (ok) {
          for (let s = 1; s < k; s += 1) run.push(a + ((b - a) * s) / k);
          run.push(b);
        } else {
          runs.push(run);
          run = [b];
        }
      }
      runs.push(run);
      for (let r of runs) {
        // A car parked just past either end: its divider is hidden, add the space.
        for (let n = 0; n < 2; n += 1) {
          const lo = r[0], hi = r[r.length - 1];
          if (carU.some((u) => u < lo && u > lo - pitch * 1.05)) r = [lo - pitch, ...r];
          if (carU.some((u) => u > hi && u < hi + pitch * 1.05)) r = [...r, hi + pitch];
        }
        // The row's painted line carries on past the last divider found: the
        // dividers there are too faint, so continue the row along the line
        // (a few spaces at most).
        // It stops at an island: grass or earth ends the row (a line on the far
        // side of the island belongs to the lane, e.g. beside an arrow).
        const rr = { ux, uy, px, py };
        let goLo = true, goHi = true;
        for (let n = 0; n < 3; n += 1) {
          const lo = r[0], hi = r[r.length - 1];
          if (goLo && rowLineCover(lo - pitch, lo, v0, v1) >= 0.9 && planted(image, lo - pitch, lo, v0, v1, rr) <= 0.3) r = [lo - pitch, ...r]; else goLo = false;
          if (goHi && rowLineCover(hi, hi + pitch, v0, v1) >= 0.9 && planted(image, hi, hi + pitch, v0, v1, rr) <= 0.3) r = [...r, hi + pitch]; else goHi = false;
        }
        if (r.length < 3) continue; // fewer than two spaces: road markings, kerbs
        rows.push({ us: r, v0, v1, ux, uy, px, py, pitch, L });
      }
    }
  }

  // Which end of a row faces the aisle: beyond the back end there is usually a
  // painted line, kerb or the next row; beyond the front, open asphalt.
  const P = (u, v, r) => ({ x: v * r.ux + u * r.px, y: v * r.uy + u * r.py });
  const out = [];
  const aisles = [];
  rows.forEach((r) => {
    const depth = r.v1 - r.v0;
    const busy = (v) => {
      let n = 0, t = 0;
      for (let i = 0; i < r.us.length; i += 1) for (let f = 0.08; f <= 0.3; f += 0.055) {
        const p = P(r.us[i], v, r); t += 1; n += sampleMask(p.x, p.y);
      }
      return t ? n / t : 0;
    };
    const frontAtV0 = busy(r.v0 - depth * 0.15) <= busy(r.v1 + depth * 0.15);
    for (let i = 0; i < r.us.length - 1; i += 1) {
      const a = r.us[i], b = r.us[i + 1];
      const f = frontAtV0 ? r.v0 : r.v1, k = frontAtV0 ? r.v1 : r.v0;
      const poly = [P(a, f, r), P(b, f, r), P(b, k, r), P(a, k, r)];
      // An island edge looks like one more divider: a "space" that is mostly
      // grass or bare earth, with no car in it, is not a parking space.
      const hasCar = carsPx.some((c) => Math.abs((c.x * r.px + c.y * r.py) - (a + b) / 2) < (b - a) * 0.6 && Math.abs((c.x * r.ux + c.y * r.uy) - (r.v0 + r.v1) / 2) < (r.v1 - r.v0) * 0.6);
      if (!hasCar && planted(image, a, b, r.v0, r.v1, r) > 0.3) continue;
      out.push({ poly, row: r });
    }
    const f = frontAtV0 ? r.v0 - depth * 0.6 : r.v1 + depth * 0.6;
    aisles.push({ points: [P(r.us[0] - r.pitch, f, r), P(r.us[r.us.length - 1] + r.pitch, f, r)] });
  });

  // Overlapping spaces from two directions/bands: keep the first (larger rows first).
  const pct = (p) => ({ x: Math.round(clamp((p.x / W) * 100, 0, 100) * 100) / 100, y: Math.round(clamp((p.y / H) * 100, 0, 100) * 100) / 100 });
  const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
  const inside = (p, poly) => {
    let res = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) res = !res;
    }
    return res;
  };
  const rowSize = new Map(rows.map((r) => [r, r.us.length]));
  const accepted = [];
  for (const s of out.sort((a, b) => rowSize.get(b.row) - rowSize.get(a.row))) {
    const c = centroid(s.poly);
    if (accepted.some((t) => inside(c, t.poly) || inside(centroid(t.poly), s.poly))) continue;
    // Mostly outside the picture: not a usable space.
    if (c.x < 0 || c.y < 0 || c.x > W || c.y > H) continue;
    accepted.push(s);
  }

  // Name rows A, B, C… and number spaces along each row.
  const rowList = [...new Set(accepted.map((s) => s.row))];
  const rowCentre = new Map(rowList.map((r) => {
    const cs = accepted.filter((s) => s.row === r).map((s) => centroid(s.poly));
    return [r, { x: cs.reduce((a, p) => a + p.x, 0) / cs.length, y: cs.reduce((a, p) => a + p.y, 0) / cs.length }];
  }));
  rowList.sort((a, b) => rowCentre.get(a).y - rowCentre.get(b).y || rowCentre.get(a).x - rowCentre.get(b).x);
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
  const stalls = [];
  rowList.forEach((row, ri) => {
    const L2 = letter(ri);
    const along = (s) => { const c = centroid(s.poly); return c.x * row.px + c.y * row.py; };
    accepted.filter((s) => s.row === row).sort((a, b) => along(a) - along(b)).forEach((s, i) => {
      stalls.push({ id: `${L2}${i + 1}-${Math.random().toString(36).slice(2, 7)}`, row: L2, index: i + 1, label: `${L2}${i + 1}`, poly: s.poly.map(pct), auto: true });
    });
  });
  return {
    stalls,
    aisles: aisles.map((a, i) => ({ id: `auto-aisle-${i}`, points: a.points.map(pct), auto: true })),
    debug: { points: points.length, directions: dirs, segments: all.length, rows: rows.length },
    segments: all.map((s) => ({ p: pct(s.p), q: pct(s.q) })),
  };
}

// Both finders together: the row finder first (exact on regular rows); the
// line-pair finder fills in where the row finder found nothing (angled /
// herringbone rows, odd shapes). A line-pair space overlapping a row space is
// dropped.
export function findStallsCombined(image, opts = {}) {
  const rows = findStallsByRows(image, opts);
  const pairs = findStalls(image, opts);
  const centre = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
  const inside = (p, poly) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  // Pixel-sampled overlap (percent space), enough to spot a clash.
  const clash = (a, b) => {
    if (inside(centre(a.poly), b.poly) || inside(centre(b.poly), a.poly)) return true;
    let hit = 0;
    for (const p of a.poly) if (inside(p, b.poly)) hit += 1;
    return hit >= 2;
  };
  const kept = [...rows.stalls];
  const rowLetters = new Set(kept.map((s) => s.row));
  const rename = new Map();
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
  let next = rowLetters.size;
  // Divider direction of a space: its side edge (front corner -> back corner).
  const sideAngle = (st) => {
    const a = st.poly[0], d = st.poly[3];
    return ((Math.atan2(d.y - a.y, d.x - a.x) * 180) / Math.PI + 180) % 180;
  };
  const rowDirs = rows.debug.directions || [];
  const candidates = pairs.stalls.filter((s) => {
    if (kept.some((k) => clash(s, k))) return false;
    // Where regular rows were found, the line-pair finder only adds spaces of a
    // different orientation (an angled section); in the same orientation it
    // mostly picks up kerbs and cut-off rows the row finder rightly rejected.
    return !(rows.stalls.length && rowDirs.some((d) => angleDiff(sideAngle(s), d) < 15));
  });
  // A real angled section is a row of spaces; a lone odd-angled "space" next to
  // regular rows is a piece of kerb.
  const perRow = new Map();
  candidates.forEach((c) => perRow.set(c.row, (perRow.get(c.row) || 0) + 1));
  for (const s of candidates) {
    if (rows.stalls.length && (perRow.get(s.row) || 0) < 3) continue;
    if (!rename.has(s.row)) rename.set(s.row, letter(next++));
    const row = rename.get(s.row);
    kept.push({ ...s, row, label: `${row}${s.index}`, id: `${row}${s.index}-${Math.random().toString(36).slice(2, 7)}` });
  }
  return {
    stalls: kept,
    aisles: rows.aisles.length ? rows.aisles : pairs.aisles,
    debug: { rows: rows.debug.rows + pairs.debug.rows, rowFinder: rows.stalls.length, lineFinder: kept.length - rows.stalls.length },
    segments: rows.segments,
  };
}
