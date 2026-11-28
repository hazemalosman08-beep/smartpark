"""Score trained weights on the TEST lots again, without retraining, with
each way of turning the model's picture into spaces.

    python -m tools.spacemodel.evaluate_run --data /content/data/annotations \
        --weights /content/runs/space/best.pt [--size 512]
"""
import argparse
import json

import numpy as np


def main(argv=None):
    import torch
    from .data import SpaceDataset, files_for
    from .evaluate import decode, space_metrics
    from .train import build_model

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--encoder", default="mobilenet_v2")
    ap.add_argument("--domain", default="camera", choices=["camera", "satellite"])
    a = ap.parse_args(argv)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    ds = SpaceDataset(files_for(a.data, "test"), a.size, domain=a.domain)
    model = build_model(a.encoder, pretrained=False).to(device)
    model.load_state_dict(torch.load(a.weights, map_location=device))
    model.eval()
    probs = []
    with torch.no_grad():
        for i in range(len(ds)):
            x = torch.from_numpy(ds[i][0][None]).to(device)
            probs.append(model(x).softmax(1)[0].cpu().numpy())
    report = {}
    for name, kw in {"plain (first version)": {"method": "plain"}, "grow": {"method": "grow"},
                     "grow, split from 1.4x": {"method": "grow", "big": 1.4},
                     "grow, shallower seeds": {"method": "grow", "depth": 0.45}}.items():
        results = [(ds.truth(i)[0], decode(p, **kw), ds.truth(i)[1]) for i, p in enumerate(probs)]
        m = space_metrics(results)
        report[name] = m
        o = m["overall"]
        print(f"{name:24} precision {o['precision']:.3f}  recall {o['recall']:.3f}  F1 {o['f1']:.3f}  (tp {o['tp']} fp {o['fp']} fn {o['fn']})")
    best = max(report, key=lambda k: report[k]["overall"]["f1"])
    print(f"best: {best}")
    for lot, r in report[best]["per_lot"].items():
        print(f"  {lot:24} P {r['precision']:.3f}  R {r['recall']:.3f}  F1 {r['f1']:.3f}")
    with open(a.weights.rsplit("/", 1)[0] + "/metrics_decoders.json", "w") as f:
        json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
