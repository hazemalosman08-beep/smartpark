# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.
5. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) — the local Base44 backend runs on it.

Run `base44 --help` (or see the [CLI reference](https://docs.base44.com/developers/references/cli/commands/introduction)) for the full command surface.

## Run Locally

Three commands, from the project root:

```bash
base44 login   # one-time per machine
base44 link    # one-time per clone
base44 dev     # local backend + frontend together
```

Open the frontend URL that `base44 dev` prints (typically `http://localhost:5173`).

Notes:

- **Every fresh clone needs `base44 link`.** It writes `base44/.app.jsonc` (the app-id pointer), which is deliberately gitignored. Your app id is in the Builder URL (`app.base44.com/apps/<id>/...`); `base44 link --help` shows the non-interactive flags.
- **`base44 dev` runs the frontend for you** (via `site.serveCommand` in this repo's `base44/config.jsonc`) — never run `npm run dev` yourself: alone it serves a UI with no backend behind it (`[base44] Proxy not enabled`, every `/api` call fails), and alongside `base44 dev` the second Vite silently takes the next port and you end up looking at the wrong one.
- **The app must be published at least once for the UI to load under `base44 dev`.** The frontend boots by fetching app settings from the hosted app; before the first publish that fails and every page redirects to login. The local API works regardless.
- Entities, functions, and auth run locally — entity data is **in-memory only**, wiped when `base44 dev` restarts. Everything else (Core integrations, OAuth login) is forwarded to your deployed app. Full breakdown: [Local development overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview).

## Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

This repo syncs to Base44 through git, so publish from the dashboard rather than `base44 deploy` — a CLI deploy ships your local tree directly, bypassing the sync, and the deployed state silently diverges from the repo.

## Docs & Support

GitHub integration: [https://docs.base44.com/developers/app-code/local-development/github](https://docs.base44.com/developers/app-code/local-development/github)

Local development: [https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)

Support: [https://app.base44.com/support](https://app.base44.com/support)

## SmartPark: how detection works

- **Vehicle detection** runs in the browser (`src/lib/vision/detector.worker.js`) with a YOLO11 model
  (`public/models/yolo11s.onnx`, or `yolo11n.onnx` for slower devices) through ONNX Runtime Web: WebGPU when
  available, otherwise WebAssembly. Camera frames are not uploaded. A "small-car boost" also scans four
  overlapping zoomed tiles so distant cars are found.
- **Tracking** (`src/lib/vision/tracker.js`): Kalman prediction and two-stage optimal matching (ByteTrack
  style). A vehicle gets an `SP-###` ID only after it has been seen in several frames. Parked cars that are
  briefly hidden keep their ID.
- **Stalls and occupancy** (`src/lib/vision/lot.js`): stalls are drawn as perspective-correct rows. Each car
  is matched to at most one stall from its ground footprint, and a stall only changes state after the
  evidence holds for about 1–2 s.
- **Lot plan**: the Lot tab draws the mapped lot top-down. Use "Lot corners" with the real size in metres
  to get a true-to-scale plan. With no camera running, the Lot tab runs a traffic simulation on the same plan.

Tests: `npm test` (unit tests). For a browser check, run `npx vite --config vite.test.config.js --port 5199`,
then `node test/e2e/ui.e2e.cjs`.
