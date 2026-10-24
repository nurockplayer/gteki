#!/usr/bin/env python3
"""Export the P0 character from Blender; metadata/GLB helpers need only stdlib.

Blender: -b --factory-startup --python export_character.py --
         --blend sample.blend --id p0_sample --tier high --out out
"""
import argparse
import json
import math
from pathlib import Path
import re
import struct
import sys

# Blender's --python and Python's -I do not add this script's directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_character import (  # noqa: E402
    BLINKS, CLIPS, CONTRACT, FPS, HEIGHT_RANGE_M, JOINT_PARENTS,
    ORIGINAL_LICENCE, Store, TIERS, Validator, multiply, parse_glb, quat_angle_deg, transform, trs_matrix,
)

PROVENANCE = "original: procedural p0 sample, GTEki contributors"


def blender_to_gltf(vector):
    """Y-up conversion for positions, deltas and joint-local reference offsets."""
    x, y, z = vector
    return (float(x), float(z), float(-y))


def build_extras(character_id, tier, height_m, feet, duration_s):
    """P0 metadata: both feet planted for the whole cycle, with a wrapped right window."""
    if not re.fullmatch(r"[a-z][a-z0-9_]*", character_id):
        raise ValueError("id must be a lowercase identifier")
    if tier not in TIERS:
        raise ValueError(f"unknown tier {tier!r}")
    if not math.isfinite(height_m) or not HEIGHT_RANGE_M[0] <= height_m <= HEIGHT_RANGE_M[1]:
        raise ValueError("height outside contract range")
    if not math.isfinite(duration_s) or duration_s <= 0:
        raise ValueError("duration must be positive and finite")
    offsets = {}
    for side in ("l", "r"):
        offsets[side] = {}
        for point in ("heel", "ball"):
            value = list(feet[side][point])
            if len(value) != 3 or not all(math.isfinite(x) for x in value):
                raise ValueError("feet must contain finite joint-local 3D offsets")
            offsets[side][point] = value
    kind, speed = CLIPS["idle"]
    return dict(
        contract=CONTRACT, id=character_id, tier=tier, height_m=height_m, forward="-Z", feet=offsets,
        clips={"idle": dict(
            kind=kind, duration_s=duration_s, distance_per_cycle_m=speed * duration_s,
            calib_speed_mps=speed, contacts={"l": [[0.0, 1.0]], "r": [[0.5, 1.5]]},
            provenance=dict(author="GTEki contributors", licence=ORIGINAL_LICENCE,
                            source="original", description=PROVENANCE),
        )},
    )


def encode_glb(doc, binary):
    """Stable JSON, no build paths or timestamps; keep Blender's binary buffer intact."""
    raw = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                     allow_nan=False).encode("utf-8")
    raw += b" " * (-len(raw) % 4)
    binary += b"\0" * (-len(binary) % 4)
    chunks = struct.pack("<I4s", len(raw), b"JSON") + raw
    if binary:
        chunks += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks


def preserve_blinks(doc, binary, vertices):
    """Restore POSITION morphs lost by Blender's apply-modifiers path.

    vertices is [(Y-up bind position, [left delta, right delta]), ...]. glTF
    splits vertices at flat normals/colours; match each split by its bind position.
    Ambiguous source positions and unmapped vertices fail rather than guessing.
    """
    head = next(n for n in doc["nodes"] if n.get("name") == "VIS_head")
    mesh = doc["meshes"][head["mesh"]]
    if any(p.get("targets") for p in mesh["primitives"]):
        return binary  # Native morph export worked; the validator checks its contract.
    lookup = {}
    for position, deltas in vertices:
        key = tuple(round(v, 6) for v in position)
        if len(deltas) != len(BLINKS):
            raise ValueError("expected exactly two blink deltas")
        if key in lookup and lookup[key] != deltas:
            raise ValueError("ambiguous blink deltas at coincident source vertices")
        lookup[key] = deltas
    store = Store(doc, binary)
    for primitive in mesh["primitives"]:
        positions = store.read(primitive["attributes"]["POSITION"])
        primitive["targets"] = []
        for blink in range(len(BLINKS)):
            rows = []
            for position in positions:
                key = tuple(round(v, 6) for v in position)
                if key not in lookup:
                    raise ValueError(f"exported head vertex has no source blink mapping: {position}")
                rows.append(lookup[key][blink])
            binary += b"\0" * (-len(binary) % 4)
            offset = len(binary)
            raw = b"".join(struct.pack("<3f", *row) for row in rows)
            binary += raw
            view = len(doc.setdefault("bufferViews", []))
            doc["bufferViews"].append(dict(buffer=0, byteOffset=offset, byteLength=len(raw), target=34962))
            accessor = len(doc.setdefault("accessors", []))
            doc["accessors"].append(dict(bufferView=view, componentType=5126, count=len(rows), type="VEC3",
                                         min=[min(row[i] for row in rows) for i in range(3)],
                                         max=[max(row[i] for row in rows) for i in range(3)]))
            primitive["targets"].append(dict(POSITION=accessor))
    mesh.setdefault("extras", {})["targetNames"] = list(BLINKS)
    mesh["weights"] = [0.] * len(BLINKS)
    doc["buffers"][0]["byteLength"] = len(binary)
    return binary


