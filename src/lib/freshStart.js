// Every time the app is opened (a new tab or window, or the home-screen app
// launched again) it starts clean: no lot photo, lot map, satellite complex
// or campus from last time. Refreshing the same tab keeps them, so work in
// progress is not lost by accident.
// Kept: preferences (permit, driver screen), the parked car ("Find my car")
// and the map download cache (it only makes campuses load faster).
const SESSION_KEY = "smartpark.session";
const CLEARED = ["smartpark-calibration-v2", "smartpark-complex-v1"];

export const isFreshStart = (() => {
  try {
    if (window.sessionStorage.getItem(SESSION_KEY)) return false;
    window.sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    return false; // storage blocked: nothing was kept anyway
  }
  for (const key of CLEARED) {
    try { window.localStorage.removeItem(key); } catch { /* blocked */ }
  }
  // Photos (camera picture, satellite picture, saved campus). Requests to
  // open this database wait until it is deleted, so nothing old comes back.
  try { window.indexedDB?.deleteDatabase("smartpark-photo"); } catch { /* unavailable */ }
  return true;
})();
