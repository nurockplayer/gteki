"""Wayfinding sign kit: light-box signs whose faces are swappable at runtime.

Generators:
  sign_hanging  ceiling-suspended double-sided light box on two rods
  sign_wall     flush wall-mounted single-sided light box (back at the wall, y = 0)
  sign_totem    free-standing double-sided directory / map-board pillar
  sign_blade    wall-projecting double-sided "blade" sign (faces look along +-X)

Conventions (docs/assets/asset-contract.md): front faces Blender -Y (glTF +Z).
Wall-backed items put their back plane at y = 0 and extend toward -Y; the origin
is the floor point under the back centre. Free-standing items are centred on the
floor footprint.

Every readable face is ONE quad with its own full 0..1 UV island and a
`gteki_sign_face_*` material (emissive from albedo). Station leads swap that
material (or its texture) by name for real text; the kit art is only a colour
field, an optional geometric arrow block, a thin inner rule and a blank
text-area panel. No text, digits, pictograms, typefaces or brand marks appear in
any texture. Face materials are generated for the face aspect ratio so arrows
are undistorted; a non-default aspect gets an `_a<aspect*100>` suffix in the
material name (the default sizes keep the plain name).

Dimensions are synthetic look-dev defaults (`dimension_basis` synthetic).

This module also exports small geometry helpers (Kit, lathe, ring, ...) that
props.py reuses: they weld every primitive so the bevel / weighted-normal
modifiers work (Part primitives otherwise carry disconnected faces) and mark
hard edges sharp.
"""

import math
import zlib

import bmesh
import numpy as np
from mathutils import Matrix, Vector

from .. import contract, materials, texsynth
from ..asset import Asset

GEN = "tools/blender/gteki_assets/families/signage.py"
TEX_V = 2  # bump when the generators below change output (part of the material spec hash)

# ---------------------------------------------------------------------------
# geometry helpers (shared with props.py)
# ---------------------------------------------------------------------------

PT_Y = lambda a, b, d: (a, d, b)  # noqa: E731  ring axis along Y: a=x (right when viewed from -Y), b=z, d=y
PT_X = lambda a, b, d: (d, -a, b)  # noqa: E731  ring axis along X: viewed from -X, right = -y


def _weld(part, n0, dist=1e-5):
    bm = part.bm
    bm.verts.ensure_lookup_table()
    new = bm.verts[n0:]
    if len(new) > 1:
        bmesh.ops.remove_doubles(bm, verts=new, dist=dist)


