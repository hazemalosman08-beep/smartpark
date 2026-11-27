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


def decode(probs, threshold=0.5, min_area=30, method="grow", seed_boundary=0.25, erode=1, depth=0.6, big=1.7):
    """probs: (3, H, W) softmax. Returns [(polygon [[x,y]x4], confidence)].

    method="grow" (default): connected interior regions, and blobs much bigger
    than a typical space (spaces merged through gaps in their lines) are split:
    seeds are the deepest parts of the blob away from predicted lines, each
    grows until it meets its neighbours; the split is kept only if every piece
    is space-sized.
    method="plain": connected interior regions (the first version).
    Mirrors src/lib/vision/spaceMasks.js.
    """
    import cv2
    from scipy import ndimage
    interior, boundary = probs[1], probs[2]
    cross = [[0, 1, 0], [1, 1, 1], [0, 1, 0]]
    labels, n = ndimage.label((interior >= threshold) & (interior > boundary), structure=cross)
    if method != "plain" and n >= 3:
        # Only blobs much bigger than a typical space are split (rows merged
        # through gaps in their lines); a split is kept only if every piece is
        # space-sized, so ordinary spaces are never cut up.
        sizes = np.asarray(ndimage.sum(np.ones_like(labels), labels, index=np.arange(1, n + 1)))
        typical = float(np.median(sizes[sizes >= min_area])) if (sizes >= min_area).any() else 0
        nxt = n + 1
        for k in np.nonzero(sizes > big * typical)[0] + 1 if typical else []:
            blob = labels == k
            core = blob & (boundary < seed_boundary)
            if erode:
                core = ndimage.binary_erosion(core, structure=cross, iterations=erode)
            dist = ndimage.distance_transform_edt(core)
            seeds, m = ndimage.label(dist >= depth * dist.max() if dist.max() > 0 else core, structure=cross)
            if m < 2:
                continue
            for _ in range(64):
                grown = ndimage.grey_dilation(seeds, footprint=np.array(cross, bool))
                take = (seeds == 0) & blob & (grown > 0)
                if not take.any():
                    break
                seeds[take] = grown[take]
            pieces = np.asarray(ndimage.sum(np.ones_like(seeds), seeds, index=np.arange(1, m + 1)))
            if (pieces < 0.4 * typical).any():
                continue
            for j in range(1, m + 1):
                labels[seeds == j] = nxt
                nxt += 1
    out = []
    for k in range(1, int(labels.max()) + 1):
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
    # Only pairs whose bounding boxes touch can overlap (exact IoU is slow).
    box = lambda q: (min(x for x, _ in q), min(y for _, y in q), max(x for x, _ in q), max(y for _, y in q))
    pb, tb = [box(p) for p in pred], [box(t) for t in truth]
    pairs = sorted(((iou(pred[i], truth[j]), i, j) for i in range(len(pred)) for j in range(len(truth))
                    if pb[i][0] < tb[j][2] and tb[j][0] < pb[i][2] and pb[i][1] < tb[j][3] and tb[j][1] < pb[i][3]), reverse=True)
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
