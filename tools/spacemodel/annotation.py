"""SmartPark training annotations ("smartpark-annotation/v1").

One JSON file per picture:
    {
      "format": "smartpark-annotation/v1",
      "lot_id": "office-park-north",          # every picture of one lot shares it
      "image": {"file_name": ..., "width": W, "height": H, "data_url": "data:image/jpeg;base64,..."}
               (or "path": "images/x.jpg" relative to the JSON file),
      "view": "overhead" | "angled",
      "spaces": [{"polygon": [[x, y], ...4], "kind": "normal|accessible|reserved",
                  "occupied": true|false|null, "source": "hand|fill|lines|car|model|dataset",
                  "corrected": bool, "confidence": float|null}],
      "source_dataset": "smartpark|acpds|pklot|...", "licence": "..."
    }
Polygons are in pixels of the original picture; the first edge is the space's
front (short side). Written by the app (Export for training) and by the
converters in this folder.
"""
from __future__ import annotations

import base64
import io
import json
import os
from dataclasses import dataclass, field

FORMAT = "smartpark-annotation/v1"
KINDS = {"normal", "accessible", "reserved"}


@dataclass
class Space:
    polygon: list
    kind: str = "normal"
    occupied: object = None
    source: str = "dataset"
    corrected: bool = False
    confidence: object = None


@dataclass
class Annotation:
    lot_id: str
    width: int
    height: int
    spaces: list = field(default_factory=list)
    view: str = "overhead"
    image_path: str | None = None
    data_url: str | None = None
    file_name: str = "picture.jpg"
    source_dataset: str = "smartpark"
    licence: str = "own"

    def load_image(self, base_dir="."):
        """The picture as a PIL RGB image."""
        from PIL import Image
        if self.data_url:
            raw = base64.b64decode(self.data_url.split(",", 1)[1])
            return Image.open(io.BytesIO(raw)).convert("RGB")
        return Image.open(os.path.join(base_dir, self.image_path)).convert("RGB")

    def to_json(self):
        image = {"file_name": self.file_name, "width": self.width, "height": self.height}
        if self.data_url:
            image["data_url"] = self.data_url
        if self.image_path:
            image["path"] = self.image_path
        return {
            "format": FORMAT, "lot_id": self.lot_id, "view": self.view, "image": image,
            "source_dataset": self.source_dataset, "licence": self.licence,
            "spaces": [vars(s) for s in self.spaces],
        }


def validate(doc):
    """Raise ValueError if the document is not a usable annotation."""
    if doc.get("format") != FORMAT:
        raise ValueError(f"not {FORMAT}: {doc.get('format')!r}")
    if not doc.get("lot_id"):
        raise ValueError("lot_id is required (it decides the train/val/test split)")
    img = doc.get("image") or {}
    if not (img.get("width") and img.get("height")):
        raise ValueError("image width/height missing")
    if not (img.get("data_url") or img.get("path")):
        raise ValueError("image data_url or path missing")
    for i, s in enumerate(doc.get("spaces", [])):
        poly = s.get("polygon")
        if not poly or len(poly) < 3:
            raise ValueError(f"space {i}: polygon needs 3+ points")
        if s.get("kind", "normal") not in KINDS:
            raise ValueError(f"space {i}: unknown kind {s.get('kind')!r}")


def load(path):
    with open(path) as f:
        doc = json.load(f)
    validate(doc)
    img = doc["image"]
    return Annotation(
        lot_id=doc["lot_id"], width=int(img["width"]), height=int(img["height"]),
        view=doc.get("view", "overhead"), image_path=img.get("path"), data_url=img.get("data_url"),
        file_name=img.get("file_name", os.path.basename(path)),
        source_dataset=doc.get("source_dataset", "smartpark"), licence=doc.get("licence", "own"),
        spaces=[Space(polygon=[list(map(float, p)) for p in s["polygon"]], kind=s.get("kind", "normal"),
                      occupied=s.get("occupied"), source=s.get("source", "dataset"),
                      corrected=bool(s.get("corrected", False)), confidence=s.get("confidence"))
                for s in doc.get("spaces", [])],
    )


def save(annotation, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(annotation.to_json(), f)


def to_truth(annotation, image_name):
    """A regression answer key (test/accuracy/*.truth.json) from an annotation:
    the centre of every space, occupied, accessible."""
    spaces = []
    for i, s in enumerate(annotation.spaces):
        xs = [p[0] for p in s.polygon]
        ys = [p[1] for p in s.polygon]
        item = {"label": f"S{i + 1}", "x": round(sum(xs) / len(xs)), "y": round(sum(ys) / len(ys)), "occupied": bool(s.occupied)}
        if s.kind == "accessible":
            item["accessible"] = True
        spaces.append(item)
    return {"image": image_name, "width": annotation.width, "height": annotation.height, "view": annotation.view,
            "note": f"From annotation of lot {annotation.lot_id}", "spaces": spaces}
