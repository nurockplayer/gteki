#!/usr/bin/env python3
"""Build the #339 soft-stylised commuter sample v2 from Blender primitives.

v2: an open overcoat over a cream knit, a layered bob of opaque locks, wide trousers, loafers, and two
painted base-colour atlases (body 1024, head 512) for a toon material. No body generator and no downloaded
mesh: every vertex is generated here. The rig, clips and export path come from the MPFB build.

Usage: Blender -b --factory-startup --python build_commuter_soft.py -- --out <dir> [--preview]
"""
import argparse
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_commuter_mpfb import Animation, build_actions, build_armature, triangle_count  # noqa: E402
from build_p0_sample import joint_positions as p0_joints  # noqa: E402
from export_character import export_character  # noqa: E402
from validate_character import BLINKS, FPS, JOINT_PARENTS  # noqa: E402

CHARACTER_ID = "gteki_commuter_soft"
DERIVATION = ("original: soft-stylized commuter silhouette hand-built from Blender primitives; "
              "see apps/web/public/avatars/gteki-commuter-soft.provenance.json")

BODY_ATLAS, HEAD_ATLAS = 1024, 512
NAVY, NAVY_LIGHT, NAVY_DARK = "#2B3550", "#36435F", "#222B40"
LAPEL, LAPEL_EDGE, CUFF_BAND = "#3A4766", "#161C2C", "#3E4B6B"
CREAM, KNIT_RIB, BELT = "#EDE6D8", "#D8CEBA", "#2A2622"
TAUPE, TAUPE_CREASE, TAUPE_HEM = "#A9A39B", "#948E86", "#8F897F"
SHOE, SOLE, SHOE_HI = "#8C7766", "#5E4E42", "#9C8775"
TOTE, TOTE_DARK, STITCH = "#9A8574", "#6E604F", "#B0A08A"
SKIN, NECK_SKIN = "#F8DCCB", "#E9C4AE"
HAIR, HAIR_HI, HAIR_SHADE = "#7A5541", "#9A7158", "#4E3528"
IRIS_TOP, IRIS_BOT, SCLERA, LASH = "#5A3A2A", "#8A5A40", "#F4ECE6", "#2A1E18"

# Body landmarks (metres, Blender Z up, +Y front).
HEM_Z, COAT_SPLIT_Z, COAT_TOP_Z = 0.50, 0.86, 1.396
# A-line overcoat (fix 1): rounded shoulders, body widens steadily from the underarm (1.15 m) to the hem.
COAT_PROFILE = [(0.50, 0.220, 0.140), (0.70, 0.192, 0.126), (0.86, 0.168, 0.116), (1.00, 0.148, 0.108),
                (1.10, 0.138, 0.105), (1.20, 0.140, 0.105), (1.30, 0.168, 0.105), (1.335, 0.165, 0.098),
                (1.365, 0.120, 0.085), (1.396, 0.062, 0.066)]
# Front opening half-width: 0.05 at the chest (knit >= 40% of torso width), narrowing to 0.03 at the waist.
OPEN_PROFILE = [(0.50, 0.075), (0.86, 0.040), (1.00, 0.034), (1.10, 0.058), (1.20, 0.060), (1.30, 0.056),
                (1.345, 0.045), (1.396, 0.030)]
SKIRT_OVERLAP = math.radians(3.0)  # the two lower panels lap 3 deg past the back vent seam
SKIRT_THIGH_SHARE = 0.9  # same-side thigh at the hem; the hip line stays on the pelvis
SLEEVE_PROFILE = [(0.93, 0.055), (0.99, 0.057), (1.13, 0.062), (1.22, 0.064), (1.30, 0.065), (1.335, 0.060)]
SLEEVE_TOP_Z = 1.335  # the sleeve stops here, inside the coat shoulder: no cap above the shoulder line
TROUSER_ZS = [0.06, 0.10, 0.20, 0.34, 0.50, 0.62, 0.74, 0.86]
TROUSER_R = [0.075, 0.072, 0.072, 0.072, 0.072, 0.072, 0.072, 0.072]
# Loafers 1.3x the v2 size (fix 1 item 5): toes clear the trouser hem in front and side views.
SHOE_RINGS = [(0.008, 0.060, 0.146), (0.029, 0.070, 0.161), (0.057, 0.069, 0.159),
              (0.081, 0.062, 0.147), (0.094, 0.047, 0.125), (0.100, 0.026, 0.083)]
HAND_Y = 0.030
HAND_RINGS = [(0.80, 0.021), (0.85, 0.024), (0.90, 0.027), (0.94, 0.026)]
# Flatter, wider tote (~0.30 w x 0.32 h x 0.08 d), top at waist height, hung from the right shoulder.
TOTE_X, TOTE_RINGS = 0.295, [(0.68, 0.034, 0.140), (0.76, 0.040, 0.150), (0.84, 0.040, 0.150),
                             (0.92, 0.040, 0.150), (1.00, 0.034, 0.140)]
STRAP_PATH = [(0.295, -0.14, 1.00), (0.265, -0.10, 1.15), (0.205, -0.06, 1.30), (0.158, 0.0, 1.354),
              (0.205, 0.06, 1.30), (0.265, 0.10, 1.15), (0.295, 0.14, 1.00)]
WALK_CROUCH_M = 0.025  # near-straight stance leg; the shared Animation stays on its own default
SPINE_STOPS = [(1.36, "spine_03"), (1.26, "spine_02"), (1.10, "spine_01"), (0.94, "pelvis")]

# Head: 6 heads tall with the bob; chin 1.395, crown 1.675, hair to 1.690.
HEAD_CENTRE, HEAD_RADII = (0.0, 0.0, 1.550), (0.110, 0.121, 0.150)
EYE_X, EYE_Z = 0.050, 1.500
EYE_HALF_W, EYE_HALF_H = 0.040, 0.030  # fix 3: bigger eyes, iris fills ~70% of the eye height
# Solid bob shell (fix 1 item 3): (z, rx, ry) from the chin to above the crown. ear-level width >= 1.3x skull.
BOB_LOWER = [(1.400, 0.122, 0.116), (1.450, 0.142, 0.135), (1.500, 0.152, 0.154), (1.545, 0.154, 0.156)]
DOME_BASE_Z, DOME_RX, DOME_HEIGHT = 1.545, 0.154, 0.172  # hemisphere cap: crown at 1.717 m
BOB_FADE_Z = 1.575  # the face opening closes into the forehead between 1.545 and 1.575 m
BOB_OPEN = 0.75  # half-angle (rad) of the face opening in the lower shell, centred on the front
BOB_TIPS = 10  # scallops around the lower edge
FACE_X0, FACE_W, FACE_Z0, FACE_H = -0.115, 0.230, 1.370, 0.340  # face atlas span (metres)
BLINK_PUSH_M = 0.005  # lens sits 1 mm proud; the closed blink pushes it 4 mm under the skin

