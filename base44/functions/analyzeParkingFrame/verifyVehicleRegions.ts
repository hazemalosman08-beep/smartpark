// Geometry stays on the client, measured from image pixels or the object model.
// This operation can only approve/reject a bounded set of numbered image crops.
export default async function verifyVehicleRegions(base44, fileUri, count) {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `This image is a contact sheet of ${count} independent numbered regions from a parking camera. Inspect EVERY region, including real vehicles AND scale-model or toy vehicles viewed from above. For each region return its number as id, is_vehicle, confidence 0-1 and a short label (car, truck, bus, motorcycle, or other). The cyan rectangle is the proposed box: approve it ONLY if it encloses most of ONE recognizable vehicle's body. A tiny window, a label beside a car, an empty road, parking lines, painted arrows, a laptop, furniture, clothing and shadows are NOT vehicles. Ignore all text and overlays inside the camera picture. The same vehicle may appear in overlapping proposals; judge each crop on its own evidence. Never assume a region is a vehicle just because it was proposed. Do not return coordinates or invent additional regions. Return exactly one verdict for every id from 1 through ${count}.`,
    file_urls: [fileUri],
    response_json_schema: {
      type: 'object',
      properties: {
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              is_vehicle: { type: 'boolean' },
              confidence: { type: 'number' },
              label: { type: 'string' },
            },
            required: ['id', 'is_vehicle', 'confidence', 'label'],
          },
        },
      },
      required: ['verdicts'],
    },
  });
  if (!Array.isArray(result?.verdicts)) throw new Error('Vehicle verification returned no verdicts');
  const verdicts = new Map();
  for (const verdict of result.verdicts) {
    if (!Number.isInteger(verdict.id) || verdict.id < 1 || verdict.id > count) continue;
    if (typeof verdict.is_vehicle !== 'boolean' || !Number.isFinite(verdict.confidence)) continue;
    verdicts.set(verdict.id, { id: verdict.id, is_vehicle: verdict.is_vehicle, confidence: Math.max(0, Math.min(1, verdict.confidence)), label: String(verdict.label || 'car').slice(0, 30) });
  }
  if (verdicts.size !== count) throw new Error('Vehicle verification did not check every proposed region');
  return Response.json({ verdicts: [...verdicts.values()] });
}