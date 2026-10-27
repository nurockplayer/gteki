#!/usr/bin/env python3
"""Build the #339 soft-stylized commuter silhouette sample from Blender primitives.

No body generator and no downloaded mesh: every vertex is generated here from rings, eggs and boxes.
The rig, clips and export path come from the MPFB build, so the result passes the same validator.

Usage: Blender -b --factory-startup --python build_commuter_soft.py -- --out <dir> [--preview]
"""
import argparse
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_commuter_mpfb import (Animation, build_actions, build_armature, colour,  # noqa: E402
                                 finish_mesh, triangle_count)
from build_p0_sample import joint_positions as p0_joints  # noqa: E402
from export_character import export_character  # noqa: E402
from validate_character import BLINKS, FPS, JOINT_PARENTS  # noqa: E402

CHARACTER_ID = "gteki_commuter_soft"
DERIVATION = ("original: soft-stylized commuter silhouette hand-built from Blender primitives; "
              "see apps/web/public/avatars/gteki-commuter-soft.provenance.json")

# Look (#339 soft-stylized direction): flat sRGB colours, matching the procedural avatar palette.
SKIN, HAIR, COAT, CREAM = "#cfa283", "#3b2a20", "#26324b", "#e8dcc4"
TROUSERS, SHOES, TOTE = "#a8a59a", "#2a2622", "#8a7a66"
EYE, BROW, MOUTH = "#2a2320", "#3b2a20", "#9a5a4a"

HEM_Z = 0.50
# 6.2 heads: chin 1.395, crown 1.666 (0.271 m); the bob adds 1.5 cm, so the mesh top is 1.680 m.
HEAD_CENTRE, HEAD_RADII = (0.0, 0.0, 1.5305), (0.095, 0.105, 0.1355)
HAIR_VOLUME, HAIR_TEMPLE_Z, HAIR_HEM_Z = 0.015, 1.505, 1.393
HAIR_Y_SHIFT = -0.006  # a bob carries its volume behind the ears
HAIR_RING_Z = (HAIR_HEM_Z, 1.425, 1.462, HAIR_TEMPLE_Z, 1.540, 1.570, 1.600, 1.625,
               1.647, 1.664, 1.674, 1.680)
EYE_Y, EYE_Z, EYE_RADII = 0.087, 1.522, (0.014, 0.0075, 0.020)
HAND_Y = 0.030
WALK_CROUCH_M = 0.025  # near-straight stance leg; the shared Animation stays on its own default

# joint -> (head, tail) is what the armature, the Animation clips and the exporter all read.
SPINE_STOPS = [(1.36, "spine_03"), (1.26, "spine_02"), (1.10, "spine_01"), (0.94, "pelvis")]


