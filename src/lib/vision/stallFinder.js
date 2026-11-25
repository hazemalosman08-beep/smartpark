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
    // Side by side (row direction may be slanted for angled parking).
    if (along > L * 0.7 + across * 0.9) return null;
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
    rows.push({ dividers: sorted, rx, ry, px, py, ux: ref.ux, uy: ref.uy });
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
        if (across <= 0 || across > spacing * 4.5 || along > (last.len + first.len) * 0.35 + across * 0.9) continue;
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
    if (!cells.length) return;
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
