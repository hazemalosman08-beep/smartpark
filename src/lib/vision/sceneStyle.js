// Turns the camera picture into a clean, illustrated map of everything it
// shows: buildings, islands, grass, roads, paint. Nothing is drawn by hand —
// every pixel is sorted into a surface type and repainted in the map's colours,
// so whatever the camera sees (a building beside the lot, a road, trees) shows
// up in the driver's map.

// Map palette (matches the dark driver display).
const PAL = {
  pave: [[24, 31, 38], [30, 38, 46], [37, 46, 55], [46, 56, 66]], // dark -> light pavement
  grass: [[22, 58, 40], [30, 74, 50]],
  tree: [16, 46, 32],
  earth: [70, 55, 38],
  paint: [150, 160, 172],
  none: [11, 16, 20],
};

/** Pure pixel step (testable without a browser): RGBA in, RGBA out. */
export function stylizePixels(data, W, H) {
  const N = W * H;
  const cls = new Uint8Array(N); // 0 none, 1 pave, 2 grass, 3 tree, 4 earth, 5 paint, 6 built
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = L;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    if (data[i * 4 + 3] < 128 || mx < 8) cls[i] = 0; // outside the picture (warp edges)
    else if (g > r + 6 && g > b + 6) cls[i] = L < 70 ? 3 : 2;
    else if (r > b + 22 && g > b + 8 && r - g < 45 && sat > 0.18) cls[i] = 4;
    else if (sat < 0.16 || (b > r && sat < 0.3)) cls[i] = L > 175 ? 5 : 1;
    else cls[i] = 6;
  }
  // Clean up speckle: each pixel takes the most common class around it
  // (counted with one running-sum table per class, so a wide window is cheap).
  const r = Math.max(2, Math.round(Math.max(W, H) / 170));
  const W1 = W + 1;
  const sums = Array.from({ length: 7 }, () => new Uint32Array(W1 * (H + 1)));
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const c = cls[y * W + x];
    for (let k = 0; k < 7; k += 1) {
      const t = sums[k];
      t[(y + 1) * W1 + x + 1] = t[y * W1 + x + 1] + t[(y + 1) * W1 + x] - t[y * W1 + x] + (k === c ? 1 : 0);
    }
  }
  const box = (t, x0, y0, x1, y1) => t[y1 * W1 + x1] - t[y0 * W1 + x1] - t[y1 * W1 + x0] + t[y0 * W1 + x0];
  const clean = new Uint8Array(N);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const own = cls[y * W + x];
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
    // Thin paint stays (lines are narrow); other classes follow the majority.
    if (own === 5 && box(sums[5], Math.max(0, x - 1), Math.max(0, y - 1), Math.min(W, x + 2), Math.min(H, y + 2)) >= 3) { clean[y * W + x] = 5; continue; }
    let best = own === 5 ? 1 : own, bestN = box(sums[best], x0, y0, x1, y1);
    for (let c = 0; c < 7; c += 1) {
      if (c === 5) continue;
      const n = box(sums[c], x0, y0, x1, y1);
      if (n > bestN * 1.15) { best = c; bestN = n; }
    }
    clean[y * W + x] = best;
  }
  // Pavement brightness, smoothed and posterised into a few tones (patches,
  // shade and different surfaces stay visible, noise does not).
  const smooth = boxBlur(lum, W, H, 3);
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i += 1) {
    const c = clean[i];
    let col;
    if (c === 0) col = PAL.none;
    else if (c === 1) col = PAL.pave[Math.max(0, Math.min(3, Math.floor((smooth[i] - 60) / 40)))];
    else if (c === 2) col = PAL.grass[smooth[i] > 120 ? 1 : 0];
    else if (c === 3) col = PAL.tree;
    else if (c === 4) col = PAL.earth;
    else if (c === 5) col = PAL.paint;
    else {
      // Buildings, roofs, brick: keep their hue, flattened and dimmed.
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const q = (v) => Math.round((v * 0.55 + 18) / 16) * 16;
      col = [q(r), q(g), q(b)];
    }
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
  }
  // Outline where one surface meets another (kerbs, building edges, islands).
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x, c = clean[i];
    if (c === 5 || c === 0) continue;
    const edge = [clean[i - 1], clean[i + 1], clean[i - W], clean[i + W]].some((n) => n !== c && n !== 5 && n !== 0 && !(c === 2 && n === 3) && !(c === 3 && n === 2));
    if (edge) for (let k = 0; k < 3; k += 1) out[i * 4 + k] = Math.min(255, out[i * 4 + k] * 0.6 + 70);
  }
  return out;
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    let s = 0, n = 0;
    for (let x = -r; x < W; x += 1) {
      if (x + r < W) { s += src[y * W + x + r]; n += 1; }
      if (x - r - 1 >= 0) { s -= src[y * W + x - r - 1]; n -= 1; }
      if (x >= 0) tmp[y * W + x] = s / n;
    }
  }
  for (let x = 0; x < W; x += 1) {
    let s = 0, n = 0;
    for (let y = -r; y < H; y += 1) {
      if (y + r < H) { s += tmp[(y + r) * W + x]; n += 1; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * W + x]; n -= 1; }
      if (y >= 0) out[y * W + x] = s / n;
    }
  }
  return out;
}

/** Browser: picture URL -> URL of the illustrated map image. */
export async function stylizeScene(url, maxSide = 900) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale)), H = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const styled = stylizePixels(data, W, H);
  ctx.putImageData(new ImageData(styled, W, H), 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return URL.createObjectURL(blob);
}