def joint_positions():
    """Contract joints: p0's layout, with a bigger head, narrower shoulders and arms hanging at the sides."""
    positions = {name: tuple(point) for name, point in p0_joints().items()}
    positions.update({"neck_01": (0.0, 0.0, 1.43), "head": (0.0, 0.0, 1.53)})
    for side, s in (("l", -1.0), ("r", 1.0)):
        positions.update({
            f"clavicle_{side}": (s * 0.045, 0.0, 1.345), f"upperarm_{side}": (s * 0.135, 0.0, 1.345),
            f"lowerarm_{side}": (s * 0.145, 0.0, 1.13), f"hand_{side}": (s * 0.137, HAND_Y, 0.955),
            f"fingers_01_{side}": (s * 0.137, HAND_Y, 0.895), f"fingers_02_{side}": (s * 0.137, HAND_Y, 0.815),
            f"thumb_01_{side}": (s * 0.143, 0.055, 0.925), f"thumb_02_{side}": (s * 0.148, 0.065, 0.905),
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
    """Spine chain above the hip; below it, half the hem follows the thighs so the walk does not tear it."""
    z, x = point[2], point[0]
    if z >= 0.86:
        return blend(SPINE_STOPS, z)
    # Both thighs share the hem equally at the front and back centre (where the two legs cancel out)
    # and hand over to the near thigh at the sides, so the walk does not pull two flaps apart.
    thigh = 0.5 * min(1.0, (0.86 - z) / (0.86 - HEM_Z))
    right = 0.5 + 0.5 * min(max(x / 0.14, -1.0), 1.0)
    return {"pelvis": 1.0 - thigh, "thigh_r": thigh * right, "thigh_l": thigh * (1.0 - right)}


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


# ---- primitives -------------------------------------------------------------------------------

def ellipse_ring(centre, radii, sides, phase=0.0):
    x, y, z = centre
    rx, ry = radii
    return [(x + rx * math.cos(phase + i * math.tau / sides),
             y + ry * math.sin(phase + i * math.tau / sides), z) for i in range(sides)]


def loft(rings, cap_start=False, cap_end=False):
    """Skin rings ordered along the surface direction; outward normals follow the right-hand rule."""
    sides = len(rings[0])
    points = [point for ring in rings for point in ring]
    faces = []
    for k in range(len(rings) - 1):
        lower, upper = k * sides, (k + 1) * sides
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((lower + i, lower + j, upper + j, upper + i))
    if cap_start:
        faces.append(tuple(reversed(range(sides))))
    if cap_end:
        start = (len(rings) - 1) * sides
        faces.append(tuple(start + i for i in range(sides)))
    return points, faces


def egg(centre, radii, segments=20, rings=14):
    """Bottom-to-top UV sphere with a tapered jaw and a slightly wider crown."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    points = [(cx, cy, cz - rz)]
    for k in range(1, rings):
        z_norm = -1.0 + 2.0 * k / rings
        ring = math.sqrt(max(0.0, 1.0 - z_norm * z_norm))
        profile = 1.0 + 0.06 * z_norm - 0.10 * max(0.0, -z_norm)
        points.extend(ellipse_ring((cx, cy, cz + rz * z_norm),
                                   (rx * ring * profile, ry * ring * profile), segments))
    top = len(points)
    points.append((cx, cy, cz + rz))
    faces = []
    for i in range(segments):
        faces.append((0, 1 + (i + 1) % segments, 1 + i))
    for k in range(rings - 2):
        lower, upper = 1 + k * segments, 1 + (k + 1) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((lower + i, lower + j, upper + j, upper + i))
    last = 1 + (rings - 2) * segments
    for i in range(segments):
        faces.append((last + i, last + (i + 1) % segments, top))
    return points, faces


def path_tube(points, radii, sides=6):
    """Sweep a rectangle-ish cross-section along a 3D polyline (the tote strap)."""
    from mathutils import Vector
    centres = [Vector(point) for point in points]
    rings = []
    for index, centre in enumerate(centres):
        if index == 0:
            axis = centres[1] - centre
        elif index == len(centres) - 1:
            axis = centre - centres[index - 1]
        else:
            axis = centres[index + 1] - centres[index - 1]
        axis.normalize()
        u = axis.cross(Vector((0.0, 1.0, 0.0)))
        if u.length < 1e-6:
            u = axis.cross(Vector((1.0, 0.0, 0.0)))
        u.normalize()
        v = axis.cross(u)
        rx, ry = radii[index]
        rings.append([tuple(centre + rx * math.cos(i * math.tau / sides) * u
                            + ry * math.sin(i * math.tau / sides) * v) for i in range(sides)])
    merged = [point for ring in rings for point in ring]
    faces = []
    for k in range(len(rings) - 1):
        lower, upper = k * sides, (k + 1) * sides
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((lower + i, lower + j, upper + j, upper + i))
    return merged, faces


def skull_radii(z):
    """Head-egg silhouette (rx, ry) at height z; the same profile the head mesh is built from."""
    z_norm = (z - HEAD_CENTRE[2]) / HEAD_RADII[2]
    ring = math.sqrt(max(0.0, 1.0 - z_norm * z_norm))
    profile = 1.0 + 0.06 * z_norm - 0.10 * max(0.0, -z_norm)
    return HEAD_RADII[0] * ring * profile, HEAD_RADII[1] * ring * profile


def hair_radii(z):
    """1.5 cm off the skull above the temples; below them the silhouette holds and flares to a level hem.

    Above the temples the offset is an ellipsoid grown by the hair volume, not the skull plus a constant:
    adding a constant to the skull's own crown taper would leave the bob with a cone on top.
    """
    if z <= HAIR_TEMPLE_Z:
        rx, ry = skull_radii(HAIR_TEMPLE_Z)
        flare = HAIR_VOLUME + (HAIR_TEMPLE_Z - z) * 0.06
        return rx + flare, ry + flare
    z_norm = (z - HEAD_CENTRE[2]) / (HEAD_RADII[2] + HAIR_VOLUME)
    ring = math.sqrt(max(0.0, 1.0 - z_norm * z_norm))
    profile = 1.0 + 0.06 * z_norm
    return ((HEAD_RADII[0] + HAIR_VOLUME) * ring * profile,
            (HEAD_RADII[1] + HAIR_VOLUME) * ring * profile)


def head_surface_y(x, z):
    """Front of the head egg at (x, z), so face decals can hug it instead of floating."""
    rx, ry = skull_radii(z)
    if abs(x) >= rx:
        return HEAD_CENTRE[1]
    return HEAD_CENTRE[1] + ry * math.sqrt(max(0.0, 1.0 - (x / rx) ** 2))


def face_strip(x0, x1, z, half_height, lift=0.003, steps=3):
    """A thin decal strip lying on the face surface, facing +Y (brows, mouth)."""
    points, faces = [], []
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        y = min(head_surface_y(x, z - half_height), head_surface_y(x, z + half_height)) + lift
        points.extend([(x, y, z - half_height), (x, y, z + half_height)])
    for i in range(steps):
        a, b = 2 * i, 2 * (i + 1)
        faces.append((a, a + 1, b + 1, b))
    return points, faces


def face_centre(points, face):
    return tuple(sum(points[index][axis] for index in face) / len(face) for axis in range(3))


def drop_faces(points, faces, keep):
    kept = [face for face in faces if keep(face_centre(points, face))]
    used = sorted({index for face in kept for index in face})
    remap = {old: new for new, old in enumerate(used)}
    return [points[index] for index in used], [tuple(remap[index] for index in face) for face in kept]


class Geometry:
    """Disconnected solids with one explicit normalised influence list per vertex."""

    def __init__(self):
        self.vertices, self.faces, self.weights, self.colours, self.smooth = [], [], [], [], []

    def add(self, vertices, faces, weights, hex_colour, smooth=True):
        start = len(self.vertices)
        self.vertices.extend(tuple(float(c) for c in vertex) for vertex in vertices)
        for vertex in vertices:
            rows = weights(vertex) if callable(weights) else dict(weights)
            total = sum(rows.values())
            if abs(total - 1.0) > 1e-6 or any(joint not in JOINT_PARENTS for joint in rows):
                raise ValueError(f"bad weights {rows} at {vertex}")
            self.weights.append(rows)
            self.colours.append(colour(hex_colour))
        self.faces.extend(tuple(start + index for index in face) for face in faces)
        self.smooth.extend([smooth] * len(faces))
        return start, len(self.vertices)

    def mesh(self, name, root, armature):
        import bpy
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
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
        for polygon, smooth in zip(mesh.polygons, self.smooth):
            polygon.use_smooth = smooth
        finish_mesh(obj, root, armature, self.colours)
        return obj


# ---- the character ----------------------------------------------------------------------------

COAT_RINGS = [(0.50, 0.205, 0.135), (0.56, 0.198, 0.130), (0.66, 0.186, 0.123), (0.78, 0.176, 0.115),
              (0.88, 0.170, 0.108), (0.98, 0.138, 0.092), (1.06, 0.110, 0.080), (1.14, 0.114, 0.084),
              (1.22, 0.124, 0.092), (1.30, 0.128, 0.092), (1.38, 0.117, 0.084)]
TROUSER_RINGS = [(0.05, 0.048), (0.10, 0.050), (0.20, 0.055), (0.34, 0.060), (0.50, 0.068),
                 (0.62, 0.072), (0.74, 0.076), (0.86, 0.080)]
SLEEVE_RINGS = [(0.93, 0.140, 0.040, 0.028), (0.99, 0.142, 0.042, 0.024), (1.13, 0.145, 0.050, 0.012),
                (1.24, 0.142, 0.054, 0.005), (1.32, 0.136, 0.056, 0.0), (1.365, 0.130, 0.054, 0.0),
                (1.392, 0.122, 0.048, 0.0), (1.410, 0.114, 0.034, 0.0), (1.420, 0.108, 0.018, 0.0)]
SHOE_RINGS = [(0.006, 0.045, 0.110), (0.022, 0.052, 0.122), (0.044, 0.051, 0.120),
              (0.060, 0.046, 0.111), (0.070, 0.034, 0.094), (0.075, 0.020, 0.062)]
HAND_RINGS = [(0.80, 0.021), (0.85, 0.024), (0.90, 0.027), (0.94, 0.026)]
TOTE_X, TOTE_RINGS = 0.215, [(0.66, 0.040, 0.140), (0.70, 0.045, 0.150),
                             (0.94, 0.045, 0.150), (0.98, 0.040, 0.140)]
# Rides over the rounded shoulder cap (sleeve top 1.42 m) instead of sinking into it.
STRAP_PATH = [(0.215, -0.135, 0.975), (0.205, -0.115, 1.15), (0.175, -0.080, 1.31),
              (0.145, -0.005, 1.432), (0.172, 0.070, 1.29), (0.198, 0.115, 1.10), (0.212, 0.135, 0.978)]


def build_body():
    """Coat, trousers, shoes, hands, neck, collar, neckline and the tote."""
    body = Geometry()
    rings = [ellipse_ring((0.0, 0.0, z), (rx, ry), 12) for z, rx, ry in COAT_RINGS]
    body.add(*loft(rings, cap_end=True), weights=coat_weights, hex_colour=COAT)

    # 5 cm stand collar: it hides most of the neck and meets the bob's level hem at the jawline.
    collar = [ellipse_ring((0.0, 0.0, z), (rx, ry), 12) for z, rx, ry in
              [(1.343, 0.070, 0.062), (1.368, 0.073, 0.065), (1.393, 0.077, 0.069)]]
    body.add(*loft(collar), weights={"spine_03": 1.0}, hex_colour=COAT, smooth=False)

    neck = [ellipse_ring((0.0, 0.0, z), (0.052, 0.050), 10) for z in (1.32, 1.44)]
    body.add(*loft(neck), weights={"neck_01": 1.0}, hex_colour=SKIN)

    # Cream knit V-neck, sitting proud of the coat's chest surface.
    neckline = [(-0.045, 0.086, 1.335), (0.0, 0.096, 1.330), (0.045, 0.086, 1.335), (0.0, 0.100, 1.250)]
    body.add(neckline, [(0, 1, 3), (1, 2, 3)], weights={"spine_03": 1.0}, hex_colour=CREAM, smooth=False)

    for side, s in (("l", -1.0), ("r", 1.0)):
        # The sleeve runs up over the shoulder joint and closes with a rounded cap: no shoulder pad.
        sleeve = [ellipse_ring((s * x, y, z), (r, r * 0.93), 10) for z, x, r, y in SLEEVE_RINGS]
        body.add(*loft(sleeve, cap_start=True, cap_end=True), weights=arm_weights(side), hex_colour=COAT)

        hand = [ellipse_ring((s * 0.136, HAND_Y, z), (r, r * 0.6), 8) for z, r in HAND_RINGS]
        body.add(*loft(hand, cap_start=True, cap_end=True), weights={f"hand_{side}": 1.0}, hex_colour=SKIN)

        leg = [ellipse_ring((s * 0.085, 0.0, z), (r, r), 10) for z, r in TROUSER_RINGS]
        body.add(*loft(leg, cap_start=True), weights=leg_weights(side), hex_colour=TROUSERS)
        # Low loafer: an oval footprint flattened to a 7 cm top, standing on z = 0.
        shoe = [ellipse_ring((s * 0.085, 0.045, z), (rx, ry), 10) for z, rx, ry in SHOE_RINGS]
        body.add(*loft(shoe, cap_start=True, cap_end=True), weights={f"foot_{side}": 1.0},
                 hex_colour=SHOES, smooth=False)

    tote = [ellipse_ring((TOTE_X, 0.0, z), (rx, ry), 12) for z, rx, ry in TOTE_RINGS]
    body.add(*loft(tote, cap_start=True, cap_end=True), weights={"pelvis": 1.0}, hex_colour=TOTE)
    body.add(*path_tube(STRAP_PATH, [(0.016, 0.006)] * len(STRAP_PATH)), weights=strap_weights, hex_colour=TOTE)
    return body


def build_hair():
    """Bob: hugs the skull above the temples, level at the jawline, nape covered down to the collar."""
    rings = [ellipse_ring((0.0, HAIR_Y_SHIFT, z), hair_radii(z), 20) for z in HAIR_RING_Z]
    points, faces = loft(rings, cap_end=True)

    def keep(centre):
        x, y, z = centre
        # Face opening: a side-swept fringe (lower over the +X brow) over the brow, open down to the chin.
        fringe = 1.598 - 0.026 * (x + 0.066) / 0.132
        return not (y > 0.02 and abs(x) < 0.066 and z < fringe)

    return drop_faces(points, faces, keep)


def build_head():
    """Egg head, bob hair shell, and the flat face features; returns the eye vertex ranges for blinks."""
    head = Geometry()
    head.add(*egg(HEAD_CENTRE, HEAD_RADII), weights={"head": 1.0}, hex_colour=SKIN)
    head.add(*build_hair(), weights={"head": 1.0}, hex_colour=HAIR)

    eyes = []
    for s in (-1.0, 1.0):
        eyes.append(head.add(*egg((s * 0.045, EYE_Y, EYE_Z), EYE_RADII, segments=10, rings=6),
                             weights={"head": 1.0}, hex_colour=EYE))
        inner, outer = sorted((s * 0.022, s * 0.062))
        head.add(*face_strip(inner, outer, 1.556, 0.0045),
                 weights={"head": 1.0}, hex_colour=BROW, smooth=False)
    head.add(*face_strip(-0.019, 0.019, 1.471, 0.003),
             weights={"head": 1.0}, hex_colour=MOUTH, smooth=False)
    head.add(*egg((0.0, 0.086, 1.495), (0.012, 0.014, 0.015), segments=8, rings=6),
             weights={"head": 1.0}, hex_colour=SKIN)
    return head, eyes


def add_blinks(head, eyes):
    """Each blink flattens its eye to ~10 % of its own height about the eye centre."""
    head.shape_key_add(name="Basis")
    for name, (start, stop) in zip(BLINKS, eyes):
        key = head.shape_key_add(name=name)
        key.value = 0.0
        for index in range(start, stop):
            key.data[index].co.z = EYE_Z + 0.1 * (key.data[index].co.z - EYE_Z)
        print(f"{name}: {stop - start} eye vertices flattened about z {EYE_Z}")


def build_scene():
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

    body = build_body().mesh("VIS_body", root, arm)
    head_geometry, eyes = build_head()
    head = head_geometry.mesh("VIS_head", root, arm)
    add_blinks(head, eyes)
    print(f"meshes: body {triangle_count(body.data)} triangles, head {triangle_count(head.data)} triangles")

    animation = Animation(bone_pairs(positions))
    # Shallower walk crouch (lead round 1): the stance leg stays near straight instead of squatting.
    animation.gait_spec["walk"]["crouch"] = WALK_CROUCH_M
    build_actions(arm, animation)
    scene.frame_start, scene.frame_end = 1, 121
    return arm, body, head, animation


def report(body, head):
    top = max(vertex.co.z for obj in (body, head) for vertex in obj.data.vertices)
    low = min(vertex.co.z for vertex in head.data.vertices)
    high = max(vertex.co.z for vertex in head.data.vertices)
    chin, crown = HEAD_CENTRE[2] - HEAD_RADII[2], HEAD_CENTRE[2] + HEAD_RADII[2]
    print(f"height {top:.3f} m; VIS_head {low:.3f}-{high:.3f} m (with hair); "
          f"chin {chin:.3f} crown {crown:.3f} -> head {crown - chin:.3f} m; "
          f"head ratio (chin->crown, no hair) {top / (crown - chin):.2f}; "
          f"triangles {triangle_count(body.data) + triangle_count(head.data)}")
    sleeve = 2 * (max(x + r for _, x, r, _ in SLEEVE_RINGS))
    print(f"shoulder span {sleeve:.3f} m; coat hem z {HEM_Z:.2f} m")


def render_previews(out, arm):
    import bpy
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.render.resolution_x, scene.render.resolution_y = 600, 800
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new("QA_camera", bpy.data.cameras.new("QA_camera"))
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.95
    scene.camera = camera
    views = {
        "front": ((0.0, 3.0, 0.84), 180.0, "idle", 1),
        "side": ((3.0, 0.0, 0.84), 90.0, "idle", 1),
        "back": ((0.0, -3.0, 0.84), 0.0, "idle", 1),
        "walk8": ((2.2, 2.2, 0.84), 135.0, "walk", 8),
    }
    for name, (location, turn, action, frame) in views.items():
        camera.location = location
        camera.rotation_euler = (math.radians(90.0), 0.0, math.radians(turn))
        arm.animation_data.action = bpy.data.actions[action]
        scene.frame_set(frame)
        scene.render.filepath = str(out / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"preview {name}: {scene.render.filepath}")
    arm.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    import bpy
    print(f"Blender {bpy.app.version_string}")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    arm, body, head, animation = build_scene()
    report(body, head)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f"{CHARACTER_ID}.blend"), compress=True)
    print(export_character(CHARACTER_ID, "high", out, clips=animation.clips(), description=DERIVATION))
    if args.preview:
        render_previews(out, arm)


if __name__ == "__main__":
    main()
