// One click to fill a missed row of spaces.
//
// 1. Local search: the picture around the click is searched for painted
//    dividers on its own (a close-up has more contrast than the whole lot),
//    and the row of spaces under the click is taken.
// 2. Otherwise a template: the nearest mapped space gives the size and the
//    angle; a space is placed at the click and the row is extended both ways
//    while painted lines (or a parked car) continue, up to the picture edge or
//    an existing space.
import { findStallsByRows, paintMask } from "./stallFinder.js";
import { nextRowLetter, stallIoU } from "./lot.js";

const centre = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const inside = (p, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};

/**
 * image: { data, width, height } camera pixels (a sharp copy helps);
 * click: { x, y } camera %; stalls: existing (camera %); vehicles: camera %.
 * Returns { stalls: new spaces (camera %), method: "lines" | "template" | null }.
 */
export function fillRowAt(image, click, stalls = [], vehicles = []) {
  const { width: W, height: H } = image;
  // A click on a space that is already mapped: nothing is missing there.
  if (stalls.some((s) => inside(click, s.poly))) return { stalls: [], method: null };
  const toPx = (p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H });
  const toPct = (p) => ({ x: Math.round((p.x / W) * 10000) / 100, y: Math.round((p.y / H) * 10000) / 100 });
  const c = toPx(click);
  // Template: the mapped space nearest the click.
  const near = stalls.map((s) => ({ s, d: Math.hypot(centre(s.poly.map(toPx)).x - c.x, centre(s.poly.map(toPx)).y - c.y) })).sort((a, b) => a.d - b.d)[0]?.s;
  const tq = near ? near.poly.map(toPx) : null;
  const tw = tq ? Math.hypot(tq[1].x - tq[0].x, tq[1].y - tq[0].y) : Math.min(W, H) / 14;
  const td = tq ? Math.hypot(tq[3].x - tq[0].x, tq[3].y - tq[0].y) : tw * 2;
  const isNew = (poly) => stalls.every((s) => stallIoU(s, { poly }) < 0.2 && !inside(centre(poly), s.poly) && !inside(centre(s.poly), poly));

  // 1. Local search around the click.
  const half = Math.max(tw * 9, td * 2.2);
  const x0 = Math.max(0, Math.floor(c.x - half)), x1 = Math.min(W, Math.ceil(c.x + half));
  const y0 = Math.max(0, Math.floor(c.y - half)), y1 = Math.min(H, Math.ceil(c.y + half));
  if (x1 - x0 > 40 && y1 - y0 > 40) {
    const cw = x1 - x0, ch = y1 - y0;
    const data = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y += 1) data.set(image.data.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x1) * 4), y * cw * 4);
    const cropCars = vehicles.map((v) => ({ ...v, x: ((v.x / 100) * W - x0) / cw * 100, y: ((v.y / 100) * H - y0) / ch * 100, w: (v.w / 100) * W / cw * 100, h: (v.h / 100) * H / ch * 100 }));
    let found = [];
    try { found = findStallsByRows({ data, width: cw, height: ch }, { vehicles: cropCars }).stalls; } catch { found = []; }
    const back = (p) => toPct({ x: x0 + (p.x / 100) * cw, y: y0 + (p.y / 100) * ch });
    const local = found.map((s) => ({ ...s, poly: s.poly.map(back) }));
    // The row under the click (or the one whose spaces come closest to it).
    let row = local.find((s) => inside(click, s.poly))?.row;
    if (!row && local.length) {
      const best = local.map((s) => ({ s, d: Math.hypot(centre(s.poly).x - click.x, centre(s.poly).y - click.y) })).sort((a, b) => a.d - b.d)[0];
      if (best && best.d < (td / H) * 100 * 0.8) row = best.s.row;
    }
    if (row) {
      const fresh = local.filter((s) => s.row === row && isNew(s.poly));
      // Same size as the lot's spaces (a close-up can mistake two for one).
      const sizeOk = (poly) => {
        const q = poly.map(toPx);
        const w = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
        return !tq || (w > tw * 0.55 && w < tw * 1.8);
      };
      const good = fresh.filter((s) => sizeOk(s.poly));
      if (good.length) {
        // Seeds found by the close-up; the row is then followed both ways
        // along its painted lines (bollards and posts can cut a row in two).
        const seeds = good.map((s) => s.poly.map(toPx));
        const grown = grow(seeds, { image, vehicles, existing: stalls, toPct, click: c });
        return { stalls: name(grown.map((q) => q.map(toPct)), stalls), method: "lines" };
      }
    }
  }

  // 2. Template from the nearest space, placed at the click.
  if (!tq) return { stalls: [], method: null };
  const ux = (tq[1].x - tq[0].x) / tw, uy = (tq[1].y - tq[0].y) / tw;
  const nx = (tq[3].x - tq[0].x) / td, ny = (tq[3].y - tq[0].y) / td;
  const at = (cx, cy) => {
    const p0 = { x: cx - ux * tw / 2 - nx * td / 2, y: cy - uy * tw / 2 - ny * td / 2 };
    return [p0, { x: p0.x + ux * tw, y: p0.y + uy * tw }, { x: p0.x + ux * tw + nx * td, y: p0.y + uy * tw + ny * td }, { x: p0.x + nx * td, y: p0.y + ny * td }];
  };
  const ev = evidence(image, vehicles, tw);
  // Snap along the row so the dividers sit on painted lines.
  let best = at(c.x, c.y), bestScore = -1;
  for (let k = -tw / 2; k <= tw / 2; k += Math.max(1, tw / 16)) {
    const q = at(c.x + ux * k, c.y + uy * k);
    const score = ev.line(q[0], q[3]) + ev.line(q[1], q[2]);
    if (score > bestScore) { bestScore = score; best = q; }
  }
  if (!best.every((p) => p.x >= -1 && p.y >= -1 && p.x <= W + 1 && p.y <= H + 1) || !isNew(best.map(toPct))) return { stalls: [], method: null };
  const grown = grow([best], { image, vehicles, existing: stalls, toPct, click: c, ev });
  return { stalls: name(grown.map((q) => q.map(toPct)), stalls), method: "template" };
}

