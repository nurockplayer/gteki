#!/usr/bin/env python3
"""Build #339 candidate B avatars from the ready-rigged CC0 sources.

Both outputs carry exactly three clips named idle/walk/run, which is what the
explorer's GLB policy looks up (apps/web/src/explorer/avatarGlb.ts:127-143).

Blender: -b --factory-startup --python build_cc0_candidates.py --
         --src <unzipped cc0 dir> --out <dir>

Sources (CC0 1.0):
  Universal Animation Library (Quaternius): Unreal-Godot/UAL1_Standard.glb
  KayKit Adventurers 2.0 (Kay Lousberg): Characters/gltf/Rogue.glb plus the
  Rig_Medium General (Idle_A) and MovementBasic (Walking_A, Running_A) clips.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

UAL_GLB = Path("Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb")
ROGUE_GLB = Path("KayKit_Adventurers_2.0_FREE/Characters/gltf/Rogue.glb")
GEN_GLB = Path("KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/Rig_Medium_General.glb")
MOVEMENT_GLB = Path("KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb")
KAYKIT_ACTIONS = {"idle": "Idle_A", "walk": "Walking_A", "run": "Running_A"}

# #339 E1 commuter palette (sRGB hex), assigned by dominant joint weight per face.
PALETTE = [
    ("coat_navy", "#1f2a44"),
    ("trousers_stone", "#a8a59a"),
    ("shoes_dark", "#2a2622"),
    ("skin", "#c99a7a"),
]
REGION_OF_BONE = {
    "skin": ("head", "neck", "hand", "index", "middle", "pinky", "ring", "thumb"),
    "trousers_stone": ("calf",),
    "shoes_dark": ("foot", "ball", "toe"),
}


def srgb_to_linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_colour):
    """Blender base colour and glTF baseColorFactor are both linear."""
    text = hex_colour.lstrip("#")
    return tuple(srgb_to_linear(int(text[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    if not path.is_file():
        raise SystemExit(f"missing source {path}")
    bpy.ops.import_scene.gltf(filepath=str(path))


def objects_snapshot():
    return set(bpy.data.objects)


def delete_objects(objects):
    for obj in objects:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.Armature) and data.users == 0:
            bpy.data.armatures.remove(data)


def single_armature():
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise SystemExit(f"expected one armature, found {[arm.name for arm in armatures]}")
    return armatures[0]


def character_meshes(armature):
    """Skinned meshes of the candidate; the importer's Icosphere bone shape has no parent."""
    return [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.parent == armature]


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def clear_animation(armature):
    animation = armature.animation_data_create()
    animation.action = None
    for track in list(animation.nla_tracks):
        animation.nla_tracks.remove(track)


def keep_only_actions(armature, mapping):
    """Drop every other action and rename the three kept ones; returns {name: action}."""
    clear_animation(armature)
    chosen = {}
    for target, source in mapping.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise SystemExit(f"missing action {source!r} in the imported file")
        chosen[target] = action
    for action in list(bpy.data.actions):
        if all(action != kept for kept in chosen.values()):
            bpy.data.actions.remove(action)
    for target, action in chosen.items():
        action.name = target
        action.use_fake_user = True
    return chosen


def bind_action(armature, action):
    animation = armature.animation_data_create()
    animation.action = action
    if getattr(action, "slots", None):
        try:
            animation.action_slot = action.slots[0]
        except (AttributeError, TypeError):
            pass


