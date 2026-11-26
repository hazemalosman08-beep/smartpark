"""Train the parking-space segmentation model.

    python -m tools.spacemodel.train --data <annotations_dir> --out runs/space \
        [--size 512 --epochs 60 --batch 8 --encoder mobilenet_v2]

Model: U-Net with a MobileNetV2 encoder (segmentation_models_pytorch, MIT;
ImageNet weights from torchvision, BSD-3). Loss: cross-entropy + Dice.
The best epoch is chosen on the VALIDATION lots (space F1); the TEST lots are
used once, at the end, and their numbers are written to metrics.json as
measured - nothing else is reported.
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np


# A slimmer decoder than the library default: about a third of the download for
# the browser (the encoder does most of the work).
DECODER = (128, 64, 48, 32, 16)


def build_model(encoder="mobilenet_v2", pretrained=True):
    import segmentation_models_pytorch as smp
    return smp.Unet(encoder_name=encoder, encoder_weights="imagenet" if pretrained else None, in_channels=3, classes=3,
                    decoder_channels=DECODER)


def dice_loss(logits, target, eps=1.0):
    import torch
    import torch.nn.functional as F
    probs = logits.softmax(1)
    onehot = F.one_hot(target, 3).permute(0, 3, 1, 2).float()
    inter = (probs * onehot).sum((0, 2, 3))
    union = probs.sum((0, 2, 3)) + onehot.sum((0, 2, 3))
    return 1 - ((2 * inter + eps) / (union + eps))[1:].mean()


def evaluate_split(model, ds, device, batch=4, limit=None):
    import torch
    from .evaluate import decode, space_metrics
    model.eval()
    results = []
    n = len(ds) if limit is None else min(limit, len(ds))
    with torch.no_grad():
        for i in range(0, n, batch):
            idx = list(range(i, min(n, i + batch)))
            x = torch.from_numpy(np.stack([ds[k][0] for k in idx])).to(device)
            probs = model(x).softmax(1).cpu().numpy()
            for k, p in zip(idx, probs):
                lot, truth = ds.truth(k)
                results.append((lot, decode(p), truth))
    return space_metrics(results)


def main(argv=None):
    import torch
    from torch.utils.data import DataLoader
    from .data import SpaceDataset, files_for

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="runs/space")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--encoder", default="mobilenet_v2")
    ap.add_argument("--no-pretrained", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-steps", type=int, default=0, help="stop early (smoke tests)")
    ap.add_argument("--init", default="", help="start from these weights (e.g. synthetic pre-training)")
    a = ap.parse_args(argv)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    os.makedirs(a.out, exist_ok=True)
    train = SpaceDataset(files_for(a.data, "train"), a.size, augment=True)
    val = SpaceDataset(files_for(a.data, "val"), a.size)
    test = SpaceDataset(files_for(a.data, "test"), a.size)
    print(f"device {device} | train {len(train)} val {len(val)} test {len(test)} pictures")
    model = build_model(a.encoder, not a.no_pretrained).to(device)
    if a.init:
        model.load_state_dict(torch.load(a.init, map_location=device))
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    steps = a.epochs * max(1, len(train) // a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=max(1, steps))
    # Boundary pixels are few but decide whether neighbours stay apart.
    ce = torch.nn.CrossEntropyLoss(weight=torch.tensor([0.5, 1.0, 2.0], device=device))
    scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")
    loader = DataLoader(train, batch_size=a.batch, shuffle=True, num_workers=a.workers, drop_last=len(train) > a.batch)
    best, history, step = -1.0, [], 0
    for epoch in range(a.epochs):
        model.train()
        t0, losses = time.time(), []
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            with torch.autocast(device_type="cuda", enabled=device == "cuda"):
                logits = model(x)
                loss = ce(logits, y) + dice_loss(logits.float(), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            if step < steps - 1:
                sched.step()
            losses.append(loss.item())
            step += 1
            if a.max_steps and step >= a.max_steps:
                break
        m = evaluate_split(model, val, device) if len(val) else {"overall": {"f1": 0.0}}
        f1 = m["overall"]["f1"]
        history.append({"epoch": epoch + 1, "loss": float(np.mean(losses)) if losses else None, "val": m["overall"], "seconds": round(time.time() - t0, 1)})
        print(f"epoch {epoch + 1:3d} loss {history[-1]['loss']:.4f} val F1 {f1:.3f} ({history[-1]['seconds']}s)")
        if f1 >= best:
            best = f1
            torch.save(model.state_dict(), os.path.join(a.out, "best.pt"))
        if a.max_steps and step >= a.max_steps:
            break
    # Test lots: once, with the best validation weights.
    model.load_state_dict(torch.load(os.path.join(a.out, "best.pt"), map_location=device))
    test_metrics = evaluate_split(model, test, device) if len(test) else None
    report = {
        "model": {"arch": "Unet", "encoder": a.encoder, "input": a.size, "classes": ["background", "interior", "boundary"]},
        "data": {"train": len(train), "val": len(val), "test": len(test),
                 "lots": sorted({ann.lot_id for _, ann in train.items + val.items + test.items})},
        "best_val_f1": best, "history": history, "test": test_metrics,
        "note": "Space-level metrics at IoU >= 0.5 on lots never used for training or model selection.",
    }
    with open(os.path.join(a.out, "metrics.json"), "w") as f:
        json.dump(report, f, indent=1)
    print("test:", json.dumps(test_metrics["overall"] if test_metrics else None))
    return report


if __name__ == "__main__":
    main()
