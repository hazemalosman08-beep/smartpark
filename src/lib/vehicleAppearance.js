// Small visual fingerprints stay in memory only; no licence-plate recognition.
export function readVehicleAppearance(source, width, height, box) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const x = Math.max(0, (box.x + box.w * 0.15) / 100 * width);
  const y = Math.max(0, (box.y + box.h * 0.15) / 100 * height);
  ctx.drawImage(source, x, y, Math.max(1, box.w * 0.7 / 100 * width), Math.max(1, box.h * 0.7 / 100 * height), 0, 0, 4, 4);
  return Array.from(ctx.getImageData(0, 0, 4, 4).data).filter((_, i) => i % 4 !== 3).map((value) => value / 255);
}

export function vehicleAppearanceDistance(a, b) {
  if (!a?.length || a.length !== b?.length) return null;
  const mean = (values, channel) => values.reduce((sum, value, i) => sum + (i % 3 === channel ? value : 0), 0) / (values.length / 3);
  const average = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(mean(a, channel) - mean(b, channel)), 0) / 3;
  const texture = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
  return average * 0.65 + texture * 0.35;
}

// Compare the same region in two frames, not its brightness or number of corners.
// This lets a slow recognition result survive on a parked car, including dark cars,
// without placing an old box on a vehicle that has already driven away.
export function vehicleRegionUnchanged(before, after, box) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sample = (frame) => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(frame.source,
      (box.x + box.w * 0.1) / 100 * frame.width,
      (box.y + box.h * 0.1) / 100 * frame.height,
      box.w * 0.8 / 100 * frame.width,
      box.h * 0.8 / 100 * frame.height, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 16, 16).data;
  };
  const first = sample(before);
  const second = sample(after);
  let difference = 0;
  let changed = 0;
  for (let i = 0; i < first.length; i += 4) {
    const delta = (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2])) / 3;
    difference += delta;
    if (delta > 40) changed += 1;
  }
  return difference / 256 < 22 && changed / 256 < 0.3;
}