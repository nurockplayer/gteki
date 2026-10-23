"""Node-only suite entrypoint also used by scene/signage.test.ts; no Blender/GPU."""
import json
import math
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_signage as placement
from sign_sightlines import ROOT, EYE_M, DEFAULT_PITCH, FOLLOW_DISTANCE, FOLLOW_LIFT, FOLLOW_SHOULDER, Sightlines, follow_envelope, sign_edge
from report_sign_sightlines import ROUND1_ORIGINAL


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
                return [] if sign['position']['x'] == self.clear else [{'role': 'wall'}]

        with patch.object(placement, 'place', position):
            args = ([], None, [], {}, [10, 11, 9, 12, 8])
            self.assertEqual(placement.choose_place(*args, Model(9))[1], 9)
            self.assertEqual(placement.choose_place(*args, Model(None))[1], 10)

    def test_generated_geometry_cannot_initiate_a_sign_move(self):
        def position(*args):
            return (args[-1], 0, 2.25, 0, 1, 3, 6, 1)

        class Model:
            def __init__(self, role):
                self.role = role

            def blocked(self, geom, sign, sides):
                return [{'role': self.role}] if sign['position']['x'] == 10 else []

        with patch.object(placement, 'place', position):
            for role in ('light_fixtures', 'column_sleeve'):
                self.assertEqual(placement.choose_place([], None, [], {}, [10, 11], Model(role))[1], 10)

    def test_generated_exclusions_preserve_real_structure(self):
        tri = [(-1, 19, 2.3), (1, 19, 2.3), (0, 19, 2.5)]
        polys = [(role, role, tri) for role in ('light_fixtures', 'column_sleeve', 'barriers')]
        for sleeves, expected in ((True, {'column_sleeve', 'barriers'}), (False, {'barriers'})):
            model = Sightlines(polys, include_fittings=False, include_sleeves=sleeves)
            self.assertEqual({h['role'] for h in model.blocked(self.geom, self.sign, ('front',))}, expected)


class CommittedSightlines(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = Sightlines()
        cls.rebaked = Sightlines(include_fittings=False)
        cls.bare = Sightlines(include_fittings=False, include_sleeves=False)
        cls.signs = {s['id']: s for s in json.loads((ROOT / 'scene/signage.json').read_text())['signs']}
        cls.edges = {e['id']: e for e in json.loads((ROOT / 'gteki/graph.json').read_text())['edges']}
        cls.geom = cls.edges['sw_h__w_cj']['geometry']

    def test_exclusions_preserve_the_actual_structural_occluders(self):
        for sid, face in (('sign-place-sw_h__w_cj-4', 'back'),
                          ('sign-rep-sw_h__w_cj-4', 'front')):
            with self.subTest(sign=sid, face=face):
                hits = self.model.blocked(self.geom, self.signs[sid], (face,))
                self.assertEqual(self.rebaked.blocked(self.geom, self.signs[sid], (face,)),
                                 [h for h in hits if h['role'] != 'light_fixtures'])
        hits = self.model.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-6'], ('back',))
        self.assertTrue(any(h['role'] == 'barriers' for h in hits))
        self.assertTrue(any(h['id'] == 'col_015' for h in hits))

    def test_round1_fixture_only_moves_revert_and_structure_moves_remain(self):
        for sid, (x, y, z, width) in ROUND1_ORIGINAL.items():
            sign = self.signs[sid]
            old = {**sign, 'position': dict(x=x, y=y, z=z), 'maxWidthM': width}
            geom = sign_edge(sign, self.edges)['geometry']
            sides = ('front', 'back') if sign['back'] else ('front',)
            with self.subTest(sign=sid):
                if not self.bare.blocked(geom, old, sides):
                    self.assertEqual(sign['position'], old['position'])
                    self.assertEqual(sign['maxWidthM'], width)
                else:
                    self.assertNotEqual(sign['position'], old['position'])
                self.assertEqual(self.bare.blocked(geom, sign, sides), [])

    def test_moved_passage_board_is_clear_on_both_faces(self):
        self.assertEqual(self.rebaked.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-5']), [])

    # #308 condition (a): generated fittings removed by the rebake, sleeves on, from the walker's eye. That is the
    # view the GPU shoot read and the volume the rebake keeps clear. The follow camera's envelope still grazes
    # ceiling 4448/4449 and walls here: a camera clearance matter, not one a sign or a fitting can fix.
    def test_place_4_back_is_clear(self):
        self.assertEqual(self.rebaked.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-4'], ('back',), viewers=('eye',)), [])

    def test_repeat_4_front_is_clear(self):
        self.assertEqual(self.rebaked.blocked(self.geom, self.signs['sign-rep-sw_h__w_cj-4'], ('front',), viewers=('eye',)), [])

    def test_place_6_back_known_limitation_is_bare_plateau_column(self):
        # col_015 is PLATEAU EF_25 structure. Removing the generated fittings and
        # sleeve cannot clear this face; neither the sign nor the column moves.
        column = next(c for c in json.loads((ROOT / 'scene/columns.json').read_text())['columns']
                      if c['id'] == 'col_015')
        self.assertIn('ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_IntInstallation_EF_25',
                      column['source']['installations'])
        hits = self.bare.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-6'], ('back',))
        self.assertTrue(hits)
        self.assertFalse(any(h['role'] in {'light_fixtures', 'column_sleeve'} for h in hits))
        column_hits = [h for h in hits if h['role'] == 'barriers']
        self.assertTrue(column_hits, hits)
        cs, sn = math.cos(math.radians(column['rotation_deg'])), math.sin(math.radians(column['rotation_deg']))
        for hit in column_hits:
            dx, dy = (hit['enu'][k]-column['centre'][k] for k in range(2))
            self.assertLessEqual(abs(dx*cs+dy*sn), column['width']/2 + 0.003)
            self.assertLessEqual(abs(-dx*sn+dy*cs), column['depth']/2 + 0.003)
            self.assertTrue(column['base_z'] <= hit['enu'][2] <= column['top_z'])
        self.assertTrue(self.rebaked.blocked(self.geom, self.signs['sign-place-sw_h__w_cj-6'], ('back',)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
