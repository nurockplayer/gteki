"""Tests for validate_character.py: tiny synthetic gteki-character/0.1 GLBs built in memory, stdlib only.

Run from the repository root:  python3 -I -m unittest tools/blender/character/test_validate_character.py

The passing character has the 38-joint §3 skin, a few triangles, a VIS_head with the two blink morphs and every §6 clip.
Its moving cycles (walk, jog, run, stairs) plant each foot with a two-bone IK on the leg, so the planted foot glides
backward at the calibration speed exactly; the other clips stand still.
"""
import copy
import contextlib
import io
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_character as vc  # noqa: E402

CHARACTER_ID = "gteki_char_test"
HEIGHT_M = 1.66

# Bind-pose joint positions (model space, metres). The character faces -Z, so its left is -X.
REST = {
    "root": (0, 0, 0), "pelvis": (0, 0.95, 0), "spine_01": (0, 1.05, 0), "spine_02": (0, 1.15, 0),
    "spine_03": (0, 1.3, 0), "neck_01": (0, 1.45, 0), "head": (0, 1.55, 0), "daypack": (0, 1.3, 0.15),
}
for _side, _x in (("l", -1), ("r", 1)):
    REST.update({
        f"clavicle_{_side}": (0.05 * _x, 1.4, 0), f"upperarm_{_side}": (0.18 * _x, 1.4, 0),
        f"upperarm_twist_01_{_side}": (0.29 * _x, 1.3, 0), f"lowerarm_{_side}": (0.4 * _x, 1.2, 0),
        f"lowerarm_twist_01_{_side}": (0.49 * _x, 1.1, 0), f"hand_{_side}": (0.58 * _x, 1.0, 0),
        f"thumb_01_{_side}": (0.6 * _x, 0.98, -0.03), f"thumb_02_{_side}": (0.62 * _x, 0.96, -0.05),
        f"fingers_01_{_side}": (0.63 * _x, 0.95, 0), f"fingers_02_{_side}": (0.66 * _x, 0.92, 0),
        f"thigh_{_side}": (0.1 * _x, 0.9, 0), f"thigh_twist_01_{_side}": (0.1 * _x, 0.7, 0),
        f"calf_{_side}": (0.1 * _x, 0.5, 0), f"foot_{_side}": (0.1 * _x, 0.08, 0), f"ball_{_side}": (0.1 * _x, 0.0, -0.12),
    })
THIGH_M, CALF_M = 0.4, 0.42
FOOT_HEIGHT_M = 0.08          # the foot joint above its heel
HIP_DROP_M = 0.05             # thigh joint below the pelvis
FEET = {side: {"heel": [0, -FOOT_HEIGHT_M, 0], "ball": [0, 0, 0]} for side in ("l", "r")}

# Frames per clip (30 fps; a cycle's last frame repeats its first).
FRAMES = {"idle": 30, "walk": 32, "jog": 18, "run": 16, "stairs_up": 22, "stairs_down": 22, "escalator_stand": 30}
MOVING = ("walk", "jog", "run", "stairs_up", "stairs_down")
LEGS = [f"{part}_{side}" for side in ("l", "r") for part in ("thigh", "calf", "foot")]


def quat_x(angle):
    return [math.sin(angle / 2), 0.0, 0.0, math.cos(angle / 2)]


def leg_ik(hip_y, target):
    """Thigh, calf and foot rotations (about X) that put the foot joint at target (y, z) with the foot flat.

    Rotating the straight-down leg by +a about X moves it toward -Z; the knee bends forward."""
    dy, dz = target[0] - hip_y, target[1]
    reach = math.hypot(dy, dz)
    if not abs(THIGH_M - CALF_M) < reach < THIGH_M + CALF_M:
        raise ValueError(f"foot target {target} out of reach")
    phi = math.atan2(-dz, -dy)
    alpha = math.acos((THIGH_M ** 2 + reach ** 2 - CALF_M ** 2) / (2 * THIGH_M * reach))
    beta = math.acos((CALF_M ** 2 + reach ** 2 - THIGH_M ** 2) / (2 * CALF_M * reach))
    thigh, calf = phi + alpha, phi - beta
    return quat_x(thigh), quat_x(calf - thigh), quat_x(-calf)


