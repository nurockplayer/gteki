#!/usr/bin/env python3
"""Build the MPFB2 commuter (candidate A) on the 38-joint contract rig, inside Blender.

Inputs are the CC0 data files of the MPFB2 2.0.18 extension: base.obj (decimetres, Y up, +Z front,
+X anatomical left), rig.game_engine.json (metres, Y depth, Z up) and weights.game_engine.json.

Usage: Blender -b --factory-startup --python build_commuter_mpfb.py -- \
           --mpfb <unzipped mpfb dir> --out <dir>
"""
import argparse
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_character import export_character  # noqa: E402
from validate_character import BLINKS, CLIPS, FPS, JOINT_PARENTS  # noqa: E402

CHARACTER_ID = "gteki_commuter_mpfb"
HEIGHT_M = 1.66
TARGET_TRIANGLES = 11000
BOB_M = 0.01
STRIDE_M = 0.32  # half the stance travel of one foot; clamped to the reach of the leg below
WALK_LIFT_M, RUN_LIFT_M = 0.06, 0.14
WALK_CROUCH_M, RUN_CROUCH_M = 0.075, 0.10
ARM_ADDUCT = 0.88  # fraction of the A-pose splay that adduction removes; arms then hang near the sides
TOTE_SIZE = (0.08, 0.30, 0.28)
# Records the CC0 base data in the GLB itself; the shipped sidecar has the full attribution.
DERIVATION = ("original clips and rig on the CC0 MPFB2 2.0.18 base mesh (base.obj with its game-engine "
              "rig and weights); see apps/web/public/avatars/gteki-commuter-mpfb.provenance.json")

# Look (#339 E1 decision A, "the quiet commuter"): flat sRGB colours, no textures.
COAT, TROUSERS, SHOES = "#1f2a44", "#a8a59a", "#2a2622"
SKIN, HAIR, TOTE, SCLERA, PUPIL = "#c99a7a", "#3b2a20", "#6f6457", "#e8e4dc", "#20242c"

# Contract joint -> MPFB game-engine bone with the same head/tail.
SOURCE_BONES = {"pelvis": "pelvis", "spine_01": "spine_01", "spine_02": "spine_02", "spine_03": "spine_03",
                "neck_01": "neck_01", "head": "head"}
for _side in ("l", "r"):
    SOURCE_BONES.update({
        f"clavicle_{_side}": f"clavicle_{_side}", f"upperarm_{_side}": f"upperarm_{_side}",
        f"lowerarm_{_side}": f"lowerarm_{_side}", f"hand_{_side}": f"hand_{_side}",
        f"thumb_01_{_side}": f"thumb_01_{_side}", f"thumb_02_{_side}": f"thumb_02_{_side}",
        f"fingers_01_{_side}": f"middle_01_{_side}", f"fingers_02_{_side}": f"middle_02_{_side}",
        f"thigh_{_side}": f"thigh_{_side}", f"calf_{_side}": f"calf_{_side}",
        f"foot_{_side}": f"foot_{_side}", f"ball_{_side}": f"ball_{_side}",
    })
FINGER_STEMS = ("index", "middle", "ring", "pinky")


