"""Geometry builders on top of bmesh.

All coordinates are Blender world space in metres (Z up, travel along +Y, see
contract.py). A `Part` is one bmesh with its own modifiers (bevel / weighted
normals); an `Asset` joins its parts per group into `VIS_<group>` meshes at
build time. UVs are box-projected in metres divided by each material's
`repeat_m`, so tileable textures keep a constant texel density.
"""

import math

import bmesh
from mathutils import Matrix, Vector

from . import materials

FACE_KEYS = ("-x", "+x", "-y", "+y", "-z", "+z")


class Part:
    def __init__(self, asset, name, bevel=0.0, bevel_segments=2, smooth=False, weighted=True, uv_rotate=False, collision=False):
        self.asset = asset
        self.collision = collision  # collision parts never register materials
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.bevel = bevel
        self.bevel_segments = bevel_segments
        self.smooth = smooth
        self.weighted = weighted
        self.uv_rotate = uv_rotate
        # mobile profile: fewer segments for visual parts; collision keeps full detail
        self.low_detail = not collision and getattr(asset, "profile", "full") == "mobile"

    # ------------------------------------------------------------- primitives

    def _face(self, verts, mat, smooth=None, uv=None):
        bv = [self.bm.verts.new(v) for v in verts]
        f = self.bm.faces.new(bv)
        f.normal_update()  # new faces have no normal yet; box UVs depend on it
        f.material_index = 0 if self.collision else self.asset.mat_index(mat)
        f.smooth = self.smooth if smooth is None else smooth
        if uv is None:
            self._box_uv(f, mat)
        else:
            for loop, t in zip(f.loops, uv):
                loop[self.uv].uv = t
        return f

    def _box_uv(self, f, mat, origin=(0.0, 0.0, 0.0)):
        rep = materials.repeat_m(mat)
        n = f.normal if f.normal.length > 0 else Vector((0, 0, 1))
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            p = loop.vert.co - Vector(origin)
            if ax == 2:  # floor / ceiling: U=x, V=y
                u, v = p.x, p.y if n.z > 0 else -p.y
            elif ax == 0:  # wall facing +/-x: U along y, V up
                u, v = (p.y if n.x < 0 else -p.y), p.z
            else:  # wall facing +/-y: U along x, V up
                u, v = (p.x if n.y < 0 else -p.x), p.z
            if self.uv_rotate:
                u, v = v, u
            loop[self.uv].uv = (u / rep, v / rep)

    def quad(self, a, b, c, d, mat, smooth=None, uv=None):
        return self._face([a, b, c, d], mat, smooth, uv)

    def poly(self, verts, mat, smooth=None, uv=None):
        return self._face(verts, mat, smooth, uv)

    def box(self, mn, mx, mat, skip=(), mats=None):
        """Axis-aligned box. `skip` omits faces ('-z' etc.); `mats` overrides per face."""
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        faces = {
            "-x": [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            "+x": [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            "-y": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            "+y": [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            "-z": [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
            "+z": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        }
        out = []
        for k in FACE_KEYS:
            if k in skip:
                continue
            m = (mats or {}).get(k, mat)
            out.append(self._face(faces[k], m, smooth=False))
        return out

    def prism(self, profile, z0, z1, mat, cap_mat=None, smooth_sides=False, skip_bottom=False, skip_top=False):
        """Extrude a closed CCW polygon (list of (x, y)) vertically from z0 to z1."""
        n = len(profile)
        cap_mat = cap_mat or mat
        for i in range(n):
            (ax, ay), (bx, by) = profile[i], profile[(i + 1) % n]
            self._face([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], mat, smooth=smooth_sides)
        if not skip_top:
            self._face([(x, y, z1) for x, y in profile], cap_mat, smooth=False)
        if not skip_bottom:
            self._face([(x, y, z0) for x, y in reversed(profile)], cap_mat, smooth=False)

    def extrude_x(self, profile, x0, x1, mat, cap_mat=None, smooth_sides=False, caps=True):
        """Extrude a closed polygon given in the (y, z) plane along X from x0 to x1.

        Profile must be CCW when viewed from +X.
        """
        n = len(profile)
        cap_mat = cap_mat or mat
        for i in range(n):
            (ay, az), (by, bz) = profile[i], profile[(i + 1) % n]
            self._face([(x0, ay, az), (x0, by, bz), (x1, by, bz), (x1, ay, az)], mat, smooth=smooth_sides)
        if caps:
            self._face([(x1, y, z) for y, z in profile], cap_mat, smooth=False)
            self._face([(x0, y, z) for y, z in reversed(profile)], cap_mat, smooth=False)

    def extrude_y(self, profile, y0, y1, mat, cap_mat=None, smooth_sides=False, caps=True):
        """Extrude a closed polygon given in the (x, z) plane along Y from y0 to y1.

        Profile must be CCW when viewed from -Y (the asset front).
        """
        n = len(profile)
        cap_mat = cap_mat or mat
        for i in range(n):
            (ax, az), (bx, bz) = profile[i], profile[(i + 1) % n]
            self._face([(ax, y1, az), (bx, y1, bz), (bx, y0, bz), (ax, y0, az)], mat, smooth=smooth_sides)
        if caps:
            self._face([(x, y0, z) for x, z in profile], cap_mat, smooth=False)
            self._face([(x, y1, z) for x, z in reversed(profile)], cap_mat, smooth=False)

    def cylinder(self, base, radius, height, mat, segments=24, cap_mat=None, axis="z", caps=(True, True)):
        """Cylinder from `base` along +axis."""
        cap_mat = cap_mat or mat
        if self.low_detail:
            segments = max(8, segments // 2)
        ring0, ring1 = [], []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            c, s = math.cos(a) * radius, math.sin(a) * radius
            if axis == "z":
                p0 = Vector((base[0] + c, base[1] + s, base[2]))
                p1 = p0 + Vector((0, 0, height))
            elif axis == "y":
                p0 = Vector((base[0] + c, base[1], base[2] + s))
                p1 = p0 + Vector((0, height, 0))
            else:
                p0 = Vector((base[0], base[1] + c, base[2] + s))
                p1 = p0 + Vector((height, 0, 0))
            ring0.append(p0)
            ring1.append(p1)
        circ = 2 * math.pi * radius
        rep = materials.repeat_m(mat)
        for i in range(segments):
            j = (i + 1) % segments
            u0, u1 = circ * i / segments / rep, circ * (i + 1) / segments / rep
            v1 = height / rep
            verts = [ring0[i], ring0[j], ring1[j], ring1[i]]
            if axis == "y":
                verts = verts[::-1]
            self._face(verts, mat, smooth=True, uv=[(u0, 0), (u1, 0), (u1, v1), (u0, v1)])
        # ring order winds +z (axis z), -y (axis y), +x (axis x)
        flip_end = axis == "y"
        if caps[1]:
            self._face(ring1[::-1] if flip_end else ring1, cap_mat, smooth=False)
        if caps[0]:
            self._face(ring0 if flip_end else ring0[::-1], cap_mat, smooth=False)

    def tube(self, points, radius, mat, segments=12, caps=True, corner_radius=0.0, corner_steps=4):
        """Sweep a circle along a polyline (handrails). Optional rounded corners."""
        pts = [Vector(p) for p in points]
        if self.low_detail:
            segments = max(6, segments // 2)
            corner_steps = max(1, corner_steps // 2)
            pts = _simplify_polyline(pts, radius * 0.5)
        if corner_radius > 0 and len(pts) > 2:
            pts = _round_polyline(pts, corner_radius, corner_steps)
        # parallel-transport frames
        tangents = []
        for i in range(len(pts)):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == len(pts) - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tangents.append(t.normalized())
        up = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(up).normalized()
        rings = []
        dist = [0.0]
        for i in range(1, len(pts)):
            dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
        for i, (p, t) in enumerate(zip(pts, tangents)):
            if i > 0:
                prev_t = tangents[i - 1]
                axis = prev_t.cross(t)
                if axis.length > 1e-6:
                    ang = prev_t.angle(t)
                    normal = (Matrix.Rotation(ang, 3, axis.normalized()) @ normal).normalized()
            binormal = t.cross(normal).normalized()
            # miter scale at corners keeps the tube radius constant
            scale = 1.0
            if 0 < i < len(pts) - 1:
                d0 = (pts[i] - pts[i - 1]).normalized()
                cosh = max(0.2, d0.dot(t))
                scale = 1.0 / cosh
            ring = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                off = normal * math.cos(a) * radius + binormal * math.sin(a) * radius
                # stretch only the component in the bend plane
                if scale != 1.0:
                    d0 = (pts[i] - pts[i - 1]).normalized()
                    comp = off.dot(d0) * d0
                    off = off + comp * (scale - 1.0)
                ring.append(p + off)
            rings.append(ring)
        rep = materials.repeat_m(mat)
        circ = 2 * math.pi * radius
        for i in range(len(rings) - 1):
            for k in range(segments):
                k1 = (k + 1) % segments
                uv = [(dist[i] / rep, circ * k / segments / rep), (dist[i + 1] / rep, circ * k / segments / rep),
                      (dist[i + 1] / rep, circ * (k + 1) / segments / rep), (dist[i] / rep, circ * (k + 1) / segments / rep)]
                self._face([rings[i][k1], rings[i + 1][k1], rings[i + 1][k], rings[i][k]], mat, smooth=True, uv=uv[::-1])
        if caps:
            self._face(list(reversed(rings[0])), mat, smooth=False)
            self._face(rings[-1], mat, smooth=False)

    def merge_doubles(self, dist=1e-5):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=dist)


def _simplify_polyline(pts, tol):
    """Douglas-Peucker: drop points within `tol` of the chord; endpoints are kept."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        ab = b - a
        best, worst = -1.0, None
        for k in range(i + 1, j):
            ap = pts[k] - a
            if ab.length_squared > 1e-12:
                d = (ap - ab * (ap.dot(ab) / ab.length_squared)).length
            else:
                d = ap.length
            if d > best:
                best, worst = d, k
        if worst is not None and best > tol:
            keep[worst] = True
            stack += [(i, worst), (worst, j)]
    return [p for p, k in zip(pts, keep) if k]


def _round_polyline(pts, r, steps):
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d0 = (a - b).normalized()
        d1 = (c - b).normalized()
        ang = d0.angle(d1)
        if ang < 1e-3 or abs(ang - math.pi) < 1e-3:
            out.append(b)
            continue
        t = r / math.tan(ang / 2)
        t = min(t, (a - b).length * 0.45, (c - b).length * 0.45)
        p0 = b + d0 * t
        p1 = b + d1 * t
        for s in range(steps + 1):
            u = s / steps
            # quadratic Bezier through the corner: smooth, cheap, exact tangents
            q = p0 * (1 - u) ** 2 + b * 2 * u * (1 - u) + p1 * u * u
            out.append(q)
    out.append(pts[-1])
    return out


def rounded_rect(x0, y0, x1, y1, r, steps=4):
    """CCW polygon for a rectangle with rounded corners (plan view)."""
    r = min(r, (x1 - x0) / 2 - 1e-4, (y1 - y0) / 2 - 1e-4)
    pts = []
    corners = [((x1 - r, y0 + r), -90), ((x1 - r, y1 - r), 0), ((x0 + r, y1 - r), 90), ((x0 + r, y0 + r), 180)]
    for (cx, cy), start in corners:
        for s in range(steps + 1):
            a = math.radians(start + 90 * s / steps)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def stadium(x0, x1, y0, y1, steps=8):
    """CCW plan polygon: rectangle in X with semicircular ends along Y (gate cabinet nose)."""
    r = (x1 - x0) / 2
    cx = (x0 + x1) / 2
    pts = []
    for s in range(steps + 1):  # far end (+y) semicircle
        a = math.radians(0 + 180 * s / steps)
        pts.append((cx + math.cos(a) * r, y1 - r + math.sin(a) * r))
    for s in range(steps + 1):  # near end (-y) semicircle
        a = math.radians(180 + 180 * s / steps)
        pts.append((cx + math.cos(a) * r, y0 + r + math.sin(a) * r))
    return pts
