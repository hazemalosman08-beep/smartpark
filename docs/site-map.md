# Big complexes: satellite map + cameras

**Standard (every customer):** security cameras. Each camera maps and watches its own lot (Camera tab),
exactly as SmartPark always has.

**Optional, for big places (campus, hospital, stadium):** a satellite / aerial picture of the whole
complex. SmartPark animates it in 3D (buildings, trees, islands, roads read from the picture) and places
every camera's lot on it, so people can zoom out and see which lots have room, and the guide can send
them to a space anywhere on the complex.

## How to set it up

1. Camera tab: open the first camera (stream or picture) and map its lot as usual.
2. **Add satellite picture** (bar above the camera). The lot already mapped becomes "Camera 1".
3. **Place on map**: click a point on the ground in the camera picture, then the same point on the
   satellite picture, 4 or more times (line ends, kerb corners, spread far apart; never cars, poles or
   roofs). The camera's spaces appear on the satellite picture as you go; check they sit on the real
   spaces and the fit error is green, then **Save**.
4. **+ Camera** for each further lot: open that camera, map it, place it on the map. Name each lot
   (pencil button), e.g. "North lot".
5. **See complex in 3D** (Driver tab): the whole complex, a label over every lot with its free spaces
   ("North lot 12 free / 40"), and the guide to the best free space.

## What the map shows (honestly)

* The camera running now: live.
* Other cameras: their last reading, if it is less than 15 minutes old.
* Older or never read: the lot's spaces are gray ("no camera reading") — not counted as free and never
  recommended.

A browser runs one camera at a time; reading every camera continuously needs the camera server
(Phase 2).

## How it works

`src/lib/complex.js` keeps the cameras (each: its own lot map, its placement = a homography from 4+
point pairs, its last reading) and builds one map of the whole complex in satellite coordinates:
`complexCalibration()` places every camera's spaces, `complexStatuses()` combines live and recent
readings, `areaCounts()` gives each lot's counts. The 3D guide (`DriverView`, `lotScene.js`) draws it
on the animated satellite picture. Test: `test/e2e/complex.e2e.cjs` (tilted camera placed on the drone
picture of the same lot: 76/81 answer-key spaces placed correctly, occupancy 76/76 right).

## Satellite imagery: licences

Do not use Google Maps / Google Earth imagery in the product: its terms do not allow it. Use the
customer's own orthophotos (university GIS office), USGS NAIP (public domain, US), city open-data
orthoimagery, or a drone flight. OpenStreetMap (ODbL, attribution) can add buildings and roads later.
