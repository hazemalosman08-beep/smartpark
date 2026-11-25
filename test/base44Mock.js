// Test-only stand-in for the Base44 client (no network).
const store = new Map();
let id = 1;
const entity = (name) => {
  if (!store.has(name)) store.set(name, []);
  const rows = store.get(name);
  return {
    filter: async (q = {}) => ({ items: rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)) }),
    list: async () => ({ items: rows }),
    create: async (data) => { const r = { id: String(id++), ...data }; rows.push(r); return r; },
    bulkCreate: async (list) => list.map((data) => { const r = { id: String(id++), ...data }; rows.push(r); return r; }),
    update: async (rid, data) => { const r = rows.find((x) => x.id === rid); Object.assign(r || {}, data); return r; },
    bulkUpdate: async (list) => list.map((c) => { const r = rows.find((x) => x.id === c.id); Object.assign(r || {}, c); return r; }),
  };
};
export const base44 = {
  entities: new Proxy({}, { get: (_, name) => entity(name) }),
  functions: { invoke: async () => { throw new Error("Cloud functions are not available in the test harness"); } },
  integrations: { Core: {} },
  auth: { me: async () => ({ id: "u1", role: "admin" }) },
};
window.__base44Store = store;