def invert_affine(m):
    """Inverse of a column-major glTF affine matrix (rotation and scale, no shear)."""
    a = [[m[col * 4 + row] for col in range(3)] for row in range(3)]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    if abs(det) < 1e-12:
        raise ValueError("singular joint transform")
    inv = [[(a[(c + 1) % 3][(r + 1) % 3] * a[(c + 2) % 3][(r + 2) % 3]
             - a[(c + 1) % 3][(r + 2) % 3] * a[(c + 2) % 3][(r + 1) % 3]) / det for c in range(3)] for r in range(3)]
    t = [-sum(inv[row][k] * m[12 + k] for k in range(3)) for row in range(3)]
    return [v for col in range(3) for v in (inv[0][col], inv[1][col], inv[2][col], 0.)] + t + [1.]


def glb_feet(doc):
    """§7 feet offsets in the exported joints' own space, from the bind (rest) node transforms:
    heel = the foot_* origin projected to the floor (y = 0), ball = the ball_* origin."""
    nodes = doc["nodes"]
    parent = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
    index = {node.get("name"): i for i, node in enumerate(nodes)}

    def world(i):
        node = nodes[i]
        local = node.get("matrix") or trs_matrix(node.get("translation", [0., 0., 0.]),
                                                 node.get("rotation", [0., 0., 0., 1.]), node.get("scale", [1., 1., 1.]))
        return multiply(world(parent[i]), local) if i in parent else local

    feet = {}
    for side in ("l", "r"):
        feet[side] = {}
        for point, joint in (("heel", f"foot_{side}"), ("ball", f"ball_{side}")):
            m = world(index[joint])
            target = [m[12], 0., m[14]] if point == "heel" else [m[12], m[13], m[14]]
            feet[side][point] = [round(v, 6) + 0. for v in transform(invert_affine(m), target)]
    return feet


