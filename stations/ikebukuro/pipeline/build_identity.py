"""GTEki identity boards (#342), stdlib only; --check verifies committed placements.

Uses build_signage's ceiling/wall fit against shipped PLATEAU triangles, then
sign_sightlines' continuous face envelope with fittings excluded. Coordinates
are presentation choices, never surveyed sign locations or route evidence.
"""
import argparse
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_signage as placement
from build_station import build_instant
from floorquery import Surfaces
from sign_sightlines import Sightlines, scene_polygons

ROOT = Path(__file__).resolve().parent.parent
OSM = 'osm-ikebukuro-station-refs-2026-10'
MEETING = 'ikefukuro-location-references-2026-10'
PLATEAU = 'plateau-ubld-13116'
TRANSFER = 'JR 山手線 Yamanote JY13 · 埼京線 Saikyo JA12 · 湘南新宿ライン Shonan-Shinjuku JS21 · 丸ノ内線 Marunouchi M25 · 有楽町線 Yurakucho Y09 · 副都心線 Fukutoshin F09'
# Authored placement directions, matching scene suggestions; Explorer.walkFromNode uses 0 instead.
SPAWNS = {'c_mid': 100, 'c_e2': 100, 'n_h': 95, 'sp_e': 92, 'w_c': 340, 'sw_h': 110}
# Three further main-passage junctions (degree >= 3); ten boards including the meeting marker.
JUNCTIONS = {'c_e1': 100, 'c_n': 95, 'sp_m': 92}


def read(path):
    return json.loads((ROOT / path).read_text())


def write(path, value, indent=2):
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, indent=indent) + '\n')


def geometry():
    polygons = list(scene_polygons(include_fittings=False))
    ceil = Surfaces.__new__(Surfaces)
    ceil.polys, ceil.grid = [], {}
    segs, grid = [], {}
    for role, _, poly in polygons:
        if role == 'ceiling':
            ceil._add('ceiling', {'outer': poly, 'holes': []})
        elif role in {'wall', 'barriers', 'column_sleeve'}:
            a, b = max(((a, b) for a in poly for b in poly), key=lambda p: math.dist(p[0][:2], p[1][:2]))
            i = len(segs)
            segs.append((*a[:2], *b[:2], min(p[2] for p in poly), max(p[2] for p in poly)))
            for x in range(math.floor(min(a[0], b[0])/4), math.floor(max(a[0], b[0])/4)+1):
                for y in range(math.floor(min(a[1], b[1])/4), math.floor(max(a[1], b[1])/4)+1):
                    grid.setdefault((x, y), []).append(i)
    for i, (_, _, _, _, bb) in enumerate(ceil.polys):
        for x in range(math.floor(bb[0]/4), math.floor(bb[1]/4)+1):
            for y in range(math.floor(bb[2]/4), math.floor(bb[3]/4)+1):
                ceil.grid.setdefault((x, y), []).append(i)
    # Existing sign faces are opaque potential blockers too, not just positions.
    for sign in read('scene/signage.json')['signs']:
        f, p = sign['facing'], sign['position']
        norm = math.hypot(f['x'], f['y'])
        fx, fy = f['x']/norm, f['y']/norm
        half = sign['maxWidthM']/2
        height = 0.42*sign.get('scale', 1)/2
        poly = [(p['x']-fy*x, p['y']+fx*x, p['z']+z) for x, z in [(-half,-height), (half,-height), (half,height), (-half,height)]]
        polygons.append(('existing-sign', sign['id'], poly))
    return ceil, segs, grid, Sightlines(polygons, include_fittings=False)


def view_geometry(node, heading):
    p = node['position']
    dx, dy = math.sin(math.radians(heading)), math.cos(math.radians(heading))
    return [p, {'x': p['x']+dx*12, 'y': p['y']+dy*12, 'z': p['z']}]


def sight_sign(board):
    return {**board, 'maxWidthM': board['widthM'], 'scale': board['heightM']/0.42}


