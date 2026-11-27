# Site map + linked cameras (Phase 1)

The long-term product: one map of a whole site (e.g. a university campus) built from aerial imagery,
with security cameras feeding live occupancy into it, and a 3D guide for drivers. Phase 1 is one lot:
one aerial picture and a camera linked to it.

## How to use it

1. **Camera tab → Photo / video file**: open a top-down picture of the lot (aerial, satellite, drone).
   Spaces are found automatically; fix them (Fill missed row, Add row of spaces, Remove, Space type).
2. Press **Make this picture the site map** (bar above the picture).
3. Switch the bar to **Camera** and open the camera's picture or stream (photo, video, webcam, phone).
4. Press **Link camera**: click a point on the ground in the camera picture, then the same point on the
   site map, at least 4 times (line ends, kerb corners, spread far apart; never points on cars, poles
   or roofs). The site's spaces are drawn on the camera picture as you go; check they sit on the real
   spaces and that the fit error is small (green), then **Save link**.
5. The camera now reports on the site's spaces. Lot and Driver tabs (and the 3D guide) use the site
   map, with the aerial picture as background.

* **One combined picture:** once a camera is linked, the satellite picture is redrawn with the camera's
  live view projected onto the ground it covers (blended at the edges, every 3 s). The Lot and Driver
  tabs and the 3D guide use that combined picture, so the map shows the cars the camera sees now; where
  no camera looks, the satellite picture is kept. Tall things (cars, poles, trees) seen at an angle
  lean in the projection; the ground lines up exactly.
* Spaces the camera does not see are **not covered**: drawn gray, not counted as open, never
  recommended.
* The camera view is set to Angled / Overhead automatically from how steeply the camera looks down
  (from the link); the buttons override it.
* Spaces edited in the camera view (removed, added, type changed) are edited on the site map.

## How it works

`src/lib/vision/siteLink.js`: a least-squares homography from the point pairs (camera % → site %),
`cameraView()` projects the site's spaces into the camera (only those it sees, same ids),
`applyCameraEdit()` maps edits back, `cameraLotToSiteLot()` places cars on the site plan.
`Home.jsx` switches the Camera tab between the site map and the camera view;
`SitePanel.jsx` has the bar and the link dialog.

## Measured

`test/e2e/site.e2e.cjs`: the drone picture as site map, the tilted picture of the same lot as the
camera, linked with 6 point pairs (fit error 0.07%): all 81 labelled spaces covered, **79/81
occupancy right**. The two misses are cars the detector does not see in that camera (one in deep shade,
one under a tree).

## Satellite imagery: licences

Do not use Google Maps / Google Earth imagery as the site map: its terms do not allow it. Use the
university's own orthophotos (GIS office), USGS NAIP (public domain, US), city open-data orthoimagery,
or your own drone flight. OpenStreetMap (ODbL, attribution) is suitable for buildings and roads later.

## Next (Phase 2)

Several cameras per site (each with its own link; where they overlap, the clearest view wins), a small
server that reads camera streams (RTSP/ONVIF) instead of the browser, then several lots on one campus map.