def finish_glb(data, extras, blink_vertices=None):
    """Remove only redundant bind-value channels generated by forced sampling.

    Never discard actual root/scale/translation/morph motion to make a file pass.
    Retained channels must already have LINEAR interpolation and 30 Hz samples.
    """
    doc, binary = parse_glb(data)
    nodes = doc["nodes"]
    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    if len(roots) != 1 or nodes[roots[0]].get("name") != extras["id"]:
        raise ValueError("export must contain exactly the named character root")
    # feet come from the exported joints, so they are exact in glTF joint space whatever basis
    # correction the exporter applies to bones
    extras = dict(extras, feet=glb_feet(doc))
    nodes[roots[0]].setdefault("extras", {})["gteki_character"] = extras
    if blink_vertices is not None:
        binary = preserve_blinks(doc, binary, blink_vertices)
    store = Store(doc, binary)
    for animation in doc.get("animations", []):
        kept, samplers = [], []
        for channel in animation["channels"]:
            target = channel["target"]
            node = nodes[target["node"]]
            path = target["path"]
            name = node.get("name")
            allowed = (name in JOINT_PARENTS and name != "root" and
                       (path == "rotation" or (name == "pelvis" and path == "translation")))
            sampler = animation["samplers"][channel["sampler"]]
            if sampler.get("interpolation", "LINEAR") == "STEP":
                # Blender writes STEP for a 2-key channel with equal keys (or an unanimated one);
                # a constant channel samples identically under LINEAR, so normalise only that case
                rows = store.read(sampler["output"])
                moving = (any(quat_angle_deg(row, rows[0]) > 1e-4 for row in rows) if path == "rotation"
                          else any(row != rows[0] for row in rows))  # q and -q are one orientation
                if moving:
                    raise ValueError("exporter produced STEP on a moving channel")
                sampler["interpolation"] = "LINEAR"
            if sampler.get("interpolation", "LINEAR") != "LINEAR":
                raise ValueError("exporter did not produce LINEAR animation")
            if not allowed:
                values = store.read(sampler["output"])
                if path == "weights":
                    defaults = node.get("weights", doc["meshes"][node["mesh"]].get("weights", [0.] * len(BLINKS)))
                    values = [tuple(row[0] for row in values[i:i + len(defaults)])
                              for i in range(0, len(values), len(defaults))]
                else:
                    defaults = node.get(path, {"translation": [0., 0., 0.],
                                              "scale": [1., 1., 1.],
                                              "rotation": [0., 0., 0., 1.]}[path])
                if "matrix" in node:
                    raise ValueError(f"cannot remove a channel from matrix node {name}")
                for row in values:
                    if not all(math.isfinite(v) for v in row):
                        raise ValueError("non-finite animation")
                    same = (quat_angle_deg(row, defaults) < 1e-4 if path == "rotation" else
                            len(row) == len(defaults) and all(abs(a - b) < 1e-6 for a, b in zip(row, defaults)))
                    if not same:
                        raise ValueError(f"forbidden animation on {name}: {path} differs from bind pose")
                continue
            kept.append(dict(target=target, sampler=len(samplers)))
            samplers.append(sampler)
        animation["channels"], animation["samplers"] = kept, samplers
    doc["animations"] = sorted(doc.get("animations", []), key=lambda a: a["name"])
    arms = [i for i, n in enumerate(nodes) if n.get("name") == f"ARM_{extras['id']}"]
    if len(arms) != 1:
        raise ValueError("missing unique armature node")
    for skin in doc.get("skins", []):
        skin["skeleton"] = arms[0]
    result = encode_glb(doc, binary)
    report = Validator(f"{extras['id']}.{extras['tier']}.glb", result, extras["tier"],
                       drift_gate=False, required_clips=["idle"]).check()
    failures = [m["message"] for m in report["messages"] if m["level"] == "FAIL"]
    if failures:
        raise ValueError("export violates character contract: " + "; ".join(failures))
    return result


def exporter_options(properties):
    """Feature detection for Blender 4.x/5.x; fail clearly on missing mandatory controls."""
    required = dict(
        export_format="GLB", export_yup=True, export_apply=True, export_extras=True,
        export_skins=True, export_animations=True, export_morph=True, use_selection=True,
        export_cameras=False, export_lights=False, export_materials="EXPORT",
        export_normals=True, export_tangents=False, export_texcoords=False,
        export_force_sampling=True, export_frame_step=1,
        export_draco_mesh_compression_enable=False,
    )
    missing = sorted(set(required) - set(properties))
    if missing:
        raise RuntimeError("unsupported glTF exporter; missing options: " + ", ".join(missing))
    optional = dict(
        export_animation_mode="ACTIONS", export_nla_strips=False,
        export_anim_single_armature=True, export_frame_range=False,
        export_optimize_animation_size=False, export_optimize_animation_keep_anim_armature=True,
        export_def_bones=False, export_all_influences=False,
        export_morph_animation=False, export_morph_normal=False,
        export_morph_tangent=False, export_current_frame=False,
        export_anim_slide_to_zero=True, export_rest_position_armature=True,
        export_armature_object_remove=False, export_sampling_interpolation_fallback="LINEAR",
        export_reset_pose_bones=True, export_leaf_bone=False,
        export_try_sparse_sk=False, export_shared_accessors=False,
        export_vertex_color="MATERIAL",
    )
    required.update({key: value for key, value in optional.items() if key in properties})
    for key in properties:
        if "meshopt" in key and properties[key].type == "BOOLEAN":
            required[key] = False
    return required