def wall_fit(geom, ceil, segs, grid, width):
    p, end = geom
    dx, dy = (end['x']-p['x'])/12, (end['y']-p['y'])/12
    d = placement.wall_hit(segs, grid, p['x'], p['y'], dx, dy, p['z']+1.4, p['z']+2.1, maxd=6)
    if d >= 6 or d < 0.6:
        return None
    hx, hy = p['x']+dx*d, p['y']+dy*d
    candidates = []
    for ax, ay, bx, by, lo, hi in segs:
        length = math.hypot(bx-ax, by-ay)
        if not length or hi < p['z']+1.4 or lo > p['z']+2.1:
            continue
        t = max(0, min(1, ((hx-ax)*(bx-ax)+(hy-ay)*(by-ay))/length**2))
        distance = math.hypot(hx-ax-t*(bx-ax), hy-ay-t*(by-ay))
        if distance < 0.01:
            nx, ny = -(by-ay)/length, (bx-ax)/length
            if nx*(p['x']-hx)+ny*(p['y']-hy) < 0:
                nx, ny = -nx, -ny
            candidates.append((distance, nx, ny))
    if not candidates:
        return None
    _, nx, ny = min(candidates)
    x, y = hx+nx*0.08, hy+ny*0.08
    ceiling = placement.lowest_ceiling(ceil, x-dy*0.6, y+dx*0.6, x+dy*0.6, y-dx*0.6, p['z']+0.3)
    return x, y, p['z']+1.50, -nx, -ny, ceiling, width, 0.7


def direct_place(geom, ceil, segs, grid, distance, width, outer_h, clearance):
    """Same wall/ceiling machinery without re-centring across a bent passage."""
    p, end = geom
    dx, dy = (end['x']-p['x'])/12, (end['y']-p['y'])/12
    x, y = p['x']+dx*distance, p['y']+dy*distance
    ceiling = placement.lowest_ceiling(ceil, x-dy*width/2, y+dx*width/2,
                                       x+dy*width/2, y-dx*width/2, p['z']+0.3)
    if ceiling is None:
        return None
    bottom = max(p['z']+2, min(p['z']+clearance, ceiling-outer_h-0.02))
    if bottom+outer_h > ceiling-0.019:
        return None
    for rx, ry in [(dy, -dx), (-dy, dx)]:
        if placement.wall_hit(segs, grid, x, y, rx, ry, bottom, bottom+outer_h) < width/2+0.15:
            return None
    return x, y, bottom, dx, dy, ceiling, width, 1


def hits(sight, geom, board):
    # Placement-only sightline from the 1.62 m eye along the authored board direction.
    # The unconstrained follow envelope can cross walls behind a spawn; runtime
    # boom collision/raising requires a separate rendered acceptance check.
    d = math.dist(tuple(geom[0][k] for k in ('x', 'y')), tuple(board['position'][k] for k in ('x', 'y')))
    return sight.blocked(geom, sight_sign(board), sides=('front',), distances=(d, d), viewers=('eye',))


def marker_view(board, floor):
    p, f = board['position'], board['facing']
    return [{'x': p['x']+f['x']*3, 'y': p['y']+f['y']*3, 'z': floor},
            {'x': p['x']-f['x'], 'y': p['y']-f['y'], 'z': floor}]


def in_phone_view(board, node, heading):
    """Placement-only authored view; not Explorer's opening camera. 390x844, 60 deg.

    Actual glyph widths remain a renderer acceptance item; the test uses the
    existing atlas CJK/Latin width estimator and checks the projected ink box.
    """
    # One 3.4 x 0.54 m artwork, uniformly fitted inside each board (same as signs.ts).
    # The extra panel height is a solid margin, never a vertical glyph stretch.
    scale = min(board['widthM']/3.4, board['heightM']/0.54)
    h = 0.54*scale
    name_scale = 0.8 if board['widthM'] > 2 else 1.12
    shift = 0.03*h if name_scale > 1 else 0
    jp, en, kana = h*0.56*name_scale, h*0.40*name_scale, h*0.15*name_scale
    lo = -(2*jp+9*0.56*en+0.08*scale*name_scale)/2
    en_x = lo+2*jp+0.08*scale*name_scale
    hi = max(en_x+9*0.56*en, en_x+5*kana)
    jy, ey, ky = 0.43, 0.50, 0.18
    ylo = min((0.5-jy)*h*name_scale-jp/2, (0.5-ey)*h*name_scale-en/2)+shift
    yhi = max((0.5-jy)*h*name_scale+jp/2, (0.5-ky)*h*name_scale+kana/2)+shift
    angle, pitch = math.radians(heading), -0.12
    dx, dy = math.sin(angle), math.cos(angle)
    normal = board['facing']
    right = (-normal['y'], normal['x'])
    origin = node['position']
    for x in (lo, hi):
        for y in (ylo, yhi):
            v = (board['position']['x']+x*right[0]+0.042*normal['x']-origin['x'],
                 board['position']['y']+x*right[1]+0.042*normal['y']-origin['y'],
                 board['position']['z']+y-origin['z']-1.62)
            depth = (v[0]*dx+v[1]*dy)*math.cos(pitch)+v[2]*math.sin(pitch)
            across = v[0]*dy-v[1]*dx
            up = -(v[0]*dx+v[1]*dy)*math.sin(pitch)+v[2]*math.cos(pitch)
            if depth <= 0 or abs(across/depth/math.tan(math.pi/6)/(390/844)) > 0.98 or abs(up/depth/math.tan(math.pi/6)) > 0.98:
                return False
    for em_m, cy, cx, minimum in [(jp, jy, lo, 18), (en, ey, en_x, 12)]:
        projected = []
        for side in (-1, 1):
            z = board['position']['z']+(0.5-cy)*h*name_scale+shift+side*em_m*0.7/2-origin['z']-1.62
            vx = board['position']['x']+cx*right[0]+0.042*normal['x']-origin['x']
            vy = board['position']['y']+cx*right[1]+0.042*normal['y']-origin['y']
            depth = (vx*dx+vy*dy)*math.cos(pitch)+z*math.sin(pitch)
            up = -(vx*dx+vy*dy)*math.sin(pitch)+z*math.cos(pitch)
            projected.append(up/depth/math.tan(math.pi/6)*844/2)
        if abs(projected[1]-projected[0]) < minimum:
            return False
    return True


