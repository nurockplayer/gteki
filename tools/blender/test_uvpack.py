"""Contract checks for the stdlib lightmap rectangle packer (no Blender needed)."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("uvpack", Path(__file__).parent / "gteki_assets/uvpack.py")
uvpack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uvpack)


class PackingTests(unittest.TestCase):
    def check_layout(self, rects, gap):
        scale, placements = uvpack.pack_rectangles(rects, gap)
        self.assertEqual(len(placements), len(rects))
        bounds = []
        for index, x, y, rotate in placements:
            w, h = rects[index][::-1] if rotate else rects[index]
            w, h = w * scale, h * scale
            self.assertGreaterEqual(min(x, y), gap / 2 - 1e-12)
            self.assertLessEqual(max(x + w, y + h), 1 - gap / 2 + 1e-12)
            for a, b, c, d in bounds:
                self.assertTrue(x + w + gap <= a + 1e-12 or c + gap <= x + 1e-12
                                or y + h + gap <= b + 1e-12 or d + gap <= y + 1e-12)
            bounds.append((x, y, x + w, y + h))
        self.assertEqual((scale, placements), uvpack.pack_rectangles(rects, gap))
        return scale

    def test_four_squares(self):
        self.assertAlmostEqual(self.check_layout([(1, 1)] * 4, 0.1), 0.4, places=5)

    def test_mixed_thin_and_large_charts(self):
        self.check_layout([(8, 16), (7, 15), (8, 6)] * 2 + [(0.01, 1)] * 40, 5 / 256)

    def test_margin_alone_can_overflow(self):
        self.assertEqual(uvpack.pack_rectangles([(0.001, 0.001)] * 8, 0.5), (0.0, []))


if __name__ == "__main__":
    unittest.main()