def foot_target(name, u, duration, slide=0.0):
    """Foot-joint target (y, z) at normalised phase u: stance for u < 0.5 gliding at the clip's calibration speed (plus
    an optional extra slide), swing for the rest of the cycle."""
    speed = vc.CLIPS[name][1]
    if name.startswith("stairs_"):
        riser, tread = vc.STAIRS["riser_m"], vc.STAIRS["tread_m"]
        down = -1 if name == "stairs_up" else 1
        glide = (down * speed * riser / math.hypot(riser, tread), speed * tread / math.hypot(riser, tread))
        base = (FOOT_HEIGHT_M + 0.10, 0.0)
    else:
        glide, base = (0.0, speed), (FOOT_HEIGHT_M, 0.0)
    start = (base[0] - glide[0] * duration / 4, base[1] - glide[1] * duration / 4)
    end = (start[0] + glide[0] * duration / 2, start[1] + glide[1] * duration / 2 + slide)
    if u < 0.5:
        w = u / 0.5
        return start[0] + (end[0] - start[0]) * w, start[1] + (end[1] - start[1]) * w
    w = (u - 0.5) / 0.5
    return end[0] + (start[0] - end[0]) * w + 0.06 * math.sin(math.pi * w), end[1] + (start[1] - end[1]) * w


def clip_tracks(name, slide=0.0):
    """{joint: {path: [values per frame]}} for one clip; a slide is added to the left foot's stance only."""
    frames = FRAMES.get(name, 30)
    duration = frames / vc.FPS
    moving = name in MOVING
    pelvis_y = 0.70 if moving else REST["pelvis"][1]
    tracks = {"pelvis": {"translation": [[0.0, pelvis_y, 0.0]] * (frames + 1)},
              "spine_01": {"rotation": [[0.0, 0.0, 0.0, 1.0]] * (frames + 1)}}
    for joint in LEGS:
        tracks[joint] = {"rotation": []}
    for f in range(frames + 1):
        for side, phase in (("l", 0.0), ("r", 0.5)):
            if moving:
                u = (f / frames + phase) % 1.0
                target = foot_target(name, u, duration, slide if side == "l" else 0.0)
                rotations = leg_ik(pelvis_y - HIP_DROP_M, target)
            else:
                rotations = ([0.0, 0.0, 0.0, 1.0],) * 3
            for part, rotation in zip(("thigh", "calf", "foot"), rotations):
                tracks[f"{part}_{side}"]["rotation"].append(list(rotation))
    return tracks


def clip_meta(name):
    kind, speed = vc.CLIPS[name]
    speed = 0.0 if speed is None else speed
    frames = FRAMES.get(name, 30)
    duration = frames / vc.FPS
    entry = dict(kind=kind, duration_s=duration, calib_speed_mps=speed,
                 provenance=dict(author="GTEki contributors", licence="CC-BY-4.0", source="original"))
    if kind == "cycle":
        entry["distance_per_cycle_m"] = speed * duration
        stride = name in MOVING
        entry["contacts"] = dict(l=[[0.0, 0.5]], r=[[0.5, 1.0]]) if stride else dict(l=[[0.0, 1.0]], r=[[0.5, 1.5]])
    else:
        if name.startswith(("start_", "stop_")):
            entry["contacts"] = dict(l=[[0.0, 1 / frames]], r=[[0.0, 1 / frames]])
            entry["speed_profile"] = [[0.0, 0.0], [1.0, 1.45]] if name.startswith("start_") else [[0.0, 1.45], [1.0, 0.0]]
        else:
            entry["contacts"] = dict(l=[[0.0, 1.0]], r=[[0.0, 1.0]])
    if name in vc.TURN_YAW:
        entry["yaw_deg"] = vc.TURN_YAW[name]
    if name.startswith("stairs_"):
        entry.update(vc.STAIRS)
    return entry


def png(width, height):
    rows = b"".join(b"\0" + b"\0" * width for _ in range(height))
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


