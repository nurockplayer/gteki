#!/usr/bin/env python3
"""Build a procedural, 1.66 m P0 acceptance character inside Blender, without inputs."""
import argparse
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_character import export_character  # noqa: E402
from validate_character import BLINKS, FPS, JOINT_PARENTS, TIERS  # noqa: E402

CHARACTER_ID = "p0_sample"
NAVY = (0.025, 0.055, 0.12, 1.0)
SKIN = (0.65, 0.40, 0.25, 1.0)
DARK = (0.015, 0.018, 0.025, 1.0)
WHITE = (0.9, 0.9, 0.85, 1.0)


def joint_positions():
    """Blender world positions: +Z up, +Y front, anatomical left at -X."""
    positions = dict(root=(0, 0, 0), pelvis=(0, 0, 0.88), spine_01=(0, 0, 1.00),
                     spine_02=(0, 0, 1.13), spine_03=(0, 0, 1.30),
                     neck_01=(0, 0, 1.43), head=(0, 0, 1.51), daypack=(0, -0.12, 1.28))
    for side, s in (("l", -1), ("r", 1)):
        positions.update({
            f"clavicle_{side}": (s * .055, 0, 1.36), f"upperarm_{side}": (s * .19, 0, 1.35),
            f"lowerarm_{side}": (s * .37, 0, 1.17), f"hand_{side}": (s * .54, 0, 1.00),
            f"upperarm_twist_01_{side}": (s * .28, 0, 1.26),
            f"lowerarm_twist_01_{side}": (s * .46, 0, 1.08),
            f"thumb_01_{side}": (s * .55, .035, .98),
            f"thumb_02_{side}": (s * .57, .045, .96),
            f"fingers_01_{side}": (s * .58, 0, .96),
            f"fingers_02_{side}": (s * .61, 0, .93),
            f"thigh_{side}": (s * .09, 0, .85), f"calf_{side}": (s * .09, 0, .48),
            f"foot_{side}": (s * .09, -.035, .075), f"ball_{side}": (s * .09, .13, 0),
            f"thigh_twist_01_{side}": (s * .09, 0, .67),
        })
    if set(positions) != set(JOINT_PARENTS):
        raise ValueError("joint layout does not cover the contract")
    return positions


