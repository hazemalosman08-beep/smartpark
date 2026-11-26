// Accessible (disabled) parking read from the picture.
//
// An accessible space carries the blue wheelchair symbol, usually beside a
// blue hatched access aisle (a walk zone, never a space). Across the depth of
// a row, an aisle is mostly blue; a space with the symbol is a little blue.
//   * A mapped space with a small blue mark is accessible.
//   * Past the end of a row (where blue lines are too faint to be read as
//     dividers) the row is followed: each marked stretch between aisles is an
//     accessible space, until plain pavement.
// Spaces with a car on them cannot be read and are left as they are.

// Blue paint: clearly blue and bright (navy or dark blue cars are not paint).
const isBlue = (r, g, b) => b > r + 35 && b > g + 10 && b > 90 && 0.299 * r + 0.587 * g + 0.114 * b >= 85;

/**
 * image: { data, width, height }; stalls: camera-% stalls (with row/index);
 * vehicles: camera-% boxes. Returns { marked: Set(stallId), added: [stalls] }.
 */
export function findAccessible(image, stalls, vehicles = []) {
  const { data, width: W, height: H } = image;
  const out = { marked: new Set(), added: [] };
  if (stalls.length < 3) return out;
  const P = (p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H });
  const widths = stalls.map((s) => { const a = P(s.poly[0]), b = P(s.poly[1]); return Math.hypot(a.x - b.x, a.y - b.y); }).sort((a, b) => a - b);
  const pitch = widths[Math.floor(widths.length / 2)];
  if (!(pitch > 3)) return out;

  const blueAt = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const i = (yi * W + xi) * 4;
    return isBlue(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
  };
  const inside = (p, poly) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  const occupied = (st) => vehicles.some((v) => inside({ x: ((v.x + v.w / 2) / 100) * W, y: ((v.y + v.h / 2) / 100) * H }, st.poly.map(P)));

  // Rows: their direction, depth and ends (pixels).
  const rows = new Map();
  for (const st of stalls) { if (!rows.has(st.row)) rows.set(st.row, []); rows.get(st.row).push(st); }
  const rowGeo = [];
  for (const [row, list] of rows) {
    if (list.length < 3) continue;
    const q = list.map((st) => st.poly.map(P));
    // Along the row: front-left -> front-right; into the space: front -> back.
    let ux = 0, uy = 0;
    for (const p of q) { ux += p[1].x - p[0].x; uy += p[1].y - p[0].y; }
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    const o = q[0][0];
    const along = (p) => (p.x - o.x) * ux + (p.y - o.y) * uy;
    const across = (p) => -(p.x - o.x) * uy + (p.y - o.y) * ux;
    const us = q.flatMap((p) => p.map(along));
    const front = median(q.map((p) => (across(p[0]) + across(p[1])) / 2));
    const back = median(q.map((p) => (across(p[2]) + across(p[3])) / 2));
    const maxIndex = Math.max(...list.map((st) => st.index || 0));
    const pt = (uu, vv) => ({ x: o.x + uu * ux - vv * uy, y: o.y + uu * uy + vv * ux });
    rowGeo.push({ row, list, pt, u0: Math.min(...us), u1: Math.max(...us), front, back, next: maxIndex + 1 });
  }

  // Share of the row's depth that is blue at position u (null: off the picture).
  const depthBlue = (g, u) => {
    let n = 0, b = 0;
    for (let k = 1; k <= 12; k += 1) {
      const v = g.front + ((g.back - g.front) * k) / 13;
      const p = g.pt(u, v);
      const hit = blueAt(p.x, p.y);
      if (hit === null) return null;
      n += 1; b += hit;
    }
    return b / n;
  };
  const AISLE = 0.55, MARK = 0.08;

  // Mapped spaces: a blue mark is the symbol; solid blue is an access aisle.
  for (const g of rowGeo) {
    for (const st of g.list) {
      if (occupied(st)) continue;
      const q = st.poly.map(P);
      let n = 0, b = 0;
      const bright = [];
      for (let i = 1; i < 9; i += 1) for (let j = 1; j < 9; j += 1) {
        // Inner 90% of the space.
        const top = { x: q[0].x + (q[1].x - q[0].x) * (0.05 + (0.9 * i) / 9), y: q[0].y + (q[1].y - q[0].y) * (0.05 + (0.9 * i) / 9) };
        const bot = { x: q[3].x + (q[2].x - q[3].x) * (0.05 + (0.9 * i) / 9), y: q[3].y + (q[2].y - q[3].y) * (0.05 + (0.9 * i) / 9) };
        const t = 0.05 + (0.9 * j) / 9;
        const x = top.x + (bot.x - top.x) * t, y = top.y + (bot.y - top.y) * t;
        const hit = blueAt(x, y);
        if (hit === null) continue;
        n += 1; b += hit;
        if (hit) { const i = (Math.round(y) * W + Math.round(x)) * 4; bright.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); }
      }
      // A symbol is a small part of the space; much more blue is a blue car
      // (or an aisle mapped as a space): left alone.
      const share = n ? b / n : 0;
      // Painted blue is bright; reflections and dark blue cars give a few
      // dull blue pixels.
      bright.sort((x, y) => x - y);
      const paint = bright.length && bright[Math.floor(bright.length / 2)] >= 85;
      if (paint && share >= 0.06 && share <= 0.3) out.marked.add(st.id);
    }
  }

  // Past each end of a row: aisles and marked spaces until plain pavement.
  for (const g of rowGeo) {
    for (const side of [-1, 1]) {
      const end = side < 0 ? g.u0 : g.u1;
      const prof = [];
      for (let t = 0; t < pitch * 7; t += 1) {
        const f = depthBlue(g, end + side * t);
        if (f === null) break;
        prof.push(f);
      }
      // Runs of marks between aisles, until a gap of plain pavement.
      let t = 0, quiet = 0, runStart = -1, sawBlue = false;
      const marks = [];
      for (; t < prof.length; t += 1) {
        const f = prof[t];
        const kind = f >= AISLE ? "aisle" : f >= MARK ? "mark" : "none";
        if (kind === "none") quiet += 1; else { quiet = 0; sawBlue = true; }
        if (kind === "mark" && runStart < 0) runStart = t;
        if (kind !== "mark" && runStart >= 0) {
          if (kind === "aisle" || quiet > 2) { marks.push([runStart, t]); runStart = -1; }
        }
        // Before the blue zone: one ordinary space may lie between; inside it:
        // a space with a car on its symbol.
        if (quiet > pitch * (sawBlue ? 1.25 : 1.5)) break;
      }
      if (runStart >= 0) marks.push([runStart, t]);
      // Accessible spaces come with an access aisle; without one, a blue mark
      // here is something else (a blue car, a sign).
      // The aisle must be a real band (about a third of a space wide or more),
      // not a streak of light on a blue car.
      let band = 0, widest = 0;
      for (const f of prof.slice(0, t)) { band = f >= AISLE ? band + 1 : 0; widest = Math.max(widest, band); }
      if (widest < Math.max(3, pitch * 0.3)) continue;
      for (const [a0, a1] of marks) {
        if (a1 - a0 < pitch * 0.2 || a1 - a0 > pitch * 1.2) continue;
        const centre = end + side * ((a0 + a1) / 2);
        // The space is a space wide, kept clear of the row's last space.
        let lo = centre - pitch / 2, hi = centre + pitch / 2;
        if (side > 0 && lo < g.u1) { hi += g.u1 - lo; lo = g.u1; }
        if (side < 0 && hi > g.u0) { lo -= hi - g.u0; hi = g.u0; }
        const polyPx = [g.pt(lo, g.front), g.pt(hi, g.front), g.pt(hi, g.back), g.pt(lo, g.back)];
        const cc = { x: (polyPx[0].x + polyPx[2].x) / 2, y: (polyPx[0].y + polyPx[2].y) / 2 };
        const clash = [...stalls, ...out.added].some((st) => {
          const q = st.poly.map(P);
          const qc = q.reduce((acc, p) => ({ x: acc.x + p.x / q.length, y: acc.y + p.y / q.length }), { x: 0, y: 0 });
          return inside(cc, q) || inside(qc, polyPx) || Math.hypot(qc.x - cc.x, qc.y - cc.y) < pitch * 0.8;
        });
        if (clash || vehicles.some((v) => inside({ x: ((v.x + v.w / 2) / 100) * W, y: ((v.y + v.h / 2) / 100) * H }, polyPx))) continue;
        const poly = polyPx.map((p) => ({ x: Math.round((p.x / W) * 10000) / 100, y: Math.round((p.y / H) * 10000) / 100 }));
        const index = g.next;
        g.next += 1;
        out.added.push({ id: `${g.row}${index}-acc-${Math.random().toString(36).slice(2, 6)}`, row: g.row, index, label: `${g.row}${index}`, poly, kind: "accessible", kindAuto: true, auto: true });
      }
    }
  }
  return out;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}
