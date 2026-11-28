// Every time the app is loaded it starts clean: no lot photo, lot map or
// satellite complex from last time (the campus map is never restored
// either). Kept: preferences (permit, driver screen), the parked car
// ("Find my car") and the map download cache (it only makes places load
// faster).
const CLEARED = ["smartpark-calibration-v2", "smartpark-complex-v1"];

export const isFreshStart = (() => {
  for (const key of CLEARED) {
    try { window.localStorage.removeItem(key); } catch { /* blocked */ }
  }
  // Photos (camera picture, satellite picture). Requests to open this
  // database wait until it is deleted, so nothing old comes back.
  try { window.indexedDB?.deleteDatabase("smartpark-photo"); } catch { /* unavailable */ }
  return true;
})();
