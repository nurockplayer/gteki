#!/usr/bin/env python3
"""Build the #854 cat protagonist from the Fripouille base mesh: mesh, rig, clips and GLB.

Source asset: assets/library/source/cat-fripouille/ (scene.gltf, scene.bin, license.txt), the
Sketchfab model "3d modelling my cat: Fripouille" by guillaume bolis, licensed CC-BY-4.0.
Modified by GTEki contributors: whiskers removed, mesh decimated, recoloured solid blue-grey with
vertex colours (textures removed), bones renamed, ear bones added and reweighted, animation clips
authored. Body textures are deliberately absent and never used; only the eye base colour map is
sampled, at build time, for the two eye meshes.

The source file is a Sketchfab export with four defects this script repairs deterministically:
  * the body POSITION data is in centimetres while the rig and eyes are in metres (x 0.01);
  * the body mesh is authored nose toward -X, up toward -Z, and yawed 25.7 degrees off its axes;
  * the joint node transforms are a pose that does not match the bind mesh, and the inverse bind
    matrices use a foreign scale (157.76), so the imported skinning is unusable. The joint
    positions are therefore re-derived from the mesh's own vertex-group regions, keeping the
    source 34-joint topology and the agreed rename map;
  * the eyes are separate spheres in a third, unrelated frame; they are re-placed on the face by
    similarity from their own geometry.
The source weights are kept and renamed, then relaxed with the same one-ring smoothing build_cat
uses. Nothing is downloaded: the checked-in source is the only input.

Usage (Blender 5.2, headless, from the repository root):
  blender -b --factory-startup -P tools/blender/character/build_cat_fripouille.py -- \
      --src assets/library/source/cat-fripouille --out apps/web/public/avatars [--preview <dir>]
    --src      the checked-in source directory (scene.gltf, scene.bin, textures/, license.txt)
    --out      directory for cat.glb
    --preview  render bind poses and clip phases into this directory (outside the repository)

Coordinates. Authored in Blender's Z-up frame: X = the cat's right (its left is -X), Y = forward
(the nose at +Y), Z = height (feet at 0). The glTF exporter writes (x, z, -y), so the exported cat
is Y-up, feet at y = 0 and faces -Z, as avatarGlb.ts and the human GLB expect.
"""

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cat as kit  # noqa: E402 - shared helpers: Checker, export, weights, GLB reader

FPS = 30
HEIGHT_M = 0.345
TRI_BUDGET = 5000
BODY_TRI_BUDGET = 4300
EYE_TRI_BUDGET = 400
GLB_BUDGET = 1_200_000
SRC_UNIT = 0.01                 # the body POSITION accessor is in centimetres
STANCE_RATIO = 0.98             # an IK target beyond this share of the reach is clamped
TURN_YAW = math.radians(45.0)   # yaw per turn cycle (calib.turn is derived from it)
REACH_LIMIT = 0.98              # a paw may sit at most this share of its chain's rest length
FORWARD_LIMIT = 0.90            # a forepaw's forward offset from its shoulder, same share
HIND_STANCE_SHIFT = 0.030       # this rig's hind paw rests behind the hip; centre the stride on it
SIT_PITCH = math.radians(32.0)  # sitting spine pitch before the rump search lowers it
SIT_PITCH_STEP = math.radians(1.0)
SIT_PITCH_FLOOR = math.radians(12.0)
PELVIS_LIMIT = 0.010            # the sitting haunches sit within this of the floor
TAIL_CLEARANCE = 0.015          # tail bones keep this far from the hind leg bones

# sRGB as authored in the brief, converted to linear for COLOR_0.
COAT, NOSE = "#5B626B", "#6E6468"
PUPIL, IRIS = "#141210", "#3A9A52"
PUPIL_LUMA = 0.15
COAT_L, NOSE_L, PUPIL_L, IRIS_L = (kit.srgb_to_linear(c) for c in (COAT, NOSE, PUPIL, IRIS))

CLIPS = {
    "idle": dict(frames=240, sample=3),   # 8.0 s loop
    "sit": dict(frames=120, sample=3),    # 4.0 s loop
    "walk": dict(frames=16, sample=1),    # 0.533 s loop
    "trot": dict(frames=9, sample=1),     # 0.3 s loop
    "run": dict(frames=6, sample=1),      # 0.2 s loop
    "start": dict(frames=12, sample=1),   # 0.4 s one-shot, idle -> walk
    "stop": dict(frames=12, sample=1),    # 0.4 s one-shot, walk -> idle
    "turn_l": dict(frames=16, sample=1),  # 0.533 s loop in place
    "turn_r": dict(frames=16, sample=1),
}
CLIP_ORDER = ["idle", "sit", "walk", "trot", "run", "start", "stop", "turn_l", "turn_r"]
LOOPING = ("idle", "sit", "walk", "trot", "run")

# Source joints to the agreed names; the six *_end_* leaves are folded into their parents.
JOINT_MAP = {
    "_rootJoint": "root",
    "Bone_01": "spine_01",
    "Bone.001_02": "spine_02",
    "Bone.002_03": "spine_03",
    "Bone.003_04": "neck",
    "Bone.004_05": "head",
    "Bone.005_014": "tail_01",
    "Bone.006_015": "tail_02",
    "Bone.007_016": "tail_03",
    "Bone.008_017": "tail_04",
    "Bone.009_018": "tail_05",
    "Bone.010_019": "tail_06",
}
# Two source chains per limb kind, proximal to distal. The side comes from the world position
# (L is -X, per the brief).
LEG_CHAINS = {
    "foreleg": [("Bone.015_06", "Bone.016_07", "Bone.017_08", "Bone.018_09"),
                ("Bone.019_010", "Bone.020_011", "Bone.021_012", "Bone.022_013")],
    "hindleg": [("Bone.011_020", "Bone.012_021", "Bone.013_022", "Bone.014_023"),
                ("Bone.023_024", "Bone.024_00", "Bone.025_025", "Bone.026_026")],
}
LEGS = kit.LEGS
PAW_GROUP = kit.PAW_GROUP
LEG_PARENT = {True: "spine_03", False: "spine_01"}
PROXIMAL = {"foreleg": "shoulder", "hindleg": "hip"}  # the brief's names

# Filled from the rig in main().
REST_TARGET, STANCE_CENTRE, REST_DISTAL, OFF_EPS = {}, {}, {}, {}
GAITS, CALIB = {}, {}
SHOULDER_LEVER, HIP_LEVER = 0.19, 0.05
KNEE_SIGN = {}  # which side of the head-goal line the rest mid joint lies on


def fail(message):
    raise SystemExit("build_cat_fripouille: " + message)