# Atlas rectangles (x0, y0, w, h) in pixels, origin bottom-left, as Blender UVs read them.
BODY_RECTS = dict(
    coat=(0, 512, 512, 512), panel_l=(512, 512, 256, 256), panel_r=(768, 512, 256, 256),
    tote=(512, 768, 128, 256), strap=(640, 768, 128, 256), lapel_l=(768, 768, 128, 128),
    lapel_r=(896, 768, 128, 128), knit=(0, 256, 256, 256), trouser_l=(256, 0, 128, 512),
    trouser_r=(384, 0, 128, 512), sleeve_l=(512, 0, 128, 256), sleeve_r=(640, 0, 128, 256),
    shoe=(768, 0, 128, 128), hands=(896, 0, 64, 64), neck=(960, 0, 64, 64))
FACE_RECT = (0, 0, 256, 384)
EYE_RECTS = {-1.0: (0, 384, 128, 128), 1.0: (128, 384, 128, 128)}
HAIR_CELLS = [(256 + 64 * (i % 4), 128 * (i // 4), 64, 128) for i in range(16)]


def joint_positions():
    """Contract joints: p0's layout, with a bigger head, narrower shoulders and arms hanging at the sides."""
    positions = {name: tuple(point) for name, point in p0_joints().items()}
    positions.update({"neck_01": (0.0, 0.0, 1.43), "head": (0.0, 0.0, 1.53)})
    for side, s in (("l", -1.0), ("r", 1.0)):
        positions.update({
            f"clavicle_{side}": (s * 0.045, 0.0, 1.360), f"upperarm_{side}": (s * 0.170, 0.0, 1.335),
            f"lowerarm_{side}": (s * 0.205, 0.0, 1.115), f"hand_{side}": (s * 0.235, HAND_Y, 0.945),
            f"fingers_01_{side}": (s * 0.235, HAND_Y, 0.895), f"fingers_02_{side}": (s * 0.235, HAND_Y, 0.815),
            f"thumb_01_{side}": (s * 0.241, 0.055, 0.925), f"thumb_02_{side}": (s * 0.246, 0.065, 0.905),
            f"thigh_{side}": (s * 0.085, 0.0, 0.85), f"calf_{side}": (s * 0.085, 0.0, 0.48),
            f"foot_{side}": (s * 0.085, -0.035, 0.075), f"ball_{side}": (s * 0.085, 0.13, 0.0),
        })
        for joint, parent, child in (("upperarm_twist_01", "upperarm", "lowerarm"),
                                     ("lowerarm_twist_01", "lowerarm", "hand"),
                                     ("thigh_twist_01", "thigh", "calf")):
            head, tail = positions[f"{parent}_{side}"], positions[f"{child}_{side}"]
            positions[f"{joint}_{side}"] = tuple((a + b) / 2 for a, b in zip(head, tail))
    if set(positions) != set(JOINT_PARENTS):
        raise ValueError("joint layout does not cover the contract")
    return positions

def bone_pairs(positions):
    """Head/tail pairs: the tail points at the principal child, as in the p0 sample."""
    pairs = {}
    for name in JOINT_PARENTS:
        children = [child for child, parent in JOINT_PARENTS.items()
                    if parent == name and "twist" not in child and child != "daypack"]
        head = positions[name]
        if name in ("root", "head", "daypack") or not children:
            tail = (head[0], head[1], head[2] + 0.08)
        else:
            tail = positions[children[0]]
        pairs[name] = (head, tail)
    return pairs


def blend(stops, value):
    """Two-bone blend between neighbouring control heights (stops run high to low)."""
    if value >= stops[0][0]:
        return {stops[0][1]: 1.0}
    for (high, upper), (low, lower) in zip(stops, stops[1:]):
        if value >= low:
            share = (value - low) / (high - low)
            weights = {}
            for joint, weight in ((upper, share), (lower, 1.0 - share)):
                weights[joint] = weights.get(joint, 0.0) + weight
            return weights
    return {stops[-1][1]: 1.0}


def coat_weights(point):
    """Spine chain by height for the coat, knit and lapels."""
    return blend(SPINE_STOPS, point[2])


def skirt_weights(side):
    """One coat panel: pelvis 1.0 at the hip line easing to pelvis 0.1 / same-side thigh 0.9 at the hem."""
    joint = f"thigh_{side}"

    def weights(point):
        ramp = min(max((COAT_SPLIT_Z - point[2]) / (COAT_SPLIT_Z - HEM_Z), 0.0), 1.0)
        share = SKIRT_THIGH_SHARE * math.sqrt(ramp)
        if share < 1e-4:
            return {"pelvis": 1.0}
        return {"pelvis": 1.0 - share, joint: share}

    return weights


def arm_weights(side):
    stops = [(1.38, f"clavicle_{side}"), (1.30, f"upperarm_{side}"), (1.18, f"upperarm_{side}"),
             (1.08, f"lowerarm_{side}"), (0.99, f"lowerarm_{side}")]
    return lambda point: blend(stops, point[2])


def leg_weights(side):
    stops = [(0.90, f"thigh_{side}"), (0.54, f"thigh_{side}"), (0.42, f"calf_{side}"), (0.05, f"calf_{side}")]
    return lambda point: blend(stops, point[2])


def strap_weights(point):
    spine = min(max((point[2] - 0.98) / (1.15 - 0.98), 0.0), 1.0)
    return {"spine_03": spine, "pelvis": 1.0 - spine}


# ---- small vector and profile helpers ------------------------------------------------------------

def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def interp(profile, z):
    """Piecewise-linear value of (key, value) pairs sorted by key."""
    if z <= profile[0][0]:
        return profile[0][1]
    for (z0, v0), (z1, v1) in zip(profile, profile[1:]):
        if z0 <= z <= z1:
            return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
    return profile[-1][1]


def linspace(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def scale(a, k):
    return tuple(x * k for x in a)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a):
    length = math.sqrt(sum(x * x for x in a))
    return scale(a, 1.0 / length)


def ellipse_ring(centre, radii, sides, phase=0.0):
    x, y, z = centre
    rx, ry = radii
    return [(x + rx * math.cos(phase + math.tau * i / sides), y + ry * math.sin(phase + math.tau * i / sides), z)
            for i in range(sides)]


def arc_ring(centre, radii, start, end, steps):
    """An open arc of an ellipse, from start to end radians, steps + 1 points."""
    x, y, z = centre
    rx, ry = radii
    return [(x + rx * math.cos(a), y + ry * math.sin(a), z) for a in linspace(start, end, steps + 1)]


# ---- surface pieces ------------------------------------------------------------------------------

class Patch:
    """One surface piece: points, quad/tri faces and per-corner UVs in an atlas rectangle.

    UVs follow the grid (u across the ring, v up the rings) unless `planar` maps each point to rect-local
    (u, v) in [0, 1]. Winding is outward for rings that run counter-clockwise seen from above, bottom to top.
    """

    def __init__(self, rect):
        self.rect = rect
        self.points, self.faces, self.uv = [], [], []

    def _point(self, p):
        self.points.append(tuple(float(c) for c in p))
        return len(self.points) - 1

    def grid(self, rings, wrap=False, flip=False, planar=None):
        n, rows = len(rings[0]), len(rings)
        index = [[self._point(p) for p in ring] for ring in rings]
        den = n if wrap else n - 1
        for k in range(rows - 1):
            for i in range(n if wrap else n - 1):
                j = (i + 1) % n
                quad = [index[k][i], index[k][j], index[k + 1][j], index[k + 1][i]]
                param = [(i / den, k / (rows - 1)), ((i + 1) / den, k / (rows - 1)),
                         ((i + 1) / den, (k + 1) / (rows - 1)), (i / den, (k + 1) / (rows - 1))]
                if flip:
                    quad, param = [quad[0], quad[3], quad[2], quad[1]], [param[0], param[3], param[2], param[1]]
                self.faces.append(tuple(quad))
                self.uv.append([planar(self.points[v]) for v in quad] if planar else param)
        return index

    def drop(self, remove):
        """Remove the faces whose centre satisfies remove(centre), e.g. a cut-out for the face."""
        kept = []
        for face, uv in zip(self.faces, self.uv):
            centre = tuple(sum(self.points[v][a] for v in face) / len(face) for a in range(3))
            if not remove(centre):
                kept.append((face, uv))
        self.faces = [face for face, _ in kept]
        self.uv = [uv for _, uv in kept]

    def _fan(self, ring, reverse, planar):
        n = len(ring)
        pts = [self.points[i] for i in ring]
        centre = self._point(tuple(sum(p[a] for p in pts) / n for a in range(3)))

        def disc(i):
            t = math.tau * (i % n) / n
            return (0.5 + 0.5 * math.cos(t), 0.5 + 0.5 * math.sin(t))

        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            if reverse:
                tri, uv = (a, centre, b), [disc(i), (0.5, 0.5), disc(i + 1)]
            else:
                tri, uv = (a, b, centre), [disc(i), disc(i + 1), (0.5, 0.5)]
            if planar:
                uv = [planar(self.points[v]) for v in tri]
            self.faces.append(tri)
            self.uv.append(uv)

    def loft(self, rings, cap_first=False, cap_last=False, planar=None):
        """A closed tube of rings (wrapping around), optionally capped at the first and last ring."""
        index = self.grid(rings, wrap=True, planar=planar)
        if cap_first:
            self._fan(index[0], True, planar)
        if cap_last:
            self._fan(index[-1], False, planar)

    def tube(self, path, radii, sides=8):
        """Sweep an elliptic section (rx across the lock, ry through it) along a polyline."""
        rings = []
        for idx, centre in enumerate(path):
            if idx == 0:
                axis = sub(path[1], centre)
            elif idx == len(path) - 1:
                axis = sub(centre, path[idx - 1])
            else:
                axis = sub(path[idx + 1], path[idx - 1])
            axis = unit(axis)
            u = cross(axis, (0.0, 1.0, 0.0))
            if math.sqrt(sum(x * x for x in u)) < 1e-6:
                u = cross(axis, (1.0, 0.0, 0.0))
            u = unit(u)
            v = cross(axis, u)
            rx, ry = radii[idx]
            rings.append([add(centre, add(scale(u, rx * math.cos(math.tau * i / sides)),
                                          scale(v, ry * math.sin(math.tau * i / sides))))
                          for i in range(sides)])
        self.grid(rings, wrap=True)


class Geometry:
    """Disconnected pieces with one explicit normalised influence list per vertex and per-corner atlas UVs."""

    def __init__(self, atlas):
        self.atlas = atlas
        self.vertices, self.faces, self.uvs, self.weights, self.smooth = [], [], [], [], []

    def add(self, patch, weights, smooth=True):
        start = len(self.vertices)
        self.vertices.extend(patch.points)
        for vertex in patch.points:
            rows = weights(vertex) if callable(weights) else dict(weights)
            total = sum(rows.values())
            if abs(total - 1.0) > 1e-6 or any(joint not in JOINT_PARENTS for joint in rows):
                raise ValueError(f"bad weights {rows} at {vertex}")
            self.weights.append(rows)
        x0, y0, w, h = patch.rect
        for face, uv in zip(patch.faces, patch.uv):
            self.faces.append(tuple(start + index for index in face))
            self.uvs.append([((x0 + u * w) / self.atlas, (y0 + v * h) / self.atlas) for u, v in uv])
        self.smooth.extend([smooth] * len(patch.faces))
        return start, len(self.vertices)

    def mesh(self, name, root, armature, image):
        import bpy
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        if len(mesh.polygons) != len(self.faces):
            raise ValueError(f"{name}: Blender dropped faces")
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            if tuple(polygon.vertices) != self.faces[polygon.index]:
                raise ValueError(f"{name}: polygon order changed")
            for corner, loop_index in enumerate(polygon.loop_indices):
                uv_layer.data[loop_index].uv = self.uvs[polygon.index][corner]
            polygon.use_smooth = self.smooth[polygon.index]
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        grouped = {}
        for index, rows in enumerate(self.weights):
            for joint, weight in rows.items():
                grouped.setdefault(joint, {}).setdefault(round(weight, 6), []).append(index)
        for joint, by_weight in grouped.items():
            group = obj.vertex_groups.new(name=joint)
            for weight, indices in by_weight.items():
                group.add(indices, weight, "REPLACE")
        obj.parent = root
        modifier = obj.modifiers.new("CharacterSkin", "ARMATURE")
        modifier.object = armature
        modifier.use_vertex_groups = True
        material = bpy.data.materials.new(f"{name}_toon")
        material.use_nodes = True
        material.use_backface_culling = False
        material["gteki_toon"] = 1
        tree = material.node_tree
        bsdf = tree.nodes["Principled BSDF"]
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 1.0
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        tree.nodes.active = texture
        mesh.materials.append(material)
        return obj


# ---- body --------------------------------------------------------------------------------------

def coat_radii(z):
    return interp([(p[0], p[1]) for p in COAT_PROFILE], z), interp([(p[0], p[2]) for p in COAT_PROFILE], z)


def opening(z):
    return interp(OPEN_PROFILE, z)


def front_point(x, z, lift):
    """Point on the coat's outer front surface at (x, z), lifted along +Y."""
    rx, ry = coat_radii(z)
    x = clamp(x, -0.98 * rx, 0.98 * rx)
    return (x, ry * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2)) + lift, z)


def edge_angle(z):
    """Angle at which the coat's front edge meets the ellipse (the opening's outer boundary)."""
    rx, _ = coat_radii(z)
    return math.acos(clamp(opening(z) / rx, 0.0, 0.999))


def build_coat_upper():
    """Open overcoat from the skirt split up to the collar: the arc runs from the left front edge round the back."""
    rings = []
    for z in linspace(COAT_SPLIT_Z, COAT_TOP_Z, 12):
        rx, ry = coat_radii(z)
        theta = edge_angle(z)
        rings.append(arc_ring((0.0, 0.0, z), (rx, ry), math.pi - theta, 2 * math.pi + theta, 30))
    patch = Patch(BODY_RECTS["coat"])
    patch.grid(rings)
    return patch


def build_skirt_panels():
    """Two lower panels: left runs front-left edge to the back vent, right runs back vent to front-right edge.

    The panels run 2 cm above the 0.86 m split and sit 3 mm inside the upper coat there, so the overlap is
    hidden and no light edge shows across the back.
    """
    left, right = Patch(BODY_RECTS["panel_l"]), Patch(BODY_RECTS["panel_r"])
    rings_l, rings_r = [], []
    for z in linspace(HEM_Z, COAT_SPLIT_Z + 0.02, 8):
        rx, ry = coat_radii(z)
        inset = 0.003 if z > COAT_SPLIT_Z else 0.0
        rx, ry = rx - inset, ry - inset
        theta = edge_angle(z)
        rings_l.append(arc_ring((0.0, 0.0, z), (rx, ry), math.pi - theta, 1.5 * math.pi + SKIRT_OVERLAP, 12))
        grow = 0.003 if z < 0.78 else 0.0  # the right panel sits 3 mm proud so the laps never share a surface
        rings_r.append(arc_ring((0.0, 0.0, z), (rx + grow, ry + grow), 1.5 * math.pi - SKIRT_OVERLAP,
                                2 * math.pi + theta, 12))
    left.grid(rings_l)
    right.grid(rings_r)
    return left, right


def build_knit():
    """Cream knit torso in the opening: a strip from the belt at 0.98 m up to just under the collar."""
    rows = []
    for z in linspace(0.98, 1.385, 8):
        half = opening(z)
        rows.append([front_point(half * (2.0 * c / 6 - 1.0), z, 0.004) for c in range(7)])
    patch = Patch(BODY_RECTS["knit"])
    patch.grid(rows, flip=True)
    return patch


def lapel_width(z):
    """Lapel width: 0.115 m at the shoulder, a point at 1.00 m, and a 2 cm notch step at 1.30 m."""
    width = 0.115 * (z - 1.00) / 0.37
    return width - 0.020 if z < 1.30 else width


def build_lapels():
    """Big triangular lapels as raised geometry: from the opening edge out over the coat front, with the dark
    outer edge painted on the texture. The middle column stands proud of the coat."""
    out = []
    for s, rect in ((-1.0, BODY_RECTS["lapel_l"]), (1.0, BODY_RECTS["lapel_r"])):
        rows = []
        for z in (1.00, 1.10, 1.20, 1.29, 1.30, 1.34, 1.37):
            width = max(lapel_width(z), 0.0)
            row = []
            for c in range(3):
                x = s * (opening(z) + width * c / 2)
                row.append(front_point(x, z, 0.010 + (0.014 if c == 1 else 0.0)))
            rows.append(row)
        patch = Patch(rect)
        patch.grid(rows, flip=s > 0)
        out.append(patch)
    return out


def sleeve_radius(z):
    return interp(SLEEVE_PROFILE, z)


def arm_axis_x(z):
    """Sleeve axis x at height z, following the arm bones: shoulder 0.170 -> elbow 0.205 -> wrist 0.235."""
    if z >= 1.115:
        return interp([(1.115, 0.205), (1.335, 0.170)], z)
    return interp([(0.945, 0.235), (1.115, 0.205)], z)


def build_sleeve(s, rect):
    rings = []
    for z in linspace(0.93, SLEEVE_TOP_Z, 10):
        r = sleeve_radius(z)
        rings.append(ellipse_ring((s * arm_axis_x(z), 0.0, z), (r, r * 0.95), 16))
    patch = Patch(rect)
    patch.loft(rings, cap_last=True)  # open cuff at the bottom: the hand comes out of it
    return patch


def build_trouser(s, rect):
    rings = [ellipse_ring((s * 0.085, 0.0, z), (r, r), 14) for z, r in zip(TROUSER_ZS, TROUSER_R)]
    patch = Patch(rect)
    patch.loft(rings, cap_first=True, cap_last=True)
    return patch


def build_shoe(s, rect):
    rings = [ellipse_ring((s * 0.085, 0.045, z), (rx, ry), 14) for z, rx, ry in SHOE_RINGS]
    patch = Patch(rect)
    patch.loft(rings, cap_first=True, cap_last=True)
    return patch


def build_body():
    body = Geometry(BODY_ATLAS)
    body.add(build_coat_upper(), coat_weights)
    left, right = build_skirt_panels()
    body.add(left, skirt_weights("l"))
    body.add(right, skirt_weights("r"))
    body.add(build_knit(), coat_weights)
    for lapel in build_lapels():
        body.add(lapel, coat_weights)
    neck = Patch(BODY_RECTS["neck"])
    neck.loft([ellipse_ring((0.0, 0.0, z), (0.052, 0.050), 12) for z in (1.32, 1.44)], cap_first=True, cap_last=True)
    body.add(neck, {"neck_01": 1.0})
    for s, side in ((-1.0, "l"), (1.0, "r")):
        body.add(build_sleeve(s, BODY_RECTS[f"sleeve_{side}"]), arm_weights(side))
        hand = Patch(BODY_RECTS["hands"])
        hand.loft([ellipse_ring((s * 0.235, HAND_Y, z), (r, r * 0.6), 10) for z, r in HAND_RINGS],
                  cap_first=True, cap_last=True)
        body.add(hand, {f"hand_{side}": 1.0})
        body.add(build_trouser(s, BODY_RECTS[f"trouser_{side}"]), leg_weights(side))
        body.add(build_shoe(s, BODY_RECTS["shoe"]), {f"foot_{side}": 1.0}, smooth=False)
    tote = Patch(BODY_RECTS["tote"])
    tote.loft([ellipse_ring((TOTE_X, 0.0, z), (rx, ry), 14) for z, rx, ry in TOTE_RINGS],
              cap_first=True, cap_last=True)
    body.add(tote, {"pelvis": 1.0})
    strap = Patch(BODY_RECTS["strap"])
    strap.tube(STRAP_PATH, [(0.008, 0.004)] * len(STRAP_PATH), sides=6)
    body.add(strap, strap_weights)
    return body


# ---- head and bob ------------------------------------------------------------------------------

def egg_radii(zn):
    """Head egg (rx, ry) at normalised height zn in [-1, 1]: a slightly tapered jaw and crown."""
    ring = math.sqrt(max(0.0, 1.0 - zn * zn))
    profile = 1.0 + 0.06 * zn - 0.10 * max(0.0, -zn)
    return HEAD_RADII[0] * ring * profile, HEAD_RADII[1] * ring * profile


def head_front_y(x, z):
    rx, ry = egg_radii((z - HEAD_CENTRE[2]) / HEAD_RADII[2])
    return ry * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2))


