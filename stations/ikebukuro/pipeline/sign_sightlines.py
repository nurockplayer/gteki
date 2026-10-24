"""CPU-only visibility against the geometry rendered by scene/scene.ts.

Use the shipped lit GLB. Generated light_fixtures and kit sleeves can be excluded
independently for the rebake/PLATEAU audit. The strips in scene.ts makeEnvironment
are reflection sources in a separate scene, not blockers. Viewing volumes are
also reused by the Blender fitting exclusion; this module requires only stdlib.
"""
import itertools
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent.parent
EYE_M = 1.62  # packages/scene-api/src/index.ts WALKER_BODY.eyeM, used by explorer.ts
FACE_H = 0.42  # scene/signs.ts H (painted face, excluding frame)
FACE_OFFSET = 0.041  # scene/signs.ts front/back plane translation
CELL = 4.0
EPS = 1e-7
# apps/web/src/explorer/followCamera.ts FOLLOW and explorer.ts default pitch.
FOLLOW_DISTANCE, FOLLOW_SHOULDER, FOLLOW_LIFT, DEFAULT_PITCH = 3.45, 0.42, 0.14, -0.12


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def scene_polygons(include_fittings=True, include_sleeves=True):
    """Read uncompressed glTF triangles, in ENU, without Blender or a renderer."""
    with (ROOT / 'gteki/assets/ikebukuro_b1_lit.glb').open('rb') as f:
        magic, version, _ = struct.unpack('<III', f.read(12))
        assert magic == 0x46546c67 and version == 2
        n, kind = struct.unpack('<II', f.read(8))
        assert kind == 0x4e4f534a
        gltf = json.loads(f.read(n))
        n, kind = struct.unpack('<II', f.read(8))
        assert kind == 0x004e4942
        binary = f.read(n)

    def accessor(i):
        a = gltf['accessors'][i]
        view = gltf['bufferViews'][a['bufferView']]
        fmt = {5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC3': 3}[a['type']]
        size = struct.calcsize('<' + fmt * width)
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', size)
        return [struct.unpack_from('<' + fmt * width, binary, start + k * stride)
                for k in range(a['count'])]

    for node in gltf['nodes']:
        if 'mesh' not in node:
            continue
        mesh = gltf['meshes'][node['mesh']]
        role = node.get('extras', {}).get('gteki_role', mesh.get('extras', {}).get('gteki_role', node.get('name')))
        if role not in {'wall', 'ceiling', 'barriers', 'light_fixtures'}:
            continue
        if role == 'light_fixtures' and not include_fittings:
            continue
        # The station bake exports world-space geometry. Fail rather than silently
        # checking a different position if its transform contract ever changes.
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale')), node
        assert gltf['nodes'].index(node) in gltf['scenes'][gltf.get('scene', 0)]['nodes'], node
        for prim in mesh['primitives']:
            assert prim.get('mode', 4) == 4
            pos = [(x, -z, y) for x, y, z in accessor(prim['attributes']['POSITION'])]
            idx = [v[0] for v in accessor(prim['indices'])] if 'indices' in prim else list(range(len(pos)))
            for i in range(0, len(idx), 3):
                yield role, f'{node.get("name", role)}:{i // 3}', [pos[idx[i+j]] for j in range(3)]

    if not include_sleeves:
        return  # The actual bare PLATEAU columns remain in the barriers mesh.
    # scene/kit_columns.ts columnPlacements: conservative sleeve bounds include
    # the trim footprint as well as the 0.02 m stand-off and rounded corners.
    pieces = json.loads((ROOT / 'scene/kit/kit.json').read_text())['pieces']
    for c in json.loads((ROOT / 'scene/columns.json').read_text())['columns']:
        spec = pieces.get(c['kit'])
        if not spec:
            continue
        body = spec.get('body_m', spec['pitch_m'])
        inset = spec.get('corner_radius_m', 0) * (1 - 1/math.sqrt(2))
        w = (c['width']/2 + 0.02) / (body/2-inset) * spec['pitch_m']/2
        d = (c['depth']/2 + 0.02) / (body/2-inset) * spec['pitch_m']/2
        zlo, zhi = c['base_z'], c['base_z'] + min(spec['height_m'], c['height']-0.01)
        angle = math.radians(c['rotation_deg'])
        cs, sn = math.cos(angle), math.sin(angle)
        vertices = [(c['centre'][0]+x*cs-y*sn, c['centre'][1]+x*sn+y*cs, z)
                    for z in (zlo, zhi) for x, y in ((-w,-d),(w,-d),(w,d),(-w,d))]
        for ids in ((0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
            yield 'column_sleeve', c['id'], [vertices[i] for i in ids]


def point_at(geom, distance):
    distance = max(0, distance)
    for a, b in zip(geom, geom[1:]):
        length = math.hypot(b['x'] - a['x'], b['y'] - a['y'])
        if distance <= length and length:
            t = distance / length
            return tuple(a[k] + t * (b[k] - a[k]) for k in ('x', 'y', 'z'))
        distance -= length
    return tuple(geom[-1][k] for k in ('x', 'y', 'z'))


def project(geom, point):
    best, offset, acc = (math.inf, 0), 0, 0
    for a, b in zip(geom, geom[1:]):
        dx, dy = b['x'] - a['x'], b['y'] - a['y']
        length = math.hypot(dx, dy)
        if not length:
            continue
        t = max(0, min(1, ((point[0]-a['x'])*dx + (point[1]-a['y'])*dy) / length**2))
        distance = math.hypot(point[0]-a['x']-t*dx, point[1]-a['y']-t*dy)
        if distance < best[0]:
            best, offset = (distance, t), acc + t * length
        acc += length
    return offset


def hull_planes(vertices):
    """Half-spaces of a small convex hull, normals pointing outwards."""
    planes = {}
    for a, b, c in itertools.combinations(vertices, 3):
        n = cross(sub(b, a), sub(c, a))
        length = math.sqrt(dot(n, n))
        if length < EPS:
            continue
        n = tuple(v / length for v in n)
        d = dot(n, a)
        sides = [dot(n, v) - d for v in vertices]
        if max(sides) > EPS:
            if min(sides) < -EPS:
                continue
            n, d = tuple(-v for v in n), -d
        planes[tuple(round(v, 7) for v in (*n, d))] = (n, d)
    return list(planes.values())


def clipped(poly, planes):
    """Clip a triangle to a viewing volume; catches strips between corner rays."""
    for normal, d in planes:
        out = []
        for a, b in zip(poly, poly[1:] + poly[:1]):
            da, db = dot(normal, a) - d, dot(normal, b) - d
            if da <= EPS:
                out.append(a)
            if (da < -EPS and db > EPS) or (da > EPS and db < -EPS):
                t = da / (da-db)
                out.append(tuple(x + t*(y-x) for x, y in zip(a, b)))
        poly = out
        if not poly:
            break
    return poly


class Sightlines:
    def __init__(self, polygons=None, *, include_fittings=True, include_sleeves=True):
        self.polys, self.grid = [], {}
        source = scene_polygons(include_fittings, include_sleeves) if polygons is None else polygons
        for role, name, poly in source:
            if (role == 'light_fixtures' and not include_fittings or
                    role == 'column_sleeve' and not include_sleeves):
                continue
            lo = tuple(min(p[k] for p in poly) for k in range(3))
            hi = tuple(max(p[k] for p in poly) for k in range(3))
            i = len(self.polys)
            self.polys.append((role, name, poly, lo, hi))
            for x in range(math.floor(lo[0]/CELL), math.floor(hi[0]/CELL)+1):
                for y in range(math.floor(lo[1]/CELL), math.floor(hi[1]/CELL)+1):
                    self.grid.setdefault((x, y), []).append(i)

    def blocked(self, geom, sign, sides=('front', 'back'), distances=(6.0, 10.0), viewers=('eye', 'follow')):
        return [hit for viewer in viewers for hit in self._blocked(geom, sign, sides, distances, viewer)]

    def _blocked(self, geom, sign, sides, distances, viewer):
        hits = []
        for side, vertices, planes in sightline_volumes(geom, sign, sides, distances, viewer):
            low = tuple(min(v[k] for v in vertices) for k in range(3))
            high = tuple(max(v[k] for v in vertices) for k in range(3))
            indices = set()
            for x in range(math.floor(low[0]/CELL), math.floor(high[0]/CELL)+1):
                for y in range(math.floor(low[1]/CELL), math.floor(high[1]/CELL)+1):
                    indices.update(self.grid.get((x, y), []))
            for i in sorted(indices):
                role, name, poly, pmin, pmax = self.polys[i]
                if any(pmax[k] < low[k]-EPS or pmin[k] > high[k]+EPS for k in range(3)):
                    continue
                cut = clipped(poly, planes)
                if len(cut) < 3:
                    continue
                area = sum(math.sqrt(dot(n, n)) for n in
                           (cross(sub(cut[j], cut[0]), sub(cut[j+1], cut[0])) for j in range(1, len(cut)-1)))
                if area > EPS:
                    hits.append({'face': side, 'viewer': viewer, 'role': role, 'id': name,
                                 'enu': tuple(round(sum(v[k] for v in cut)/len(cut), 3) for k in range(3))})
        return hits


def sightline_volumes(geom, sign, sides=('front', 'back'), distances=(6.0, 10.0), viewer='eye'):
    """Full painted-face envelope from every eye position at 6-10 polyline m.

    Each straight piece of the eye path and the full face form a convex hull.
    Their union covers continuous stand-offs, including bends, with no ray
    sampling gaps. maxWidthM is a conservative bound on the painted width.
    """
    p = sign['position']
    center = tuple(p[k] for k in ('x', 'y', 'z'))
    facing = (sign['facing']['x'], sign['facing']['y'], 0)
    norm = math.hypot(*facing[:2])
    facing = tuple(v / norm for v in facing)
    right = (-facing[1], facing[0], 0)
    scale = sign.get('scale', 1)
    width, height = sign['maxWidthM'], FACE_H * scale
    at = project(geom, center)
    breaks, acc = [0.0], 0.0
    for a, b in zip(geom, geom[1:]):
        acc += math.hypot(b['x']-a['x'], b['y']-a['y'])
        breaks.append(acc)
    for side in sides:
        direction = 1 if side == 'front' else -1
        # Determine the face's side on this geom (end signs may use reversed geometry).
        before, after = point_at(geom, at-0.01), point_at(geom, at+0.01)
        toward = -1 if dot(sub(after, before), facing) < 0 else 1
        lo, hi = sorted(max(0, min(acc, at + toward*direction*d)) for d in distances)
        stops = [lo] + [d for d in breaks if lo < d < hi] + [hi]
        face = [tuple(center[k] + direction*FACE_OFFSET*scale*facing[k] +
                      x*width/2*right[k] + (z*height/2 if k == 2 else 0)
                      for k in range(3)) for x, z in ((-1,-1),(1,-1),(1,1),(-1,1))]
        for start, end in zip(stops, stops[1:]):
            eyes = [tuple(v + (EYE_M if k == 2 else 0) for k, v in enumerate(point_at(geom, d))) for d in (start, end)]
            if viewer == 'follow':
                eyes = follow_envelope(eyes, center)
            vertices = face + eyes
            yield side, vertices, hull_planes(vertices)


def follow_envelope(eyes, target):
    """Bound the default unshortened follow camera over a straight eye-path piece.

    The GPU probe only drags yaw (aim()), leaving pitch at -0.12. Bound yaw's
    entire angular interval, including trig extrema, rather than sample rays.
    The box also covers intermediate boom lengths from the head to that pose;
    actual runtime collision response/raising still needs a GPU re-shoot.
    """
    lift = -math.sin(DEFAULT_PITCH) + FOLLOW_LIFT
    length = math.hypot(math.cos(DEFAULT_PITCH), lift)
    horizontal = FOLLOW_DISTANCE * math.cos(DEFAULT_PITCH) / length
    vertical = FOLLOW_DISTANCE * lift / length
    angles = [math.atan2(target[1]-e[1], target[0]-e[0]) for e in eyes]
    a, b = angles
    b = a + (b-a+math.pi) % math.tau - math.pi
    lo, hi = sorted((a, b))
    offsets = []
    for ac, bs in ((-horizontal, FOLLOW_SHOULDER), (-FOLLOW_SHOULDER, -horizontal)):
        angles = [lo, hi]
        phase = math.atan2(bs, ac)
        angles += [phase + k*math.pi for k in range(-3, 4) if lo <= phase+k*math.pi <= hi]
        values = [0.0] + [ac*math.cos(t)+bs*math.sin(t) for t in angles]
        offsets.append((min(values), max(values)))
    low = [min(e[k] for e in eyes)+offsets[k][0] for k in range(2)] + [min(e[2] for e in eyes)]
    high = [max(e[k] for e in eyes)+offsets[k][1] for k in range(2)] + [max(e[2] for e in eyes)+vertical]
    return list(itertools.product(*zip(low, high)))


def placement_sign(r):
    x, y, bottom, dx, dy, _, width, scale = r
    # Check the rounded coordinates actually written to signage.json.
    return {'position': {'x': round(x, 3), 'y': round(y, 3), 'z': round(bottom + 0.48*scale/2, 3)},
            'facing': {'x': round(-dx, 4), 'y': round(-dy, 4)}, 'maxWidthM': width, 'scale': scale}


def sign_edge(sign, edges):
    """Resolve both end-sign ids and repeater/place-board graph provenance."""
    eid = next((b[6:] for b in sign.get('basis', []) if b.startswith('graph:')), None)
    if eid is None:
        eid = next(eid for eid in edges if sign['id'].endswith(eid) or sign['id'].endswith(eid + '-r'))
    edge = edges[eid]
    if edge['verification'] != 'verified':
        raise ValueError(f"{sign['id']}: unverified edge {eid}")
    return edge
