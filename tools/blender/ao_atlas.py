#!/usr/bin/env python3
"""Pack per-id Cycles AO into shared atlases without Blender or third-party packages.

Cells retain PNG row order and glTF's top-left UV origin. Full builds copy decoded
8-bit texels exactly; --half averages 2x2 blocks, rounding half up. Only UV1 and
AO resource references change in processed GLBs. Outputs have no timestamps.
"""
import argparse
import fnmatch
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import sys
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def power_of_two(value):
    return type(value) is int and value > 0 and value & (value - 1) == 0


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)


def read_png(data):
    """Decode non-interlaced grayscale8 PNG, checking chunks, CRCs and all five filters."""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG")
    offset, compressed, header, ended = 8, bytearray(), None, False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("truncated PNG chunk")
        size, tag = struct.unpack_from(">I4s", data, offset)
        body = data[offset + 8:offset + 8 + size]
        if offset + 12 + size > len(data):
            raise ValueError("truncated PNG chunk body")
        crc = struct.unpack_from(">I", data, offset + 8 + size)[0]
        if crc != zlib.crc32(tag + body) & 0xffffffff:
            raise ValueError("PNG CRC mismatch")
        if header is None and tag != b"IHDR":
            raise ValueError("PNG must start with IHDR")
        if tag == b"IHDR":
            if header is not None or size != 13:
                raise ValueError("invalid PNG IHDR")
            header = struct.unpack(">IIBBBBB", body)
            w, h, depth, color, compression, filtering, interlace = header
            if not w or not h or (depth, color, compression, filtering, interlace) != (8, 0, 0, 0, 0):
                raise ValueError("PNG must be non-interlaced 8-bit grayscale")
        elif tag == b"IDAT":
            compressed.extend(body)
        elif tag == b"IEND":
            if size or offset + 12 != len(data):
                raise ValueError("invalid PNG IEND/trailing bytes")
            ended = True
            break
        elif not tag[0] & 32:
            raise ValueError(f"unsupported PNG critical chunk {tag!r}")
        offset += size + 12
    if not ended or not compressed:
        raise ValueError("PNG lacks IDAT/IEND")
    try:
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed)
        raw += decoder.flush()
    except zlib.error as error:
        raise ValueError(f"invalid PNG deflate: {error}") from error
    if not decoder.eof or decoder.unused_data or len(raw) != h * (w + 1):
        raise ValueError("PNG scanline length/deflate mismatch")
    pixels, previous = bytearray(), bytearray(w)
    for y in range(h):
        kind = raw[y * (w + 1)]
        row = bytearray(raw[y * (w + 1) + 1:(y + 1) * (w + 1)])
        if kind not in range(5):
            raise ValueError("unsupported PNG filter")
        for x in range(w):
            a, b, c = row[x - 1] if x else 0, previous[x], previous[x - 1] if x else 0
            if kind == 1:
                predictor = a
            elif kind == 2:
                predictor = b
            elif kind == 3:
                predictor = (a + b) // 2
            elif kind == 4:
                p = a + b - c
                predictor = min(((abs(p - a), 0, a), (abs(p - b), 1, b), (abs(p - c), 2, c)))[2]
            else:
                predictor = 0
            row[x] = (row[x] + predictor) & 255
        pixels.extend(row)
        previous = row
    return w, h, bytes(pixels)


def write_png(width, height, pixels):
    """Mirror texsynth.png_bytes(gray=True): None/Sub/Up score, fixed ties, zlib 9."""
    if len(pixels) != width * height:
        raise ValueError("PNG pixel count mismatch")
    rows, previous = [], None
    for y in range(height):
        row = pixels[y * width:(y + 1) * width]
        sub = bytes((v - (row[x - 1] if x else 0)) & 255 for x, v in enumerate(row))
        options = [(0, row), (1, sub)]
        if previous is not None:
            options.append((2, bytes((v - p) & 255 for v, p in zip(row, previous))))
        kind, best = min(options, key=lambda option: (sum(min(v, 256 - v) for v in option[1]), option[0]))
        rows.append(bytes([kind]) + best)
        previous = row
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return PNG_SIGNATURE + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + png_chunk(b"IEND", b"")


def half_map(side, pixels):
    if side < 2 or side % 2 or len(pixels) != side * side:
        raise ValueError("--half needs an even square map")
    return side // 2, bytes((pixels[y * side + x] + pixels[y * side + x + 1]
                             + pixels[(y + 1) * side + x] + pixels[(y + 1) * side + x + 1] + 2) // 4
                            for y in range(0, side, 2) for x in range(0, side, 2))