class Builder:
    """One embedded buffer of accessors, 4-byte aligned."""

    FORMATS = {5126: "f", 5121: "B", 5123: "H"}
    WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def __init__(self):
        self.binary = b""
        self.views, self.accessors = [], []

    def view(self, data):
        self.binary += b"\0" * (-len(self.binary) % 4)
        self.views.append(dict(buffer=0, byteOffset=len(self.binary), byteLength=len(data)))
        self.binary += data
        return len(self.views) - 1

    def accessor(self, rows, kind, ctype=5126, normalized=False, bounds=False):
        flat = [c for row in rows for c in (row if isinstance(row, (list, tuple)) else [row])]
        data = struct.pack("<" + self.FORMATS[ctype] * len(flat), *flat)
        accessor = dict(bufferView=self.view(data), componentType=ctype, count=len(rows), type=kind)
        if normalized:
            accessor["normalized"] = True
        if bounds:
            width = self.WIDTH[kind]
            table = [row if isinstance(row, (list, tuple)) else [row] for row in rows]
            columns = [[row[i] for row in table] for i in range(width)]
            accessor.update(min=[min(c) for c in columns], max=[max(c) for c in columns])
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def character(tier="high", slide=0.0, weights=None, image=(64, 64), triangles=None, clips=None):
    """(doc, binary) of a passing character, with optional faults for the failing cases."""
    b = Builder()
    nodes = [dict(name=CHARACTER_ID, children=[1, 2, 3]), dict(name=f"ARM_{CHARACTER_ID}", children=[]),
             dict(name="VIS_body", mesh=0, skin=0), dict(name="VIS_head", mesh=1, skin=0)]
    joint_index = {}
    for name in vc.JOINT_PARENTS:
        joint_index[name] = len(nodes)
        parent = vc.JOINT_PARENTS[name]
        origin = REST[parent] if parent else (0, 0, 0)
        nodes.append(dict(name=name, translation=[REST[name][i] - origin[i] for i in range(3)]))
    for name, parent in vc.JOINT_PARENTS.items():
        holder = nodes[joint_index[parent]] if parent else nodes[1]
        holder.setdefault("children", []).append(joint_index[name])
    joints = list(joint_index)

    # VIS_body: a quad (or `triangles` triangles) on the pelvis; VIS_head: one triangle reaching the head top.
    count = triangles or 2
    body = [[0.2 * math.cos(k), 0.8 + 0.001 * k, 0.1 * math.sin(k)] for k in range(count + 2)]
    body_indices = [i for k in range(count) for i in (0, k + 1, k + 2)]
    pelvis = joints.index("pelvis")
    body_weights = weights or [[1.0, 0.0, 0.0, 0.0]] * len(body)
    body_primitive = dict(attributes=dict(POSITION=b.accessor(body, "VEC3", bounds=True),
                                          JOINTS_0=b.accessor([[pelvis, 0, 0, 0]] * len(body), "VEC4", 5121),
                                          WEIGHTS_0=b.accessor(body_weights, "VEC4")),
                          indices=b.accessor(body_indices, "SCALAR", 5123), material=0)
    head = [[-0.08, 1.5, 0.0], [0.08, 1.5, 0.0], [0.0, HEIGHT_M, 0.0]]
    head_joint = joints.index("head")
    blink = [[0.0, -0.01, 0.0]] * 3
    head_primitive = dict(attributes=dict(POSITION=b.accessor(head, "VEC3", bounds=True),
                                          JOINTS_0=b.accessor([[head_joint, 0, 0, 0]] * 3, "VEC4", 5121),
                                          WEIGHTS_0=b.accessor([[1.0, 0.0, 0.0, 0.0]] * 3, "VEC4")),
                          indices=b.accessor([0, 1, 2], "SCALAR", 5123), material=0,
                          targets=[dict(POSITION=b.accessor(blink, "VEC3", bounds=True)),
                                   dict(POSITION=b.accessor(blink, "VEC3", bounds=True))])

    animations, metadata = [], {}
    for name in (clips if clips is not None else vc.CLIPS):
        frames = FRAMES.get(name, 30)
        times = b.accessor([f / vc.FPS for f in range(frames + 1)], "SCALAR", bounds=True)
        samplers, channels = [], []
        for joint, paths in clip_tracks(name, slide if name == "walk" else 0.0).items():
            for path, values in paths.items():
                kind = "VEC4" if path == "rotation" else "VEC3"
                samplers.append(dict(input=times, output=b.accessor(values, kind), interpolation="LINEAR"))
                channels.append(dict(sampler=len(samplers) - 1, target=dict(node=joint_index[joint], path=path)))
        animations.append(dict(name=name, samplers=samplers, channels=channels))
        metadata[name] = clip_meta(name)

    nodes[0]["extras"] = {"gteki_character": dict(contract=vc.CONTRACT, id=CHARACTER_ID, tier=tier, height_m=HEIGHT_M,
                                                  forward="-Z", feet=copy.deepcopy(FEET), clips=metadata)}
    image_view = b.view(png(*image))
    doc = dict(asset=dict(version="2.0"), scene=0, scenes=[dict(nodes=[0])], nodes=nodes,
               skins=[dict(joints=[joint_index[name] for name in joints])],
               meshes=[dict(name="body", primitives=[body_primitive]),
                       dict(name="head", primitives=[head_primitive], extras=dict(targetNames=list(vc.BLINKS)))],
               materials=[dict(name="gteki_char_body", pbrMetallicRoughness=dict(baseColorTexture=dict(index=0)))],
               textures=[dict(source=0)], images=[dict(bufferView=image_view, mimeType="image/png")],
               animations=animations, accessors=b.accessors, bufferViews=b.views)
    return doc, b.binary


