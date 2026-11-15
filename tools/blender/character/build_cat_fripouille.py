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
    --sheets   render authored A/B side/rear rows and report.md into this directory
    --sheet-only  build the rig and sheets, then exit before clip baking/export

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
PUPIL, IRIS = "#141210", "#A39A52"
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

def unify_coincident_weights(body):
    """S1: a split rest-position seam must deform as one vertex after export."""
    from itertools import combinations
    buckets = {}
    for vertex in body.data.vertices:
        buckets.setdefault(tuple(vertex.co), []).append(vertex)
    before = after = 0
    for vertices in buckets.values():
        if len(vertices) < 2:
            continue
        rows = [{g.group: g.weight for g in v.groups} for v in vertices]
        before += sum(any(abs(a.get(g, 0) - b.get(g, 0)) > 1e-4 for g in a.keys() | b.keys())
                      for a, b in combinations(rows, 2))
        average = {g: sum(row.get(g, 0) for row in rows) / len(rows)
                   for row in rows for g in row}
        kept = sorted(average, key=lambda g: (-average[g], g))[:4]
        total = sum(average[g] for g in kept)
        indices = [v.index for v in vertices]
        for g in average:
            body.vertex_groups[g].remove(indices)
        for g in kept:
            body.vertex_groups[g].add(indices, average[g] / total, "REPLACE")
        rows = [{g.group: g.weight for g in v.groups} for v in vertices]
        after += sum(any(abs(a.get(g, 0) - b.get(g, 0)) > 1e-4 for g in a.keys() | b.keys())
                     for a, b in combinations(rows, 2))
    print(f"S1 coincident pairs differing by > 1e-4: {before} before, {after} after")
    return before, after


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


def orient_outward(obj):
    """Wind every face to point outward. The source winds its faces against its own normals, so the
    lit side rendered as back faces and the cat came out black in the app and in the previews."""
    import bmesh
    import bpy
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    mesh.to_mesh(obj.data)
    mesh.free()
    if obj.data.has_custom_normals:
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    obj.data.shade_smooth()


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
    if "authored" in pose:
        return apply_authored_pose(arm, pose)
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
    elif clip in AUTHORED_GAITS:
        pose = authored_pose(clip, t)
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
    hind = [name for side in ("L", "R")
            for name in (f"hindleg_hip_{side}", f"hindleg_upper_{side}", f"hindleg_lower_{side}",
                         f"hindpaw_{side}")]
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


def planted_speeds(arm, actions):
    """Mean horizontal paw displacement per second over low, contiguous stretches."""
    import bpy
    scene = bpy.context.scene
    paws = [paw_group(leg) for leg in LEGS]
    rest = {name: (arm.matrix_world @ arm.data.bones[name].head_local).z for name in paws}
    result = {}
    for clip in ("walk", "trot", "run"):
        arm.animation_data.action = actions[clip]
        speeds = {name: [] for name in paws}
        starts = {name: None for name in paws}
        # Two cycles capture stretches crossing the loop boundary, at the test's 60 Hz.
        for sample in range(CLIPS[clip]["frames"] * 4 + 1):
            frame = (sample / 2) % CLIPS[clip]["frames"]
            scene.frame_set(int(frame), subframe=frame % 1)
            for name in paws:
                point = arm.matrix_world @ arm.pose.bones[name].head
                start = starts[name]
                if point.z < rest[name] + 0.01:
                    if start is None:
                        starts[name] = (sample, point.copy())
                elif start is not None:
                    if sample - start[0] >= 3:
                        end = previous[name]
                        speeds[name].append(math.hypot(end.x - start[1].x, end.y - start[1].y)
                                            / ((sample - 1 - start[0]) / (FPS * 2)))
                    starts[name] = None
                if sample == 0 and name == paws[0]:
                    previous = {}
                previous[name] = point.copy()
        result[clip] = sum(sum(values) / len(values) for values in speeds.values()) / len(paws)
    return result


