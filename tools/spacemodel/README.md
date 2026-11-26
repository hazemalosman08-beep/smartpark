# Space model tools

Everything needed to turn annotated parking-lot pictures into the space model the app can load
(`public/models/space-seg.onnx` + `space-seg.json`). Design and dataset/licence research:
[`docs/hybrid-detection/RESEARCH.md`](../../docs/hybrid-detection/RESEARCH.md).
The easiest way to run it is the Colab notebook [`notebooks/train_space_model.ipynb`](../../notebooks/train_space_model.ipynb).

| File | Purpose |
|---|---|
| `annotation.py` | The `smartpark-annotation/v1` format (what *Export for training* writes), loading, validation, answer-key export |
| `convert.py` | ACPDS, PKLot and YOLO-OBB datasets → SmartPark annotations |
| `split.py` | Train / validation / test **by lot** (no lot in two splits), reproducible, forced test lots |
| `masks.py` | Picture + spaces → model input and class mask (background / interior / boundary) |
| `synth.py` | Synthetic lots for warm-up and pipeline tests (never quote their metrics) |
| `data.py` | PyTorch dataset with augmentations for unseen lots (rotation, white↔yellow lines, shadows, colour, blur) |
| `train.py` | U-Net / MobileNetV2 training, model chosen on validation lots, test lots scored once → `metrics.json` |
| `evaluate.py` | Masks → spaces (same post-processing as the app) and per-lot precision / recall / F1 at IoU ≥ 0.5 |
| `export.py` | ONNX export (single file, checked against PyTorch) + sidecar with the measured test metrics |
| `test_tools.py` | Tests: `python -m unittest tools.spacemodel.test_tools` |

## Local run (CPU is fine for a smoke test, a GPU for real training)

```bash
pip install -r tools/spacemodel/requirements.txt
python -m tools.spacemodel.convert acpds /data/acpds /data/ann
python -m tools.spacemodel.split /data/ann --test-lots my-office-lot
python -m tools.spacemodel.train --data /data/ann --out runs/space --epochs 60
python -m tools.spacemodel.export --weights runs/space/best.pt --metrics runs/space/metrics.json --out public/models
npm run test:accuracy          # must show "no regressions" before deploying
```

## Adding your own lots

1. Open a photo in SmartPark, fix the map (Fill missed row, Add row of spaces, Remove, Space type).
2. *Camera tab → Export for training*, give the lot a name (the same name for every photo of that lot).
3. Put the `.json` files in the Drive folder the notebook reads, and train again.
4. To also add the lot to the regression suite: `to_truth()` in `annotation.py` writes a
   `test/accuracy/<name>.truth.json` answer key from the annotation.

Only use pictures you have the rights to train on.

## Smoke test done while building this (not an accuracy result)

On a CPU, 160 synthetic pictures (32 lots), 6 short epochs at 256 px, no ImageNet weights: the pipeline trained,
chose the epoch on validation lots, scored held-out synthetic lots, exported a 16.7 MB ONNX file matching PyTorch
to 6e-6, and the app loaded it in the browser and merged its spaces. The synthetic test F1 (≈0.4) says only that
the code learns; it says nothing about real parking lots.
