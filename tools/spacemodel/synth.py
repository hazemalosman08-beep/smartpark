"""Synthetic parking lots with exact annotations.

Licence-free practice data: random asphalt or concrete, single and
double-sided rows at any angle, straight or angled (slanted) spaces, white /
yellow / blue lines (some faded or missing), parked cars, shadows and planted
islands. Useful to pre-train before real data and to test the pipeline end to
end. It does NOT replace real pictures: a model trained only on these will not
work on real lots (the realism gap), and no accuracy claim should be based on it.

    python -m tools.spacemodel.synth <out_dir> --count 200 --lots 20
"""
from __future__ import annotations

import argparse
import base64
import io
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .annotation import Annotation, Space, save


def _rot(p, c, a):
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


def lot_picture(rng, size=512):
    """One synthetic picture -> (PIL image, [Space])."""
    W = H = size
    base = rng.choice([(70, 72, 75), (95, 96, 98), (120, 120, 118), (150, 148, 142), (55, 58, 62)])
    arr = np.clip(np.array(base, float)[None, None, :] + np.random.default_rng(rng.randrange(1 << 30)).normal(0, 7, (H, W, 1)), 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(img, "RGBA")
    # Cracks / patches.
    for _ in range(rng.randrange(0, 8)):
        x, y = rng.randrange(W), rng.randrange(H)
        d.line([(x, y), (x + rng.randrange(-120, 120), y + rng.randrange(-120, 120))], fill=(30, 30, 30, 120), width=1)
    colour = rng.choice([(235, 235, 230), (235, 200, 40), (240, 240, 240), (225, 190, 60)])
    angle = rng.uniform(0, math.pi) if rng.random() < 0.6 else rng.choice([0, math.pi / 2])
    sw = rng.uniform(16, 34)                 # space width (px)
    depth = sw * rng.uniform(1.8, 2.4)
    slant = 0 if rng.random() < 0.7 else rng.uniform(0.35, 0.8)  # angled spaces
    c = (W / 2, H / 2)
    spaces, lines = [], []
    y = -H * 0.6
    while y < H * 0.6:
        double = rng.random() < 0.7
        n = rng.randrange(6, 22)
        x0 = rng.uniform(-W * 0.7, -W * 0.2)
        faded = rng.random() < 0.25
        for half in ([0, 1] if double else [0]):
            ys = y + half * depth
            for k in range(n):
                xa = x0 + k * sw
                off = slant * depth * (1 if half == 0 else -1)
                if half == 0:
                    quad = [(xa + off, ys), (xa + sw + off, ys), (xa + sw, ys + depth), (xa, ys + depth)]
                else:
                    quad = [(xa, ys), (xa + sw, ys), (xa + sw + off, ys + depth), (xa + off, ys + depth)]
                quad = [_rot((p[0] + c[0], p[1] + c[1]), c, angle) for p in quad]
                if all(-5 <= p[0] <= W + 5 and -5 <= p[1] <= H + 5 for p in quad):
                    spaces.append(quad)
                # Dividers (both sides) and the back line.
                lines.append((quad[0], quad[3]))
                lines.append((quad[1], quad[2]))
            back = [_rot((x0 + c[0], ys + depth * (1 - half) + c[1]), c, angle), _rot((x0 + n * sw + c[0], ys + depth * (1 - half) + c[1]), c, angle)]
            lines.append(tuple(back))
        y += depth * (2 if double else 1) + rng.uniform(sw * 1.5, sw * 3.5)
        # Paint the row's lines.
        lw = max(1, round(sw * rng.uniform(0.06, 0.12)))
        for a, b in lines:
            if faded and rng.random() < 0.4:
                continue
            d.line([a, b], fill=colour + (rng.randrange(150, 255),), width=lw)
        lines = []
    # Islands.
    for _ in range(rng.randrange(0, 3)):
        x, yy = rng.randrange(W), rng.randrange(H)
        d.ellipse([x, yy, x + rng.randrange(20, 60), yy + rng.randrange(60, 200)], fill=(60, 110, 50, 255))
    # Accessible spaces: blue symbol in a few.
    for quad in rng.sample(spaces, k=min(len(spaces), rng.randrange(0, 3))):
        cx, cy = sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4
        r = sw * 0.22
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(60, 120, 220, 255))
    # Cars.
    occupied = []
    for quad in spaces:
        if rng.random() < rng.choice([0.1, 0.3, 0.6]):
            cx, cy = sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4
            a = math.atan2(quad[3][1] - quad[0][1], quad[3][0] - quad[0][0])
            L, Wc = depth * 0.8, sw * 0.72
            body = [_rot((cx + dx, cy + dy), (cx, cy), a) for dx, dy in [(-L / 2, -Wc / 2), (L / 2, -Wc / 2), (L / 2, Wc / 2), (-L / 2, Wc / 2)]]
            col = rng.choice([(200, 30, 30), (30, 30, 35), (230, 230, 230), (120, 125, 130), (30, 60, 140), (180, 180, 185)])
            d.polygon(body, fill=col + (255,))
            glass = [_rot((cx + dx, cy + dy), (cx, cy), a) for dx, dy in [(-L * 0.1, -Wc * 0.4), (L * 0.2, -Wc * 0.4), (L * 0.2, Wc * 0.4), (-L * 0.1, Wc * 0.4)]]
            d.polygon(glass, fill=(20, 25, 35, 230))
            occupied.append(True)
        else:
            occupied.append(False)
    # Shadows.
    for _ in range(rng.randrange(0, 4)):
        x, yy = rng.randrange(W), rng.randrange(H)
        sh = [(x, yy), (x + rng.randrange(40, 200), yy + rng.randrange(-40, 40)), (x + rng.randrange(60, 260), yy + rng.randrange(60, 300)), (x + rng.randrange(-40, 40), yy + rng.randrange(40, 260))]
        d.polygon(sh, fill=(0, 0, 0, rng.randrange(40, 110)))
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    return img, [Space(polygon=[list(p) for p in q], occupied=o, source="synthetic") for q, o in zip(spaces, occupied)]


def generate(out, count=200, lots=20, seed=0, size=512):
    rng = random.Random(seed)
    os.makedirs(out, exist_ok=True)
    for i in range(count):
        img, spaces = lot_picture(rng, size)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=92)
        url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        a = Annotation(lot_id=f"synth-{i % lots:03d}", width=size, height=size, spaces=spaces, view="overhead",
                       data_url=url, file_name=f"synth-{i:05d}.jpg", source_dataset="synthetic", licence="generated")
        save(a, os.path.join(out, f"synth-{i:05d}.json"))
    return count


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--lots", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    print(generate(a.out, a.count, a.lots, a.seed), "pictures")
