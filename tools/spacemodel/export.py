"""Export the trained model for the app (onnxruntime-web).

    python -m tools.spacemodel.export --weights runs/space/best.pt --metrics runs/space/metrics.json \
        --out public/models [--size 512 --encoder mobilenet_v2]

Writes space-seg.onnx and its sidecar space-seg.json (read by
src/lib/vision/spaceModel.js). The ONNX output is checked against PyTorch on a
random input before anything is written.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os

import numpy as np


def main(argv=None):
    import onnxruntime as ort
    import torch
    from .train import build_model

    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--metrics", default="")
    ap.add_argument("--out", default="public/models")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--encoder", default="mobilenet_v2")
    ap.add_argument("--datasets", default="", help="comma list of datasets used, with licences, for the record")
    a = ap.parse_args(argv)

    model = build_model(a.encoder, pretrained=False)
    model.load_state_dict(torch.load(a.weights, map_location="cpu"))
    model.eval()
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, "space-seg.onnx")
    x = torch.randn(1, 3, a.size, a.size)
    # One self-contained file (the browser loads a single file; no external weights).
    kwargs = dict(input_names=["image"], output_names=["logits"], opset_version=17, do_constant_folding=True)
    try:
        torch.onnx.export(model, x, path, external_data=False, **kwargs)
    except TypeError:  # older PyTorch: always one file
        torch.onnx.export(model, x, path, **kwargs)
    if os.path.exists(path + ".data"):
        raise SystemExit("exporter wrote external weights; the app needs one file")
    with torch.no_grad():
        ref = model(x).numpy()
    got = ort.InferenceSession(path, providers=["CPUExecutionProvider"]).run(None, {"image": x.numpy()})[0]
    err = float(np.abs(ref - got).max())
    if err > 1e-2:
        raise SystemExit(f"ONNX output differs from PyTorch (max error {err})")
    metrics = json.load(open(a.metrics)) if a.metrics and os.path.exists(a.metrics) else {}
    sidecar = {
        "file": "space-seg.onnx", "input": a.size, "classes": ["background", "interior", "boundary"],
        "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225], "threshold": 0.5, "minArea": 30,
        "arch": f"Unet/{a.encoder}", "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "datasets": [d for d in a.datasets.split(",") if d],
        "test_metrics": (metrics.get("test") or {}).get("overall"),
        "note": "Metrics measured on held-out lots by tools/spacemodel/train.py; empty if not measured.",
    }
    with open(os.path.join(a.out, "space-seg.json"), "w") as f:
        json.dump(sidecar, f, indent=1)
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.1f} MB), max |onnx - torch| = {err:.2e}")


if __name__ == "__main__":
    main()
