# Hybrid parking-space detection: research and design

Status: design + tooling on branch `hybrid-detection`. **No model has been trained yet, and no accuracy
figures exist for one.** Every number below about SmartPark comes from the regression suite
(`npm run test:accuracy`); numbers about other work are quoted from their authors and marked as such.

## 1. Goal

Find every parking space (empty or occupied) in a picture of a lot that SmartPark has never seen,
without tuning the algorithm per location: white and yellow lines, double-sided rows, angled spaces,
shadows, spaces hidden by cars, accessible spaces, top-down drone photos and tilted pole cameras.

The current detector (`src/lib/vision/stallFinder.js` + `autoMap.js`) is geometric: it reads painted
lines and infers rows. It works well on the lots it was tuned on and fails in new ways on new lots
(missed halves of double rows, rows stopping early, aisle markings taken for spaces). Rules cannot
anticipate every lot; a learned model trained on many lots can generalise, and the geometric finder
stays as a second opinion and as the fallback.

## 2. Public datasets (licences checked where reachable)

| Dataset | What it has | Viewpoint | Licence | Fit |
|---|---|---|---|---|
| **ACPDS** (Action-Camera Parking Dataset, Marek 2021) — [repo](https://github.com/martin-marek/parking-space-occupancy), [paper](https://arxiv.org/pdf/2107.12207) | 293 images; per-space quadrilaterals (`rois_list`, 4×2 points) + occupancy; fixed train/valid/test split in `annotations.json`, authors report unseen lots in test | GoPro ~10–12 m high, oblique | MIT (repository) | **Good** for tilted cameras; small |
| **PKLot** (Almeida et al. 2015) — [HF mirror](https://huggingface.co/datasets/ShantyCam/pklot), [Voxel51](https://docs.voxel51.com/dataset_zoo/datasets_hf/pklot.html), [Roboflow](https://public.roboflow.com/object-detection/pklot) | 12,416 images, ~696k space polygons with occupancy | 3 fixed cameras, 2 lots, oblique | CC BY 4.0 per mirrors (cite the paper) — confirm on the official UFPR page before relying on it | Many images but **only 3 views**: easy to over-fit; use a capped sample, split by lot |
| **AccessParkCV** (Hwang et al., ASSETS 2025) — [paper](https://arxiv.org/abs/2509.25460), [project](https://makeabilitylab.cs.washington.edu/project/accessparkcv), [HF card](https://huggingface.co/datasets/makeabilitylab/disabilityparking/blob/main/README.md) | ~11.7k oriented boxes in aerial orthoimagery (Seattle, Washington DC, Spring Hill TN): accessible spaces, access aisles, curbside spots | Top-down aerial | MIT per search results; **the dataset card could not be opened from this environment** (Hugging Face blocked), so classes, imagery terms and whether ordinary spaces are included are unverified — the notebook prints the card and stops if the licence is not MIT/CC-BY | **Good** for top-down and accessible spaces if ordinary spaces are included |
| CNRPark+EXT — [record](https://iris.cnr.it/handle/20.500.14243/409744) | ~150k patches, 164 spaces, 9 cameras | oblique | Not found | Patches, not full layouts; licence unknown → not used |
| CARPK, UAV-ROD — [CARPK](https://cs.paperswithcode.com/dataset/carpk), [UAV-ROD](https://www.github.com/fengkaibit/UAV-ROD) | Cars only (no empty spaces) | drone | various | Not for spaces; car detection already exists |
| DOTA | Aerial objects incl. vehicles | aerial | Academic, non-commercial | Not used |

Nothing public covers top-down photos of ordinary lots well. **SmartPark's own annotations will be
the most valuable data**, which is why this branch adds an export of hand-corrected maps
(section 5). Pictures used must be ones you have the rights to train on: the test photos in
`test/accuracy/` came from the web and are fine for testing, **not** for training a commercial model.

## 3. Model architectures

| Option | Licence | Browser (onnxruntime-web) | Pros | Cons |
|---|---|---|---|---|
| Ultralytics YOLO11-OBB / -seg | **AGPL-3.0**; trained weights are AGPL too; closed-source/commercial use needs an Enterprise licence ([Ultralytics](https://www.ultralytics.com/license)) | Yes | Easiest training, strong OBB | Licence (SmartPark's current car detectors are YOLO11 — same issue, see §7) |
| RTMDet-R (MMRotate) | Apache-2.0 ([repo](https://github.com/open-mmlab/mmrotate)) | Export via mmdeploy needs a **custom `NMSRotated` op** ([docs](https://mmdeploy.readthedocs.io/en/1.x/04-supported-codebases/mmrotate.html)), not available in onnxruntime-web | Real oriented-box detector | Heavy toolchain (mmcv build), browser deployment needs NMS re-implemented in JS; smallest published rotated variants are m/l |
| **U-Net / DeepLabV3+ (segmentation_models_pytorch) with a MobileNet encoder** | MIT library ([repo](https://github.com/qubvel-org/segmentation_models.pytorch)); torchvision MobileNet weights BSD-3 | Only standard ops (Conv, Resize, Concat) — runs on the WASM backend that SmartPark already ships | Tiny (≈2–7 M params), simple Colab training, every pixel supervised (good with few images), handles occlusion: it learns where spaces are under cars | Needs post-processing to turn pixels into individual spaces |

**Chosen: segmentation (U-Net, MobileNetV2 encoder) predicting three classes**

* `0` background, `1` space interior, `2` space boundary (painted lines and the edges between
  neighbouring spaces, also where no line is visible, e.g. under a car).

Individual spaces = connected regions of "interior" separated by "boundary"; each region becomes an
oriented rectangle (minimum-area rectangle) whose **confidence** is the mean model probability inside
it, lowered when its shape is unlike its neighbours. This is the approach used for touching-cell
instance segmentation; it is cheap, licence-clean, and the post-processing is plain JavaScript.
Double-sided rows and angled spaces need no special casing: the boundary class learns the shared back
line and the slanted dividers. If later data shows segmentation struggles, the same dataset format
also feeds an oriented-box detector.

## 4. Hybrid integration (in the app)

1. The geometric finder runs as today.
2. If `public/models/space-seg.onnx` exists, the model runs too (in a worker, after the car detector).
3. Spaces are merged (`src/lib/vision/hybrid.js`):
   * found by both → kept (geometric outline), confidence raised;
   * model only → added (they are the missed spaces), confidence = model confidence;
   * geometric only → kept, confidence lowered unless they hold a car or were drawn by hand.
4. Every space carries `confidence` (0–1) and `sources`. Without a model, a geometric confidence is
   computed from the evidence (painted on both sides, regular row, car inside, hand-drawn = 1).

## 5. Data loop

* **Export for training** (Camera tab → More tools): saves the photo + every space as a polygon in
  pixel coordinates, with type, occupancy, source and a lot id, in `smartpark-annotation/v1` JSON.
  Spaces you fixed by hand become labels for the next training round.
* `tools/dataset/` (Python): converters for ACPDS and PKLot, mask rendering, and a **split by lot**
  (`split.py`): every lot goes entirely to train, validation or test, so no lot is seen in training
  and testing (no leakage); the split is written to `splits.json` and is reproducible.

## 6. Evaluation

* `npm run test:accuracy` runs the app headless on every `test/accuracy/*.truth.json` (8 lots now,
  including the yellow-lined lot) and fails if any score drops below `test/accuracy/baseline.json`.
* The notebook reports metrics on the **test lots only** (never seen in training): per-space
  precision/recall/F1 at IoU ≥ 0.5, and per-lot numbers, so a good average cannot hide a bad lot.

## 7. Trade-offs and open points

* Data is the bottleneck, not compute. Expect the first model to help mostly on lots that resemble
  its training data; the geometric finder and the one-click row tool remain essential.
* PKLot has many images of only three views: capped per view to avoid a model that only knows them.
* Licences: the car detectors in use are Ultralytics YOLO11 (AGPL-3.0). For a closed commercial
  product, either buy an Ultralytics licence or replace them with an Apache/MIT detector (e.g. an
  RT-DETR/D-FINE model); not changed on this branch.
* Browser cost: a 512×512 MobileNetV2 U-Net is a few MB and runs once per mapping, not per frame.
