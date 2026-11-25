const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Vision returns native 0-1000 normalized measurements, NOT image pixels.
// Convert that scale exactly once; labels use the vehicle center, not a box edge.
export default async function locateVehicleCenters(base44, frameUri) {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `Find EVERY individually visible physical vehicle in this photograph, including real vehicles AND toy or scale-model cars, SUVs, vans, pickups, trucks, buses and motorcycles. Include small, dark, white, partly hidden and frame-edge vehicles when identifiable. Inspect the whole photograph from top to bottom, left to right, then check again for missed cars. Distinct adjacent vehicles each need their own entry. Ignore people, painted symbols, arrows, parking lines, shadows, reflections and any existing SP codes or rectangles; existing annotations are not evidence.

Use your native NORMALIZED 0-1000 coordinate system, NOT pixels and NOT percentages. The full photograph runs x=0 at its left edge to x=1000 at its right edge, y=0 at its top edge to y=1000 at its bottom edge, regardless of its pixel dimensions.

For each vehicle return center_x and center_y at the center of the VISIBLE VEHICLE BODY/ROOF, never at a stall center, gap or text label. Return width and height as the vehicle body's extent on that same 0-1000 scale, NOT its bottom-right edge and NOT its parking-space size. Include a short label, color and confidence 0-1. For example, a center halfway across and a quarter down is center_x=500, center_y=250. Return exactly ONE entry per physical vehicle, never one entry around a group. Do not infer vehicles from empty stalls. Return an empty cars array only if no identifiable vehicles are visible.`,
    file_urls: [frameUri],
    response_json_schema: {
      type: 'object',
      properties: {
        cars: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              center_x: { type: 'number', description: 'Vehicle body center x, normalized 0-1000' },
              center_y: { type: 'number', description: 'Vehicle body center y, normalized 0-1000' },
              width: { type: 'number', description: 'Body width on the normalized 0-1000 scale' },
              height: { type: 'number', description: 'Body height on the normalized 0-1000 scale' },
              label: { type: 'string' }, color: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['center_x', 'center_y', 'width', 'height', 'label', 'color', 'confidence'],
          },
        },
      },
      required: ['cars'],
    },
  });
  if (!Array.isArray(result?.cars)) throw new Error('Vehicle scan returned no vehicle inventory');
  const cars = [];
  for (const car of result.cars.slice(0, 160)) {
    if (![car.center_x, car.center_y, car.width, car.height, car.confidence].every(Number.isFinite)) continue;
    if (car.width <= 0 || car.height <= 0 || car.confidence < 0.35 || car.center_x < 0 || car.center_x > 1000 || car.center_y < 0 || car.center_y > 1000) continue;
    const cx = clamp(car.center_x / 10, 0.05, 99.95);
    const cy = clamp(car.center_y / 10, 0.05, 99.95);
    const w = Math.min(car.width / 10, 2 * cx, 2 * (100 - cx));
    const h = Math.min(car.height / 10, 2 * cy, 2 * (100 - cy));
    cars.push({ x: cx - w / 2, y: cy - h / 2, w, h, label: String(car.label || 'car').slice(0, 30), confidence: clamp(car.confidence, 0, 1) });
  }
  // Only nearly identical center points can be duplicates. Large, overlapping
  // extents must not erase a separate neighboring car as rectangle-IoU did.
  const unique = [];
  for (const car of cars.sort((a, b) => b.confidence - a.confidence)) {
    if (!unique.some((other) =>
      Math.abs(car.x + car.w / 2 - other.x - other.w / 2) < Math.min(car.w, other.w) * 0.2 &&
      Math.abs(car.y + car.h / 2 - other.y - other.h / 2) < Math.min(car.h, other.h) * 0.2
    )) unique.push(car);
  }
  return unique.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
}