def encode(doc, binary):
    binary = binary + b"\0" * (-len(binary) % 4)
    doc = dict(doc, buffers=[dict(byteLength=len(binary))])
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    chunks = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary
    return struct.pack("<4sII", b"glTF", 2, len(chunks) + 12) + chunks


def validate(doc, binary, tier="high", **options):
    return vc.Validator(f"{CHARACTER_ID}.{tier}.glb", encode(doc, binary), tier, **options).check()


def failures(result):
    return [m for m in result["messages"] if m["level"] == "FAIL"]


class PassingCharacter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = validate(*character())

    def test_passes_every_check(self):
        self.assertEqual(failures(self.result), [])
        self.assertEqual(self.result["status"], "PASS", self.result["messages"])

    def test_report_holds_the_measured_values(self):
        r = self.result
        self.assertEqual(r["joint_count"], 38)
        self.assertEqual(r["triangles"], 3)
        self.assertEqual(r["primitives"], 2)
        self.assertEqual(r["texture_gpu_bytes"], int(64 * 64 * 4 * 4 / 3))
        self.assertEqual(set(r["clips"]), set(vc.CLIPS))
        walk = r["clips"]["walk"]
        self.assertEqual(walk["frames"], FRAMES["walk"])
        self.assertLess(walk["foot_drift_m"]["l"], 0.001)  # the IK glide is exact up to float32 storage
        self.assertEqual(walk["drift_limit_m"], 0.02)
        self.assertIn("loop_pop_deg", walk)
        self.assertIn("pelvis_forward_drift_m", walk)
        json.dumps(r, allow_nan=False)  # the --report payload is plain JSON

    def test_mobile_tier_passes_too(self):
        self.assertEqual(failures(validate(*character(tier="mobile"), tier="mobile")), [])

    def test_idle_only_p0_sample_passes_with_cli_options(self):
        doc, binary = character(clips=["idle"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "idle.glb"
            path.write_bytes(encode(doc, binary))
            old_argv = sys.argv
            sys.argv = ["validate_character.py", "--tier", "high", "--clips", "idle",
                        "--drift-advisory", str(path)]
            try:
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(vc.main(), 0)
                self.assertIn("1 files; 1 PASS", output.getvalue())
            finally:
                sys.argv = old_argv


class FailingChecks(unittest.TestCase):
    def assertFailsCheck(self, result, check, text=""):
        found = [m for m in failures(result) if m["check"] == check and text in m["message"]]
        self.assertTrue(found, f"no check {check} FAIL mentioning {text!r}: {result['messages']}")

    # 1. node tree
    def test_1_vis_name_outside_section_2(self):
        doc, binary = character()
        doc["nodes"][3]["name"] = "VIS_face"
        self.assertFailsCheck(validate(doc, binary), 1, "VIS_face")

    def test_1_missing_armature(self):
        doc, binary = character()
        doc["nodes"][1]["name"] = "Armature"
        self.assertFailsCheck(validate(doc, binary), 1, f"ARM_{CHARACTER_ID}")

    def test_1_two_roots(self):
        doc, binary = character()
        doc["scenes"][0]["nodes"] = [0, 2]
        doc["nodes"][0]["children"] = [1, 3]
        self.assertFailsCheck(validate(doc, binary), 1, "exactly one root")

    # 2. skin
    def test_2_joint_missing_and_unknown(self):
        doc, binary = character()
        index = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "daypack")
        doc["nodes"][index]["name"] = "backpack"
        result = validate(doc, binary)
        self.assertFailsCheck(result, 2, "daypack")
        self.assertFailsCheck(result, 2, "backpack")

    def test_2_two_skins(self):
        doc, binary = character()
        doc["skins"].append(copy.deepcopy(doc["skins"][0]))
        self.assertFailsCheck(validate(doc, binary), 2, "exactly one skin")

    def test_2_wrong_joint_parent_fails(self):
        doc, binary = character()
        pelvis = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "pelvis")
        correct_parent = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "root")
        wrong_parent = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "spine_01")
        doc["nodes"][correct_parent]["children"].remove(pelvis)
        doc["nodes"][wrong_parent].setdefault("children", []).append(pelvis)
        self.assertFailsCheck(validate(doc, binary), 2, "pelvis under spine_01")

    # 3. skin attributes
    def test_3_weight_sum(self):
        doc, binary = character(weights=[[0.9, 0.0, 0.0, 0.0]] * 4)
        self.assertFailsCheck(validate(doc, binary), 3, "weight sum")

    def test_3_negative_weight(self):
        doc, binary = character(weights=[[1.1, -0.1, 0.0, 0.0]] * 4)
        self.assertFailsCheck(validate(doc, binary), 3, "negative")

    def test_3_second_influence_set(self):
        doc, binary = character()
        attributes = doc["meshes"][0]["primitives"][0]["attributes"]
        attributes["JOINTS_1"], attributes["WEIGHTS_1"] = attributes["JOINTS_0"], attributes["WEIGHTS_0"]
        self.assertFailsCheck(validate(doc, binary), 3, "JOINTS_1")

    def test_3_non_finite_skin_values_fail(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        weights = b.accessor([[float("nan"), 0.0, 0.0, 0.0]] * 4, "VEC4")
        doc["meshes"][0]["primitives"][0]["attributes"]["WEIGHTS_0"] = weights
        self.assertFailsCheck(validate(doc, b.binary), 3, "non-finite WEIGHTS_0")

        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        positions = b.accessor([[float("inf"), 0.8, 0.0]] * 4, "VEC3")
        doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"] = positions
        self.assertFailsCheck(validate(doc, b.binary), 3, "POSITION contains a non-finite")

        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        bad = b.accessor([[0.0, float("-inf"), 0.0, 1.0]] * (FRAMES["idle"] + 1), "VEC4")
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        rotation = next(c for c in idle["channels"]
                        if c["target"]["path"] == "rotation" and
                        doc["nodes"][c["target"]["node"]].get("name") == "spine_01")
        idle["samplers"][rotation["sampler"]]["output"] = bad
        self.assertFailsCheck(validate(doc, b.binary), 3, "sampler output contains a non-finite")

    # 4. morphs
    def test_4_blink_order(self):
        doc, binary = character()
        doc["meshes"][1]["extras"]["targetNames"] = ["blinkRight", "blinkLeft"]
        self.assertFailsCheck(validate(doc, binary), 4, "targetNames")

    def test_4_morph_on_body(self):
        doc, binary = character()
        doc["meshes"][0]["primitives"][0]["targets"] = doc["meshes"][1]["primitives"][0]["targets"]
        self.assertFailsCheck(validate(doc, binary), 4, "only VIS_head")

    def test_4_morph_attribute(self):
        doc, binary = character()
        doc["meshes"][1]["primitives"][0]["targets"][0]["TANGENT"] = 0
        self.assertFailsCheck(validate(doc, binary), 4, "TANGENT")

    # 5. materials
    def test_5_blend_alpha(self):
        doc, binary = character()
        doc["materials"][0]["alphaMode"] = "BLEND"
        self.assertFailsCheck(validate(doc, binary), 5, "alphaMode")

    def test_5_transmission(self):
        doc, binary = character()
        doc["extensionsUsed"] = ["KHR_materials_transmission"]
        doc["materials"][0]["extensions"] = {"KHR_materials_transmission": {"transmissionFactor": 1}}
        self.assertFailsCheck(validate(doc, binary), 5, "KHR_materials_transmission")

    def test_5_extension_outside_baseline(self):
        doc, binary = character()
        doc["extensionsUsed"] = ["KHR_texture_basisu"]
        self.assertFailsCheck(validate(doc, binary), 5, "KHR_texture_basisu")

    def test_5_mobile_orm_texture_fails(self):
        doc, binary = character(tier="mobile")
        doc["materials"][0]["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": 0}
        self.assertFailsCheck(validate(doc, binary, tier="mobile"), 5, "metallicRoughnessTexture")
        doc, binary = character(tier="mobile")
        doc["materials"][0]["occlusionTexture"] = {"index": 0}
        self.assertFailsCheck(validate(doc, binary, tier="mobile"), 5, "occlusionTexture")

    def test_5_mobile_normal_and_emissive_textures_fail(self):
        for slot in ("normalTexture", "emissiveTexture"):
            with self.subTest(slot=slot):
                doc, binary = character(tier="mobile")
                doc["materials"][0][slot] = {"index": 0}
                self.assertFailsCheck(validate(doc, binary, tier="mobile"), 5, slot)

    # 6. budgets
    def test_6_mobile_texture_gpu_bytes(self):
        doc, binary = character(tier="mobile", image=(1024, 1024))
        result = validate(doc, binary, tier="mobile")
        self.assertFailsCheck(result, 6, "texture GPU bytes")
        self.assertFailsCheck(result, 6, "1024x1024")

    def test_6_mobile_head_texture_size(self):
        doc, binary = character(tier="mobile", image=(512, 512))
        self.assertFailsCheck(validate(doc, binary, tier="mobile"), 6, "VIS_head base-colour image")

    def test_6_mobile_triangles(self):
        doc, binary = character(tier="mobile", triangles=5001)
        self.assertFailsCheck(validate(doc, binary, tier="mobile"), 6, "5002 triangles")

    def test_6_primitives(self):
        doc, binary = character()
        primitive = doc["meshes"][0]["primitives"][0]
        doc["meshes"][0]["primitives"] = [primitive] * 3
        self.assertFailsCheck(validate(doc, binary), 6, "primitives")

    # 7. clips
    def test_7_required_clip_missing(self):
        doc, binary = character(clips=[name for name in vc.CLIPS if name != "jog"])
        self.assertFailsCheck(validate(doc, binary), 7, "jog")

    def test_7_clip_subset_and_unknown_cli_name(self):
        doc, binary = character(clips=["idle"])
        result = vc.Validator("idle.glb", encode(doc, binary), "high", drift_gate=False,
                              required_clips=["idle"]).check()
        self.assertEqual(failures(result), [])
        old_argv = sys.argv
        sys.argv = ["validate_character.py", "--tier", "high", "--clips", "idle,dance", "missing.glb"]
        try:
            with self.assertRaises(SystemExit) as raised:
                vc.main()
            self.assertEqual(raised.exception.code, 2)
        finally:
            sys.argv = old_argv

    def test_7_unknown_clip(self):
        doc, binary = character()
        doc["animations"][0]["name"] = "dance"
        self.assertFailsCheck(validate(doc, binary), 7, "dance")

    def test_7_scale_and_root_channels(self):
        doc, binary = character()
        root_joint = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "root")
        channels = doc["animations"][0]["channels"]
        channels.append(dict(sampler=channels[0]["sampler"], target=dict(node=root_joint, path="translation")))
        channels.append(dict(sampler=channels[0]["sampler"], target=dict(node=root_joint, path="scale")))
        result = validate(doc, binary)
        self.assertFailsCheck(result, 7, "channel on root")
        self.assertFailsCheck(result, 7, "scale channel")

    def test_7_translation_off_pelvis_and_morph_weights(self):
        doc, binary = character()
        spine = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "spine_01")
        channels = doc["animations"][0]["channels"]
        channels.append(dict(sampler=channels[0]["sampler"], target=dict(node=spine, path="translation")))
        channels.append(dict(sampler=channels[0]["sampler"], target=dict(node=3, path="weights")))
        result = validate(doc, binary)
        self.assertFailsCheck(result, 7, "translation channel on 'spine_01'")
        self.assertFailsCheck(result, 7, "morph-weight")

    def test_7_step_interpolation(self):
        doc, binary = character()
        doc["animations"][1]["samplers"][0]["interpolation"] = "STEP"
        self.assertFailsCheck(validate(doc, binary), 7, "STEP")

    def test_7_sample_rate(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        frames = FRAMES["idle"]
        slow = b.accessor([f / 24 for f in range(frames + 1)], "SCALAR", bounds=True)
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        for sampler in idle["samplers"]:
            sampler["input"] = slow
        self.assertFailsCheck(validate(doc, b.binary), 7, "sample rate")

    def test_7_pelvis_forward_drift(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        frames = FRAMES["idle"]
        drifting = b.accessor([[0.0, 0.95, 0.03 * f / frames] for f in range(frames + 1)], "VEC3")
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        pelvis = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "pelvis")
        channel = next(c for c in idle["channels"] if c["target"]["node"] == pelvis)
        idle["samplers"][channel["sampler"]]["output"] = drifting
        self.assertFailsCheck(validate(doc, b.binary), 7, "pelvis net forward drift")

    def test_7_loop_pop(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        frames = FRAMES["idle"]
        popping = b.accessor([[0.0, 0.0, 0.0, 1.0]] * frames + [quat_x(math.radians(2))], "VEC4")
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        spine = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "spine_01")
        channel = next(c for c in idle["channels"] if c["target"]["node"] == spine)
        idle["samplers"][channel["sampler"]]["output"] = popping
        self.assertFailsCheck(validate(doc, b.binary), 7, "pops")

    def test_7_cycle_pelvis_translation_loop_pop(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        frames = FRAMES["idle"]
        popping = b.accessor([[0.0, 0.95, 0.0]] * frames + [[0.0, 0.952, 0.0]], "VEC3")
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        pelvis = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "pelvis")
        channel = next(c for c in idle["channels"]
                       if c["target"]["node"] == pelvis and c["target"]["path"] == "translation")
        idle["samplers"][channel["sampler"]]["output"] = popping
        result = validate(doc, b.binary)
        self.assertFailsCheck(result, 7, "pelvis translation pops")
        self.assertEqual(result["clips"]["idle"]["loop_pop_translation_m"], 0.002)

    # 8. metadata
    def meta(self, doc):
        return doc["nodes"][0]["extras"]["gteki_character"]

    def test_8_contract_and_forward(self):
        doc, binary = character()
        self.meta(doc).update(contract="gteki-asset/0.1", forward="+Z")
        result = validate(doc, binary)
        self.assertFailsCheck(result, 8, "contract")
        self.assertFailsCheck(result, 8, "forward")

    def test_8_tier_mismatch(self):
        doc, binary = character()
        self.assertFailsCheck(validate(doc, binary, tier="mobile"), 8, "tier")

    def test_8_distance_mismatch(self):
        doc, binary = character()
        self.meta(doc)["clips"]["walk"]["distance_per_cycle_m"] *= 1.05
        self.assertFailsCheck(validate(doc, binary), 8, "distance_per_cycle_m")

    def test_8_start_stop_profile_required_and_validated(self):
        doc, binary = character()
        del self.meta(doc)["clips"]["start_l"]["speed_profile"]
        self.assertFailsCheck(validate(doc, binary), 8, "speed_profile")
        doc, binary = character()
        self.meta(doc)["clips"]["start_l"]["calib_speed_mps"] = 1.4
        self.meta(doc)["clips"]["start_l"]["speed_profile"] = [[0, 0], [0.5, -0.1], [1, 1.45]]
        result = validate(doc, binary)
        self.assertFailsCheck(result, 8, "calib_speed_mps must be 1.45")
        self.assertFailsCheck(result, 8, "mps values must be non-negative")

    def test_8_turn_yaw_sign(self):
        doc, binary = character()
        self.meta(doc)["clips"]["turn90_r"]["yaw_deg"] = 90
        self.assertFailsCheck(validate(doc, binary), 8, "yaw_deg -90")

    def test_8_contacts_missing(self):
        doc, binary = character()
        del self.meta(doc)["clips"]["jog"]["contacts"]
        self.assertFailsCheck(validate(doc, binary), 8, "contact windows are missing")

    def test_8_right_contact_off_half(self):
        doc, binary = character()
        self.meta(doc)["clips"]["run"]["contacts"]["r"] = [[0.7, 1.2]]
        self.assertFailsCheck(validate(doc, binary), 8, "r contact must start at 0.5")

    def test_8_provenance_missing(self):
        doc, binary = character()
        del self.meta(doc)["clips"]["idle"]["provenance"]
        self.assertFailsCheck(validate(doc, binary), 8, "provenance is missing")

    def test_8_derived_clip_licence(self):
        doc, binary = character()
        self.meta(doc)["clips"]["walk"]["provenance"].update(source="derived")
        result = validate(doc, binary)
        self.assertFailsCheck(result, 8, "derived_from")
        self.assertFailsCheck(result, 8, vc.DERIVED_LICENCE)


class FootDrift(unittest.TestCase):
    def test_9_correct_backward_glide_passes(self):
        result = validate(*character())
        self.assertEqual([m for m in result["messages"] if m["check"] == 9], [])
        for name in MOVING:
            drift = result["clips"][name]["foot_drift_m"]
            self.assertLess(max(drift.values()), 0.001, name)

    def test_9_stance_foot_sliding_5cm_fails(self):
        result = validate(*character(slide=0.05))
        nine = [m for m in failures(result) if m["check"] == 9]
        self.assertEqual(len(nine), 1, result["messages"])
        self.assertIn("'walk' l foot drifts 5.00 cm", nine[0]["message"])
        self.assertEqual([m for m in failures(result) if m["check"] != 9], [])  # the slide breaks nothing else
        self.assertAlmostEqual(result["clips"]["walk"]["foot_drift_m"]["l"], 0.05, places=3)

    def test_9_advisory_mode_only_warns(self):
        result = validate(*character(slide=0.05), drift_gate=False)
        self.assertEqual(failures(result), [])
        self.assertEqual(result["status"], "WARN")

    def test_9_contact_window_without_two_stance_samples_fails_or_warns(self):
        doc, binary = character()
        b = Builder()
        b.binary, b.views, b.accessors = binary, doc["bufferViews"], doc["accessors"]
        frames = FRAMES["idle"]
        alternating = [[0.1 if f % 2 else -0.1, 0.95 if f % 2 == 0 else 1.0, 0.0]
                        for f in range(frames + 1)]
        values = b.accessor(alternating, "VEC3")
        idle = next(a for a in doc["animations"] if a["name"] == "idle")
        pelvis = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == "pelvis")
        channel = next(c for c in idle["channels"]
                       if c["target"]["node"] == pelvis and c["target"]["path"] == "translation")
        idle["samplers"][channel["sampler"]]["output"] = values

        result = validate(doc, b.binary)
        self.assertTrue(any(m["level"] == "FAIL" and m["check"] == 9 and "unmeasured: only" in m["message"]
                            for m in result["messages"]), result["messages"])
        self.assertTrue(any(window["drift_m"] == "unmeasured"
                            for side in result["clips"]["idle"]["contact_windows"].values()
                            for window in side))
        advisory = validate(doc, b.binary, drift_gate=False)
        self.assertEqual(failures(advisory), [])
        self.assertTrue(any(m["check"] == 9 and m["level"] == "WARN" and "unmeasured" in m["message"]
                            for m in advisory["messages"]))

    def test_9_start_stop_profile_integrates_piecewise_linear_speed(self):
        self.assertAlmostEqual(vc.Validator.profile_distance([[0, 0], [1, 1.45]], 1, 2), 1.45)
        self.assertAlmostEqual(vc.Validator.profile_distance([[0, 1.45], [1, 0]], 1, 2), 1.45)
        self.assertAlmostEqual(vc.Validator.profile_distance([[0, 0], [0.5, 1], [1, 0]], 0.5, 2), 0.5)


class CommandLine(unittest.TestCase):
    def test_exit_codes_and_report(self):
        import subprocess
        import tempfile
        script = Path(vc.__file__)
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp, f"{CHARACTER_ID}.high.glb")
            good.write_bytes(encode(*character()))
            bad = Path(tmp, "bad.glb")
            doc, binary = character()
            doc["materials"][0]["alphaMode"] = "MASK"
            bad.write_bytes(encode(doc, binary))
            report = Path(tmp, "out.json")
            ok = subprocess.run([sys.executable, "-I", str(script), "--tier", "high", "--report", str(report), str(good)],
                                capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            data = json.loads(report.read_text())
            self.assertEqual(data["files"][0]["status"], "PASS")
            self.assertIn("foot_drift_m", data["files"][0]["clips"]["walk"])
            no = subprocess.run([sys.executable, "-I", str(script), "--tier", "high", str(bad)],
                                capture_output=True, text=True)
            self.assertEqual(no.returncode, 1)
            self.assertIn("FAIL", no.stdout)
            self.assertIn("[check 5]", no.stdout)


if __name__ == "__main__":
    unittest.main()
