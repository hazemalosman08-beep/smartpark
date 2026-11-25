// On-device storage for parking sessions and events (replaces the old cloud
// database). Data lives in this browser's localStorage, so it survives closing
// the app but is not shared between devices.
//
// The API mirrors what the app used before: filter / create / bulkCreate /
// update / bulkUpdate, all async, so a real backend can be swapped in later.

const PREFIX = "smartpark-db-";
const LIMITS = { ParkingSession: 500, VehicleEvent: 2000 };

function read(name) {
  try {
    const raw = window.localStorage.getItem(PREFIX + name);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function write(name, rows) {
  const limit = LIMITS[name] || 1000;
  // Keep the newest records when the store is full.
  const kept = rows.length > limit ? rows.slice(rows.length - limit) : rows;
  try {
    window.localStorage.setItem(PREFIX + name, JSON.stringify(kept));
  } catch {
    // Storage full or unavailable (private mode): drop the oldest half and retry once.
    try { window.localStorage.setItem(PREFIX + name, JSON.stringify(kept.slice(Math.floor(kept.length / 2)))); } catch { /* give up quietly */ }
  }
  window.dispatchEvent(new CustomEvent("smartpark-db-change", { detail: { name } }));
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function sortRows(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const x = a[key] ?? "", y = b[key] ?? "";
    return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
  });
}

function table(name) {
  return {
    async filter(query = {}, { sort, limit } = {}) {
      const rows = read(name).filter((r) => Object.entries(query).every(([k, v]) => r[k] === v));
      const sorted = sortRows(rows, sort);
      return { items: limit ? sorted.slice(0, limit) : sorted };
    },
    async create(data) {
      const row = { id: newId(), created_date: new Date().toISOString(), ...data };
      write(name, [...read(name), row]);
      return row;
    },
    async bulkCreate(list = []) {
      const now = new Date().toISOString();
      const created = list.map((data) => ({ id: newId(), created_date: now, ...data }));
      write(name, [...read(name), ...created]);
      return created;
    },
    async update(id, data) {
      const rows = read(name);
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, data);
      write(name, rows);
      return row || null;
    },
    async bulkUpdate(changes = []) {
      const rows = read(name);
      const byId = new Map(rows.map((r) => [r.id, r]));
      changes.forEach((c) => { const row = byId.get(c.id); if (row) Object.assign(row, c); });
      write(name, rows);
      return changes.map((c) => byId.get(c.id)).filter(Boolean);
    },
    clear() {
      write(name, []);
    },
  };
}

export const db = {
  ParkingSession: table("ParkingSession"),
  VehicleEvent: table("VehicleEvent"),
};