def triangle_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def decimate_to(obj, limit):
    """Collapse-decimate the mesh until it is at or below the triangle limit."""
    current = triangle_count(obj.data)
    for _ in range(4):
        if current <= limit:
            return current
        select_only([obj])
        modifier = obj.modifiers.new("Decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = min(1.0, (limit * 0.99) / current)
        bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        current = triangle_count(obj.data)
    if current > limit:
        raise SystemExit(f"decimate left {current} triangles, over the {limit} limit")
    return current


def region_of_bone(name):
    lowered = name.lower()
    for region, prefixes in REGION_OF_BONE.items():
        if lowered.startswith(prefixes):
            return region
    return "coat_navy"


def paint_by_dominant_weight(obj):
    """One material slot per palette region, chosen by each face's dominant joint weight."""
    mesh = obj.data
    groups = obj.vertex_groups
    materials = []
    for name, colour in PALETTE:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = linear_rgba(colour)
        principled.inputs["Roughness"].default_value = 0.85
        principled.inputs["Metallic"].default_value = 0.0
        materials.append(material)
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    index_of = {name: index for index, (name, _) in enumerate(PALETTE)}
    weights = [{groups[item.group].name: item.weight for item in vertex.groups} for vertex in mesh.vertices]
    for polygon in mesh.polygons:
        totals = {}
        for vertex_index in polygon.vertices:
            for name, weight in weights[vertex_index].items():
                region = region_of_bone(name)
                totals[region] = totals.get(region, 0.0) + weight
        polygon.material_index = index_of[max(totals, key=totals.get) if totals else "coat_navy"]
    print(f"painted {len(mesh.polygons)} faces over {len(materials)} materials")


def face_minus_z(armature):
    """Both sources face glTF +Z; the avatar contract wants -Z (apps/web/src/explorer/avatarGlb.ts)."""
    armature.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ armature.matrix_world
    bpy.context.view_layer.update()


def export_glb(filepath, optimize_animation_size):
    options = dict(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_optimize_animation_size=optimize_animation_size,
    )
    supported = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{key: value for key, value in options.items() if key in supported})


def export_candidate(name, triangles, out):
    """Export, and if the GLB is over 2 MB, retry once with keyframe optimisation on."""
    path = out / f"gteki-commuter-{name}.glb"
    export_glb(path, optimize_animation_size=False)
    if path.stat().st_size > 2_000_000:
        export_glb(path, optimize_animation_size=True)
    return {"candidate": name, "file": path.name, "bytes": path.stat().st_size, "triangles": triangles}


def build_ual(src, out):
    wipe()
    import_glb(src / UAL_GLB)
    armature = single_armature()
    meshes = character_meshes(armature)
    if len(meshes) != 1:
        raise SystemExit(f"expected one character mesh, found {[mesh.name for mesh in meshes]}")
    body = meshes[0]
    delete_objects(objects_snapshot() - {armature, body})
    actions = keep_only_actions(armature, {"idle": "Idle_Loop", "walk": "Walk_Loop", "run": "Jog_Fwd_Loop"})
    bind_action(armature, actions["idle"])
    paint_by_dominant_weight(body)
    triangles = decimate_to(body, 11500)
    face_minus_z(armature)
    return export_candidate("ual", triangles, out)


def build_kaykit(src, out):
    wipe()
    import_glb(src / ROGUE_GLB)
    armature = single_armature()
    meshes = character_meshes(armature)
    if not meshes:
        raise SystemExit("no character meshes under the Rogue armature")
    delete_objects(objects_snapshot() - {armature, *meshes})
    # The clips live in separate rig GLBs; import them for their actions only.
    for clip_library in (GEN_GLB, MOVEMENT_GLB):
        before = objects_snapshot()
        import_glb(src / clip_library)
        delete_objects(objects_snapshot() - before)
    # Rogue ships no handslot props; drop any attached socket prop explicitly.
    delete_objects([obj for obj in bpy.data.objects
                    if obj.parent_type == "BONE" and obj.parent_bone.startswith("handslot")])
    actions = keep_only_actions(armature, KAYKIT_ACTIONS)
    bind_action(armature, actions["idle"])
    triangles = sum(triangle_count(mesh.data) for mesh in meshes)
    face_minus_z(armature)
    return export_candidate("kaykit", triangles, out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, type=Path, help="unzipped CC0 source directory")
    parser.add_argument("--out", required=True, type=Path, help="output directory")
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    results = [build_ual(args.src, args.out), build_kaykit(args.src, args.out)]
    print("BUILD " + json.dumps(results))


if __name__ == "__main__":
    main()
