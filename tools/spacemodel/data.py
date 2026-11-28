"""PyTorch dataset with augmentations aimed at unseen lots.

Augmentations (written here, no extra dependency): any rotation and flips
(drone pictures have no "up"), scale, white <-> yellow line colour swaps,
brightness / contrast / colour cast, cast shadows, blur and noise.

domain="satellite": every picture is scaled so a space is SPACE_PX pixels
wide (the app scales satellite images the same way, from the spacing its
rule-based finder measures), degraded to satellite sharpness (a space only
7-12 real pixels wide, then enlarged back; JPEG; blur), and cut into
size x size windows: a satellite lot is many small spaces, not one view.
"""
from __future__ import annotations

import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from .annotation import load
from .masks import letterbox, render

SPACE_PX = 16  # width of a space in the satellite model's input
MEAN = np.array([0.485, 0.456, 0.406], np.float32)


def space_width(polys):
    """Median short side of the spaces (pixels)."""
    w = []
    for p in polys:
        if len(p) < 4:
            continue
        a = math.dist(p[0], p[1]); b = math.dist(p[1], p[2])
        w.append(min(a, b))
    return float(np.median(w)) if w else 0.0


def satellite_view(img, polys, size, rng=None, centre=False):
    """Scale to SPACE_PX per space, degrade like satellite imagery, cut a
    size x size window (random, or the middle of the spaces when centre).
    Returns (img, polys) with img exactly size x size."""
    import io
    w0 = space_width(polys) or 30.0
    k = SPACE_PX / w0
    img = img.resize((max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k))), Image.BILINEAR)
    polys = [[[x * k, y * k] for x, y in p] for p in polys]
    # Satellite sharpness: the space is only 7-12 real pixels wide.
    real = rng.uniform(7, 12) if rng else 9.5
    d = real / SPACE_PX
    small = img.resize((max(1, round(img.size[0] * d)), max(1, round(img.size[1] * d))), Image.BILINEAR)
    buf = io.BytesIO()
    small.save(buf, "JPEG", quality=int(rng.uniform(45, 85)) if rng else 70)
    img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB").resize(img.size, Image.BILINEAR)
    W, H = img.size
    if centre and polys:
        xs = [x for p in polys for x, _ in p]; ys = [y for p in polys for _, y in p]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    elif rng and polys and rng.random() < 0.85:
        p = polys[rng.randrange(len(polys))]
        cx, cy = p[0][0] + rng.uniform(-size / 3, size / 3), p[0][1] + rng.uniform(-size / 3, size / 3)
    else:
        cx, cy = W / 2, H / 2
    x0, y0 = int(round(cx - size / 2)), int(round(cy - size / 2))
    out = Image.new("RGB", (size, size), (0, 0, 0))
    out.paste(img.crop((max(0, x0), max(0, y0), min(W, x0 + size), min(H, y0 + size))), (max(0, -x0), max(0, -y0)))
    polys = [[[x - x0, y - y0] for x, y in p] for p in polys]
    # Spaces mostly outside the window are dropped from the target.
    keep = []
    for p in polys:
        cxp = sum(x for x, _ in p) / len(p); cyp = sum(y for _, y in p) / len(p)
        if 0 <= cxp < size and 0 <= cyp < size:
            keep.append(p)
    return out, keep
STD = np.array([0.229, 0.224, 0.225], np.float32)


def files_for(ann_dir, split):
    with open(os.path.join(ann_dir, "splits.json")) as f:
        return [os.path.join(ann_dir, n) for n in json.load(f)["files"][split]]


