// Keeps the last lot photo on this device (IndexedDB), so after a reload the
// photo comes back together with the lot map drawn on it.
const DB = "smartpark-photo";
const STORE = "photo";
const KEY = "last";

function open(db = DB) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(db, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn, dbName = DB) {
  const db = await open(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// key: "last" (the camera picture) or "site" (the site map's aerial picture).
export const savePhoto = (blob, key = KEY) => run("readwrite", (s) => s.put(blob, key)).catch(() => {});
export const loadPhoto = (key = KEY) => run("readonly", (s) => s.get(key)).catch(() => null);
export const clearPhoto = (key = KEY) => run("readwrite", (s) => s.delete(key)).catch(() => {});

// The same, in another database (kept when the app starts clean): pictures
// of the campus lots' live feeds.
export function pictureStore(dbName) {
  return {
    save: (key, blob) => run("readwrite", (s) => s.put(blob, key), dbName).catch(() => {}),
    load: (key) => run("readonly", (s) => s.get(key), dbName).catch(() => null),
    remove: (key) => run("readwrite", (s) => s.delete(key), dbName).catch(() => {}),
  };
}