def generate():
    graph = read('gteki/graph.json')
    nodes = {n['id']: n for n in graph['nodes']}
    signs = read('scene/signage.json')['signs']
    ceil, segs, grid, sight = geometry()
    placement.SIGN_H, placement.MIN_SIGN_H, placement.MAX_SIGN_W = 0.60, 0.25, 3.4
    boards = []
    for nid, heading in {**SPAWNS, **JUNCTIONS}.items():
        geom = view_geometry(nodes[nid], heading)
        failures = []
        candidates = [(d, w, ph, clearance, delta) for delta in [0, -5, 5, -10, 10]
                      for d in [3.2, 2.8, 3.6, 2.4, 2.0, 1.6, 1.2, 4.0, 4.4, 4.8, 5.2, 5.6, 6.0]
                      for ph, clearance in [(0.60, 2.25), (0.45, 2.0), (0.30, 2.0)] for w in [3.4, 3.0, 2.6, 1.8, 1.2]]
        # A wall-facing spawn can use its nearby wall immediately.
        if nid == 'n_h':
            candidates = [(0, w, 0.60, 2.25, 0) for w in [1.2, 0.85, 0.6]] + candidates
        else:
            candidates += [(0, w, 0.60, 2.25, 0) for w in [2.2, 1.8, 1.2, 0.85, 0.6]]
        for d, max_width, profile_h, clearance, delta in candidates:
            geom = view_geometry(nodes[nid], heading+delta)
            placement.MAX_SIGN_W = max_width
            placement.SIGN_H, placement.CLEAR_BELOW_SIGN = profile_h, clearance
            fit = (direct_place(geom, ceil, segs, grid, d, max_width, profile_h, clearance)
                   or placement.place(geom, ceil, segs, grid, d)) if d else wall_fit(geom, ceil, segs, grid, max_width)
            if fit is None:
                failures.append({'distance': d, 'reason': 'ceiling fit'})
                continue
            x, y, bottom, dx, dy, ceiling, width, scale = fit
            if width < 0.6:
                failures.append({'distance': d, 'reason': f'width {width}'})
                continue
            height = profile_h * 0.90 * scale
            board = {'id': f'identity-{nid}', 'anchor': {'nodeId': nid}, 'kind': 'station-name',
                     'text': {'ja': '池袋', 'kana': 'いけぶくろ', 'en': 'Ikebukuro', 'transfer': TRANSFER},
                     'sourceIds': [OSM, PLATEAU], 'textVerification': 'VERIFIED',
                     'position': dict(zip(('x', 'y', 'z'), (round(x, 3), round(y, 3), round(bottom+profile_h/2*scale, 3)))),
                     'facing': {'x': round(-dx, 4), 'y': round(-dy, 4)},
                     'widthM': round(width, 3), 'heightM': round(height, 3), 'ceilingZ': ceiling,
                     'mount': 'ceiling' if d else 'wall',
                     'headingDeg': heading, 'placement': 'GTEki-authored, not a surveyed sign location'}
            if not in_phone_view(board, nodes[nid], heading):
                failures.append({'distance': d, 'reason': 'phone framing'})
                continue
            # Physical separation, independent of whether an existing sign is readable from here.
            if any(math.hypot(s['position']['x']-x, s['position']['y']-y) < 1.0 for s in signs+boards):
                continue
            blocked = hits(sight, view_geometry(nodes[nid], heading), board)
            if blocked:
                failures.extend(blocked[:1])
                continue
            boards.append(board)
            break
        else:
            raise ValueError(f'No clear identity placement for {nid}: {failures[-10:]}')
    # The factual marker is on the east/Exit-22 side of North Passage; no statue or likeness.
    nid, heading = 'n_c', 102
    geom = view_geometry(nodes[nid], heading)
    placement.MAX_SIGN_W = 3.4
    placement.SIGN_H, placement.CLEAR_BELOW_SIGN = 0.60, 2.25
    geom[1] = {**geom[1], 'x': geom[0]['x']+(geom[1]['x']-geom[0]['x'])*2, 'y': geom[0]['y']+(geom[1]['y']-geom[0]['y'])*2}
    for d in [4.4, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0]:
        fit = placement.place(geom, ceil, segs, grid, d)
        if fit is None:
            continue
        x, y, bottom, dx, dy, ceiling, width, scale = fit
        if ceiling is None:
            continue
        board = {'id': 'meeting-ikefukuro', 'anchor': {'edgeId': 'n_c__n_e'}, 'kind': 'meeting-point',
                 'text': {'ja': 'いけふくろう', 'en': 'Ikefukuro meeting point',
                          'location': 'B1 北通路 東側 · JR 北改札・22番出口付近',
                          'locationEn': 'B1 North Passage east · near JR North Gate / Exit 22',
                          'status': '位置は概略 / Approximate location'},
                 'sourceIds': [MEETING, PLATEAU], 'textVerification': 'APPROXIMATE',
                 'position': {'x': round(x, 3), 'y': round(y, 3), 'z': round(bottom+0.30*scale, 3)},
                 'facing': {'x': round(-dx, 4), 'y': round(-dy, 4)},
                 'widthM': round(min(width, 3.4), 3), 'heightM': round(0.54*scale, 3), 'ceilingZ': ceiling,
                 'headingDeg': heading,
                 'placement': 'GTEki-authored, not a surveyed sign location'}
        if not hits(sight, marker_view(board, nodes[nid]['position']['z']), board):
            boards.append(board)
            break
    else:
        raise ValueError('No clear meeting-point placement')
    write('scene/identity.json', {'schema': 'gteki.identity/0.1', 'boards': boards})
    update_sources(boards)
    return boards