class SpaceDataset:
    def __init__(self, files, size=512, augment=False, seed=0, domain="camera"):
        self.domain = domain
        self.items = [(f, load(f)) for f in files]
        self.size = size
        self.augment = augment
        self.rng = random.Random(seed)
        # Decoded pictures kept in memory (each DataLoader worker has its own).
        self.cache, self.cache_bytes, self.cache_budget = {}, 0, int(os.environ.get("SPACE_CACHE_MB", "1500")) * 1_000_000

    def __len__(self):
        return len(self.items)

    def _augment(self, img, polys):
        rng = self.rng
        w, h = img.size
        # Rotation about the centre (any angle) and flips.
        a = rng.uniform(-math.pi, math.pi) if rng.random() < 0.7 else 0.0
        if a:
            img = img.rotate(math.degrees(-a), resample=Image.BILINEAR, expand=True, fillcolor=(0, 0, 0))
            nw, nh = img.size
            cx, cy, ncx, ncy = w / 2, h / 2, nw / 2, nh / 2
            polys = [[[ncx + (x - cx) * math.cos(a) - (y - cy) * math.sin(a), ncy + (x - cx) * math.sin(a) + (y - cy) * math.cos(a)] for x, y in p] for p in polys]
            w, h = nw, nh
        if rng.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
            polys = [[[w - x, y] for x, y in p] for p in polys]
        # Scale (zoom in on part of the lot).
        if rng.random() < 0.5:
            s = rng.uniform(0.5, 1.0)
            cw, ch = int(w * s), int(h * s)
            x0, y0 = rng.randrange(0, w - cw + 1), rng.randrange(0, h - ch + 1)
            img = img.crop((x0, y0, x0 + cw, y0 + ch))
            polys = [[[x - x0, y - y0] for x, y in p] for p in polys]
        # Colour: line colour swap (white <-> yellow) through a channel mix.
        arr = np.asarray(img).astype(np.float32)
        if rng.random() < 0.3:
            bright = arr.mean(axis=2, keepdims=True)
            mix = np.clip((bright - 150) / 80, 0, 1)
            yellow = np.stack([arr[..., 0], arr[..., 1] * 0.9, arr[..., 2] * 0.35], axis=2)
            arr = arr * (1 - mix) + yellow * mix
        cast = np.array([rng.uniform(0.85, 1.15) for _ in range(3)], np.float32)
        arr = np.clip(arr * cast, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.6, 1.4))
        img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.6, 1.4))
        # Cast shadows.
        if rng.random() < 0.4:
            d = ImageDraw.Draw(img, "RGBA")
            for _ in range(rng.randrange(1, 4)):
                x, y = rng.randrange(img.size[0]), rng.randrange(img.size[1])
                pts = [(x + rng.randrange(-200, 200), y + rng.randrange(-200, 200)) for _ in range(4)]
                d.polygon(pts, fill=(0, 0, 0, rng.randrange(50, 130)))
        if rng.random() < 0.2:
            img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.5)))
        return img, polys

    def _picture(self, i):
        """The picture, shrunk to at most twice the model size (enough detail for
        augmentation), decoded once and kept in memory within a budget."""
        if i in self.cache:
            return self.cache[i]
        path, ann = self.items[i]
        img = ann.load_image(os.path.dirname(path))
        k = min(1.0, (self.size * 2) / max(img.size))
        if k < 1:
            img = img.resize((max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k))), Image.BILINEAR)
        polys = [[[x * k, y * k] for x, y in s.polygon] for s in ann.spaces]
        cost = img.size[0] * img.size[1] * 3
        if self.cache_bytes + cost <= self.cache_budget:
            self.cache[i] = (img, polys)
            self.cache_bytes += cost
        return img, polys

    def __getitem__(self, i):
        img, polys = self._picture(i)
        if self.domain == "satellite":
            # Augment first (rotation, colour, shadows…), then satellite view.
            if self.augment:
                img, polys = self._augment(img, polys)
            boxed, polys = satellite_view(img, polys, self.size, self.rng if self.augment else None, centre=not self.augment)
            scale, ox, oy = 1.0, 0, 0
        else:
            if self.augment:
                img, polys = self._augment(img, polys)
            boxed, scale, ox, oy = letterbox(img, self.size)
        mask = render(polys, self.size, scale, ox, oy)
        x = (np.asarray(boxed, np.float32) / 255.0 - MEAN) / STD
        if self.augment and self.rng.random() < 0.2:
            x = x + np.random.default_rng(self.rng.randrange(1 << 30)).normal(0, 0.05, x.shape).astype(np.float32)
        return x.transpose(2, 0, 1).copy(), mask.astype(np.int64)

    def truth(self, i):
        """Ground-truth spaces in model-input pixels (no augmentation), for metrics."""
        img, polys = self._picture(i)
        if self.domain == "satellite":
            _, keep = satellite_view(img, polys, self.size, None, centre=True)
            return self.items[i][1].lot_id, keep
        _, scale, ox, oy = letterbox(img, self.size)
        return self.items[i][1].lot_id, [[[x * scale + ox, y * scale + oy] for x, y in p] for p in polys]