// Painted-line evidence along a segment, and whether a car stands in a cell.
function evidence(image, vehicles, width) {
  const { width: W, height: H } = image;
  let mask = null;
  try { mask = paintMask(image, { vehicles }); } catch { mask = null; }
  const r = Math.max(1, Math.round(width * 0.08));
  const near = (x, y) => {
    if (!mask) return false;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) return true;
    }
    return false;
  };
  return {
    line: (a, b) => {
      let hit = 0;
      for (let k = 1; k <= 8; k += 1) { const t = 0.15 + (0.7 * k) / 9; if (near(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) hit += 1; }
      return hit / 8;
    },
    car: (q) => vehicles.some((v) => inside({ x: ((v.x + v.w / 2) / 100) * W, y: ((v.y + v.h / 2) / 100) * H }, q)),
  };
}

// Extend a row (cells in pixels) both ways, one space at a time, while the
// next divider is painted (or a car stands there), up to the picture edge or
// an existing space; the clicked spot is always included.
function grow(seeds, { image, vehicles, existing, toPct, click, ev = null }) {
  const { width: W, height: H } = image;
  const q0 = seeds[0];
  const w = Math.hypot(q0[1].x - q0[0].x, q0[1].y - q0[0].y);
  const ux = (q0[1].x - q0[0].x) / w, uy = (q0[1].y - q0[0].y) / w;
  const e = ev || evidence(image, vehicles, w);
  const along = (q) => { const c = centre(q); return c.x * ux + c.y * uy; };
  const cells = [...seeds].sort((a, b) => along(a) - along(b));
  const shift = (q, k) => q.map((p) => ({ x: p.x + ux * w * k, y: p.y + uy * w * k }));
  const visible = (q) => q.every((p) => p.x >= -1 && p.y >= -1 && p.x <= W + 1 && p.y <= H + 1);
  const free = (q) => {
    const pct = q.map(toPct);
    return existing.every((s) => stallIoU(s, { poly: pct }) < 0.2 && !inside(centre(pct), s.poly) && !inside(centre(s.poly), pct))
      && cells.every((o) => Math.hypot(centre(o).x - centre(q).x, centre(o).y - centre(q).y) > w * 0.6);
  };
  const clickAlong = click.x * ux + click.y * uy;
  for (const dir of [1, -1]) {
    let edge = dir > 0 ? cells[cells.length - 1] : cells[0];
    for (let k = 0; k < 40; k += 1) {
      const q = shift(edge, dir);
      if (!visible(q) || !free(q)) break;
      const towardClick = dir > 0 ? along(q) <= clickAlong + w * 0.5 : along(q) >= clickAlong - w * 0.5;
      const painted = dir > 0 ? e.line(q[1], q[2]) : e.line(q[0], q[3]);
      if (!towardClick && painted < 0.4 && !e.car(q)) break;
      cells.push(q);
      edge = q;
    }
  }
  return cells;
}

// New spaces become one row, numbered along it; marked as set by hand so a
// later automatic search keeps them.
function name(polys, existing) {
  if (!polys.length) return [];
  const row = nextRowLetter(existing);
  const d = Math.atan2(polys[0][1].y - polys[0][0].y, polys[0][1].x - polys[0][0].x);
  const along = (poly) => { const c = centre(poly); return c.x * Math.cos(d) + c.y * Math.sin(d); };
  return [...polys].sort((a, b) => along(a) - along(b)).map((poly, i) => ({
    id: `${row}${i + 1}-f${Math.random().toString(36).slice(2, 7)}`, row, index: i + 1, label: `${row}${i + 1}`, poly,
    confidence: 0.9, sources: ["fill"],
  }));
}