def clamp01(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def smoothstep(x):
    t = clamp01(x)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def paw_group(leg):
    return f"{PAW_GROUP[leg['front']]}_{'L' if leg['side'] < 0 else 'R'}"


def leg_names(front, side):
    suffix = "L" if side < 0 else "R"
    prefix = "foreleg" if front else "hindleg"
    return f"{prefix}_upper_{suffix}", f"{prefix}_lower_{suffix}", f"{PAW_GROUP[front]}_{suffix}"


# --------------------------------------------------------------------------------------------
# source import and frame repair
# --------------------------------------------------------------------------------------------

def import_source(src):
    import bpy
    from mathutils import Matrix
    properties = {p.identifier for p in bpy.ops.import_scene.gltf.get_rna_type().properties}
    options = {}
    if "disable_bone_shape" in properties:   # otherwise Blender adds an Icosphere bone shape
        options["disable_bone_shape"] = True
    path = src / "scene.gltf"
    if not path.exists():
        fail(f"source scene missing: {path}")
    bpy.ops.import_scene.gltf(filepath=str(path), **options)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print("INFO source meshes: " +
          ", ".join(f"{o.name}/{o.data.name} ({len(o.data.vertices)} verts)" for o in meshes))
    if len(meshes) < 3:
        fail(f"expected the body, the eyes and the whiskers, found {len(meshes)} meshes")
    body = max(meshes, key=lambda o: len(o.data.vertices))
    eyes = next((o for o in meshes
                 if "eye" in (o.name + o.data.name).lower() and o is not body), None)
    if eyes is None:
        eyes = sorted(meshes, key=lambda o: -len(o.data.vertices))[1]
    for o in list(bpy.data.objects):
        if o.type != "MESH" or o not in (body, eyes):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in (body, eyes):
        o.modifiers.clear()
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    return body, eyes


def group_points(obj, name, threshold=0.2):
    """Vertices the source weights bind to `name` above `threshold`, with their weights."""
    if name not in obj.vertex_groups:
        return []
    gi = obj.vertex_groups[name].index
    out = []
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > threshold:
                out.append((v.co.copy(), g.weight))
    return out


def centroid(points):
    from mathutils import Vector
    total = sum(w for _p, w in points)
    if not points or total <= 0.0:
        return None
    return sum((p * w for p, w in points), Vector()) / total


def canonicalise(body):
    """Move the body into the authored frame; return its height and the yaw that was removed."""
    from mathutils import Matrix
    # x 0.01 then (x, y, z) -> (-y, -x, -z): up becomes +Z, the nose +Y, the right +X.
    unit = Matrix(((-0.0, -SRC_UNIT, -0.0), (-SRC_UNIT, 0.0, 0.0), (0.0, 0.0, -SRC_UNIT))).to_4x4()
    body.data.transform(unit)
    head = centroid(group_points(body, "Bone.004_05"))
    tail = centroid(group_points(body, "Bone.005_014"))
    if head is None or tail is None:
        fail("source body is missing the head or the tail vertex group")
    delta = head - tail
    yaw = math.atan2(delta.x, delta.y)
    body.data.transform(Matrix.Rotation(yaw, 4, "Z"))
    spine = centroid(group_points(body, "Bone_01"))
    body.data.transform(Matrix.Translation((-spine.x, 0.0, 0.0)))
    zs = [v.co.z for v in body.data.vertices]
    height = max(zs) - min(zs)
    body.data.transform(Matrix.Translation((0.0, 0.0, -min(zs))))
    return height, yaw


# --------------------------------------------------------------------------------------------
# eyes: two spheres from a third frame, re-placed on the face by similarity
# --------------------------------------------------------------------------------------------

def components(mesh):
    parent = list(range(len(mesh.vertices)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for edge in mesh.edges:
        ra, rb = find(edge.vertices[0]), find(edge.vertices[1])
        if ra != rb:
            parent[rb] = ra
    groups = {}
    for i in range(len(mesh.vertices)):
        groups.setdefault(find(i), []).append(i)
    return [ids for ids in groups.values() if len(ids) >= 12]


def place_eyes(eyes, body):
    """Scale each eye sphere to the head and set the pair on the face, keeping UVs intact."""
    from mathutils import Vector
    head = group_points(body, "Bone.004_05")
    if not head:
        fail("cannot place the eyes: the head region is empty")
    head_points = [p for p, _w in head]
    ys = [p.y for p in head_points]
    head_length = max(ys) - min(ys)
    head_centroid = centroid(head)
    nose_y = max(v.co.y for v in body.data.vertices)
    radius = 0.075 * head_length
    separation = 2.1 * radius
    centre_y = nose_y - 0.17 * head_length
    centre_z = head_centroid.z + 0.012
    coords = [v.co for v in eyes.data.vertices]
    axis = max(range(3), key=lambda i: max(c[i] for c in coords) - min(c[i] for c in coords))
    middle = (max(c[axis] for c in coords) + min(c[axis] for c in coords)) * 0.5
    parts = [[v.index for v in eyes.data.vertices if (v.co[axis] > middle) == (side == 1)]
             for side in (-1, 1)]
    if len(components(eyes.data)) != 2:
        print(f"INFO eye mesh has {len(components(eyes.data))} shells; "
              f"split into two eyes along the axis {axis} at {middle:.3f}")
    for index, ids in enumerate(parts):
        points = [eyes.data.vertices[i].co.copy() for i in ids]
        anchor = sum(points, Vector()) / len(points)
        source_radius = max((p - anchor).length for p in points) or 1.0
        scale = radius / source_radius
        target = Vector(((-1.0 if index == 0 else 1.0) * separation * 0.5, centre_y, centre_z))
        for i in ids:
            vertex = eyes.data.vertices[i]
            vertex.co = (vertex.co - anchor) * scale + target
    print(f"INFO eyes: radius {radius * 1000:.1f} mm, separation {separation * 1000:.1f} mm, "
          f"centre y {centre_y:.3f} z {centre_z:.3f}")


# --------------------------------------------------------------------------------------------
# rig
# --------------------------------------------------------------------------------------------

def ear_geometry(body):
    """Per side: the tip vertex and the skull height at which the ear leaves the dome."""
    top = max(v.co.z for v in body.data.vertices)
    tips = {}
    for v in body.data.vertices:
        if v.co.z < top - 0.006:
            continue
        side = "L" if v.co.x < 0.0 else "R"
        if side not in tips or v.co.z > tips[side].co.z:
            tips[side] = v
    if len(tips) != 2:
        fail(f"ear tips found on {len(tips)} side(s), expected 2")
    bases = {}
    for side, tip in tips.items():
        near = [v.co.z for v in body.data.vertices
                if (v.co.x - tip.co.x) ** 2 + (v.co.y - tip.co.y) ** 2 <= 0.025 ** 2]
        far = [v.co.z for v in body.data.vertices
               if all((v.co.x - t.co.x) ** 2 + (v.co.y - t.co.y) ** 2 > 0.030 ** 2
                      for t in tips.values())]
        skull = max(far) if far else min(near)
        bases[side] = max(min(near), skull)
        print(f"INFO ear_{side}: tip ({tip.co.x:.4f}, {tip.co.y:.4f}, {tip.co.z:.4f}), "
              f"base z {bases[side]:.4f} (skull top {skull:.4f})")
    return tips, bases


def joint_table(body, tips, bases):
    """bone name -> (head, tail, parent, connected) in the authored frame."""
    from mathutils import Vector
    positions = {}
    for source, name in JOINT_MAP.items():
        if source == "_rootJoint":
            positions[name] = Vector((0.0, 0.0, 0.0))
            continue
        c = centroid(group_points(body, source))
        if c is None:
            fail(f"source group {source} is empty; cannot place {name}")
        positions[name] = c

    laterals = {}
    for kind, chains in LEG_CHAINS.items():
        for chain in chains:
            c = centroid(group_points(body, chain[3]))
            side = "L" if c.x < 0.0 else "R"
            names = [f"{kind}_{PROXIMAL[kind]}_{side}", f"{kind}_upper_{side}", f"{kind}_lower_{side}",
                     f"{PAW_GROUP[kind == 'foreleg']}_{side}"]
            for source, name in zip(chain, names):
                positions[name] = centroid(group_points(body, source))
                if positions[name] is None:
                    fail(f"source group {source} is empty")
            laterals.setdefault(kind, {})[side] = (chain, names)

    toes = {}
    for kind, sides in laterals.items():
        for side, (chain, names) in sides.items():
            paw = names[3]
            points = [p for p, _w in group_points(body, chain[3], threshold=0.1)]
            head = positions[paw]
            direction = Vector((0.0, 0.022, 0.0))
            if points:
                tip = max(points, key=lambda p: p.y)
                if (tip - head).length > 1e-4:
                    direction = (tip - head).normalized() * max(0.022, min((tip - head).length, 0.05))
            toes[paw] = head + direction

    spine = ["spine_01", "spine_02", "spine_03", "neck", "head"]
    tail = ["tail_01", "tail_02", "tail_03", "tail_04", "tail_05", "tail_06"]
    nose = max(body.data.vertices, key=lambda v: v.co.y).co.copy()
    specs = [("root", Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.06, 0.0)), None, False)]
    for index, name in enumerate(spine):
        head = positions[name]
        parent = "root" if index == 0 else spine[index - 1]
        specs.append((name, head, nose if name == "head" else positions[spine[index + 1]], parent, False))
    for index, name in enumerate(tail):
        head = positions[name]
        if index + 1 < len(tail):
            tail_point = positions[tail[index + 1]]
        else:
            points = [p for p, _w in group_points(body, "Bone.010_019", threshold=0.1)]
            tail_point = head + Vector((0.0, -0.05, 0.0))
            if points:
                far = min(points, key=lambda p: p.y)
                tail_point = head + (far - head).normalized() * max(0.03, min((far - head).length, 0.07))
        specs.append((name, head, tail_point,
                      "spine_01" if index == 0 else tail[index - 1], False))
    for kind, sides in laterals.items():
        for side, (chain, names) in sides.items():
            for index, name in enumerate(names):
                specs.append((name, positions[name],
                              positions[names[index + 1]] if index + 1 < len(names) else toes[name],
                              LEG_PARENT[kind == "foreleg"] if index == 0 else names[index - 1], True))
    for side, tip in tips.items():
        specs.append((f"ear_{side}", Vector((tip.co.x, tip.co.y, bases[side])), tip.co.copy(), "head", False))
    return specs


def build_armature(specs):
    import bpy
    from mathutils import Matrix
    data = bpy.data.armatures.new("ARM_cat")
    arm = bpy.data.objects.new("ARM_cat", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for name, head, tail, parent, connected in specs:
        eb = data.edit_bones.new(name)
        eb.head, eb.tail, eb.roll = head, tail, 0.0
        eb.use_deform = True
        made[name] = eb
    for name, head, tail, parent, connected in specs:
        if parent:
            made[name].parent = made[parent]
            made[name].use_connect = bool(connected) and (made[parent].tail - made[name].head).length < 1e-6
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.matrix_world = Matrix.Identity(4)
    return arm


# --------------------------------------------------------------------------------------------
# weights
# --------------------------------------------------------------------------------------------

def rename_weights(body, arm):
    """Rename the source groups onto the new bones; fold the *_end_* leaves into their parents."""
    sources = {g.name: g.index for g in body.vertex_groups}
    mapping = {name: JOINT_MAP[name] for name in sources if name in JOINT_MAP}
    for kind, chains in LEG_CHAINS.items():
        for chain in chains:
            c = centroid(group_points(body, chain[3]))
            side = "L" if c.x < 0.0 else "R"
            names = [f"{kind}_{PROXIMAL[kind]}_{side}", f"{kind}_upper_{side}", f"{kind}_lower_{side}",
                     f"{PAW_GROUP[kind == 'foreleg']}_{side}"]
            for source, name in zip(chain, names):
                mapping[source] = name
    for name in sources:
        if "_end_" in name:
            prefix = name.split("_end_")[0] + "_"
            parent = next((n for n in sources if n.startswith(prefix) and n != name), None)
            mapping[name] = mapping.get(parent) if parent else None
    bones = {b.name for b in arm.data.bones}
    mapping = {k: v for k, v in mapping.items() if v in bones}

    rows = []
    for v in body.data.vertices:
        row = {}
        for g in v.groups:
            if g.group >= len(body.vertex_groups):
                continue
            name = mapping.get(body.vertex_groups[g.group].name)
            if name and g.weight > 0.0:
                row[name] = row.get(name, 0.0) + g.weight
        rows.append(row)
    # A vertex whose only weights were on dropped leaves falls back to its nearest bone segment.
    segments = [(b.name, b.head_local.copy(), b.tail_local.copy())
                for b in arm.data.bones if b.name != "root"]
    for index, row in enumerate(rows):
        if not row:
            co = body.data.vertices[index].co
            best = min(segments, key=lambda s: kit.point_segment_distance(co, s[1], s[2]))
            rows[index] = {best[0]: 1.0}
    for group in list(body.vertex_groups):
        body.vertex_groups.remove(group)
    groups = {name: body.vertex_groups.new(name=name) for name in sorted({n for row in rows for n in row})}
    for index, row in enumerate(rows):
        total = sum(row.values()) or 1.0
        for name, weight in row.items():
            if weight > 0.0:
                groups[name].add([index], weight / total, "REPLACE")


def reweight_ears(body, bases):
    """Ear vertices ride their own bone: 1.0 above the base, ramping out across 8 mm below it."""
    for side in ("L", "R"):
        ear = (body.vertex_groups.get(f"ear_{side}")
               or body.vertex_groups.new(name=f"ear_{side}"))
        head = body.vertex_groups["head"]
        candidates = [v for v in body.data.vertices if (v.co.x < 0.0) == (side == "L")]
        tip = max(candidates, key=lambda v: v.co.z)
        base = bases[side]
        count = 0
        for v in body.data.vertices:
            dz = v.co.z - base
            if dz <= -0.008:
                continue
            if (v.co.x - tip.co.x) ** 2 + (v.co.y - tip.co.y) ** 2 > 0.032 ** 2:
                continue
            weight = 1.0 if dz >= 0.0 else smoothstep((dz + 0.008) / 0.008)
            for group in body.vertex_groups:
                if group.name not in (f"ear_{side}", "head"):
                    group.remove([v.index])
            ear.add([v.index], weight, "REPLACE")
            if weight < 1.0:
                head.add([v.index], 1.0 - weight, "REPLACE")
            count += 1
        print(f"INFO ear_{side}: base z {base:.4f}, {count} vertices reweighted")


# --------------------------------------------------------------------------------------------
# decimation, colours, join
# --------------------------------------------------------------------------------------------

def decimate(obj, budget):
    import bpy
    triangles = kit.mesh_triangles(obj.data)
    if triangles <= budget:
        return triangles
    modifier = obj.modifiers.new("Decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = budget / float(triangles) * 0.97
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return kit.mesh_triangles(obj.data)


def eye_colours(eyes, texture, checker):
    """Per-vertex eye colour sampled from the source UVs and the eye base colour map."""
    import bpy
    image = None
    if texture is not None and texture.exists():
        image = bpy.data.images.load(str(texture), check_existing=False)
        image.colorspace_settings.name = "Non-Color"  # raw sRGB values, as the luma threshold expects
    uv = eyes.data.uv_layers.active
    per_vertex = {}
    if uv is not None:
        for poly in eyes.data.polygons:
            for loop in poly.loop_indices:
                vertex = eyes.data.loops[loop].vertex_index
                if vertex not in per_vertex:
                    per_vertex[vertex] = uv.data[loop].uv.copy()
    colours, pupils = {}, 0
    if image is not None and image.size[0] > 0 and per_vertex:
        width, height = image.size
        pixels = list(image.pixels)
        for vertex, co in per_vertex.items():
            x = min(width - 1, max(0, int((co.x % 1.0) * width)))
            y = min(height - 1, max(0, int((co.y % 1.0) * height)))
            offset = (y * width + x) * 4
            r, g, b = pixels[offset], pixels[offset + 1], pixels[offset + 2]
            if 0.2126 * r + 0.7152 * g + 0.0722 * b < PUPIL_LUMA:
                colours[vertex] = (*PUPIL_L, 1.0)
                pupils += 1
            else:
                colours[vertex] = (*IRIS_L, 1.0)
    checker.check(bool(colours), f"eye colours sampled from the source UVs ({len(colours)} vertices)")
    checker.check(pupils > 0, f"eye map has pupil pixels ({pupils} vertices)")
    return colours


def nose_selection(body, radius=0.012):
    """Nose leather: the vertices around the muzzle tip, if that patch is clean."""
    tip = max(body.data.vertices, key=lambda v: v.co.y)
    near = [v for v in body.data.vertices if (v.co - tip.co).length <= radius]
    return [v.index for v in near] if 12 <= len(near) <= 90 else []


def use_colour_attribute(obj):
    """Make Col both the active and the render colour attribute, so Workbench shows it."""
    attribute = obj.data.color_attributes.get("Col")
    if attribute is None:
        fail(f"{obj.name} has no Col colour attribute")
    obj.data.color_attributes.active_color = attribute
    try:
        obj.data.color_attributes.render_color_index = list(obj.data.color_attributes).index(attribute)
    except (AttributeError, ValueError):
        pass
    return attribute


def make_colour_attribute(obj, colours, fallback):
    for attribute in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(attribute)
    attribute = obj.data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i in range(len(obj.data.vertices)):
        attribute.data[i].color = colours.get(i, (*fallback, 1.0))
    use_colour_attribute(obj)
    return attribute


def one_material(obj):
    import bpy
    material = bpy.data.materials.new("cat_coat")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Col"
    material.node_tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return material


# --------------------------------------------------------------------------------------------
# clips
# --------------------------------------------------------------------------------------------

def solve_leg(arm, leg, target, paw_angle, paw_yaw=None):
    """Two-bone IK in the leg plane plus the paw pitch, as in build_cat."""
    import bpy
    from mathutils import Matrix, Vector
    upper_name, lower_name, paw_name = leg_names(leg["front"], leg["side"])
    upper, lower, paw = arm.pose.bones[upper_name], arm.pose.bones[lower_name], arm.pose.bones[paw_name]
    # Solve in the body's own frame (undo the root yaw), so a yawed body bends its knees in its
    # own sagittal plane and the whole pose is a pure yaw of the unyawed solution.
    yaw = arm.pose.bones["root"].matrix.to_euler("XYZ").z
    rotate = Matrix.Rotation(yaw, 3, "Z")
    unrotate = rotate.transposed()
    head = unrotate @ upper.head.copy()
    goal = unrotate @ Vector(target)
    l1, l2 = upper.bone.length, lower.bone.length
    delta = goal - head
    distance = delta.length
    limit = STANCE_RATIO * (l1 + l2)
    if distance > limit:
        goal = head + delta * (limit / distance)
        distance = limit
    distance = max(distance, abs(l1 - l2) + 1e-4)
    direction = (goal - head) / distance
    along = (distance * distance + l1 * l1 - l2 * l2) / (2.0 * distance)
    height = math.sqrt(max(0.0, l1 * l1 - along * along))
    # Sagittal bend plane, projected square to the segment so a sideways target still lands exactly
    # on the two-bone triangle (a planted paw under a yawed body sits off the body's sagittal plane).
    plane = Vector((0.0, -direction.z, direction.y))
    bend = plane - direction * plane.dot(direction)
    if bend.length < 1e-6:
        bend = Vector((1.0, 0.0, 0.0)) - direction * direction.x
        if bend.length < 1e-6:
            bend = Vector((0.0, 1.0, 0.0)) - direction * direction.y
    bend.normalize()
    knee = head + direction * along + bend * (height * KNEE_SIGN[leg["key"]])
    head, knee, goal = rotate @ head, rotate @ knee, rotate @ goal

    def orient(bone, start, end):
        # Swing the bone's rest orientation onto the segment, all in the body's own frame, then
        # yaw it back: the leg's twist then follows the body instead of the world axes.
        rest = arm.data.bones[bone.name].matrix_local.to_3x3()
        swing = ((rest @ Vector((0.0, 1.0, 0.0))).normalized()
                 .rotation_difference(unrotate @ (end - start).normalized()))
        matrix = (rotate @ swing.to_matrix() @ rest).to_4x4()
        matrix.translation = start
        bone.matrix = matrix
        bpy.context.view_layer.update()

    orient(upper, head, knee)
    orient(lower, knee, goal)
    # The paw keeps its rest pitch, pitched about the body's own X axis (the root yaw included),
    # unless the caller pins a yaw: a planted paw then holds its world matrix for the whole stance
    # instead of rotating its contact patch with the turning body.
    rest = arm.data.bones[paw_name].matrix_local.to_3x3()
    turn = yaw if paw_yaw is None else paw_yaw
    matrix = (Matrix.Rotation(turn, 3, "Z") @ Matrix.Rotation(paw_angle, 3, "X") @ rest).to_4x4()
    matrix.translation = goal
    paw.matrix = matrix
    bpy.context.view_layer.update()


def set_fk(arm, fk):
    from mathutils import Euler
    for name, angles in fk.items():
        if name in arm.pose.bones:
            arm.pose.bones[name].rotation_quaternion = Euler(angles, "XYZ").to_quaternion()


def apply_pose(arm, pose):
    import bpy
    from mathutils import Quaternion
    kit.reset_pose(arm)
    arm.pose.bones["root"].location = pose["root"]
    yaw = pose.get("yaw", 0.0)
    if yaw:
        arm.pose.bones["root"].rotation_quaternion = Quaternion((0.0, 0.0, 1.0), yaw)
    set_fk(arm, pose["fk"])
    bpy.context.view_layer.update()
    paw_yaw = pose.get("paw_yaw", {})
    for leg in LEGS:
        solve_leg(arm, leg, pose["targets"][leg["key"]], pose["paw"].get(leg["key"], 0.0),
                  paw_yaw.get(leg["key"]))


def tail_fk(base, count=6):
    """Follow-through down the six tail bones."""
    out = {}
    for index in range(count):
        share = (1.0, 0.4, 0.2, 0.1, 0.06, 0.04)[index]
        out[f"tail_0{index + 1}"] = (base[0] * share, base[1] * share, base[2] * share)
    return out


def stance_targets():
    return {leg["key"]: (REST_TARGET[leg["key"]][0], REST_TARGET[leg["key"]][1],
                         REST_TARGET[leg["key"]][2] + OFF_EPS[leg["key"]]) for leg in LEGS}


def idle_pose(t):
    breath = math.sin(math.tau * 3.0 * t / 8.0)
    look = math.radians(35.0) * math.sin(math.tau * t / 8.0)
    twitch = 0.30 * (math.exp(-((t - 2.1) / 0.09) ** 2) + math.exp(-((t - 5.4) / 0.09) ** 2))
    fk = {
        "spine_01": (0.010 * breath, 0.0, 0.0),
        "spine_02": (0.012 * breath, 0.0, 0.0),
        "spine_03": (0.008 * math.sin(math.tau * 3.0 * t / 8.0 + 0.4), 0.0, 0.0),
        "neck": (0.0, 0.0, look * 0.35),
        "head": (0.02 * breath, 0.0, look * 0.65),
        "ear_R": (-twitch, 0.0, 0.0),
    }
    fk.update(tail_fk((0.0, 0.0, 0.30 * math.sin(math.tau * t / 4.0))))
    return dict(root=(0.0, 0.0, 0.002 * breath), fk=fk, targets=stance_targets(),
                paw={leg["key"]: 0.0 for leg in LEGS})


def foot_path(front, phase, gait, offset):
    centre, rest_z = STANCE_CENTRE[front], REST_DISTAL[front][1]
    duty, travel = gait["duty"], gait["travel"]
    p = phase % 1.0
    if p < duty:
        return centre + travel * (0.5 - p / duty), rest_z + offset
    s = (p - duty) / (1.0 - duty)
    ease = s * s * (3.0 - 2.0 * s)
    return centre + travel * (ease - 0.5), rest_z + offset + gait["lift"] * math.sin(math.pi * s) ** 2


def paw_angle_for(leg, phase, gait):
    if phase % 1.0 < gait["duty"]:
        return 0.0
    s = (phase % 1.0 - gait["duty"]) / (1.0 - gait["duty"])
    return -math.radians(32.0) * math.sin(math.pi * s) ** 2


def locomotion_pose(clip, t):
    gait = GAITS[clip]
    p = (t * FPS / CLIPS[clip]["frames"]) % 1.0
    theta = (gait["hip"] - gait["chest"]) / (SHOULDER_LEVER - HIP_LEVER)
    root_z = -gait["hip"] - HIP_LEVER * theta
    if clip == "walk":
        bob = 0.003 * math.sin(math.tau * 2.0 * p)
        flex, pitch = 0.0, 0.0
        sway = 0.03 * math.sin(math.tau * p)
        head = (-0.02 * math.sin(math.tau * 2.0 * p), 0.0, 0.02 * math.sin(math.tau * p))
        tail = (-0.10, 0.0, 0.06 * math.sin(math.tau * p))
    elif clip == "trot":
        bob = 0.003 * math.sin(math.tau * 2.0 * p)
        flex, pitch = 0.0, 0.0
        sway = 0.02 * math.sin(math.tau * p)
        head = (-0.03 * math.sin(math.tau * 2.0 * p), 0.0, 0.0)
        tail = (-0.16, 0.0, 0.05 * math.sin(math.tau * p))
    else:
        bob = 0.002 * math.sin(math.tau * p + 0.6)
        flex = 0.14 * math.sin(math.tau * p + 0.9)
        pitch = -0.04 * math.sin(math.tau * p + 0.9)
        sway = 0.0
        head = (-0.6 * flex, 0.0, 0.0)
        tail = (-0.24, 0.0, 0.04 * math.sin(math.tau * p))
    fk = {
        "spine_01": (theta + pitch, 0.0, sway),
        "spine_02": (flex, 0.0, sway * 0.5),
        "spine_03": (flex * 0.5, 0.0, sway * 0.3),
        "neck": (head[0] * 0.4, 0.0, 0.0),
        "head": head,
    }
    fk.update(tail_fk(tail))
    targets, paw, paw_yaw = {}, {}, {}
    for leg in LEGS:
        phase = p + gait["offset"][leg["key"]]
        y, z = foot_path(leg["front"], phase, gait, OFF_EPS[leg["key"]])
        targets[leg["key"]] = (REST_TARGET[leg["key"]][0], y, z)
        paw[leg["key"]] = paw_angle_for(leg, phase, gait)
    return dict(root=(0.0, 0.0, root_z + bob), fk=fk, targets=targets, paw=paw)


def turn_pose(sign, t):
    """Turn in place: the root yaws at calib.turn and each planted paw stays fixed in world.

    The stance target is the world point the paw reached when its stance began, so the contact
    does not slide while the body rotates; the swing carries it along a lifted chord to the point
    the body has rotated to by the next stance.
    """
    from mathutils import Matrix, Vector
    gait = GAITS["walk"]
    cycle = CLIPS["turn_l"]["frames"] / FPS
    targets, paw, paw_yaw = {}, {}, {}
    for leg in LEGS:
        key = leg["key"]
        offset = gait["offset"][key]
        q = t / cycle + offset
        index = math.floor(q)
        phase = q - index
        # Plant the paw half a stance ahead of the body's present yaw, so the stance sweeps evenly
        # either side of it instead of trailing the whole way: that keeps it inside the leg's reach.
        yaw_start = (sign * TURN_YAW * (index - offset)
                     + sign * TURN_YAW * gait["duty"] * 0.5)
        planted = Vector((REST_TARGET[key][0], STANCE_CENTRE[leg["front"]],
                          REST_DISTAL[leg["front"]][1] + OFF_EPS[key]))
        start = Matrix.Rotation(yaw_start, 3, "Z") @ planted
        end = Matrix.Rotation(yaw_start + sign * TURN_YAW, 3, "Z") @ planted
        if phase < gait["duty"]:
            point = start.copy()
        else:
            s = (phase - gait["duty"]) / (1.0 - gait["duty"])
            point = start.lerp(end, smoothstep(s))
            point.z += gait["lift"] * math.sin(math.pi * s) ** 2
        targets[key] = tuple(point)
        paw[key] = paw_angle_for(leg, phase, gait)
        # Stance: the paw holds the yaw it had when it was planted; swing: it follows the body.
        paw_yaw[key] = (yaw_start if phase < gait["duty"] else
                        yaw_start + sign * TURN_YAW * smoothstep(
                            (phase - gait["duty"]) / (1.0 - gait["duty"])))
    fk = {
        "spine_01": (0.0, 0.0, sign * math.radians(3.0)),
        "spine_02": (0.0, 0.0, sign * math.radians(5.0)),
        "spine_03": (0.0, 0.0, sign * math.radians(4.0)),
        "neck": (0.0, 0.0, sign * math.radians(8.0)),
        "head": (-0.02 * math.sin(math.tau * 2.0 * t / cycle), 0.0, sign * math.radians(12.0)),
    }
    fk.update(tail_fk((0.0, 0.0, -sign * 0.25)))
    return dict(root=(0.0, 0.0, -gait["hip"] * 0.5), fk=fk, targets=targets, paw=paw,
                paw_yaw=paw_yaw, yaw=sign * TURN_YAW * t / cycle)


def sit_setup(arm, offsets, pitch=SIT_PITCH):
    """Static sitting body: spine `pitch` up, forelegs vertical, hind hocks on the floor."""
    import bpy
    from mathutils import Vector
    fk = {
        "spine_01": (pitch, 0.0, 0.0),
        "spine_02": (0.0, 0.0, 0.0),
        "spine_03": (0.0, 0.0, 0.0),
        "neck": (-0.42, 0.0, 0.0),
        "head": (-0.22, 0.0, 0.0),
        "ear_L": (0.0, 0.0, 0.0),
        "ear_R": (0.0, 0.0, 0.0),
        "tail_01": (-pitch - 0.28, 0.0, 0.85),
        "tail_02": (0.53, 0.0, 0.55),
        "tail_03": (0.63, 0.0, 0.45),
        "tail_04": (0.66, 0.0, 0.30),
        "tail_05": (0.30, 0.0, 0.18),
        "tail_06": (0.20, 0.0, 0.10),
    }
    fore_wrist_z = REST_DISTAL[True][1] + offsets["fore_L"]
    reach = STANCE_RATIO * (arm.data.bones["foreleg_upper_L"].length
                            + arm.data.bones["foreleg_lower_L"].length)

    def pose_at(root_z):
        kit.reset_pose(arm)
        arm.pose.bones["root"].location = (0.0, 0.0, root_z)
        set_fk(arm, fk)
        bpy.context.view_layer.update()

    pose_at(0.0)
    shoulder = arm.pose.bones["foreleg_upper_L"].head.copy()
    root_z = fore_wrist_z + reach - shoulder.z
    pose_at(root_z)
    hip = arm.pose.bones["hindleg_hip_L"].head.copy()
    hock = Vector((0.0, hip.y - 0.050, 0.012))
    rest_dir = arm.data.bones["hindpaw_L"].tail_local - arm.data.bones["hindpaw_L"].head_local
    flat = math.atan2(-rest_dir.z, rest_dir.y)
    targets = {
        "fore_L": (REST_TARGET["fore_L"][0], REST_TARGET["fore_L"][1], fore_wrist_z),
        "fore_R": (REST_TARGET["fore_R"][0], REST_TARGET["fore_R"][1], fore_wrist_z),
        "hind_L": (REST_TARGET["hind_L"][0], hock.y, hock.z),
        "hind_R": (REST_TARGET["hind_R"][0], hock.y, hock.z),
    }
    return dict(root=(0.0, 0.0, root_z), fk=fk, targets=targets,
                paw={"hind_L": flat, "hind_R": flat, "fore_L": 0.0, "fore_R": 0.0})


def blend_pose(a, b, t):
    fk = {}
    for name in set(a["fk"]) | set(b["fk"]):
        pa, pb = a["fk"].get(name, (0.0, 0.0, 0.0)), b["fk"].get(name, (0.0, 0.0, 0.0))
        fk[name] = tuple(lerp(x, y, t) for x, y in zip(pa, pb))
    return dict(root=tuple(lerp(x, y, t) for x, y in zip(a["root"], b["root"])), fk=fk,
                targets={key: tuple(lerp(x, y, t) for x, y in zip(a["targets"][key], b["targets"][key]))
                         for key in a["targets"]},
                paw={key: lerp(a["paw"].get(key, 0.0), b["paw"].get(key, 0.0), t) for key in a["paw"]},
                yaw=lerp(a.get("yaw", 0.0), b.get("yaw", 0.0), t))


def sit_pose(t, sit):
    breath = math.sin(math.tau * 1.5 * t)
    fk = dict(sit["fk"])
    fk["spine_02"] = (0.008 * breath, 0.0, 0.0)
    fk["spine_03"] = (0.006 * breath, 0.0, 0.0)
    fk["neck"] = (sit["fk"]["neck"][0] - 0.010 * breath, 0.0,
                  math.radians(5.0) * math.sin(math.tau * t / 4.0))
    fk["head"] = (sit["fk"]["head"][0] + 0.008 * breath, 0.0,
                  math.radians(6.0) * math.sin(math.tau * t / 4.0))
    return dict(sit, fk=fk)


def frame_pose(arm, clip, frame, sit):
    t = frame / FPS
    if clip == "idle":
        pose = idle_pose(t)
    elif clip == "sit":
        pose = sit_pose(t, sit)
    elif clip in GAITS:
        pose = locomotion_pose(clip, t)
    elif clip == "start":
        pose = blend_pose(idle_pose(0.0), locomotion_pose("walk", 0.0),
                          smoothstep(frame / CLIPS[clip]["frames"]))
    elif clip == "stop":
        pose = blend_pose(locomotion_pose("walk", 0.0), idle_pose(0.0),
                          smoothstep(frame / CLIPS[clip]["frames"]))
    elif clip in ("turn_l", "turn_r"):
        pose = turn_pose(-1.0 if clip == "turn_l" else 1.0, t)
    else:
        fail(f"unknown clip {clip}")
    apply_pose(arm, pose)
    return pose


def bake_clip(arm, clip, sit):
    import bpy
    frames = list(range(0, CLIPS[clip]["frames"] + 1, CLIPS[clip]["sample"]))
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        frame_pose(arm, clip, frame, sit)
        for bone in arm.pose.bones:
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
    for fcurve in kit.action_fcurves(action):
        for key in fcurve.keyframe_points:
            key.interpolation = "LINEAR"
    return action


# --------------------------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------------------------

def mesh_checks(checker, body):
    checker.check(kit.mesh_triangles(body.data) <= TRI_BUDGET,
                  f"mesh triangles {kit.mesh_triangles(body.data)} <= {TRI_BUDGET}")
    checker.check(len(body.data.materials) == 1, f"mesh has one material ({len(body.data.materials)})")
    worst = max((len(v.groups) for v in body.data.vertices), default=0)
    checker.check(worst <= 4, f"max {worst} bone influences per vertex (<= 4)")
    checker.check("Col" in body.data.color_attributes, "mesh carries the Col vertex colours")
    checker.check(len(body.data.uv_layers) == 0, f"UV layers dropped ({len(body.data.uv_layers)})")


def bind_checks(checker, body, arm):
    coords = [v.co for v in body.data.vertices]
    zs = [c.z for c in coords]
    xs = [c.x for c in coords]
    checker.check(abs(min(zs)) <= 0.002, f"bind feet at z = {min(zs):.4f} m")
    checker.check(abs(max(zs) - HEIGHT_M) <= 0.005, f"bind height {max(zs):.3f} m (0.345 +- 0.005)")
    checker.check(abs((min(xs) + max(xs)) * 0.5) <= 0.003,
                  f"bind centred x = {(min(xs) + max(xs)) * 0.5:+.4f}")
    names = {b.name for b in arm.data.bones}
    for required in ("root", "neck", "head", "ear_L", "ear_R", "tail_01", "tail_02", "tail_03", "tail_04"):
        checker.check(required in names, f"rig has {required}")
    checker.check(len(names) <= 40, f"rig has {len(names)} joints (<= 40)")


def pelvis_indices(body):
    """Vertices the pelvis and the haunches are skinned to, by more than half."""
    index = {g.name: g.index for g in body.vertex_groups}
    wanted = {index[n] for n in ("hindleg_hip_L", "hindleg_hip_R", "spine_01") if n in index}
    return [v.index for v in body.data.vertices
            if any(g.group in wanted and g.weight >= 0.5 for g in v.groups)]


def evaluated_lowest(body, indices):
    """Lowest z of the given vertices on the skinned mesh at the current frame."""
    import bpy
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    low = min(mesh.vertices[i].co.z for i in indices)
    evaluated.to_mesh_clear()
    return low


def segment_distance(a0, a1, b0, b1):
    """Shortest distance between two segments (closest points, clamped to both ends)."""
    d1, d2, r = a1 - a0, b1 - b0, a0 - b0
    a, e, f = d1.length_squared, d2.length_squared, d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    denominator = a * e - b * b
    s = clamp01((b * f - c * e) / denominator) if denominator > 1e-12 else 0.0
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0.0:
        t, s = 0.0, clamp01(-c / a) if a > 1e-12 else 0.0
    elif t > 1.0:
        t, s = 1.0, clamp01((b - c) / a) if a > 1e-12 else 0.0
    return ((a0 + d1 * s) - (b0 + d2 * t)).length


def pose_matrices(arm):
    return {bone.name: bone.matrix.copy() for bone in arm.pose.bones}


def matrix_angle(a, b):
    return abs((a.to_3x3().transposed() @ b.to_3x3()).to_quaternion().angle)


def clip_checks(checker, arm, body, groups, actions):
    import bpy
    scene = bpy.context.scene
    for clip in CLIP_ORDER:
        frames = list(range(0, CLIPS[clip]["frames"] + 1, CLIPS[clip]["sample"]))
        arm.animation_data.action = actions[clip]
        gait = GAITS.get(clip) or GAITS["walk"]
        lowest = {leg["key"]: 1.0 for leg in LEGS}
        stance_low = {leg["key"]: 1.0 for leg in LEGS}
        swing_high = {leg["key"]: -1.0 for leg in LEGS}
        contacts, stance = {}, {leg["key"]: [] for leg in LEGS}
        for frame in frames:
            scene.frame_set(frame)
            data = kit.evaluated_paw_points(body, groups)
            for leg in LEGS:
                key = leg["key"]
                point, low = data[paw_group(leg)]
                contacts[(frame, key)] = point
                if low is not None:
                    lowest[key] = min(lowest[key], low)
                planted = (clip in ("idle", "sit") or
                           (frame / CLIPS[clip]["frames"] + gait["offset"][key]) % 1.0 < gait["duty"])
                if planted:
                    stance[key].append(frame)
                    if low is not None:
                        stance_low[key] = min(stance_low[key], low)
                elif low is not None:
                    swing_high[key] = max(swing_high[key], low)
        for leg in LEGS:
            key = leg["key"]
            checker.check(lowest[key] >= -0.005,
                          f"{clip} {key} paw penetration {min(0.0, lowest[key]) * 1000:.1f} mm (>= -5)")
        if clip not in ("start", "stop"):   # the transitions move the paws by design
            for leg in LEGS:
                key = leg["key"]
                drift, run_start = 0.0, None
                for frame in frames:
                    if frame not in stance[key]:
                        run_start = None
                        continue
                    point = contacts[(frame, key)]
                    if point is None:
                        drift = max(drift, 1.0)
                        continue
                    if run_start is None:
                        run_start = (frame, point)
                    elif clip in ("turn_l", "turn_r"):
                        drift = max(drift, math.hypot(point[0] - run_start[1][0],
                                                      point[1] - run_start[1][1]))
                    else:
                        speed = CALIB.get(clip, 0.0)
                        expected_y = run_start[1][1] - speed * (frame - run_start[0]) / FPS
                        drift = max(drift, abs(point[0] - run_start[1][0]), abs(point[1] - expected_y))
                limit = 0.002 if clip in ("idle", "sit") else 0.010
                checker.check(drift <= limit,
                              f"{clip} {key} stance drift {drift * 1000:.1f} mm (<= {limit * 1000:.0f})")
        if clip in ("walk", "trot", "run"):
            for leg in LEGS:
                key = leg["key"]
                lift = swing_high[key] - stance_low[key]
                checker.check(lift >= 0.015, f"{clip} {key} swing lift {lift * 1000:.1f} mm (>= 15)")
        if clip in ("idle", "sit"):
            for leg in LEGS:
                key = leg["key"]
                checker.check(abs(stance_low[key]) <= 0.005,
                              f"{clip} {key} planted paw on the floor ({stance_low[key] * 1000:+.1f} mm)")
        if clip in LOOPING:
            scene.frame_set(frames[0])
            first = pose_matrices(arm)
            scene.frame_set(frames[-1])
            last = pose_matrices(arm)
            gap = max((first[n].translation - last[n].translation).length for n in first)
            angle = max(matrix_angle(first[n], last[n]) for n in first)
            checker.check(gap <= 0.001 and angle <= math.radians(0.5),
                          f"{clip} loops (bones {gap * 1000:.2f} mm, {math.degrees(angle):.2f} deg)")
        if clip in ("turn_l", "turn_r"):
            # The pose turns by the cycle yaw, so undo that yaw on the last frame before comparing.
            import mathutils
            sign = -1.0 if clip == "turn_l" else 1.0
            scene.frame_set(frames[0])
            first = pose_matrices(arm)
            scene.frame_set(frames[-1])
            last = pose_matrices(arm)
            undo = mathutils.Matrix.Rotation(-sign * TURN_YAW, 4, "Z")
            worst = max(first, key=lambda n: matrix_angle(first[n], undo @ last[n]))
            angle = matrix_angle(first[worst], undo @ last[worst])
            checker.check(angle <= math.radians(0.5),
                          f"{clip} loops after undoing the {math.degrees(sign * TURN_YAW):.0f} deg cycle yaw "
                          f"(worst bone {worst} {math.degrees(angle):.2f} deg)")
    for clip, target in (("start", "walk"), ("stop", "idle")):
        arm.animation_data.action = actions[clip]
        scene.frame_set(CLIPS[clip]["frames"])
        end = pose_matrices(arm)
        arm.animation_data.action = actions[target]
        scene.frame_set(0)
        begin = pose_matrices(arm)
        gap = max((end[n].translation - begin[n].translation).length for n in end)
        angle = max(matrix_angle(end[n], begin[n]) for n in end)
        checker.check(gap <= 0.002 and angle <= math.radians(0.5),
                      f"{clip} ends on {target} frame 0 ({gap * 1000:.2f} mm, {math.degrees(angle):.2f} deg)")


def leg_chain(leg):
    """The pose bone names from the leg's root joint to its paw, and their rest length."""
    suffix = "L" if leg["side"] < 0 else "R"
    root = f"foreleg_shoulder_{suffix}" if leg["front"] else f"hindleg_hip_{suffix}"
    upper, lower, paw = leg_names(leg["front"], leg["side"])
    return root, paw, (root, upper, lower)


def reach_checks(checker, arm, actions):
    """No leg reaches beyond its rest chain in any locomotion or turn frame."""
    import bpy
    scene = bpy.context.scene
    chains = {leg["key"]: leg_chain(leg) for leg in LEGS}
    for clip in ("walk", "trot", "run", "turn_l", "turn_r"):
        arm.animation_data.action = actions[clip]
        frames = range(0, CLIPS[clip]["frames"] + 1, CLIPS[clip]["sample"])
        length = {key: sum(arm.data.bones[name].length for name in bones)
                  for key, (_root, _paw, bones) in chains.items()}
        worst = {key: 0.0 for key in chains}
        forward = {key: 0.0 for key in chains}
        for frame in frames:
            scene.frame_set(frame)
            for leg in LEGS:
                key = leg["key"]
                root_name, paw_name, _bones = chains[key]
                root, paw = arm.pose.bones[root_name].head, arm.pose.bones[paw_name].head
                worst[key] = max(worst[key], (paw - root).length / length[key])
                if leg["front"]:
                    forward[key] = max(forward[key], abs(paw.y - root.y) / length[key])
        for leg in LEGS:
            key = leg["key"]
            checker.check(worst[key] <= REACH_LIMIT,
                          f"{clip} {key} paw reach {worst[key]:.3f} of the chain (<= {REACH_LIMIT})")
            if leg["front"]:
                checker.check(forward[key] <= FORWARD_LIMIT,
                              f"{clip} {key} forward offset {forward[key]:.3f} of the chain "
                              f"(<= {FORWARD_LIMIT})")


def sit_checks(checker, arm, body, groups, actions):
    """The sitting haunches on the floor, the four paws planted, the tail clear of the hind legs."""
    import bpy
    scene = bpy.context.scene
    arm.animation_data.action = actions["sit"]
    frames = list(range(0, CLIPS["sit"]["frames"] + 1, CLIPS["sit"]["sample"]))
    pelvis = pelvis_indices(body)
    checker.check(bool(pelvis), f"sit pelvis region found ({len(pelvis)} vertices)")
    lowest = 1.0
    first, drift, penetration = {}, {leg["key"]: 0.0 for leg in LEGS}, {leg["key"]: 1.0 for leg in LEGS}
    tail = [f"tail_0{i}" for i in range(1, 7)]
    hind = [f"hindleg_{part}_{side}" for side in ("L", "R")
            for part in ("hip", "upper", "lower", "paw")]
    clearance = 1.0
    for frame in frames:
        scene.frame_set(frame)
        lowest = min(lowest, evaluated_lowest(body, pelvis))
        data = kit.evaluated_paw_points(body, groups)
        for leg in LEGS:
            key = leg["key"]
            point, low = data[paw_group(leg)]
            penetration[key] = min(penetration[key], low if low is not None else 1.0)
            if point is None:
                drift[key] = 1.0
            elif key not in first:
                first[key] = point
            else:
                drift[key] = max(drift[key], math.hypot(point[0] - first[key][0],
                                                        point[1] - first[key][1]))
        for t_name in tail:
            t_bone = arm.pose.bones[t_name]
            for l_name in hind:
                l_bone = arm.pose.bones[l_name]
                clearance = min(clearance, segment_distance(t_bone.head, t_bone.tail,
                                                            l_bone.head, l_bone.tail))
    checker.check(abs(lowest) <= PELVIS_LIMIT,
                  f"sit lowest pelvis vertex {lowest * 1000:+.1f} mm from the floor "
                  f"(within {PELVIS_LIMIT * 1000:.0f})")
    for leg in LEGS:
        key = leg["key"]
        checker.check(penetration[key] >= -0.005,
                      f"sit {key} paw penetration {min(0.0, penetration[key]) * 1000:.1f} mm (>= -5)")
        checker.check(drift[key] <= 0.002,
                      f"sit {key} planted paw drift {drift[key] * 1000:.1f} mm (<= 2)")
    checker.check(clearance >= TAIL_CLEARANCE,
                  f"sit tail clearance {clearance * 1000:.1f} mm from the hind legs "
                  f"(>= {TAIL_CLEARANCE * 1000:.0f})")


COMPONENTS = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
              5125: ("I", 4), 5126: ("f", 4)}


def glb_binary(path):
    import struct
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    offset = 20 + json_length
    chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
    if chunk_type != 0x004E4942:
        fail("GLB has no BIN chunk")
    return data[offset + 8: offset + 8 + chunk_length]


def glb_accessor(doc, binary, index, widths):
    """Values and accessor of one glTF accessor, unpacked straight from the BIN chunk."""
    import struct
    accessor = doc["accessors"][index]
    fmt, size = COMPONENTS[accessor["componentType"]]
    width = widths[accessor["type"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride") or size * width
    values = [struct.unpack_from("<" + fmt * width, binary, start + k * stride)
              for k in range(accessor["count"])]
    return values, accessor


def linear_to_srgb(value):
    return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1.0 / 2.4) - 0.055


def glb_checks(checker, path):
    doc = kit.glb_json(path)
    meshes = doc.get("meshes", [])
    checker.check(len(meshes) == 1, f"GLB has one mesh ({len(meshes)})")
    mesh = meshes[0] if meshes else {"primitives": []}
    checker.check(len(mesh.get("primitives", [])) == 1, "GLB mesh has one primitive")
    checker.check(len(doc.get("materials", [])) == 1,
                  f"GLB has one material ({len(doc.get('materials', []))})")
    checker.check(not doc.get("images") and not doc.get("textures"), "GLB has no textures")
    triangles = 0
    for primitive in mesh.get("primitives", []):
        checker.check("COLOR_0" in primitive["attributes"], "GLB primitive carries COLOR_0")
        if "indices" in primitive:
            triangles += doc["accessors"][primitive["indices"]]["count"] // 3
        else:
            triangles += doc["accessors"][primitive["attributes"]["POSITION"]]["count"] // 3
    checker.check(triangles <= TRI_BUDGET, f"GLB triangles {triangles} <= {TRI_BUDGET}")
    names = sorted(animation.get("name", "") for animation in doc.get("animations", []))
    checker.check(names == sorted(CLIP_ORDER), f"GLB clips {names}")
    node_names = {node.get("name") for node in doc.get("nodes", [])}
    for required in ("root", "neck", "head", "ear_L", "ear_R", "tail_01", "tail_02", "tail_03", "tail_04"):
        checker.check(required in node_names, f"GLB node {required}")
    skin = (doc.get("skins") or [{}])[0]
    joint_nodes = skin.get("joints", [])
    joint_names = [doc["nodes"][i].get("name") for i in joint_nodes]
    joints = len(joint_nodes)
    checker.check(joints <= 40, f"GLB joints {joints} <= 40")
    checker.check("neutral_bone" not in node_names and "neutral_bone" not in joint_names,
                  "GLB has no neutral_bone node or joint")
    binary = glb_binary(path)
    joint_values, _ = glb_accessor(doc, binary, mesh["primitives"][0]["attributes"]["JOINTS_0"],
                                   {"VEC4": 4})
    weight_values, _ = glb_accessor(doc, binary, mesh["primitives"][0]["attributes"]["WEIGHTS_0"],
                                    {"VEC4": 4})
    outside = sum(1 for joint, weight in zip(joint_values, weight_values)
                  for index, value in zip(joint, weight) if value > 0.0 and index >= joints)
    checker.check(outside == 0,
                  f"GLB weights stay inside the {joints} skin joints ({outside} outside)")
    colours, accessor = glb_accessor(doc, binary, mesh["primitives"][0]["attributes"]["COLOR_0"],
                                     {"VEC4": 4, "VEC3": 3})
    scale = 1.0
    if accessor.get("normalized") and accessor["componentType"] in (5121, 5123):
        scale = 1.0 / (255.0 if accessor["componentType"] == 5121 else 65535.0)

    def srgb(colour):
        return tuple(int(round(linear_to_srgb(channel * scale) * 255)) for channel in colour[:3])

    counts = {}
    for colour in colours:
        key = srgb(colour)
        counts[key] = counts.get(key, 0) + 1
    coat = max(counts, key=counts.get)
    target = (0x5B, 0x62, 0x6B)
    checker.check(all(abs(a - b) <= 2 for a, b in zip(coat, target)),
                  f"COLOR_0 coat {coat} within 2/255 of sRGB #5B626B after linear->sRGB")
    eyes = {index for index, colour in enumerate(colours)
            if all(abs(a - b) <= 2 for a, b in zip(srgb(colour), (58, 154, 82)))
            or all(abs(a - b) <= 2 for a, b in zip(srgb(colour), (20, 18, 16)))}
    head_slot = joint_names.index("head") if "head" in joint_names else -1
    on_head = sum(1 for index in eyes
                  if joint_values[index][max(range(4), key=lambda k: weight_values[index][k])]
                  == head_slot)
    checker.check(len(eyes) > 0 and on_head == len(eyes),
                  f"GLB eye vertices ride head ({on_head}/{len(eyes)})")
    holder = next((n for n in doc.get("nodes", []) if n.get("extras", {}).get("gteki_cat")), None)
    calib = (holder or {}).get("extras", {}).get("gteki_cat", {}).get("calib", {})
    expected = {name: CALIB[name] for name in ("walk", "trot", "run")}
    expected["turn"] = CALIB["turn"]
    checker.check(set(calib) == set(expected) and all(math.isfinite(v) and v > 0.0 for v in calib.values()),
                  f"GLB extras gteki_cat.calib {calib}")
    for name, value in expected.items():
        checker.check(abs(calib.get(name, -1.0) - value) <= 1e-6, f"calib.{name} = {value:.4f}")
    where = doc["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
    checker.check(abs(where["min"][1]) <= 0.002, f"GLB feet at y = {where['min'][1]:.4f}")
    checker.check(abs(where["max"][1] - HEIGHT_M) <= 0.005, f"GLB height {where['max'][1]:.3f} m")
    checker.check(where["min"][2] < 0.0 < where["max"][2], "GLB nose at -Z, tail at +Z")
    checker.check(path.stat().st_size <= GLB_BUDGET, f"GLB size {path.stat().st_size} bytes <= 1.2 MB")
    print(f"INFO GLB {path.name}: {triangles} triangles, {path.stat().st_size} bytes")
    return triangles, path.stat().st_size


# --------------------------------------------------------------------------------------------
# previews
# --------------------------------------------------------------------------------------------

def render_previews(directory, arm):
    import bpy
    from mathutils import Vector
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.show_shadows = True
    shading.color_type = "VERTEX"
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.72, 0.74, 0.76)
    data = bpy.data.cameras.new("preview_cam")
    data.type = "ORTHO"
    data.ortho_scale = 0.8
    camera = bpy.data.objects.new("preview_cam", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    directory.mkdir(parents=True, exist_ok=True)
    centre = Vector((0.0, -0.02, 0.16))

    def shot(name, direction, clip=None, frame=0):
        if clip:
            arm.animation_data.action = bpy.data.actions[clip]
            scene.frame_set(frame)
        else:
            arm.animation_data.action = None
            kit.reset_pose(arm)
            scene.frame_set(0)
            bpy.context.view_layer.update()
        camera.location = centre - direction.normalized() * 1.5
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(directory / f"{name}.png")
        bpy.ops.render.render(write_still=True)

    shot("bind_front", Vector((0.0, 1.0, -0.25)))
    shot("bind_side", Vector((1.0, 0.0, -0.12)))
    for clip in CLIP_ORDER:
        for index in range(4):
            shot(f"{clip}_{index}", Vector((1.0, 0.0, -0.12)),
                 clip, CLIPS[clip]["frames"] * index // 4)
    print(f"INFO previews in {directory}")


# --------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--preview", type=Path, default=None)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    import bpy
    from mathutils import Matrix, Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    checker = kit.Checker()

    global REST_TARGET, STANCE_CENTRE, REST_DISTAL, OFF_EPS, GAITS, CALIB
    global SHOULDER_LEVER, HIP_LEVER, KNEE_SIGN

    body, eyes = import_source(args.src)
    height, yaw = canonicalise(body)
    factor = HEIGHT_M / height
    body.data.transform(Matrix.Scale(factor, 4))
    print(f"INFO body: {len(body.data.vertices)} vertices, source height {height:.4f} m, "
          f"yaw removed {math.degrees(yaw):.2f} deg, scale {factor:.5f}")
    place_eyes(eyes, body)

    tips, bases = ear_geometry(body)
    arm = build_armature(joint_table(body, tips, bases))
    print(f"INFO rig: {len(arm.data.bones)} bones")
    rename_weights(body, arm)
    reweight_ears(body, bases)

    for leg in LEGS:
        head = arm.data.bones[paw_group(leg)].head_local
        REST_TARGET[leg["key"]] = (head.x, head.y, head.z)
    for front in (True, False):
        values = [REST_TARGET[leg["key"]] for leg in LEGS if leg["front"] == front]
        STANCE_CENTRE[front] = sum(v[1] for v in values) / len(values)
        REST_DISTAL[front] = (STANCE_CENTRE[front], sum(v[2] for v in values) / len(values))
    # The hind paw head sits HIND_STANCE_SHIFT behind the hip on this rig, so a stride centred on
    # the rest paw stretches the leg backward; centring it on the hip keeps every frame inside reach.
    STANCE_CENTRE[False] += HIND_STANCE_SHIFT

    for leg in LEGS:
        upper_name, _lower, paw_name = leg_names(leg["front"], leg["side"])
        start = arm.data.bones[upper_name].head_local
        mid = arm.data.bones[_lower].head_local
        goal = arm.data.bones[paw_name].head_local
        direction = (goal - start).normalized()
        perpendicular = Vector((0.0, -direction.z, direction.y))
        KNEE_SIGN[leg["key"]] = 1.0 if (mid - start).dot(perpendicular) >= 0.0 else -1.0
    print("INFO knee side " + ", ".join(f"{k} {v:+.0f}" for k, v in KNEE_SIGN.items()))
    reference = {row[0]: row for row in kit.bone_table(0.0)}
    reference_hind = sum((Vector(reference[name][2]) - Vector(reference[name][1])).length
                         for name in ("hindleg_upper_L", "hindleg_lower_L"))
    hind = sum(arm.data.bones[name].length for name in ("hindleg_upper_L", "hindleg_lower_L"))
    ratio = hind / reference_hind
    GAITS = {name: dict(gait) for name, gait in kit.GAITS.items()}
    # This rig's fore chain is short, so the stock run stride swings the leading forepaw too far
    # forward; a shorter, lower stride keeps it under the shoulder.
    GAITS["run"].update(travel=0.14, lift=0.052)
    for gait in GAITS.values():
        gait["travel"] *= ratio
        gait["lift"] *= ratio
    CALIB = {clip: gait["travel"] / (gait["duty"] * CLIPS[clip]["frames"] / FPS)
             for clip, gait in GAITS.items()}
    CALIB["turn"] = TURN_YAW / (CLIPS["turn_l"]["frames"] / FPS)
    root_head = arm.data.bones["spine_01"].head_local
    SHOULDER_LEVER = abs(arm.data.bones["foreleg_upper_L"].head_local.y - root_head.y)
    HIP_LEVER = abs(arm.data.bones["hindleg_upper_L"].head_local.y - root_head.y)
    print(f"INFO hind leg {hind:.4f} m vs build_cat {reference_hind:.4f} m, ratio {ratio:.3f}; "
          f"levers shoulder {SHOULDER_LEVER:.3f} hip {HIP_LEVER:.3f}")
    print("INFO calib " + ", ".join(f"{k} {v:.3f}" for k, v in CALIB.items()))

    rigid = kit.rigid_paws(body, arm)
    kit.smooth_weights(body, rigid)
    print(f"INFO body triangles before decimation {kit.mesh_triangles(body.data)}")
    decimate(body, BODY_TRI_BUDGET)
    decimate(eyes, EYE_TRI_BUDGET)
    print(f"INFO decimated: body {kit.mesh_triangles(body.data)} tris, "
          f"eyes {kit.mesh_triangles(eyes.data)} tris")

    sampled = eye_colours(eyes, args.src / "textures" / "SHD_eye_baseColor.png", checker)
    nose = nose_selection(body)
    print(f"INFO nose leather: {len(nose)} vertices" if nose else
          "INFO nose leather not cleanly selectable; left in the coat colour")
    make_colour_attribute(body, {index: (*NOSE_L, 1.0) for index in nose}, COAT_L)
    make_colour_attribute(eyes, sampled, IRIS_L)
    for obj in (body, eyes):
        while obj.data.uv_layers:
            obj.data.uv_layers.remove(obj.data.uv_layers[0])

    head_group = body.vertex_groups.get("head")
    if head_group is None:
        fail("the body has no head vertex group to skin the eyes to")
    # The eyes were imported without weights; the exporter would otherwise skin them to its own
    # neutral_bone, which no clip animates, so the eyes would stay behind when the head turns.
    for group in list(eyes.vertex_groups):
        if group.name != head_group.name:
            eyes.vertex_groups.remove(group)
    eyes_group = (eyes.vertex_groups.get(head_group.name)
                  or eyes.vertex_groups.new(name=head_group.name))
    eyes_group.add(list(range(len(eyes.data.vertices))), 1.0, "REPLACE")

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    eyes.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = "VIS_cat"
    use_colour_attribute(body)
    one_material(body)

    modifier = body.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm
    body.parent = arm
    body.matrix_parent_inverse = arm.matrix_world.inverted()
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    mesh_checks(checker, body)
    bind_checks(checker, body, arm)

    groups = [paw_group(leg) for leg in LEGS]
    OFF_EPS = kit.stance_offset(arm, body, groups)
    print("INFO stance offsets: " + ", ".join(f"{k} {v * 1000:+.1f} mm" for k, v in OFF_EPS.items()))
    pelvis = pelvis_indices(body)
    sit_pitch = SIT_PITCH
    while True:
        sit = sit_setup(arm, OFF_EPS, sit_pitch)
        apply_pose(arm, sit)
        low = evaluated_lowest(body, pelvis)
        if abs(low) <= PELVIS_LIMIT or sit_pitch <= SIT_PITCH_FLOOR:
            break
        sit_pitch -= SIT_PITCH_STEP
    print(f"INFO sit: spine pitch {math.degrees(sit_pitch):.1f} deg, "
          f"lowest pelvis vertex {low * 1000:+.1f} mm")
    apply_pose(arm, sit)
    data = kit.evaluated_paw_points(body, groups)
    drop = -(data["hindpaw_L"][1] or 0.0)
    for key in ("hind_L", "hind_R"):
        x, y, z = sit["targets"][key]
        sit["targets"][key] = (x, y, z + drop)

    actions = {}
    for clip in CLIP_ORDER:
        actions[clip] = bake_clip(arm, clip, sit)
        print(f"INFO baked {clip}: {CLIPS[clip]['frames']} frames, "
              f"{len(kit.action_fcurves(actions[clip]))} curves")

    arm.animation_data.action = None
    scene.frame_set(0)
    kit.reset_pose(arm)
    bpy.context.view_layer.update()
    clip_checks(checker, arm, body, groups, actions)
    reach_checks(checker, arm, actions)
    sit_checks(checker, arm, body, groups, actions)

    arm["gteki_cat"] = {"calib": dict(CALIB)}
    arm.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(0)
    out = kit.export_glb(arm, body, args.out / "cat.glb")
    triangles, size = glb_checks(checker, out)

    if args.preview:
        render_previews(args.preview, arm)

    if checker.failures:
        print(f"FAILED {len(checker.failures)} check(s):")
        for message in checker.failures:
            print("  - " + message)
        sys.exit(1)
    print(f"OK {out} ({triangles} triangles, {size} bytes); calib {CALIB}")


if __name__ == "__main__":
    main()
