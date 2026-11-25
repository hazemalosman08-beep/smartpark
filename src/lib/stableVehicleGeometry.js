const geometry = ({ x, y, w, h }) => ({ x, y, w, h });
const center = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

// Correct a poor first measurement instead of locking its size indefinitely.
// Small stationary noise stays inside a deadband; real movement follows the
// observation immediately, with only light smoothing on the measured size.
export default function stableVehicleGeometry(track, car, singleFrame = false) {
  if (singleFrame) return geometry(car);
  const from = center(track), to = center(car);
  const still = Math.abs(to.x - from.x) < Math.max(0.15, track.w * 0.04) && Math.abs(to.y - from.y) < Math.max(0.15, track.h * 0.04);
  const w = Math.abs(car.w / track.w - 1) < 0.08 ? track.w : track.w * 0.55 + car.w * 0.45;
  const h = Math.abs(car.h / track.h - 1) < 0.08 ? track.h : track.h * 0.55 + car.h * 0.45;
  const point = still ? from : to;
  return {
    x: Math.max(0, Math.min(100 - w, point.x - w / 2)),
    y: Math.max(0, Math.min(100 - h, point.y - h / 2)), w, h,
    geometry_detector: car.detector || "vision",
    pending_size: null,
  };
}