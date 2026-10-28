"""Conservative equipment-centre visibility proxy at spawn eyes; no renderer.

Connected LED housings are separate cues, not individual mesh triangles.
Occlusion uses the shipped structural geometry and column sleeves. This does
not certify perceived visibility, the follow camera, dither or final lighting.
"""
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_identity import SPAWNS, geometry, read
from sign_sightlines import Sightlines, cross, dot, scene_polygons, sub


def clear(sight, eye, target):
    direction = sub(target, eye)
    low = tuple(min(a, b) for a, b in zip(eye, target))
    high = tuple(max(a, b) for a, b in zip(eye, target))
    indices = set()
    for x in range(math.floor(low[0]/4), math.floor(high[0]/4)+1):
        for y in range(math.floor(low[1]/4), math.floor(high[1]/4)+1):
            indices.update(sight.grid.get((x, y), []))
    for i in indices:
        _, _, poly, pmin, pmax = sight.polys[i]
        if any(pmax[k] < low[k] or pmin[k] > high[k] for k in range(3)):
            continue
        for j in range(1, len(poly)-1):
            a, b, c = poly[0], poly[j], poly[j+1]
            ab, ac = sub(b, a), sub(c, a)
            h = cross(direction, ac)
            det = dot(ab, h)
            if abs(det) < 1e-8:
                continue
            s = sub(eye, a)
            u = dot(s, h)/det
            if u < 0 or u > 1:
                continue
            q = cross(s, ab)
            v = dot(direction, q)/det
            if v < 0 or u+v > 1:
                continue
            t = dot(ac, q)/det
            if 0.0001 < t < 0.9999:
                return False
    return True


def fixture_centres():
    triangles = [poly for role, _, poly in scene_polygons() if role == 'light_fixtures']
    parents = list(range(len(triangles)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    vertices = {}
    for i, poly in enumerate(triangles):
        for p in poly:
            key = tuple(round(v, 4) for v in p)
            if key in vertices:
                parents[root(i)] = root(vertices[key])
            vertices[key] = i
    groups = {}
    for i, poly in enumerate(triangles):
        groups.setdefault(root(i), set()).update(poly)
    return [(f'led:{i}', tuple(sum(p[k] for p in pts)/len(pts) for k in range(3))) for i, pts in groups.items()]


def report():
    _, _, _, sight = geometry()
    nodes = {n['id']: n for n in read('gteki/graph.json')['nodes']}
    boards = read('scene/identity.json')['boards']
    occluders = [(role, name, poly) for role, name, poly, _, _ in sight.polys]
    for b in boards:
        f, p = b['facing'], b['position']
        norm = math.hypot(f['x'], f['y'])
        fx, fy = f['x']/norm, f['y']/norm
        poly = [(p['x']-fy*x, p['y']+fx*x, p['z']+z)
                for x, z in [(-b['widthM']/2,-b['heightM']/2), (b['widthM']/2,-b['heightM']/2),
                             (b['widthM']/2,b['heightM']/2), (-b['widthM']/2,b['heightM']/2)]]
        occluders.append(('identity-panel', b['id'], poly))
    sight = Sightlines(occluders, include_fittings=False)
    # Report existing equipment only; identity panels are occluders, never cues.
    cues = [(b['id'], tuple(b['position'][k] for k in ('x', 'y', 'z'))) for b in read('scene/signage.json')['signs']]
    cues += fixture_centres()
    rows = []
    for nid, heading in SPAWNS.items():
        p = nodes[nid]['position']
        eye = (p['x'], p['y'], p['z']+1.62)
        a, pitch = math.radians(heading), -0.12
        dx, dy = math.sin(a), math.cos(a)
        visible = []
        for label, target in cues:
            v = sub(target, eye)
            depth = (v[0]*dx+v[1]*dy)*math.cos(pitch)+v[2]*math.sin(pitch)
            if depth < 0.05 or depth > 20:
                continue
            across = v[0]*dy-v[1]*dx
            up = -(v[0]*dx+v[1]*dy)*math.sin(pitch)+v[2]*math.cos(pitch)
            if abs(across/depth/math.tan(math.pi/6)/(390/844)) <= 0.98 and abs(up/depth/math.tan(math.pi/6)) <= 0.98 and clear(sight, eye, target):
                visible.append(label)
        rows.append({'spawn': nid, 'visibleEquipmentCentres': visible, 'count': len(visible),
                     'status': 'proxy met (equipment)' if len(visible) >= 2 else 'proxy not met (equipment)'})
    return rows


if __name__ == '__main__':
    rows = report()
    print(json.dumps(rows, indent=2))