def read_glb(data):
    if len(data) < 28 or struct.unpack_from("<4sII", data) != (b"glTF", 2, len(data)):
        raise ValueError("invalid GLB header")
    chunks, offset = [], 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("truncated GLB chunk")
        size, kind = struct.unpack_from("<I4s", data, offset)
        if size % 4 or offset + 8 + size > len(data):
            raise ValueError("invalid GLB chunk length")
        chunks.append((kind, data[offset + 8:offset + 8 + size]))
        offset += size + 8
    if [kind for kind, _ in chunks] != [b"JSON", b"BIN\0"]:
        raise ValueError("expected JSON and BIN only")
    doc, binary = json.loads(chunks[0][1]), chunks[1][1]
    buffers = doc.get("buffers", [])
    if (doc.get("asset", {}).get("version") != "2.0" or len(buffers) != 1 or "uri" in buffers[0]
            or not buffers[0]["byteLength"] <= len(binary) <= buffers[0]["byteLength"] + 3):
        raise ValueError("expected one embedded glTF 2.0 buffer")
    return doc, binary[:buffers[0]["byteLength"]]


def encode_glb(doc, binary):
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    raw += b" " * (-len(raw) % 4)
    binary += b"\0" * (-len(binary) % 4)
    body = struct.pack("<I4s", len(raw), b"JSON") + raw + struct.pack("<I4s", len(binary), b"BIN\0") + binary
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


def objects(value):
    """Structural glTF objects, including extension objects but excluding opaque extras."""
    if isinstance(value, dict):
        yield value
        for key, child in value.items():
            if key != "extras":
                yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def texture_infos(material):
    for obj in objects(material):
        for key, child in obj.items():
            if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                yield child


def effective_texcoord(info):
    return info.get("extensions", {}).get("KHR_texture_transform", {}).get("texCoord", info.get("texCoord", 0))


def uv_in_cell(uv, cell, size):
    """Bilinear footprint remains inside the cell; tolerance is in texels."""
    return all(math.isfinite(c) and start + 0.5 - 1e-6 <= c * total <= start + span - 0.5 + 1e-6
               for c, start, span, total in zip(uv, cell[:2], cell[2:], size))


def min_inset(uvs, cell, size):
    """Smallest distance, in atlas texels, from any UV to its cell's edge."""
    return min(min(c * total - start, start + span - c * total)
               for uv in uvs for c, start, span, total in zip(uv, cell[:2], cell[2:], size))


def isolated_mip(smallest_cell, inset):
    """Deepest mip level whose bilinear footprint stays inside every cell. At level L a texel spans
    2**L atlas texels and bilinear reads up to half a level-L texel past the sample point, so the
    UV inset must reach 2**(L-1); box mips also stay inside a cell only while 2**L <= the cell."""
    level = 0
    while 2 ** (level + 1) <= smallest_cell and inset + 1e-6 >= 2 ** level:
        level += 1
    return level


def view_bytes(doc, binary, index):
    view = doc["bufferViews"][index]
    start, size = view.get("byteOffset", 0), view["byteLength"]
    if view.get("buffer") != 0 or start < 0 or size < 0 or start + size > len(binary):
        raise ValueError("invalid embedded bufferView")
    return binary[start:start + size]


