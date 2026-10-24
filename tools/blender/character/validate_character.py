#!/usr/bin/env python3
"""Validate gteki-character/0.1 GLBs (docs/assets/character-contract.md §8) without Blender or third-party packages.

Checks, numbered as in §8: 1 node tree, 2 skin, 3 skin attributes, 4 morphs, 5 materials, 6 budgets, 7 clips,
8 metadata, 9 offline foot drift. A failure prints one line per problem and exits 1; warnings print and exit 0.

Foot drift (check 9) runs forward kinematics over the skin's joints with stdlib quaternions at every 30 fps sample of
each clip. The heel and ball references are the §7 `feet` offsets in the `foot_*` and `ball_*` joint spaces. Inside each
`contacts` window the ideal backward glide is removed (a cycle's planted foot moves toward +Z at `calib_speed_mps`, since
the character faces -Z; the stairs move it along the stair slope), and the drift is the largest horizontal distance a
reference point travels from where it was first planted. A reference point counts as planted at a sample when it is
within 2 cm of its lowest height in that window and its vertical speed is below 5 cm/s (the F0 stance definition,
measured relative to the window's floor so the stairs work too).

Texture GPU bytes are estimated as width x height x 4 x 4/3 (RGBA8 with a full mip chain).
"""
import argparse
import base64
import bisect
import json
import math
from pathlib import Path
import struct
import sys

CONTRACT = "gteki-character/0.1"
FPS = 30
TIME_TOLERANCE_S = 1e-4
MIB = 1024 * 1024

# §3 export skeleton: joint -> expected parent (the UE mannequin chain). The contract fixes the names; the parent of
# each joint follows the UE mannequin chain, and a different parent fails check 2.
JOINT_PARENTS = {
    "root": None, "pelvis": "root", "spine_01": "pelvis", "spine_02": "spine_01", "spine_03": "spine_02",
    "neck_01": "spine_03", "head": "neck_01", "daypack": "spine_03",
}
for _side in ("l", "r"):
    JOINT_PARENTS.update({
        f"clavicle_{_side}": "spine_03", f"upperarm_{_side}": f"clavicle_{_side}",
        f"lowerarm_{_side}": f"upperarm_{_side}", f"hand_{_side}": f"lowerarm_{_side}",
        f"upperarm_twist_01_{_side}": f"upperarm_{_side}", f"lowerarm_twist_01_{_side}": f"lowerarm_{_side}",
        f"thumb_01_{_side}": f"hand_{_side}", f"thumb_02_{_side}": f"thumb_01_{_side}",
        f"fingers_01_{_side}": f"hand_{_side}", f"fingers_02_{_side}": f"fingers_01_{_side}",
        f"thigh_{_side}": "pelvis", f"calf_{_side}": f"thigh_{_side}", f"foot_{_side}": f"calf_{_side}",
        f"ball_{_side}": f"foot_{_side}", f"thigh_twist_01_{_side}": f"thigh_{_side}",
    })
JOINT_MIN, JOINT_WARN, JOINT_MAX = 32, 48, 64

VIS_NAMES = ("VIS_body", "VIS_head")
BLINKS = ["blinkLeft", "blinkRight"]
MORPH_ATTRIBUTES = {"POSITION", "NORMAL"}
ALLOWED_EXTENSIONS = {"KHR_materials_emissive_strength", "KHR_texture_transform"}
FORBIDDEN_MATERIAL_EXTENSIONS = {"KHR_materials_transmission", "KHR_materials_volume"}

# §4 budgets. The high tier's GPU cap is the §4 texture set itself: base colour + ORM at 1024² (body) and 512² (head).
TIERS = {
    "high": dict(triangles=12000, primitives=3, max_texture=1024,
                 mesh_texture={"VIS_body": 1024, "VIS_head": 512},
                 texture_gpu_bytes=int(2 * (1024 * 1024 + 512 * 512) * 4 * 4 / 3), file_fail=None, file_warn=None),
    "mobile": dict(triangles=5000, primitives=3, max_texture=512,
                   mesh_texture={"VIS_body": 512, "VIS_head": 256},
                   texture_gpu_bytes=2 * MIB, file_fail=2 * MIB, file_warn=int(1.5 * MIB)),
}

# §6 clips: name -> (kind, calibration speed in m/s).
CLIPS = {
    "idle": ("cycle", 0.0), "walk": ("cycle", 1.45), "jog": ("cycle", 2.30), "run": ("cycle", 3.20),
    "start_l": ("one-shot", 1.45), "start_r": ("one-shot", 1.45),
    "stop_l": ("one-shot", 1.45), "stop_r": ("one-shot", 1.45),
    "turn90_l": ("one-shot", 0.0), "turn90_r": ("one-shot", 0.0),
    "turn180_l": ("one-shot", 0.0), "turn180_r": ("one-shot", 0.0),
    "stairs_up": ("cycle", 0.9), "stairs_down": ("cycle", 0.9), "escalator_stand": ("cycle", 0.0),
}
TURN_YAW = {"turn90_l": 90.0, "turn90_r": -90.0, "turn180_l": 180.0, "turn180_r": -180.0}
STAIRS = dict(riser_m=0.16, tread_m=0.30, steps_per_cycle=2)
PELVIS_DRIFT_M = 0.01
LOOP_POP_DEG = 0.5
LOOP_POP_TRANSLATION_M = 0.001
DRIFT_LIMITS_M = {
    "walk": 0.02, "jog": 0.02, "run": 0.02,
    "stairs_up": 0.03, "stairs_down": 0.03, "turn90_l": 0.03, "turn90_r": 0.03, "turn180_l": 0.03, "turn180_r": 0.03,
    "start_l": 0.05, "start_r": 0.05, "stop_l": 0.05, "stop_r": 0.05,
    "idle": 0.01, "escalator_stand": 0.01,
}
STANCE_HEIGHT_M = 0.02
STANCE_SPEED_MPS = 0.05
HEIGHT_RANGE_M = (1.62, 1.72)
DERIVED_LICENCE = "LicenseRef-Quaternius-UAL-CC0-archive"
ORIGINAL_LICENCE = "CC-BY-4.0"

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
FORMATS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
NORMALIZERS = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}
IDENTITY = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.]
JPEG_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


# ---- maths -----------------------------------------------------------------------------------------------------------

def number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def vector(value, size):
    if not isinstance(value, list) or len(value) != size or not all(number(x) for x in value):
        raise ValueError(f"expected a {size}-component numeric array")
    return [float(x) for x in value]


