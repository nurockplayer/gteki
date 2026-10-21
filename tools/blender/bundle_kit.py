#!/usr/bin/env python3
"""Bundle self-contained gteki-asset/0.1 GLBs, sharing textures and materials.

Usage:
  python3 tools/blender/bundle_kit.py bundle --library assets/library --all --out kit.glb
  python3 tools/blender/bundle_kit.py bundle --library assets/library --ids a,b --out kit.glb
  python3 tools/blender/bundle_kit.py bundle --library assets/library --layout layout.json --out kit.glb
  python3 tools/blender/bundle_kit.py extract --bundle kit.glb --id a --out a.glb
  python3 tools/blender/bundle_kit.py info --bundle kit.glb
  python3 tools/blender/bundle_kit.py --self-test

Static contract assets only: skins, animations and geometry extensions carrying
additional resource indices are rejected rather than copied with stale indices.
"""
import argparse
import base64
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

# Importing the sibling validator must not create files beside the tools; the
# explicit path also works under `python3 -I` (which drops the script directory).
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_glb import (CONTRACT as ASSET_CONTRACT, IDENTITY, REQUIRED,
                          Validator, encode_glb, local_matrix, parse_glb)

CONTRACT = "gteki-kit-bundle/0.1"
# Three.js GLTFLoader and Godot's glTF importer both make node names unique across
# the whole file ("SOCKET_end" -> "SOCKET_end_1" / "SOCKET_end2"), so a name that
# repeats between bundled assets is also stored in extras.gteki_name.
NAME_KEY = "gteki_name"
GROUPS = ("bufferViews", "images", "accessors", "samplers", "textures",
          "materials", "meshes", "cameras", "nodes")
COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def texture_infos(value):
    """Find core and material-extension textureInfo objects, leaving extras alone."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "extras":
                continue
            if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                yield child
            else:
                yield from texture_infos(child)
    elif isinstance(value, list):
        for child in value:
            yield from texture_infos(child)


def references(group, item):
    """Yield (mutable container, key, resource array) for glTF index fields."""
    if group == "nodes":
        if "skin" in item or item.get("extensions"):
            raise ValueError("skins and node extensions are outside the static asset contract")
        for key, target in (("mesh", "meshes"), ("camera", "cameras")):
            if key in item:
                yield item, key, target
        for key in range(len(item.get("children", []))):
            yield item["children"], key, "nodes"
    elif group == "meshes":
        if item.get("extensions"):
            raise ValueError("mesh extensions are outside the static asset contract")
        for primitive in item["primitives"]:
            if primitive.get("extensions"):
                raise ValueError("primitive extensions are outside the static asset contract")
            for attributes in [primitive["attributes"], *primitive.get("targets", [])]:
                for key in attributes:
                    yield attributes, key, "accessors"
            for key, target in (("indices", "accessors"), ("material", "materials")):
                if key in primitive:
                    yield primitive, key, target
    elif group == "accessors":
        if item.get("extensions"):
            raise ValueError("accessor extensions are outside the static asset contract")
        if "bufferView" in item:
            yield item, "bufferView", "bufferViews"
        if "sparse" in item:
            for key in ("indices", "values"):
                yield item["sparse"][key], "bufferView", "bufferViews"
    elif group == "materials":
        for info in texture_infos(item):
            yield info, "index", "textures"
    elif group == "textures":
        if "sampler" in item:
            yield item, "sampler", "samplers"
        if "source" in item:
            yield item, "source", "images"
        # KHR_texture_basisu, EXT_texture_webp and MSFT_texture_dds alternatives.
        for extension in item.get("extensions", {}).values():
            if "source" in extension:
                yield extension, "source", "images"
    elif group == "images" and "bufferView" in item:
        yield item, "bufferView", "bufferViews"


def embedded_document(data):
    doc, binary = parse_glb(data)
    buffers = doc.get("buffers", [])
    if len(buffers) != 1 or "uri" in buffers[0]:
        raise ValueError("expected one embedded GLB buffer (no external URIs)")
    length = buffers[0]["byteLength"]
    if not 0 <= length <= len(binary) <= length + 3:
        raise ValueError("BIN size differs from buffer.byteLength")
    if doc.get("skins") or doc.get("animations") or doc.get("extensions"):
        raise ValueError("skins, animations and document extensions are outside the static asset contract")
    for view in doc.get("bufferViews", []):
        start, size = view.get("byteOffset", 0), view["byteLength"]
        if view.get("buffer") != 0 or start < 0 or size < 0 or start + size > length:
            raise ValueError("bufferView exceeds embedded buffer")
        if view.get("extensions"):
            raise ValueError("bufferView extensions are outside the static asset contract")
    return doc, binary[:length]


def image_data(doc, binary, image):
    if "uri" in image:
        uri = image["uri"]
        header, separator, payload = uri.partition(",")
        if not separator or not header.startswith("data:") or not header.endswith(";base64"):
            raise ValueError("images must be embedded bufferViews or base64 data URIs")
        return base64.b64decode(payload, validate=True)
    view = Validator.index(doc.get("bufferViews", []), image["bufferView"])
    start = view.get("byteOffset", 0)
    return binary[start:start + view["byteLength"]]


def resources(doc, root):
    """Collect only the subtree and its dependencies, preserving source array order."""
    selected = {group: set() for group in GROUPS}

    def visit(group, index):
        item = Validator.index(doc.get(group, []), index)
        if index in selected[group]:
            if group == "nodes":
                raise ValueError("node cycle or multiple parents in asset subtree")
            return
        selected[group].add(index)
        for container, key, target in references(group, item):
            visit(target, container[key])

    visit("nodes", root)
    return {group: sorted(indices) for group, indices in selected.items()}


class Builder:
    def __init__(self):
        self.doc = dict(asset=dict(version="2.0", generator="gteki bundle_kit.py"),
                        scene=0, scenes=[dict(nodes=[])])
        self.doc.update({group: [] for group in GROUPS})
        self.binary = bytearray()
        self.shared = {group: {} for group in ("images", "samplers", "textures", "materials")}
        self.named_materials = {}
        self.extensions = {key: set() for key in ("extensionsUsed", "extensionsRequired")}

    def view(self, item, payload):
        # All glTF accessor component sizes divide four (including sparse indices).
        self.binary.extend(b"\0" * (-len(self.binary) % 4))
        item = copy.deepcopy(item)
        item.update(buffer=0, byteOffset=len(self.binary), byteLength=len(payload))
        self.binary.extend(payload)
        index = len(self.doc["bufferViews"])
        self.doc["bufferViews"].append(item)
        return index

    def store(self, group, item):
        key = canonical(item)
        if group == "materials" and "name" in item:
            name = item["name"]
            if name in self.named_materials:
                previous, index = self.named_materials[name]
                if previous != key:
                    raise ValueError(f"same-name material conflict: {name!r} has different definitions")
                return index
            index = len(self.doc[group])
            self.named_materials[name] = key, index
        elif group in self.shared:
            if key in self.shared[group]:
                return self.shared[group][key]
            self.shared[group][key] = len(self.doc[group])
        self.doc[group].append(item)
        return len(self.doc[group]) - 1

    def copy_asset(self, doc, binary, root):
        selected = resources(doc, root)
        maps = {group: {} for group in GROUPS}

        # Deduplicate images before packing views: duplicate images must not leave
        # duplicate, unreferenced payloads in the output BIN.
        for index in selected["images"]:
            image = doc["images"][index]
            payload = image_data(doc, binary, image)
            key = image["mimeType"], sha256(payload)
            if key not in self.shared["images"]:
                view = doc["bufferViews"][image["bufferView"]] if "bufferView" in image else {}
                view_index = self.view(view, payload)
                copied = copy.deepcopy(image)
                copied.pop("uri", None)
                copied["bufferView"] = view_index
                self.shared["images"][key] = len(self.doc["images"])
                self.doc["images"].append(copied)
            image_index = self.shared["images"][key]
            maps["images"][index] = image_index
            if "bufferView" in image:
                maps["bufferViews"][image["bufferView"]] = self.doc["images"][image_index]["bufferView"]

        for index in selected["bufferViews"]:
            if index not in maps["bufferViews"]:
                view = doc["bufferViews"][index]
                start = view.get("byteOffset", 0)
                maps["bufferViews"][index] = self.view(view, binary[start:start + view["byteLength"]])

        for group in GROUPS[2:]:
            if group == "nodes":
                # Children can precede or follow their parent in the source array.
                maps[group] = {old: len(self.doc[group]) + n for n, old in enumerate(selected[group])}
            for index in selected[group]:
                item = copy.deepcopy(doc[group][index])
                if group == "accessors":
                    size = COMPONENT_BYTES[item["componentType"]]
                    if item.get("byteOffset", 0) % size:
                        raise ValueError("unaligned accessor byteOffset")
                for container, key, target in references(group, item):
                    container[key] = maps[target][container[key]]
                maps[group][index] = self.store(group, item)
        for key in self.extensions:
            self.extensions[key].update(doc.get(key, []))
        return maps["nodes"][root]

    def encode(self):
        doc = {key: value for key, value in self.doc.items() if value != []}
        doc["buffers"] = [dict(byteLength=len(self.binary))]
        for key, values in self.extensions.items():
            if values:
                doc[key] = sorted(values)
        # The sibling encoder supplies the GLB framing; normalize key order first.
        return encode_glb(json.loads(canonical(doc)), bytes(self.binary))


def asset_root(doc, asset_id):
    roots = Validator.index(doc.get("scenes", []), doc.get("scene", 0)).get("nodes", [])
    if len(roots) != 1:
        raise ValueError(f"{asset_id}: expected a single scene root")
    root = Validator.index(doc.get("nodes", []), roots[0])
    meta = root.get("extras", {}).get("gteki", {})
    if root.get("name") != asset_id or meta.get("id") != asset_id or meta.get("contract") != ASSET_CONTRACT:
        raise ValueError(f"{asset_id}: root name/metadata does not match the asset contract")
    matrix, _, _ = local_matrix(root)
    if any(abs(a - b) > 1e-6 for a, b in zip(matrix, IDENTITY)):
        raise ValueError(f"{asset_id}: asset root must be at identity")
    return roots[0]


def tag_repeated_names(nodes, skip=0):
    """Record the original name in extras.gteki_name on every node whose name repeats."""
    counts = {}
    for node in nodes[skip + 1:]:
        if "name" in node:
            counts[node["name"]] = counts.get(node["name"], 0) + 1
    for node in nodes[skip + 1:]:
        if counts.get(node.get("name"), 0) > 1:
            extras = node.setdefault("extras", {})
            if not isinstance(extras, dict):
                raise ValueError(f"node {node['name']!r}: extras must be an object to record {NAME_KEY}")
            extras[NAME_KEY] = node["name"]


def untag_names(nodes):
    for node in nodes:
        extras = node.get("extras")
        if isinstance(extras, dict) and NAME_KEY in extras:
            del extras[NAME_KEY]
            if not extras:
                del node["extras"]


def bundle_assets(sources, manifest, name="gteki_kit_bundle"):
    """Bundle ordered (id, GLB bytes) pairs; no filesystem access or side effects."""
    entries = {entry["id"]: entry for entry in manifest["assets"]}
    builder = Builder()
    metadata = dict(contract=CONTRACT, kit_version=manifest["kit_version"],
                    texture_resolution=manifest["texture_resolution"], assets=[])
    builder.doc["nodes"].append(dict(name=name, children=[], extras=dict(gteki_bundle=metadata)))
    builder.doc["scenes"][0]["nodes"] = [0]
    copyrights = []
    seen = set()
    for asset_id, data in sources:
        if asset_id not in entries:
            raise ValueError(f"unknown asset id: {asset_id}")
        if asset_id in seen:
            raise ValueError(f"duplicate asset id: {asset_id}")
        seen.add(asset_id)
        digest = sha256(data)
        if digest != entries[asset_id]["sha256"]:
            raise ValueError(f"library out of date: {asset_id} sha256 differs from manifest")
        doc, binary = embedded_document(data)
        if any(isinstance(node.get("extras"), dict) and NAME_KEY in node["extras"] for node in doc.get("nodes", [])):
            raise ValueError(f"{asset_id}: source nodes must not carry extras.{NAME_KEY}")
        root = builder.copy_asset(doc, binary, asset_root(doc, asset_id))
        builder.doc["nodes"][0]["children"].append(root)
        metadata["assets"].append(dict(id=asset_id, node=root, source_sha256=digest, source_bytes=len(data)))
        copyrights.append(doc["asset"].get("copyright"))
    if not seen:
        raise ValueError("select at least one asset")
    if copyrights[0] is not None and all(value == copyrights[0] for value in copyrights):
        builder.doc["asset"]["copyright"] = copyrights[0]
    if any(node.get("name") == name for node in builder.doc["nodes"][1:]):
        # loaders would rename the asset node rather than the root, and lookups by id would break
        raise ValueError(f"bundle name {name!r} collides with a bundled node name")
    tag_repeated_names(builder.doc["nodes"])  # node 0 is the bundle root
    return builder.encode()


def read_bundle(data):
    doc, binary = embedded_document(data)
    if doc.get("scene", 0) != 0 or len(doc["scenes"][0].get("nodes", [])) != 1:
        raise ValueError("bundle scene 0 must have exactly one root")
    root = Validator.index(doc["nodes"], doc["scenes"][0]["nodes"][0])
    meta = root.get("extras", {}).get("gteki_bundle", {})
    if meta.get("contract") != CONTRACT:
        raise ValueError(f"expected {CONTRACT} root metadata")
    entries = meta["assets"]
    if len({entry["id"] for entry in entries}) != len(entries):
        raise ValueError("duplicate asset ids in bundle metadata")
    if root.get("children", []) != [entry["node"] for entry in entries]:
        raise ValueError("bundle children differ from asset metadata")
    for entry in entries:
        node = Validator.index(doc["nodes"], entry["node"])
        if node.get("name") != entry["id"]:
            raise ValueError("bundle asset root name differs from metadata id")
    return doc, binary, meta


def extract_asset(data, asset_id):
    doc, binary, meta = read_bundle(data)
    entry = next((entry for entry in meta["assets"] if entry["id"] == asset_id), None)
    if entry is None:
        raise ValueError(f"unknown asset id: {asset_id}")
    builder = Builder()
    root = builder.copy_asset(doc, binary, entry["node"])
    untag_names(builder.doc["nodes"])
    builder.doc["scenes"][0]["nodes"] = [root]
    if "copyright" in doc["asset"]:
        builder.doc["asset"]["copyright"] = doc["asset"]["copyright"]
    return builder.encode()


def image_dimensions(data, mime):
    """Read dimensions without decoding pixels; return None for unknown headers."""
    if mime == "image/png" and len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        width, height = struct.unpack_from(">II", data, 16)
    elif mime == "image/ktx2" and len(data) >= 28 and data[:12] == b"\xabKTX 20\xbb\r\n\x1a\n":
        width, height = struct.unpack_from("<II", data, 20)
    elif mime == "image/jpeg" and data[:2] == b"\xff\xd8":
        offset = 2
        while offset < len(data) and data[offset] == 255:
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset >= len(data):
                return None
            marker = data[offset]
            offset += 1
            if marker in (0xD9, 0xDA):
                return None
            if marker == 1 or 0xD0 <= marker <= 0xD8:
                continue
            if offset + 2 > len(data):
                return None
            size = struct.unpack_from(">H", data, offset)[0]
            if size < 2 or offset + size > len(data):
                return None
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                if size < 8:
                    return None
                height, width = struct.unpack_from(">HH", data, offset + 3)
                return (width, height) if width and height else None
            offset += size
        return None
    elif mime == "image/webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        offset = 12
        while offset + 8 <= len(data):
            kind = data[offset:offset + 4]
            size = struct.unpack_from("<I", data, offset + 4)[0]
            payload = data[offset + 8:offset + 8 + size]
            if len(payload) != size:
                return None
            if kind == b"VP8X" and size >= 10:
                return 1 + int.from_bytes(payload[4:7], "little"), 1 + int.from_bytes(payload[7:10], "little")
            if kind == b"VP8L" and size >= 5 and payload[0] == 0x2F:
                bits = int.from_bytes(payload[1:5], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if kind == b"VP8 " and size >= 10 and payload[3:6] == b"\x9d\x01\x2a":
                width, height = struct.unpack_from("<HH", payload, 6)
                return (width & 0x3FFF, height & 0x3FFF) if width & 0x3FFF and height & 0x3FFF else None
            offset += 8 + size + size % 2
        return None
    else:
        return None
    return (width, height) if width and height else None


def bundle_info(data):
    doc, binary, meta = read_bundle(data)
    image_bytes, pixel_bytes = 0, 0
    unique, unknown = set(), []
    for index, image in enumerate(doc.get("images", [])):
        payload = image_data(doc, binary, image)
        image_bytes += len(payload)
        key = image["mimeType"], sha256(payload)
        if key in unique:
            continue
        unique.add(key)
        dimensions = image_dimensions(payload, image["mimeType"])
        if dimensions:
            width, height = dimensions
            pixel_bytes += width * height * (1 if image["mimeType"] == "image/ktx2" else 4)
        else:
            unknown.append(image.get("name", str(index)))
    counts = {group: len(doc.get(group, [])) for group in ("nodes", "meshes", "materials", "textures", "images")}
    counts.update(image_bytes=image_bytes, buffer_bytes=len(binary))
    estimate = round(pixel_bytes * 4 / 3)
    return dict(contract=CONTRACT, kit_version=meta["kit_version"],
                texture_resolution=meta["texture_resolution"], assets=[entry["id"] for entry in meta["assets"]],
                counts=counts, glb_bytes=len(data),
                source_glb_bytes=sum(entry["source_bytes"] for entry in meta["assets"]),
                gpu_texture_estimate=dict(bytes=estimate, mib=round(estimate / 1024**2, 3),
                    assumptions="Unique images; RGBA8 4 bytes/pixel, KTX2 estimated 1 byte/pixel; mipmaps x 4/3",
                    unknown_dimensions=unknown))


def select_ids(manifest, ids=None, layouts=None, all_assets=False):
    if all_assets:
        selected = [entry["id"] for entry in manifest["assets"]]
    elif ids is not None:
        selected = [value.strip() for value in ids.split(",")]
    else:
        selected = [Path(item["glb"]).stem for layout in layouts
                    for item in json.loads(layout.read_text())["items"]]
    selected = list(dict.fromkeys(selected))
    known = {entry["id"] for entry in manifest["assets"]}
    for asset_id in selected:
        if asset_id not in known:
            raise ValueError(f"unknown asset id: {asset_id}")
    if not selected:
        raise ValueError("select at least one asset")
    return selected


def self_test():
    """Entirely in memory: no test files or import caches are written."""
    def png(red):
        def chunk(kind, payload):
            return (struct.pack(">I", len(payload)) + kind + payload
                    + struct.pack(">I", zlib.crc32(kind + payload)))
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes([0, red, 0, 0, 255]))) + chunk(b"IEND", b""))

    def tiny(asset_id, red):
        binary = bytearray(struct.pack("<9f3Hxx6f", -1, 0, -1, 1, 0, -1, 0, 1, 0, 0, 1, 2, 0, 0, 1, 0, 0, 1))
        views = [dict(buffer=0, byteOffset=0, byteLength=36, byteStride=12, target=34962),
                 dict(buffer=0, byteOffset=36, byteLength=6, target=34963),
                 dict(buffer=0, byteOffset=44, byteLength=24, target=34962)]
        for payload in (png(0), png(red)):
            binary.extend(b"\0" * (-len(binary) % 4))
            views.append(dict(buffer=0, byteOffset=len(binary), byteLength=len(payload)))
            binary.extend(payload)
        meta = {key: "self-test" for key in REQUIRED}
        meta.update(contract=ASSET_CONTRACT, id=asset_id, params={}, triangles=1,
                    bounds_m=dict(min=[-1, 0, -1], max=[1, 1, 0]))
        doc = dict(asset=dict(version="2.0", copyright="test"), scene=0, scenes=[dict(nodes=[0])],
            nodes=[dict(name=asset_id, children=[1, 2, 3], extras=dict(gteki=meta)),
                   dict(name="VIS_triangle", mesh=0, translation=[0, 0, 0], extras=dict(keep=asset_id)),
                   dict(name="COL_triangle-colonly", mesh=0),
                   dict(name="SOCKET_start", extras=dict(socket="start", width=2))],
            meshes=[dict(primitives=[dict(attributes=dict(POSITION=0, TEXCOORD_0=2), indices=1, material=0)])],
            accessors=[dict(bufferView=0, componentType=5126, count=3, type="VEC3", min=[-1, 0, -1], max=[1, 1, 0]),
                       dict(bufferView=1, componentType=5123, count=3, type="SCALAR"),
                       dict(bufferView=2, componentType=5126, count=3, type="VEC2")],
            materials=[dict(name="gteki_shared", pbrMetallicRoughness=dict(baseColorTexture=dict(index=0)))],
            samplers=[dict(magFilter=9729)], textures=[dict(source=0, sampler=0), dict(source=1, sampler=0)],
            images=[dict(name="first_shared_" + asset_id, mimeType="image/png", bufferView=3),
                    dict(name=asset_id, mimeType="image/png", bufferView=4)],
            bufferViews=views, buffers=[dict(byteLength=len(binary))])
        # Each unique image is used by a second material on the collision mesh.
        doc["materials"].append(dict(name="gteki_" + asset_id, normalTexture=dict(index=1)))
        doc["meshes"].append(copy.deepcopy(doc["meshes"][0]))
        doc["meshes"][1]["primitives"][0]["material"] = 1
        doc["nodes"][2]["mesh"] = 1
        return encode_glb(doc, bytes(binary))

    sources = [("tiny_a", tiny("tiny_a", 64)), ("tiny_b", tiny("tiny_b", 128))]
    manifest = dict(kit_version="test", texture_resolution=1,
                    assets=[dict(id=asset_id, sha256=sha256(data)) for asset_id, data in sources])
    bundled = bundle_assets(sources, manifest)
    assert bundled == bundle_assets(sources, manifest)
    doc, binary, meta = read_bundle(bundled)
    assert len(doc["images"]) == 3 and len(doc["textures"]) == 3 and len(doc["samplers"]) == 1
    assert doc["images"][0]["name"] == "first_shared_tiny_a"
    assert sum(material["name"] == "gteki_shared" for material in doc["materials"]) == 1
    assert [entry["id"] for entry in meta["assets"]] == ["tiny_a", "tiny_b"]
    # Names shared by both assets carry extras.gteki_name; the asset roots (unique) do not.
    tagged = {node["name"] for node in doc["nodes"] if NAME_KEY in node.get("extras", {})}
    assert tagged == {"VIS_triangle", "COL_triangle-colonly", "SOCKET_start"}, tagged
    assert all(node["extras"][NAME_KEY] == node["name"] for node in doc["nodes"] if node.get("name") in tagged)
    assert doc["nodes"][2]["extras"] == dict(keep="tiny_a", gteki_name="VIS_triangle")
    for (asset_id, original), entry in zip(sources, meta["assets"]):
        original_doc, original_binary = parse_glb(original)
        bundled_nodes = copy.deepcopy(doc["nodes"][entry["node"]:entry["node"] + 4])
        untag_names(bundled_nodes)
        for old, new in zip(original_doc["nodes"], bundled_nodes):
            assert {k: v for k, v in old.items() if k not in ("mesh", "children")} == {
                k: v for k, v in new.items() if k not in ("mesh", "children")}
        extracted = extract_asset(bundled, asset_id)
        assert Validator(asset_id + ".glb", extracted).check()["status"] != "FAIL"
        extracted_doc, extracted_binary = parse_glb(extracted)
        assert [n.get("extras") for n in extracted_doc["nodes"]] == [n.get("extras") for n in original_doc["nodes"]]
        assert len(extracted_doc["images"]) == 2
        for old, new in zip(original_doc["accessors"], extracted_doc["accessors"]):
            old_view = original_doc["bufferViews"][old["bufferView"]]
            new_view = extracted_doc["bufferViews"][new["bufferView"]]
            a, b = old_view.get("byteOffset", 0), new_view.get("byteOffset", 0)
            assert original_binary[a:a + old_view["byteLength"]] == extracted_binary[b:b + new_view["byteLength"]]
            assert b % COMPONENT_BYTES[new["componentType"]] == 0
            assert old_view.get("byteStride") == new_view.get("byteStride")
            assert old_view.get("target") == new_view.get("target")
    conflict_doc, conflict_binary = parse_glb(sources[1][1])
    conflict_doc["materials"][0]["doubleSided"] = True
    conflict = encode_glb(conflict_doc, conflict_binary)
    conflict_manifest = copy.deepcopy(manifest)
    conflict_manifest["assets"][1]["sha256"] = sha256(conflict)
    try:
        bundle_assets([sources[0], ("tiny_b", conflict)], conflict_manifest)
    except ValueError as error:
        assert "material conflict" in str(error)
    else:
        raise AssertionError("same-name material conflict was accepted")
    # Alternate image sources must participate in both reachability and remapping.
    alternatives = []
    for asset_id, original in sources:
        alt_doc, alt_binary = parse_glb(original)
        for texture in alt_doc["textures"]:
            source = texture.pop("source")
            texture["extensions"] = {
                "KHR_texture_basisu": dict(source=source), "EXT_texture_webp": dict(source=source)}
        alt_doc["extensionsUsed"] = ["KHR_texture_basisu", "EXT_texture_webp"]
        alt_doc["extensionsRequired"] = ["KHR_texture_basisu"]
        alternatives.append((asset_id, encode_glb(alt_doc, alt_binary)))
    alt_manifest = copy.deepcopy(manifest)
    for entry, (_, data) in zip(alt_manifest["assets"], alternatives):
        entry["sha256"] = sha256(data)
    alt_bundle = bundle_assets(alternatives, alt_manifest)
    alt_doc, _, _ = read_bundle(alt_bundle)
    assert alt_doc["extensionsUsed"] == ["EXT_texture_webp", "KHR_texture_basisu"]
    assert alt_doc["extensionsRequired"] == ["KHR_texture_basisu"]
    for asset_id, _ in alternatives:
        alt_doc, alt_binary = parse_glb(extract_asset(alt_bundle, asset_id))
        for mesh, red in zip(alt_doc["meshes"], (0, 64 if asset_id == "tiny_a" else 128)):
            material = alt_doc["materials"][mesh["primitives"][0]["material"]]
            info = next(texture_infos(material))
            texture = alt_doc["textures"][info["index"]]
            for extension in ("KHR_texture_basisu", "EXT_texture_webp"):
                image = alt_doc["images"][texture["extensions"][extension]["source"]]
                assert image_data(alt_doc, alt_binary, image) == png(red)

    # Header-only fixtures exercise every supported memory-estimate encoding.
    def webp(kind, payload):
        body = b"WEBP" + kind + struct.pack("<I", len(payload)) + payload + b"\0" * (len(payload) % 2)
        return b"RIFF" + struct.pack("<I", len(body)) + body

    assert image_dimensions(png(0), "image/png") == (1, 1)
    for marker in (0xC0, 0xC2):
        jpeg = b"\xff\xd8\xff" + bytes([marker]) + struct.pack(">HBHHB", 8, 8, 5, 7, 0)
        assert image_dimensions(jpeg, "image/jpeg") == (7, 5)
    assert image_dimensions(webp(b"VP8 ", b"\0" * 3 + b"\x9d\x01\x2a" + struct.pack("<HH", 7, 5)), "image/webp") == (7, 5)
    assert image_dimensions(webp(b"VP8L", b"\x2f" + struct.pack("<I", 6 | (4 << 14))), "image/webp") == (7, 5)
    assert image_dimensions(webp(b"VP8X", b"\0" * 4 + (6).to_bytes(3, "little") + (4).to_bytes(3, "little")), "image/webp") == (7, 5)
    ktx2 = b"\xabKTX 20\xbb\r\n\x1a\n" + struct.pack("<4I", 0, 1, 7, 5)
    assert image_dimensions(ktx2, "image/ktx2") == (7, 5)
    assert image_dimensions(b"truncated", "image/jpeg") is None
    assert bundle_info(bundled)["gpu_texture_estimate"]["unknown_dimensions"] == []
    tagged_source = copy.deepcopy(parse_glb(sources[0][1])[0])
    tagged_source["nodes"][1]["extras"][NAME_KEY] = "x"
    tagged_data = encode_glb(tagged_source, parse_glb(sources[0][1])[1])
    try:
        bundle_assets([("tiny_a", tagged_data)], dict(manifest, assets=[dict(id="tiny_a", sha256=sha256(tagged_data))]))
    except ValueError as error:
        assert NAME_KEY in str(error)
    else:
        raise AssertionError("source extras.gteki_name was accepted")
    for clash in ("tiny_a", "VIS_triangle"):
        try:
            bundle_assets(sources, manifest, name=clash)
        except ValueError as error:
            assert "collides" in str(error)
        else:
            raise AssertionError(f"bundle name {clash!r} colliding with a node was accepted")
    print("PASS self-test: deduplication, subtree metadata, repeated-name tags, determinism, extraction, geometry bytes, material conflict, bundle-name clash, alternate sources and image headers")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    commands = parser.add_subparsers(dest="command")
    bundle = commands.add_parser("bundle", help="build one self-contained kit GLB")
    bundle.add_argument("--library", type=Path, required=True)
    selection = bundle.add_mutually_exclusive_group(required=True)
    selection.add_argument("--ids")
    selection.add_argument("--layout", type=Path, action="append")
    selection.add_argument("--all", action="store_true")
    bundle.add_argument("--out", type=Path, required=True)
    bundle.add_argument("--name", default="gteki_kit_bundle")
    extract = commands.add_parser("extract", help="rebuild a standalone asset GLB")
    extract.add_argument("--bundle", type=Path, required=True)
    extract.add_argument("--id", required=True)
    extract.add_argument("--out", type=Path, required=True)
    info = commands.add_parser("info", help="print bundle counts and texture memory estimate")
    info.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if not args.command:
        if not args.self_test:
            parser.error("provide bundle, extract, info or --self-test")
        return 0
    try:
        if args.command == "bundle":
            manifest = json.loads((args.library / "manifest.json").read_text())
            ids = select_ids(manifest, args.ids, args.layout, args.all)
            entries = {entry["id"]: entry for entry in manifest["assets"]}
            sources = [(asset_id, (args.library / entries[asset_id]["file"]).read_bytes()) for asset_id in ids]
            output = bundle_assets(sources, manifest, args.name)
        elif args.command == "extract":
            output = extract_asset(args.bundle.read_bytes(), args.id)
        else:
            print(json.dumps(bundle_info(args.bundle.read_bytes()), indent=2))
            return 0
        # Selection, source hashes and all remapping succeed before touching output.
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(output)
        print(f"Wrote {args.out} ({len(output):,} bytes)")
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error, OverflowError, RecursionError) as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