class Geometry:
    """Disconnected low-poly solids; each vertex has one explicit, normalized influence."""
    def __init__(self):
        self.vertices, self.faces, self.weights, self.colours = [], [], [], []

    def add(self, vertices, faces, joint, colour):
        if joint not in JOINT_PARENTS:
            raise ValueError(f"unknown weighted joint {joint}")
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.weights.extend([joint] * len(vertices))
        self.colours.extend([colour] * len(vertices))
        self.faces.extend(tuple(start + i for i in face) for face in faces)
        return list(range(start, len(self.vertices)))

    def box(self, centre, size, joint, colour):
        x, y, z = centre
        a, b, c = (n / 2 for n in size)
        vertices = [(x + dx * a, y + dy * b, z + dz * c)
                    for dx, dy, dz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                      (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        return self.add(vertices, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                                   (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], joint, colour)

    def limb(self, start, end, radius, joint, colour):
        from mathutils import Vector
        a, b = Vector(start), Vector(end)
        axis = (b - a).normalized()
        u = axis.cross(Vector((0, 1, 0))).normalized()
        v = axis.cross(u).normalized()
        sides = 8
        vertices = [tuple(point + radius * (math.cos(i * math.tau / sides) * u +
                                            math.sin(i * math.tau / sides) * v))
                    for point in (a, b) for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
        faces.extend((i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides))
        self.add(vertices, faces, joint, colour)

    def mesh(self, name, root, armature, base_colour):
        import bpy
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = root
        # Coordinates are already in world metres: object transforms stay at identity.
        for joint in JOINT_PARENTS:
            indices = [i for i, name_ in enumerate(self.weights) if name_ == joint]
            if indices:
                obj.vertex_groups.new(name=joint).add(indices, 1.0, "REPLACE")
        modifier = obj.modifiers.new("CharacterSkin", "ARMATURE")
        modifier.object = armature
        modifier.use_vertex_groups = True
        attribute = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
        for loop in mesh.loops:
            attribute.data[loop.index].color = self.colours[loop.vertex_index]
        material = bpy.data.materials.new(name + "_opaque")
        material.diffuse_color = base_colour
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = .85
        bsdf.inputs["Alpha"].default_value = 1.0
        colours = material.node_tree.nodes.new("ShaderNodeVertexColor")
        colours.layer_name = "Color"
        material.node_tree.links.new(colours.outputs["Color"], bsdf.inputs["Base Color"])
        mesh.materials.append(material)
        return obj


def build_scene():
    import bpy
    from mathutils import Vector

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    # Remove unused data too, so rebuilding in the same process has no .001 suffixes.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.actions, bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for block in list(datablocks):
            datablocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    scene.frame_start, scene.frame_end = 1, 2
    root = bpy.data.objects.new(CHARACTER_ID, None)
    scene.collection.objects.link(root)
    rig = bpy.data.armatures.new(f"ARM_{CHARACTER_ID}")
    arm = bpy.data.objects.new(f"ARM_{CHARACTER_ID}", rig)
    scene.collection.objects.link(arm)
    arm.parent = root
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    positions = joint_positions()
    for name in JOINT_PARENTS:
        bone = rig.edit_bones.new(name)
        bone.head = positions[name]
        # Pick the principal child, avoiding twist/helper branches; terminals have a short tail.
        children = [child for child, parent in JOINT_PARENTS.items()
                    if parent == name and "twist" not in child and child != "daypack"]
        bone.tail = positions[children[0]] if children else Vector(positions[name]) + Vector((0, 0, .04))
        if name in ("root", "head", "daypack"):
            bone.tail = Vector(positions[name]) + Vector((0, 0, .08))
        bone.use_deform = True
    for name, parent in JOINT_PARENTS.items():
        if parent:
            rig.edit_bones[name].parent = rig.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    body = Geometry()
    body.box((0, 0, .88), (.29, .19, .17), "pelvis", NAVY)
    body.box((0, 0, 1.04), (.28, .19, .20), "spine_01", NAVY)
    body.box((0, 0, 1.22), (.34, .20, .20), "spine_02", NAVY)
    body.box((0, 0, 1.34), (.37, .20, .08), "spine_03", NAVY)
    body.box((0, -.14, 1.21), (.24, .12, .27), "daypack", NAVY)
    body.limb(positions["neck_01"], positions["head"], .055, "neck_01", NAVY)
    for side in ("l", "r"):
        for joint, end, radius in (("upperarm", "lowerarm", .055), ("lowerarm", "hand", .045),
                                   ("thigh", "calf", .075), ("calf", "foot", .055)):
            body.limb(positions[f"{joint}_{side}"], positions[f"{end}_{side}"], radius,
                      f"{joint}_{side}", NAVY)
        body.limb(positions[f"hand_{side}"], positions[f"fingers_02_{side}"], .04, f"hand_{side}", NAVY)
        x = positions[f"foot_{side}"][0]
        body.box((x, .055, .04), (.13, .25, .08), f"foot_{side}", NAVY)
    body.mesh("VIS_body", root, arm, NAVY)

    face = Geometry()
    face.box((0, 0, 1.54), (.21, .19, .24), "head", SKIN)  # top 1.66 m
    face.box((0, -.008, 1.64), (.215, .195, .04), "head", DARK)  # solid hair
    face.box((0, .111, 1.522), (.025, .045, .034), "head", SKIN)  # nose establishes +Y front
    lids = {}
    for side, sign in (("l", -1), ("r", 1)):
        x = sign * .048
        face.box((x, .103, 1.551), (.054, .018, .036), "head", WHITE)
        face.box((x, .115, 1.550), (.023, .010, .027), "head", DARK)
        lids[side] = face.box((x, .125, 1.570), (.058, .010, .015), "head", SKIN)
        face.box((x, .106, 1.600), (.060, .016, .010), "head", DARK)  # separate brows
    head = face.mesh("VIS_head", root, arm, SKIN)
    head.shape_key_add(name="Basis")
    for name, side in zip(BLINKS, ("l", "r")):
        key = head.shape_key_add(name=name)
        # Extend the overlapping upper lid down across the white of its own eye.
        for index in lids[side]:
            if key.data[index].co.z < 1.570:
                key.data[index].co.z -= .035

    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions.new("idle")
    spine = arm.pose.bones["spine_02"]
    spine.rotation_mode = "XYZ"
    # Exactly two samples and identical endpoints leave no interior sample for a
    # breathing excursion. This minimal P0 holds a small breathing rotation.
    spine.rotation_euler.x = math.radians(.3)
    for frame in (1, 2):
        spine.keyframe_insert(data_path="rotation_euler", index=0, frame=frame, group="spine_02")
    # Avoid legacy Action.fcurves (removed from layered Actions in Blender 5).
    action = arm.animation_data.action
    if hasattr(action, "layers") and len(action.layers):
        curves = [curve for layer in action.layers for strip in layer.strips
                  for bag in strip.channelbags for curve in bag.fcurves]
    else:
        curves = list(action.fcurves)
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
    scene.frame_set(1)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    import bpy
    build_scene()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f"{CHARACTER_ID}.blend"), compress=True)
    for tier in sorted(TIERS):
        print(export_character(CHARACTER_ID, tier, out))


if __name__ == "__main__":
    main()