def face_uv(point):
    x, y, z = point
    if y < 0.0:
        return (0.02, 0.02)  # the back of the skull is under the bob: any texel will do
    return (clamp((x - FACE_X0) / FACE_W), clamp((z - FACE_Z0) / FACE_H))


def build_egg():
    """Skin: the head egg, its front planar-mapped onto the face rectangle."""
    rings = []
    for zn in linspace(-0.97, 0.97, 10):
        rx, ry = egg_radii(zn)
        rings.append(ellipse_ring((0.0, 0.0, HEAD_CENTRE[2] + HEAD_RADII[2] * zn), (rx, ry), 16))
    patch = Patch(FACE_RECT)
    patch.loft(rings, cap_first=True, cap_last=True, planar=face_uv)
    return patch


def build_eye(side):
    """Open-eye lens: a small grid on the head surface, 1 mm proud, UV-mapped to its eye slot."""
    xc = side * EYE_X
    xs = linspace(xc - EYE_HALF_W, xc + EYE_HALF_W, 5)
    zs = linspace(EYE_Z - EYE_HALF_H, EYE_Z + EYE_HALF_H, 4)
    rings = [[(x, head_front_y(x, z) + 0.001, z) for x in xs] for z in zs]

    def uv(point):
        return (clamp((point[0] - (xc - EYE_HALF_W)) / (2 * EYE_HALF_W)),
                clamp((point[2] - (EYE_Z - EYE_HALF_H)) / (2 * EYE_HALF_H)))

    patch = Patch(EYE_RECTS[side])
    patch.grid(rings, flip=True, planar=uv)
    return patch


