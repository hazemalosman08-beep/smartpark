// Parking spaces in a satellite / aerial picture of a lot.
//
// From above, a lot is rows of short bright painted lines repeating at a
// fixed spacing (one space wide). That is measured directly, no training:
//   1. bright thin marks: each pixel minus its neighbourhood (top-hat);
//   2. the direction of the lines: the strongest gradient directions; the
//      picture is turned so the dividing lines stand upright;
//   3. the spacing: where along each pixel row the marks repeat (the
//      autocorrelation peak over the whole picture);
//   4. rows of spaces: bands of pixel rows where marks repeat at that
//      spacing; a double row (back to back) is split at its back line;
//   5. the dividing lines in each band (peaks of the band's column sums);
//      a space between each pair of neighbouring lines one spacing apart.
// Spaces come back as polygons in picture percent (x, y 0..100), front
// edge first, like the other finders.

function grayOf({ data, width, height }) {
  const g = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let s = 0, n = 0;
    for (let x = -r; x < w + r; x += 1) {
      if (x + r < w && x + r >= 0) { s += src[y * w + x + r]; n += 1; }
      if (x - r - 1 >= 0 && x - r - 1 < w) { s -= src[y * w + x - r - 1]; n -= 1; }
      if (x >= 0 && x < w) tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let s = 0, n = 0;
    for (let y = -r; y < h + r; y += 1) {
      if (y + r < h && y + r >= 0) { s += tmp[(y + r) * w + x]; n += 1; }
      if (y - r - 1 >= 0 && y - r - 1 < h) { s -= tmp[(y - r - 1) * w + x]; n -= 1; }
      if (y >= 0 && y < h) out[y * w + x] = s / n;
    }
  }
  return out;
}

// The two dominant line directions (radians, 0..PI), from gradients of the marks.
function lineAngles(r, w, h) {
  const bins = new Float32Array(90);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    const gx = r[i + 1] - r[i - 1], gy = r[i + w] - r[i - w];
    const m = gx * gx + gy * gy;
    if (m < 50) continue;
    // A line runs across its gradient.
    let a = Math.atan2(gy, gx) + Math.PI / 2;
    a = ((a % Math.PI) + Math.PI) % Math.PI;
    bins[Math.floor((a / Math.PI) * 90) % 90] += Math.sqrt(m);
  }
  const sm = bins.map((_, i) => bins[(i + 89) % 90] + 2 * bins[i] + bins[(i + 1) % 90]);
  let best = 0;
  for (let i = 1; i < 90; i += 1) if (sm[i] > sm[best]) best = i;
  const a1 = ((best + 0.5) / 90) * Math.PI;
  return [a1, (a1 + Math.PI / 2) % Math.PI];
}

// The marks turned so lines at `angle` stand upright (nearest sampling).
function rotated(r, w, h, angle) {
  const t = angle - Math.PI / 2; // turn the line direction to vertical
  const c = Math.cos(t), s = Math.sin(t);
  const W = Math.ceil(Math.abs(w * c) + Math.abs(h * s)), H = Math.ceil(Math.abs(w * s) + Math.abs(h * c));
  const out = new Float32Array(W * H);
  const cx = w / 2, cy = h / 2, CX = W / 2, CY = H / 2;
  for (let Y = 0; Y < H; Y += 1) for (let X = 0; X < W; X += 1) {
    // Rotated -> original: rotate back by t.
    const dx = X - CX, dy = Y - CY;
    const x = Math.round(cx + dx * c - dy * s), y = Math.round(cy + dx * s + dy * c);
    if (x >= 0 && x < w && y >= 0 && y < h) out[Y * W + X] = r[y * w + x];
    else out[Y * W + X] = -1; // outside the picture
  }
  const back = (X, Y) => { const dx = X - CX, dy = Y - CY; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; };
  return { R: out, W, H, back };
}

// Autocorrelation of row y at lag L (mean-removed, only inside the picture).
function rowCorr(R, W, y, L, mean) {
  let s = 0, n = 0;
  const o = y * W;
  for (let x = 0; x + L < W; x += 1) {
    const a = R[o + x], b = R[o + x + L];
    if (a < 0 || b < 0) continue;
    s += (a - mean) * (b - mean); n += 1;
  }
  return n > 20 ? s / n : 0;
}