class Kit:
    """Welding facade over a Part: each primitive becomes a connected solid."""

    def __init__(self, part):
        self.part = part

    def _w(self, fn, *a, **k):
        n = len(self.part.bm.verts)
        r = fn(*a, **k)
        _weld(self.part, n)
        return r

    def box(self, mn, mx, mat, **kw):
        return self._w(self.part.box, mn, mx, mat, **kw)

    def prism(self, *a, **kw):
        return self._w(self.part.prism, *a, **kw)

    def extrude_x(self, *a, **kw):
        return self._w(self.part.extrude_x, *a, **kw)

    def cylinder(self, *a, **kw):
        return self._w(self.part.cylinder, *a, **kw)

    def tube(self, *a, **kw):
        return self._w(self.part.tube, *a, **kw)

    def mark(self):
        return len(self.part.bm.verts)

    def weld(self, n0):
        _weld(self.part, n0)

    def quad(self, *a, **kw):
        return self.part.quad(*a, **kw)

    def poly(self, *a, **kw):
        return self.part.poly(*a, **kw)

    # -- rotated box --------------------------------------------------------
    def xbox(self, c, half, mat, rot_x=0.0, mats=None, skip=(), uv_front=False):
        """Box centred at c with half extents, rotated about its centre around X.

        Positive rot_x tilts the top toward -Y (the front)."""
        hx, hy, hz = half
        R = Matrix.Rotation(math.radians(rot_x), 3, "X")

        def P(x, y, z):
            v = R @ Vector((x, y, z))
            return (c[0] + v.x, c[1] + v.y, c[2] + v.z)

        faces = {
            "-x": [(-hx, hy, -hz), (-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz)],
            "+x": [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)],
            "-y": [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)],
            "+y": [(hx, hy, -hz), (-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz)],
            "-z": [(-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz), (-hx, -hy, -hz)],
            "+z": [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)],
        }
        n0 = len(self.part.bm.verts)
        out = {}
        for k, vs in faces.items():
            if k in skip:
                continue
            uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] if (uv_front and k == "-y") else None
            f = self.part._face([P(*v) for v in vs], (mats or {}).get(k, mat), smooth=False, uv=uv)
            out[k] = f
        _weld(self.part, n0)
        return out

    # -- rectangular ring (frame) ------------------------------------------
    def ring(self, pt, outer, inner, d0, d1, mat, inner_mat=None, front=True, back=True):
        """Rectangular frame between rect `outer` and rect `inner` ((a0,a1,b0,b1)),
        from depth d0 (front, smaller) to d1. `pt(a, b, d)` maps to xyz."""
        n0 = len(self.part.bm.verts)

        def rect(r):
            a0, a1, b0, b1 = r
            return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]

        O, I = rect(outer), rect(inner)
        imat = inner_mat or mat
        f = self.part._face
        for i in range(4):
            j = (i + 1) % 4
            if front:
                f([pt(*O[i], d0), pt(*O[j], d0), pt(*I[j], d0), pt(*I[i], d0)], mat, smooth=False)
            if back:
                f([pt(*I[i], d1), pt(*I[j], d1), pt(*O[j], d1), pt(*O[i], d1)], mat, smooth=False)
            f([pt(*O[i], d0), pt(*O[i], d1), pt(*O[j], d1), pt(*O[j], d0)], mat, smooth=False)
            f([pt(*I[i], d0), pt(*I[j], d0), pt(*I[j], d1), pt(*I[i], d1)], imat, smooth=False)
        _weld(self.part, n0)

    def ring_radial(self, pt, centre, r_in, half_out, d0, d1, mat, hole_mat=None, bottom_mat=None, n=16, sides=True, d_back=None):
        """Square plate face (half-size half_out) with a round hole radius r_in, depth d0..d1."""
        ca, cb = centre
        n0 = len(self.part.bm.verts)
        f = self.part._face
        O, I = [], []
        for k in range(n):
            th = math.radians(45.0 + 360.0 * k / n)
            c, s = math.cos(th), math.sin(th)
            sc = half_out / max(abs(c), abs(s))
            O.append((ca + c * sc, cb + s * sc))
            I.append((ca + c * r_in, cb + s * r_in))
        for k in range(n):
            j = (k + 1) % n
            f([pt(*O[k], d0), pt(*O[j], d0), pt(*I[j], d0), pt(*I[k], d0)], mat, smooth=False)
            f([pt(*I[k], d0), pt(*I[j], d0), pt(*I[j], d1), pt(*I[k], d1)], hole_mat or mat, smooth=True)
        f([pt(*p, d1) for p in I], bottom_mat or hole_mat or mat, smooth=False)
        if sides:
            db = d1 if d_back is None else d_back
            for k in range(n):
                j = (k + 1) % n
                f([pt(*O[k], d0), pt(*O[k], db), pt(*O[j], db), pt(*O[j], d0)], mat, smooth=False)
        _weld(self.part, n0)

    def plate(self, pt, outer, holes, d0, d1, mat, back=True):
        """Rectangular slab (a0,a1,b0,b1) from depth d0 (front) to d1 with axis-aligned
        rectangular through-holes [(rect, inner_mat), ...]; gridded so every vertex is shared."""
        n0 = len(self.part.bm.verts)
        f = self.part._face
        a0, a1, b0, b1 = outer
        As = sorted({a0, a1, *[v for h, _ in holes for v in h[:2]]})
        Bs = sorted({b0, b1, *[v for h, _ in holes for v in h[2:]]})

        def in_hole(ca, cb):
            return any(h[0] < ca < h[1] and h[2] < cb < h[3] for h, _ in holes)

        for i in range(len(As) - 1):
            for j in range(len(Bs) - 1):
                if in_hole((As[i] + As[i + 1]) / 2, (Bs[j] + Bs[j + 1]) / 2):
                    continue
                p = [(As[i], Bs[j]), (As[i + 1], Bs[j]), (As[i + 1], Bs[j + 1]), (As[i], Bs[j + 1])]
                f([pt(*q, d0) for q in p], mat, smooth=False)
                if back:
                    f([pt(*q, d1) for q in reversed(p)], mat, smooth=False)
        # outer sides
        O = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
        for i in range(4):
            j = (i + 1) % 4
            f([pt(*O[i], d0), pt(*O[i], d1), pt(*O[j], d1), pt(*O[j], d0)], mat, smooth=False)
        for (ha0, ha1, hb0, hb1), im in holes:
            I = [(ha0, hb0), (ha1, hb0), (ha1, hb1), (ha0, hb1)]
            for i in range(4):
                j = (i + 1) % 4
                f([pt(*I[i], d0), pt(*I[j], d0), pt(*I[j], d1), pt(*I[i], d1)], im or mat, smooth=False)
        _weld(self.part, n0)

    # -- surface of revolution ------------------------------------------------
    def lathe(self, centre, profile, mat, segments=16, smooth=True, mats=None, rep=None):
        """Revolve [(r, z), ...] (bottom -> top, outside going up, then inward over the top)
        around the vertical axis through `centre`."""
        cx, cy, cz = centre
        rmax = max(r for r, _ in profile) or 1.0
        rings = []
        for r, z in profile:
            rings.append([(cx + r * math.cos(2 * math.pi * i / segments), cy + r * math.sin(2 * math.pi * i / segments), cz + z) for i in range(segments)])
        s = [0.0]
        for k in range(1, len(profile)):
            s.append(s[-1] + math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
        n0 = len(self.part.bm.verts)
        for j in range(len(profile) - 1):
            m = mats[j] if mats else mat
            rp = rep or materials.repeat_m(m)
            for i in range(segments):
                i2 = (i + 1) % segments
                vs = [rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]]
                uv = [(2 * math.pi * rmax * i / segments / rp, s[j] / rp), (2 * math.pi * rmax * (i + 1) / segments / rp, s[j] / rp),
                      (2 * math.pi * rmax * (i + 1) / segments / rp, s[j + 1] / rp), (2 * math.pi * rmax * i / segments / rp, s[j + 1] / rp)]
                if profile[j][0] == 0:
                    vs, uv = [vs[0], vs[2], vs[3]], [uv[0], uv[2], uv[3]]
                elif profile[j + 1][0] == 0:
                    vs, uv = vs[:3], uv[:3]
                self.part._face(vs, m, smooth=smooth, uv=uv)
        _weld(self.part, n0)