def colour(hex_string):
    """sRGB hex -> linear RGBA, as glTF COLOR_0 expects."""
    rgb = [int(hex_string[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return (*linear, 1.0)


def source_bone_for_weights(name):
    """MPFB bone name -> contract joint that carries its weight (None: no weight)."""
    if name == "Root":
        return None
    if name.startswith(FINGER_STEMS):
        return f"fingers_01_{name[-1]}" if name.split("_")[1] == "01" else f"fingers_02_{name[-1]}"
    if name.startswith("thumb_03"):
        return f"thumb_02_{name[-1]}"
    return name


def read_obj(path):
    """OBJ vertices and face groups (`g ...`); face indices are 0-based into the whole vertex list."""
    vertices, groups, group = [], {}, None
    for line in Path(path).read_text().splitlines():
        if line.startswith("g "):
            group = line[2:].strip()
        elif line.startswith("v "):
            vertices.append(tuple(float(value) for value in line.split()[1:4]))
        elif line.startswith("f ") and group is not None:
            groups.setdefault(group, []).append([int(token.split("/")[0]) - 1 for token in line.split()[1:]])
    return vertices, groups


class Source:
    """MPFB2 data files read without Blender and placed in the contract frame."""

    def __init__(self, root):
        root = Path(root)
        self.rig = json.loads((root / "data/rigs/standard/rig.game_engine.json").read_text())
        vertices, groups = read_obj(root / "data/3dobjs/base.obj")
        self.faces = groups["body"]
        used = sorted({index for face in self.faces for index in face})
        self.remap = {old: new for new, old in enumerate(used)}
        self.obj_vertices = [vertices[old] for old in used]
        heights = [vertex[1] for vertex in self.obj_vertices]
        self.scale = HEIGHT_M / ((max(heights) - min(heights)) * 0.1)
        self.shift = -min(heights) * 0.1 * self.scale
        self.eye_points = [self.vertex(centroid(vertices, groups[f"joint-{side}-eye"])) for side in ("l", "r")]
        weights = json.loads((root / "data/rigs/standard/weights.game_engine.json").read_text())["weights"]
        self.weights = [dict() for _ in self.obj_vertices]
        for source, rows in weights.items():
            joint = source_bone_for_weights(source)
            if joint is None:
                continue
            for index, weight in rows:
                if index in self.remap and weight > 0:
                    target = self.remap[index]
                    self.weights[target][joint] = self.weights[target].get(joint, 0.0) + weight
        self.vertices = [self.vertex(vertex) for vertex in self.obj_vertices]

    def point(self, position):
        """game_engine metres (Y depth, Z up) -> Blender contract frame (+Y front, -X anatomical left)."""
        x, y, z = position
        return (-x * self.scale, -y * self.scale, z * self.scale + self.shift)

    def vertex(self, position):
        """base.obj decimetres (Y up, +Z front, +X anatomical left) -> contract frame metres."""
        x, y, z = position
        return (-x * 0.1 * self.scale, z * 0.1 * self.scale, y * 0.1 * self.scale + self.shift)

    def joint_positions(self):
        positions = {}
        for joint, source in SOURCE_BONES.items():
            head = self.rig[source]["head"]["default_position"]
            tail = self.rig[source]["tail"]["default_position"]
            positions[joint] = (self.point(head), self.point(tail))
        for side in ("l", "r"):
            for joint, parent in ((f"upperarm_twist_01_{side}", f"upperarm_{side}"),
                                  (f"lowerarm_twist_01_{side}", f"lowerarm_{side}"),
                                  (f"thigh_twist_01_{side}", f"thigh_{side}")):
                head, tail = positions[parent]
                positions[joint] = (tuple((a + b) / 2 for a, b in zip(head, tail)), tail)
        head, _ = positions["spine_03"]
        positions["daypack"] = ((head[0], head[1] - 0.12, head[2] - 0.02),
                                (head[0], head[1] - 0.12, head[2] + 0.06))
        positions["root"] = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.08))
        if set(positions) != set(JOINT_PARENTS):
            raise ValueError("joint layout does not cover the contract")
        return positions


def centroid(vertices, faces):
    indices = {index for face in faces for index in face}
    return tuple(sum(vertices[index][axis] for index in indices) / len(indices) for axis in range(3))


class Animation:
    """Leg geometry and the per-clip pose functions, in the contract frame."""

    def __init__(self, positions):
        self.positions = positions
        self.legs = {}
        for side in ("l", "r"):
            hip, knee, ankle = (positions[f"{joint}_{side}"][0] for joint in ("thigh", "calf", "foot"))
            first = (knee[1] - hip[1], knee[2] - hip[2])
            second = (ankle[1] - knee[1], ankle[2] - knee[2])
            self.legs[side] = dict(hip=hip, ankle=ankle,
                                   l1=math.hypot(*first), a1=math.atan2(first[0], -first[1]),
                                   l2=math.hypot(*second), a2=math.atan2(second[0], -second[1]))
        self.hip_height = self.legs["l"]["hip"][2] - self.legs["l"]["ankle"][2]
        self.leg_length = self.legs["l"]["l1"] + self.legs["l"]["l2"]
        self.adduct = {}
        for side in ("l", "r"):
            shoulder, elbow = positions[f"upperarm_{side}"][0], positions[f"lowerarm_{side}"][0]
            self.adduct[side] = math.atan2(elbow[0] - shoulder[0], shoulder[2] - elbow[2]) * ARM_ADDUCT
        self.gait_spec = {}
        for name, crouch, lift in (("walk", WALK_CROUCH_M, WALK_LIFT_M), ("run", RUN_CROUCH_M, RUN_LIFT_M)):
            speed, duration = CLIPS[name][1], self.duration(name)
            reach = math.sqrt(max(self.leg_length ** 2 - (self.hip_height - crouch - BOB_M) ** 2, 0.0))
            stride = min(STRIDE_M, 0.98 * reach)
            self.gait_spec[name] = dict(speed=speed, duration=duration, stride=stride,
                                        stance=2 * stride / (speed * duration), lift=lift, crouch=crouch)

    @staticmethod
    def duration(name):
        return dict(idle=4.0, walk=1.0, run=0.6)[name]

    def clips(self):
        """The clip specs the exporter turns into extras.gteki_character.clips."""
        specs = {}
        for name in ("idle", "walk", "run"):
            if name == "idle":
                contacts = {"l": [[0.0, 1.0]], "r": [[0.5, 1.5]]}
            else:
                stance = round(self.gait_spec[name]["stance"], 6)
                contacts = {"l": [[0.0, stance]], "r": [[0.5, round(0.5 + stance, 6)]]}
            specs[name] = dict(duration_s=self.duration(name), contacts=contacts)
        return {name: specs[name] for name in ("idle", "walk", "run")}

    @staticmethod
    def bob(t, crouch):
        return -crouch - BOB_M * math.cos(4 * math.pi * t)

    def ankle_target(self, phase, spec):
        """Forward offset from the rest ankle and lift: linear (calib speed) through the stance."""
        stance, stride = spec["stance"], spec["stride"]
        if phase < stance:
            return stride - 2 * stride * (phase / stance), 0.0
        u = (phase - stance) / (1 - stance)
        return -stride + stride * (1 - math.cos(math.pi * u)), spec["lift"] * math.sin(math.pi * u)

    def leg_swings(self, side, phase, spec, bob):
        """World swings (about +X) for thigh and calf; the foot keeps its rest orientation (flat)."""
        leg = self.legs[side]
        offset, lift = self.ankle_target(phase, spec)
        dy = leg["ankle"][1] + offset - leg["hip"][1]
        dz = leg["ankle"][2] + lift - (leg["hip"][2] + bob)
        distance = min(math.hypot(dy, dz), 0.999 * self.leg_length)
        alpha = math.atan2(dy, -dz)
        cosine = (leg["l1"] ** 2 + distance ** 2 - leg["l2"] ** 2) / (2 * leg["l1"] * distance)
        thigh = alpha + math.acos(max(-1.0, min(1.0, cosine)))
        knee_y = leg["hip"][1] + leg["l1"] * math.sin(thigh)
        knee_z = leg["hip"][2] + bob - leg["l1"] * math.cos(thigh)
        calf = math.atan2(leg["ankle"][1] + offset - knee_y, -(leg["ankle"][2] + lift - knee_z))
        return thigh - leg["a1"], calf - leg["a2"]

    def idle(self, t):
        swing = {"spine_02": rotation_x(math.radians(-1.2) * (0.5 - 0.5 * math.cos(4 * math.pi * t))),
                 "head": rotation_z(math.radians(4.0) * math.sin(2 * math.pi * t))}
        self.arms(swing, t, swing_deg=1.5, bend_deg=10.0, lean=0.0)
        return swing, None

    def gait(self, name, t):
        spec = self.gait_spec[name]
        bob = self.bob(t, spec["crouch"])
        swing = {}
        for side, offset in (("l", 0.0), ("r", 0.5)):
            thigh, calf = self.leg_swings(side, (t - offset) % 1.0, spec, bob)
            swing[f"thigh_{side}"] = rotation_x(thigh)
            swing[f"calf_{side}"] = rotation_x(calf)
            swing[f"foot_{side}"] = rotation_x(0.0)  # flat foot: cancels the calf's rotation
        lean = math.radians(2.0 if name == "walk" else 8.0)
        for joint in ("spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "clavicle_r"):
            swing[joint] = rotation_x(-lean)
        swing["head"] = rotation_x(lean * 0.5)
        self.arms(swing, t, swing_deg=15.0 if name == "walk" else 30.0,
                  bend_deg=12.0 if name == "walk" else 70.0, lean=-lean)
        return swing, (0.0, 0.0, bob)

    def arms(self, swing, t, swing_deg, bend_deg, lean):
        amplitude, bend = math.radians(swing_deg), rotation_x(math.radians(bend_deg))
        for side, sign in (("l", -1.0), ("r", 1.0)):
            adduct = rotation_y(self.adduct[side])
            forward = rotation_x(sign * amplitude * math.cos(2 * math.pi * t))
            upper = rotation_x(lean) @ forward @ adduct
            swing[f"upperarm_{side}"] = upper
            swing[f"lowerarm_{side}"] = bend @ upper


def rotation_x(angle):
    from mathutils import Matrix
    return Matrix.Rotation(angle, 3, "X")


def rotation_y(angle):
    from mathutils import Matrix
    return Matrix.Rotation(angle, 3, "Y")


def rotation_z(angle):
    from mathutils import Matrix
    return Matrix.Rotation(angle, 3, "Z")


def solve_basis(rest, swings, pelvis_offset):
    """Pose bone basis matrices from world-space swings and a world pelvis offset."""
    from mathutils import Vector
    posed, basis = {}, {}
    for name in JOINT_PARENTS:
        parent = JOINT_PARENTS[name]
        local = rest[name] if parent is None else rest[parent].inverted() @ rest[name]
        chain = local if parent is None else posed[parent] @ local
        head = chain.translation.copy()
        if name == "pelvis" and pelvis_offset is not None:
            head += Vector(pelvis_offset)
        rotation = rest[name].to_3x3() if name not in swings else swings[name] @ rest[name].to_3x3()
        matrix = rotation.to_4x4()
        matrix.translation = head
        basis[name] = chain.inverted() @ matrix
        posed[name] = matrix
    return basis


def action_curves(action):
    if hasattr(action, "layers") and len(action.layers):
        return [curve for layer in action.layers for strip in layer.strips
                for bag in strip.channelbags for curve in bag.fcurves]
    return list(action.fcurves)


def build_armature(root, positions):
    import bpy
    rig = bpy.data.armatures.new(f"ARM_{CHARACTER_ID}")
    arm = bpy.data.objects.new(f"ARM_{CHARACTER_ID}", rig)
    bpy.context.scene.collection.objects.link(arm)
    arm.parent = root
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name in JOINT_PARENTS:
        bone = rig.edit_bones.new(name)
        bone.head, bone.tail = positions[name]
        bone.use_deform = True
    for name, parent in JOINT_PARENTS.items():
        if parent:
            rig.edit_bones[name].parent = rig.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def build_body(source):
    import bpy
    mesh = bpy.data.meshes.new("VIS_body")
    mesh.from_pydata(source.vertices, [], source.faces)
    mesh.update()
    obj = bpy.data.objects.new("VIS_body", mesh)
    bpy.context.scene.collection.objects.link(obj)
    groups = {name: obj.vertex_groups.new(name=name) for name in JOINT_PARENTS}
    for index, weights in enumerate(source.weights):
        for joint, weight in weights.items():
            groups[joint].add([index], weight, "REPLACE")
    return obj


def triangle_count(mesh):
    return sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)


def decimate(obj):
    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for _ in range(4):
        triangles = triangle_count(obj.data)
        if triangles <= TARGET_TRIANGLES:
            return triangles
        modifier = obj.modifiers.new("Decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = TARGET_TRIANGLES / triangles
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    raise ValueError(f"decimation left {triangle_count(obj.data)} triangles")


def normalise_weights(obj, bone_names):
    """Keep the four heaviest bone influences per vertex and renormalise them to one."""
    indices = {group.index for group in obj.vertex_groups if group.name in bone_names}
    for vertex in obj.data.vertices:
        entries = sorted(((g.group, g.weight) for g in vertex.groups if g.group in indices and g.weight > 0),
                         key=lambda entry: -entry[1])[:4]
        total = sum(weight for _, weight in entries)
        keep = {group: weight / total for group, weight in entries} if total > 0 else {}
        for group, _ in [(g.group, g.weight) for g in vertex.groups if g.group in indices]:
            if group in keep:
                obj.vertex_groups[group].add([vertex.index], keep[group], "REPLACE")
            else:
                obj.vertex_groups[group].remove([vertex.index])


def box(centre, size):
    x, y, z = centre
    a, b, c = (half / 2 for half in size)
    vertices = [(x + dx * a, y + dy * b, z + dz * c)
                for dx, dy, dz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                   (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return vertices, faces


def add_tote(body, positions):
    """Join a grey-brown tote box at the right hip, weighted 1.0 to the pelvis."""
    import bpy
    hip = positions["pelvis"][0]
    centre = (hip[0] + 0.245, hip[1], hip[2] - 0.14)
    vertices, faces = box(centre, TOTE_SIZE)
    mesh = bpy.data.meshes.new("TOTE")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    tote = bpy.data.objects.new("TOTE", mesh)
    bpy.context.scene.collection.objects.link(tote)
    tote.vertex_groups.new(name="pelvis").add(list(range(len(vertices))), 1.0, "REPLACE")
    tote.vertex_groups.new(name="tote_marker").add(list(range(len(vertices))), 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    tote.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()


def split_head(body):
    """Separate vertices whose dominant joint is head or neck_01 into VIS_head."""
    import bmesh
    import bpy
    groups = {group.index: group.name for group in body.vertex_groups}
    head_vertices = set()
    for vertex in body.data.vertices:
        best = max(vertex.groups, key=lambda g: g.weight, default=None)
        if best is not None and groups[best.group] in ("head", "neck_01"):
            head_vertices.add(vertex.index)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    mesh = bmesh.from_edit_mesh(body.data)
    mesh.verts.ensure_lookup_table()
    for vertex in mesh.verts:
        vertex.select = vertex.index in head_vertices
    mesh.select_flush(False)
    bmesh.update_edit_mesh(body.data)
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    head = next(obj for obj in bpy.context.selected_objects if obj is not body)
    head.name = head.data.name = "VIS_head"
    print(f"head split: {len(head.data.vertices)} of {len(body.data.vertices) + len(head.data.vertices)} vertices")
    return head


def dominant_colours(obj, body=True):
    groups = {group.index: group.name for group in obj.vertex_groups}
    marker = next((group.index for group in obj.vertex_groups if group.name == "tote_marker"), None)
    colours = []
    for vertex in obj.data.vertices:
        if marker is not None and any(g.group == marker for g in vertex.groups):
            colours.append(colour(TOTE))
            continue
        best = max(vertex.groups, key=lambda g: g.weight, default=None)
        name = groups[best.group] if best is not None else ""
        colours.append(body_colour(name))
    return colours


def body_colour(joint):
    if joint.startswith(("foot", "ball")):
        return colour(SHOES)
    if joint.startswith(("thigh", "calf")):
        return colour(TROUSERS)
    if joint.startswith(("hand", "fingers", "thumb")):
        return colour(SKIN)
    return colour(COAT)


def head_colours(obj, eyes):
    eye_z = sum(eye[2] for eye in eyes) / len(eyes)
    eye_y = sum(eye[1] for eye in eyes) / len(eyes)
    colours = []
    for vertex in obj.data.vertices:
        point = vertex.co
        distance = min(math.dist(point, eye) for eye in eyes)
        if distance < 0.010:
            colours.append(colour(PUPIL))
        elif distance < 0.022:
            colours.append(colour(SCLERA))
        elif point.z > eye_z + 0.045 or (point.y < eye_y - 0.035 and point.z > eye_z - 0.10):
            colours.append(colour(HAIR))
        else:
            colours.append(colour(SKIN))
    return colours, eye_z


def finish_mesh(obj, root, arm, colours):
    """Parent, skin and shade a mesh with one opaque vertex-coloured material."""
    import bpy
    obj.parent = root
    modifier = obj.modifiers.new("CharacterSkin", "ARMATURE")
    modifier.object = arm
    modifier.use_vertex_groups = True
    mesh = obj.data
    attribute = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for loop in mesh.loops:
        attribute.data[loop.index].color = colours[loop.vertex_index]
    material = bpy.data.materials.new(obj.name + "_opaque")
    material.diffuse_color = colour(COAT)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Alpha"].default_value = 1.0
    node = material.node_tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "Color"
    material.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(material)


def add_blinks(head, eyes):
    import bpy
    head.shape_key_add(name="Basis")
    lids = {}
    for eye in eyes:
        lids[eye] = [vertex.index for vertex in head.data.vertices
                     if vertex.co.z > eye[2] and math.dist(vertex.co, eye) < 0.015]
        if not lids[eye]:
            raise ValueError(f"no upper-lid vertex within 1.5 cm of eye {eye}: {BLINKS} would be a no-op")
        print(f"blink vertices within 1.5 cm of {tuple(round(v, 3) for v in eye)}: {len(lids[eye])}")
    for name, eye in zip(BLINKS, eyes):
        key = head.shape_key_add(name=name)
        key.value = 0.0
        for index in lids[eye]:
            key.data[index].co.z -= 0.006


def build_actions(arm, animation):
    import bpy
    arm.animation_data_create()
    rest = {name: arm.data.bones[name].matrix_local.copy() for name in JOINT_PARENTS}
    posers = dict(idle=animation.idle, walk=lambda t: animation.gait("walk", t),
                  run=lambda t: animation.gait("run", t))
    for name in ("idle", "walk", "run"):
        frames = round(animation.duration(name) * FPS)
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        arm.animation_data.action = action
        for bone in arm.pose.bones:
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            bone.location = (0.0, 0.0, 0.0)
        previous = {}
        for frame in range(1, frames + 2):
            swings, offset = posers[name]((frame - 1) / frames)
            basis = solve_basis(rest, swings, offset)
            for bone_name in sorted(set(swings) | ({"pelvis"} if offset is not None else set())):
                pose_bone = arm.pose.bones[bone_name]
                quaternion = basis[bone_name].to_quaternion()
                if bone_name in previous and quaternion.dot(previous[bone_name]) < 0:
                    quaternion.negate()
                previous[bone_name] = quaternion
                pose_bone.rotation_quaternion = quaternion
                pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone_name)
                if bone_name == "pelvis" and offset is not None:
                    pose_bone.location = basis[bone_name].translation
                    pose_bone.keyframe_insert("location", frame=frame, group=bone_name)
            # Key every other bone at rest too: the exporter samples unkeyed bones from whatever pose the
            # previous action left behind, which froze idle's legs mid-stride (#339 in-game kneel).
            for pose_bone in arm.pose.bones:
                if pose_bone.name not in previous:
                    pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
                    pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=pose_bone.name)
                if pose_bone.name == "pelvis" and offset is None:
                    pose_bone.location = (0.0, 0.0, 0.0)
                    pose_bone.keyframe_insert("location", frame=frame, group="pelvis")
        for curve in action_curves(action):
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"
    arm.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)


def build_scene(source):
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
    positions = source.joint_positions()
    arm = build_armature(root, positions)
    body = build_body(source)
    print(f"imported body: {len(body.data.vertices)} vertices, {triangle_count(body.data)} triangles")
    decimate(body)
    print(f"decimated body: {len(body.data.vertices)} vertices, {triangle_count(body.data)} triangles")
    normalise_weights(body, set(JOINT_PARENTS))
    add_tote(body, positions)
    head = split_head(body)
    finish_mesh(body, root, arm, dominant_colours(body))
    head_palette, eye_z = head_colours(head, source.eye_points)
    finish_mesh(head, root, arm, head_palette)
    add_blinks(head, source.eye_points)
    print(f"meshes: body {triangle_count(body.data)} triangles, head {triangle_count(head.data)} triangles, "
          f"eye height {eye_z:.3f} m")
    animation = Animation(positions)
    build_actions(arm, animation)
    scene.frame_start, scene.frame_end = 1, 121
    return animation


def render_walk(out, arm):
    import bpy
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x, scene.render.resolution_y = 600, 800
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new("QA_camera", bpy.data.cameras.new("QA_camera"))
    scene.collection.objects.link(camera)
    camera.location = (0.0, 3.0, 0.9)
    camera.rotation_euler = (math.radians(90.0), 0.0, math.radians(180.0))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.0
    scene.camera = camera
    arm.animation_data.action = bpy.data.actions["walk"]
    scene.frame_set(8)
    scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mpfb", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    import bpy
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    source = Source(args.mpfb)
    print(f"scale {source.scale:.6f}, floor shift {source.shift:.6f} m, "
          f"eye centres {[tuple(round(v, 3) for v in eye) for eye in source.eye_points]}")
    animation = build_scene(source)
    for name, spec in animation.gait_spec.items():
        print(f"{name}: stride {spec['stride']:.4f} m, stance {spec['stance']:.6f} of the cycle")
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f"{CHARACTER_ID}.blend"), compress=True)
    print(export_character(CHARACTER_ID, "high", out, clips=animation.clips(), description=DERIVATION))
    render_walk(out / "walk8.png", bpy.data.objects[f"ARM_{CHARACTER_ID}"])


if __name__ == "__main__":
    main()
