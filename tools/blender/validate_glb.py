#!/usr/bin/env python3
"""Validate gteki-asset/0.1 GLBs without Blender or third-party packages.

Bounds use the eight corners of each POSITION accessor's min/max box, transformed
through the scene graph (including collision geometry). They are conservative
for rotated meshes. Triangle totals count visual mesh instances, not unique meshes.
"""
import argparse
import base64
import copy
import itertools
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys

CONTRACT = "gteki-asset/0.1"
PALETTES = ("gteki_palette", "gteki_palette_blend")  # mobile swatch atlases
ROLES = ("barriers", "transport", "stairs_ramps")  # station bake roles; keep in step with gteki_assets/contract.py ROLES
REQUIRED = ("contract id family variant version generator params bounds_m triangles "
            "dimension_basis fidelity navigation provenance license").split()
# Packing rounds UV1 to float32 in atlas space, which can tip a sliver triangle (one whose UV altitude is
# itself within a few float32 ulps) across its neighbour's edge. For ao_atlas entries such slivers, with a
# minimum UV altitude at most this (atlas UV units, 4 float32 ulps at 1.0), are left out of the overlap
# test; every other triangle is tested exactly as before, however thin its overlap.
ATLAS_OVERLAP_SLACK = 2.0 ** -22
IDENTITY = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.]


def vector(value, size):
    if not isinstance(value, list) or len(value) != size:
        raise ValueError(f"expected a {size}-component array")
    if any(isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) for x in value):
        raise ValueError("non-finite or non-numeric vector component")
    return value


def multiply(a, b):
    """Column-major glTF matrices; multiply parent by child."""
    return [sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
            for col in range(4) for row in range(4)]


def transform(matrix, point):
    return [sum(matrix[k * 4 + row] * point[k] for k in range(3)) + matrix[12 + row]
            for row in range(3)]


def local_matrix(node):
    if "matrix" in node:
        if any(key in node for key in ("translation", "rotation", "scale")):
            raise ValueError("matrix and TRS cannot coexist")
        matrix = vector(node["matrix"], 16)
        if any(abs(matrix[i] - expected) > 1e-6 for i, expected in ((3, 0), (7, 0), (11, 0), (15, 1))):
            raise ValueError("matrix must be affine")
        scales = [math.sqrt(sum(matrix[c * 4 + r] ** 2 for r in range(3))) for c in range(3)]
        determinant = (matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
                       - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
                       + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]))
        for a, b in ((0, 1), (0, 2), (1, 2)):
            if abs(sum(matrix[a*4+r] * matrix[b*4+r] for r in range(3))) > 1e-6:
                raise ValueError("node matrix contains shear (not decomposable as TRS)")
        return matrix, scales, determinant < 0
    t = vector(node.get("translation", [0, 0, 0]), 3)
    s = vector(node.get("scale", [1, 1, 1]), 3)
    x, y, z, w = vector(node.get("rotation", [0, 0, 0, 1]), 4)
    if abs(x*x + y*y + z*z + w*w - 1) > 1e-4:
        raise ValueError("rotation quaternion must have unit length")
    matrix = [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
              2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
              2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
              t[0], t[1], t[2], 1]
    for col in range(3):
        for row in range(3):
            matrix[col*4+row] *= s[col]
    return matrix, s, any(component < 0 for component in s)


def texture_infos(material):
    """Every textureInfo in a material, extension slots included: (path, info)."""
    found = []

    def walk(value, path):
        if isinstance(value, dict):
            if "index" in value and path and path[-1].endswith("Texture"):
                found.append((".".join(path), value))
            for key, child in value.items():
                if key != "extras":  # application data, never sampled
                    walk(child, path + [key])
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, path + [str(i)])

    walk(material, [])
    return found


def effective_texcoord(info):
    """KHR_texture_transform may override the UV set a texture samples."""
    transform_ext = info.get("extensions", {}).get("KHR_texture_transform", {})
    return transform_ext.get("texCoord", info.get("texCoord", 0))


def triangle_corners(order, mode):
    """Corner index triples of a TRIANGLES, TRIANGLE_STRIP or TRIANGLE_FAN primitive (others: none)."""
    if mode == 4:
        return [tuple(order[k:k + 3]) for k in range(0, len(order) - 2, 3)]
    if mode == 5:
        return [(order[k], order[k + 1], order[k + 2]) if k % 2 == 0 else (order[k + 1], order[k], order[k + 2])
                for k in range(len(order) - 2)]
    if mode == 6:
        return [(order[0], order[k], order[k + 1]) for k in range(1, len(order) - 1)]
    return []


def _area3(p, q, r):
    """Area of a 3D triangle."""
    u, w = [q[i] - p[i] for i in range(3)], [r[i] - p[i] for i in range(3)]
    return 0.5 * math.sqrt((u[1]*w[2] - u[2]*w[1])**2 + (u[2]*w[0] - u[0]*w[2])**2 + (u[0]*w[1] - u[1]*w[0])**2)


# A lightmap triangle whose geometry covers at least 1 mm^2 must keep some UV area; slivers below
# that (stair-nosing seams) may collapse when UVs are snapped to the 1/65536 grid.
COLLAPSED_UV_AREA, VISIBLE_GEOMETRY_M2 = 1e-12, 1e-6
# Diagnostic WARN only: a triangle at least 1 cm^2 and 5 mm across in 3D whose UV1 is squashed more than
# 10x across relative to its 3D shape gets its AO from the few texels along a line (scale-invariant).
THIN_UV_MIN_AREA_M2, THIN_UV_MIN_ALTITUDE_M, THIN_UV_SQUASH = 1e-4, 0.005, 0.1


def _longest_edge(a, b, c):
    """Longest edge of a 2D or 3D triangle."""
    return max(math.dist(a, b), math.dist(b, c), math.dist(c, a))


def _min_altitude(a, b, c, area):
    """Smallest altitude of a 2D or 3D triangle: 2 * area / longest edge."""
    longest = _longest_edge(a, b, c)
    return 2 * area / longest if longest > 0 else 0.0


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _area(poly):
    """Signed (shoelace) area; positive when counter-clockwise."""
    return 0.5 * sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))


def _clip(subject, clipper):
    """Sutherland-Hodgman intersection of two counter-clockwise convex polygons."""
    out = subject
    for i in range(len(clipper)):
        a, b = clipper[i], clipper[(i + 1) % len(clipper)]
        inp, out = out, []
        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            dp, dq = _cross(a, b, p), _cross(a, b, q)
            if dp > 0:
                out.append(p)
            if (dp > 0) != (dq > 0) and dp != dq:
                t = dp / (dp - dq)
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        if not out:
            break
    return out