BANGS = [((-0.060, -0.078), 0), ((-0.036, -0.052), 0), ((-0.012, -0.022), 0),
         ((0.014, 0.030), 0), ((0.038, 0.058), 0)]  # (root x, tip x): the part sits off centre at -0.012


def shell_radii(z):
    """Bob (rx, ry) at height z: a rounded outline widest at cheek level, then a hemisphere cap to the crown."""
    if z <= DOME_BASE_Z:
        return (interp([(p[0], p[1]) for p in BOB_LOWER], z), interp([(p[0], p[2]) for p in BOB_LOWER], z))
    t = math.asin(min(1.0, (z - DOME_BASE_Z) / DOME_HEIGHT))
    rx = DOME_RX * math.cos(t)
    return rx, 0.95 * rx + 0.010 * math.cos(t)


def face_opening_angle(z):
    if z <= DOME_BASE_Z:
        return BOB_OPEN
    return BOB_OPEN * max(0.0, (BOB_FADE_Z - z) / (BOB_FADE_Z - DOME_BASE_Z))


def in_face_opening(centre):
    x, y, z = centre
    if y <= 0.0:
        return False
    rx, ry = shell_radii(z)
    phi = math.atan2(y / ry, x / rx)
    return abs(phi - math.pi / 2) < face_opening_angle(z)


