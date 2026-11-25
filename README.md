# SmartPark

A parking-lot camera app that runs entirely in the browser. No backend and no account are needed.

- **Camera tab:** use a webcam, your phone as a wireless camera, or a photo or video file. Cars are detected on
  the device with a YOLO11 model and tracked with stable IDs (`SP-001`, …). You draw the stall rows, driving
  lanes and entrance on the picture, and each stall shows as free or taken.
- **Spaces are found automatically** when a picture loads. In a top-down (Overhead) picture the white stall lines
  are read and split into spaces, and lines hidden under cars are filled in from the row's spacing. Parked cars
  outside any found space count as spaces too. The camera view shows **spaces / open / taken** live. Use
  **Find spaces automatically** to run it again, and **Erase** or **Stall row** to correct it.
- **Lot tab:** a top-down plan of the lot exactly as you mapped it, with the live cars on it, the best free stall
  and the route to it. **Photo** shows the real camera picture underneath, so the plan looks exactly like the lot.
  **Map** shows a clean drawing with each car in its real colour. **Guide demo** starts from the real lot and
  animates new cars being led along the aisles to the best free space.
- **Driver tab (3D guide):** a GPS-style 3D view of the real lot for an entrance display or a phone, with the
  flat 2D map kept as a fallback (3D/2D switch). Three views: **Driver** (tilted, behind the car), **Bird's-eye**
  and **Free** (drag to rotate, scroll/pinch to zoom). Light and dark mode.
  - Built only from SmartPark's own data: spaces and entrance from the map; islands, kerbs and trees found in
    the camera picture; buildings found in it or drawn with **Building outline** (a photo has no heights, so
    buildings are simple three-storey blocks). Nothing is invented.
  - Spaces: green free, red taken, blue reserved, gray not verified yet. Cars sit in taken spaces in the
    colour the camera saw; tracked cars glide between tracker positions and keep their IDs.
  - A blue route with moving arrows, the next turn, arrival time and distance left. Routes never cross spaces,
    islands or buildings. Choose the destination building and "I need an accessible space".
  - **Your car:** with a live camera, pick your car (its ID) to be followed; the route is re-planned from where
    it is, a new space is given if yours is taken, and when the camera sees it park the space is saved for
    Find my car. Without a live position the guide plays a labelled *route preview* from the entrance.
  - The screen always says where its data comes from: live camera, photo snapshot or simulated.
  - **Walking:** the walk is measured from the space you park in (or are sent to), not from the entrance:
    a walking route to the chosen building along walkways and crossings, between parked cars, around
    buildings and planted islands. It ranks the spaces (shortest real walk first), shows metres and time
    (about 1.3 m/s), and is drawn as an amber footstep line in 3D and 2D.
  - **Pedestrian areas read from the picture:** walkways and sidewalks (straight strips of concrete lighter
    than the lot's pavement, drawn raised in 3D) and crossings (four or more parallel painted bars or
    hatching outside the spaces, white or yellow).
- **Building:** on the Camera tab, the Building tool marks where drivers walk to; each extra click adds another
  destination drivers can choose. The guide sends each driver to the free space with the shortest walk.
  **Space type** (More tools) marks spaces accessible or reserved.
- **Tilted cameras are straightened automatically:** the tilt is measured from how cars shrink toward the
  back of the picture, refined so painted spaces come out equal width and about 2.5 x 5 m, then spaces are
  found in the straightened picture and the Lot/Driver maps are drawn top-down. Lot corners (More tools)
  overrides it by hand.
- **Find my car:** look up a car by its ID on the same device.
- **Installable** as an app (PWA): "Install app" in Chrome/Edge/Android, or Share → Add to Home Screen on iPhone.

Data (the lot map, parking history) is saved in the browser on each device. It is not shared between devices.

## Put it online (free, no coding)

1. Unzip `smartpark-site.zip` (the ready-built site).
2. Go to <https://app.netlify.com/drop>, sign up or log in, and drag the unzipped folder onto the page.
3. Netlify gives you an `https://…netlify.app` link. Open it on your computer and your phone.

HTTPS is required for cameras, and Netlify provides it automatically.

## Phone as the camera (home testing)

1. On the computer: **Camera tab → Phone camera**. A QR code and a 6-digit code appear.
2. On the phone: scan the QR code, tap **Start camera** and allow camera access. Prop the phone up facing the lot.
3. The video goes directly from the phone to the computer (WebRTC). It works best with both on the same Wi-Fi.
   The free public PeerJS server is used only to introduce the two devices.

To remove the feature later, delete `src/lib/phoneLink.js`, `src/pages/PhoneCamera.jsx` and
`src/components/SmartPark/RemoteCameraDialog.jsx`, remove the "Phone camera" button and phone code in
`LiveCamera.jsx` and the `/phone-camera` route in `App.jsx`, then run `npm uninstall peerjs`.

To use your own PeerJS server instead of the public one, build with `VITE_PEER_HOST`, `VITE_PEER_PORT`,
`VITE_PEER_PATH` and `VITE_PEER_SECURE`.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production files in dist/
npm test         # unit tests (geometry, tracker, lot, simulation)
```

How detection works:

- **Detector** (`src/lib/vision/detector.worker.js`): YOLO11 (`public/models/yolo11s.onnx`, or the faster
  `yolo11n.onnx`) on ONNX Runtime Web, using WebGPU when available and WebAssembly otherwise. A "small-car boost"
  also scans four zoomed tiles.
- **Aerial model** (`public/models/yolo11s-aerial.onnx`, YOLO11-OBB trained on aerial photos): finds cars
  seen from straight above, which street-photo models miss. Used on every photo, and on live video when the
  camera view is Overhead. On a drone photo it found 45 cars where the street model found 0–2.
- **Tracker** (`src/lib/vision/tracker.js`): Kalman prediction plus two-stage optimal matching (ByteTrack style).
  A new car must be seen a few times before it gets an ID.
- **Stalls** (`src/lib/vision/lot.js`): perspective-correct stall rows, one car per stall, and a short hold before
  a stall changes state. "Lot corners" plus the real size in metres gives a true-to-scale plan.
- **App shell** (`public/sw.js`): caches the model after the first download and lets the app open offline.

Browser tests: start `npm run dev -- --port 5199`, then run `node test/e2e/ui.e2e.cjs`.
`test/e2e/phone.e2e.cjs` checks phone pairing; see its header for setup.