def uv_overlaps(tris, eps=1e-10, slack=0.0):
    """Index pairs of UV triangles that overlap by more than `eps` of the unit square.

    Lightmap charts must not overlap; triangles that only share an edge or a vertex do not count.
    With `slack`, triangles whose minimum altitude (2 * area / longest edge) is at most `slack` are skipped."""
    ccw = {}
    for i, t in enumerate(tris):
        a = _area(t)
        if abs(a) > 1e-14 and not (slack and 2 * abs(a) <= slack * max(math.dist(t[k - 1], t[k]) for k in range(3))):
            ccw[i] = tuple(t) if a > 0 else tuple(t[::-1])
    boxes = {i: (min(p[0] for p in t), min(p[1] for p in t), max(p[0] for p in t), max(p[1] for p in t)) for i, t in ccw.items()}
    # 1/64 cells, unless that enumerates millions of them (a huge triangle): then no smaller than the largest triangle
    cell = 1 / 64
    if sum((math.floor(b[2] / cell) - math.floor(b[0] / cell) + 1) * (math.floor(b[3] / cell) - math.floor(b[1] / cell) + 1)
           for b in boxes.values()) > 4_000_000:
        cell = max(cell, max((max(b[2] - b[0], b[3] - b[1]) for b in boxes.values()), default=0))
    grid = {}
    for i, (x0, y0, x1, y1) in boxes.items():
        for gx in range(math.floor(x0 / cell), math.floor(x1 / cell) + 1):
            for gy in range(math.floor(y0 / cell), math.floor(y1 / cell) + 1):
                grid.setdefault((gx, gy), []).append(i)
    pairs = set()
    tested = set()
    for ids in grid.values():
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                pair = (ids[x], ids[y])
                if pair in tested:
                    continue
                tested.add(pair)
                a, b = boxes[pair[0]], boxes[pair[1]]
                if a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]:
                    continue  # boxes only touch or are apart
                poly = _clip(ccw[pair[0]], ccw[pair[1]])
                if len(poly) >= 3 and _area(poly) > eps:
                    pairs.add(pair)
    return sorted(pairs)


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
        chunks.append((kind, data[offset:offset+size]))
        offset += size
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ValueError("first chunk must be JSON")
    if sum(kind == 0x4E4F534A for kind, _ in chunks) != 1:
        raise ValueError("duplicate JSON chunk")
    bins = [(i, chunk) for i, (kind, chunk) in enumerate(chunks) if kind == 0x004E4942]
    if len(bins) > 1 or (bins and bins[0][0] != 1):
        raise ValueError("BIN must be the second chunk and occur at most once")
    doc = json.loads(chunks[0][1].decode("utf-8"))
    if not isinstance(doc, dict) or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("asset.version must be 2.0")
    return doc, bins[0][1] if bins else b""


class AtlasManifest:
    """Validated external AO metadata, shared by all GLBs in a CLI invocation."""

    def __init__(self, path):
        self.path = Path(path).resolve()
        # Explicit sibling loading also works under python3 -I (no script-dir sys.path).
        spec = importlib.util.spec_from_file_location("gteki_ao_atlas", Path(__file__).with_name("ao_atlas.py"))
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        self.helper = helper
        doc = json.loads(self.path.read_text())
        self.assets, self.sizes = {}, {}
        atlases = doc.get("atlases", {})
        for kind, atlas in atlases.items():
            file = helper.local_path(self.path.parent, atlas["path"])
            raw = file.read_bytes()
            if helper.digest(raw) != atlas["sha256"]:
                raise ValueError(f"atlas {kind}: sha256 mismatch")
            width, height, _ = helper.read_png(raw)
            if [width, height] != atlas["size_px"]:
                raise ValueError(f"atlas {kind}: size_px mismatch")
            if atlas.get("bytes", len(raw)) != len(raw):
                raise ValueError(f"atlas {kind}: bytes mismatch")
            self.sizes[kind] = width, height
        cells = {}
        for asset in doc["assets"]:
            key = asset["id"]
            if key in self.assets:
                raise ValueError(f"duplicate manifest id {key}")
            if Path(asset["file"]).stem != key:
                raise ValueError(f"manifest file/id mismatch for {key}")
            self.assets[key] = asset
            if "ao_atlas" not in asset:
                continue
            entry = asset["ao_atlas"]
            kind, cell = entry["kind"], entry["cell"]
            if kind not in self.sizes:
                raise ValueError(f"{key}: missing atlas kind {kind}")
            width, height = self.sizes[kind]
            if (not isinstance(cell, list) or len(cell) != 4 or any(type(v) is not int for v in cell)):
                raise ValueError(f"{key}: invalid atlas cell")
            x, y, w, h = cell
            if (not helper.power_of_two(w) or w != h or x < 0 or y < 0 or x % w or y % h
                    or x + w > width or y + h > height):
                raise ValueError(f"{key}: atlas cell must be an aligned power-of-two square inside atlas")
            for other, (ox, oy, ow, oh) in cells.get(kind, []):
                if x < ox + ow and ox < x + w and y < oy + oh and oy < y + h:
                    raise ValueError(f"atlas {kind}: cells overlap ({other}, {key})")
            cells.setdefault(kind, []).append((key, cell))

    def entry(self, asset_id, data):
        if asset_id not in self.assets:
            raise ValueError(f"GLB id {asset_id!r} missing from manifest")
        asset = self.assets[asset_id]
        if self.helper.digest(data) != asset["sha256"]:
            raise ValueError(f"{asset_id}: GLB sha256 mismatch")
        if len(data) != asset["bytes"]:
            raise ValueError(f"{asset_id}: GLB bytes mismatch")
        return asset.get("ao_atlas")


