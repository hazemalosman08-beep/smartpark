// Simulated parking lot: builds a realistic lot layout and moves cars in/out
// over time so the driver screen runs live without a camera. Every simulated car
// carries a temporary visual ID, so the same label follows it in every view.

import { makeVehicleId } from "@/lib/vehicleSessions";

export function buildLot(rows = 2, cols = 6) {
  const spots = [];
  const taken = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const occupied = Math.random() < 0.6;
      let vehicle_id = "";
      if (occupied) {
        vehicle_id = makeVehicleId(taken);
        taken.push(vehicle_id);
      }
      spots.push({
        id: `sim-${r}-${c}`,
        label: `${String.fromCharCode(65 + r)}${c + 1}`,
        x: ((c + 0.5) / cols) * 100,
        y: ((r + 0.5) / rows) * 100,
        status: occupied ? "occupied" : "free",
        vehicle_id,
      });
    }
  }
  return spots;
}

// One tick: either a car pulls into a free spot or one leaves.
export function stepLot(spots) {
  if (!spots.length) return spots;
  const free = spots.filter((s) => s.status === "free");
  const taken = spots.filter((s) => s.status === "occupied");
  const arriving = free.length > 0 && (!taken.length || Math.random() < 0.55);
  const pool = arriving ? free : taken;
  if (!pool.length) return spots;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const vehicle_id = arriving
    ? makeVehicleId(spots.map((s) => s.vehicle_id).filter(Boolean))
    : "";
  return spots.map((s) =>
    s.id === pick.id
      ? { ...s, status: arriving ? "occupied" : "free", vehicle_id }
      : s
  );
}

// Free spot closest to the entrance (bottom-center of the frame).
export function recommendSpot(spots = []) {
  const free = spots.filter((s) => s.status === "free");
  if (!free.length) return null;
  return [...free].sort((a, b) => {
    const da = 100 - a.y + Math.abs(a.x - 50) * 0.5;
    const db = 100 - b.y + Math.abs(b.x - 50) * 0.5;
    return da - db;
  })[0];
}