def export_character(character_id, tier, out_dir):
    import bpy

    # TODO(E1): bake Rigify controls to the §3 skeleton/actions at FPS; decimate
    # mobile and resize its atlases. P0 deliberately accepts only the direct rig + idle.
    root = bpy.data.objects.get(character_id)
    if root is None:
        raise ValueError(f"missing character root {character_id}")
    objects = sorted([root, *root.children_recursive], key=lambda obj: obj.name)
    arm = bpy.data.objects.get(f"ARM_{character_id}")
    if arm not in objects or arm.type != "ARMATURE":
        raise ValueError("missing character armature")
    if set(arm.data.bones.keys()) != set(JOINT_PARENTS):
        raise ValueError("armature must have exactly the contract joints")
    for name, parent in JOINT_PARENTS.items():
        actual = arm.data.bones[name].parent
        if (actual.name if actual else None) != parent:
            raise ValueError(f"wrong parent for {name}")
    if sorted(obj.name for obj in objects) != sorted([character_id, arm.name, "VIS_body", "VIS_head"]):
        raise ValueError("P0 character must contain only root, armature, body and head")
    for obj in objects:
        if any(abs(obj.matrix_world[row][col] - (1. if row == col else 0.)) > 1e-6
               for row in range(4) for col in range(4)):
            raise ValueError(f"P0 requires applied identity transforms: {obj.name}")
        if obj.type == "MESH" and any(mod.type != "ARMATURE" for mod in obj.modifiers):
            raise ValueError("P0 supports only armature modifiers")
    head = bpy.data.objects["VIS_head"]
    keys = head.data.shape_keys
    if keys is None or [key.name for key in keys.key_blocks][1:] != BLINKS:
        raise ValueError("head must carry exactly the two ordered blink keys")
    if any(key.value != 0. for key in keys.key_blocks[1:]):  # the Basis reference key reads 1.0
        raise ValueError("P0 export requires blink values at zero")
    if bpy.data.objects["VIS_body"].data.shape_keys is not None:
        raise ValueError("body must not have shape keys")
    blink_vertices = [(blender_to_gltf(vertex.co),
                       [blender_to_gltf(keys.key_blocks[name].data[i].co - vertex.co) for name in BLINKS])
                      for i, vertex in enumerate(keys.reference_key.data)]
    if not arm.animation_data or not arm.animation_data.action or arm.animation_data.action.name != "idle":
        raise ValueError("P0 requires an active idle action")
    if arm.animation_data.nla_tracks:
        raise ValueError("P0 expects a direct idle action without NLA tracks")
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    start, end = arm.animation_data.action.frame_range
    if end - start != 1:
        raise ValueError("P0 idle must contain exactly two frames")
    scene.frame_start, scene.frame_end = int(start), int(end)
    scene.frame_set(int(start))
    # Rest-space geometry, not evaluated animation: the source meshes have applied transforms.
    height = max((obj.matrix_world @ vertex.co).z for obj in objects if obj.type == "MESH"
                 for vertex in obj.data.vertices)
    # placeholder: finish_glb replaces the feet with offsets measured on the exported joints
    feet = {side: {"heel": [0., 0., 0.], "ball": [0., 0., 0.]} for side in ("l", "r")}
    extras = build_extras(character_id, tier, height, feet, (end - start) / FPS)
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{character_id}.{tier}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    properties = {prop.identifier: prop for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
    options = exporter_options(properties)
    # Write through a temporary sibling so a failed validation never replaces a good tier.
    temporary = path.with_name(f".{path.stem}.export.glb")
    try:
        status = bpy.ops.export_scene.gltf(filepath=str(temporary), **options)
        if "FINISHED" not in status:
            raise RuntimeError(f"glTF export failed: {status}")
        final = finish_glb(temporary.read_bytes(), extras, blink_vertices)
        temporary.write_bytes(final)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--tier", choices=sorted(TIERS), required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    import bpy
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
    print(export_character(args.id, args.tier, args.out))


if __name__ == "__main__":
    main()
