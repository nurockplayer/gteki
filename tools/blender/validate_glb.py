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
import json
import math
from pathlib import Path
import struct
import sys

CONTRACT = "gteki-asset/0.1"
PALETTES = ("gteki_palette", "gteki_palette_blend")  # mobile swatch atlases
REQUIRED = ("contract id family variant version generator params bounds_m triangles "
            "dimension_basis fidelity navigation provenance license").split()
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


def uv_overlaps(tris, eps=1e-10):
    """Index pairs of UV triangles that overlap by more than `eps` of the unit square.

    Lightmap charts must not overlap; triangles that only share an edge or a vertex do not count."""
    ccw = {}
    for i, t in enumerate(tris):
        a = _area(t)
        if abs(a) > 1e-14:
            ccw[i] = tuple(t) if a > 0 else tuple(t[::-1])
    # cells no smaller than the largest triangle, so a huge one cannot enumerate millions of cells
    extent = max((max(p[k] for p in t) - min(p[k] for p in t) for t in ccw.values() for k in (0, 1)), default=0)
    cell = max(1 / 64, extent)
    grid = {}
    for i, t in ccw.items():
        xs, ys = [p[0] for p in t], [p[1] for p in t]
        for gx in range(math.floor(min(xs) / cell), math.floor(max(xs) / cell) + 1):
            for gy in range(math.floor(min(ys) / cell), math.floor(max(ys) / cell) + 1):
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


class Validator:
    def __init__(self, name, data):
        self.name = name
        self.data = data
        self.result = dict(file=name, bytes=len(data), triangles=0, materials=0,
                           images=0, image_bytes=0, nodes=0, sockets=[], aabb=None,
                           messages=[])

    def message(self, level, text):
        self.result["messages"].append(dict(level=level, message=text))

    def check(self):
        try:
            self._check()
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error, OverflowError, RecursionError) as error:
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
        for extension in doc.get("extensionsUsed", []):
            if extension in ("KHR_draco_mesh_compression", "EXT_meshopt_compression"):
                self.message("FAIL", f"forbidden compression: {extension}")
            elif extension != "KHR_materials_emissive_strength":
                self.message("WARN", f"extension outside canonical baseline: {extension}")
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
        if meta.get("contract") != CONTRACT:
            self.message("FAIL", f"contract must equal {CONTRACT}")
        if meta.get("id") != stem:
            self.message("FAIL", "metadata id must equal file stem")
        if not isinstance(meta.get("params"), dict):
            self.message("FAIL", "metadata params must be an object")
        if not isinstance(meta.get("triangles"), int) or isinstance(meta.get("triangles"), bool) or meta["triangles"] < 0:
            self.message("FAIL", "metadata triangles must be a non-negative integer")
        materials = doc.get("materials", [])
        self.result.update(nodes=len(nodes), materials=len(materials), images=len(doc.get("images", [])))
        for material in materials:
            if not material.get("name", "").startswith("gteki_"):
                self.message("FAIL", f"material name lacks gteki_ prefix: {material.get('name')!r}")
            if material.get("name") in PALETTES:
                # 4x4 swatches in a 64x64 atlas: any mip below 16x16 averages unrelated swatches
                for slot, info in texture_infos(material):
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
        # Check all nodes, including unused nodes, for transform/naming violations.
        locals_ = []
        for index, node in enumerate(nodes):
            matrix, scales, negative = local_matrix(node)
            locals_.append(matrix)
            if negative:
                self.message("FAIL", f"node {index} {node.get('name')!r} has negative scale/reflection")
            if any(abs(s - 1) > 1e-6 for s in scales):
                self.message("FAIL" if index == root_index else "WARN", f"node {index} has non-unit scale {scales}")
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

        checked_meshes = set()

        def lightmap_overlap(node):
            """TEXCOORD_1 is a lightmap: one UV space per mesh, shared by its primitives, inside the
            unit square and without overlap. Mobile builds carry it on every visual triangle primitive."""
            if node["mesh"] in checked_meshes:
                return
            checked_meshes.add(node["mesh"])
            tris = []
            collapsed = 0
            for primitive in meshes[node["mesh"]].get("primitives", []):
                mode = primitive.get("mode", 4)
                if mode not in (4, 5, 6):
                    continue
                if "TEXCOORD_1" not in primitive.get("attributes", {}):
                    if meta.get("profile") == "mobile":
                        self.message("FAIL", f"mesh {node['mesh']} has no lightmap UV (TEXCOORD_1); mobile requires one")
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
                if any(c < -1e-6 or c > 1 + 1e-6 for p in uv for c in p):
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
                    if (positions and abs(_area(tri)) <= COLLAPSED_UV_AREA
                            and _area3(*(positions[i] for i in corners)) >= VISIBLE_GEOMETRY_M2):
                        collapsed += 1
            if collapsed:
                self.message("FAIL", f"node {node.get('name')!r} has {collapsed} lightmap UV (TEXCOORD_1) triangles "
                             "collapsed to a point or line although their geometry is at least 1 mm^2")
            overlapping = uv_overlaps(tris)
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
                self.message("WARN", f"bounds extend below floor: min.y={low[1]:.6f}")
        if self.result["triangles"] != meta.get("triangles"):
            self.message("WARN", f"visual triangles {self.result['triangles']} differ from metadata {meta.get('triangles')}")

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
    moved["nodes"][0]["translation"] = [2, 0, 0]
    moved["nodes"][0]["rotation"] = [0, 1, 0, 0]
    moved["nodes"][1]["matrix"] = IDENTITY.copy()
    moved["nodes"][1]["matrix"][13] = 2
    moved["meshes"][0]["primitives"][0]["mode"] = 5
    result = Validator("tiny.glb", encode_glb(moved, binary)).check()
    assert result["status"] == "WARN" and result["aabb"] == dict(min=[1., 0., 0.], max=[3., 3., 1.])
    moved["meshes"][0]["primitives"][0]["mode"] = 6
    assert Validator("tiny.glb", encode_glb(moved, binary)).check()["triangles"] == 1
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
    print("PASS self-test: valid, broken, truncated, NaN, out-of-range index, sparse, transformed, strip and fan GLBs, "
          "texCoord (core, extension, transform, extras), palette mipmaps, lightmap (overlap, strips, fans, range, NaN, collapsed, mobile UV1)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if not args.files and not args.self_test:
        parser.error("provide GLB files or --self-test")
    results = []
    for path in args.files:
        try:
            result = Validator(str(path), path.read_bytes()).check()
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