def K(asset, group="main", **kw):
    return Kit(asset.part(group, **kw))


def face_quad(part, pt, rect, d, mat, facing_front=True, uv_rect=(0.0, 1.0, 0.0, 1.0)):
    """One quad (a0,a1,b0,b1) at depth d, full 0..1 UV island (or `uv_rect` = (u0,u1,v0,v1)),
    readable from the front (facing_front) or from behind."""
    a0, a1, b0, b1 = rect
    u0, u1, v0, v1 = uv_rect
    if facing_front:
        vs = [pt(a0, b0, d), pt(a1, b0, d), pt(a1, b1, d), pt(a0, b1, d)]
    else:
        vs = [pt(a1, b0, d), pt(a0, b0, d), pt(a0, b1, d), pt(a1, b1, d)]
    return part.quad(*vs, mat, smooth=False, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def _closed_islands(bm):
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack, isl, closed = [f0], [], True
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            isl.append(f)
            for e in f.edges:
                if len(e.link_faces) != 2:
                    closed = False
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        if closed:
            out.append(isl)
    return out


def _fix_box_uvs(asset, part):
    """Part._face projects box UVs before face normals exist (every face is treated as facing +Z).
    Re-project exactly those faces: a face whose UVs still equal the +Z default (x/rep, y/rep)
    but whose real normal is not +Z. Faces with explicit UVs never match and are left alone."""
    bm = part.bm
    uv = part.uv
    for f in bm.faces:
        if f.normal.z > 0.5:
            continue
        mat = asset.materials[f.material_index]
        rep = materials.repeat_m(mat)
        if all(abs(l[uv].uv[0] - l.vert.co.x / rep) < 1e-5 and abs(l[uv].uv[1] - l.vert.co.y / rep) < 1e-5 for l in f.loops):
            part._box_uv(f, mat)


def _bevel_part(part):
    """Bevel convex hard edges with bmesh (instead of the core bevel + weighted-normal modifiers).

    Large faces stay exactly flat (face.smooth False) and only the bevel facets are smooth, so a
    big panel never picks up a vertex-normal gradient from its chamfer. The core modifier path is
    switched off by zeroing part.bevel."""
    bm = part.bm
    width, segs = part.bevel, max(1, int(part.bevel_segments))
    lim = math.radians(40.0)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.is_convex and e.calc_face_angle(0.0) > lim]
    new_faces = []
    if edges and width > 0:
        res = bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs, profile=0.5, affect="EDGES",
                              clamp_overlap=True, loop_slide=True, miter_outer="ARC" if segs > 1 else "SHARP")
        new_faces = res["faces"]
    for f in new_faces:
        f.smooth = True
    part.bevel = 0.0
    bm.normal_update()


def finish(asset, sharp_deg=35.0, collision=None):
    """Orient closed solids outward, fix box UVs, bevel, mark hard edges sharp.

    Open shells (single face quads, gaskets) are left exactly as built. `collision="name"` adds
    one box collider equal to the visual AABB (kept identical so bounds_m and collision agree)."""
    lim = math.radians(sharp_deg)
    for _, part in asset.parts + asset.collision:
        bm = part.bm
        bm.faces.index_update()
        for isl in _closed_islands(bm):
            bmesh.ops.recalc_face_normals(bm, faces=isl)
        bm.normal_update()
        _fix_box_uvs(asset, part)
        if part.bevel > 0:
            _bevel_part(part)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b = e.link_faces
                if a.normal.angle(b.normal, 0.0) > lim:
                    e.smooth = False
    if collision:
        mn, mx = [math.inf] * 3, [-math.inf] * 3
        for _, part in asset.parts:
            for v in part.bm.verts:
                for i in range(3):
                    mn[i], mx[i] = min(mn[i], v.co[i]), max(mx[i], v.co[i])
        asset.col_box(collision, mn, mx)
    return asset


def _merge(defaults, params):
    p = dict(defaults)
    p.update(params or {})
    return p


def _choice(p, key, choices):
    if p[key] not in choices:
        raise ValueError(f"{key} must be one of {choices}, got {p[key]!r}")


# ---------------------------------------------------------------------------
# sign face texture generator
# ---------------------------------------------------------------------------

TONES = {
    "navy": dict(field=(0.03, 0.085, 0.23), panel=(0.055, 0.145, 0.33), rim=(0.86, 0.89, 0.93), ink=(0.97, 0.97, 0.96)),
    "exit_yellow": dict(field=(0.90, 0.62, 0.015), panel=(0.96, 0.74, 0.10), rim=(0.08, 0.08, 0.07), ink=(0.06, 0.06, 0.05)),
    "black": dict(field=(0.025, 0.027, 0.03), panel=(0.065, 0.07, 0.078), rim=(0.65, 0.67, 0.70), ink=(0.96, 0.96, 0.95)),
    "white": dict(field=(0.90, 0.915, 0.92), panel=(0.975, 0.98, 0.975), rim=(0.05, 0.12, 0.28), ink=(0.05, 0.12, 0.28)),
}
ARROWS = ("left", "right", "up", "none")
ARROW_ANGLE = {"right": 0.0, "up": 90.0, "left": 180.0}
MIRROR = {"left": "right", "right": "left", "up": "up", "none": "none"}

