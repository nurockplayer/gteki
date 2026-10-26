"""CPU evidence for #308 on the 78bfb9c8 bake; no asset writes.

Run with --markdown for the checked-in report, otherwise print full JSON.
Fitting ids are zero-based boxes (12 successive GLB triangles per box).
"""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fitting_exclusion import BOX_FACES, fitting_box, FittingExclusion
from sign_sightlines import (ROOT, EYE_M, FACE_OFFSET, FACE_H, DEFAULT_PITCH, FOLLOW_DISTANCE,
                            FOLLOW_LIFT, FOLLOW_SHOULDER, point_at, project, scene_polygons,
                            sub, dot, hull_planes, clipped, sign_edge)


def nominal_follow(eyes, target):
    lift = -math.sin(DEFAULT_PITCH)+FOLLOW_LIFT
    norm = math.hypot(math.cos(DEFAULT_PITCH), lift)
    horizontal, vertical = FOLLOW_DISTANCE*math.cos(DEFAULT_PITCH)/norm, FOLLOW_DISTANCE*lift/norm
    out = []
    for e in eyes:
        dx, dy = target[0]-e[0], target[1]-e[1]
        length = math.hypot(dx, dy)
        dx, dy = dx/length, dy/length
        out.append((e[0]-horizontal*dx+FOLLOW_SHOULDER*dy,
                    e[1]-horizontal*dy-FOLLOW_SHOULDER*dx, e[2]+vertical))
    return out


def floor_at(floors, p):
    hits = []
    for _, _, tri in floors:
        a, b, c = tri
        dx, dy = p[0]-a[0], p[1]-a[1]
        bx, by = b[0]-a[0], b[1]-a[1]
        cx, cy = c[0]-a[0], c[1]-a[1]
        det = bx*cy-by*cx
        if abs(det) < 1e-9:
            continue
        u, v = (dx*cy-dy*cx)/det, (bx*dy-by*dx)/det
        z = a[2]+u*(b[2]-a[2])+v*(c[2]-a[2])
        if min(u, v) >= -1e-7 and u+v <= 1+1e-7 and p[2]-2.5 <= z <= p[2]+1.5:
            hits.append(z)
    return max(hits) if hits else None


def exact_probe_hit(geom, sign, face, box):
    center = tuple(sign['position'][k] for k in ('x', 'y', 'z'))
    at = project(geom, center)
    facing = (sign['facing']['x'], sign['facing']['y'], 0)
    length = math.hypot(*facing[:2])
    facing = tuple(v/length for v in facing)
    right = (-facing[1], facing[0], 0)
    direction = 1 if face == 'front' else -1
    toward = -1 if dot(sub(point_at(geom, at+0.01), point_at(geom, at-0.01)), facing) < 0 else 1
    scale = sign.get('scale', 1)
    corners = [tuple(center[k]+direction*FACE_OFFSET*scale*facing[k]+x*sign['maxWidthM']/2*right[k]+
                     (z*FACE_H*scale/2 if k == 2 else 0) for k in range(3))
               for x,z in ((-1,-1), (1,-1), (1,1), (-1,1))]
    for d in [6.0, 10.0] + [6+i*0.025 for i in range(1, 160)]:
        q = point_at(geom, at+toward*direction*d)
        camera = nominal_follow([(q[0],q[1],q[2]+EYE_M)], center)[0]
        planes = hull_planes(corners+[camera])
        if any(clipped([box[i] for i in ids], planes) for ids in BOX_FACES):
            return d
    return None


