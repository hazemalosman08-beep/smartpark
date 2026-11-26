"""From predicted class maps to spaces, and space-level metrics.

decode() mirrors src/lib/vision/spaceMasks.js (the app's post-processing), so
the numbers measured here describe what the app will do.
Metrics: a predicted space matches a true one when their polygons overlap with
IoU >= 0.5 (one-to-one, greedy by IoU); precision, recall and F1 are reported
overall and per lot.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np


def decode(probs, threshold=0.5, min_area=30):
    """probs: (3, H, W) softmax. Returns [(polygon [[x,y]x4], confidence)]."""
    import cv2
    from scipy import ndimage
    interior, boundary = probs[1], probs[2]
    on = (interior >= threshold) & (interior > boundary)
    labels, n = ndimage.label(on, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    out = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(labels == k)
        if len(xs) < min_area:
            continue
        rect = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
        (cw, ch) = rect[1]
        area = max(1.0, (cw + 1) * (ch + 1))
        conf = float(interior[ys, xs].mean()) * min(1.0, len(xs) / area / 0.8)
        out.append((cv2.boxPoints(rect).tolist(), conf, len(xs)))
    if len(out) >= 3:
        med = np.median([a for _, _, a in out])
        out = [(p, c * (0.5 if a / med < 0.4 or a / med > 2.5 else 1.0), a) for p, c, a in out]
    return [(p, c) for p, c, _ in out]


def iou(a, b):
    from shapely.geometry import Polygon
    pa, pb = Polygon(a).buffer(0), Polygon(b).buffer(0)
    inter = pa.intersection(pb).area
    union = pa.union(pb).area
    return inter / union if union else 0.0


def match(pred, truth, thr=0.5):
    """Greedy one-to-one matching by IoU. Returns (tp, fp, fn)."""
    pairs = sorted(((iou(p, t), i, j) for i, p in enumerate(pred) for j, t in enumerate(truth)), reverse=True)
    used_p, used_t, tp = set(), set(), 0
    for v, i, j in pairs:
        if v < thr:
            break
        if i in used_p or j in used_t:
            continue
        used_p.add(i)
        used_t.add(j)
        tp += 1
    return tp, len(pred) - tp, len(truth) - tp


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0, "tp": tp, "fp": fp, "fn": fn}


def space_metrics(results, min_conf=0.5):
    """results: [(lot_id, predicted [(poly, conf)], truth [poly])]."""
    per_lot = defaultdict(lambda: [0, 0, 0])
    for lot, pred, truth in results:
        tp, fp, fn = match([p for p, c in pred if c >= min_conf], truth)
        acc = per_lot[lot]
        acc[0] += tp; acc[1] += fp; acc[2] += fn
    total = [sum(v[i] for v in per_lot.values()) for i in range(3)]
    return {"overall": prf(*total), "per_lot": {lot: prf(*v) for lot, v in sorted(per_lot.items())}}