_ARROW_HEAD = [(0.5, 0.0), (0.0, 0.47), (0.0, -0.47)]
_ARROW_SHAFT = [(-0.5, -0.15), (0.06, -0.15), (0.06, 0.15), (-0.5, 0.15)]


def _sd_rect(X, Y, cx, cy, hx, hy, r=0.0):
    qx = np.abs(X - cx) - hx + r
    qy = np.abs(Y - cy) - hy + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def _sd_poly(X, Y, pts):
    """Signed distance (negative inside) to a convex CCW polygon (exact inside, bound outside)."""
    n = len(pts)
    sd = None
    for i in range(n):
        (px, py), (qx, qy) = pts[i], pts[(i + 1) % n]
        dx, dy = qx - px, qy - py
        ln = math.hypot(dx, dy)
        d = ((X - px) * dy - (Y - py) * dx) / ln
        sd = d if sd is None else np.maximum(sd, d)
    return sd


def _sd_arrow(X, Y, cx, cy, size, angle_deg):
    a = math.radians(angle_deg)
    dx, dy = (X - cx) / size, (Y - cy) / size
    lx = dx * math.cos(a) + dy * math.sin(a)
    ly = -dx * math.sin(a) + dy * math.cos(a)
    return np.minimum(_sd_poly(lx, ly, _ARROW_HEAD), _sd_poly(lx, ly, _ARROW_SHAFT)) * size


def _cov(sd, aa):
    return np.clip(0.5 - sd / aa, 0.0, 1.0)


def _mix(base, col, cov):
    return base * (1 - cov[..., None]) + np.asarray(col, np.float32) * cov[..., None]


def _finish_maps(albedo, res, seed, grain=0.012):
    n = texsynth.spectral_noise(res, seed + 7, beta=0.9)
    albedo = albedo * (1.0 - grain + 2 * grain * n)[..., None]
    normal = texsynth.normal_from_height(n * 0.05, strength=0.6)
    rough = (0.34 + 0.05 * n).astype(np.float32)
    return texsynth._out(albedo, normal, rough, np.zeros_like(rough))


def sign_face(res, seed, theme="navy", arrow="none", aspect=4.0, layout="bar", tone="light", v=TEX_V):
    """Generic sign face: colour field + inner rule + optional arrow block + blank text panel.

    Physical frame: width = `aspect`, height = 1 for landscape layouts ("bar");
    portrait layouts ("plate", "map") are normalised to width = 1.
    """
    if layout == "map":
        return _map_board(res, seed, theme, aspect, tone)
    T = TONES[theme]
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    u, vv = (xx + 0.5) / res, 1.0 - (yy + 0.5) / res
    if layout == "bar":
        Wd, Ht = aspect, 1.0
    else:
        Wd, Ht = 1.0, 1.0 / aspect
    X, Y = u * Wd, vv * Ht
    aa = max(Wd, Ht) / res * 1.1
    img = np.empty((res, res, 3), np.float32)
    img[:] = np.asarray(T["field"], np.float32)
    # gentle light-box falloff toward the edges
    edge = np.minimum(np.minimum(u, 1 - u), np.minimum(vv, 1 - vv))
    img *= (0.94 + 0.06 * np.clip(edge / 0.15, 0, 1))[..., None]
    if layout == "bar":
        m = 0.11
        rim_in = 0.055
        t = 0.014
        sd_rim = np.abs(_sd_rect(X, Y, Wd / 2, 0.5, Wd / 2 - rim_in, 0.5 - rim_in, 0.05)) - t / 2
        img = _mix(img, T["rim"], _cov(sd_rim, aa))
        px0, px1 = m, Wd - m
        if arrow != "none":
            blk = 1.0 - 2 * m
            if arrow == "right":
                bx0 = Wd - m - blk
                px1 = bx0 - 0.05
                sep = bx0 - 0.025
            else:
                bx0 = m
                px0 = bx0 + blk + 0.05
                sep = bx0 + blk + 0.025
            cx = bx0 + blk / 2
            img = _mix(img, T["ink"], _cov(_sd_arrow(X, Y, cx, 0.5, 0.56 * blk, ARROW_ANGLE[arrow]), aa))
            img = _mix(img, T["rim"], _cov(np.abs(X - sep) - 0.006, aa) * _cov(np.abs(Y - 0.5) - 0.5 + m, aa))
        sd_panel = _sd_rect(X, Y, (px0 + px1) / 2, 0.5, (px1 - px0) / 2, 0.5 - m, 0.05)
        img = _mix(img, T["panel"], _cov(sd_panel, aa))
    else:  # "plate": large blank plate on top, arrow below
        m = 0.09
        t = 0.014
        sd_rim = np.abs(_sd_rect(X, Y, 0.5, Ht / 2, 0.5 - 0.045, Ht / 2 - 0.045, 0.05)) - t / 2
        img = _mix(img, T["rim"], _cov(sd_rim, aa))
        if arrow == "none":
            py0, py1 = m, Ht - m
        else:
            band = 0.34
            py0, py1 = m + band, Ht - m
            img = _mix(img, T["ink"], _cov(_sd_arrow(X, Y, 0.5, m + band * 0.45, 0.2, ARROW_ANGLE[arrow]), aa))
        sd_panel = _sd_rect(X, Y, 0.5, (py0 + py1) / 2, 0.5 - m, (py1 - py0) / 2, 0.06)
        img = _mix(img, T["panel"], _cov(sd_panel, aa))
    return _finish_maps(img, res, seed)


