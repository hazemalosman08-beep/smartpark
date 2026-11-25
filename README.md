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
- **Driver tab:** the screen drivers see, on an entrance display (Full screen) or a phone. It shows how many
  spaces are open and which space to take, gives step-by-step directions, and animates a car driving the route
  on the real lot. It follows the camera live: if the space is taken, the next best one is shown.
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
