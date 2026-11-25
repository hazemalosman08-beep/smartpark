import { vehicleAppearanceDistance } from "@/lib/vehicleAppearance";

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const overlap = (a, b) => {
  const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area / Math.max(0.001, a.w * a.h + b.w * b.h - area);
};

// Solve the whole frame together. Greedy nearest-neighbour matching can steal
// the correct track from the next car when two cars pass or boxes change order.
function assignment(costs) {
  const rows = costs.length;
  const cols = costs[0]?.length || 0;
  const u = Array(rows + 1).fill(0), v = Array(cols + 1).fill(0);
  const p = Array(cols + 1).fill(0), way = Array(cols + 1).fill(0);
  for (let i = 1; i <= rows; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minimum = Array(cols + 1).fill(Infinity), used = Array(cols + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= cols; j += 1) {
        if (used[j]) continue;
        const cost = costs[i0 - 1][j - 1] - u[i0] - v[j];
        if (cost < minimum[j]) { minimum[j] = cost; way[j] = j0; }
        if (minimum[j] < delta) { delta = minimum[j]; j1 = j; }
      }
      for (let j = 0; j <= cols; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minimum[j] -= delta;
      }
      j0 = j1;
    } while (p[j0]);
    do { const next = way[j0]; p[j0] = p[next]; j0 = next; } while (j0);
  }
  const result = [];
  for (let j = 1; j <= cols; j += 1) if (p[j]) result.push([p[j] - 1, j - 1]);
  return result;
}

export default function associateVehicles(tracks, cars, now) {
  const trackTaken = new Map(), carTaken = new Set();
  if (!tracks.length || !cars.length) return { trackTaken, carTaken };
  const costs = tracks.map((track, trackIndex) => {
    const last = track.last_detection || track;
    const from = center(last);
    return [
      ...cars.map((car) => {
        const to = center(car);
        const elapsed = Math.max(0, Math.min(10, ((car.observed_at || now) - (track.observed_at || track.last_seen)) / 1000));
        const predicted = { x: from.x + (track.velocity_x || 0) * elapsed, y: from.y + (track.velocity_y || 0) * elapsed };
        const gap = Math.min(distance(from, to), distance(predicted, to));
        const reach = Math.max(4, Math.hypot(last.w, last.h) * 1.4);
        const ratio = car.w * car.h / Math.max(0.001, last.w * last.h);
        const appearance = vehicleAppearanceDistance(track.appearance, car.appearance);
        if (gap > reach || ratio < 0.3 || ratio > 3.3 || (appearance !== null && appearance > 0.42)) return 1000;
        return 0.55 * gap / reach + 0.25 * (1 - overlap(last, car)) + (appearance === null ? 0 : 1.5 * appearance) + 0.12 * Math.abs(Math.log(ratio));
      }),
      // Each track can explicitly remain unmatched instead of stealing a car.
      ...tracks.map((_, i) => 1.25 + Math.abs(trackIndex - i) * 0.000001),
    ];
  });
  for (const [trackIndex, carIndex] of assignment(costs)) {
    if (carIndex >= cars.length || costs[trackIndex][carIndex] >= 1.25) continue;
    const gap = distance(center(tracks[trackIndex]), center(cars[carIndex]));
    trackTaken.set(trackIndex, { trackIndex, carIndex, gap, cost: costs[trackIndex][carIndex] });
    carTaken.add(carIndex);
  }
  return { trackTaken, carTaken };
}