"""Tests for the training tools (no GPU needed; torch only for the model test).

    python -m unittest tools.spacemodel.test_tools -v
"""
import json
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

from .annotation import Annotation, Space, load, save, to_truth
from .convert import acpds
from .masks import render
from .split import assign, split_dir


class SplitTest(unittest.TestCase):
    def test_no_lot_in_two_splits_and_forced_test_lots(self):
        counts = {f"lot{i}": 1 + i % 7 for i in range(40)}
        out = assign(counts, val=0.15, test=0.2, seed=3, test_lots=["lot5"])
        self.assertEqual(out["lot5"], "test")
        self.assertEqual(set(out), set(counts))
        total = sum(counts.values())
        share = {s: sum(c for l, c in counts.items() if out[l] == s) / total for s in ("train", "val", "test")}
        self.assertGreater(share["train"], 0.5)
        self.assertGreater(share["test"], 0.1)
        self.assertEqual(out, assign(counts, val=0.15, test=0.2, seed=3, test_lots=["lot5"]), "reproducible")

    def test_split_dir_files(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(12):
                a = Annotation(lot_id=f"l{i // 3}", width=10, height=10, data_url="data:,", spaces=[])
                save(a, os.path.join(d, f"p{i}.json"))
            r = split_dir(d, val=0.25, test=0.25)
            for lot in {f"l{i}" for i in range(4)}:
                splits = {s for s, names in r["files"].items() for n in names if json.load(open(os.path.join(d, n)))["lot_id"] == lot}
                self.assertEqual(len(splits), 1, f"{lot} in {splits}")


class ConvertTest(unittest.TestCase):
    def test_acpds_layout(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
            os.makedirs(os.path.join(src, "images"))
            Image.new("RGB", (200, 100)).save(os.path.join(src, "images", "a.jpg"))
            quad = [[0.1, 0.2], [0.2, 0.2], [0.2, 0.6], [0.1, 0.6]]  # fractions
            ann = {"train": {"file_names": ["a.jpg"], "rois_list": [[quad]], "occupancy_list": [[1]]}, "valid": {"file_names": [], "rois_list": [], "occupancy_list": []}, "test": {"file_names": [], "rois_list": [], "occupancy_list": []}}
            json.dump(ann, open(os.path.join(src, "annotations.json"), "w"))
            self.assertEqual(acpds(src, out), 1)
            a = load(os.path.join(out, "acpds-train-a.json"))
            self.assertEqual(a.lot_id, "acpds-train")
            self.assertEqual(a.spaces[0].polygon[0], [20.0, 20.0])
            self.assertTrue(a.spaces[0].occupied)
            self.assertEqual(a.load_image(out).size, (200, 100))
            truth = to_truth(a, "a.jpg")
            self.assertEqual((truth["spaces"][0]["x"], truth["spaces"][0]["y"]), (30, 40))


class MaskAndDecodeTest(unittest.TestCase):
    def test_render_then_decode_gives_back_the_spaces(self):
        from .evaluate import decode, match
        spaces = [[[20 + 22 * k, 20], [40 + 22 * k, 20], [40 + 22 * k, 70], [20 + 22 * k, 70]] for k in range(5)]
        mask = render(spaces, 128)
        probs = np.stack([(mask == c).astype(np.float32) for c in range(3)])
        pred = decode(probs, min_area=20)
        tp, fp, fn = match([p for p, _ in pred], spaces, 0.5)
        self.assertEqual((tp, fp, fn), (5, 0, 0))


class ModelTest(unittest.TestCase):
    def test_model_shapes(self):
        try:
            import torch
            from .train import build_model
        except ImportError:
            self.skipTest("torch not installed")
        m = build_model(pretrained=False).eval()
        with torch.no_grad():
            y = m(torch.zeros(1, 3, 128, 128))
        self.assertEqual(tuple(y.shape), (1, 3, 128, 128))


if __name__ == "__main__":
    unittest.main()