def main():
    signs = json.loads((ROOT/'scene/signage.json').read_text())['signs']
    edges = {e['id']: e for e in json.loads((ROOT/'gteki/graph.json').read_text())['edges']}
    floors = list(scene_polygons(include_sleeves=False, roles=('floor', 'stairs_ramps')))
    polys = list(scene_polygons(include_sleeves=False))
    groups = defaultdict(list)
    for role, name, poly in polys:
        if role == 'light_fixtures':
            groups[int(name.rsplit(':', 1)[1])//12].extend(poly)
    boxes = {}
    for i, vs in groups.items():
        assert len(vs) == 36 and len(set(vs)) == 8, i
        vs = set(vs)
        center = tuple(sum(v[k] for v in vs)/len(vs) for k in range(3))
        box = fitting_box(center, -math.pi/9)
        assert all(min(math.dist(v, b) for b in box) < 0.0001 for v in vs), i
        boxes[i] = (center, box)
    meta = json.loads((ROOT/'gteki/assets/ikebukuro_b1_lit.meta.json').read_text())
    assert len(boxes) == meta['fixture_count'] == 2569, 'report requires the 78bfb9c8 baseline bake'
    source_hash = hashlib.sha256((ROOT/'gteki/assets/ikebukuro_b1.glb').read_bytes()).hexdigest()
    assert source_hash == meta['source_glb_sha256']
    geom = edges['sw_h__w_cj']['geometry']
    exclusion = FittingExclusion(signs, edges)
    old = FittingExclusion(signs, edges, viewers=('eye',))
    added, by_face, unwitnessed = [], defaultdict(list), []
    for i, (center, box) in sorted(boxes.items()):
        hits = exclusion.blockers(box)
        assert not old.blockers(box), ('current bake contains an old eye blocker', i)
        if hits:
            witnesses = []
            for sid, face in hits:
                by_face[(sid,face)].append(i)
                sign = next(s for s in signs if s['id'] == sid)
                distance = exact_probe_hit(sign_edge(sign, edges)['geometry'], sign, face, box)
                witnesses.append({'sign': sid, 'face': face, 'standoff_m': distance})
                if distance is None:
                    unwitnessed.append((i, sid, face))
            added.append({'fitting': i, 'centre_enu_m': center, 'witnesses': witnesses})
    assert not unwitnessed, unwitnessed
    report = {'basis': '78bfb9c8 shipped boxes; unchanged source/grid assumed; not a rebake',
              'source_glb_sha256': source_hash,
              'lit_glb_sha256': hashlib.sha256((ROOT/'gteki/assets/ikebukuro_b1_lit.glb').read_bytes()).hexdigest(),
              'previously_excluded': 47, 'current_fittings': len(boxes),
              'newly_excluded': len(added), 'total_excluded_forecast': 47+len(added),
              'retained_forecast': len(boxes)-len(added), 'unwitnessed': unwitnessed,
              'by_sign_face': [{'sign': s, 'face': f, 'fittings': ids} for (s,f),ids in sorted(by_face.items())],
              'new_fittings': added, 'target_faces': []}
    for sid, face, direction in (('sign-place-sw_h__w_cj-4', 'back', 1), ('sign-rep-sw_h__w_cj-4', 'front', -1)):
        sign = next(s for s in signs if s['id'] == sid)
        p = tuple(sign['position'][k] for k in ('x','y','z'))
        at = project(geom, p)
        target = {'sign': sid, 'face': face, 'position': p, 'arc_m': at, 'views': []}
        for d in (6, 10):
            q = point_at(geom, at+direction*d)
            eye = (q[0], q[1], q[2]+EYE_M)
            cam = nominal_follow([eye], p)[0]
            normal = (sign['facing']['x'], sign['facing']['y'], 0)
            norm = math.hypot(*normal[:2])
            normal = tuple(c/norm for c in normal)
            right = (-normal[1], normal[0], 0)
            face_center = tuple(p[k]-direction*FACE_OFFSET*normal[k] for k in range(3))
            view = {'standoff_m': d, 'eye': eye, 'floor_z': floor_at(floors, q), 'camera': cam, 'fittings': []}
            for i in (259, 274):
                center, box = boxes[i]
                ray = sub(face_center, cam)
                t = max(0, min(1, dot(sub(center, cam),ray)/dot(ray,ray)))
                distance = math.dist(center, tuple(cam[k]+t*ray[k] for k in range(3)))
                fitting = {'id': i, 'centre': center, 'distance_to_face_center_ray_m': distance, 'witness': None}
                # A witness ray through a box vertex to the painted rectangle.
                for vertex in [center]+box:
                    v = sub(vertex,cam)
                    t = dot(sub(face_center,cam), normal)/dot(v,normal)
                    hit = tuple(cam[k]+t*v[k] for k in range(3))
                    u = dot(sub(hit,face_center),right)
                    z = hit[2]-face_center[2]
                    if t > 1 and abs(u) <= sign['maxWidthM']/2 and abs(z) <= FACE_H/2:
                        fitting['witness'] = {'point': vertex, 'on_face_m': (u,z), 'ray_distance_m': 0}
                        break
                view['fittings'].append(fitting)
            target['views'].append(view)
        report['target_faces'].append(target)
    if '--markdown' in sys.argv:
        markdown(report)
    else:
        print(json.dumps(report, indent=2))


def markdown(report):
    print('# #308 fitting exclusion follow-up\n')
    print('Spec 11 steers yaw toward each sign from the edge at 6 or 10 m. It does not switch to first person: '
          'the follow camera trails the 1.62 m eye, with 3.45 m boom, 0.42 m shoulder, pitch -0.12 and lift 0.14. '
          'The bake previously checked only eye volumes. The existing continuous 6–10 m eye envelope, '
          'whole 1.2 × 0.15 × 0.04 m fitting box, and 0.041 m face offset were already correct.\n')
    print('The fix adds continuous nominal follow volumes in pieces of at most 0.25 m. A curvature bound keeps '
          'each entire camera path inside its volume without independently sweeping eye and boom offsets. '
          'The broad follow envelope remains for structural audits.\n')
    print(f"Forecast: **{report['total_excluded_forecast']} excluded versus 47** "
          f"({report['newly_excluded']} additional); **{report['retained_forecast']} retained** from 2,616 original candidates.\n")
    print('Baseline: commit `78bfb9c8`, 2,569 shipped fittings. The old eye exclusion finds zero remaining blockers. '
          'Every new fitting/face pair has an intersection witness at an individual nominal camera pose '
          '(endpoints first, then 0.025 m steps). This is a CPU forecast, conditional on the same source and bake grid.\n')
    print(f"Source GLB SHA-256: `{report['source_glb_sha256']}`.\n\nLit GLB SHA-256: `{report['lit_glb_sha256']}`.\n")
    print('## Target-face computation\n')
    print('For camera C and fitting centre F, the distance to the sign-centre segment C→S is '
          '`|F − (C + clamp(dot(F−C,S−C)/|S−C|², 0, 1) × (S−C))|`. '
          'A second ray through F (or a box vertex) reaches the modeled face at coordinates (u,z) below; '
          'that ray has distance **0 m** to the fitting. Face bounds use committed maxWidthM and 0.42 × scale height.\n')
    print('| Sign / face | Stand-off m | Eye ENU m | Camera ENU m | Fitting | Centre-ray distance m | Blocking-ray face (u,z) m |\n'
          '|---|---:|---|---|---:|---:|---|')
    fmt = lambda v: ', '.join(f'{x:.6f}' for x in v)
    for target in report['target_faces']:
        for view in target['views']:
            for fit in view['fittings']:
                if fit['witness']:
                    print(f"| {target['sign']} / {target['face']} | {view['standoff_m']} | {fmt(view['eye'])} | "
                          f"{fmt(view['camera'])} | {fit['id']} | {fit['distance_to_face_center_ray_m']:.6f} | "
                          f"{fmt(fit['witness']['on_face_m'])} |")
    print('\nFitting 259 centre: `(-127.930185, 62.525448, 30.346001)`; fitting 274 centre: '
          '`(-125.674904, 61.704594, 30.346001)`. Fitting 274 blocks both reported faces; '
          '259 blocks place-4 back only. The observed floor is 27.909999847 m versus graph 27.91 m; '
          'eye Z is 29.53 m, nominal camera Z 30.403117410 m.\n')
    print('Spec 11 and the CPU model both use ±0.041 × scale m for the faces. Loaded kit frames recess '
          'the runtime face to ±0.027 m; this small discrepancy cannot explain the missed strips several '
          'metres away. The model keeps the existing maxWidthM bound; actual painted widths, camera collision '
          'response, and both rendered tiers still require the lead’s GPU check. Place-6 back/col_015 remains out of scope.\n')
    print('## Newly excluded fittings by sign/face\n')
    print('Ids are zero-based boxes in the baseline `light_fixtures` mesh: box N is triangles 12N through 12N+11. '
          'A fitting can block several faces; count unique ids for the 109 additions. '
          'The JSON output also lists every centre and individual-pose witness.\n')
    print('| Sign | Face | Fitting ids |\n|---|---|---|')
    for row in report['by_sign_face']:
        print(f"| {row['sign']} | {row['face']} | {', '.join(map(str, row['fittings']))} |")
    print('\nReproduce with:\n\n```sh\nlockf -k /tmp/gteki-local-test.lock python3 -I '
          'stations/ikebukuro/pipeline/report_probe_fittings.py --markdown\n```')


if __name__ == '__main__':
    main()