def update_sources(boards):
    osm = {'id': OSM, 'title': 'OpenStreetMap Ikebukuro station names and transfer references',
           'publisher': 'OpenStreetMap contributors', 'url': 'https://www.openstreetmap.org/copyright',
           'license': {'name': 'ODbL 1.0', 'url': 'https://opendatacommons.org/licenses/odbl/1-0/'},
           'rights': 'REUSABLE_WITH_CONDITIONS', 'attribution': '© OpenStreetMap contributors',
           'modified': True, 'retrievedAt': '2026-10-23T15:15:00Z', 'datasetDate': None,
           'gteki_role': 'context', 'navigation_use': 'NOT_FOR_ROUTING', 'visual_only': True,
           'derivation': 'api.openstreetmap.org/api/0.6, retrieved 2026-10-23T15:15Z: node 2558121915 v35 (2026-06-18), 池袋 / Ikebukuro, operator 東日本旅客鉄道, ref JA12;JS21;JY13; relation 9240336 v13 Marunouchi M25; relation 9240281 v12 Yurakucho Y09; relation 7967610 v17 Fukutoshin F09. Additional route-relation facts retrieved 2026-10-24 (time unspecified): relation 1972920 v130 (2026-10-08), type=route route=train ref=JY name=JR山手線 operator=東日本旅客鉄道 (1972960 v134 is the other direction); relation 21361895 v7 (2026-10-05), ref=JA name=JR埼京線 (新宿 → 大宮); relation 4684034 v138 (2026-10-10), ref=JS name=湘南新宿ライン. Plain-text line names paired with the station node refs: 山手線 Yamanote JY13, 埼京線 Saikyo JA12, 湘南新宿ライン Shonan-Shinjuku JS21.',
           'notes': 'Director #342 supplied source facts, including the 2026-10-24 JR-line ruling; plain-text transfer information only. retrievedAt records the original station/Metro retrieval; the additional JR retrieval date is recorded in derivation without inventing a time. Route relations supply line names only, never route evidence, platform mapping or transfer paths. No operator graphics or copied sign layout. Station.codes has no evidence field; this source is the basis of its M25/Y09/F09/JY13 entries and all six transfer references in scene/identity.json.'}
    meeting = {'id': MEETING, 'title': 'Ikefukuro meeting-point location references (approximate)',
               'publisher': 'Tabi-mag; LIVE JAPAN', 'url': 'https://tabi-mag.jp/tk1226/',
               'license': None, 'rights': 'REFERENCE_ONLY', 'usage': 'facts-only',
               'decision': {'url': 'https://github.com/nurockplayer/gteki/issues/342', 'date': '2026-10-24'},
               'attribution': 'Tabi-mag / LIVE JAPAN (location facts only; no content reproduced)',
               'modified': False, 'retrievedAt': None, 'datasetDate': None,
               'gteki_role': 'context', 'navigation_use': 'NOT_FOR_ROUTING', 'visual_only': True,
               'verification': 'APPROXIMATE',
               'notes': 'Director #342 supplied facts, retrieved 2026-10-24 (time unspecified; retrievedAt null rather than inventing a timestamp): https://tabi-mag.jp/tk1226/ and https://livejapan.com/ja/in-tokyo/in-pref-tokyo/in-ikebukuro/article-a0000017/ place the indoor B1 meeting point on the North Passage east side near Exit 22 / JR North Gate. Exact point approximate. No local copy of the Toshima underground guide available to check a page; no page claim or guide citation for this marker. Name/location only; no replica, lookalike, owl graphic or copied content.'}
    for path in ['gteki/station.json', 'data/graph.src.json']:
        data = read(path)
        data['sources'] = [s for s in data['sources'] if s['id'] not in {OSM, MEETING}] + [osm, meeting]
        data['dataFiles'] = [f for f in data['dataFiles'] if f['path'] != 'scene/identity.json'] + [{
            'id': 'identity', 'path': 'scene/identity.json', 'sourceIds': sorted({s for b in boards for s in b['sourceIds']}),
            'modified': True, 'derivation': 'pipeline/build_identity.py: GTEki-authored board placements fitted to shipped PLATEAU ceilings/walls with fittings excluded from Sightlines; station/transfer facts from OSM and approximate meeting-point facts from reference-only sources. NOT_FOR_ROUTING.'}]
        write(path, data, indent=1)


