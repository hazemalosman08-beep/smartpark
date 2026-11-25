import { base44 } from "@/api/base44Client";
import { readVehicleAppearance } from "@/lib/vehicleAppearance";
import scanFrameFile from "@/lib/scanFrameFile";

// Scan the exact frozen frame. Native vision coordinates are converted on the
// server, and vehicle body centers anchor the displayed IDs.
let preciseScan = true;
export async function detectVehiclesWithAI({ source, width, height }) {
  if (!source || !width || !height) return [];
  const observedAt = Date.now();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not read the camera frame");
  const file = new File([blob], `frame-${Date.now()}.jpg`, { type: "image/jpeg" });
  const { file_uri, file_url } = await scanFrameFile(file);
  let response = null;
  if (preciseScan) {
    response = await base44.functions.invoke("scanVehicles", { file_uri }).catch((err) => {
      // An older deployment without the center-based scanner: use it from now on.
      if (err?.response?.status === 404) preciseScan = false;
      return null;
    });
  }
  if (!response) {
    response = await base44.functions
      .invoke("analyzeParkingFrame", { file_uri, file_url, width, height, cars_only: true })
      .catch((err) => {
        throw new Error(err?.response?.data?.error || err?.message || "Vehicle detection failed");
      });
  }
  const data = response?.data;
  if (!Array.isArray(data?.cars)) {
    throw new Error(data?.error || "Vehicle detection returned no result");
  }
  return data.cars
    .filter((car) => car.w > 0 && car.h > 0)
    .map((car) => ({
      label: car.label || "car",
      x: car.x,
      y: car.y,
      w: car.w,
      h: car.h,
      score: car.confidence ?? 0.7,
      detector: "vision",
      observed_at: observedAt,
      appearance: readVehicleAppearance(canvas, width, height, car),
    }));
}