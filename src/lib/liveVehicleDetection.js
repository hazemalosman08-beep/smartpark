import { detectVehicles } from "@/lib/carDetect";
import { detectVehiclesWithAI } from "@/lib/aiDetect";
import { readVehicleAppearance } from "@/lib/vehicleAppearance";

// Every published result belongs to the frame this scan actually captured.
// Never feed cached AI boxes back as another observation, or mix an old vision
// frame with a newer local frame while a request is still pending.
export function createDetectionState() {
  return { pending: null };
}

export async function detectCameraVehicles(state, frame) {
  if (state.pending) return state.pending;
  const observedAt = Date.now();
  const frozen = document.createElement("canvas");
  frozen.width = frame.width;
  frozen.height = frame.height;
  frozen.getContext("2d").drawImage(frame.source, 0, 0, frame.width, frame.height);
  const captured = { source: frozen, width: frame.width, height: frame.height };
  state.pending = (async () => {
    try {
      const cars = await detectVehiclesWithAI(captured);
      return { cars, observedSources: ["vision"], warning: null };
    } catch (visionError) {
      const cars = await detectVehicles(captured);
      return {
        cars: cars.filter((car) => (car.score ?? 0) >= 0.35).map((car) => ({
          ...car, detector: "yolo", observed_at: observedAt,
          appearance: readVehicleAppearance(frozen, frame.width, frame.height, car),
        })),
        observedSources: ["yolo"],
        warning: `AI scan unavailable (${visionError?.message || "unknown error"}). Showing the local detector for this frame.`,
      };
    } finally {
      state.pending = null;
    }
  })();
  return state.pending;
}