// Shared geometry for detection, tracking, stall occupancy and the top-down lot.
// Boxes are { x, y, w, h } (top-left + size). Points are { x, y }. Polygons are
// arrays of points in drawing order.

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function intersectionArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a, b) {
  const inter = intersectionArea(a, b);
  return inter ? inter / (a.w * a.h + b.w * b.h - inter) : 0;
}

// Intersection over the smaller box: catches a fragment box sitting inside a full one.
export function ios(a, b) {
  const inter = intersectionArea(a, b);
  return inter ? inter / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h)) : 0;
}

// ---------------------------------------------------------------------------
// Optimal assignment (Hungarian / Jonker-Volgenant on a rectangular cost matrix).
// Returns [row, col] pairs. Rows <= cols is not required.
export function hungarian(costs) {
  const rows = costs.length;
  const cols = costs[0]?.length || 0;
  if (!rows || !cols) return [];
  const transpose = rows > cols;
  const m = transpose ? cols : rows;
  const n = transpose ? rows : cols;
  const at = (i, j) => (transpose ? costs[j][i] : costs[i][j]);
  const u = new Float64Array(m + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = at(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const pairs = [];
  for (let j = 1; j <= n; j += 1) {
    if (!p[j]) continue;
    pairs.push(transpose ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]);
  }
  return pairs;
}

// Assignment that refuses any pair costlier than `maxCost`.
export function matchWithThreshold(costs, maxCost) {
  return hungarian(costs).filter(([r, c]) => costs[r][c] <= maxCost);
}

// ---------------------------------------------------------------------------
// Homography: maps points of one plane onto another (camera picture -> ground).

function solve(A, b) {
  // Gaussian elimination with partial pivoting.
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-12) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// 3x3 matrix (row-major, 9 numbers) mapping src[i] -> dst[i] for four point pairs.
export function homographyFromPoints(src, dst) {
  if (src?.length !== 4 || dst?.length !== 4) return null;
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function applyHomography(H, p) {
  if (!H) return { x: p.x, y: p.y };
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
}

export function invertHomography(H) {
  if (!H) return null;
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((value) => value / det);
  return inv.map((value) => value / inv[8]);
}

// ---------------------------------------------------------------------------
// Polygons

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; x += (p.x + q.x) * cross; y += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const signedArea = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

// Sutherland–Hodgman: clip `subject` by a convex `clip` polygon.
export function clipPolygon(subject, clip) {
  if (!subject.length || clip.length < 3) return [];
  const ccw = signedArea(clip) > 0;
  const insideEdge = (p, a, b) => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return ccw ? cross >= 0 : cross <= 0;
  };
  const cut = (p, q, a, b) => {
    const a1 = b.y - a.y, b1 = a.x - b.x, c1 = a1 * a.x + b1 * a.y;
    const a2 = q.y - p.y, b2 = p.x - q.x, c2 = a2 * p.x + b2 * p.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) return p;
    return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
  };
  let output = subject;
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j += 1) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      const curIn = insideEdge(cur, a, b), prevIn = insideEdge(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(cut(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) output.push(cut(prev, cur, a, b));
    }
  }
  return output;
}

export function polygonOverlapArea(a, b) {
  const clipped = clipPolygon(a, b);
  return clipped.length >= 3 ? polygonArea(clipped) : 0;
}

export const boxToPolygon = (b) => [
  { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
];

export function polygonBounds(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Distance from a point to a segment, plus the closest point and its position t.
export function projectOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: q, t, distance: dist(p, q) };
}

export function angleOf(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