def check(boards):
    graph = read('gteki/graph.json')
    nodes = {n['id']: n for n in graph['nodes']}
    edges = {e['id']: e for e in graph['edges']}
    _, _, _, sight = geometry()
    signs = read('scene/signage.json')['signs']
    assert len(boards) <= 10
    src = read('data/graph.src.json')
    baseline = {**src, 'sources': [s for s in src['sources'] if s['id'] not in {OSM, MEETING}]}
    assert build_instant(src) == build_instant(baseline)
    for b in boards:
        anchor = b['anchor']
        nid = anchor.get('nodeId', edges.get(anchor.get('edgeId'), {}).get('from'))
        assert any(e['verification'] == 'verified' and nid in (e['from'], e['to']) for e in edges.values())
        if 'edgeId' in anchor:
            assert edges[anchor['edgeId']]['verification'] == 'verified'
        geom = view_geometry(nodes[nid], b['headingDeg']) if b['kind'] == 'station-name' else marker_view(b, nodes[nid]['position']['z'])
        assert not hits(sight, geom, b), (b['id'], hits(sight, geom, b)[:2])
        if b['kind'] == 'station-name':
            assert in_phone_view(b, nodes[nid], b['headingDeg']), b['id']
        floor = nodes[nid]['position']['z']
        assert b.get('mount') == 'wall' or b['position']['z'] - b['heightM']/2*(0.60/0.54) >= floor+1.995, b['id']
        assert b['ceilingZ'] is not None and b['position']['z']+b['heightM']/2*(0.60/0.54) <= b['ceilingZ']+0.002, b['id']
        assert all(math.hypot(s['position']['x']-b['position']['x'], s['position']['y']-b['position']['y']) >= 1 for s in signs), b['id']
        if nid in JUNCTIONS:
            assert sum(e['verification'] == 'verified' and nid in (e['from'], e['to']) for e in edges.values()) >= 3, nid
    print('Identity clearance / authored-direction eye sightlines: PASS (placement only; opening view is reported separately)')
    print('\n'.join(f"{b['id']} | {b['anchor']} | {b['kind']} | {b['position']} | {b['widthM']} x {b['heightM']} m" for b in boards))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    check(read('scene/identity.json')['boards'] if args.check else generate())
