const intersects = (a, b, margin = 3) => a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Position readable labels in screen space, independently from measured boxes.
// Moving a label out of a neighbour's way must never move the vehicle's box.
export default function vehicleOverlayLayout(tracks, width, height) {
  const labels = [];
  const boxes = tracks.map((track) => ({ x: track.x / 100 * width, y: track.y / 100 * height, w: track.w / 100 * width, h: track.h / 100 * height }));
  return tracks.map((track, index) => {
    const box = boxes[index];
    const w = Math.min(width, Math.max(54, track.vehicle_id.length * 7 + 12)), h = 20;
    const x = clamp(box.x, 0, width - w);
    const candidates = [box.y - h - 4, box.y + box.h + 4, box.y + 3];
    for (let y = 0; y <= height - h; y += h + 4) candidates.push(y);
    let label = null, best = Infinity;
    for (const rawY of candidates) {
      const candidate = { x, y: clamp(rawY, 0, height - h), w, h };
      const collisions = labels.filter((other) => intersects(candidate, other)).length;
      const covering = boxes.filter((other, i) => i !== index && intersects(candidate, other, 0)).length;
      const score = collisions * 100000 + covering * 1000 + Math.abs(candidate.y - (box.y - h - 4));
      if (score < best) { best = score; label = candidate; }
      if (score === 0) break;
    }
    labels.push(label);
    return { ...track, box, label, linked: label.y + h < box.y - 8 || label.y > box.y + box.h + 8 };
  });
}