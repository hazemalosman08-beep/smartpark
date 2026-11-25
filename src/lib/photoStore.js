// Keeps the last lot photo on this device (IndexedDB), so after a reload the
// photo comes back together with the lot map drawn on it.
const DB = "smartpark-photo";
const STORE = "photo";
const KEY = "last";

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const savePhoto = (blob) => run("readwrite", (s) => s.put(blob, KEY)).catch(() => {});
export const loadPhoto = () => run("readonly", (s) => s.get(KEY)).catch(() => null);
export const clearPhoto = () => run("readwrite", (s) => s.delete(KEY)).catch(() => {});