def multiply(a, b):
    """Column-major glTF matrices; multiply parent by child."""
    return [sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4)) for col in range(4) for row in range(4)]


def transform(matrix, point):
    return [sum(matrix[k * 4 + row] * point[k] for k in range(3)) + matrix[12 + row] for row in range(3)]


def trs_matrix(t, r, s):
    x, y, z, w = r
    matrix = [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
              2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
              2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
              t[0], t[1], t[2], 1]
    for col in range(3):
        for row in range(3):
            matrix[col * 4 + row] *= s[col]
    return matrix


def quat_normalize(q):
    length = math.sqrt(sum(c * c for c in q))
    if length < 1e-12:
        raise ValueError("zero-length rotation quaternion")
    return [c / length for c in q]


def quat_angle_deg(a, b):
    """Angle between two orientations, in degrees (q and -q are the same orientation)."""
    dot = abs(sum(x * y for x, y in zip(quat_normalize(a), quat_normalize(b))))
    return math.degrees(2 * math.acos(min(1.0, dot)))


def slerp(a, b, u):
    a, b = quat_normalize(a), quat_normalize(b)
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b, dot = [-c for c in b], -dot
    if dot > 0.9995:
        return quat_normalize([x + (y - x) * u for x, y in zip(a, b)])
    theta = math.acos(dot)
    sa, sb = math.sin((1 - u) * theta) / math.sin(theta), math.sin(u * theta) / math.sin(theta)
    return [x * sa + y * sb for x, y in zip(a, b)]


def sample(track, t):
    """Value of a LINEAR track (times, values, is_rotation) at time t, clamped at both ends."""
    times, values, rotation = track
    if t <= times[0]:
        return list(values[0])
    if t >= times[-1]:
        return list(values[-1])
    i = bisect.bisect_right(times, t) - 1
    u = (t - times[i]) / (times[i + 1] - times[i])
    if rotation:
        return slerp(values[i], values[i + 1], u)
    return [x + (y - x) * u for x, y in zip(values[i], values[i + 1])]


# ---- GLB storage -----------------------------------------------------------------------------------------------------

def parse_glb(data):
    if len(data) < 20:
        raise ValueError("truncated GLB header/chunks")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("invalid GLB magic, version or declared length")
    chunks = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("truncated chunk header")
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValueError("invalid chunk alignment or length")
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ValueError("first chunk must be JSON")
    bins = [chunk for kind, chunk in chunks[1:] if kind == 0x004E4942]
    if len(bins) > 1:
        raise ValueError("more than one BIN chunk")
    doc = json.loads(chunks[0][1].decode("utf-8"))
    if not isinstance(doc, dict) or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("asset.version must be 2.0")
    return doc, bins[0] if bins else b""


def item(items, index):
    if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(items):
        raise ValueError(f"invalid array index {index!r}")
    return items[index]


def material_texture_images(material, textures):
    """Yield (material slot, image index) pairs for textures referenced by a material."""
    pbr = material.get("pbrMetallicRoughness", {})
    for slot, texture in (
        ("base-colour", pbr.get("baseColorTexture")),
        ("metallic-roughness", pbr.get("metallicRoughnessTexture")),
        ("occlusion", material.get("occlusionTexture")),
        ("normal", material.get("normalTexture")),
        ("emissive", material.get("emissiveTexture")),
    ):
        if texture is not None:
            image = item(textures, texture["index"]).get("source")
            if image is not None:
                yield slot, image


class Store:
    """Reads accessors (dense, zero-filled or sparse) and buffer views out of one GLB."""

    def __init__(self, doc, binary):
        self.doc, self.binary = doc, binary
        self.accessors = doc.get("accessors", [])
        self.views = doc.get("bufferViews", [])

    def view_bytes(self, index):
        view = item(self.views, index)
        start = view.get("byteOffset", 0)
        end = start + view["byteLength"]
        if view.get("buffer", 0) != 0 or start < 0 or end > len(self.binary):
            raise ValueError("bufferView outside the embedded buffer")
        return self.binary[start:end]

    def _elements(self, view_index, offset, count, fmt, stride=None):
        data = self.view_bytes(view_index)
        size = struct.calcsize(fmt)
        stride = stride or size
        if offset < 0 or count and offset + (count - 1) * stride + size > len(data):
            raise ValueError("accessor exceeds its bufferView")
        return [struct.unpack_from(fmt, data, offset + i * stride) for i in range(count)]

    def read(self, index):
        accessor = item(self.accessors, index)
        kind, ctype, count = accessor["type"], accessor["componentType"], accessor["count"]
        if kind not in COMPONENTS or ctype not in FORMATS or not isinstance(count, int) or count < 1:
            raise ValueError(f"accessor {index} has an unsupported type")
        fmt = "<" + FORMATS[ctype] * COMPONENTS[kind]
        if "bufferView" in accessor:
            view = item(self.views, accessor["bufferView"])
            values = self._elements(accessor["bufferView"], accessor.get("byteOffset", 0), count, fmt,
                                    view.get("byteStride"))
        else:
            values = [(0,) * COMPONENTS[kind]] * count
        if "sparse" in accessor:
            sparse = accessor["sparse"]
            indices = self._elements(sparse["indices"]["bufferView"], sparse["indices"].get("byteOffset", 0),
                                     sparse["count"], "<" + FORMATS[sparse["indices"]["componentType"]])
            replacements = self._elements(sparse["values"]["bufferView"], sparse["values"].get("byteOffset", 0),
                                          sparse["count"], fmt)
            values = list(values)
            for (i,), value in zip(indices, replacements):
                if not 0 <= i < count:
                    raise ValueError(f"accessor {index} has a sparse index out of range")
                values[i] = value
        if accessor.get("normalized") and ctype in NORMALIZERS:
            values = [tuple(max(c / NORMALIZERS[ctype], -1.0) for c in value) for value in values]
        return [tuple(float(c) for c in value) for value in values]


