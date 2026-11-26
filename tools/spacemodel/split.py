"""Split annotations into train / validation / test BY LOT.

Every picture of a lot goes to the same split, so the model is always tested on
lots it has never seen (no leakage). The assignment is deterministic (hash of
the lot id and a seed) and written to splits.json.

    python -m tools.spacemodel.split <annotations_dir> [--val 0.15 --test 0.2 --seed 0]
                                     [--test-lots lot-a,lot-b]
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
from collections import defaultdict


def assign(lot_counts, val=0.15, test=0.2, seed=0, test_lots=(), val_lots=()):
    """lot_counts: {lot_id: number of pictures}. Returns {lot_id: split}.
    Lots are ordered by a seeded hash and handed out until each split holds
    about its share of pictures; forced lots go where they are told."""
    out = {}
    for lot in test_lots:
        if lot in lot_counts:
            out[lot] = "test"
    for lot in val_lots:
        if lot in lot_counts and lot not in out:
            out[lot] = "val"
    total = sum(lot_counts.values()) or 1
    have = defaultdict(int)
    for lot, split in out.items():
        have[split] += lot_counts[lot]
    order = sorted((l for l in lot_counts if l not in out), key=lambda l: hashlib.sha256(f"{seed}:{l}".encode()).hexdigest())
    for lot in order:
        if have["test"] < test * total:
            split = "test"
        elif have["val"] < val * total:
            split = "val"
        else:
            split = "train"
        out[lot] = split
        have[split] += lot_counts[lot]
    # Never leave training empty when there is more than one lot.
    if len(lot_counts) > 1 and "train" not in out.values():
        biggest = max((l for l in out if l not in test_lots), key=lambda l: lot_counts[l], default=None)
        if biggest:
            out[biggest] = "train"
    return out


def split_dir(ann_dir, **kw):
    files = sorted(glob.glob(os.path.join(ann_dir, "*.json")))
    lots = {}
    for f in files:
        with open(f) as fh:
            doc = json.load(fh)
        if doc.get("format") != "smartpark-annotation/v1":
            continue
        lots[f] = doc["lot_id"]
    counts = defaultdict(int)
    for lot in lots.values():
        counts[lot] += 1
    by_lot = assign(dict(counts), **kw)
    result = {"by_lot": by_lot, "files": {s: [os.path.basename(f) for f, l in lots.items() if by_lot[l] == s] for s in ("train", "val", "test")}}
    # Proof of no leakage: no lot appears in two splits.
    seen = defaultdict(set)
    for f, l in lots.items():
        seen[l].add(by_lot[l])
    assert all(len(v) == 1 for v in seen.values()), "a lot ended up in two splits"
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--test", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--test-lots", default="")
    ap.add_argument("--val-lots", default="")
    a = ap.parse_args()
    r = split_dir(a.dir, val=a.val, test=a.test, seed=a.seed,
                  test_lots=[x for x in a.test_lots.split(",") if x], val_lots=[x for x in a.val_lots.split(",") if x])
    with open(os.path.join(a.dir, "splits.json"), "w") as f:
        json.dump(r, f, indent=1)
    for s in ("train", "val", "test"):
        lots = sorted(l for l, v in r["by_lot"].items() if v == s)
        print(f"{s:5} {len(r['files'][s]):5} pictures  {len(lots):3} lots  {', '.join(lots[:8])}{' ...' if len(lots) > 8 else ''}")