def _map_board(res, seed, theme, aspect, tone):
    """Generic directory map-board: header band, grid, colour zones, route strokes, marker.

    Pure colour blocks and lines (no text, no real map data). Width normalised to 1."""
    rng = np.random.default_rng(seed)
    T = TONES[theme]
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    u, vv = (xx + 0.5) / res, 1.0 - (yy + 0.5) / res
    Ht = 1.0 / aspect
    X, Y = u, vv * Ht
    aa = max(1.0, Ht) / res * 1.1
    light = tone == "light"
    bg = (0.93, 0.935, 0.92) if light else (0.05, 0.08, 0.14)
    gridc = (0.80, 0.82, 0.82) if light else (0.12, 0.17, 0.26)
    img = np.empty((res, res, 3), np.float32)
    img[:] = np.asarray(bg, np.float32)
    hb = 0.5  # header band height
    mp0, mp1 = 0.62, Ht - hb - 0.06  # map area y range
    cell = 0.2
    # grid lines (fine) across the map area
    in_map = _cov(_sd_rect(X, Y, 0.5, (mp0 + mp1) / 2, 0.45, (mp1 - mp0) / 2), aa)
    gx = np.abs(np.mod(X + cell / 2, cell) - cell / 2) - 0.004
    gy = np.abs(np.mod(Y + cell / 2, cell) - cell / 2) - 0.004
    img = _mix(img, gridc, np.maximum(_cov(gx, aa), _cov(gy, aa)) * in_map)
    pal = [(0.62, 0.80, 0.66), (0.97, 0.85, 0.50), (0.68, 0.82, 0.93), (0.92, 0.74, 0.72), (0.82, 0.78, 0.92), (0.80, 0.80, 0.78)]
    if not light:
        pal = [tuple(c * 0.55 for c in p) for p in pal]
    ncx, ncy = 4, max(2, int((mp1 - mp0) / cell))
    x_origin = 0.5 - ncx * cell / 2
    for _ in range(13):
        ix, iy = int(rng.integers(0, ncx)), int(rng.integers(0, ncy))
        wx, wy = int(rng.integers(1, 3)), int(rng.integers(1, 3))
        x0 = x_origin + ix * cell + 0.012
        x1 = min(x_origin + (ix + wx) * cell, x_origin + ncx * cell) - 0.012
        y0 = mp0 + iy * cell + 0.012
        y1 = min(mp0 + (iy + wy) * cell, mp1) - 0.012
        if x1 - x0 < 0.05 or y1 - y0 < 0.05:
            continue
        col = pal[int(rng.integers(0, len(pal)))]
        img = _mix(img, col, _cov(_sd_rect(X, Y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0.02), aa))
    # network lines on the grid centre lines (2 vertical + 2 horizontal) with station dots
    lc = [(0.85, 0.28, 0.16), (0.12, 0.52, 0.40), (0.10, 0.34, 0.72), (0.93, 0.66, 0.08)]
    vx = sorted(rng.choice(ncx, size=2, replace=False).tolist())
    hy = sorted(rng.choice(ncy - 2, size=2, replace=False).tolist())
    vlines = [(x_origin + (k + 0.5) * cell, lc[i]) for i, k in enumerate(vx)]
    hlines = [(mp0 + (k + 1.5) * cell, lc[2 + i]) for i, k in enumerate(hy)]
    xr_ = (x_origin + 0.5 * cell * 0.35, x_origin + ncx * cell - 0.5 * cell * 0.35)
    yr_ = (mp0 + 0.15 * cell, mp1 - 0.15 * cell)
    for xc, col in vlines:
        seg = _cov(np.abs(Y - (yr_[0] + yr_[1]) / 2) - (yr_[1] - yr_[0]) / 2, aa)
        img = _mix(img, col, _cov(np.abs(X - xc) - 0.017, aa) * seg)
    for yc, col in hlines:
        seg = _cov(np.abs(X - (xr_[0] + xr_[1]) / 2) - (xr_[1] - xr_[0]) / 2, aa)
        img = _mix(img, col, _cov(np.abs(Y - yc) - 0.017, aa) * seg)
    ring = (0.12, 0.14, 0.18) if light else (0.92, 0.94, 0.96)
    fill = (1.0, 1.0, 1.0) if light else (0.08, 0.1, 0.14)
    for xc, col in vlines:
        for k in range(1, ncy):
            yc = mp0 + (k - 0.5) * cell + cell * 0.0
            if yc > mp1:
                break
            img = _mix(img, ring, _cov(np.hypot(X - xc, Y - yc) - 0.034, aa))
            img = _mix(img, fill, _cov(np.hypot(X - xc, Y - yc) - 0.021, aa))
    for yc, col in hlines:
        for k in range(ncx):
            xc = x_origin + (k + 0.5) * cell
            img = _mix(img, ring, _cov(np.hypot(X - xc, Y - yc) - 0.034, aa))
            img = _mix(img, fill, _cov(np.hypot(X - xc, Y - yc) - 0.021, aa))
    # "you are here" marker
    mx, my = x_origin + 1.5 * cell, mp0 + 0.5 * cell
    img = _mix(img, (0.9, 0.12, 0.1), _cov(np.hypot(X - mx, Y - my) - 0.065, aa))
    img = _mix(img, (1.0, 1.0, 1.0), _cov(np.hypot(X - mx, Y - my) - 0.028, aa))
    # header band with blank text panel
    img = _mix(img, T["field"], _cov(-(Y - (Ht - hb)), aa))
    img = _mix(img, T["panel"], _cov(_sd_rect(X, Y, 0.5, Ht - hb / 2, 0.42, hb / 2 - 0.08, 0.04), aa))
    # legend row: coloured swatches + blank bars
    for k in range(4):
        sx = 0.14 + k * 0.2
        img = _mix(img, pal[k % len(pal)], _cov(_sd_rect(X, Y, sx, 0.3, 0.045, 0.045, 0.012), aa))
        img = _mix(img, gridc if light else (0.25, 0.3, 0.4), _cov(_sd_rect(X, Y, sx + 0.06, 0.3, 0.035, 0.012, 0.006), aa))
    img = _mix(img, T["rim"], _cov(np.abs(_sd_rect(X, Y, 0.5, Ht / 2, 0.47, Ht / 2 - 0.03, 0.03)) - 0.005, aa) * 0.9)
    return _finish_maps(img, res, seed)


