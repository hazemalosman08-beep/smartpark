// US states for "search only in my state": name, code and a bounding box
// [west, south, east, north] in degrees (approximate, padded when used).
// The box keeps the search inside the state's area; results are then kept
// only if their address is in the state (boxes overlap their neighbours).
export const STATES = [
  ["Alabama", "AL", [-88.47, 30.22, -84.89, 35.01]], ["Alaska", "AK", [-179.15, 51.21, -129.98, 71.39]],
  ["Arizona", "AZ", [-114.82, 31.33, -109.04, 37.0]], ["Arkansas", "AR", [-94.62, 33.0, -89.64, 36.5]],
  ["California", "CA", [-124.41, 32.53, -114.13, 42.01]], ["Colorado", "CO", [-109.06, 36.99, -102.04, 41.0]],
  ["Connecticut", "CT", [-73.73, 40.98, -71.79, 42.05]], ["Delaware", "DE", [-75.79, 38.45, -75.05, 39.84]],
  ["District of Columbia", "DC", [-77.12, 38.79, -76.91, 38.99]], ["Florida", "FL", [-87.63, 24.52, -80.03, 31.0]],
  ["Georgia", "GA", [-85.61, 30.36, -80.84, 35.0]], ["Hawaii", "HI", [-178.33, 18.91, -154.81, 28.4]],
  ["Idaho", "ID", [-117.24, 41.99, -111.04, 49.0]], ["Illinois", "IL", [-91.51, 36.97, -87.49, 42.51]],
  ["Indiana", "IN", [-88.1, 37.77, -84.78, 41.76]], ["Iowa", "IA", [-96.64, 40.38, -90.14, 43.5]],
  ["Kansas", "KS", [-102.05, 36.99, -94.59, 40.0]], ["Kentucky", "KY", [-89.57, 36.5, -81.96, 39.15]],
  ["Louisiana", "LA", [-94.04, 28.93, -88.82, 33.02]], ["Maine", "ME", [-71.08, 43.06, -66.95, 47.46]],
  ["Maryland", "MD", [-79.49, 37.91, -75.05, 39.72]], ["Massachusetts", "MA", [-73.51, 41.24, -69.93, 42.89]],
  ["Michigan", "MI", [-90.42, 41.7, -82.41, 48.31]], ["Minnesota", "MN", [-97.24, 43.5, -89.49, 49.38]],
  ["Mississippi", "MS", [-91.66, 30.17, -88.1, 35.0]], ["Missouri", "MO", [-95.77, 35.99, -89.1, 40.61]],
  ["Montana", "MT", [-116.05, 44.36, -104.04, 49.0]], ["Nebraska", "NE", [-104.05, 40.0, -95.31, 43.0]],
  ["Nevada", "NV", [-120.01, 35.0, -114.04, 42.0]], ["New Hampshire", "NH", [-72.56, 42.7, -70.61, 45.31]],
  ["New Jersey", "NJ", [-75.56, 38.93, -73.89, 41.36]], ["New Mexico", "NM", [-109.05, 31.33, -103.0, 37.0]],
  ["New York", "NY", [-79.76, 40.5, -71.86, 45.02]], ["North Carolina", "NC", [-84.32, 33.84, -75.46, 36.59]],
  ["North Dakota", "ND", [-104.05, 45.94, -96.55, 49.0]], ["Ohio", "OH", [-84.82, 38.4, -80.52, 41.98]],
  ["Oklahoma", "OK", [-103.0, 33.62, -94.43, 37.0]], ["Oregon", "OR", [-124.57, 41.99, -116.46, 46.29]],
  ["Pennsylvania", "PA", [-80.52, 39.72, -74.69, 42.27]], ["Rhode Island", "RI", [-71.86, 41.15, -71.12, 42.02]],
  ["South Carolina", "SC", [-83.35, 32.03, -78.54, 35.22]], ["South Dakota", "SD", [-104.06, 42.48, -96.44, 45.95]],
  ["Tennessee", "TN", [-90.31, 34.98, -81.65, 36.68]], ["Texas", "TX", [-106.65, 25.84, -93.51, 36.5]],
  ["Utah", "UT", [-114.05, 37.0, -109.04, 42.0]], ["Vermont", "VT", [-73.44, 42.73, -71.46, 45.02]],
  ["Virginia", "VA", [-83.68, 36.54, -75.24, 39.47]], ["Washington", "WA", [-124.76, 45.54, -116.92, 49.0]],
  ["West Virginia", "WV", [-82.64, 37.2, -77.72, 40.64]], ["Wisconsin", "WI", [-92.89, 42.49, -86.81, 47.08]],
  ["Wyoming", "WY", [-111.06, 40.99, -104.05, 45.01]],
].map(([name, code, bbox]) => ({ name, code, bbox }));

export const stateByCode = (code) => STATES.find((s) => s.code === code) || null;