def exported_planted_speeds(path):
    import bpy
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = set(bpy.data.objects) - before
    arm = next(obj for obj in imported if obj.type == "ARMATURE")
    actions = {track.name: track.strips[0].action for track in arm.animation_data.nla_tracks
               if len(track.strips)}
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    return planted_speeds(arm, actions)


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
    primitive = mesh["primitives"][0]
    positions, _ = glb_accessor(doc, binary, primitive["attributes"]["POSITION"], {"VEC3": 3})
    normals, _ = glb_accessor(doc, binary, primitive["attributes"]["NORMAL"], {"VEC3": 3})
    indices, _ = glb_accessor(doc, binary, primitive["indices"], {"SCALAR": 1})
    corners = [i[0] for i in indices]
    agree = 0
    for t in range(0, len(corners) - 2, 3):
        a, b, c = (positions[i] for i in corners[t:t + 3])
        u = [b[k] - a[k] for k in range(3)]
        w = [c[k] - a[k] for k in range(3)]
        face = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        vertex = [sum(normals[i][k] for i in corners[t:t + 3]) for k in range(3)]
        agree += sum(face[k] * vertex[k] for k in range(3)) > 0.0
    share = agree / max(1, len(corners) // 3)
    checker.check(share >= 0.98, f"GLB face winding agrees with NORMAL on {share:.3f} of triangles (>= 0.98)")
    colours, accessor = glb_accessor(doc, binary, primitive["attributes"]["COLOR_0"],
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
            if all(abs(a - b) <= 2 for a, b in zip(srgb(colour), (0xA3, 0x9A, 0x52)))
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
    for name, value in exported_planted_speeds(path).items():
        checker.check(abs(calib.get(name, 0.0) - value) <= value * 0.02,
                      f"calib.{name} {calib.get(name, 0.0):.4f} vs GLB measured {value:.4f} (within 2%)")
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
# Data-authored gait layer (#1347). Legacy clips retain their own solver and timing.
# --------------------------------------------------------------------------------------------

AUTHORED_GAITS = {}
CONTACT_VERTICES = {}


def load_authored_gaits():
    import json
    path = Path(__file__).with_name("cat_gaits.json")
    data = json.loads(path.read_text())
    for name, gait in data["gaits"].items():
        if not math.isclose(gait["cycle_s"] * gait["cadence_hz"], 1.0, abs_tol=1e-9):
            fail(f"{name}: cycle_s and cadence_hz disagree")
    return data["gaits"]


def hermite_channel(gait, phase, path, angle=False):
    """Periodic Hermite; tangents are value/phase, scalar or nested channel maps."""
    def channel(value):
        for key in path:
            value = value[key]
        return value

    keys = gait["poses"]
    values = [channel(key) for key in keys]
    if isinstance(values[0], list):
        return [hermite_channel(gait, phase, (*path, i), angle) for i in range(len(values[0]))]
    if angle:
        # Preserve a continuous angle branch, including the seam to the next cycle.
        for i in range(1, len(values)):
            values[i] = values[i - 1] + math.remainder(values[i] - values[i - 1], math.tau)
    p = phase % 1.0
    left = next((i - 1 for i, key in enumerate(keys) if key["phase"] > p), len(keys) - 1)
    right = (left + 1) % len(keys)
    t0, t1 = keys[left]["phase"], keys[right]["phase"]
    if right == 0:
        t1 += 1.0
    if p < t0:
        p += 1.0
    span = t1 - t0
    u = (p - t0) / span
    a, b = values[left], values[right]
    if angle:
        b = a + math.remainder(b - a, math.tau)

    def tangent(key, name):
        value = key.get(name, 0.0)
        return value if isinstance(value, (int, float)) else channel(value)

    m0 = tangent(keys[left], "tangent_out") * span
    m1 = tangent(keys[right], "tangent_in") * span
    return ((2*u**3 - 3*u*u + 1)*a + (u**3 - 2*u*u + u)*m0
            + (-2*u**3 + 3*u*u)*b + (u**3 - u*u)*m1)


def authored_pose(name, seconds):
    gait = AUTHORED_GAITS[name]
    phase = (seconds / gait["cycle_s"]) % 1.0
    sample = lambda *path, angle=False: hermite_channel(gait, phase, path, angle)
    root = {key: sample("root", key, angle=key == "pitch_rad")
            for key in gait["poses"][0]["root"]}
    flight = gait.get("flight_root")
    if flight:
        start, end = flight["interval"]
        low, high = flight["chord_height_m"]
        duration = (end - start) * gait["cycle_s"]
        acceleration = flight["com_exaggeration"] * flight["gravity_mps2"]
        # The quadratic ballistic arc is exactly representable by cubic Hermite.
        # Insert its endpoints and derivatives so entry/exit remain continuous too.
        curve = [{"phase": key["phase"], "height": key["root"]["height_offset_m"],
                  "tangent_in": 0, "tangent_out": 0}
                 for key in gait["poses"] if not start <= key["phase"] <= end]
        slope = (high - low) / (end - start)
        for phase_key, value, derivative in ((start, low, slope + acceleration*duration**2/(2*(end-start))),
                                              (end, high, slope - acceleration*duration**2/(2*(end-start)))):
            curve.append({"phase": phase_key, "height": value,
                          "tangent_in": derivative, "tangent_out": derivative})
        root["height_offset_m"] = hermite_channel({"poses": sorted(curve, key=lambda k: k["phase"])}, phase, ("height",))
    legs = {leg: {key: sample("legs", leg, key, angle=key.endswith("_rad"))
                  for key in channels} for leg, channels in gait["poses"][0]["legs"].items()}
    for leg, stance in gait.get("stance_targets", {}).items():
        start, end = gait["contacts"][leg]
        elapsed = (phase - start) % 1.0
        if elapsed <= end - start + 1e-9:
            # A planted paw has constant world velocity relative to the moving body.
            # Keep this line exact between authored keys, including wrapped contacts.
            legs[leg]["target_m"] = [stance["x_m"], stance["centre_y_m"]
                                      + stance["sweep_m"]*(.5-elapsed/(end-start)), 0.0]
            legs[leg]["paw_pitch_rad"] = 0.0
    return {"authored": name, "phase": phase, "root": root,
            "fk": {bone: sample("fk_xyz_rad", bone, angle=True)
                   for bone in gait["poses"][0]["fk_xyz_rad"]}, "legs": legs}


def supporting(gait, leg, phase):
    touchdown, toe_off = gait["contacts"][leg]
    return any(touchdown <= phase + cycle < toe_off for cycle in (-1, 0, 1))


def support_intervals(gait):
    events = sorted({0.0, 1.0, *(v % 1.0 for pair in gait["contacts"].values() for v in pair)})
    return [(start, end, [leg for leg in gait["contacts"]
                         if supporting(gait, leg, (start + end) / 2)])
            for start, end in zip(events, events[1:])]


def authored_contact_vertices(body, arm):
    """Rigid paw regions after the existing weight/decimation pipeline, in rest armature space."""
    kit.reset_pose(arm)
    import bpy
    bpy.context.view_layer.update()
    return {leg["key"]: [v.co.copy() - arm.data.bones[paw_group(leg)].head_local
                         for v in body.data.vertices
                         if any(g.group == body.vertex_groups[paw_group(leg)].index and g.weight > .5
                                for g in v.groups)] for leg in LEGS}


def solve_authored_leg(arm, leg, target, pitch):
    """Exact two-link solve from the moved proximal joint; infeasible targets remain reported."""
    import bpy
    from mathutils import Matrix, Vector
    names = leg_names(leg["front"], leg["side"])
    upper, lower, paw = [arm.pose.bones[n] for n in names]
    head, goal = upper.head.copy(), Vector(target)
    delta = goal - head
    distance = delta.length
    l1, l2 = upper.bone.length, lower.bone.length
    direction = delta.normalized() if distance else Vector((0, 0, -1))
    # Outside the annulus, draw the nearest physically attainable chain and expose its residual.
    solved_distance = min(l1 + l2, max(abs(l1 - l2), distance))
    solved_goal = head + direction * solved_distance
    along = (solved_distance**2 + l1*l1 - l2*l2) / (2 * solved_distance)
    height = math.sqrt(max(0.0, l1*l1 - along*along))
    bend = Vector((0, -direction.z, direction.y))
    if bend.length < 1e-8:
        bend = Vector((0, 1, 0))
    bend.normalize()
    knee = head + direction*along + bend*height*KNEE_SIGN[leg["key"]]
    for bone, start, end in ((upper, head, knee), (lower, knee, solved_goal)):
        rest = bone.bone.matrix_local.to_3x3()
        swing = (rest @ Vector((0, 1, 0))).rotation_difference((end - start).normalized())
        matrix = (swing.to_matrix() @ rest).to_4x4()
        matrix.translation = start
        bone.matrix = matrix
        bpy.context.view_layer.update()
    matrix = (Matrix.Rotation(pitch, 3, "X") @ paw.bone.matrix_local.to_3x3()).to_4x4()
    matrix.translation = solved_goal
    paw.matrix = matrix
    bpy.context.view_layer.update()
    residual = (paw.head - goal).length
    return {"residual_mm": residual * 1000,
            "upper_pitch_deg": math.degrees(math.atan2((knee-head).y, -(knee-head).z)),
            "lower_pitch_deg": math.degrees(math.atan2((solved_goal-knee).y, -(solved_goal-knee).z)),
            "knee_deg": math.degrees((knee-head).angle(solved_goal-knee)),
            "requested_m": list(goal), "solved_m": list(paw.head)}


def apply_authored_pose(arm, pose):
    import bpy
    from mathutils import Matrix, Quaternion, Vector
    kit.reset_pose(arm)
    root = arm.pose.bones["root"]
    pitch = pose["root"]["pitch_rad"]
    pivot = arm.data.bones["spine_01"].head_local
    rotation = Matrix.Rotation(pitch, 3, "X")
    root.location = pivot - rotation @ pivot + Vector((0, 0, pose["root"]["height_offset_m"]))
    root.rotation_quaternion = Quaternion((1, 0, 0), pitch)
    set_fk(arm, pose["fk"])
    bpy.context.view_layer.update()
    metrics = {}
    for leg in LEGS:
        channels = pose["legs"][leg["key"]]
        proximal_name = ("foreleg_shoulder_" if leg["front"] else "hindleg_hip_") + leg["key"][-1]
        proximal = arm.pose.bones[proximal_name]
        proximal.rotation_quaternion = Quaternion((1, 0, 0), channels["proximal_pitch_rad"])
        bpy.context.view_layer.update()
        # Translation is along the ribcage in armature space, independently of the swing.
        matrix = proximal.matrix.copy()
        matrix.translation += Vector((0, channels["proximal_slide_m"], 0))
        proximal.matrix = matrix
        bpy.context.view_layer.update()
        target = Vector(channels["target_m"])
        paw_rotation = Matrix.Rotation(channels["paw_pitch_rad"], 3, "X")
        sole = min((paw_rotation @ point).z for point in CONTACT_VERTICES[leg["key"]])
        target.z -= sole
        metrics[leg["key"]] = solve_authored_leg(arm, leg, target, channels["paw_pitch_rad"])
        residual = metrics[leg["key"]]["residual_mm"]
        if residual > .001:
            print(f"UNREACHABLE {pose['authored']} phase {pose['phase']:.6f} {leg['key']}: residual {residual:.3f} mm")
    pose["ik"] = metrics
    return metrics


def authored_reach_envelope(arm):
    """R0: reach at the record's touchdown/lift-off torso poses, verified with sheet IK."""
    from mathutils import Matrix, Vector
    import copy
    rows = []
    for name, gait in AUTHORED_GAITS.items():
        for leg in LEGS:
            k = leg["key"]
            prefix = ("foreleg_shoulder_" if leg["front"] else "hindleg_hip_") + k[-1]
            proximal = arm.data.bones[prefix]
            upper, lower, paw = [arm.data.bones[n] for n in leg_names(leg["front"], leg["side"])]
            start, end = gait["contacts"][k]
            x = gait.get("stance_targets", {}).get(k, {}).get("x_m", paw.head_local.x)
            z = -min(point.z for point in CONTACT_VERTICES[k])
            radius = math.sqrt(upper.length**2 + lower.length**2
                               + 2*upper.length*lower.length*math.cos(math.radians(10.25)))
            extremes, heights, centres = [], [], []
            residual, bend = 0.0, 180.0
            for phase, direction in ((start, 1), (end, -1)):
                pose = authored_pose(name, phase*gait["cycle_s"])
                if "stance_targets" not in gait:
                    pose["root"] = {"height_offset_m": -.035 if gait["gait"] == "run" else -.030, "pitch_rad": 0}
                    pose["fk"] = {bone: [0, 0, 0] for bone in pose["fk"]}
                apply_authored_pose(arm, pose)
                control = pose["legs"][k]
                base = arm.pose.bones[prefix].matrix @ Matrix.Rotation(-control["proximal_pitch_rad"], 4, "X")
                base.translation -= Vector((0, control["proximal_slide_m"], 0))
                heights.append(pose["root"]["height_offset_m"]*1000)
                centres.append(base.translation.y)
                bounds = []
                slide = direction*.020 if leg["front"] else 0
                for step in range(-360, 361):
                    angle = math.radians(step/2)
                    joint = base @ (Matrix.Rotation(angle, 4, "X") @ Vector((0, proximal.length, 0)))
                    joint.y += slide
                    square = radius**2-(joint.z-z)**2-(joint.x-x)**2
                    if square >= 0:
                        bounds.append((joint.y+direction*math.sqrt(square), angle, slide))
                point = max(bounds) if direction > 0 else min(bounds)
                extremes.append(point)
                trial = copy.deepcopy(pose)
                trial["legs"][k] = {"target_m": [x, point[0], 0], "proximal_pitch_rad": point[1],
                                     "proximal_slide_m": point[2], "paw_pitch_rad": 0}
                metric = apply_authored_pose(arm, trial)[k]
                residual = max(residual, metric["residual_mm"])
                bend = min(bend, metric["knee_deg"])
            high, low = extremes
            a = authored_pose(name, start*gait["cycle_s"])["legs"][k]["target_m"][1]
            b = authored_pose(name, end*gait["cycle_s"])["legs"][k]["target_m"][1]
            sweep = high[0]-low[0]
            rows.append({"record": name, "leg": k, "root_mm": "/".join(f"{h:.1f}" for h in heights),
                         "needed_mm": gait["nominal_speed_mps"]*(end-start)*gait["cycle_s"]*1000,
                         "authored_mm": (a-b)*1000, "reachable_mm": sweep*1000,
                         "minimum_cadence_hz": gait["nominal_speed_mps"]*(end-start)/sweep,
                         "cadence_hz": gait["cadence_hz"], "residual_mm": residual, "bend_deg": bend,
                         "centre_offset_mm": ((a+b)/2-sum(centres)/2)*1000})
    return rows


def reach_table(rows):
    return ["| Record | Leg | Stance root mm | Needed mm | Authored mm | Reachable mm | Min Hz | Spec / final Hz | Residual mm / bend deg |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            *(f"| {r['record']} | {r['leg']} | {r['root_mm']} | {r['needed_mm']:.1f} | {r['authored_mm']:.1f} | {r['reachable_mm']:.1f} | {r['minimum_cadence_hz']:.3f} | {AUTHORED_GAITS[r['record']].get('spec_cadence_hz', r['cadence_hz']):.3f} / {r['cadence_hz']:.6f} | {r['residual_mm']:.3f} / {r['bend_deg']:.2f} |" for r in rows)]


def authored_tuning_measurements(arm, body):
    """Measure the evaluated cycle and the named AD event poses, before any baking."""
    lines = ["", "## R1–R6 evaluated cycle measurements", "",
             "240 evenly spaced samples plus every authored key and contact boundary. Tail tip is the last bone endpoint; head is its bone origin.", "",
             "| Record | Head travel mm | Max neck / head deg | Tail min / travel mm | Tail angle / adjacent-key change deg | Max swing fore / hind bend deg | Max residual mm |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    event_lines, failures = [], []
    head_group = body.vertex_groups["head"].index
    ear_groups = {body.vertex_groups[n].index for n in ("ear_L", "ear_R")}
    skull = [v.index for v in body.data.vertices if any(g.group == head_group and g.weight > .5 for g in v.groups)
             and not any(g.group in ear_groups and g.weight > .01 for g in v.groups)]
    withers = [v.index for v in body.data.vertices if .075 <= v.co.y <= .135 and abs(v.co.x) < .045 and v.co.z > .21]
    for name, gait in AUTHORED_GAITS.items():
        run = gait["gait"] == "run"
        failures.extend(f"{name}: {reason}" for reason in gait.get("hold_reasons", []))
        head, tail, neck, head_angles, tail_angles = [], [], [], [], []
        swing = {"fore": 0.0, "hind": 0.0}
        worst = 0.0
        phases = {i/240 for i in range(240)} | {k["phase"] for k in gait["poses"]}
        phases |= {p % 1 for pair in gait["contacts"].values() for p in pair}
        for phase in sorted(phases):
            pose = authored_pose(name, phase*gait["cycle_s"])
            metrics = apply_authored_pose(arm, pose)
            head.append(arm.pose.bones["head"].head.z)
            tail.append(arm.pose.bones["tail_06"].tail.z)
            neck.append(abs(math.degrees(pose["fk"]["neck"][0])))
            head_angles.append(abs(math.degrees(pose["fk"]["head"][0])))
            for i in range(1, 7):
                bone = arm.pose.bones[f"tail_{i:02d}"]
                delta = bone.tail-bone.head
                tail_angles.append(abs(math.degrees(math.atan2(delta.z, -delta.y))))
            for leg, metric in metrics.items():
                worst = max(worst, metric["residual_mm"])
                if not supporting(gait, leg, phase):
                    kind = leg.split("_")[0]
                    swing[kind] = max(swing[kind], metric["knee_deg"])
        change = max(abs(math.degrees(math.remainder(b["fk_xyz_rad"][f"tail_{i:02d}"][0]
                        -a["fk_xyz_rad"][f"tail_{i:02d}"][0], math.tau)))
                     for a, b in zip(gait["poses"], gait["poses"][1:]+gait["poses"][:1]) for i in range(1, 7))
        travel = (max(head)-min(head))*1000
        tail_travel = (max(tail)-min(tail))*1000
        lines.append(f"| {name} | {travel:.3f} | {max(neck):.2f} / {max(head_angles):.2f} | {min(tail)*1000:.2f} / {tail_travel:.2f} | {max(tail_angles):.2f} / {change:.2f} | {swing['fore']:.2f} / {swing['hind']:.2f} | {worst:.3f} |")
        if worst > 2:
            failures.append(f"{name}: cycle IK residual {worst:.3f} mm > 2")
        if (run and not 5 <= travel <= 12) or (not run and travel > 6):
            failures.append(f"{name}: head travel {travel:.3f} mm outside R4")
        if max(neck+head_angles) > 20.001:
            failures.append(f"{name}: neck/head exceeds 20 degrees")
        if run and (not 15 <= tail_travel <= 40 or max(tail_angles) > 15.001 or change > 12.001):
            failures.append(f"{name}: tail motion outside R5")
        if min(tail)*1000 < (80 if run else 120):
            failures.append(f"{name}: tail tip below R5 floor clearance")
        if swing["fore"] > 115.001 or swing["hind"] > (120.001 if run else 115.001):
            failures.append(f"{name}: swing bend outside R3/R6")
        event_lines.extend(["", f"### {name} contact boundaries", "",
                            "| Leg | Touchdown / lift-off Y mm | Needed / authored sweep mm | Touchdown / lift-off bend deg |", "| --- | ---: | ---: | ---: |"])
        for leg, (start, end) in gait["contacts"].items():
            poses = [authored_pose(name, phase*gait["cycle_s"]) for phase in (start, end)]
            bends = []
            for pose in poses:
                bends.append(apply_authored_pose(arm, pose)[leg]["knee_deg"])
            a, b = [p["legs"][leg]["target_m"][1]*1000 for p in poses]
            needed = gait["nominal_speed_mps"]*(end-start)*gait["cycle_s"]*1000
            event_lines.append(f"| {leg} | {a:.2f} / {b:.2f} | {needed:.2f} / {a-b:.2f} | {bends[0]:.2f} / {bends[1]:.2f} |")
            if run and ((leg.startswith("hind") and bends[1] > 35.001) or (leg.startswith("fore") and bends[0] > 30.001)):
                failures.append(f"{name} {leg}: contact-boundary bend outside R3")
        if run:
            import bpy
            hero_phase = .325 if name == "run_a" else .45
            pose = authored_pose(name, hero_phase*gait["cycle_s"])
            metrics = apply_authored_pose(arm, pose)
            mesh = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            skull_top = max(mesh.vertices[i].co.z for i in skull)
            withers_top = max(mesh.vertices[i].co.z for i in withers)
            bpy.data.meshes.remove(mesh)
            event_lines.extend(["", f"### {name} extended hero {hero_phase}", "",
                                f"Skull top minus dorsal withers surface (ears excluded): {(skull_top-withers_top)*1000:.2f} mm. Head origin: {arm.pose.bones['head'].head.z*1000:.2f} mm (previous sheets: 284.69 mm).",
                                "", "| Leg | Bend deg | Hip/shoulder-to-paw angle below horizontal deg | Paw Y mm |", "| --- | ---: | ---: | ---: |"])
            if skull_top-withers_top > .020001:
                failures.append(f"{name}: hero skull exceeds withers +20 mm by {(skull_top-withers_top)*1000-20:.2f} mm")
            for leg in LEGS:
                k = leg["key"]
                prefix = ("foreleg_shoulder_" if leg["front"] else "hindleg_hip_") + k[-1]
                delta = arm.pose.bones[paw_group(leg)].head-arm.pose.bones[prefix].head
                angle = math.degrees(math.atan2(-delta.z, abs(delta.y)))
                event_lines.append(f"| {k} | {metrics[k]['knee_deg']:.2f} | {angle:.2f} | {arm.pose.bones[paw_group(leg)].head.y*1000:.2f} |")
                if metrics[k]["knee_deg"] > 25.001 or not ((19.9 <= angle <= 30.1) if leg["front"] else (9.9 <= angle <= 25.1)):
                    failures.append(f"{name} {k}: hero bend/line outside R2")
            for front in (True, False):
                pair = [leg for leg in LEGS if leg["front"] == front]
                split = abs(arm.pose.bones[paw_group(pair[0])].head.y-arm.pose.bones[paw_group(pair[1])].head.y)*1000
                event_lines.append(f"{'Fore' if front else 'Hind'} pair Y split: {split:.2f} mm.")
                if not 20 <= split <= 30:
                    failures.append(f"{name}: hero pair split {split:.2f} mm outside R2")
            nose = arm.pose.bones["head"].tail.y
            fore_y = min(arm.pose.bones[paw_group(leg)].head.y for leg in LEGS if leg["front"])
            event_lines.append(f"Nose Y / least forward forepaw Y: {nose*1000:.2f} / {fore_y*1000:.2f} mm.")
            if fore_y < nose:
                failures.append(f"{name}: hero forepaw behind nose")
        if not run:
            error = 0.0
            for key in gait["poses"]:
                other = next(k for k in gait["poses"] if abs(k["phase"]-(key["phase"]+.5)%1) < 1e-7)
                for leg, control in key["legs"].items():
                    opposite = leg[:-1]+("R" if leg.endswith("L") else "L")
                    for channel, value in control.items():
                        rhs = other["legs"][opposite][channel]
                        if channel == "target_m":
                            error = max(error, abs(value[0]+rhs[0]), abs(value[1]-rhs[1]), abs(value[2]-rhs[2]))
                        else:
                            error = max(error, abs(value-rhs))
                error = max(error, *(abs(key["root"][k]-other["root"][k]) for k in key["root"]),
                            *(abs(v-w) for bone in key["fk_xyz_rad"] for v,w in zip(key["fk_xyz_rad"][bone], other["fk_xyz_rad"][bone])))
            event_lines.append(f"R6 half-cycle mirror error in authored channels: {error:.9g} (target 0).")
            if error > 1e-8:
                failures.append(f"{name}: half-cycle mirror mismatch {error}")
    lines.extend(event_lines)
    return lines, failures


def render_contact_sheets(directory, arm, body):
    """Freeze the shaded skin at selected keys and 12 evaluated phases, at one metric scale."""
    import bpy
    from datetime import datetime
    from mathutils import Vector
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = 2400, 420
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    shading = scene.display.shading
    shading.light, shading.color_type = "STUDIO", "VERTEX"
    shading.show_shadows, shading.show_cavity = True, True
    shading.background_type = "VIEWPORT"
    shading.background_color = (.85, .87, .89)
    camera_data = bpy.data.cameras.new("sheet_camera")
    camera_data.type, camera_data.ortho_scale = "ORTHO", 4.8
    camera = bpy.data.objects.new("sheet_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    arm.animation_data.action = None
    groups = [paw_group(leg) for leg in LEGS]
    dims = []
    for label, bone in (("withers", "spine_03"), ("hip height", "hindleg_hip_L")):
        dims.append(f"| {label} | {arm.data.bones[bone].head_local.z:.6f} |")
    for leg in LEGS:
        prefix = ("foreleg_shoulder_" if leg["front"] else "hindleg_hip_") + leg["key"][-1]
        names = [prefix, *leg_names(leg["front"], leg["side"])[:2]]
        lengths = [arm.data.bones[n].length for n in names]
        for n, length in zip(names, lengths):
            dims.append(f"| {n} length | {length:.6f} |")
        dims.append(f"| {leg['key']} full-chain reach | {sum(lengths):.6f} |")
    reach = authored_reach_envelope(arm)
    report = ["# Cat authored-pose sheets", "", f"Generated {datetime.now().astimezone().isoformat(timespec='seconds')} (zone included).",
              "", "## R0 reachable planted sweep", "", *reach_table(reach), "",
              "Envelope: actual touchdown/lift-off torso poses and root heights; proximal rotation sampled every 0.5 degrees, fore slide +/-20 mm, hind slide zero. Extremal targets are independently verified through the sheet solver with bend >=10 degrees and residual <=2 mm. Root heights are touchdown/lift-off. Sweep midpoint offsets from the mean joint projection are listed below; R1 permits reach-forced offsets beyond 20 mm.",
              *(f"- {r['record']} {r['leg']}: sweep midpoint offset {r['centre_offset_mm']:.2f} mm." for r in reach), "",
              f"S1 coincident rest-position pairs differing by >1e-4: {body['coincident_weight_pairs_before']} before, {body['coincident_weight_pairs_after']} after (target 0).",
              "", "## Dimensions", "", "| Dimension | Metres |", "| --- | ---: |", *dims,
              "", "Scale includes ears; joint heights are centroid-derived and await AD review.",
              "Paw target XY is the paw-origin projection; target Z is the lowest rigid weighted contact surface.",
              "Bone lengths unchanged. S1 unifies weights at coincident rest positions. Full-chain reach includes the proximal segment.",
              "", "## Contact schedules", "", "| Record | Unwrapped contacts | Flight intervals | Flight fraction |",
              "| --- | --- | --- | ---: |"]
    for name, gait in AUTHORED_GAITS.items():
        intervals = support_intervals(gait)
        flights = [(a, b) for a, b, legs in intervals if not legs]
        report.append(f"| {name} | " + "; ".join(f"{k} {a:.2f}–{b:.2f}" for k, (a, b) in gait["contacts"].items())
                      + " | " + (", ".join(f"{a:.2f}–{b:.2f}" for a, b in flights) or "none")
                      + f" | {sum(b-a for a,b in flights):.1%} |")
    measured, failures = authored_tuning_measurements(arm, body)
    warnings = []
    report.extend(measured)
    report.extend(["", "## Spec departures", "", *(f"- {name}: " + departure for name,gait in AUTHORED_GAITS.items() for departure in gait.get("departures", []))])
    report.extend(["", "## Poses", "", "Angles are degrees; each leg lists residual mm / upper pitch / lower pitch / knee bend, then proximal / slide mm / paw pitch.",
                   "Clearance is the minimum evaluated skinned paw surface; four-paw clearance is their minimum.",
                   "", "| Record / phase / reference | Root height mm / pitch; spine; neck/head | Leg solves and controls | Paw clearances mm (FL, FR, HL, HR); four-paw min |",
                   "| --- | --- | --- | --- |"])
    rows, cycle_rows, support_notes, envelopes = {}, {}, [], []
    for name, gait in AUTHORED_GAITS.items():
        rows[name] = []
        head_heights, head_pitches = [], []
        for key in gait["poses"]:
            phase = key["phase"]
            pose = authored_pose(name, phase*gait["cycle_s"])
            apply_pose(arm, pose)
            head_heights.append(arm.pose.bones["head"].head.z)
            head_pitches.append(arm.pose.bones["head"].matrix.to_euler("XYZ").x)
            paw_data = kit.evaluated_paw_points(body, groups)
            clearances = [paw_data[paw_group(leg)][1]*1000 for leg in LEGS]
            mesh = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            if any(abs(phase-p) < 1e-8 for p in gait.get("sheet_phases", [k["phase"] for k in gait["poses"]])):
                rows[name].append((key, mesh, {leg["key"]: arm.pose.bones[paw_group(leg)].head.copy() for leg in LEGS}))
            else:
                bpy.data.meshes.remove(mesh)
            solves = []
            for leg in LEGS:
                k = leg["key"]
                metric, control = pose["ik"][k], pose["legs"][k]
                solves.append(f"{k}: {metric['residual_mm']:.3f} / {metric['upper_pitch_deg']:.1f} / {metric['lower_pitch_deg']:.1f} / {metric['knee_deg']:.1f}; "
                              f"{math.degrees(control['proximal_pitch_rad']):.1f} / {control['proximal_slide_m']*1000:.1f} / {math.degrees(control['paw_pitch_rad']):.1f}")
                if metric["residual_mm"] > .001:
                    message = (f"{name} phase {phase:.3f} {k}: residual {metric['residual_mm']:.3f} mm; "
                               f"requested {metric['requested_m']}; solved {metric['solved_m']}")
                    warnings.append(message)
                if metric["residual_mm"] > 2:
                    failures.append(warnings[-1])
            angles = ", ".join(f"{math.degrees(pose['fk'][n][0]):.1f}" for n in ("spine_01", "spine_02", "spine_03", "neck", "head"))
            report.append(f"| {name} {phase:.3f}: {key['name']}; {key['reference']} | "
                          f"{pose['root']['height_offset_m']*1000:.2f} / {math.degrees(pose['root']['pitch_rad']):.1f}; {angles} | "
                          + "<br>".join(solves) + " | " + ", ".join(f"{v:.2f}" for v in clearances) + f"; **{min(clearances):.2f}** |")
        cycle_rows[name] = []
        for i in range(12):
            phase = i/12
            pose = authored_pose(name, phase*gait["cycle_s"])
            apply_pose(arm, pose)
            mesh = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            cycle_rows[name].append(({"phase": phase, "name": "evaluated cycle", "reference": "R7: evenly spaced phases"}, mesh,
                                     {leg["key"]: arm.pose.bones[paw_group(leg)].head.copy() for leg in LEGS}))
        support_notes.extend(["", f"### {name} support intervals", ""])
        support_notes.extend(f"- {start:.2f}–{end:.2f}: {', '.join(legs) or 'flight'}" for start, end, legs in support_intervals(gait))
        envelopes.append(f"- {name}: head origin travel at keys {(max(head_heights)-min(head_heights))*1000:.3f} mm; head pitch excursion {math.degrees(max(head_pitches)-min(head_pitches)):.3f}°.")
    report.extend(["", "## Body measurements", "", *envelopes, *support_notes])
    # Check the B hero interval against the actual skin, not only the hero key.
    hero_min = float("inf")
    gait = AUTHORED_GAITS["run_b"]
    for i in range(35):
        phase = .38 + .14*i/34
        pose = authored_pose("run_b", phase*gait["cycle_s"])
        apply_pose(arm, pose)
        for leg, metric in pose["ik"].items():
            if metric["residual_mm"] > .001:
                message = f"run_b hero phase {phase:.6f} {leg}: residual {metric['residual_mm']:.3f} mm"
                warnings.append(message)
                if metric["residual_mm"] > 2:
                    failures.append(message)
        hero_min = min(hero_min, *(v[1]*1000 for v in kit.evaluated_paw_points(body, groups).values()))
    report.extend(["", f"B hero interval 0.38–0.52: minimum skinned four-paw clearance **{hero_min:.3f} mm** (35 samples, approximately 826 Hz).",
                   "B flight root is a ballistic arc above its authored chord with COM exaggeration 1.0; rise = "
                   f"{9.81*(.27*gait['cycle_s'])**2/8*1000:.3f} mm."])
    if hero_min < 10:
        failures.append(f"run_b hero clearance {hero_min:.3f} mm < 10 mm")
    report.extend(["", "## Unreachable targets", "", *(warnings or ["None (all recorded targets reached within 0.001 mm)."]),
                   "", "## Deformation / AD inspection", "",
                   "Inspect chest and belly at gathered poses, shoulder seams at maximum scapula swing/slide, and wrists at maximum fold.",
                   "These are centroid pivots and the existing smoothed skin. Visible collapse requires the AD's sheet judgment; no automated visual PASS is claimed.",
                   "A's second suspension and 25 mm stylised root lift deliberately depart from Muybridge's single extended suspension.",
                   "Stance targets use nominal speed times contact duration, with exact linear evaluation during contact. Dense clip baking remains PR 2."])
    report.extend(["", "## Acceptance failures / lead decision", "", *(failures or ["None."])])
    directory.joinpath("report.md").write_text("\n".join(report) + "\n")
    body.hide_render = True
    temporary = []

    def material(color):
        mat = bpy.data.materials.new("sheet_ink")
        mat.diffuse_color = (*color, 1)
        return mat

    ink, grid_ink, support_ink = material((.04,.06,.08)), material((.57,.61,.65)), material((.02,.32,.10))

    def line(points, radius, mat):
        curve = bpy.data.curves.new("sheet_line", "CURVE")
        curve.dimensions, curve.bevel_depth, curve.bevel_resolution = "3D", radius, 0
        spline = curve.splines.new("POLY")
        spline.points.add(len(points)-1)
        for point, co in zip(spline.points, points):
            point.co = (*co, 1)
        obj = bpy.data.objects.new("sheet_line", curve)
        scene.collection.objects.link(obj)
        obj.data.materials.append(mat)
        temporary.append(obj)
        return obj

    for name, snapshots in rows.items():
        for view in ("side", "rear", "side_cycle"):
            side = view != "rear"
            snapshots = cycle_rows[name] if view == "side_cycle" else rows[name]
            slots = 12 if view == "side_cycle" else 6
            width = slots*.8
            scene.render.resolution_x = slots*400
            camera_data.ortho_scale = width
            direction = Vector((-1,0,0) if side else (0,1,0))
            centre = Vector((0,0,.15))
            camera.location = centre - direction*3
            camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            right = Vector((0,1,0) if side else (1,0,0))
            back = direction*.30
            for i in range(-slots*8, slots*8+1):
                x = i*.05
                line([back+right*x+Vector((0,0,-.08)), back+right*x+Vector((0,0,.48))], .00035, grid_ink)
            for i in range(-1, 10):
                z = i*.05
                line([back-right*(width/2)+Vector((0,0,z)),back+right*(width/2)+Vector((0,0,z))], .0012 if i==0 else .00035, ink if i==0 else grid_ink)
            for i, (key, mesh, paws) in enumerate(snapshots):
                offset = right*((i-(slots-1)/2)*.8)
                obj = bpy.data.objects.new("sheet_cat", mesh)
                scene.collection.objects.link(obj)
                obj.location = offset
                temporary.append(obj)
                for leg in LEGS:
                    paw = paws[leg["key"]] + offset
                    # Mark on the camera-facing side, preserving the actual paw's height.
                    marker = paw-direction*.14
                    ring = [marker+right*(.008*math.cos(a))+Vector((0,0,.008*math.sin(a))) for a in [math.tau*k/24 for k in range(25)]]
                    filled = supporting(AUTHORED_GAITS[name], leg["key"], key["phase"])
                    line(ring, .0012, support_ink if filled else ink)
                    if filled:
                        for k in range(-3,4):
                            z=k*.002
                            width=math.sqrt(.007**2-z*z)
                            line([marker-right*width+Vector((0,0,z)), marker+right*width+Vector((0,0,z))], .001, support_ink)
                text_data = bpy.data.curves.new("sheet_label", "FONT")
                # Short frame correspondence; full references are in report.md and the JSON.
                text_data.body = (f"{name}  phase {key['phase']:.3f}\n{key['name']}\n" + key["reference"].replace("; ", "\n") + "\nfilled: support / ring: airborne")
                text_data.size = .019
                text_data.align_x = "CENTER"
                text = bpy.data.objects.new("sheet_label", text_data)
                scene.collection.objects.link(text)
                text.location = offset-direction*.32+Vector((0,0,-.035))
                text.rotation_euler = camera.rotation_euler
                text.data.materials.append(ink)
                temporary.append(text)
            scene.render.filepath = str(directory/f"{name}_{view}.png")
            bpy.ops.render.render(write_still=True)
            for obj in temporary:
                data = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                if data.users == 0 and data not in [row[1] for row in snapshots]:
                    if isinstance(data, bpy.types.Curve):
                        bpy.data.curves.remove(data)
            temporary.clear()
    for snapshots in [*rows.values(), *cycle_rows.values()]:
        for _key, mesh, _paws in snapshots:
            bpy.data.meshes.remove(mesh)
    bpy.data.objects.remove(camera, do_unlink=True)
    body.hide_render = False
    kit.reset_pose(arm)
    bpy.context.view_layer.update()
    print(f"SHEETS {directory}: 12 PNGs and report.md; {len(failures)} acceptance failure(s)")
    if failures:
        fail("authored sheets: " + "; ".join(failures))


# --------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--preview", type=Path, default=None)
    parser.add_argument("--sheets", type=Path, default=None)
    parser.add_argument("--sheet-only", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    if args.sheet_only and args.sheets is None:
        parser.error("--sheet-only requires --sheets <dir>")

    import bpy
    from mathutils import Matrix, Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    checker = kit.Checker()

    global REST_TARGET, STANCE_CENTRE, REST_DISTAL, OFF_EPS, GAITS, CALIB
    global SHOULDER_LEVER, HIP_LEVER, KNEE_SIGN, AUTHORED_GAITS, CONTACT_VERTICES

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
    for obj in (body, eyes):
        orient_outward(obj)
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

    seam_before, seam_after = unify_coincident_weights(body)
    body["coincident_weight_pairs_before"] = seam_before
    body["coincident_weight_pairs_after"] = seam_after
    checker.check(seam_after == 0, f"S1 coincident weight mismatches: {seam_after}")

    mesh_checks(checker, body)
    bind_checks(checker, body, arm)

    groups = [paw_group(leg) for leg in LEGS]
    OFF_EPS = kit.stance_offset(arm, body, groups)
    print("INFO stance offsets: " + ", ".join(f"{k} {v * 1000:+.1f} mm" for k, v in OFF_EPS.items()))
    AUTHORED_GAITS = load_authored_gaits()
    CONTACT_VERTICES = authored_contact_vertices(body, arm)
    if args.sheets:
        render_contact_sheets(args.sheets, arm, body)
        if args.sheet_only:
            if checker.failures:
                fail("; ".join(checker.failures))
            return

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

    designed = dict(CALIB)
    CALIB.update(planted_speeds(arm, actions))
    print("INFO calib designed vs measured: " + ", ".join(
        f"{name} {designed[name]:.3f} vs {CALIB[name]:.3f}" for name in ("walk", "trot", "run")))

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