def perforated_metal(res, seed, base=(0.70, 0.71, 0.72), cells=20, hole_frac=0.23, v=TEX_V):
    """Staggered-hole perforated stainless sheet, `cells` hole columns per repeat."""
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    u, vv = (xx + 0.5) / res * cells, (yy + 0.5) / res * cells
    d1 = np.hypot(np.mod(u, 1.0) - 0.5, np.mod(vv, 1.0) - 0.5)
    d2 = np.hypot(np.mod(u + 0.5, 1.0) - 0.5, np.mod(vv + 0.5, 1.0) - 0.5)
    d = np.minimum(d1, d2)
    px = cells / res
    hole = np.clip((hole_frac - d) / (px * 1.2) + 0.5, 0, 1)
    rim = np.clip(1.0 - np.abs(d - hole_frac) / 0.06, 0, 1)
    streak = texsynth.spectral_noise(res, seed, beta=1.6, aniso=(40.0, 1.0), lowcut=2.0)
    cloud = texsynth.spectral_noise(res, seed + 1, beta=2.5)
    metal = np.asarray(base, np.float32)[None, None, :] * (0.92 + 0.12 * streak + 0.04 * cloud + 0.10 * rim)[..., None]
    albedo = metal * (1 - hole[..., None]) + np.asarray((0.11, 0.115, 0.12), np.float32) * hole[..., None]
    height = (1 - hole) * (0.4 + 0.2 * rim) + 0.05 * streak
    normal = texsynth.normal_from_height(height, strength=3.0 * res / 1024.0)
    rough = (0.34 + 0.1 * (streak - 0.5) + 0.5 * hole).astype(np.float32)
    metallic = (1 - hole).astype(np.float32)
    return texsynth._out(albedo, normal, rough, metallic)


texsynth.GENERATORS["sign_face"] = sign_face
texsynth.GENERATORS["perforated_metal"] = perforated_metal

# canonical face aspect per layout (material names stay plain at these aspects)
_CANON = {"bar": 4.6, "plate": 0.725, "map": 0.267}


def _tag(layout, aspect):
    c = _CANON[layout]
    return "" if abs(aspect / c - 1.0) < 0.04 else "_a%d" % round(aspect * 100)


def _snap(layout, aspect):
    """Aspects within 4% of the layout's canonical value share one (plain-named) material."""
    c = _CANON[layout]
    return c if abs(aspect / c - 1.0) < 0.04 else round(aspect, 2)


def face_material(layout, theme, arrow, aspect, tone="light"):
    """Register (idempotent) and return the emissive face material for a sign face."""
    tag = _tag(layout, aspect)
    aspect = _snap(layout, aspect)
    if layout == "bar":
        name = f"gteki_sign_face_{theme}_{arrow}{tag}"
    elif layout == "plate":
        name = f"gteki_sign_face_blade_{theme}_{arrow}{tag}"
    else:
        name = f"gteki_sign_face_totem_{tone}_{theme}{tag}"
    materials.register(
        name,
        gen="sign_face",
        repeat_m=1.0,
        seed=zlib.crc32(name.encode()) % 90000 + 1000,
        kw=dict(theme=theme, arrow=arrow, aspect=round(aspect, 3), layout=layout, tone=tone, v=TEX_V),
        emit_from_albedo=True,
        emit_strength={"exit_yellow": 0.75, "white": 1.2}.get(theme, 1.5 if (layout == "map" and tone == "light") else 2.0),
    )
    return name


# ---------------------------------------------------------------------------
# generators
# ---------------------------------------------------------------------------

ALU = "gteki_aluminium_anodised"
DARK = "gteki_plastic_dark"


def _sign_checks(p):
    _choice(p, "theme", tuple(TONES))
    _choice(p, "arrow", ARROWS)


def _back_arrow(p):
    ba = p.get("back_arrow", "auto")
    if ba == "auto":
        return MIRROR[p["arrow"]]
    _choice(p, "back_arrow", ARROWS)
    return ba


