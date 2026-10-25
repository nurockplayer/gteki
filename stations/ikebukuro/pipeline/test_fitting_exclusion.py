"""Pure Python fitting exclusion tests; no bpy, rendering, or fixture rebake."""
import json
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fitting_exclusion import BOX_CORNERS, BOX_FACES, FittingExclusion, fitting_box
from sign_sightlines import ROOT, Sightlines


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

    def test_eye_and_nominal_follow_volumes_and_clear_fittings(self):
        exclusion = FittingExclusion([self.sign], self.edges)
        box = fitting_box((0, 14, 2.4), 0)
        polys = [('light_fixtures', 'test', [box[i] for i in ids]) for ids in BOX_FACES]
        self.assertFalse(Sightlines(polys).blocked(self.geom, self.sign, ('front',), viewers=('eye',)))
        self.assertTrue(Sightlines(polys).blocked(self.geom, self.sign, ('front',), viewers=('follow',)))
        self.assertEqual(FittingExclusion([self.sign], self.edges, viewers=('eye',)).blockers(box), [])
        self.assertEqual(exclusion.blockers(box), [(self.sign['id'], 'front')])
        self.assertEqual(FittingExclusion([self.sign], self.edges, viewers=('eye', 'follow')).blockers(box), [(self.sign['id'], 'front')])
        for center in ((8, 19, 2.4), (0, 19, 5), (0, 38, 2.4)):
            self.assertEqual(exclusion.blockers(fitting_box(center, 0)), [])

    def test_broad_follow_envelope_alone_does_not_exclude_a_fitting(self):
        box = fitting_box((0, 10, 1.8), 0)
        self.assertEqual(FittingExclusion([self.sign], self.edges).blockers(box), [])
        self.assertTrue(FittingExclusion([self.sign], self.edges, viewers=('follow',)).blockers(box))

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


class CommittedProbeFittings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.signs = json.loads((ROOT / 'scene/signage.json').read_text())['signs']
        cls.edges = {e['id']: e for e in json.loads((ROOT / 'gteki/graph.json').read_text())['edges']}
        cls.exclusion = FittingExclusion(cls.signs, cls.edges)

    def test_the_two_4_faces_exclude_the_measured_blocking_strip(self):
        # Shipped fitting 274, ENU centre measured from its eight GLB vertices.
        # Keep this candidate even after the lead rebakes it out of the asset.
        box = fitting_box((-125.6749038696289, 61.704593658447266, 30.34600067138672), -math.pi/9)
        expected = [('sign-place-sw_h__w_cj-4', 'back'), ('sign-rep-sw_h__w_cj-4', 'front')]
        self.assertEqual(self.exclusion.blockers(box), expected)
        self.assertEqual(FittingExclusion(self.signs, self.edges, viewers=('eye',)).blockers(box), [])
        for distance in (6.0, 10.0):
            geom = self.edges['sw_h__w_cj']['geometry']
            polys = [('light_fixtures', 'measured-274', [box[i] for i in ids]) for ids in BOX_FACES]
            for sid, face in expected:
                sign = next(s for s in self.signs if s['id'] == sid)
                with self.subTest(sign=sid, distance=distance):
                    self.assertTrue(Sightlines(polys).blocked(geom, sign, (face,), (distance, distance),
                                                             viewers=('follow_nominal',)))

    def test_adjacent_strip_blocks_only_the_place_board(self):
        # Shipped fitting 259: the broad audit envelope also reaches the repeater,
        # but the nominal camera-to-face volume does not.
        box = fitting_box((-127.93018531799316, 62.525447845458984, 30.34600067138672), -math.pi/9)
        self.assertEqual(self.exclusion.blockers(box), [('sign-place-sw_h__w_cj-4', 'back')])

    def test_fitting_well_away_from_every_face_is_kept(self):
        self.assertEqual(self.exclusion.blockers(fitting_box((1000, 1000, 30.346), -math.pi/9)), [])
        # Shipped fitting 272 is near place-4, but is above the sight lines.
        self.assertEqual(self.exclusion.blockers(fitting_box((-127.72703, 56.066437, 30.950001), -math.pi/9)), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
