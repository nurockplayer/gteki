"""Node-only suite entrypoint also used by scene/signage.test.ts; no Blender/GPU."""
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_signage as placement
from sign_sightlines import ROOT, EYE_M, DEFAULT_PITCH, FOLLOW_DISTANCE, FOLLOW_LIFT, FOLLOW_SHOULDER, Sightlines, follow_envelope


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.geom = [{'x': 0, 'y': y, 'z': 0} for y in (0, 40)]
        self.sign = {'position': {'x': 0, 'y': 20, 'z': 2.49},
                     'facing': {'x': 0, 'y': -1}, 'scale': 1, 'maxWidthM': 4}

    def test_partial_strip_between_corner_and_center_rays_is_blocked(self):
        model = Sightlines([('light_fixtures', 'left-half-strip',
                             [(-1.6, 19, 2.39), (-1, 19, 2.39), (-1.3, 19, 2.41)])])
        self.assertTrue(model.blocked(self.geom, self.sign, ('front',), viewers=('eye',)))
        self.assertFalse(model.blocked(self.geom, self.sign, ('back',), viewers=('eye',)))

    def test_geometry_behind_face_or_outside_face_does_not_block(self):
        for tri in ([(-1, 22, 2), (1, 22, 2), (0, 22, 3)],
                    [(8, 19, 2), (9, 19, 2), (8, 19, 3)]):
            self.assertFalse(Sightlines([('wall', 'outside', tri)]).blocked(
                self.geom, self.sign, ('front',), viewers=('eye',)))

    def test_follow_camera_envelope_includes_nominal_pose(self):
        bounds = follow_envelope([(0, 10, 1.62), (0, 14, 1.62)], (0, 20, 2.49))
        self.assertGreater(max(p[2] for p in bounds), 2.49)
        self.assertLess(max(p[2] for p in bounds), 2.50)
        self.assertAlmostEqual(max(p[0] for p in bounds), 0.42)
        self.assertLess(min(p[1] for p in bounds), 7)

    def test_eye_and_follow_parameters_match_the_runtime(self):
        repo = ROOT.parent.parent
        checks = [('packages/scene-api/src/index.ts', 'eyeM', EYE_M),
                  ('apps/web/src/explorer/followCamera.ts', 'defaultDistance', FOLLOW_DISTANCE),
                  ('apps/web/src/explorer/followCamera.ts', 'lift', FOLLOW_LIFT),
                  ('apps/web/src/explorer/followCamera.ts', 'shoulder', FOLLOW_SHOULDER)]
        for file, key, value in checks:
            with self.subTest(parameter=key):
                self.assertEqual(float(re.search(r'\b' + key + r':\s*([\d.]+)', (repo / file).read_text())[1]), value)
        self.assertEqual(float(re.search(r'private pitch = (-?[\d.]+)',
                                        (repo / 'apps/web/src/explorer/explorer.ts').read_text())[1]), DEFAULT_PITCH)

    def test_chooser_uses_nearest_clear_candidate_and_retains_blocked_fallback(self):
        def position(*args):
            return (args[-1], 0, 2.25, 0, 1, 3, 6, 1)

        class Model:
            def __init__(self, clear):
                self.clear = clear

            def blocked(self, geom, sign, sides):
                return [] if sign['position']['x'] == self.clear else ['blocked']

        with patch.object(placement, 'place', position):
            args = ([], None, [], {}, [10, 11, 9, 12, 8])
            self.assertEqual(placement.choose_place(*args, Model(9))[1], 9)
            self.assertEqual(placement.choose_place(*args, Model(None))[1], 10)


class CommittedSightlines(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = Sightlines()
        cls.signs = {s['id']: s for s in json.loads((ROOT / 'scene/signage.json').read_text())['signs']}
        cls.geom = next(e['geometry'] for e in json.loads((ROOT / 'gteki/graph.json').read_text())['edges']
                        if e['id'] == 'sw_h__w_cj')

    def test_reported_faces_identify_the_actual_occluders(self):
        for sid, face, role in (
                ('sign-place-sw_h__w_cj-4', 'back', 'light_fixtures'),
                ('sign-rep-sw_h__w_cj-4', 'front', 'light_fixtures'),
                ('sign-place-sw_h__w_cj-6', 'back', 'barriers')):
            with self.subTest(sign=sid, face=face):
                hits = self.model.blocked(self.geom, self.signs[sid], (face,))
                self.assertTrue(any(h['role'] == role for h in hits), hits)
        hits = self.model.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-6'], ('back',))
        self.assertTrue(any(h['id'] == 'col_015' for h in hits))

    def test_moved_passage_board_is_clear_on_both_faces(self):
        self.assertEqual(self.model.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-5']), [])

    # #308: none of the existing legal candidates clears these faces. Keep the
    # requested acceptance assertions visible as expected failures, not as PASS
    # evidence. A fixture/spacing disposition and GPU re-shoot are still needed.
    @unittest.expectedFailure
    def test_place_4_back_is_clear(self):
        self.assertEqual(self.model.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-4'], ('back',)), [])

    @unittest.expectedFailure
    def test_repeat_4_front_is_clear(self):
        self.assertEqual(self.model.blocked(self.geom, self.signs['sign-rep-sw_h__w_cj-4'], ('front',)), [])

    @unittest.expectedFailure
    def test_place_6_back_is_clear(self):
        self.assertEqual(self.model.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-6'], ('back',)), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
