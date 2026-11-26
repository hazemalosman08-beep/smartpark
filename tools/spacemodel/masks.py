"""Training targets: picture + spaces -> square model input and class mask.

Classes: 0 background, 1 space interior, 2 space boundary. The boundary is the
outline of every space (painted lines, and the edge between two neighbouring
spaces even where no line is visible, e.g. under a car), so touching spaces
stay separate after segmentation.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

CLASSES = ["background", "interior", "boundary"]


def letterbox(img, size, fill=(0, 0, 0)):
    """Fit the picture into a square without stretching. Returns (image, scale, ox, oy)."""
    w, h = img.size
    scale = min(size / w, size / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    canvas = Image.new("RGB", (size, size), fill)
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.paste(img.resize((nw, nh), Image.BILINEAR), (ox, oy))
    return canvas, scale, ox, oy


def render(spaces, size, scale=1.0, ox=0, oy=0):
    """spaces: polygons in picture pixels -> uint8 mask (size x size)."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    polys = [[(x * scale + ox, y * scale + oy) for x, y in poly] for poly in spaces]
    for poly in polys:
        draw.polygon(poly, fill=1)
    for poly in polys:
        sides = [math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
        width = max(2, round(min(sides) * 0.1))
        draw.line(poly + [poly[0]], fill=2, width=width, joint="curve")
    return np.array(mask, dtype=np.uint8)


def sample(annotation, size, base_dir="."):
    """(input picture as uint8 HxWx3, mask HxW) for one annotation."""
    img = annotation.load_image(base_dir)
    boxed, scale, ox, oy = letterbox(img, size)
    mask = render([s.polygon for s in annotation.spaces], size, scale, ox, oy)
    return np.array(boxed, dtype=np.uint8), mask