def hair_front_y(x, z):
    rx, ry = shell_radii(z)
    return ry * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2))


def fringe_z(x):
    """Lower edge of the fringe: five rounded-point scallops between six tips (x, z), a 8 mm cusp between tips."""
    tips_x = [-0.085, -0.051, -0.017, 0.017, 0.051, 0.085]
    tips_z = [1.578, 1.565, 1.572, 1.560, 1.570, 1.590]
    for i in range(5):
        if tips_x[i] <= x <= tips_x[i + 1]:
            t = (x - tips_x[i]) / (tips_x[i + 1] - tips_x[i])
            return tips_z[i] + (tips_z[i + 1] - tips_z[i]) * t + 0.008 * math.sin(math.pi * t)
    return tips_z[0] if x < 0 else tips_z[-1]


def build_fringe():
    """One curved fringe sheet on the forehead: 4 mm proud of the shell, with an 8 mm back face."""
    columns = [-0.085 + 0.170 * j / 24 for j in range(25)]
    rows_front, rows_back = [], []
    top = 1.660  # tucked under the crown shell
    for r in range(4):
        front_row, back_row = [], []
        for x in columns:
            low = fringe_z(x)
            z = low + (top - low) * r / 3
            y = hair_front_y(x, z) + 0.004
            front_row.append((x, y, z))
            back_row.append((x, y - 0.008, z))
        rows_front.append(front_row)
        rows_back.append(back_row)
    sheet = Patch(HAIR_CELLS[1])
    sheet.grid(rows_front, flip=True)
    sheet.grid(rows_back)  # the back face: normals point away from the forehead
    return sheet


