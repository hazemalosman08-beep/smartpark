// Helpers for virtual vehicle IDs and parking sessions.
// A vehicle location is only ever confirmed, estimated or unknown — an estimate
// is never presented as confirmed.

export const LOCATION_STATUS = {
  confirmed: {
    label: "Confirmed",
    border: "border-green-500/40",
    bg: "bg-green-500/10",
    text: "text-green-300",
    dot: "bg-green-400",
  },
  estimated: {
    label: "Estimated",
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/10",
    text: "text-yellow-300",
    dot: "bg-yellow-400",
  },
  unknown: {
    label: "Unknown",
    border: "border-neutral-600",
    bg: "bg-neutral-800/60",
    text: "text-neutral-300",
    dot: "bg-neutral-400",
  },
};

// A short, human-readable temporary ID such as SP-1042.
export function makeVehicleId(existing = []) {
  const taken = new Set(existing.filter(Boolean));
  // Sequential temporary IDs: the first vehicle on the lot is SP-001.
  for (let n = 1; n <= 999; n += 1) {
    const candidate = `SP-${String(n).padStart(3, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `SP-${String(Date.now()).slice(-4)}`;
}

export function formatDuration(from, to = Date.now()) {
  if (!from) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatClock(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function zoneOf(label) {
  const match = String(label || "").match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : "";
}

export function occupiedLabels(sessions = []) {
  return new Set(
    sessions.filter((s) => s.status === "active" && s.spot_label).map((s) => String(s.spot_label))
  );
}

// Guidance only recommends a space that no other active session already holds.
export function recommendFreeSpot(spots = [], sessions = []) {
  const taken = occupiedLabels(sessions);
  const free = spots.filter(
    (s) => s.status === "free" && s.label && !taken.has(String(s.label))
  );
  if (!free.length) return null;
  return [...free].sort((a, b) => {
    const da = 100 - (Number(a.y) || 0) + Math.abs((Number(a.x) || 0) - 50) * 0.5;
    const db = 100 - (Number(b.y) || 0) + Math.abs((Number(b.x) || 0) - 50) * 0.5;
    return da - db;
  })[0];
}