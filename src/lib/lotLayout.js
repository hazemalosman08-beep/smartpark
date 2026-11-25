// The mapped lot is saved so the driver view can draw the same map the operator
// calibrated, without needing the camera.
import { base44 } from "@/api/base44Client";

const NAME = "Main lot";

export async function saveLotLayout({ spots = [], streets = [], zones = [], entrance = null }) {
  const layout = {
    spots: spots
      .filter((spot) => spot.label && Number.isFinite(spot.x) && Number.isFinite(spot.y))
      .map((spot) => ({
        label: String(spot.label),
        x: Math.round(spot.x * 10) / 10,
        y: Math.round(spot.y * 10) / 10,
      })),
    streets,
    zones,
    entrance,
  };
  if (!layout.spots.length) return null;

  const payload = {
    name: NAME,
    layout: JSON.stringify(layout),
    spot_count: layout.spots.length,
    zone_count: zones.length,
  };

  const existing = await base44.entities.LotLayout.filter({ name: NAME }, { limit: 1 });
  const current = existing.items?.[0];
  if (current) return base44.entities.LotLayout.update(current.id, payload);
  return base44.entities.LotLayout.create(payload);
}

export async function loadLotLayout() {
  const page = await base44.entities.LotLayout.filter({ name: NAME }, { limit: 1 });
  const record = page.items?.[0];
  if (!record?.layout) return null;
  try {
    const parsed = JSON.parse(record.layout);
    return {
      spots: Array.isArray(parsed.spots) ? parsed.spots : [],
      streets: Array.isArray(parsed.streets) ? parsed.streets : [],
      zones: Array.isArray(parsed.zones) ? parsed.zones : [],
      entrance: parsed.entrance || null,
    };
  } catch {
    return null;
  }
}