def _face_stack(frame_k, gasket_k, face_k, pt, inner_rect, d_face, direction, face_mat, bead=0.004, g=0.006, uv_rect=(0.0, 1.0, 0.0, 1.0)):
    """Gasket bead + face quad for one side. direction=-1: faces front (toward smaller d)."""
    a0, a1, b0, b1 = inner_rect
    gin = (a0 + g, a1 - g, b0 + g, b1 - g)
    if direction < 0:
        gasket_k.ring(pt, inner_rect, gin, d_face - bead, d_face, DARK, back=False)
        face_quad(face_k.part, pt, gin, d_face, face_mat, True, uv_rect)
    else:
        gasket_k.ring(pt, inner_rect, gin, d_face, d_face + bead, DARK, front=False)
        face_quad(face_k.part, pt, gin, d_face, face_mat, False, uv_rect)
    return gin


def sign_hanging(asset_id, params, tex_res):
    """Ceiling-suspended double-sided light-box sign (2 rods, aluminium frame)."""
    p = _merge(dict(width=1.8, height=0.45, depth=0.12, drop=0.6, theme="navy", arrow="left", back_arrow="auto", mount_height=2.3, bar=0.032, recess=0.012), params)
    _sign_checks(p)
    W, H, D = p["width"], p["height"], p["depth"]
    z0 = p["mount_height"]
    z1 = z0 + H
    ceil = z1 + p["drop"]
    bar = p["bar"]
    a = Asset(asset_id, "signage", asset_id.replace("gteki_sign_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes="Faces use gteki_sign_face_* materials with 0..1 UVs: swap material/texture at runtime. Ceiling plane at z = mount_height + height + drop.")
    outer = (-W / 2, W / 2, z0, z1)
    inner = (-W / 2 + bar, W / 2 - bar, z0 + bar, z1 - bar)
    frame = K(a, "frame", bevel=0.006, bevel_segments=2)
    frame.ring(PT_Y, outer, inner, -D / 2, D / 2, ALU)
    gasket = K(a, "frame", bevel=0.0012, bevel_segments=1)
    faces = K(a, "faces")
    rc = p["recess"]
    aspect = (inner[1] - inner[0] - 0.012) / (inner[3] - inner[2] - 0.012)
    fm = face_material("bar", p["theme"], p["arrow"], aspect)
    bm = face_material("bar", p["theme"], _back_arrow(p), aspect)
    _face_stack(frame, gasket, faces, PT_Y, inner, -D / 2 + rc, -1, fm)
    _face_stack(frame, gasket, faces, PT_Y, inner, D / 2 - rc, +1, bm)
    # suspension: two rods, hanger blocks on the frame, ceiling canopies
    mount = K(a, "mount", bevel=0.0015, bevel_segments=1)
    xr = W / 2 - max(0.18, 0.12 * W)
    for sx in (-xr, xr):
        mount.box((sx - 0.04, -0.03, z1), (sx + 0.04, 0.03, z1 + 0.008), ALU)
        mount.cylinder((sx, 0, z1 + 0.008), 0.011, 0.03, ALU, segments=16)
        mount.cylinder((sx, 0, z1 + 0.038), 0.0055, ceil - (z1 + 0.038), ALU, segments=10, caps=(False, True))
        mount.cylinder((sx, 0, ceil - 0.012), 0.038, 0.012, ALU, segments=20)
        mount.cylinder((sx, 0, ceil - 0.046), 0.016, 0.034, ALU, segments=16, caps=(True, False))
    a.light_hint("sign", (0, 0, z0 - 0.02), kind="panel", size_m=round(min(W, 1.2) * 0.6, 2), watts=round(min(60.0, 40.0 * W * H), 1), colour_temp_k=5000)
    return finish(a, collision="sign" if z0 < 2.05 else None)


def sign_wall(asset_id, params, tex_res):
    """Flush wall-mounted light box. Back plane at y = 0, face toward -Y."""
    p = _merge(dict(width=1.6, height=0.4, depth=0.07, theme="navy", arrow="left", mount_height=1.9, bar=0.028, recess=0.01), params)
    _sign_checks(p)
    W, H, D = p["width"], p["height"], p["depth"]
    z0, z1 = p["mount_height"], p["mount_height"] + H
    bar = p["bar"]
    a = Asset(asset_id, "signage", asset_id.replace("gteki_sign_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes="Back plane at y=0 (wall face); origin at floor under back centre.")
    gap = 0.012  # shadow-gap standoff
    outer = (-W / 2, W / 2, z0, z1)
    inner = (-W / 2 + bar, W / 2 - bar, z0 + bar, z1 - bar)
    frame = K(a, "frame", bevel=0.003, bevel_segments=2)
    frame.ring(PT_Y, outer, inner, -D, -gap, ALU, back=True)
    gasket = K(a, "frame", bevel=0.001, bevel_segments=1)
    faces = K(a, "faces")
    aspect = (inner[1] - inner[0] - 0.012) / (inner[3] - inner[2] - 0.012)
    fm = face_material("bar", p["theme"], p["arrow"], aspect)
    _face_stack(frame, gasket, faces, PT_Y, inner, -D + p["recess"], -1, fm)
    # closed back + dark stand-off block creating a shadow gap against the wall
    stand = K(a, "frame", bevel=0.002, bevel_segments=1)
    stand.box((-W / 2 + 0.03, -gap, z0 + 0.03), (W / 2 - 0.03, 0, z1 - 0.03), DARK, skip=("+y",))
    a.light_hint("sign", (0, -D, z0 - 0.02), kind="panel", size_m=round(min(W, 1.2) * 0.5, 2), watts=round(min(40.0, 30.0 * W * H), 1), colour_temp_k=5000)
    return finish(a, collision="sign" if z0 < 2.05 else None)


def sign_totem(asset_id, params, tex_res):
    """Free-standing double-sided directory / map-board pillar (blank emissive faces)."""
    p = _merge(dict(width=0.6, depth=0.3, height=2.2, theme="navy", tone="light", bar=0.035, plinth=0.1, cap=0.08, recess=0.014), params)
    _choice(p, "theme", tuple(TONES))
    _choice(p, "tone", ("light", "dark"))
    W, D, H = p["width"], p["depth"], p["height"]
    bar, pl, cp = p["bar"], p["plinth"], p["cap"]
    z0, z1 = pl, H - cp
    a = Asset(asset_id, "signage", asset_id.replace("gteki_sign_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes="Two blank map-board faces (colour blocks + grid only); origin at floor centre of the footprint.")
    base = K(a, "base", bevel=0.004, bevel_segments=2)
    base.box((-W / 2 - 0.04, -D / 2 - 0.04, 0), (W / 2 + 0.04, D / 2 + 0.04, 0.012), "gteki_steel_painted_dark")
    base.box((-W / 2 + 0.01, -D / 2 + 0.01, 0.012), (W / 2 - 0.01, D / 2 - 0.01, pl), "gteki_steel_painted_dark")
    frame = K(a, "frame", bevel=0.004, bevel_segments=2)
    outer = (-W / 2, W / 2, z0, z1)
    inner = (-W / 2 + bar, W / 2 - bar, z0 + bar, z1 - bar)
    frame.ring(PT_Y, outer, inner, -D / 2, D / 2, ALU)
    capk = K(a, "frame", bevel=0.006, bevel_segments=2)
    capk.box((-W / 2 - 0.012, -D / 2 - 0.012, z1), (W / 2 + 0.012, D / 2 + 0.012, H), "gteki_steel_painted_dark")
    gasket = K(a, "frame", bevel=0.0012, bevel_segments=1)
    faces = K(a, "faces")
    aspect = (inner[1] - inner[0] - 0.012) / (inner[3] - inner[2] - 0.012)
    fm = face_material("map", p["theme"], "none", aspect, tone=p["tone"])
    _face_stack(frame, gasket, faces, PT_Y, inner, -D / 2 + p["recess"], -1, fm)
    _face_stack(frame, gasket, faces, PT_Y, inner, D / 2 - p["recess"], +1, fm)
    for s, y in (("front", -D / 2 - 0.02), ("back", D / 2 + 0.02)):
        a.light_hint(s, (0, y, H * 0.6), kind="panel", size_m=round(W * 0.7, 2), watts=18.0, colour_temp_k=5000)
    return finish(a, collision="body")


def sign_blade(asset_id, params, tex_res):
    """Wall-projecting double-sided blade sign (faces look along +-X, i.e. along the corridor)."""
    p = _merge(dict(width=0.6, height=0.8, thickness=0.08, standoff=0.14, theme="navy", arrow="none", back_arrow="auto", mount_height=2.0, bar=0.03, recess=0.01), params)
    _sign_checks(p)
    W, H, T, G = p["width"], p["height"], p["thickness"], p["standoff"]
    z0, z1 = p["mount_height"], p["mount_height"] + H
    bar = p["bar"]
    a = Asset(asset_id, "signage", asset_id.replace("gteki_sign_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes="Blade projects toward -Y from the wall plane y=0; faces point to -X and +X.")
    # ring plane coordinates: a = -y (right when viewed from -X), b = z, d = x
    outer = (G, G + W, z0, z1)
    inner = (G + bar, G + W - bar, z0 + bar, z1 - bar)
    frame = K(a, "frame", bevel=0.004, bevel_segments=2)
    frame.ring(PT_X, outer, inner, -T / 2, T / 2, ALU)
    gasket = K(a, "frame", bevel=0.0012, bevel_segments=1)
    faces = K(a, "faces")
    aspect = (inner[1] - inner[0] - 0.012) / (inner[3] - inner[2] - 0.012)
    fm = face_material("plate", p["theme"], p["arrow"], aspect)
    bm = face_material("plate", p["theme"], _back_arrow(p), aspect)
    _face_stack(frame, gasket, faces, PT_X, inner, -T / 2 + p["recess"], -1, fm)
    _face_stack(frame, gasket, faces, PT_X, inner, T / 2 - p["recess"], +1, bm)
    # wall bracket: backplate + two round arms into the blade's wall-side rail
    br = K(a, "mount", bevel=0.002, bevel_segments=1)
    br.box((-0.05, -0.012, z0 + 0.05), (0.05, 0, z1 - 0.05), ALU, skip=("+y",))
    for zc in (z0 + 0.12, z1 - 0.12):
        # cylinder along +y from y=-G-0.002 (inside the rail) to the plate
        br.cylinder((0, -G - 0.004, zc), 0.011, G + 0.004 - 0.012, ALU, segments=16, axis="y")
        br.box((-0.03, -0.034, zc - 0.03), (0.03, -0.012, zc + 0.03), ALU)
    a.light_hint("sign", (0, -(G + W / 2), z0 - 0.02), kind="panel", size_m=round(W * 0.7, 2), watts=round(min(40.0, 45.0 * W * H), 1), colour_temp_k=5000)
    return finish(a, collision="sign" if z0 < 2.05 else None)


GENERATORS = {
    "sign_hanging": sign_hanging,
    "sign_wall": sign_wall,
    "sign_totem": sign_totem,
    "sign_blade": sign_blade,
}