def image_size(raw):
    """(width, height) of a PNG or JPEG."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n" and len(raw) >= 24 and raw[12:16] == b"IHDR":
        return struct.unpack(">II", raw[16:24])
    if raw[:2] == b"\xff\xd8":
        i = 2
        while i + 4 <= len(raw):
            if raw[i] != 0xFF:
                break
            marker = raw[i + 1]
            if marker == 0xFF:
                i += 1
                continue
            if marker == 0x01 or 0xD0 <= marker <= 0xD9:
                i += 2
                continue
            length = struct.unpack(">H", raw[i + 2:i + 4])[0]
            if marker in JPEG_SOF and i + 9 <= len(raw):
                height, width = struct.unpack(">HH", raw[i + 5:i + 9])
                return width, height
            i += 2 + length
    raise ValueError("image is neither a readable PNG nor JPEG")


# ---- the validator ---------------------------------------------------------------------------------------------------

class Validator:
    def __init__(self, name, data, tier, drift_gate=True, required_clips=None):
        if tier not in TIERS:
            raise ValueError(f"unknown tier {tier!r}")
        self.name, self.data, self.tier = name, data, tier
        self.drift_gate = drift_gate  # False: check 9 is measured and reported, but its limits only warn
        self.required_clips = set(CLIPS if required_clips is None else required_clips)
        self.result = dict(file=name, tier=tier, bytes=len(data), triangles=0, primitives=0, texture_gpu_bytes=0,
                           images=[], joint_count=0, parents={}, mesh_top_m=None, clips={}, messages=[])

    def message(self, level, check, text):
        self.result["messages"].append(dict(level=level, check=check, message=text))

    def fail(self, check, text):
        self.message("FAIL", check, text)

    def warn(self, check, text):
        self.message("WARN", check, text)

    def check(self):
        try:
            self._check()
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error, OverflowError,
                RecursionError, ZeroDivisionError) as error:
            self.fail(0, f"malformed GLB: {error}")
        self.result["messages"].sort(key=lambda m: m["check"])
        levels = {m["level"] for m in self.result["messages"]}
        self.result["status"] = "FAIL" if "FAIL" in levels else "WARN" if "WARN" in levels else "PASS"
        return self.result

    def _check(self):
        doc, binary = parse_glb(self.data)
        self.doc, self.store = doc, Store(doc, binary)
        self.nodes = doc.get("nodes", [])
        self.parents = {}
        for index, node in enumerate(self.nodes):
            for child in node.get("children", []):
                item(self.nodes, child)
                if child in self.parents:
                    raise ValueError(f"node {child} has two parents")
                self.parents[child] = index
        root, character_id, vis = self.check_tree()
        joints = self.check_skin(character_id)
        self.check_skinning(vis, joints)
        self.check_morphs(vis)
        self.check_materials()
        self.check_budgets(vis)
        clips = self.check_clips(joints)
        meta = self.check_metadata(root, character_id, vis, clips)
        self.check_drift(joints, meta, clips)

    # -- 1. node tree --

    def check_tree(self):
        scenes = self.doc.get("scenes", [])
        roots = item(scenes, self.doc.get("scene", 0)).get("nodes", []) if scenes else []
        if len(roots) != 1:
            self.fail(1, f"the scene must have exactly one root node, found {len(roots)}")
            if not roots:
                raise ValueError("no root node")
        root = item(self.nodes, roots[0])
        character_id = root.get("name", "")
        if not character_id:
            self.fail(1, "the root node has no name (it must be the character id)")
        if any(abs(a - b) > 1e-6 for a, b in zip(self.local(roots[0], None), IDENTITY)):
            self.fail(1, "the root node must be at identity")
        children = {item(self.nodes, c).get("name"): c for c in root.get("children", [])}
        if f"ARM_{character_id}" not in children:
            self.fail(1, f"no ARM_{character_id} armature node under the root")
        vis = {}
        for index, node in enumerate(self.nodes):
            name = node.get("name", "")
            if name.startswith("VIS_") and name not in VIS_NAMES:
                self.fail(1, f"{name!r} is not a §2 node (only {', '.join(VIS_NAMES)})")
            elif name in VIS_NAMES:
                if name in vis:
                    self.fail(1, f"more than one {name} node")
                vis[name] = index
                if self.parents.get(index) != roots[0]:
                    self.fail(1, f"{name} must be a child of the root")
            if "mesh" in node and name not in VIS_NAMES:
                self.fail(1, f"mesh node {name!r} is outside §2 (only VIS_body and VIS_head; no collision meshes)")
            if any(s < 0 for s in node.get("scale", [1, 1, 1])):
                self.fail(1, f"node {name!r} has a negative scale")
        for name in VIS_NAMES:
            if name not in vis:
                self.fail(1, f"no {name} node")
        return roots[0], character_id, vis

    # -- 2. skin --

    def check_skin(self, character_id):
        skins = self.doc.get("skins", [])
        if len(skins) != 1:
            self.fail(2, f"there must be exactly one skin, found {len(skins)}")
            if not skins:
                return {}
        indices = skins[0]["joints"]
        names = [item(self.nodes, j).get("name", "") for j in indices]
        self.result["joint_count"] = count = len(names)
        if not JOINT_MIN <= count <= JOINT_MAX:
            self.fail(2, f"joint count {count} is outside {JOINT_MIN}-{JOINT_MAX}")
        elif count > JOINT_WARN:
            self.warn(2, f"joint count {count} is above {JOINT_WARN}")
        joints = dict(zip(names, indices))
        if len(joints) != count:
            self.fail(2, "joint names repeat in the skin")
        missing = [name for name in JOINT_PARENTS if name not in joints]
        unknown = [name for name in names if name not in JOINT_PARENTS]
        if missing:
            self.fail(2, f"§3 joints missing: {', '.join(missing)}")
        if unknown:
            self.fail(2, f"joint names outside §3: {', '.join(unknown)}")
        arm = f"ARM_{character_id}"
        moved = []
        for name, index in joints.items():
            parent = self.parents.get(index)
            parent_name = item(self.nodes, parent).get("name") if parent is not None else None
            self.result["parents"][name] = parent_name
            if name not in JOINT_PARENTS:
                continue
            expected = JOINT_PARENTS[name] or arm
            if parent_name != expected:
                moved.append(f"{name} under {parent_name} (expected {expected})")
        if "root" in joints and self.result["parents"].get("root") != arm:
            self.fail(2, f"the root joint must be a direct child of {arm}")
        if moved:
            self.fail(2, f"joint parents differ from the UE mannequin chain: {'; '.join(moved)}")
        return joints

    # -- 3. skin attributes --

    def check_skinning(self, vis, joints):
        joint_count = len(joints)
        for name, index in vis.items():
            node = self.nodes[index]
            if node.get("skin") != 0:
                self.fail(3, f"{name} is not bound to the skin")
            mesh = item(self.doc.get("meshes", []), node["mesh"]) if "mesh" in node else {}
            for p, primitive in enumerate(mesh.get("primitives", [])):
                attributes = primitive.get("attributes", {})
                extra = sorted(key for key in attributes if key.startswith(("JOINTS_", "WEIGHTS_"))
                               and key not in ("JOINTS_0", "WEIGHTS_0"))
                if extra:
                    self.fail(3, f"{name} primitive {p} has {', '.join(extra)} (only JOINTS_0 and WEIGHTS_0)")
                self.read_finite(attributes.get("POSITION"), f"{name} primitive {p} POSITION")
                if "JOINTS_0" not in attributes or "WEIGHTS_0" not in attributes:
                    self.fail(3, f"{name} primitive {p} lacks JOINTS_0/WEIGHTS_0")
                    continue
                joint_rows = self.store.read(attributes["JOINTS_0"])
                weight_rows = self.store.read(attributes["WEIGHTS_0"])
                self.check_weights(f"{name} primitive {p}", joint_rows, weight_rows, joint_count)

    def read_finite(self, accessor, label):
        """Read numeric accessor data and explicitly reject NaN/inf before metrics consume it."""
        if accessor is None:
            return None
        values = self.store.read(accessor)
        if any(not math.isfinite(component) for row in values for component in row):
            self.fail(3, f"{label} contains a non-finite value")
            return None
        return values

    def check_weights(self, label, joint_rows, weight_rows, joint_count):
        if len(joint_rows) != len(weight_rows):
            self.fail(3, f"{label}: JOINTS_0 and WEIGHTS_0 have different counts")
            return
        bad_sum = negative = outside = non_finite = 0
        worst = 0.0
        for joints_, weights in zip(joint_rows, weight_rows):
            if any(not math.isfinite(w) for w in weights):
                non_finite += 1
                continue
            total = sum(weights)
            worst = max(worst, abs(total - 1))
            bad_sum += abs(total - 1) > 1e-3
            negative += any(w < 0 for w in weights)
            outside += any(w > 0 and not 0 <= int(j) < joint_count for j, w in zip(joints_, weights))
        if bad_sum:
            self.fail(3, f"{label}: {bad_sum} vertices have a weight sum outside 1 ± 1e-3 (worst off by {worst:.4g})")
        if negative:
            self.fail(3, f"{label}: {negative} vertices have a negative weight")
        if outside:
            self.fail(3, f"{label}: {outside} vertices are weighted to a joint not in the skin")
        if non_finite:
            self.fail(3, f"{label}: {non_finite} vertices have non-finite WEIGHTS_0 values")

    # -- 4. morphs --

    def check_morphs(self, vis):
        meshes = self.doc.get("meshes", [])
        head_mesh = self.nodes[vis["VIS_head"]].get("mesh") if "VIS_head" in vis else None
        for m, mesh in enumerate(meshes):
            names = mesh.get("extras", {}).get("targetNames", [])
            targets = [primitive.get("targets", []) for primitive in mesh.get("primitives", [])]
            if m == head_mesh:
                if names != BLINKS:
                    self.fail(4, f"VIS_head targetNames must be exactly {BLINKS}, got {names!r}")
                if any(len(t) != len(BLINKS) for t in targets):
                    self.fail(4, f"every VIS_head primitive must carry exactly {len(BLINKS)} morph targets")
            elif names or any(targets):
                self.fail(4, f"mesh {mesh.get('name', m)!r} carries morph targets (only VIS_head may)")
            for primitive_targets in targets:
                for target in primitive_targets:
                    if "POSITION" not in target:
                        self.fail(4, f"a morph target of mesh {mesh.get('name', m)!r} lacks POSITION")
                    other = sorted(set(target) - MORPH_ATTRIBUTES)
                    if other:
                        self.fail(4, f"a morph target of mesh {mesh.get('name', m)!r} carries {', '.join(other)} "
                                     "(only POSITION and NORMAL)")

    # -- 5. materials --

    def check_materials(self):
        for key in ("extensionsUsed", "extensionsRequired"):
            for extension in self.doc.get(key, []):
                if extension in FORBIDDEN_MATERIAL_EXTENSIONS:
                    self.fail(5, f"{extension} is not allowed (opaque metal-rough only)")
                elif extension not in ALLOWED_EXTENSIONS:
                    self.fail(5, f"extension outside the baseline ({key}): {extension}")
        for material in self.doc.get("materials", []):
            name = material.get("name", "?")
            if material.get("alphaMode", "OPAQUE") != "OPAQUE":
                self.fail(5, f"material {name!r} alphaMode is {material['alphaMode']} (only OPAQUE)")
            if self.tier == "mobile":
                pbr = material.get("pbrMetallicRoughness", {})
                if pbr.get("metallicRoughnessTexture") is not None:
                    self.fail(5, f"mobile material {name!r} carries a metallicRoughnessTexture (base colour only)")
                if material.get("occlusionTexture") is not None:
                    self.fail(5, f"mobile material {name!r} carries an occlusionTexture (base colour only)")
                if material.get("normalTexture") is not None:
                    self.fail(5, f"mobile material {name!r} carries a normalTexture (base colour only)")
                if material.get("emissiveTexture") is not None:
                    self.fail(5, f"mobile material {name!r} carries an emissiveTexture (base colour only)")
            for extension in material.get("extensions", {}):
                if extension in FORBIDDEN_MATERIAL_EXTENSIONS:
                    self.fail(5, f"material {name!r} uses {extension}")
                elif extension not in ALLOWED_EXTENSIONS:
                    self.fail(5, f"material {name!r} uses an extension outside the baseline: {extension}")
        for i, image in enumerate(self.doc.get("images", [])):
            if image.get("mimeType") not in ("image/png", "image/jpeg"):
                self.fail(5, f"image {i} is {image.get('mimeType')!r} (only uncompressed PNG or JPEG)")

    # -- 6. budgets --

    def image_bytes(self, image):
        if "bufferView" in image:
            return self.store.view_bytes(image["bufferView"])
        uri = image.get("uri", "")
        if uri.startswith("data:"):
            return base64.b64decode(uri.split(",", 1)[1], validate=True)
        raise ValueError("canonical GLB images must be embedded")

    def check_budgets(self, vis):
        limits = TIERS[self.tier]
        image_sizes = []
        for index in vis.values():
            node = self.nodes[index]
            mesh = item(self.doc.get("meshes", []), node["mesh"]) if "mesh" in node else {}
            for primitive in mesh.get("primitives", []):
                self.result["primitives"] += 1
                source = primitive["indices"] if "indices" in primitive else primitive["attributes"]["POSITION"]
                count = item(self.store.accessors, source)["count"]
                mode = primitive.get("mode", 4)
                self.result["triangles"] += count // 3 if mode == 4 else max(count - 2, 0) if mode in (5, 6) else 0
        if self.result["triangles"] > limits["triangles"]:
            self.fail(6, f"{self.result['triangles']} triangles is over the {self.tier} limit of {limits['triangles']}")
        if self.result["primitives"] > limits["primitives"]:
            self.fail(6, f"{self.result['primitives']} primitives is over the limit of {limits['primitives']}")
        for i, image in enumerate(self.doc.get("images", [])):
            width, height = image_size(self.image_bytes(image))
            image_sizes.append((width, height))
            gpu = int(width * height * 4 * 4 / 3)
            self.result["images"].append(dict(index=i, width=width, height=height, gpu_bytes=gpu))
            self.result["texture_gpu_bytes"] += gpu
            if max(width, height) > limits["max_texture"]:
                self.fail(6, f"image {i} is {width}x{height}, over the {self.tier} size of {limits['max_texture']}²")
        for name, index in vis.items():
            max_size = limits["mesh_texture"].get(name)
            if max_size is None:
                continue
            mesh = item(self.doc.get("meshes", []), self.nodes[index]["mesh"])
            for primitive in mesh.get("primitives", []):
                material_index = primitive.get("material")
                if material_index is None:
                    continue
                material = item(self.doc.get("materials", []), material_index)
                for slot, source in material_texture_images(material, self.doc.get("textures", [])):
                    if self.tier == "mobile" and slot != "base-colour":
                        continue
                    width, height = item(image_sizes, source)
                    if max(width, height) > max_size:
                        self.fail(6, f"{name} {slot} image is {width}x{height}, over the {self.tier} size of {max_size}²")
        if self.result["texture_gpu_bytes"] > limits["texture_gpu_bytes"]:
            self.fail(6, f"texture GPU bytes {self.result['texture_gpu_bytes']} are over the {self.tier} limit of "
                         f"{limits['texture_gpu_bytes']}")
        size = len(self.data)
        if limits["file_fail"] is not None and size > limits["file_fail"]:
            self.fail(6, f"the {self.tier} file is {size} bytes, over the hard cap of {limits['file_fail']}")
        elif limits["file_warn"] is not None and size > limits["file_warn"]:
            self.warn(6, f"the {self.tier} file is {size} bytes, over the {limits['file_warn']}-byte budget")

    # -- 7. clips --

    def check_clips(self, joints):
        """Per clip: duration, frame count and the tracks by node, for checks 8 and 9."""
        joint_nodes = {index: name for name, index in joints.items()}
        animations = self.doc.get("animations", [])
        names = [animation.get("name", "") for animation in animations]
        missing = [name for name in CLIPS if name in self.required_clips and name not in names]
        unknown = [name for name in names if name not in CLIPS]
        if missing:
            self.fail(7, f"required §6 clips missing: {', '.join(missing)}")
        if unknown:
            self.fail(7, f"unknown clips: {', '.join(repr(n) for n in unknown)}")
        if len(set(names)) != len(names):
            self.fail(7, "clip names repeat")
        clips = {}
        for animation in animations:
            name = animation.get("name", "")
            clip = self.check_clip(name, animation, joint_nodes)
            if clip is not None:
                clips[name] = clip
        return clips

    def check_clip(self, name, animation, joint_nodes):
        samplers = animation.get("samplers", [])
        tracks, ends, problems = {}, [], set()
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            path, node = target.get("path"), target.get("node")
            node_name = item(self.nodes, node).get("name", "") if node is not None else None
            if path == "weights":
                problems.add("a morph-weight channel")
                continue
            if node_name == "root":
                problems.add("a channel on root")
            if node is not None and node not in joint_nodes:
                problems.add(f"a channel on {node_name!r}, which is not a skin joint")
            if path == "scale":
                problems.add("a scale channel")
                continue
            if path == "translation" and node_name != "pelvis":
                problems.add(f"a translation channel on {node_name!r}")
            sampler = item(samplers, channel["sampler"])
            interpolation = sampler.get("interpolation", "LINEAR")
            if interpolation != "LINEAR":
                problems.add(f"{interpolation} interpolation")
            input_values = self.read_finite(sampler["input"], f"clip {name!r} sampler input")
            output_values = self.read_finite(sampler["output"], f"clip {name!r} sampler output")
            if input_values is None or output_values is None:
                continue
            times = [t for (t,) in input_values]
            values = output_values
            if interpolation == "CUBICSPLINE":
                values = values[1::3]
            if len(times) < 2 or len(values) != len(times):
                problems.add(f"a channel with {len(times)} keys")
                continue
            if abs(times[0]) > TIME_TOLERANCE_S or any(abs(b - a - 1 / FPS) > TIME_TOLERANCE_S
                                                       for a, b in zip(times, times[1:])):
                problems.add(f"a sample rate other than {FPS} fps")
            ends.append(times[-1])
            if node is not None and path in ("rotation", "translation"):
                tracks.setdefault(node, {})[path] = (times, values, path == "rotation")
        for problem in sorted(problems):
            self.fail(7, f"clip {name!r} has {problem}")
        if not ends:
            self.fail(7, f"clip {name!r} has no animated joints")
            return None
        duration = max(ends)
        if max(ends) - min(ends) > TIME_TOLERANCE_S:
            self.fail(7, f"clip {name!r} channels end at different times ({min(ends):.4f}-{max(ends):.4f} s)")
        report = dict(duration_s=round(duration, 6), frames=round(duration * FPS), channels=len(animation["channels"]))
        report.update(self.pelvis_drift(name, tracks, joint_nodes))
        report.update(self.loop_pop(name, tracks, joint_nodes))
        self.result["clips"][name] = report
        return dict(duration=duration, frames=round(duration * FPS), tracks=tracks)

    def pelvis_drift(self, name, tracks, joint_nodes):
        pelvis = next((n for n, joint in joint_nodes.items() if joint == "pelvis"), None)
        track = tracks.get(pelvis, {}).get("translation")
        if track is None:
            return dict(pelvis_forward_drift_m=0.0)
        drift = track[1][-1][2] - track[1][0][2]
        if abs(drift) > PELVIS_DRIFT_M:
            self.fail(7, f"clip {name!r} pelvis net forward drift is {drift * 100:.2f} cm (limit 1 cm)")
        return dict(pelvis_forward_drift_m=round(drift, 6))

    def loop_pop(self, name, tracks, joint_nodes):
        if CLIPS.get(name, ("one-shot",))[0] != "cycle":
            return {}
        worst, joint = 0.0, None
        for node, paths in tracks.items():
            if "rotation" in paths:
                values = paths["rotation"][1]
                angle = quat_angle_deg(values[0], values[-1])
                if angle > worst:
                    worst, joint = angle, joint_nodes.get(node, item(self.nodes, node).get("name"))
        if worst > LOOP_POP_DEG:
            self.fail(7, f"cycle {name!r} pops {worst:.3f}° at the loop on {joint} (limit {LOOP_POP_DEG}°)")
        pelvis_node = next((node for node, joint_name in joint_nodes.items() if joint_name == "pelvis"), None)
        pelvis_translation = tracks.get(pelvis_node, {}).get("translation")
        translation_pop = (max(abs(a - b) for a, b in zip(pelvis_translation[1][0], pelvis_translation[1][-1]))
                           if pelvis_translation else 0.0)
        if translation_pop > LOOP_POP_TRANSLATION_M:
            self.fail(7, f"cycle {name!r} pelvis translation pops {translation_pop * 1000:.3f} mm at the loop "
                         f"(limit {LOOP_POP_TRANSLATION_M * 1000:.0f} mm per axis)")
        return dict(loop_pop_deg=round(worst, 4), loop_pop_joint=joint,
                    loop_pop_translation_m=round(translation_pop, 6))

    # -- 8. metadata --

    def check_metadata(self, root, character_id, vis, clips):
        meta = self.nodes[root].get("extras", {}).get("gteki_character")
        if not isinstance(meta, dict):
            self.fail(8, "root extras.gteki_character is missing")
            return {}
        expected = dict(contract=CONTRACT, id=character_id, tier=self.tier, forward="-Z")
        for key, value in expected.items():
            if meta.get(key) != value:
                self.fail(8, f"extras.gteki_character.{key} must be {value!r}, got {meta.get(key)!r}")
        height = meta.get("height_m")
        if not number(height) or not HEIGHT_RANGE_M[0] <= height <= HEIGHT_RANGE_M[1]:
            self.fail(8, f"height_m must be within {HEIGHT_RANGE_M[0]}-{HEIGHT_RANGE_M[1]} m, got {height!r}")
        else:
            self.check_height(vis, height)
        feet = meta.get("feet")
        try:
            meta["feet"] = {side: {point: vector(feet[side][point], 3) for point in ("heel", "ball")}
                            for side in ("l", "r")}
        except (KeyError, TypeError, ValueError):
            self.fail(8, "feet must give l and r heel and ball offsets as [x, y, z]")
            meta["feet"] = None
        entries = meta.get("clips")
        if not isinstance(entries, dict):
            self.fail(8, "extras.gteki_character.clips is missing")
            meta["clips"] = {}
            return meta
        for name in sorted(set(clips) - set(entries)):
            self.fail(8, f"clip {name!r} has no metadata")
        for name in sorted(set(entries) - set(clips)):
            self.fail(8, f"metadata names clip {name!r}, which the file does not carry")
        for name, entry in entries.items():
            if not isinstance(entry, dict):
                self.fail(8, f"clip {name!r} metadata must be an object")
                continue
            self.check_clip_meta(name, entry, clips.get(name))
        return meta

    def check_height(self, vis, height):
        top = -math.inf
        for index in vis.values():
            node = self.nodes[index]
            mesh = item(self.doc.get("meshes", []), node["mesh"]) if "mesh" in node else {}
            for primitive in mesh.get("primitives", []):
                accessor = item(self.store.accessors, primitive["attributes"]["POSITION"])
                if "min" in accessor and "max" in accessor:
                    world = self.world(index, None, {})
                    for corner in ([x, y, z] for x in (accessor["min"][0], accessor["max"][0])
                                   for y in (accessor["min"][1], accessor["max"][1])
                                   for z in (accessor["min"][2], accessor["max"][2])):
                        top = max(top, transform(world, corner)[1])
        if math.isfinite(top):
            self.result["mesh_top_m"] = round(top, 4)
            if abs(top - height) > 0.01:
                self.warn(8, f"height_m {height} differs from the bind-pose mesh top {top:.3f} m by more than 1 cm")

    def check_clip_meta(self, name, entry, clip):
        kind, speed = CLIPS.get(name, (None, None))
        if kind is not None and entry.get("kind") != kind:
            self.fail(8, f"clip {name!r} kind must be {kind!r}, got {entry.get('kind')!r}")
        duration = entry.get("duration_s")
        if not number(duration) or duration <= 0:
            self.fail(8, f"clip {name!r} duration_s must be a positive number")
            duration = None
        elif clip is not None and abs(duration - clip["duration"]) > 0.01 * clip["duration"]:
            self.fail(8, f"clip {name!r} duration_s {duration} differs from the clip's {clip['duration']:.4f} s by over 1 %")
        calib = entry.get("calib_speed_mps")
        if not number(calib) or calib < 0:
            self.fail(8, f"clip {name!r} calib_speed_mps must be a non-negative number")
            calib = None
        elif speed is not None and abs(calib - speed) > 1e-6:
            self.fail(8, f"clip {name!r} calib_speed_mps must be {speed}, got {calib}")
        if name.startswith(("start_", "stop_")):
            if not number(calib) or abs(calib - 1.45) > 1e-6:
                self.fail(8, f"clip {name!r} calib_speed_mps must be 1.45")
            self.check_speed_profile(name, entry.get("speed_profile"))
        distance = entry.get("distance_per_cycle_m")
        if kind == "cycle" and distance is None:
            self.fail(8, f"cycle {name!r} lacks distance_per_cycle_m")
        if distance is not None and calib is not None and duration is not None:
            want = calib * duration
            if not number(distance) or abs(distance - want) > max(0.01 * want, 1e-6):
                self.fail(8, f"clip {name!r} distance_per_cycle_m {distance!r} is not calib_speed_mps x duration_s "
                             f"({want:.4f}) within 1 %")
        self.check_contacts(name, entry.get("contacts"), kind, clip)
        self.check_provenance(name, entry.get("provenance"))
        if name in TURN_YAW and (not number(entry.get("yaw_deg")) or abs(entry["yaw_deg"] - TURN_YAW[name]) > 1):
            self.fail(8, f"turn {name!r} must record yaw_deg {TURN_YAW[name]:+.0f} ±1°, got {entry.get('yaw_deg')!r}")
        if name.startswith("stairs_"):
            for key, value in STAIRS.items():
                if not number(entry.get(key)) or abs(entry[key] - value) > 1e-6:
                    self.fail(8, f"stairs {name!r} must record {key} {value}, got {entry.get(key)!r}")

    def check_speed_profile(self, name, profile):
        if (not isinstance(profile, list) or len(profile) < 2 or
                any(not isinstance(pair, list) or len(pair) != 2 or not all(number(v) for v in pair)
                    for pair in profile)):
            self.fail(8, f"clip {name!r} speed_profile must be a list of [u, mps] pairs")
            return
        times = [pair[0] for pair in profile]
        speeds = [pair[1] for pair in profile]
        if abs(times[0]) > 1e-6 or abs(times[-1] - 1) > 1e-6 or any(b <= a for a, b in zip(times, times[1:])):
            self.fail(8, f"clip {name!r} speed_profile u must rise strictly from 0 to 1")
        if any(speed < 0 for speed in speeds):
            self.fail(8, f"clip {name!r} speed_profile mps values must be non-negative")
        expected = (0.0, 1.45) if name.startswith("start_") else (1.45, 0.0)
        if abs(speeds[0] - expected[0]) > 1e-3 or abs(speeds[-1] - expected[1]) > 1e-3:
            self.fail(8, f"clip {name!r} speed_profile must begin at {expected[0]} and end at {expected[1]} ±1e-3")

    @staticmethod
    def profile_distance(profile, u, duration):
        """Integrate a piecewise-linear speed profile over normalized clip time."""
        distance, end = 0.0, min(max(u, 0.0), 1.0)
        for (u0, v0), (u1, v1) in zip(profile, profile[1:]):
            span = min(end, u1) - u0
            if span <= 0:
                break
            span = min(span, u1 - u0)
            vend = v0 + (v1 - v0) * span / (u1 - u0)
            distance += (v0 + vend) * 0.5 * span * duration
            if end <= u1:
                break
        return distance

    def check_contacts(self, name, contacts, kind, clip):
        if not isinstance(contacts, dict):
            self.fail(8, f"clip {name!r} contact windows are missing")
            return
        frame = 1 / clip["frames"] if clip and clip["frames"] else 0.0
        for side in ("l", "r"):
            windows = contacts.get(side)
            if not isinstance(windows, list) or not windows:
                self.fail(8, f"clip {name!r} has no {side} contact windows")
                continue
            for window in windows:
                if (not isinstance(window, list) or len(window) != 2 or not all(number(x) for x in window)
                        or not 0 <= window[0] < 1 or not window[0] < window[1] <= window[0] + 1
                        or (kind != "cycle" and window[1] > 1)):
                    self.fail(8, f"clip {name!r} {side} contact window {window!r} is not [start, end] in normalised "
                                 "time (a one-shot's may not wrap past 1.0)")
        if kind == "cycle" and frame:
            for side, start in (("l", 0.0), ("r", 0.5)):
                windows = [w for w in contacts.get(side) or [] if isinstance(w, list) and w and number(w[0])]
                if not any(abs(w[0] - start) <= frame + 1e-9 for w in windows):
                    self.fail(8, f"cycle {name!r} {side} contact must start at {start} (± 1 frame)")

    def check_provenance(self, name, provenance):
        if not isinstance(provenance, dict):
            self.fail(8, f"clip {name!r} provenance is missing")
            return
        for key in ("author", "licence", "source"):
            if not isinstance(provenance.get(key), str) or not provenance[key].strip():
                self.fail(8, f"clip {name!r} provenance.{key} is missing")
        source = provenance.get("source")
        if source not in ("original", "derived"):
            self.fail(8, f"clip {name!r} provenance.source must be 'original' or 'derived', got {source!r}")
        derived = provenance.get("derived_from")
        if source == "derived":
            if not isinstance(derived, dict) or not derived.get("archive_sha256") or not derived.get("clip"):
                self.fail(8, f"derived clip {name!r} needs derived_from with archive_sha256 and clip")
            if provenance.get("licence") != DERIVED_LICENCE:
                self.fail(8, f"derived clip {name!r} licence must be {DERIVED_LICENCE}")
        elif source == "original":
            if derived is not None:
                self.fail(8, f"original clip {name!r} must not carry derived_from")
            if provenance.get("licence") != ORIGINAL_LICENCE:
                self.fail(8, f"original clip {name!r} licence must be {ORIGINAL_LICENCE}")

    # -- 9. offline foot drift --

    def local(self, index, tracks, t=0.0):
        node = self.nodes[index]
        animated = (tracks or {}).get(index, {})
        if "matrix" in node:
            if animated:
                raise ValueError(f"node {index} is animated but uses a matrix")
            return [float(x) for x in vector(node["matrix"], 16)]
        translation = sample(animated["translation"], t) if "translation" in animated else node.get("translation", [0, 0, 0])
        rotation = sample(animated["rotation"], t) if "rotation" in animated else node.get("rotation", [0, 0, 0, 1])
        return trs_matrix(vector(list(translation), 3), quat_normalize(vector(list(rotation), 4)),
                          vector(node.get("scale", [1, 1, 1]), 3))

    def world(self, index, tracks, cache, t=0.0):
        if index not in cache:
            parent = self.parents.get(index)
            local = self.local(index, tracks, t)
            cache[index] = local if parent is None else multiply(self.world(parent, tracks, cache, t), local)
        return cache[index]

    def glide(self, name, entry, calib):
        """Velocity (m/s) of a planted foot under the ideal in-place motion: +Z, or along the stair slope."""
        if name.startswith("stairs_"):
            # §6 defines stair calibration speed along the stair slope.
            riser = entry.get("riser_m") if number(entry.get("riser_m")) else STAIRS["riser_m"]
            tread = entry.get("tread_m") if number(entry.get("tread_m")) else STAIRS["tread_m"]
            length = math.hypot(riser, tread)
            down = -1 if name == "stairs_up" else 1
            return [0.0, down * calib * riser / length, calib * tread / length]
        return [0.0, 0.0, calib]

    def check_drift(self, joints, meta, clips):
        level = self.fail if self.drift_gate else self.warn
        feet = meta.get("feet")
        refs = {side: (joints.get(f"foot_{side}"), joints.get(f"ball_{side}")) for side in ("l", "r")}
        if not feet or any(None in pair for pair in refs.values()):
            self.warn(9, "foot drift not measured: the feet metadata or the foot/ball joints are missing")
            return
        for name, clip in clips.items():
            entry = meta.get("clips", {}).get(name)
            if not isinstance(entry, dict) or not isinstance(entry.get("contacts"), dict) or name not in DRIFT_LIMITS_M:
                continue
            calib = entry.get("calib_speed_mps") if number(entry.get("calib_speed_mps")) else 0.0
            velocity = self.glide(name, entry, calib)
            frames = clip["frames"]
            positions = [self.foot_points(clip["tracks"], refs, feet, f / FPS) for f in range(frames + 1)]
            cycle = CLIPS[name][0] == "cycle"
            profile = entry.get("speed_profile")
            glide_positions = None
            profile_valid = (isinstance(profile, list) and len(profile) >= 2 and
                             all(isinstance(pair, list) and len(pair) == 2 and all(number(v) for v in pair)
                                 for pair in profile) and abs(profile[0][0]) <= 1e-6 and
                             abs(profile[-1][0] - 1) <= 1e-6 and
                             all(b[0] > a[0] for a, b in zip(profile, profile[1:])))
            if name.startswith(("start_", "stop_")) and profile_valid:
                glide_positions = [self.profile_distance(profile, f / frames, clip["duration"])
                                   for f in range(frames + 1)]
            drift = {}
            contact_results = {}
            for side in ("l", "r"):
                worst = 0.0
                side_results = []
                for window in entry["contacts"].get(side) or []:
                    window_drift, usable = self.window_drift(positions, side, window, frames, cycle, velocity,
                                                             glide_positions)
                    if usable < 2:
                        level(9, f"clip {name!r} {side} contact window {window!r} unmeasured: "
                              f"only {usable} usable stance sample(s)")
                        side_results.append(dict(window=window, usable_samples=usable, drift_m="unmeasured"))
                    else:
                        worst = max(worst, window_drift)
                        side_results.append(dict(window=window, usable_samples=usable,
                                                 drift_m=round(window_drift, 5)))
                drift[side] = round(worst, 5)
                contact_results[side] = side_results
            limit = DRIFT_LIMITS_M[name]
            self.result["clips"].setdefault(name, {}).update(foot_drift_m=drift, drift_limit_m=limit,
                                                             glide_mps=[round(v, 5) for v in velocity],
                                                             contact_windows=contact_results)
            for side, value in drift.items():
                if value > limit:
                    level(9, f"clip {name!r} {side} foot drifts {value * 100:.2f} cm in stance (limit {limit * 100:.0f} cm)")

    def foot_points(self, tracks, refs, feet, t):
        cache = {}
        points = {}
        for side, (foot, ball) in refs.items():
            points[side] = (transform(self.world(foot, tracks, cache, t), feet[side]["heel"]),
                            transform(self.world(ball, tracks, cache, t), feet[side]["ball"]))
        return points

    @staticmethod
    def window_drift(positions, side, window, frames, cycle, velocity, glide_positions=None):
        """Largest horizontal travel of a planted heel or ball inside one stance window, the ideal glide removed."""
        if not isinstance(window, list) or len(window) != 2 or not all(number(x) for x in window) or not frames:
            return 0.0, 0
        first, last = math.ceil(window[0] * frames - 1e-6), math.floor(window[1] * frames + 1e-6)
        if not cycle:
            last = min(last, frames)
        steps = list(range(first, last + 1))
        if not steps:
            return 0.0, 0
        planted_by_ref = []
        for ref in (0, 1):
            corrected = []
            for f in steps:
                point = positions[f % frames if cycle else f][side][ref]
                if glide_positions is not None:
                    displacement = glide_positions[f] - glide_positions[first]
                    corrected.append([point[0], point[1], point[2] - displacement])
                else:
                    elapsed = (f - first) / FPS
                    corrected.append([p - v * elapsed for p, v in zip(point, velocity)])
            floor = min(p[1] for p in corrected)
            planted = []
            for k, p in enumerate(corrected):
                neighbour = corrected[k + 1] if k + 1 < len(corrected) else corrected[k - 1] if k else p
                speed = abs(neighbour[1] - p[1]) * FPS
                if p[1] <= floor + STANCE_HEIGHT_M and speed < STANCE_SPEED_MPS:
                    planted.append((k, p))
            planted_by_ref.append(planted)
        usable = len({index for planted in planted_by_ref for index, _ in planted})
        worst = 0.0
        if usable >= 2:
            for planted in planted_by_ref:
                if len(planted) >= 2:
                    anchor = planted[0][1]
                    worst = max(worst, max(math.hypot(p[0] - anchor[0], p[2] - anchor[2]) for _, p in planted))
        return worst, usable


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--tier", required=True, choices=sorted(TIERS))
    parser.add_argument("--clips", type=parse_clips, default=tuple(CLIPS),
                        help="required §6 clip subset as comma-separated names (default: all)")
    parser.add_argument("--report", type=Path, help="write every measured value as JSON")
    parser.add_argument("--drift-advisory", action="store_true",
                        help="measure and report check 9 but only warn on its limits (the P0 sample, §8)")
    args = parser.parse_args()
    results = []
    for path in args.files:
        try:
            result = Validator(str(path), path.read_bytes(), args.tier, not args.drift_advisory,
                               required_clips=args.clips).check()
        except OSError as error:
            result = dict(file=str(path), tier=args.tier, status="FAIL",
                          messages=[dict(level="FAIL", check=0, message=str(error))])
        results.append(result)
        for message in result["messages"]:
            print(f"{message['level']} {path}: [check {message['check']}] {message['message']}")
    counts = {status: sum(r["status"] == status for r in results) for status in ("PASS", "WARN", "FAIL")}
    print(f"Summary: {len(results)} files; {counts['PASS']} PASS, {counts['WARN']} WARN, {counts['FAIL']} FAIL")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(dict(contract=CONTRACT, tier=args.tier, summary=counts, files=results),
                                          indent=2, allow_nan=False) + "\n")
    return int(counts["FAIL"] > 0)


def parse_clips(value):
    names = value.split(",")
    unknown = sorted(set(names) - set(CLIPS))
    if not value or any(not name for name in names):
        raise argparse.ArgumentTypeError("--clips must be a comma-separated list of clip names")
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown clip name(s): {', '.join(unknown)}")
    if len(set(names)) != len(names):
        raise argparse.ArgumentTypeError("--clips names must not repeat")
    return tuple(names)


if __name__ == "__main__":
    sys.exit(main())