def build_bob():
    """One solid bob: a closed rounded shell (lower outline plus hemisphere crown) with the face opening cut
    out of its front, the lower edge scalloped into BOB_TIPS tips, and one fringe sheet over the forehead.

    Ellipse angle theta is measured from +X, so the front (+Y) is pi/2.
    """
    zs = [1.400, 1.450, 1.500, DOME_BASE_Z] + [DOME_BASE_Z + DOME_HEIGHT * math.sin(math.radians(d))
                                              for d in range(15, 91, 15)]
    rings = []
    for z in zs:
        rx, ry = shell_radii(z)
        ring = []
        for j in range(28):
            theta = math.tau * j / 28
            wave = 0.5 + 0.5 * math.cos(BOB_TIPS * theta)  # 1 at a tip apex
            lift = (0.020 if z < 1.42 else 0.010) * wave if z < 1.46 else 0.0
            x, y = rx * math.cos(theta), ry * math.sin(theta)
            if z < 1.42:
                x *= 1 - 0.04 * wave  # tips curve slightly inward
            ring.append((x, y, z - lift))
        rings.append(ring)
    shell = Patch(HAIR_CELLS[0])
    shell.loft(rings, cap_last=True)
    shell.drop(in_face_opening)
    return [shell, build_fringe()]


def build_head():
    head = Geometry(HEAD_ATLAS)
    head.add(build_egg(), {"head": 1.0})
    eyes = [head.add(build_eye(side), {"head": 1.0}) for side in (-1.0, 1.0)]
    for patch in build_bob():
        head.add(patch, {"head": 1.0})
    return head, eyes


# ---- painted atlases (sRGB, row 0 = bottom) -------------------------------------------------

