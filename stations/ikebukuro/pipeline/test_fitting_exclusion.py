"""Pure Python fitting exclusion tests; no bpy, rendering, or fixture rebake."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fitting_exclusion import BOX_CORNERS, BOX_FACES, FittingExclusion, fitting_box
from sign_sightlines import Sightlines


class FittingExclusionTests(unittest.TestCase):
    def setUp(self):
        self.geom = [{'x': 0, 'y': y, 'z': 0} for y in (0, 40)]
        self.sign = {'id': 'sign-a-a__b', 'position': {'x': 0, 'y': 20, 'z': 2.49},
                     'facing': {'x': 0, 'y': -1}, 'maxWidthM': 4, 'back': [{}]}
        self.edges = {'a__b': {'verification': 'verified', 'geometry': self.geom}}

    def test_partial_box_intersection_and_both_faces(self):
        exclusion = FittingExclusion([self.sign], self.edges)
        for y, face in ((19, 'front'), (21, 'back')):
            with self.subTest(face=face):
                # Center outside the painted width; only an end crosses it.
                box = fitting_box((2.3, y, 2.4), math.pi/6)
                self.assertEqual(exclusion.blockers(box), [(self.sign['id'], face)])
                polys = [('light_fixtures', 'test', [box[i] for i in ids]) for ids in BOX_FACES]
                self.assertTrue(Sightlines(polys).blocked(self.geom, self.sign, (face,)))

    def test_eye_volume_only_and_clear_fittings(self):
        exclusion = FittingExclusion([self.sign], self.edges)
        box = fitting_box((0, 14, 2.4), 0)
        polys = [('light_fixtures', 'test', [box[i] for i in ids]) for ids in BOX_FACES]
        self.assertFalse(Sightlines(polys).blocked(self.geom, self.sign, ('front',), viewers=('eye',)))
        self.assertTrue(Sightlines(polys).blocked(self.geom, self.sign, ('front',), viewers=('follow',)))
        # Only the walker's eye volume excludes fittings; the follow envelope alone keeps them.
        self.assertEqual(exclusion.blockers(box), [])
        self.assertEqual(FittingExclusion([self.sign], self.edges, viewers=('eye', 'follow')).blockers(box), [(self.sign['id'], 'front')])
        for center in ((8, 19, 2.4), (0, 19, 5), (0, 38, 2.4)):
            self.assertEqual(exclusion.blockers(fitting_box(center, 0)), [])

    def test_no_back_face_is_not_excluded(self):
        self.sign['back'] = []
        exclusion = FittingExclusion([self.sign], self.edges)
        self.assertEqual(exclusion.blockers(fitting_box((0, 21, 2.4), 0)), [])

    def test_containment_in_both_directions(self):
        exclusion = FittingExclusion([self.sign], self.edges)
        self.assertEqual(exclusion.blockers(fitting_box((0, 19, 2.4), 0)),
                         [(self.sign['id'], 'front')])
        # Volume entirely inside a box: no box surface crosses the volume.
        huge_box = [(x*30, 20+y*30, 2+z*30) for x, y, z in BOX_CORNERS]
        self.assertEqual(exclusion.blockers(huge_box),
                         [(self.sign['id'], 'back'), (self.sign['id'], 'front')])

    def test_unverified_edge_fails_closed(self):
        self.edges['a__b']['verification'] = 'inferred'
        with self.assertRaises(ValueError):
            FittingExclusion([self.sign], self.edges)


if __name__ == '__main__':
    unittest.main(verbosity=2)