class Validator:
    def __init__(self, name, data, require_occlusion=False, manifest=None):
        self.name = name
        self.data = data
        self.require_occlusion = require_occlusion  # opt-in: every visual material needs the baked AO map
        self.manifest = manifest
        self.result = dict(file=name, bytes=len(data), triangles=0, materials=0,
                           images=0, image_bytes=0, nodes=0, sockets=[], aabb=None,
                           messages=[])

    def message(self, level, text):
        self.result["messages"].append(dict(level=level, message=text))

    def check(self):
        try:
            self._check()
        except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error, OverflowError, RecursionError) as error:
            self.message("FAIL", f"malformed GLB: {error}")
        levels = {item["level"] for item in self.result["messages"]}
        self.result["status"] = "FAIL" if "FAIL" in levels else "WARN" if "WARN" in levels else "PASS"
        if not levels:
            self.message("PASS", "all contract checks passed")
        return self.result

    def _check(self):
        doc, binary = parse_glb(self.data)
        nodes = doc.get("nodes", [])
        accessors = doc.get("accessors", [])
        meshes = doc.get("meshes", [])
        buffers = doc.get("buffers", [])
        views = doc.get("bufferViews", [])
        if buffers:
            if len(buffers) != 1 or "uri" in buffers[0]:
                raise ValueError("canonical GLB must have one embedded buffer")
            declared = buffers[0]["byteLength"]
            if declared < 0 or not declared <= len(binary) <= declared + 3:
                raise ValueError("BIN size differs from buffer.byteLength")
        elif binary:
            raise ValueError("BIN chunk has no buffer definition")
        for view in views:
            if view.get("buffer") != 0 or view.get("byteOffset", 0) < 0 or view["byteLength"] < 0:
                raise ValueError("invalid bufferView")
            if view.get("byteOffset", 0) + view["byteLength"] > buffers[0]["byteLength"]:
                raise ValueError("bufferView exceeds embedded buffer")
        # Validate accessor storage, including interleaved and sparse accessors.
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
                      "MAT2": 4, "MAT3": 9, "MAT4": 16}
        sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}

        def storage(view_index, offset, count, element_size, component_size, interleaved=True):
            view = self.index(views, view_index)
            stride = view.get("byteStride", element_size) if interleaved else element_size
            if not isinstance(offset, int) or offset < 0 or offset % component_size:
                raise ValueError("invalid accessor byteOffset/alignment")
            if not isinstance(stride, int) or stride < element_size or stride % component_size:
                raise ValueError("invalid accessor stride")
            end = offset + ((count-1)*stride + element_size if count else 0)
            if end > view["byteLength"]:
                raise ValueError("accessor exceeds bufferView")

        formats = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}

        def read(accessor):
            """Element tuples of a dense accessor (sparse/zero accessors are not read)."""
            if "bufferView" not in accessor or "sparse" in accessor:
                return None
            view = self.index(views, accessor["bufferView"])
            width = components[accessor["type"]]
            size = sizes[accessor["componentType"]] * width
            stride = view.get("byteStride", size)
            start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            fmt = "<" + formats[accessor["componentType"]] * width
            return [struct.unpack_from(fmt, binary, start + i*stride) for i in range(accessor["count"])]

        for accessor in accessors:
            count = accessor["count"]
            if not isinstance(count, int) or isinstance(count, bool) or count < 1:
                raise ValueError("accessor count must be a positive integer")
            component_size = sizes[accessor["componentType"]]
            kind = accessor["type"]
            element_size = component_size * components[kind]
            if kind.startswith("MAT"):
                # glTF matrix columns are each aligned to four bytes.
                dimension = int(kind[-1])
                element_size = dimension * ((dimension*component_size + 3)//4*4)
            if "bufferView" in accessor:
                storage(accessor["bufferView"], accessor.get("byteOffset", 0), count, element_size, component_size)
            elif "sparse" not in accessor:
                # Omitted storage is a zero-initialized accessor in glTF 2.0.
                if accessor.get("byteOffset", 0):
                    raise ValueError("accessor without bufferView has byteOffset")
            if "sparse" in accessor:
                sparse = accessor["sparse"]
                sparse_count = sparse["count"]
                if not isinstance(sparse_count, int) or not 1 <= sparse_count <= count:
                    raise ValueError("invalid sparse accessor count")
                indices, values = sparse["indices"], sparse["values"]
                if indices["componentType"] not in (5121, 5123, 5125):
                    raise ValueError("invalid sparse index component type")
                index_size = sizes[indices["componentType"]]
                storage(indices["bufferView"], indices.get("byteOffset", 0), sparse_count, index_size, index_size, False)
                storage(values["bufferView"], values.get("byteOffset", 0), sparse_count, element_size, component_size, False)
        for key in ("extensionsUsed", "extensionsRequired"):
            for extension in doc.get(key, []):
                if extension in ("KHR_draco_mesh_compression", "EXT_meshopt_compression"):
                    self.message("FAIL", f"forbidden compression: {extension}")
                elif extension != "KHR_materials_emissive_strength":
                    self.message("FAIL", f"extension outside canonical baseline ({key}): {extension}")
        scenes = doc.get("scenes", [])
        roots = self.index(scenes, doc.get("scene", 0)).get("nodes", []) if scenes else []
        if len(roots) != 1:
            raise ValueError("active scene must have exactly one root node")
        root_index = roots[0]
        if any(scene.get("nodes", []) != [root_index] for scene in scenes):
            self.message("FAIL", "every scene must use the same single asset root")
        root = self.index(nodes, root_index)
        stem = Path(self.name).stem
        if root.get("name") != stem:
            self.message("FAIL", f"root name must equal file stem {stem!r}")
        meta = root.get("extras", {}).get("gteki")
        if not isinstance(meta, dict):
            self.message("FAIL", "root extras.gteki must be an object")
            meta = {}
        for key in REQUIRED:
            if key not in meta:
                self.message("FAIL", f"missing root extras.gteki.{key}")
        # machine-readable rights (written once contract.EMBED_SPDX is on): all or none, well formed
        rights = [k for k in ("license_spdx", "rights_class", "attribution") if k in meta]
        if rights:
            for key in ("license_spdx", "rights_class", "attribution"):
                if not isinstance(meta.get(key), str) or not meta[key].strip():
                    self.message("FAIL", f"root extras.gteki.{key} must be a non-empty string when rights fields are present")
            if meta.get("rights_class") not in (None, "original"):
                self.message("FAIL", "root extras.gteki.rights_class must be 'original'")
        if meta.get("contract") != CONTRACT:
            self.message("FAIL", f"contract must equal {CONTRACT}")
        if meta.get("id") != stem:
            self.message("FAIL", "metadata id must equal file stem")
        if not isinstance(meta.get("params"), dict):
            self.message("FAIL", "metadata params must be an object")
        if not isinstance(meta.get("triangles"), int) or isinstance(meta.get("triangles"), bool) or meta["triangles"] < 0:
            self.message("FAIL", "metadata triangles must be a non-negative integer")
        materials = doc.get("materials", [])
        atlas_entry, overlap_slack = None, 0.0
        if self.manifest is not None:
            if not isinstance(self.manifest, AtlasManifest):
                self.manifest = AtlasManifest(self.manifest)
            atlas_entry = self.manifest.entry(stem, self.data)
        if atlas_entry is not None:
            if any("occlusionTexture" in material for material in materials):
                self.message("FAIL", "ao_atlas asset still carries occlusionTexture")
            x, y, w, h = atlas_entry["cell"]
            width, height = self.manifest.sizes[atlas_entry["kind"]]
            overlap_slack = ATLAS_OVERLAP_SLACK
            owned = self.manifest.helper.asset_nodes(doc, stem)
            mesh_indices = {nodes[i]["mesh"] for i in owned if "mesh" in nodes[i]}
            uv_indices = {p["attributes"]["TEXCOORD_1"] for i in mesh_indices
                          for p in self.index(meshes, i).get("primitives", [])
                          if "TEXCOORD_1" in p.get("attributes", {})}
            for i in uv_indices:
                accessor = self.index(accessors, i)
                uv = read(accessor)
                divisor = {5121: 255, 5123: 65535}.get(accessor["componentType"], 1)
                if (accessor["type"] != "VEC2" or uv is None
                        or not (accessor["componentType"] == 5126
                                or (divisor != 1 and accessor.get("normalized")))):
                    self.message("FAIL", "ao_atlas TEXCOORD_1 must be dense floats or normalized unsigned bytes/shorts")
                    continue
                if any(not self.manifest.helper.uv_in_cell((u / divisor, v / divisor),
                                                          atlas_entry["cell"], (width, height)) for u, v in uv):
                    self.message("FAIL", "ao_atlas TEXCOORD_1 outside cell (requires a half-texel inset)")
        self.result.update(nodes=len(nodes), materials=len(materials), images=len(doc.get("images", [])))
        for material in materials:
            if not material.get("name", "").startswith("gteki_"):
                self.message("FAIL", f"material name lacks gteki_ prefix: {material.get('name')!r}")
            if material.get("name") in PALETTES:
                # 4x4 swatches in a 64x64 atlas: any mip below 16x16 averages unrelated swatches
                for slot, info in texture_infos(material):
                    if slot == "occlusionTexture":
                        continue  # the per-asset baked map is mipmapped; only the swatch atlas must not be
                    texture = self.index(doc.get("textures", []), info["index"])
                    sampler = (self.index(doc.get("samplers", []), texture["sampler"]) if "sampler" in texture else {})
                    if sampler.get("minFilter") not in (9728, 9729):
                        self.message("FAIL", f"material {material['name']!r} {slot} must sample without mipmaps "
                                     f"(minFilter NEAREST or LINEAR, got {sampler.get('minFilter')!r})")
        for img in doc.get("images", []):
            if img.get("mimeType") not in ("image/jpeg", "image/png"):
                self.message("FAIL", f"unsupported image mimeType: {img.get('mimeType')!r}")
            if "bufferView" in img:
                self.result["image_bytes"] += self.index(views, img["bufferView"])["byteLength"]
            elif img.get("uri", "").startswith("data:"):
                self.result["image_bytes"] += len(base64.b64decode(img["uri"].split(",", 1)[1], validate=True))
            else:
                self.message("FAIL", "canonical GLB images must be embedded")
        for material in materials:
            occlusion = material.get("occlusionTexture")
            if occlusion is None:
                continue
            # baked ambient occlusion: R channel of a per-asset PNG on the lightmap layer, strength 1
            if effective_texcoord(occlusion) != 1:
                self.message("FAIL", f"material {material.get('name')!r} occlusionTexture must use texCoord 1 "
                             f"(the UVLightmap layer), got {effective_texcoord(occlusion)!r}")
            if occlusion.get("strength", 1.0) != 1.0:
                self.message("FAIL", f"material {material.get('name')!r} occlusionTexture strength must be 1.0")
            image = self.index(doc.get("images", []), self.index(doc.get("textures", []), occlusion["index"]).get("source"))
            raw = (binary[self.index(views, image["bufferView"]).get("byteOffset", 0):][:24] if "bufferView" in image else b"")
            if image.get("mimeType") != "image/png" or raw[:8] != b"\x89PNG\r\n\x1a\n":
                self.message("FAIL", f"material {material.get('name')!r} occlusion map must be an embedded PNG")
            elif struct.unpack(">II", raw[16:24]) not in ((128, 128), (256, 256), (512, 512), (1024, 1024)):
                self.message("FAIL", f"material {material.get('name')!r} occlusion map must be 128x128, 256x256, 512x512 or 1024x1024, "
                             f"got {'x'.join(map(str, struct.unpack('>II', raw[16:24])))}")
        # Check all nodes, including unused nodes, for transform/naming violations.
        locals_ = []
        for index, node in enumerate(nodes):
            matrix, scales, negative = local_matrix(node)
            locals_.append(matrix)
            if negative:
                self.message("FAIL", f"node {index} {node.get('name')!r} has negative scale/reflection")
            if index == root_index and any(abs(a - b) > 1e-6 for a, b in zip(matrix, IDENTITY)):
                self.message("FAIL", "asset root must be at identity (no translation, rotation or scale)")
            if any(abs(s - 1) > 1e-6 for s in scales):
                # the contract applies every transform's scale: unapplied scale on any node fails
                self.message("FAIL", f"node {index} has non-unit scale {scales}")
            if node.get("name", "").startswith("SOCKET_"):
                socket = node.get("extras", {}).get("socket")
                if not isinstance(socket, str):
                    self.message("FAIL", f"socket {node['name']} requires extras.socket string")
                self.result["sockets"].append(dict(name=node["name"], socket=socket if isinstance(socket, str) else None))
            if node.get("name", "").endswith("-colonly") and "mesh" not in node:
                self.message("FAIL", f"collision node {node['name']} requires a mesh")
        low, high = [math.inf]*3, [-math.inf]*3
        visited = set()
        collision_count = 0

        visual_materials = set()
        textures = doc.get("textures", [])
        shared_atlas = atlas_entry is not None or any("occlusionTexture" in m for m in materials)
        mesh_tris = {}  # mesh index -> lightmap triangles of its primitives
        atlas = []  # visual node instances sharing the occlusion map: one UV space for all of them

        def lightmap_overlap(node):
            """TEXCOORD_1 is a lightmap: one UV space per mesh, shared by its primitives, inside the
            unit square and without overlap. Mobile builds carry it on every visual triangle primitive.
            With an occlusion map the whole asset shares one UV space (checked after the walk)."""
            if node["mesh"] in mesh_tris:
                if shared_atlas:
                    atlas.append((node, mesh_tris[node["mesh"]]))
                return
            tris = mesh_tris[node["mesh"]] = []
            collapsed = thin = 0
            for primitive in meshes[node["mesh"]].get("primitives", []):
                mode = primitive.get("mode", 4)
                if mode not in (4, 5, 6):
                    continue
                if "TEXCOORD_1" not in primitive.get("attributes", {}):
                    if meta.get("profile") == "mobile" or atlas_entry is not None:
                        self.message("FAIL", f"mesh {node['mesh']} has no lightmap UV (TEXCOORD_1); "
                                     + ("ao_atlas requires one" if atlas_entry is not None else "mobile requires one"))
                    continue
                accessor = self.index(accessors, primitive["attributes"]["TEXCOORD_1"])
                normalized = {5121: 255, 5123: 65535}
                if (accessor.get("type") != "VEC2" or "sparse" in accessor or "bufferView" not in accessor
                        or not (accessor.get("componentType") == 5126
                                or (accessor.get("componentType") in normalized and accessor.get("normalized")))):
                    self.message("FAIL", f"mesh {node['mesh']} TEXCOORD_1 must be a dense VEC2 of floats or normalized "
                                 "unsigned bytes/shorts")
                    continue
                if accessor["count"] != self.index(accessors, primitive["attributes"]["POSITION"])["count"]:
                    self.message("FAIL", f"mesh {node['mesh']} TEXCOORD_1 count differs from POSITION count")
                    continue
                uv = read(accessor)
                if accessor["componentType"] != 5126:
                    scale = normalized[accessor["componentType"]]
                    uv = [(u / scale, v / scale) for u, v in uv]
                if not all(math.isfinite(c) for p in uv for c in p):
                    self.message("FAIL", f"mesh {node['mesh']} TEXCOORD_1 contains NaN/Inf")
                    continue
                # External cells already enforce a half-texel inset.
                # Keep the original unit-square rule otherwise.
                if atlas_entry is None and any(c < -1e-6 or c > 1 + 1e-6 for p in uv for c in p):
                    self.message("FAIL", f"mesh {node['mesh']} lightmap UV (TEXCOORD_1) leaves the unit square")
                    continue
                order = ([v for (v,) in read(self.index(accessors, primitive["indices"]))]
                         if "indices" in primitive else list(range(len(uv))))
                if any(v >= len(uv) for v in order):
                    continue  # reported by the index range check
                positions = read(self.index(accessors, primitive["attributes"]["POSITION"]))
                for corners in triangle_corners(order, mode):
                    tri = tuple(uv[i] for i in corners)
                    tris.append(tri)
                    # Keep the pre-atlas collapse threshold in per-id UV units.
                    area_scale = width * height / (w * h) if atlas_entry is not None else 1
                    if not positions:
                        continue
                    if (abs(_area(tri)) * area_scale <= COLLAPSED_UV_AREA
                            and _area3(*(positions[i] for i in corners)) >= VISIBLE_GEOMETRY_M2):
                        collapsed += 1
                        continue
                    # Squashed sliver: visible in 3D, but its UV1 is much narrower across than along,
                    # compared with its 3D shape. Atlas cells go back to cell-local units (map frame).
                    corners3 = tuple(positions[i] for i in corners)
                    area3 = _area3(*corners3)
                    alt3 = _min_altitude(*corners3, area3)
                    if area3 < THIN_UV_MIN_AREA_M2 or alt3 < THIN_UV_MIN_ALTITUDE_M:
                        continue
                    map_scale = (width / w, height / h) if atlas_entry is not None else (1, 1)
                    map_tri = tuple((u * map_scale[0], v * map_scale[1]) for u, v in tri)
                    along = _longest_edge(*map_tri) / _longest_edge(*corners3)
                    across = _min_altitude(*map_tri, abs(_area(map_tri))) / alt3
                    if across < THIN_UV_SQUASH * along:
                        thin += 1
            if collapsed:
                self.message("FAIL", f"node {node.get('name')!r} has {collapsed} lightmap UV (TEXCOORD_1) triangles "
                             "collapsed to a point or line although their geometry is at least 1 mm^2")
            if thin:
                self.message("WARN", f"node {node.get('name')!r} has {thin} lightmap UV (TEXCOORD_1) triangles "
                             "squashed over 10x across their width although they are at least 1 cm^2 and 5 mm across in 3D")
            if shared_atlas:
                atlas.append((node, tris))
                return
            overlapping = uv_overlaps(tris, slack=overlap_slack)
            if overlapping:
                self.message("FAIL", f"node {node.get('name')!r} lightmap UV (TEXCOORD_1) has "
                             f"{len(overlapping)} overlapping triangle pairs")

        def visit(index, parent, inherited_collision=False):
            nonlocal collision_count
            node = self.index(nodes, index)
            if index in visited:
                raise ValueError("node cycle or multiple parents in scene")
            visited.add(index)
            world = multiply(parent, locals_[index])
            collision = inherited_collision or node.get("name", "").endswith("-colonly")
            if node.get("name", "").endswith("-colonly"):
                collision_count += 1
            if "mesh" in node:
                mesh = self.index(meshes, node["mesh"])
                for primitive in mesh.get("primitives", []):
                    accessor = self.index(accessors, primitive["attributes"]["POSITION"])
                    if accessor.get("type") != "VEC3" or accessor.get("componentType") != 5126:
                        raise ValueError("POSITION must be a FLOAT VEC3 accessor")
                    mins, maxs = vector(accessor["min"], 3), vector(accessor["max"], 3)
                    if any(a > b for a, b in zip(mins, maxs)):
                        raise ValueError("POSITION min exceeds max")
                    if "sparse" in accessor or "bufferView" not in accessor:
                        # the kit never emits these; reject rather than leave the data unchecked
                        self.message("FAIL", f"mesh {node['mesh']} POSITION must be a dense accessor (no sparse/zero storage)")
                    positions = read(accessor)
                    if positions is not None:
                        if not all(math.isfinite(c) for p in positions for c in p):
                            self.message("FAIL", f"mesh {node['mesh']} POSITION contains NaN/Inf")
                        elif any(c < lo - 1e-5 or c > hi + 1e-5 for p in positions for c, lo, hi in zip(p, mins, maxs)):
                            self.message("FAIL", f"mesh {node['mesh']} POSITION data outside accessor min/max")
                    for point in itertools.product(*zip(mins, maxs)):
                        point = transform(world, point)
                        for axis in range(3):
                            low[axis] = min(low[axis], point[axis])
                            high[axis] = max(high[axis], point[axis])
                    if "indices" in primitive:
                        indices = self.index(accessors, primitive["indices"])
                        if indices.get("type") != "SCALAR" or indices.get("componentType") not in (5121, 5123, 5125):
                            raise ValueError("mesh indices must be unsigned SCALAR accessors")
                        if "sparse" in indices or "bufferView" not in indices:
                            self.message("FAIL", f"mesh {node['mesh']} indices must be a dense accessor (no sparse/zero storage)")
                        values = read(indices)
                        if values is not None and any(v >= accessor["count"] for (v,) in values):
                            self.message("FAIL", f"mesh {node['mesh']} index exceeds vertex count {accessor['count']}")
                    if not collision:
                        count = indices["count"] if "indices" in primitive else accessor["count"]
                        mode = primitive.get("mode", 4)
                        if not isinstance(count, int) or count < 0:
                            raise ValueError("invalid accessor count")
                        if mode == 4:
                            if count % 3:
                                self.message("FAIL", "TRIANGLES index/vertex count is not divisible by three")
                            self.result["triangles"] += count // 3
                        elif mode in (5, 6):
                            self.result["triangles"] += max(0, count-2)
                        elif mode not in (0, 1, 2, 3):
                            raise ValueError(f"invalid primitive mode {mode}")
                    if "material" in primitive:
                        material = self.index(materials, primitive["material"])
                        if not collision:
                            visual_materials.add(primitive["material"])
                        # core slots and extension slots alike, with KHR_texture_transform overrides
                        for slot, info in texture_infos(material):
                            coord = effective_texcoord(info)
                            if (not isinstance(coord, int) or isinstance(coord, bool) or coord < 0
                                    or f"TEXCOORD_{coord}" not in primitive.get("attributes", {})):
                                self.message("FAIL", f"material {material.get('name')!r} {slot} samples texCoord {coord!r}, "
                                             "which its primitive does not have")
                if not collision:
                    lightmap_overlap(node)
            for child in node.get("children", []):
                visit(child, world, collision)

        visit(root_index, IDENTITY)
        # contract §10: gteki_role is on the root and every VIS_* node (mobile VIS_body included), one value
        carried = {i: nodes[i]["extras"]["gteki_role"] for i in visited
                   if "gteki_role" in (nodes[i].get("extras") or {})}
        if carried:
            for i, value in carried.items():
                if value not in ROLES:
                    self.message("FAIL", f"node {nodes[i].get('name')!r} gteki_role {value!r} must be one of {ROLES}")
            values = {json.dumps(value) for value in carried.values()}
            tagged = [i for i in visited if i == root_index or nodes[i].get("name", "").startswith("VIS_")]
            missing = [nodes[i].get("name") for i in tagged if i not in carried]
            if missing or len(values) > 1:
                self.message("FAIL", "gteki_role must be one value on the root and every VIS_* node"
                             + (f"; missing on {missing}" if missing else "") + (f"; found {sorted(values)}" if len(values) > 1 else ""))
        if shared_atlas:
            # one occlusion map for the whole asset: every visual node lays its islands out in the same
            # UV space, so they must not overlap across nodes (a mesh instanced twice overlaps itself)
            overlapping = uv_overlaps([tri for _, tris in atlas for tri in tris], slack=overlap_slack)
            if overlapping:
                self.message("FAIL", f"visual nodes share one lightmap atlas (occlusion map) but their UV1 has "
                             f"{len(overlapping)} overlapping triangle pairs")
        if atlas_entry is None and (shared_atlas or self.require_occlusion):
            lit = {m: (materials[m].get("occlusionTexture") or {}).get("index") for m in visual_materials}
            if any(i is None for i in lit.values()) and (shared_atlas or visual_materials):
                names = sorted(materials[m].get("name") for m, i in lit.items() if i is None)
                self.message("FAIL", f"visual materials without occlusionTexture: {names}")
            elif len({textures[i].get("source") for i in lit.values() if i is not None}) > 1:
                self.message("FAIL", "visual materials must share one occlusion map")
        if not collision_count:
            self.message("WARN", "no collision node in active scene")
        if not all(math.isfinite(x) for x in low+high):
            self.message("FAIL", "active scene contains no mesh bounds")
        else:
            self.result["aabb"] = dict(min=low, max=high)
            expected = meta.get("bounds_m", {})
            try:
                emin, emax = vector(expected["min"], 3), vector(expected["max"], 3)
                if any(a > b for a, b in zip(emin, emax)):
                    raise ValueError("min exceeds max")
                if any(abs(a-b) > 1e-3 for a, b in zip(low+high, emin+emax)):
                    self.message("WARN", "computed world AABB differs from bounds_m (tolerance 0.001 m)")
            except (KeyError, TypeError, ValueError):
                self.message("FAIL", "bounds_m must contain finite min/max vec3 arrays")
            if low[1] < -0.01 and "allow_below_floor" not in meta.get("params", {}):
                self.message("FAIL", f"bounds extend below floor without params.allow_below_floor: min.y={low[1]:.6f}")
        if self.result["triangles"] != meta.get("triangles"):
            self.message("FAIL", f"visual triangles {self.result['triangles']} differ from metadata {meta.get('triangles')}")

    @staticmethod
    def index(items, index):
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(items):
            raise ValueError(f"invalid array index {index!r}")
        return items[index]


def encode_glb(doc, binary):
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    chunks = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    chunks += struct.pack("<II", len(binary), 0x004E4942) + binary
    return struct.pack("<4sII", b"glTF", 2, len(chunks)+12) + chunks


def self_test():
    binary = struct.pack("<9f", -1, 0, 0, 1, 0, 0, 0, 1, -1)
    meta = {key: "self-test" for key in REQUIRED}
    meta.update(contract=CONTRACT, id="tiny", params={}, triangles=1,
                bounds_m=dict(min=[-1, 0, -1], max=[1, 1, 0]))
    doc = dict(asset=dict(version="2.0"), scene=0, scenes=[dict(nodes=[0])],
               nodes=[dict(name="tiny", extras=dict(gteki=meta), children=[1, 2, 3]),
                      dict(name="VIS_triangle", mesh=0), dict(name="COL_test-colonly", mesh=0),
                      dict(name="SOCKET_start", extras=dict(socket="start"))],
               buffers=[dict(byteLength=len(binary))], bufferViews=[dict(buffer=0, byteLength=len(binary))],
               accessors=[dict(bufferView=0, componentType=5126, count=3, type="VEC3", min=[-1, 0, -1], max=[1, 1, 0])],
               materials=[dict(name="gteki_test")], meshes=[dict(primitives=[dict(attributes=dict(POSITION=0), material=0)])])
    assert Validator("tiny.glb", encode_glb(doc, binary)).check()["status"] == "PASS"
    # Mobile finish normals can keep their source PNG (declaration/bytes checked by validate_finish).
    import zlib

    def png_chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
           + png_chunk(b"IDAT", zlib.compress(b"\x00\x80\x80\xff")) + png_chunk(b"IEND", b""))
    finish = copy.deepcopy(doc)
    fid = "gteki_finish_test"
    finish["nodes"][0]["name"] = fid
    finish["nodes"][0]["extras"]["gteki"].update(id=fid, family="finish", profile="mobile",
                                                   params={"mobile_normal_format": "png"})
    uv_data = struct.pack("<6f", 0, 0, 1, 0, 0, 1)
    finish_data = binary + uv_data + png
    finish["buffers"][0]["byteLength"] = len(finish_data)
    finish["bufferViews"] += [dict(buffer=0, byteOffset=len(binary), byteLength=len(uv_data)),
                              dict(buffer=0, byteOffset=len(binary) + len(uv_data), byteLength=len(png))]
    finish["accessors"].append(dict(bufferView=1, componentType=5126, count=3, type="VEC2"))
    finish["meshes"][0]["primitives"][0]["attributes"].update(TEXCOORD_0=1, TEXCOORD_1=1)
    finish["materials"] = [dict(name=fid, normalTexture=dict(index=0))]
    finish["textures"] = [dict(source=0)]
    finish["images"] = [dict(bufferView=2, mimeType="image/png")]
    result = Validator(f"{fid}.glb", encode_glb(finish, finish_data)).check()
    assert result["status"] == "PASS", result
    broken = copy.deepcopy(doc)
    broken["nodes"][0]["scale"] = [-1, 1, 1]
    broken["materials"][0]["name"] = "wrong"
    assert Validator("tiny.glb", encode_glb(broken, binary)).check()["status"] == "FAIL"
    assert Validator("tiny.glb", b"bad").check()["status"] == "FAIL"
    nan = struct.pack("<9f", -1, 0, 0, math.nan, 0, 0, 0, 1, -1)
    assert Validator("tiny.glb", encode_glb(doc, nan)).check()["status"] == "FAIL"
    indexed = copy.deepcopy(doc)
    indexed["bufferViews"].append(dict(buffer=0, byteOffset=len(binary), byteLength=6))
    indexed["accessors"].append(dict(bufferView=1, componentType=5123, count=3, type="SCALAR"))
    indexed["meshes"][0]["primitives"][0]["indices"] = 1
    for tri, status in (((0, 1, 2), "PASS"), ((0, 1, 7), "FAIL")):
        data = binary + struct.pack("<3H", *tri)
        indexed["buffers"][0]["byteLength"] = len(data)
        assert Validator("tiny.glb", encode_glb(indexed, data)).check()["status"] == status, tri
    sparse = copy.deepcopy(indexed)
    sparse["accessors"][0]["sparse"] = dict(count=1, indices=dict(bufferView=1, componentType=5123), values=dict(bufferView=0))
    assert Validator("tiny.glb", encode_glb(sparse, data)).check()["status"] == "FAIL"
    # Exercise nested quaternion/TRS and matrix composition, strips/fans, warnings.
    moved = copy.deepcopy(doc)
    moved["nodes"].append(dict(name="group", translation=[2, 0, 0], rotation=[0, 1, 0, 0], children=[1, 2, 3]))
    moved["nodes"][0]["children"] = [4]
    moved["nodes"][1]["matrix"] = IDENTITY.copy()
    moved["nodes"][1]["matrix"][13] = 2
    moved["meshes"][0]["primitives"][0]["mode"] = 5
    result = Validator("tiny.glb", encode_glb(moved, binary)).check()
    assert result["status"] == "WARN" and result["aabb"] == dict(min=[1., 0., 0.], max=[3., 3., 1.])
    moved["meshes"][0]["primitives"][0]["mode"] = 6
    assert Validator("tiny.glb", encode_glb(moved, binary)).check()["triangles"] == 1
    scaled = copy.deepcopy(doc)
    scaled["nodes"][1]["scale"] = [1, 2, 1]  # child scale is not applied
    assert Validator("tiny.glb", encode_glb(scaled, binary)).check()["status"] == "FAIL"
    # contract rules that are FAIL, not advice
    rooted = [("translation", [0, 0.5, 0]), ("rotation", [0, 1, 0, 0]), ("matrix", IDENTITY[:12] + [0, 1, 0, 1])]
    for key, value in rooted:
        bad_root = copy.deepcopy(doc)
        bad_root["nodes"][0][key] = value  # a moved root; the same transform on a child is fine
        assert Validator("tiny.glb", encode_glb(bad_root, binary)).check()["status"] == "FAIL", key
    child = copy.deepcopy(doc)
    child["nodes"][3].update(translation=[0, 0.5, 0], rotation=[0, 1, 0, 0])
    assert Validator("tiny.glb", encode_glb(child, binary)).check()["status"] == "PASS"
    for key in ("extensionsUsed", "extensionsRequired"):
        ext = copy.deepcopy(doc)
        ext[key] = ["KHR_materials_emissive_strength"]
        assert Validator("tiny.glb", encode_glb(ext, binary)).check()["status"] == "PASS", key
        ext[key] = ["KHR_materials_emissive_strength", "KHR_materials_clearcoat"]
        assert Validator("tiny.glb", encode_glb(ext, binary)).check()["status"] == "FAIL", key
    counted = copy.deepcopy(doc)
    counted["nodes"][0]["extras"]["gteki"]["triangles"] = 2
    assert Validator("tiny.glb", encode_glb(counted, binary)).check()["status"] == "FAIL"
    pit = struct.pack("<9f", -1, -0.5, 0, 1, -0.5, 0, 0, 0.5, -1)
    for params, status in (({}, "FAIL"), (dict(allow_below_floor=True), "PASS")):
        below = copy.deepcopy(doc)
        below["accessors"][0].update(min=[-1, -0.5, -1], max=[1, 0.5, 0])
        below["nodes"][0]["extras"]["gteki"].update(params=params, bounds_m=dict(min=[-1, -0.5, -1], max=[1, 0.5, 0]))
        assert Validator("tiny.glb", encode_glb(below, pit)).check()["status"] == status, params
    # contract §10: gteki_role on the root and every VIS_* node, an allowed value, one value
    def roled(root_role="barriers", vis_role="barriers", extra=None):
        tagged = copy.deepcopy(doc)
        for index, role in ((0, root_role), (1, vis_role)):
            if role is not None:
                tagged["nodes"][index]["extras"] = dict(tagged["nodes"][index].get("extras", {}), gteki_role=role)
        for index, role in (extra or {}).items():
            tagged["nodes"][index]["extras"] = dict(tagged["nodes"][index].get("extras", {}), gteki_role=role)
        return Validator("tiny.glb", encode_glb(tagged, binary)).check()["status"]

    assert roled() == "PASS"
    assert roled(None, None) == "PASS"  # no role anywhere: untagged assets stay valid
    assert roled("transport", "transport") == "PASS" and roled("stairs_ramps", "stairs_ramps") == "PASS"
    assert roled("floor", "floor") == "FAIL"  # outside the allowed set
    assert roled("barriers", "transport") == "FAIL"  # root and VIS_* differ
    assert roled("barriers", None) == "FAIL" and roled(None, "barriers") == "FAIL"  # one of them missing
    assert roled(extra={3: "wall"}) == "FAIL"  # an invalid value on any node is caught
    assert roled(root_role=None, vis_role=None, extra={3: "barriers"}) == "FAIL"  # a socket carrying it alone
    # AABB mismatch stays advice
    aabb = copy.deepcopy(doc)
    aabb["nodes"][0]["extras"]["gteki"]["bounds_m"] = dict(min=[-1, 0, -1], max=[1, 2, 0])
    assert Validator("tiny.glb", encode_glb(aabb, binary)).check()["status"] == "WARN"
    # a texture must sample a UV set the primitive has (texCoord -1 / 1 without TEXCOORD_1 fail)
    for coord, attrs, status in ((0, ("TEXCOORD_0",), "PASS"), (-1, ("TEXCOORD_0",), "FAIL"),
                                 (1, ("TEXCOORD_0",), "FAIL"), (1, ("TEXCOORD_0", "TEXCOORD_1"), "PASS")):
        textured = copy.deepcopy(doc)
        textured["materials"][0]["pbrMetallicRoughness"] = dict(baseColorTexture=dict(index=0, texCoord=coord))
        uv_data = binary + struct.pack("<6f", 0, 0, 1, 0, 0, 1)
        textured["buffers"][0]["byteLength"] = len(uv_data)
        textured["bufferViews"].append(dict(buffer=0, byteOffset=len(binary), byteLength=24))
        textured["accessors"].append(dict(bufferView=1, componentType=5126, count=3, type="VEC2"))
        for attr in attrs:
            textured["meshes"][0]["primitives"][0]["attributes"][attr] = 1
        assert Validator("tiny.glb", encode_glb(textured, uv_data)).check()["status"] == status, (coord, attrs)
    # extension slots and KHR_texture_transform overrides are checked too
    for info, status in ((dict(index=0, extensions=dict(KHR_texture_transform=dict(texCoord=2))), "FAIL"),
                         (dict(index=0, texCoord=2, extensions=dict(KHR_texture_transform=dict(texCoord=0))), "PASS")):
        textured = copy.deepcopy(doc)
        textured["materials"][0]["pbrMetallicRoughness"] = dict(baseColorTexture=info)
        textured["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"] = 0
        assert Validator("tiny.glb", encode_glb(textured, binary)).check()["status"] == status, info
    textured["materials"][0]["extensions"] = dict(KHR_materials_clearcoat=dict(clearcoatTexture=dict(index=0, texCoord=-1)))
    assert Validator("tiny.glb", encode_glb(textured, binary)).check()["status"] == "FAIL"
    # a palette atlas must not be minified through mipmaps
    for sampler, status in ((dict(magFilter=9728, minFilter=9728), "PASS"), (dict(magFilter=9728, minFilter=9984), "FAIL"),
                            (None, "FAIL")):
        pal = copy.deepcopy(textured)
        pal["materials"][0] = dict(name="gteki_palette", pbrMetallicRoughness=dict(baseColorTexture=dict(index=0)))
        pal["textures"] = [dict(source=0, **({"sampler": 0} if sampler else {}))]
        pal["samplers"] = [sampler] if sampler else []
        assert Validator("tiny.glb", encode_glb(pal, binary)).check()["status"] == status, sampler
    # extras are application data: a texture-like dict there is not a sampled slot
    textured["materials"][0]["extensions"] = {}
    textured["materials"][0]["extras"] = dict(sourceTexture=dict(index=123, texCoord=99))
    assert Validator("tiny.glb", encode_glb(textured, binary)).check()["status"] == "PASS"

    def lightmapped(uvs, mode=4, profile=None, attrs=("POSITION", "TEXCOORD_1"), uv_bytes=None, **uv_accessor):
        """Two-triangle mesh (six corners) with the given lightmap UVs (FLOAT VEC2 unless overridden)."""
        lm = copy.deepcopy(doc)
        uv_bytes = struct.pack("<12f", *uvs) if uv_bytes is None else uv_bytes
        data = struct.pack("<18f", *([-1, 0, 0, 1, 0, 0, 0, 1, -1] * 2)) + uv_bytes
        lm["buffers"][0]["byteLength"] = len(data)
        lm["bufferViews"] = [dict(buffer=0, byteLength=72), dict(buffer=0, byteOffset=72, byteLength=len(uv_bytes))]
        lm["accessors"] = [dict(bufferView=0, componentType=5126, count=6, type="VEC3", min=[-1, 0, -1], max=[1, 1, 0]),
                           dict(dict(bufferView=1, componentType=5126, count=6, type="VEC2"), **uv_accessor)]
        lm["meshes"].append(dict(primitives=[dict(attributes={a: i for i, a in enumerate(attrs)}, material=0, mode=mode)]))
        lm["nodes"][1]["mesh"] = 1
        lm["nodes"][0]["extras"]["gteki"]["triangles"] = 2 if mode == 4 else 4
        if profile:
            lm["nodes"][0]["extras"]["gteki"]["profile"] = profile
        return Validator("tiny.glb", encode_glb(lm, data)).check()["status"]

    # lightmap UVs (TEXCOORD_1) of one mesh must not overlap; touching charts are fine
    for shift, status in ((0.25, "FAIL"), (0.5, "PASS")):
        assert lightmapped((0, 0, .5, 0, 0, 1, shift, 0, shift + .5, 0, shift, 1)) == status, shift
    twice = (0, 0, 1, 0, 0, 1) * 2  # the same chart twice, as a strip and as a fan
    assert lightmapped(twice, mode=5) == "FAIL" and lightmapped(twice, mode=6) == "FAIL"
    apart = (0, 0, .5, 0, 0, 1, .5, 0, 1, 0, .5, 1)  # touching at a vertex
    assert lightmapped(apart, profile="mobile") == "PASS"
    assert lightmapped(apart, profile="mobile", attrs=("POSITION",)) == "FAIL"  # mobile requires UV1
    assert lightmapped(apart, attrs=("POSITION",)) == "PASS"  # full builds carry no UV1
    assert lightmapped((math.nan,) + apart[1:]) == "FAIL"
    assert lightmapped((1e6,) + apart[1:]) == "FAIL"  # rejected before the overlap grid
    assert lightmapped((0, 0, .5, .5, 1, 1) + apart[6:]) == "FAIL"  # first triangle (1.4 m^2) collapsed to a line
    assert uv_overlaps([((0, 0), (1e6, 0), (0, 1)), ((0, 0), (1, 0), (0, 1))]) == [(0, 1)]  # coarse grid, same answer
    unorm = struct.pack("<12H", *(round(c * 65535) for c in apart))  # normalized UNORM16 is valid glTF
    assert lightmapped(None, profile="mobile", uv_bytes=unorm, componentType=5123, normalized=True) == "PASS"
    assert lightmapped(None, uv_bytes=unorm, componentType=5123) == "FAIL"  # integer UVs must be normalized
    vec3 = struct.pack("<18f", *(c for k in range(6) for c in apart[2 * k:2 * k + 2] + (0,)))
    assert lightmapped(None, uv_bytes=vec3, type="VEC3") == "FAIL"  # six valid UVs, wrong type only
    assert lightmapped(apart, count=5) == "FAIL"  # one UV per vertex
    assert lightmapped(tuple(c + 2 * (k % 2 == 0) for k, c in enumerate(apart))) == "FAIL"  # outside the unit square

    def thin(pos, uvs):
        """One visual triangle with the given positions and TEXCOORD_1; returns the validation result."""
        tri = copy.deepcopy(doc)
        data = struct.pack("<9f", *pos) + struct.pack("<6f", *uvs)
        lo, hi = [min(pos[k::3]) for k in range(3)], [max(pos[k::3]) for k in range(3)]
        tri["buffers"][0]["byteLength"] = len(data)
        tri["bufferViews"] = [dict(buffer=0, byteLength=36), dict(buffer=0, byteOffset=36, byteLength=24)]
        tri["accessors"] = [dict(bufferView=0, componentType=5126, count=3, type="VEC3", min=lo, max=hi),
                            dict(bufferView=1, componentType=5126, count=3, type="VEC2")]
        tri["meshes"].append(dict(primitives=[dict(attributes=dict(POSITION=0, TEXCOORD_1=1), material=0)]))
        tri["nodes"][1]["mesh"] = 1
        tri["nodes"][0]["extras"]["gteki"]["bounds_m"] = dict(min=lo, max=hi)
        return Validator("tiny.glb", encode_glb(tri, data)).check()

    # visible 10 cm x 10 cm triangle: a fat UV1 chart gives no thin WARN; a 1e-4 x 0.5 UV1 sliver gives
    # the WARN and no FAIL; the same sliver on a 2 mm triangle is below the 1 cm^2 floor and gives nothing
    visible = (0, 0, 0, .1, 0, 0, 0, .1, 0)
    thin_warn = "squashed over 10x across"
    assert not any(thin_warn in m["message"] for m in thin(visible, (0, 0, .5, 0, 0, .5))["messages"])
    sliver = thin(visible, (0, 0, 1e-4, 0, 0, .5))
    assert sliver["status"] == "WARN" and [m["level"] for m in sliver["messages"]] == ["WARN"], sliver
    assert "has 1 lightmap UV (TEXCOORD_1) triangles squashed over 10x across" in sliver["messages"][0]["message"]
    assert not any(thin_warn in m["message"] for m in thin(tuple(c * .02 for c in visible), (0, 0, 1e-4, 0, 0, .5))["messages"])
    # a correctly shaped UV chart at 1/100 scale is not squashed, however small (scale-invariant)
    assert not any(thin_warn in m["message"] for m in thin(visible, (0, 0, .005, 0, 0, .005))["messages"])
    def occluded(uv_a, uv_b, coord=1, attrs_b=("POSITION", "TEXCOORD_1"), same_mesh=False, side=256, strength=None,
                 second_material=False, require=False):
        """Two visual triangles (meshes A and B) whose material carries an occlusionTexture on `coord`."""
        png = b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", side, side) + b"\x08\x00\x00\x00\x00"
        data = struct.pack("<9f", -1, 0, 0, 1, 0, 0, 0, 1, -1) + struct.pack("<6f", *uv_a) + struct.pack("<6f", *uv_b)
        offsets = [0, 36, 60, 84]
        data += png
        occ = dict(index=0, texCoord=coord, **({"strength": strength} if strength is not None else {}))
        oc = copy.deepcopy(doc)
        oc["buffers"][0]["byteLength"] = len(data)
        oc["bufferViews"] = [dict(buffer=0, byteOffset=o, byteLength=n) for o, n in zip(offsets, (36, 24, 24, len(png)))]
        oc["accessors"] = [dict(bufferView=0, componentType=5126, count=3, type="VEC3", min=[-1, 0, -1], max=[1, 1, 0]),
                           dict(bufferView=1, componentType=5126, count=3, type="VEC2"),
                           dict(bufferView=2, componentType=5126, count=3, type="VEC2")]
        oc["materials"] = [dict(name="gteki_test", occlusionTexture=occ)] + ([dict(name="gteki_other")] if second_material else [])
        oc["textures"], oc["images"] = [dict(source=0)], [dict(bufferView=3, mimeType="image/png")]
        mesh_b = {a: (2 if a == "TEXCOORD_1" else 0) for a in attrs_b}
        oc["meshes"] = [dict(primitives=[dict(attributes=dict(POSITION=0, TEXCOORD_1=1), material=0)]),
                        dict(primitives=[dict(attributes=mesh_b, material=1 if second_material else 0)])]
        oc["nodes"] = [oc["nodes"][0], dict(name="VIS_a", mesh=0), dict(name="VIS_b", mesh=0 if same_mesh else 1),
                       dict(name="COL_test-colonly", mesh=0)]
        oc["nodes"][0]["children"] = [1, 2, 3]
        oc["nodes"][0]["extras"]["gteki"]["triangles"] = 2
        return Validator("tiny.glb", encode_glb(oc, data), require_occlusion=require).check()["status"]

    # baked occlusion: texCoord 1, TEXCOORD_1 on every primitive, one lightmap atlas across all visual nodes
    left, right = (0, 0, .5, 0, 0, 1), (.5, 0, 1, 0, .5, 1)
    assert occluded(left, right) == "PASS"
    assert occluded(left, right, coord=0) == "FAIL"  # occlusion must sample the lightmap layer
    assert occluded(left, right, attrs_b=("POSITION",)) == "FAIL"  # a primitive without TEXCOORD_1
    assert occluded(left, left) == "FAIL" and occluded(left, (.25, 0, .75, 0, .25, 1)) == "FAIL"  # overlap across two meshes
    assert occluded(left, right, same_mesh=True) == "FAIL"  # one mesh instanced twice overlaps itself
    assert occluded(left, right, strength=0.5) == "FAIL" and occluded(left, right, strength=1.0) == "PASS"
    assert occluded(left, right, side=300) == "FAIL" and occluded(left, right, side=512) == "PASS"
    assert occluded(left, right, side=128) == "PASS" and occluded(left, right, side=64) == "FAIL"
    assert occluded(left, right, second_material=True) == "FAIL"  # one visual material lacks the shared map
    assert occluded(left, left, coord=1) == "FAIL" and occluded(left, right, attrs_b=("POSITION",), coord=1) == "FAIL"
    assert lightmapped(apart) == "PASS"  # no occlusion map: neither required nor warned about ...
    assert Validator("tiny.glb", encode_glb(doc, binary)).check()["status"] == "PASS"
    assert Validator("tiny.glb", encode_glb(doc, binary), require_occlusion=True).check()["status"] == "FAIL"  # ... unless asked
    print("PASS self-test: valid, broken, truncated, NaN, out-of-range index, sparse, transformed, strip and fan GLBs, "
          "root identity, extensions, triangle count, gteki_role (allowed value, root and VIS_* agree), below floor, texCoord (core, extension, transform, extras), palette mipmaps, mobile finish PNG normal, lightmap (overlap, strips, fans, range, NaN, collapsed, thin slivers, mobile UV1), occlusion (texCoord, TEXCOORD_1, joint atlas overlap, strength, size, shared map)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manifest", type=Path, help="validate external shared AO atlases and per-asset UV1 cells")
    parser.add_argument("--require-occlusion", action="store_true",
                        help="FAIL a GLB whose visual materials lack the baked occlusion map (default: allowed during the rollout)")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if not args.files and not args.self_test:
        parser.error("provide GLB files or --self-test")
    results = []
    manifest = None
    if args.manifest:
        try:
            manifest = AtlasManifest(args.manifest)
        except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error) as error:
            print(f"FAIL {args.manifest}: {error}")
            return 1
    for path in args.files:
        try:
            result = Validator(str(path), path.read_bytes(), args.require_occlusion, manifest).check()
        except OSError as error:
            result = dict(file=str(path), status="FAIL", messages=[dict(level="FAIL", message=str(error))])
        results.append(result)
        for item in result["messages"]:
            print(f"{item['level']} {path}: {item['message']}")
    counts = {status: sum(result["status"] == status for result in results) for status in ("PASS", "WARN", "FAIL")}
    if results:
        print(f"Summary: {len(results)} files; {counts['PASS']} PASS, {counts['WARN']} WARN, {counts['FAIL']} FAIL")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(dict(contract=CONTRACT, summary=counts, files=results), indent=2, allow_nan=False) + "\n")
    return int(counts["FAIL"] > 0)


if __name__ == "__main__":
    sys.exit(main())