def rgb(hex_string):
    import numpy as np
    return np.array([int(hex_string[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)


def flat(hex_string, shape):
    import numpy as np
    return np.broadcast_to(rgb(hex_string), shape + (3,)).astype(np.float32)


def over(base, colour, mask):
    import numpy as np
    m = np.asarray(mask, dtype=np.float32)[..., None]
    return base * (1.0 - m) + np.asarray(colour, dtype=np.float32) * m


def band(x, low, high):
    import numpy as np
    return ((x >= low) & (x <= high)).astype(np.float32)


def paint(canvas, rect, painter):
    import numpy as np
    x0, y0, w, h = rect
    s = (np.arange(w) + 0.5) / w
    t = (np.arange(h) + 0.5) / h
    S, T = np.meshgrid(s, t)
    canvas[y0:y0 + h, x0:x0 + w] = painter(S, T)


def navy_shade(S):
    import numpy as np
    base = flat(NAVY, S.shape)
    edge = np.abs(S - 0.5) * 2
    return base * (1.0 - 0.10 * edge ** 2)[..., None]


def coat_paint(S, T):
    import numpy as np
    base = navy_shade(S)
    back = (np.abs(S - 0.5) < 0.32).astype(np.float32)
    base = over(base, rgb(NAVY_DARK), band(T, 0.725, 0.733) * back)  # yoke seam across the back
    base = over(base, rgb(NAVY_LIGHT), band(T, 0.733, 0.79) * back * 0.5)  # storm flap above it
    base = over(base, rgb(NAVY_DARK), band(T, 0.93, 1.0) * 0.6)  # collar shade
    return base


def panel_paint(S, T):
    import numpy as np
    base = navy_shade(S)
    base = over(base, rgb(NAVY_DARK), band(T, 0.0, 0.05) * 0.6)  # hem edge at 0.50 m
    vent = (T < 0.66).astype(np.float32)  # the back vent runs from about 0.75 m down
    return over(base, rgb(NAVY_DARK), np.clip(band(S, 0.0, 0.04) + band(S, 0.96, 1.0), 0, 1) * 0.8 * vent)


def knit_paint(S, T):
    import numpy as np
    base = flat(CREAM, S.shape)
    rib = band(np.mod(S * 9.0, 1.0), 0.0, 0.14)
    base = over(base, rgb(KNIT_RIB), rib * 0.7)
    base = over(base, rgb(KNIT_RIB), band(T, 0.92, 1.0) * rib * 0.5)  # mock neck band
    base = over(base, rgb(BELT), band(T, 0.0, 0.06))  # thin dark belt where the trousers start
    return base


def lapel_paint(S, T):
    base = flat(LAPEL, S.shape) * (0.94 + 0.06 * T)[..., None]
    return over(base, rgb(LAPEL_EDGE), band(S, 1.0 - 3.0 / 128.0, 1.0))  # 3-texel dark outer edge


def trouser_paint(S, T):
    import numpy as np
    base = flat(TAUPE, S.shape) * (0.94 + 0.06 * T)[..., None]
    creases = np.clip(band(S, 0.245, 0.255) + band(S, 0.745, 0.755), 0, 1)
    base = over(base, rgb(TAUPE_CREASE), creases * 0.7)
    return over(base, rgb(TAUPE_HEM), band(T, 0.0, 0.03))  # clear hem line


def sleeve_paint(S, T):
    import numpy as np
    base = flat(NAVY, S.shape)
    cuff_rib = band(np.mod(S * 12.0, 1.0), 0.0, 0.15)
    base = over(base, rgb(KNIT_RIB), band(T, 0.0, 0.025) * cuff_rib * 0.5)
    base = over(base, rgb(CREAM), band(T, 0.0, 0.025))  # 1 cm cream knit cuff ring
    base = over(base, rgb(CUFF_BAND), band(T, 0.025, 0.099))  # 3 cm turned-back cuff band
    base = over(base, rgb(NAVY_DARK), band(T, 0.9, 1.0) * 0.5)
    return over(base, rgb(NAVY_DARK), np.clip(band(S, 0.0, 0.03) + band(S, 0.97, 1.0), 0, 1) * 0.5)


def shoe_paint(S, T):
    import numpy as np
    base = flat(SHOE, S.shape)
    base = over(base, rgb(SHOE_HI), band(S, 0.2, 0.3) * band(T, 0.5, 0.8) * 0.6)
    base = over(base, rgb(SOLE), band(T, 0.0, 0.18))  # darker sole band
    return over(base, rgb(SOLE), np.clip(band(T, 0.18, 0.2), 0, 1) * 0.8)


def tote_paint(S, T):
    import numpy as np
    base = flat(TOTE, S.shape) * (0.95 + 0.05 * T)[..., None]
    return over(base, rgb(STITCH), band(T, 0.93, 0.95) * 0.6)  # one light seam line, no checker


def strap_paint(S, T):
    return flat(TOTE, S.shape)


def body_atlas():
    import numpy as np
    canvas = np.zeros((BODY_ATLAS, BODY_ATLAS, 3), dtype=np.float32)
    painters = dict(coat=coat_paint, panel_l=panel_paint, panel_r=panel_paint, knit=knit_paint,
                    lapel_l=lapel_paint, lapel_r=lapel_paint, trouser_l=trouser_paint, trouser_r=trouser_paint,
                    sleeve_l=sleeve_paint, sleeve_r=sleeve_paint, shoe=shoe_paint, tote=tote_paint,
                    strap=strap_paint, hands=lambda S, T: flat(SKIN, S.shape),
                    neck=lambda S, T: flat(NECK_SKIN, S.shape))
    for name, rect in BODY_RECTS.items():
        paint(canvas, rect, painters[name])
    return canvas


def face_paint(S, T):
    import numpy as np
    x, z = FACE_X0 + FACE_W * S, FACE_Z0 + FACE_H * T
    base = flat(SKIN, S.shape)
    for side in (-1.0, 1.0):
        blush = np.exp(-(((x - side * 0.060) / 0.017) ** 2 + ((z - 1.470) / 0.010) ** 2))
        base = over(base, rgb("#F0A9A0"), blush * 0.585)
    base = over(base, rgb("#E2B39E"), np.exp(-((x / 0.004) ** 2 + ((z - 1.485) / 0.008) ** 2)) * 0.5)  # nose
    base = over(base, rgb("#B0604E"), band(z - (1.455 + 6.0 * x * x), -0.0012, 0.0012) * (np.abs(x) < 0.013))
    for side in (-1.0, 1.0):
        xr = x * side
        brow_z = 1.556 + 0.010 * (xr - 0.030) / 0.040
        inside = (xr >= 0.030) & (xr <= 0.072)
        base = over(base, rgb("#6A4A3A"), band(z - brow_z, -0.0015, 0.0015) * inside * 0.9)
        dx = x - side * EYE_X
        arc = EYE_Z - 0.010 * (1.0 - np.clip(dx / EYE_HALF_W, -1, 1) ** 2)
        base = over(base, rgb("#3B2A20"), band(z - arc, -0.0016, 0.0016) * (np.abs(dx) < EYE_HALF_W))  # closed-eye arc
    return base


def eye_paint(S, T):
    import numpy as np
    dx, dz = (S - 0.5) * 2, (T - 0.5) * 2
    base = flat(SKIN, S.shape)
    shape = (dx ** 2 + (dz / 0.92) ** 2) < 1.0
    iris = ((dx / 0.66) ** 2 + (dz / 0.70) ** 2) < 1.0
    g = ((dz + 1.0) / 2.0)[..., None]
    iris_colour = rgb(IRIS_TOP) * g + rgb(IRIS_BOT) * (1.0 - g)
    out = np.where(shape[..., None], flat(SCLERA, S.shape), base)
    out = np.where(iris[..., None], iris_colour, out)
    out = np.where((shape & (dz > 0.74))[..., None], flat(LASH, S.shape), out)
    highlight = (((dx + 0.28) / 0.16) ** 2 + ((dz - 0.30) / 0.16) ** 2 < 1.0) | (
        ((dx - 0.26) / 0.07) ** 2 + ((dz + 0.22) / 0.07) ** 2 < 1.0)
    out = np.where((shape & highlight)[..., None], flat("#FFFFFF", S.shape), out)
    return out.astype(np.float32)


def hair_paint(S, T):
    import numpy as np
    base = flat(HAIR, S.shape)
    base = over(base, rgb(HAIR_HI), band(S, 0.30, 0.45) * 0.8)  # painted highlight band
    edge = np.clip(band(S, 0.0, 0.10) + band(S, 0.90, 1.0) + band(T, 0.0, 0.06), 0, 1)
    return over(base, rgb(HAIR_SHADE), edge * 0.5)


def head_atlas():
    import numpy as np
    canvas = np.zeros((HEAD_ATLAS, HEAD_ATLAS, 3), dtype=np.float32)
    paint(canvas, FACE_RECT, face_paint)
    for side, rect in EYE_RECTS.items():
        paint(canvas, rect, eye_paint)
    for rect in HAIR_CELLS:
        paint(canvas, rect, hair_paint)
    return canvas


def make_image(name, canvas, out):
    """Write the atlas as a PNG beside the GLB, reload it as a file-backed sRGB image and embed it.

    Pixels set on a generated image are lost when it is packed, so the file is the source of truth.
    """
    import bpy
    import numpy as np
    size = canvas.shape[0]
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., :3] = canvas
    scratch = bpy.data.images.new(f"{name}_scratch", width=size, height=size, alpha=True)
    scratch.pixels.foreach_set(rgba.ravel())
    path = out / f"{name}.png"
    scratch.filepath_raw = str(path)
    scratch.file_format = "PNG"
    scratch.save()
    bpy.data.images.remove(scratch)
    image = bpy.data.images.load(str(path), check_existing=False)
    image.name = name
    image.colorspace_settings.name = "sRGB"
    image.pack()
    return image


def add_blinks(head, eyes):
    """Each blink pushes that eye's lens along its normal, ~4 mm under the skin (the closed arc is painted there)."""
    head.shape_key_add(name="Basis")
    for name, (start, stop) in zip(BLINKS, eyes):
        key = head.shape_key_add(name=name)
        key.value = 0.0
        for index in range(start, stop):
            co = key.data[index].co
            normal = unit(sub((co.x, co.y, co.z), HEAD_CENTRE))
            co.x -= normal[0] * BLINK_PUSH_M
            co.y -= normal[1] * BLINK_PUSH_M
            co.z -= normal[2] * BLINK_PUSH_M
        print(f"{name}: {stop - start} eye vertices pushed {BLINK_PUSH_M * 1000:.0f} mm along the normal")


def build_scene(out):
    import bpy
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.actions, bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for block in list(datablocks):
            datablocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    root = bpy.data.objects.new(CHARACTER_ID, None)
    scene.collection.objects.link(root)
    positions = joint_positions()
    arm = build_armature(root, bone_pairs(positions))
    arm.name = arm.data.name = f"ARM_{CHARACTER_ID}"

    body_image = make_image("body_atlas", body_atlas(), out)
    head_image = make_image("head_atlas", head_atlas(), out)
    body = build_body().mesh("VIS_body", root, arm, body_image)
    head_geometry, eyes = build_head()
    head = head_geometry.mesh("VIS_head", root, arm, head_image)
    add_blinks(head, eyes)
    print(f"meshes: body {triangle_count(body.data)} triangles, head {triangle_count(head.data)} triangles")

    animation = Animation(bone_pairs(positions))
    animation.gait_spec["walk"]["crouch"] = WALK_CROUCH_M
    build_actions(arm, animation)
    scene.frame_start, scene.frame_end = 1, 121
    return arm, body, head, animation


def report(body, head):
    top = max(vertex.co.z for obj in (body, head) for vertex in obj.data.vertices)
    chin, crown = HEAD_CENTRE[2] - HEAD_RADII[2], HEAD_CENTRE[2] + HEAD_RADII[2]
    print(f"height {top:.3f} m; head {crown - chin:.3f} m (chin {chin:.3f}, crown {crown:.3f}); "
          f"head ratio {top / (crown - chin):.2f}; "
          f"triangles {triangle_count(body.data) + triangle_count(head.data)}")


def set_camera(camera, location, turn):
    camera.location = location
    camera.rotation_euler = (math.radians(90.0), 0.0, math.radians(turn))


def preview_material(name, image):
    """Toon-look preview only (never exported): atlas -> diffuse -> ShaderToRGB -> constant ramp, multiplied by
    the atlas, added to the runtime fill (atlas x 0.55) and emitted."""
    import bpy
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    tree.links.new(texture.outputs["Color"], diffuse.inputs["Color"])
    to_rgb = tree.nodes.new("ShaderNodeShaderToRGB")
    tree.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    stops = ramp.color_ramp.elements
    stops[0].position, stops[0].color = 0.0, (150 / 255, 150 / 255, 150 / 255, 1.0)
    stops[1].position, stops[1].color = 0.35, (205 / 255, 205 / 255, 205 / 255, 1.0)
    top = stops.new(0.65)
    top.color = (1.0, 1.0, 1.0, 1.0)
    tree.links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])
    shade = tree.nodes.new("ShaderNodeMixRGB")
    shade.blend_type = "MULTIPLY"
    shade.inputs["Fac"].default_value = 1.0
    tree.links.new(ramp.outputs["Color"], shade.inputs["Color1"])
    tree.links.new(texture.outputs["Color"], shade.inputs["Color2"])
    fill = tree.nodes.new("ShaderNodeMixRGB")
    fill.blend_type = "MULTIPLY"
    fill.inputs["Fac"].default_value = 1.0
    tree.links.new(texture.outputs["Color"], fill.inputs["Color1"])
    fill.inputs["Color2"].default_value = (0.55, 0.55, 0.55, 1.0)
    total = tree.nodes.new("ShaderNodeMixRGB")
    total.blend_type = "ADD"
    total.inputs["Fac"].default_value = 1.0
    tree.links.new(shade.outputs["Color"], total.inputs["Color1"])
    tree.links.new(fill.outputs["Color"], total.inputs["Color2"])
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(total.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return material


def apply_preview_look(camera_scene):
    """EEVEE scene for the previews: grey world, one warm sun from front-left-above, toon materials."""
    import bpy
    scene = camera_scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.290, 0.290, 0.290, 1.0)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    sun = bpy.data.lights.new("PreviewSun", "SUN")
    sun.energy = 3.0
    sun_object = bpy.data.objects.new("PreviewSun", sun)
    scene.collection.objects.link(sun_object)
    sun_object.rotation_euler = (math.radians(50.0), 0.0, math.radians(-30.0))
    for name, image_name in (("VIS_body", "body_atlas"), ("VIS_head", "head_atlas")):
        obj = bpy.data.objects[name]
        obj.data.materials.clear()
        obj.data.materials.append(preview_material(f"{name}_preview", bpy.data.images[image_name]))


