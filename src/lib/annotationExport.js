// Export the current lot map as a training annotation
// (format "smartpark-annotation/v1", read by tools/spacemodel).
//
// Every space becomes a polygon in pixel coordinates of the original picture,
// with its type, occupancy, where it came from and its confidence. Spaces the
// user drew, filled or fixed are marked `corrected`: they are the most
// valuable labels for the next training round.

export const ANNOTATION_FORMAT = "smartpark-annotation/v1";

const SOURCE = (s) => (s.sources?.includes("fill") ? "fill" : !s.auto ? "hand" : s.learned ? "car" : s.sources?.[0] === "model" ? "model" : "lines");

/**
 * calibration: SmartPark calibration (stalls in camera %);
 * statuses: Map(stallId -> {status}); image: { dataUrl, width, height, fileName };
 * lotId: stable name of the lot (all pictures of one lot share it).
 */
export function buildAnnotation({ calibration, statuses, image, lotId, cars = [] }) {
  const px = (p) => [Math.round((p.x / 100) * image.width * 10) / 10, Math.round((p.y / 100) * image.height * 10) / 10];
  return {
    format: ANNOTATION_FORMAT,
    lot_id: String(lotId || "unnamed-lot").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60),
    created_at: new Date().toISOString(),
    view: calibration.view || "angled",
    image: { file_name: image.fileName || "picture.jpg", width: image.width, height: image.height, data_url: image.dataUrl },
    spaces: calibration.stalls.map((s) => {
      const st = statuses?.get?.(s.id);
      const source = SOURCE(s);
      return {
        id: s.id,
        label: s.label,
        row: s.row,
        polygon: s.poly.map(px),
        kind: s.kind || "normal",
        occupied: st ? st.status === "occupied" : null,
        source,
        confidence: s.confidence ?? null,
        corrected: source === "hand" || source === "fill",
      };
    }),
    // Cars seen, for reference (boxes in pixels).
    cars: cars.map((v) => ({ bbox: [px({ x: v.x, y: v.y }), px({ x: v.x + v.w, y: v.y + v.h })].flat(), vehicle_id: v.vehicle_id || null })),
    entrance: calibration.entrance ? px(calibration.entrance) : null,
    buildings: [calibration.building, ...(calibration.buildings || [])].filter(Boolean).map((b) => ({ point: px(b), name: b.name || null })),
  };
}

/** The picture shown (image, video frame or camera) at full resolution, as a JPEG data URL. */
export function captureMedia(el, fileName) {
  const width = el.videoWidth || el.naturalWidth || el.width;
  const height = el.videoHeight || el.naturalHeight || el.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(el, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.95), width, height, fileName };
}

export function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