def ao_resources(doc, binary):
    """Locate the one dedicated AO image; refuse resources also used by other slots."""
    textures = {m["occlusionTexture"]["index"] for m in doc.get("materials", []) if "occlusionTexture" in m}
    if not textures:
        raise ValueError("asset has no occlusionTexture")
    for material in doc.get("materials", []):
        occ = material.get("occlusionTexture")
        if occ and (occ.get("texCoord", 0) != 1 or occ.get("strength", 1) != 1 or occ.get("extensions")):
            raise ValueError("AO must sample untransformed texCoord 1 at strength 1")
        for info in texture_infos({k: v for k, v in material.items() if k != "occlusionTexture"}):
            if effective_texcoord(info) == 1:
                raise ValueError("non-AO texture samples texCoord 1; rewriting UV1 would change its sampling")
            if info["index"] in textures:
                raise ValueError("AO texture is shared with another texture slot")
    images = {doc["textures"][i]["source"] for i in textures}
    if len(images) != 1:
        raise ValueError("asset must share one AO image")
    image_index = next(iter(images))
    image = doc["images"][image_index]
    if image.get("mimeType") != "image/png" or "uri" in image or "bufferView" not in image:
        raise ValueError("AO must be an embedded PNG")
    samplers = {doc["textures"][i]["sampler"] for i in textures if "sampler" in doc["textures"][i]}
    for i, texture in enumerate(doc["textures"]):
        if i not in textures:
            if any(obj.get("source") == image_index for obj in objects(texture)) or texture.get("sampler") in samplers:
                raise ValueError("AO image/sampler is shared with another texture")
    for obj in objects(doc):
        if obj is not image and obj.get("bufferView") == image["bufferView"]:
            raise ValueError("AO bufferView is shared")
    ao_view = doc["bufferViews"][image["bufferView"]]
    ao_start = ao_view.get("byteOffset", 0)
    ao_end = ao_start + ao_view["byteLength"]
    for i, view in enumerate(doc["bufferViews"]):
        start = view.get("byteOffset", 0)
        if i != image["bufferView"] and start < ao_end and ao_start < start + view["byteLength"]:
            raise ValueError("AO bufferView bytes overlap another bufferView")
    raw = view_bytes(doc, binary, image["bufferView"])
    w, h, pixels = read_png(raw)
    if w != h or not power_of_two(w):
        raise ValueError("AO map must be a power-of-two square")
    return textures, images, samplers, w, pixels


def asset_nodes(doc, asset_id):
    """Nodes reachable from the active scene's single named asset root."""
    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    if len(roots) != 1 or doc["nodes"][roots[0]].get("name") != asset_id:
        raise ValueError("expected one asset root matching id")
    owned = set()

    def visit(i):
        if i in owned:
            raise ValueError("asset has a cycle or multiple parents")
        owned.add(i)
        for child in doc["nodes"][i].get("children", []):
            visit(child)

    visit(roots[0])
    return owned


def asset_uv_accessors(doc, asset_id):
    """Reject UV1 shared outside the active asset or used for any other purpose."""
    owned = asset_nodes(doc, asset_id)
    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    if any(scene.get("nodes", []) != roots for scene in doc["scenes"]):
        raise ValueError("scenes must use the same asset root")
    meshes = {doc["nodes"][i]["mesh"] for i in owned if "mesh" in doc["nodes"][i]}
    outside = {n["mesh"] for i, n in enumerate(doc["nodes"]) if i not in owned and "mesh" in n}
    targets, attributes = set(), set()
    for i in meshes:
        for primitive in doc["meshes"][i].get("primitives", []):
            attrs = primitive.get("attributes", {})
            if "TEXCOORD_1" in attrs:
                if i in outside:
                    raise ValueError("TEXCOORD_1 accessor shared outside this asset")
                targets.add(attrs["TEXCOORD_1"])
                attributes.add(id(attrs))
    if not targets:
        raise ValueError("asset has no TEXCOORD_1")
    for obj in objects(doc):
        for key, value in obj.items():
            if key in ("attributes",):
                if any(v in targets and not (id(value) in attributes and k == "TEXCOORD_1") for k, v in value.items()):
                    raise ValueError("TEXCOORD_1 accessor shared outside this asset or UV1 slot")
            elif key in ("indices", "input", "output", "inverseBindMatrices") and type(value) is int and value in targets:
                raise ValueError("TEXCOORD_1 accessor shared with other data")
        # Morph target dictionaries are accessor references, too.
        for target in obj.get("targets", []) if isinstance(obj.get("targets"), list) else []:
            if any(v in targets for v in target.values()):
                raise ValueError("TEXCOORD_1 accessor shared with morph data")
    return targets


