"""CPU-only #308 round-2 evidence; does not modify station assets or run Blender.

Forecast the exclusion against boxes already in the shipped bake. With the same
source geometry/grid these are the rebake candidates. Blender reports the actual
count; the forecast is not evidence that a rebake or GPU re-shoot happened.
"""
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fitting_exclusion import FittingExclusion, fitting_box
from sign_sightlines import ROOT, Sightlines, scene_polygons, sign_edge

# Positions/widths from round 1's parent (3220c24d), before sight-line relocation.
ROUND1_ORIGINAL = {
    'sign-w_13j-w_cj__w_13j-r': (-135.61, 122.067, 30.4, 6.0),
    'sign-w_13j-w_13j__w_w': (-143.39, 123.933, 30.4, 6.0),
    'sign-ne_j-ne_j__ne_m': (113.032, 104.974, 28.73, 6.0),
    'sign-place-sw_h__w_cj-5': (-127.255, 80.192, 30.4, 5.7),
}
ROUND2_ORIGINAL = {
    'sign-w_n-w_c__w_n-r': (-109.703, 147.381, 30.15, 6.0),
}
FACES = (('sign-place-sw_h__w_cj-4', 'back'),
         ('sign-rep-sw_h__w_cj-4', 'front'),
         ('sign-place-sw_h__w_cj-6', 'back'))


def summary(hits):
    return {'clear': not hits, 'eye_clear': not any(h['viewer'] == 'eye' for h in hits),
            'follow_clear': not any(h['viewer'] == 'follow' for h in hits),
            'blockers': sorted({(h['role'], h['id']) for h in hits}),
            'hit_points': sorted({(h['viewer'], *h['enu']) for h in hits})}


def fixture_forecast(polys, exclusion):
    groups = defaultdict(list)
    for role, name, poly in polys:
        if role == 'light_fixtures':
            node, triangle = name.rsplit(':', 1)
            groups[(node, int(triangle)//12)].append(poly)
    skipped, triggered = 0, Counter()
    # The current bake emits each six-quad box as 12 successive triangles.
    # Fail loudly if the mesh layout changes; do not guess a new grouping.
    for key, triangles in sorted(groups.items()):
        vertices = sorted({tuple(v) for tri in triangles for v in tri})
        assert len(triangles) == 12 and len(vertices) == 8, key
        center = [sum(v[k] for v in vertices)/8 for k in range(3)]
        yaw = math.pi/2 - math.radians(110)
        box = fitting_box(center, yaw)
        assert all(min(math.dist(v, b) for b in box) < 0.0001 for v in vertices), key
        blockers = exclusion.blockers(box)
        if blockers:
            skipped += 1
            triggered.update(blockers)
    return {'basis': 'shipped fitting boxes; unchanged bake source/grid assumed',
            'candidates': len(groups), 'skipped': skipped, 'retained': len(groups)-skipped,
            'triggered': [{'sign': sid, 'face': face, 'fittings': count}
                          for (sid, face), count in sorted(triggered.items())]}


def main():
    signs = json.loads((ROOT / 'scene/signage.json').read_text())['signs']
    by_id = {s['id']: s for s in signs}
    edges = {e['id']: e for e in json.loads((ROOT / 'gteki/graph.json').read_text())['edges']}
    polys = list(scene_polygons())
    shipped = Sightlines(polys)
    rebaked = Sightlines(polys, include_fittings=False)
    bare = Sightlines(polys, include_fittings=False, include_sleeves=False)
    report = {'signage_sha256': hashlib.sha256((ROOT / 'scene/signage.json').read_bytes()).hexdigest(),
              'fixture_forecast': fixture_forecast(polys, FittingExclusion(signs, edges)),
              'faces': [], 'round1_moves': []}
    meta = json.loads((ROOT / 'gteki/assets/ikebukuro_b1_lit.meta.json').read_text())
    source_hash = hashlib.sha256((ROOT / 'gteki/assets/ikebukuro_b1.glb').read_bytes()).hexdigest()
    report['fixture_forecast']['source_matches_shipped_bake'] = source_hash == meta['source_glb_sha256']
    report['fixture_forecast']['source_glb_sha256'] = source_hash
    report['fixture_forecast']['shipped_bake_source_glb_sha256'] = meta['source_glb_sha256']
    assert report['fixture_forecast']['candidates'] == meta['fixture_count']
    for sid, face in FACES:
        sign = by_id[sid]
        geom = sign_edge(sign, edges)['geometry']
        report['faces'].append({'sign': sid, 'face': face,
                                'a_fittings_removed_sleeves_on': summary(rebaked.blocked(geom, sign, (face,))),
                                'b_fittings_removed_bare_columns': summary(bare.blocked(geom, sign, (face,)))})
    for label, originals in (('round1_moves', ROUND1_ORIGINAL), ('round2_moves', ROUND2_ORIGINAL)):
        report[label] = []
        for sid, (x, y, z, width) in originals.items():
            sign = by_id[sid]
            old = {**sign, 'position': dict(x=x, y=y, z=z), 'maxWidthM': width}
            geom = sign_edge(sign, edges)['geometry']
            sides = ('front', 'back') if sign['back'] else ('front',)
            report[label].append({'sign': sid, 'original': old['position'], 'current': sign['position'],
                                  'reverted': old['position'] == sign['position'] and width == sign['maxWidthM'],
                                  'old_shipped': summary(shipped.blocked(geom, old, sides)),
                                  'old_without_fittings': summary(rebaked.blocked(geom, old, sides)),
                                  'old_bare': summary(bare.blocked(geom, old, sides)),
                                  'current_without_fittings': summary(rebaked.blocked(geom, sign, sides))})
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
