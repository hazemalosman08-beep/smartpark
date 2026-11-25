import { detectYoloVehicles, loadYoloDetector } from "@/lib/yoloVehicleDetector";
import { occupancyFromVehicles } from "@/lib/occupancy";

export const loadCarDetector = loadYoloDetector;

// Recognition is independent of parking-space calibration or lot boundaries.
export async function detectVehicles({ source, width, height }) {
  return detectYoloVehicles({
    source,
    width: width || source?.videoWidth || source?.naturalWidth || source?.width || 0,
    height: height || source?.videoHeight || source?.naturalHeight || source?.height || 0,
  });
}

// Combine two car finders without double-counting the same vehicle.
export function mergeCars(primary = [], extra = []) {
  const kept = [];
  // Precise object detections keep priority over supplemental proposals.
  for (const car of [...[...primary].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), ...[...extra].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))]) {
    const duplicate = kept.some((other) => {
      const ix = Math.max(0, Math.min(car.x + car.w, other.x + other.w) - Math.max(car.x, other.x));
      const iy = Math.max(0, Math.min(car.y + car.h, other.y + other.h) - Math.max(car.y, other.y));
      const intersection = ix * iy;
      if (intersection <= 0) return false;
      const area = car.w * car.h;
      const otherArea = other.w * other.h;
      return intersection / (area + otherArea - intersection) > 0.45 ||
        (Math.min(area, otherArea) / Math.max(area, otherArea) > 0.5 && intersection / Math.min(area, otherArea) > 0.8);
    });
    if (!duplicate) kept.push(car);
  }
  return kept;
}

// Every view reads the same pairing of stalls and vehicles, so the map, the grid
// and the totals can never disagree about which spaces are taken.
export function occupancyFromCars(cells, cars) {
  return occupancyFromVehicles(cells, cars);
}