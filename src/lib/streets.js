// Lanes are drawn on the camera frame in percent. Directions and the map route
// follow the lane nearest the spot a driver is sent to.

export function nearestLane(streets, spot) {
  if (!streets?.length || !spot) return null;

  let best = null;
  let bestScore = Infinity;

  streets.forEach((lane, index) => {
    const centreY = lane.y + lane.h / 2;
    const insideX = spot.x >= lane.x && spot.x <= lane.x + lane.w;
    const gapX = insideX
      ? 0
      : Math.min(Math.abs(spot.x - lane.x), Math.abs(spot.x - (lane.x + lane.w)));
    const score = gapX + Math.abs(spot.y - centreY) * 0.6;

    if (score < bestScore) {
      bestScore = score;
      best = { index, lane };
    }
  });

  return best;
}