// One stall holds one vehicle and one vehicle parks in one stall, so occupancy is
// decided by pairing the two: strongest overlap first, and any vehicle the stall
// grid did not line up with takes the closest stall that is still free. That keeps
// the taken count equal to the vehicles actually seen, instead of one car's box
// claiming several stalls.
const area = (rect) => rect.w * rect.h;

const centreOf = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

const inside = (point, rect) =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

function intersection(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) : 0;
}

// A mapped stall can carry only its centre, without a measured size.
function cellRect(cell) {
  return cell.w > 0 && cell.h > 0
    ? { x: cell.x - cell.w / 2, y: cell.y - cell.h / 2, w: cell.w, h: cell.h }
    : null;
}

// How strongly a vehicle claims a stall; 0 means it does not touch it at all.
function claim(car, cell, rect) {
  const carCentre = centreOf(car);
  if (!rect) return inside(cell, car) ? 1 : 0;
  const cellCentre = centreOf(rect);
  if (!inside(cellCentre, car) && !inside(carCentre, rect) && intersection(car, rect) === 0) return 0;
  return intersection(car, rect) / area(rect) + (inside(carCentre, rect) ? 0.35 : 0);
}

const distance = (car, cell) => {
  const a = centreOf(car);
  return Math.hypot(a.x - cell.x, a.y - cell.y);
};

export function occupancyFromVehicles(cells, vehicles) {
  const list = (cells || []).map((cell) => ({ ...cell }));
  const cars = (vehicles || []).filter((car) => car && car.w > 0 && car.h > 0);
  const rects = list.map(cellRect);

  const pairs = [];
  list.forEach((cell, ci) => {
    cars.forEach((car, vi) => {
      const score = claim(car, cell, rects[ci]);
      if (score > 0) pairs.push({ ci, vi, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const parkedIn = new Map(); // stall index -> vehicle index
  const placed = new Set();
  for (const pair of pairs) {
    if (parkedIn.has(pair.ci) || placed.has(pair.vi)) continue;
    parkedIn.set(pair.ci, pair.vi);
    placed.add(pair.vi);
  }

  // A vehicle the grid did not line up with still has to appear in the count, so
  // it takes the nearest stall that no other vehicle claimed.
  cars.forEach((car, vi) => {
    if (placed.has(vi)) return;
    let target = -1;
    let nearest = Infinity;
    list.forEach((cell, ci) => {
      if (parkedIn.has(ci)) return;
      const d = distance(car, cell);
      // A car in the drive aisle is not parked in the nearest stall: only a stall
      // it is standing at counts, so empty spaces stay empty.
      const limit = cell.w > 0 ? Math.max(cell.w, cell.h) : Infinity;
      if (d > limit) return;
      if (d < nearest) {
        nearest = d;
        target = ci;
      }
    });
    if (target >= 0) {
      parkedIn.set(target, vi);
      placed.add(vi);
    }
  });

  return list.map((cell, ci) => {
    const car = parkedIn.has(ci) ? cars[parkedIn.get(ci)] : null;
    return {
      ...cell,
      status: car ? "occupied" : "free",
      confidence: car ? Math.round((car.confidence ?? car.score ?? 0.6) * 100) / 100 : null,
    };
  });
}