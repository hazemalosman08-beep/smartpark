import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

export const IMAGE_PART_SIZE = 12000;
export const MAX_IMAGE_CHARS = 110000;
const PHONE_CAMERA_URL = "https://spectacular-park-vision-live.base44.app/phone-camera";

export function makePairCode() {
  const pin = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
  return `${crypto.randomUUID()}~${appParams.functionsVersion || ""}~${pin}~${crypto.randomUUID()}`;
}

export function parsePairCode(input) {
  const raw = String(input || "").trim();
  if (raw.includes("?")) {
    const query = new URLSearchParams(raw.slice(raw.indexOf("?") + 1));
    const room = query.get("room") || "";
    return { room, version: query.get("fv") ?? "", pin: "", owner: "" };
  }
  const [room, version = appParams.functionsVersion || "", pin = "", owner = ""] = raw.replace(/\s/g, "").split("~");
  return { room, version, pin, owner };
}

export function pairingFromLocation() {
  const query = new URLSearchParams(window.location.search);
  const room = query.get("room");
  return room ? `${room}~${query.get("fv") ?? ""}` : "";
}

export function pairingLink(code) {
  const { room, version } = parsePairCode(code);
  const link = new URL(PHONE_CAMERA_URL);
  link.searchParams.set("room", room);
  link.searchParams.set("fv", version);
  return link.toString();
}

// Both devices meet in the camera room of the app's PUBLISHED deployment, so a
// computer working in a preview and a phone on the live app still share one room.
// No authentication credentials enter links.
export function cameraClient(code, onError) {
  return createClient({
    appId: appParams.appId,
    token: appParams.token,
    functionsVersion: "",
    appBaseUrl: appParams.appBaseUrl,
    serverUrl: "https://base44.app",
    analytics: { enabled: false },
    // Use the same transport on both devices. Auto selection is per device and
    // may send one through the proxy while the other connects directly.
    options: { onError, actorsTransport: "proxy" },
  });
}

export function captureCameraImage(source, width, height, { maxSize = 960, maxChars = MAX_IMAGE_CHARS, quality = 0.75 } = {}) {
  const canvas = document.createElement("canvas");
  let scale = Math.min(1, maxSize / Math.max(width, height));
  let data;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= maxChars) return { data, width: canvas.width, height: canvas.height };
    scale *= 0.8;
  }
  throw new Error("Could not prepare this camera frame");
}

export function sendCameraImage(room, kind, data) {
  const id = crypto.randomUUID();
  const total = Math.ceil(data.length / IMAGE_PART_SIZE);
  for (let index = 0; index < total; index += 1) {
    room.send({ type: "image_part", kind, id, index, total, data: data.slice(index * IMAGE_PART_SIZE, (index + 1) * IMAGE_PART_SIZE) });
  }
  return id;
}