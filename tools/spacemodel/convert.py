"""Convert public datasets into SmartPark annotations.

    python -m tools.spacemodel.convert acpds  <acpds_dir>   <out_dir>
    python -m tools.spacemodel.convert pklot  <pklot_dir>   <out_dir> [--per-view 300]
    python -m tools.spacemodel.convert yolo-obb <dir> <out_dir> --lot-from parent --classes 0,1

Licences (check before use, see docs/hybrid-detection/RESEARCH.md):
    ACPDS  MIT (github.com/martin-marek/parking-space-occupancy)
    PKLot  CC BY 4.0 (cite Almeida et al. 2015)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import random
import xml.etree.ElementTree as ET

from .annotation import Annotation, Space, save


def _front_first(quad):
    """Reorder a quadrilateral so its first edge is a short side."""
    import math
    d01 = math.dist(quad[0], quad[1])
    d12 = math.dist(quad[1], quad[2])
    return quad if d01 <= d12 else quad[1:] + quad[:1]


def acpds(src, out):
    """ACPDS: annotations.json with train/valid/test, each {file_names, rois_list,
    occupancy_list}; rois are per-space 4x2 corners (fractions of the image or
    pixels — both handled). The authors' split keeps lots apart, so each split
    becomes one lot group ("acpds-train", ...), which keeps their separation."""
    from PIL import Image
    with open(os.path.join(src, "annotations.json")) as f:
        ann = json.load(f)
    n = 0
    for split, data in ann.items():
        for name, rois, occ in zip(data["file_names"], data["rois_list"], data["occupancy_list"]):
            path = os.path.join("images", name)
            w, h = Image.open(os.path.join(src, path)).size
            spaces = []
            for quad, o in zip(rois, occ):
                pts = [[float(x), float(y)] for x, y in quad]
                if max(max(p) for p in pts) <= 1.5:  # fractions of the picture
                    pts = [[x * w, y * h] for x, y in pts]
                spaces.append(Space(polygon=_front_first(pts), occupied=bool(o), source="dataset"))
            a = Annotation(lot_id=f"acpds-{split}", width=w, height=h, spaces=spaces, view="angled",
                           image_path=os.path.relpath(os.path.join(src, path), out), file_name=name,
                           source_dataset="acpds", licence="MIT")
            save(a, os.path.join(out, f"acpds-{split}-{os.path.splitext(name)[0]}.json"))
            n += 1
    return n


def pklot(src, out, per_view=300, seed=0):
    """PKLot: <lot>/<weather>/<day>/<image>.jpg with a .xml next to it:
    <parking><space id occupied><rotatedRect/><contour><point x y/>...</contour></space>.
    Lot id = camera view (UFPR04, UFPR05, PUCPR). Only `per_view` pictures per view
    are taken: thousands of frames of one view teach little and over-fit."""
    from PIL import Image
    rng = random.Random(seed)
    n = 0
    for view_dir in sorted(d for d in glob.glob(os.path.join(src, "*")) if os.path.isdir(d)):
        view = os.path.basename(view_dir)
        xmls = sorted(glob.glob(os.path.join(view_dir, "**", "*.xml"), recursive=True))
        rng.shuffle(xmls)
        for xml in xmls[:per_view]:
            img = xml[:-4] + ".jpg"
            if not os.path.exists(img):
                continue
            w, h = Image.open(img).size
            spaces = []
            for sp in ET.parse(xml).getroot().iter("space"):
                pts = [[float(p.get("x")), float(p.get("y"))] for p in sp.iter("point")]
                if len(pts) < 4:
                    continue
                occ = sp.get("occupied")
                spaces.append(Space(polygon=_front_first(pts[:4]), occupied=None if occ is None else occ == "1", source="dataset"))
            a = Annotation(lot_id=f"pklot-{view.lower()}", width=w, height=h, spaces=spaces, view="angled",
                           image_path=os.path.relpath(img, out), file_name=os.path.basename(img),
                           source_dataset="pklot", licence="CC-BY-4.0")
            save(a, os.path.join(out, f"pklot-{view.lower()}-{os.path.splitext(os.path.basename(img))[0]}.json"))
            n += 1
    return n


def yolo_obb(src, out, classes=(0,), lot_from="parent", licence="check", name="dataset"):
    """YOLO-OBB text labels ("cls x1 y1 x2 y2 x3 y3 x4 y4", normalised), images
    next to them or in a sibling images/ folder. `classes` lists the class ids
    that are parking spaces. lot_from="parent" uses the folder name as lot id;
    "prefix" uses the file name up to the first "_"."""
    from PIL import Image
    n = 0
    for txt in sorted(glob.glob(os.path.join(src, "**", "*.txt"), recursive=True)):
        stem = os.path.splitext(txt)[0]
        img = next((p for ext in (".jpg", ".png", ".jpeg", ".tif") for p in (stem + ext, stem.replace("labels", "images") + ext) if os.path.exists(p)), None)
        if not img:
            continue
        w, h = Image.open(img).size
        spaces = []
        for line in open(txt):
            parts = line.split()
            if len(parts) < 9 or int(float(parts[0])) not in classes:
                continue
            v = list(map(float, parts[1:9]))
            pts = [[v[i] * w, v[i + 1] * h] for i in range(0, 8, 2)]
            spaces.append(Space(polygon=_front_first(pts), source="dataset"))
        lot = os.path.basename(os.path.dirname(txt)) if lot_from == "parent" else os.path.basename(stem).split("_")[0]
        a = Annotation(lot_id=f"{name}-{lot}", width=w, height=h, spaces=spaces, view="overhead",
                       image_path=os.path.relpath(img, out), file_name=os.path.basename(img),
                       source_dataset=name, licence=licence)
        save(a, os.path.join(out, f"{name}-{os.path.basename(stem)}.json"))
        n += 1
    return n


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["acpds", "pklot", "yolo-obb"])
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--per-view", type=int, default=300)
    ap.add_argument("--classes", default="0")
    ap.add_argument("--lot-from", default="parent")
    ap.add_argument("--licence", default="check")
    ap.add_argument("--name", default="dataset")
    a = ap.parse_args()
    if a.kind == "acpds":
        print(acpds(a.src, a.out), "pictures")
    elif a.kind == "pklot":
        print(pklot(a.src, a.out, a.per_view), "pictures")
    else:
        print(yolo_obb(a.src, a.out, tuple(int(c) for c in a.classes.split(",")), a.lot_from, a.licence, a.name), "pictures")
