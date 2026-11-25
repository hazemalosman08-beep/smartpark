// Sparse pyramidal optical flow. Multiple corners must agree in BOTH directions;
// a single patch matching a similar piece of background is not movement evidence.
const SIDE = 480;
const RADIUS = 2;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function makeFlowFrame(source, width, height, at = Date.now()) {
  const scale = Math.min(1, SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const levels = [{ gray, w: canvas.width, h: canvas.height }];
  while (levels.length < 3) {
    const previous = levels[levels.length - 1];
    const w = Math.floor(previous.w / 2), h = Math.floor(previous.h / 2);
    if (w < 12 || h < 12) break;
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const p = y * 2 * previous.w + x * 2;
      next[y * w + x] = (previous.gray[p] + previous.gray[p + 1] + previous.gray[p + previous.w] + previous.gray[p + previous.w + 1]) / 4;
    }
    levels.push({ gray: next, w, h });
  }
  return { ...levels[0], levels, at };
}

function pixel(frame, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const p = iy * frame.w + ix;
  return frame.gray[p] * (1 - fx) * (1 - fy) + frame.gray[p + 1] * fx * (1 - fy) + frame.gray[p + frame.w] * (1 - fx) * fy + frame.gray[p + frame.w + 1] * fx * fy;
}
const inside = (frame, x, y) => x >= 4 && y >= 4 && x < frame.w - 5 && y < frame.h - 5;

export function vehicleFeatures(frame, box) {
  const left = Math.max(4, Math.ceil((box.x + box.w * 0.12) / 100 * frame.w));
  const right = Math.min(frame.w - 6, Math.floor((box.x + box.w * 0.88) / 100 * frame.w));
  const top = Math.max(4, Math.ceil((box.y + box.h * 0.12) / 100 * frame.h));
  const bottom = Math.min(frame.h - 6, Math.floor((box.y + box.h * 0.88) / 100 * frame.h));
  const corners = [];
  for (let y = top; y <= bottom; y += 2) for (let x = left; x <= right; x += 2) {
    let a = 0, b = 0, c = 0;
    for (let j = -1; j <= 1; j += 1) for (let i = -1; i <= 1; i += 1) {
      const p = (y + j) * frame.w + x + i;
      const gx = (frame.gray[p + 1] - frame.gray[p - 1]) / 2;
      const gy = (frame.gray[p + frame.w] - frame.gray[p - frame.w]) / 2;
      a += gx * gx; b += gx * gy; c += gy * gy;
    }
    const score = (a + c - Math.sqrt((a - c) ** 2 + 4 * b * b)) / 2;
    if (score > 90) corners.push({ x, y, score });
  }
  corners.sort((a, b) => b.score - a.score);
  const points = [];
  for (const point of corners) {
    if (points.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 4)) points.push(point);
    if (points.length === 16) break;
  }
  return points;
}

function followPoint(from, to, point) {
  let dx = 0, dy = 0;
  for (let level = from.levels.length - 1; level >= 0; level -= 1) {
    const a = from.levels[level], b = to.levels[level], scale = 2 ** level;
    const x = point.x / scale, y = point.y / scale;
    if (!inside(a, x, y)) continue;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const nx = x + dx / scale, ny = y + dy / scale;
      if (!inside(b, nx, ny)) return null;
      let meanA = 0, meanB = 0;
      for (let j = -RADIUS; j <= RADIUS; j += 1) for (let i = -RADIUS; i <= RADIUS; i += 1) {
        meanA += pixel(a, x + i, y + j); meanB += pixel(b, nx + i, ny + j);
      }
      const brightness = (meanA - meanB) / 25;
      let aa = 0, ab = 0, bb = 0, ex = 0, ey = 0;
      for (let j = -RADIUS; j <= RADIUS; j += 1) for (let i = -RADIUS; i <= RADIUS; i += 1) {
        const gx = (pixel(a, x + i + 1, y + j) - pixel(a, x + i - 1, y + j)) / 2;
        const gy = (pixel(a, x + i, y + j + 1) - pixel(a, x + i, y + j - 1)) / 2;
        const error = pixel(a, x + i, y + j) - pixel(b, nx + i, ny + j) - brightness;
        aa += gx * gx; ab += gx * gy; bb += gy * gy; ex += gx * error; ey += gy * error;
      }
      const determinant = aa * bb - ab * ab;
      if (determinant < 1) break;
      const ux = (bb * ex - ab * ey) / determinant, uy = (aa * ey - ab * ex) / determinant;
      if (!Number.isFinite(ux + uy) || Math.hypot(ux, uy) > 4) return null;
      dx += ux * scale; dy += uy * scale;
      if (Math.hypot(ux, uy) < 0.025) break;
    }
  }
  if (!inside(to, point.x + dx, point.y + dy)) return null;
  let error = 0, mean = 0;
  for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) mean += pixel(from, point.x + i, point.y + j) - pixel(to, point.x + dx + i, point.y + dy + j);
  mean /= 25;
  for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) error += Math.abs(pixel(from, point.x + i, point.y + j) - pixel(to, point.x + dx + i, point.y + dy + j) - mean);
  return error / 25 <= 18 ? { x: point.x + dx, y: point.y + dy, dx, dy } : null;
}

export function vehicleFlow(from, to, points) {
  if (!from || from.w !== to.w || from.h !== to.h || points.length < 4) return null;
  const matches = [];
  for (const point of points) {
    const next = followPoint(from, to, point);
    if (!next) continue;
    const back = followPoint(to, from, next);
    if (!back || Math.hypot(back.x - point.x, back.y - point.y) > 0.75) continue;
    matches.push(next);
  }
  if (matches.length < 4 || matches.length < points.length * 0.5) return null;
  const dx = median(matches.map((point) => point.dx)), dy = median(matches.map((point) => point.dy));
  const deviations = matches.map((point) => Math.hypot(point.dx - dx, point.dy - dy));
  const tolerance = Math.max(0.65, median(deviations) * 2.5);
  const inliers = matches.filter((point, index) => deviations[index] <= tolerance);
  if (inliers.length < 4 || inliers.length < matches.length * 0.6) return null;
  return { dx: median(inliers.map((point) => point.dx)), dy: median(inliers.map((point) => point.dy)), points: inliers, quality: inliers.length / points.length };
}