def render_previews(out, arm):
    import bpy
    scene = bpy.context.scene
    apply_preview_look(scene)
    scene.render.resolution_x, scene.render.resolution_y = 600, 800
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new("QA_camera", bpy.data.cameras.new("QA_camera"))
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.95
    scene.camera = camera
    views = {
        "front": ((0.0, 3.0, 0.84), 180.0, "idle", 1),
        "q45": ((2.12, 2.12, 0.84), 135.0, "idle", 1),
        "side": ((3.0, 0.0, 0.84), 90.0, "idle", 1),
        "back": ((0.0, -3.0, 0.84), 0.0, "idle", 1),
        "walk8": ((2.2, 2.2, 0.84), 135.0, "walk", 8),
    }
    for name, (location, turn, action, frame) in views.items():
        set_camera(camera, location, turn)
        arm.animation_data.action = bpy.data.actions[action]
        scene.frame_set(frame)
        scene.render.filepath = str(out / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"preview {name}: {scene.render.filepath}")
    arm.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)
    return camera


def render_walk_strip(out, arm, camera):
    """Eight walk frames from the back and the right side, 300x400 each, assembled into one strip."""
    import bpy
    import numpy as np
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 300, 400
    scene.render.image_settings.file_format = "PNG"
    camera.data.ortho_scale = 1.95
    frames = (0, 4, 8, 12, 16, 20, 24, 28)
    views = (("back", (0.0, -3.0, 0.84), 0.0, 1), ("side", (3.0, 0.0, 0.84), 90.0, 0))
    width, height = 300 * len(frames), 400 * 2
    strip = np.zeros((height, width, 4), dtype=np.float32)
    arm.animation_data.action = bpy.data.actions["walk"]
    tiles = []
    for name, location, turn, row in views:
        set_camera(camera, location, turn)
        for column, frame in enumerate(frames):
            scene.frame_set(frame)
            path = out / f"walk_{name}_{frame:02d}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(str(path))
            pixels = np.empty(len(image.pixels), dtype=np.float32)
            image.pixels.foreach_get(pixels)
            strip[row * 400:(row + 1) * 400, column * 300:(column + 1) * 300] = pixels.reshape(400, 300, 4)
            bpy.data.images.remove(image)
            tiles.append(path)
    sheet = bpy.data.images.new("walk_strip", width=width, height=height, alpha=True)
    sheet.pixels.foreach_set(strip.reshape(-1))
    sheet.filepath_raw = str(out / "walk_strip.png")
    sheet.file_format = "PNG"
    sheet.save()
    for path in tiles:
        path.unlink(missing_ok=True)
    arm.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)
    print(f"preview walk_strip: {out / 'walk_strip.png'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    import bpy
    print(f"Blender {bpy.app.version_string}")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    arm, body, head, animation = build_scene(out)
    report(body, head)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f"{CHARACTER_ID}.blend"), compress=True)
    print(export_character(CHARACTER_ID, "high", out, clips=animation.clips(), description=DERIVATION,
                           textured=True))
    if args.preview:
        render_walk_strip(out, arm, render_previews(out, arm))


if __name__ == "__main__":
    main()