function findInRotation(R, W, H, { minP, maxP }) {
  let sum = 0, cnt = 0;
  for (let i = 0; i < R.length; i += 1) if (R[i] >= 0) { sum += R[i]; cnt += 1; }
  const mean = cnt ? sum / cnt : 0;
  // 3. The spacing: summed autocorrelation over sampled rows; the first strong peak.
  const lagScore = new Float32Array(maxP + 2);
  const step = Math.max(1, Math.floor(H / 160));
  for (let L = minP; L <= maxP + 1; L += 1) for (let y = 0; y < H; y += step) lagScore[L] += Math.max(0, rowCorr(R, W, y, L, mean));
  let P = 0, best = 0;
  for (let L = minP + 1; L <= maxP; L += 1) {
    if (lagScore[L] >= lagScore[L - 1] && lagScore[L] >= lagScore[L + 1] && lagScore[L] > best * 1.15) { best = lagScore[L]; P = L; }
  }
  if (!P) return { P: 0, stalls: [], score: 0 };
  // 4. Rows of spaces, per stretch along the rows (sections of a lot can be
  // offset): in each stretch, how strongly the marks fall on the same comb
  // (one position every P pixels) along a pixel row. Painted dividers line
  // up exactly; cracks, cars and kerbs do not.
  const win = Math.max(6 * P, 40), stepX = Math.max(2, Math.floor(win / 2));
  const starts = [];
  for (let xs = 0; xs + win <= W; xs += stepX) starts.push(xs);
  if (!starts.length) starts.push(0);
  const comb = starts.map(() => new Float32Array(H));
  const all = [];
  starts.forEach((xs, wi) => {
    for (let y = 0; y < H; y += 1) {
      let best = -Infinity, tot = 0, cnt = 0;
      for (let ph = 0; ph < P; ph += 1) {
        let c = 0, n = 0;
        for (let x = xs + ph; x < xs + win && x < W; x += P) { const v = R[y * W + x]; if (v < 0) { n = 0; break; } c += v; n += 1; }
        if (!n) continue;
        c /= n; tot += c; cnt += 1;
        if (c > best) best = c;
      }
      comb[wi][y] = cnt ? Math.max(0, best - tot / cnt) : 0;
    }
    const m = comb[wi];
    const sm = m.map((_, y) => (m[Math.max(0, y - 1)] + m[y] + m[Math.min(H - 1, y + 1)]) / 3);
    comb[wi] = sm;
    for (const v of sm) all.push(v);
  });
  // Threshold between "comb" and "no comb" (Otsu on the values).
  const sorted = all.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length < 20) return { P, stalls: [], score: 0 };
  const hist = new Float64Array(64), hi = sorted[Math.floor(sorted.length * 0.995)] || 1;
  for (const v of sorted) hist[Math.min(63, Math.floor((v / hi) * 63))] += 1;
  let wB = 0, sumB = 0, total = sorted.length, sumAll = 0, thrBin = 0, bestVar = -1;
  for (let i = 0; i < 64; i += 1) sumAll += i * hist[i];
  for (let i = 0; i < 64; i += 1) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > bestVar) { bestVar = v; thrBin = i; }
  }
  const thr = ((thrBin + 1) / 63) * hi;
  // The back line of a double row: the brightest pixel row in the middle.
  const lineAt = (xs, y0, y1) => {
    let m = Math.floor((y0 + y1) / 2), mv = -1;
    const d = y1 - y0;
    for (let y = Math.floor(y0 + d * 0.3); y <= Math.ceil(y1 - d * 0.3); y += 1) {
      let sv = 0;
      for (let x = xs; x < xs + win && x < W; x += 1) sv += Math.max(0, R[y * W + x]);
      if (sv > mv) { mv = sv; m = y; }
    }
    return m;
  };
  // Row pieces found in each stretch.
  const segs = [];
  starts.forEach((xs, wi) => {
    const m = comb[wi];
    for (let y = 0; y < H;) {
      if (m[y] < thr) { y += 1; continue; }
      let y1 = y;
      while (y1 + 1 < H && m[y1 + 1] >= thr) y1 += 1;
      const depth = y1 - y + 1;
      if (depth >= 1.2 * P && depth <= 7 * P) {
        if (depth > 3.4 * P) { const mid = lineAt(xs, y, y1); segs.push({ wi, y0: y, y1: mid, front: "top" }, { wi, y0: mid, y1, front: "bottom" }); }
        else segs.push({ wi, y0: y, y1, front: "top" });
      }
      y = y1 + 1;
    }
  });
  // One straight row from the pieces of neighbouring stretches that overlap.
  const overlap = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const groups = [];
  for (const sg of segs.sort((a, b) => a.wi - b.wi)) {
    const g = groups.find((gr) => gr.front === sg.front && sg.wi - gr.lastWi <= 2 && overlap(gr.last, sg) >= 0.5 * Math.min(sg.y1 - sg.y0, gr.last.y1 - gr.last.y0));
    if (g) { g.items.push(sg); g.last = sg; g.lastWi = sg.wi; } else groups.push({ front: sg.front, items: [sg], last: sg, lastWi: sg.wi });
  }
  const med = (v) => { const a = [...v].sort((p1, p2) => p1 - p2); return a[Math.floor(a.length / 2)]; };
  const rowsAll = groups.map((g) => ({
    front: g.front, y0: med(g.items.map((i) => i.y0)), y1: med(g.items.map((i) => i.y1)),
    x0: starts[Math.min(...g.items.map((i) => i.wi))], x1: Math.min(W, starts[Math.max(...g.items.map((i) => i.wi))] + win),
  }));
  // 5. The dividing lines along each row; a space between neighbouring lines.
  const stalls = [];
  for (const row of rowsAll) {
    const x0 = Math.max(0, row.x0 - P), x1 = Math.min(W, row.x1 + P);
    const col = new Float32Array(x1 - x0);
    for (let y = row.y0; y <= row.y1; y += 1) for (let x = x0; x < x1; x += 1) { const v = R[y * W + x]; if (v > 0) col[x - x0] += v; }
    // Compared with the neighbourhood (a row's brightness varies along it).
    const peaks = [];
    for (let i = 1; i < col.length - 1; i += 1) {
      let loc = 0, n = 0;
      for (let k = -P; k <= P; k += 1) if (i + k >= 0 && i + k < col.length) { loc += col[i + k]; n += 1; }
      if (col[i] < (loc / n) * 1.3 || col[i] < col[i - 1] || col[i] < col[i + 1]) continue;
      if (peaks.length && i - peaks[peaks.length - 1] < 0.6 * P) { if (col[i] > col[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i; continue; }
      peaks.push(i);
    }
    for (let i = 0; i + 1 < peaks.length; i += 1) {
      const gap = peaks[i + 1] - peaks[i];
      if (gap < 0.75 * P || gap > 1.35 * P) continue;
      stalls.push({ x0: x0 + peaks[i], x1: x0 + peaks[i + 1], y0: row.y0, y1: row.y1, front: row.front });
    }
  }
  // Two rows over the same ground: the spaces of the one found first stay.
  const kept = [];
  for (const st of stalls) {
    const cx = (st.x0 + st.x1) / 2, cy = (st.y0 + st.y1) / 2;
    if (kept.some((k) => cx > k.x0 && cx < k.x1 && cy > k.y0 && cy < k.y1)) continue;
    kept.push(st);
  }
  stalls.length = 0;
  stalls.push(...kept);
  // Rows (for labels): stalls with about the same y range.
  stalls.sort((p1, p2) => p1.y0 - p2.y0 || p1.x0 - p2.x0);
  return { P, stalls, score: stalls.length };
}

/**
 * pixels: { data (RGBA), width, height }. Returns { stalls: [{ poly, row, index }], spacing }.
 * minSpace / maxSpace: space width range in pixels.
 */
export function findSatelliteStalls(pixels, { minSpace = 4, maxSpace = 40 } = {}) {
  const { width: w, height: h } = pixels;
  const g = grayOf(pixels);
  const bg = boxBlur(g, w, h, Math.max(2, Math.round(Math.min(w, h) / 120)));
  const r = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) r[i] = Math.max(0, g[i] - bg[i]);
  let best = null;
  for (const a of lineAngles(r, w, h)) {
    for (const da of [0, -0.02, 0.02]) {
      const rot = rotated(r, w, h, a + da);
      const found = findInRotation(rot.R, rot.W, rot.H, { minP: minSpace, maxP: Math.min(maxSpace, Math.floor(rot.W / 4)) });
      if (!best || found.score > best.found.score) best = { rot, found };
    }
  }
  if (!best?.found.stalls.length) return { stalls: [], spacing: 0 };
  const { rot, found } = best;
  const pct = (p) => ({ x: Math.round((p.x / w) * 10000) / 100, y: Math.round((p.y / h) * 10000) / 100 });
  const rowsSeen = new Map();
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
  const stalls = [];
  for (const s of found.stalls) {
    const key = `${Math.round(s.y0 / Math.max(1, found.P / 2))}-${s.front}`;
    if (!rowsSeen.has(key)) rowsSeen.set(key, { letter: letter(rowsSeen.size), n: 0 });
    const row = rowsSeen.get(key);
    row.n += 1;
    const tl = rot.back(s.x0, s.y0), tr = rot.back(s.x1, s.y0), br = rot.back(s.x1, s.y1), bl = rot.back(s.x0, s.y1);
    // Front edge (aisle side) first: FL, FR, BR, BL.
    const poly = s.front === "top" ? [tl, tr, br, bl] : [br, bl, tl, tr];
    if (poly.some((p) => p.x < -1 || p.y < -1 || p.x > w + 1 || p.y > h + 1)) continue;
    stalls.push({ poly: poly.map(pct), row: row.letter, index: row.n });
  }
  return { stalls, spacing: found.P };
}