def rewrite_uvs(doc, binary, asset_id, cell, size):
    targets = asset_uv_accessors(doc, asset_id)
    ranges, rewrites, inset = [], [], math.inf
    for i in sorted(targets):
        accessor = doc["accessors"][i]
        if "sparse" in accessor:
            raise ValueError("sparse TEXCOORD_1 is unsupported")
        if accessor.get("componentType") != 5126 or accessor.get("type") != "VEC2" or accessor.get("normalized"):
            raise ValueError("TEXCOORD_1 must be FLOAT VEC2")
        view = doc["bufferViews"][accessor["bufferView"]]
        view_bytes(doc, binary, accessor["bufferView"])
        start, stride, count = accessor.get("byteOffset", 0), view.get("byteStride", 8), accessor["count"]
        if (type(count) is not int or count < 1 or start < 0 or start % 4 or stride < 8 or stride % 4
                or start + (count - 1) * stride + 8 > view["byteLength"]):
            raise ValueError("invalid TEXCOORD_1 storage")
        offsets = [view.get("byteOffset", 0) + start + n * stride for n in range(count)]
        ranges.extend((offset, offset + 8, i) for offset in offsets)
        values = []
        for offset in offsets:
            u, v = struct.unpack_from("<2f", binary, offset)
            if not all(math.isfinite(c) and 0 <= c <= 1 for c in (u, v)):
                raise ValueError("original TEXCOORD_1 outside unit square or non-finite")
            values.append(((cell[0] + u * cell[2]) / size[0], (cell[1] + v * cell[3]) / size[1]))
        # Check the serialized float32 coordinates before mutating any bytes.
        values = [struct.unpack("<2f", struct.pack("<2f", *uv)) for uv in values]
        if not all(uv_in_cell(uv, cell, size) for uv in values):
            raise ValueError("TEXCOORD_1 outside cell: requires a half-texel inset")
        rewrites.append((accessor, offsets, values))
        inset = min(inset, min_inset(values, cell, size))
    # Accessors may use interleaved storage, but may never alias UV bytes.
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
    sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    uv_bytes = set()
    for start, end, _ in ranges:
        if any(b in uv_bytes for b in range(start, end)):
            raise ValueError("TEXCOORD_1 accessors alias each other")
        uv_bytes.update(range(start, end))

    def check_storage(view_index, offset, count, width, interleaved=True):
        view_bytes(doc, binary, view_index)
        view = doc["bufferViews"][view_index]
        start = view.get("byteOffset", 0) + offset
        stride = view.get("byteStride", width) if interleaved else width
        if (offset < 0 or count < 0 or stride < width
                or offset + ((count - 1) * stride + width if count else 0) > view["byteLength"]):
            raise ValueError("invalid accessor storage")
        if any(b in uv_bytes for n in range(count) for b in range(start + n * stride, start + n * stride + width)):
            raise ValueError("TEXCOORD_1 bytes alias another accessor")

    for i, accessor in enumerate(doc["accessors"]):
        if i in targets:
            continue
        width = components[accessor["type"]] * sizes[accessor["componentType"]]
        if accessor["type"].startswith("MAT"):
            dimension = int(accessor["type"][-1])
            width = dimension * ((dimension * sizes[accessor["componentType"]] + 3) // 4 * 4)
        if "bufferView" in accessor:
            check_storage(accessor["bufferView"], accessor.get("byteOffset", 0), accessor["count"], width)
        if "sparse" in accessor:
            sparse = accessor["sparse"]
            indices, values = sparse["indices"], sparse["values"]
            check_storage(indices["bufferView"], indices.get("byteOffset", 0), sparse["count"],
                          sizes[indices["componentType"]], False)
            check_storage(values["bufferView"], values.get("byteOffset", 0), sparse["count"], width, False)
    for image in doc.get("images", []):
        if "bufferView" in image:
            view = doc["bufferViews"][image["bufferView"]]
            start = view.get("byteOffset", 0)
            if any(b in uv_bytes for b in range(start, start + view["byteLength"])):
                raise ValueError("TEXCOORD_1 bytes alias an image")
    for accessor, offsets, values in rewrites:
        for offset, value in zip(offsets, values):
            struct.pack_into("<2f", binary, offset, *value)
        for key, fun in (("min", min), ("max", max)):
            if key in accessor:
                accessor[key] = [fun(v[axis] for v in values) for axis in (0, 1)]
    return inset


def remove_resources(doc, removed, key):
    items, mapping = [], {}
    for i, item in enumerate(doc.get(key, [])):
        if i not in removed:
            mapping[i] = len(items)
            items.append(item)
    doc[key] = items
    return mapping


def compact_binary(doc, binary):
    used = {obj["bufferView"] for obj in objects(doc) if "bufferView" in obj}
    mapping = remove_resources(doc, set(range(len(doc["bufferViews"]))) - used, "bufferViews")
    packed = bytearray()
    for view in doc["bufferViews"]:
        packed.extend(b"\0" * (-len(packed) % 4))
        raw = view_bytes({"bufferViews": [view]}, binary, 0)
        view["byteOffset"] = len(packed)
        packed.extend(raw)
    for obj in objects(doc):
        if "bufferView" in obj:
            obj["bufferView"] = mapping[obj["bufferView"]]
    doc["buffers"][0]["byteLength"] = len(packed)
    return bytes(packed)


def rewrite_glb(data, asset_id, cell, size, insets=None):
    doc, binary = read_glb(data)
    textures, images, samplers, _, _ = ao_resources(doc, binary)
    binary = bytearray(binary)
    inset = rewrite_uvs(doc, binary, asset_id, cell, size)
    if insets is not None:
        insets[asset_id] = inset
    for material in doc.get("materials", []):
        material.pop("occlusionTexture", None)
    texmap = remove_resources(doc, textures, "textures")
    imgmap = remove_resources(doc, images, "images")
    sampmap = remove_resources(doc, samplers, "samplers")
    for material in doc.get("materials", []):
        for info in texture_infos(material):
            info["index"] = texmap[info["index"]]
    for texture in doc["textures"]:
        for obj in objects(texture):
            if "source" in obj:
                obj["source"] = imgmap[obj["source"]]
        if "sampler" in texture:
            texture["sampler"] = sampmap[texture["sampler"]]
    return encode_glb(doc, compact_binary(doc, binary))


def pack_cells(sizes):
    """Largest first, id ties; each cell takes the first free slot aligned to its own size, scanning
    rows top to bottom and left to right (so small cells fill the gaps beside large ones). Of the
    widths 512, 1024 and 2048, the smallest atlas area wins, then the smaller width. The height is a
    multiple of the smallest cell (NPOT is fine for WebGL2 and Godot) and at most 2048."""
    ordered = sorted(sizes, key=lambda key: (-sizes[key], key))
    if not ordered or any(not power_of_two(s) for s in sizes.values()):
        raise ValueError("packing needs power-of-two cells")
    largest, unit, candidates = sizes[ordered[0]], min(sizes.values()), []
    for width in (512, 1024, 2048):
        if largest > width:
            continue
        cells, used, bottom = {}, set(), 0  # used: occupied unit squares (column, row)
        for key in ordered:
            side, span = sizes[key], sizes[key] // unit
            y = 0
            while key not in cells:
                for x in range(0, width, side):
                    squares = {(x // unit + i, y // unit + j) for i in range(span) for j in range(span)}
                    if not squares & used:
                        cells[key], used = [x, y, side, side], used | squares
                        bottom = max(bottom, y + side)
                        break
                y += side
        height = (bottom + unit - 1) // unit * unit  # cells stay aligned to their own size (see max_isolated_mip)
        if height <= 2048:
            candidates.append((width * height, width, height, cells))
    if not candidates:
        raise ValueError("cells do not fit an atlas with width/height <= 2048")
    _, width, height, cells = min(candidates, key=lambda c: (c[0], c[1]))
    return (width, height), cells


def sorted_json(value):
    return all(list(obj) == sorted(obj) for obj in json_objects(value))


def json_objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from json_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from json_objects(child)


def local_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"path escapes build directory: {relative!r}")
    return path


def build(in_dir, out_dir, kinds, half=False, ids=None):
    in_dir, out_dir = Path(in_dir).resolve(), Path(out_dir).resolve()
    if out_dir.is_relative_to(in_dir) or in_dir.is_relative_to(out_dir):
        raise ValueError("input and output directories must be disjoint")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise ValueError("output directory must be empty")
    manifest = json.loads((in_dir / "manifest.json").read_text())
    if "atlases" in manifest or any("ao_atlas" in asset for asset in manifest["assets"]):
        raise ValueError("input is already atlas-packed; run on an original build")
    sort_keys = sorted_json(manifest)
    assets, seen, selected, groups = manifest["assets"], set(), {}, {}
    for asset in assets:
        key = asset["id"]
        if key in seen:
            raise ValueError(f"duplicate asset id {key}")
        seen.add(key)
        matched = [kind for kind, pattern in kinds.items() if fnmatch.fnmatchcase(key, pattern)]
        if len(matched) > 1:
            raise ValueError(f"id {key} matches multiple kinds")
        source = local_path(in_dir, asset["file"])
        if source.parent != in_dir / "glb" or source.stem != key or source.suffix != ".glb":
            raise ValueError("expected glb/<id>.glb asset path")
        if not matched or (ids is not None and key not in ids):
            continue
        doc, binary = read_glb(source.read_bytes())
        _, _, _, side, pixels = ao_resources(doc, binary)
        if half:
            side, pixels = half_map(side, pixels)
        selected[key] = matched[0]
        groups.setdefault(matched[0], {})[key] = (side, pixels)
    if ids is not None and ids - seen:
        raise ValueError(f"unknown --ids: {sorted(ids - seen)}")
    if not selected:
        raise ValueError("no matching asset ids")
    manifest.setdefault("atlases", {})
    placements, stats, atlas_files = {}, {}, {}
    for kind, maps in groups.items():
        size, cells = pack_cells({key: item[0] for key, item in maps.items()})
        width, height = size
        pixels = bytearray([255]) * (width * height)
        for key, (side, source) in maps.items():
            x, y, _, _ = cells[key]
            for row in range(side):
                start = (y + row) * width + x
                pixels[start:start + side] = source[row * side:(row + 1) * side]
            placements[key] = cells[key], size
        raw = write_png(width, height, pixels)
        path = f"atlas/{kind}_ao.png"
        atlas_files[path] = raw
        provenance = (f"derived: packed from the per-id Cycles AO bakes of {manifest.get('catalog', '')}/{manifest.get('kit_version', '')} "
                      "by tools/blender/ao_atlas.py; GTEki contributors")
        manifest["atlases"][kind] = dict(path=path, sha256=digest(raw), size_px=list(size), bytes=len(raw),
                                         provenance=provenance)  # max_isolated_mip follows the preflight
        stats[kind] = dict(size_px=list(size), fill_ratio=sum(side * side for side, _ in maps.values()) / (width * height),
                           bytes=len(raw), ids=len(maps))
    # Preflight every selected asset before creating output, including later assets.
    # Discard each result to keep peak memory bounded by one GLB rather than the build.
    insets = {}
    for asset in assets:
        if asset["id"] in selected:
            cell, size = placements[asset["id"]]
            rewrite_glb((in_dir / asset["file"]).read_bytes(), asset["id"], cell, size, insets)
    for kind, maps in groups.items():
        # deepest mip whose bilinear footprint stays in every cell of this kind (see isolated_mip);
        # a loader that must never mix cells clamps its max mip level here
        inset = min(insets[key] for key in maps)
        level = isolated_mip(min(side for side, _ in maps.values()), inset)
        manifest["atlases"][kind]["max_isolated_mip"] = level
        stats[kind].update(min_inset_texels=inset, max_isolated_mip=level)
    (out_dir / "glb").mkdir(parents=True, exist_ok=True)
    (out_dir / "atlas").mkdir(exist_ok=True)
    for path, raw in atlas_files.items():
        (out_dir / path).write_bytes(raw)
    for asset in assets:
        key = asset["id"]
        source, target = in_dir / asset["file"], out_dir / asset["file"]
        if key not in selected:
            shutil.copyfile(source, target)
            continue
        cell, size = placements[key]
        raw = rewrite_glb(source.read_bytes(), key, cell, size)
        target.write_bytes(raw)
        asset.update(sha256=digest(raw), bytes=len(raw), ao_atlas=dict(kind=selected[key], cell=cell))
        asset.pop("occlusion_res", None)
        for plan in asset.get("textures", {}).values():
            plan["maps"] = [name for name in plan.get("maps", []) if name != "occlusion"]
            plan.pop("occlusion_res", None)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=sort_keys, ensure_ascii=False, allow_nan=False) + "\n")
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--kind", required=True, action="append", metavar="KIND=GLOB")
    parser.add_argument("--half", action="store_true")
    parser.add_argument("--ids", type=Path)
    args = parser.parse_args()
    try:
        kinds = {}
        for spec in args.kind:
            kind, pattern = spec.split("=", 1)
            if not re.fullmatch(r"[A-Za-z0-9_-]+", kind) or not pattern or kind in kinds:
                raise ValueError("--kind needs a unique safe name and a non-empty glob")
            kinds[kind] = pattern
        ids = {line.strip() for line in args.ids.read_text().splitlines() if line.strip()} if args.ids else None
        stats = build(args.build, args.out, kinds, args.half, ids)
    except (OSError, ValueError, KeyError, IndexError, TypeError, struct.error) as error:
        parser.exit(1, f"FAIL: {error}\n")
    for kind, info in stats.items():
        print(f"{kind}: {info['ids']} ids; {info['size_px'][0]}x{info['size_px'][1]}; "
              f"fill {info['fill_ratio']:.6%}; {info['bytes']} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
