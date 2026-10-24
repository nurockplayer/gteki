#!/usr/bin/env python3
"""Stdlib synthetic-GLB tests for C3 packing and --manifest validation."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib


def sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


atlas = sibling("ao_atlas")
validator = sibling("validate_glb")
PIXELS = bytes((0, 2, 30, 40, 1, 3, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160))
UVS = ((0.125, 0.125), (0.875, 0.125), (0.125, 0.875))


def fixture(key="n_a", interleaved=False):
    binary, views = bytearray(), []

    def add(raw, **extra):
        binary.extend(b"\0" * (-len(binary) % 4))
        views.append(dict(buffer=0, byteOffset=len(binary), byteLength=len(raw), **extra))
        binary.extend(raw)
        return len(views) - 1

    position = add(struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 0, 1))
    uv0 = add(struct.pack("<6f", *(c for uv in UVS for c in uv)))
    ao = add(atlas.write_png(4, 4, PIXELS))
    if interleaved:
        uv1 = add(b"".join(struct.pack("<3f", u, v, 123) for u, v in UVS), byteStride=12)
    else:
        uv1 = add(struct.pack("<6f", *(c for uv in UVS for c in uv)))
    normal = add(atlas.write_png(2, 2, bytes([128, 129, 130, 131])))
    albedo = add(atlas.write_png(2, 2, bytes([40, 41, 42, 43])))
    add(b"unreferenced-orphan-data")
    meta = {key: "synthetic" for key in validator.REQUIRED}
    meta.update(contract=validator.CONTRACT, id=key, params={}, triangles=1,
                bounds_m=dict(min=[0, 0, 0], max=[1, 0, 1]))
    doc = dict(asset=dict(version="2.0"), scene=0, scenes=[dict(nodes=[0])],
               nodes=[dict(name=key, extras=dict(gteki=meta), children=[1, 2]),
                      dict(name="VIS_test", mesh=0), dict(name="COL_test-colonly", mesh=1)],
               materials=[dict(name="gteki_test", normalTexture=dict(index=0), occlusionTexture=dict(index=1, texCoord=1),
                               pbrMetallicRoughness=dict(baseColorTexture=dict(index=2)))],
               textures=[dict(source=0, sampler=0), dict(source=1, sampler=1), dict(source=2, sampler=2)],
               images=[dict(bufferView=normal, mimeType="image/png"), dict(bufferView=ao, mimeType="image/png"),
                       dict(bufferView=albedo, mimeType="image/png")],
               samplers=[dict(minFilter=9728), dict(minFilter=9987), dict(minFilter=9729)],
               meshes=[dict(primitives=[dict(attributes=dict(POSITION=0, TEXCOORD_0=1, TEXCOORD_1=2), material=0)]),
                       dict(primitives=[dict(attributes=dict(POSITION=0))])],
               accessors=[dict(bufferView=position, componentType=5126, count=3, type="VEC3", min=[0, 0, 0], max=[1, 0, 1]),
                          dict(bufferView=uv0, componentType=5126, count=3, type="VEC2"),
                          dict(bufferView=uv1, componentType=5126, count=3, type="VEC2", min=[.125, .125], max=[.875, .875])],
               bufferViews=views, buffers=[dict(byteLength=len(binary))])
    return doc, bytes(binary)


def read_uvs(doc, binary):
    a = doc["accessors"][2]
    v = doc["bufferViews"][a["bufferView"]]
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    return [struct.unpack_from("<2f", binary, start + i * v.get("byteStride", 8)) for i in range(a["count"])]


def input_library(root, sorted_keys=False):
    (root / "glb").mkdir(parents=True)
    assets = []
    for key in ("n_a", "n_b", "other"):
        doc, binary = fixture(key)
        data = atlas.encode_glb(doc, binary)
        file = f"glb/{key}.glb"
        (root / file).write_bytes(data)
        assets.append(dict(id=key, file=file, sha256=atlas.digest(data), bytes=len(data),
                           textures=dict(gteki_test=dict(maps=["albedo", "normal", "occlusion"], occlusion_res=4))))
    manifest = dict(catalog="synthetic", kit_version="0.1", assets=assets)
    (root / "manifest.json").write_text(json.dumps(manifest, sort_keys=sorted_keys))
    return manifest


class AtlasTests(unittest.TestCase):
    def test_round_trip_texel_equality_top_left_and_interleaved(self):
        for interleaved in (False, True):
            with self.subTest(interleaved=interleaved):
                doc, binary = fixture(interleaved=interleaved)
                cell, size = [4, 4, 4, 4], (512, 20)  # NPOT height and nonzero x/y catch flips/scales.
                new_doc, new_bin = atlas.read_glb(atlas.rewrite_glb(atlas.encode_glb(doc, binary), "n_a", cell, size))
                pixels = bytearray([255]) * (size[0] * size[1])
                for y in range(4):
                    pixels[(y + 4) * 512 + 4:(y + 4) * 512 + 8] = PIXELS[y * 4:y * 4 + 4]
                w, h, decoded = atlas.read_png(atlas.write_png(*size, pixels))
                for old, new in zip(UVS, read_uvs(new_doc, new_bin)):
                    self.assertEqual(PIXELS[int(old[1] * 4) * 4 + int(old[0] * 4)],
                                     decoded[int(new[1] * h) * w + int(new[0] * w)])
                uv = read_uvs(new_doc, new_bin)
                self.assertEqual(new_doc["accessors"][2]["min"], [min(v[i] for v in uv) for i in (0, 1)])
                if interleaved:
                    view = new_doc["bufferViews"][new_doc["accessors"][2]["bufferView"]]
                    self.assertEqual([struct.unpack_from("<f", new_bin, view["byteOffset"] + i * 12 + 8)[0]
                                      for i in range(3)], [123] * 3)

    def test_packing_fills_gaps_and_picks_smallest_area(self):
        # the Ikebukuro nosing shape: 52 maps at 128 px and 5 at 256 px fill 1024x1152 exactly
        sizes = {**{f"n{i:02d}": 128 for i in range(52)}, **{f"b{i}": 256 for i in range(5)}}
        size, cells = atlas.pack_cells(sizes)
        self.assertEqual(size, (1024, 1152))
        self.assertEqual(sum(w * h for _, _, w, h in cells.values()), 1024 * 1152)

    def test_packing_alignment_no_overlap_and_id_ties(self):
        sizes = {"z": 128, "b": 256, "a": 256, **{str(i): 64 for i in range(61)}}
        size, cells = atlas.pack_cells(sizes)
        self.assertIn(size[0], (512, 1024, 2048))
        self.assertEqual(size[1] % 64, 0)
        self.assertLessEqual(size[1], 2048)
        self.assertEqual(cells["a"], [0, 0, 256, 256])
        items = list(cells.values())
        for i, (x, y, w, h) in enumerate(items):
            self.assertEqual((x % w, y % h), (0, 0))
            self.assertLessEqual(x + w, size[0])
            self.assertLessEqual(y + h, size[1])
            for ox, oy, ow, oh in items[i + 1:]:
                self.assertFalse(x < ox + ow and ox < x + w and y < oy + oh and oy < y + h)
        with self.assertRaises(ValueError):
            atlas.pack_cells({"huge": 4096})

    def test_half_rounding_and_build(self):
        side, pixels = atlas.half_map(4, PIXELS)
        self.assertEqual((side, pixels), (2, bytes((2, 55, 115, 135))))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_library(root / "in")
            atlas.build(root / "in", root / "out", {"nosing": "n_*"}, half=True)
            m = json.loads((root / "out/manifest.json").read_text())
            self.assertEqual(m["assets"][0]["ao_atlas"]["cell"][2:], [2, 2])
            w, _, got = atlas.read_png((root / "out/atlas/nosing_ao.png").read_bytes())
            self.assertEqual(got[:2] + got[w:w + 2], pixels)

    def test_non_float_sparse_and_shared_failures(self):
        for change, message in (
            (lambda d: d["accessors"][2].update(componentType=5121, normalized=True), "FLOAT"),
            (lambda d: d["accessors"][2].update(sparse={}), "sparse"),
            (lambda d: d["meshes"].append(copy.deepcopy(d["meshes"][0])), "shared outside"),
            (lambda d: d["nodes"].append(dict(name="outside", mesh=0)), "shared outside"),
            (lambda d: d["meshes"][0]["primitives"][0]["attributes"].update(TEXCOORD_0=2), "shared outside"),
            (lambda d: d["accessors"].append(copy.deepcopy(d["accessors"][2])), "bytes alias"),
        ):
            with self.subTest(message=message):
                doc, binary = fixture()
                change(doc)
                with self.assertRaisesRegex(ValueError, message):
                    atlas.rewrite_glb(atlas.encode_glb(doc, binary), "n_a", [0, 0, 4, 4], (512, 4))

    def test_shared_in_asset_uv_accessor_rewritten_once(self):
        doc, binary = fixture()
        doc["meshes"][0]["primitives"].append(copy.deepcopy(doc["meshes"][0]["primitives"][0]))
        out_doc, out_bin = atlas.read_glb(atlas.rewrite_glb(atlas.encode_glb(doc, binary), "n_a", [4, 0, 4, 4], (512, 4)))
        self.assertEqual(read_uvs(out_doc, out_bin)[0], ((4 + .125 * 4) / 512, .125))

    def test_shared_ao_resources_fail_loudly(self):
        for mutate, message in (
            (lambda d: d["textures"][0].update(sampler=1), "sampler is shared"),
            (lambda d: d["textures"][0].update(source=1), "sampler is shared"),
            (lambda d: d["materials"][0]["normalTexture"].update(index=1), "another texture slot"),
            (lambda d: d["bufferViews"].append(copy.deepcopy(d["bufferViews"][2])), "bytes overlap"),
            (lambda d: d["scenes"].append(dict(nodes=[1])), "same asset root"),
        ):
            with self.subTest(message=message):
                doc, binary = fixture()
                mutate(doc)
                with self.assertRaisesRegex(ValueError, message):
                    atlas.rewrite_glb(atlas.encode_glb(doc, binary), "n_a", [0, 0, 4, 4], (512, 4))

    def test_orphan_free_bin_and_other_resources_preserved(self):
        doc, binary = fixture()
        original = [atlas.view_bytes(doc, binary, image["bufferView"]) for image in doc["images"]]
        new, data = atlas.read_glb(atlas.rewrite_glb(atlas.encode_glb(doc, binary), "n_a", [0, 0, 4, 4], (512, 4)))
        self.assertNotIn(original[1], data)
        self.assertNotIn(b"unreferenced-orphan-data", data)
        self.assertEqual([atlas.view_bytes(new, data, i["bufferView"]) for i in new["images"]], [original[0], original[2]])
        self.assertEqual(new["samplers"], [doc["samplers"][0], doc["samplers"][2]])
        self.assertEqual(new["textures"], [dict(source=0, sampler=0), dict(source=1, sampler=1)])
        self.assertEqual(new["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"], 1)
        self.assertNotIn("occlusionTexture", new["materials"][0])
        cursor = 0
        for view in new["bufferViews"]:
            self.assertEqual(view["byteOffset"], (cursor + 3) // 4 * 4)
            self.assertEqual(data[cursor:view["byteOffset"]], b"\0" * (view["byteOffset"] - cursor))
            cursor = view["byteOffset"] + view["byteLength"]
        self.assertEqual(len(data), cursor)
        self.assertEqual(new["buffers"][0]["byteLength"], cursor)
        referenced = {o["bufferView"] for o in atlas.objects(new) if "bufferView" in o}
        self.assertEqual(referenced, set(range(len(new["bufferViews"]))))

    def test_png_all_filters_and_crc(self):
        raw, previous = bytearray(), bytes(4)
        for kind in range(5):
            row = bytes((kind * 11 + i * 5 for i in range(4)))
            raw.append(kind)
            for x, v in enumerate(row):
                a, b, c = row[x - 1] if x else 0, previous[x], previous[x - 1] if x else 0
                p = a + b - c
                paeth = min(((abs(p - a), 0, a), (abs(p - b), 1, b), (abs(p - c), 2, c)))[2]
                raw.append((v - (0, a, b, (a + b) // 2, paeth)[kind]) & 255)
            previous = row
        png = (atlas.PNG_SIGNATURE + atlas.png_chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 5, 8, 0, 0, 0, 0))
               + atlas.png_chunk(b"IDAT", zlib.compress(raw)) + atlas.png_chunk(b"IEND", b""))
        self.assertEqual(atlas.read_png(png)[2], bytes(k * 11 + i * 5 for k in range(5) for i in range(4)))
        with self.assertRaisesRegex(ValueError, "CRC"):
            atlas.read_png(png[:-1] + bytes([png[-1] ^ 1]))

    def test_manifest_round_trip_subset_and_key_order(self):
        for ordered in (False, True):
            with self.subTest(sorted=ordered), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = input_library(root / "in", sorted_keys=ordered)
                atlas.build(root / "in", root / "out", {"nosing": "n_*"}, ids={"n_b"})
                m = json.loads((root / "out/manifest.json").read_text())
                self.assertEqual(atlas.sorted_json(m), ordered)
                for index in (0, 2):
                    self.assertEqual(m["assets"][index], source["assets"][index])
                    f = source["assets"][index]["file"]
                    self.assertEqual((root / "in" / f).read_bytes(), (root / "out" / f).read_bytes())
                processed = m["assets"][1]
                self.assertNotIn("occlusion_res", processed["textures"]["gteki_test"])
                self.assertNotIn("occlusion", processed["textures"]["gteki_test"]["maps"])
                data = (root / "out" / processed["file"]).read_bytes()
                self.assertEqual((processed["sha256"], processed["bytes"]), (atlas.digest(data), len(data)))
                self.assertEqual(processed["ao_atlas"]["kind"], "nosing")
                self.assertIn("synthetic/0.1", m["atlases"]["nosing"]["provenance"])

    def test_cli_determinism_and_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_library(root / "in")
            (root / "ids").write_text("n_b\n")
            for output in ("one", "two"):
                result = subprocess.run([sys.executable, "-I", str(Path(atlas.__file__)), "--build", str(root / "in"),
                                         "--out", str(root / output), "--kind", "nosing=n_*", "--ids", str(root / "ids")],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            files = sorted(p.relative_to(root / "one") for p in (root / "one").rglob("*") if p.is_file())
            self.assertEqual(files, sorted(p.relative_to(root / "two") for p in (root / "two").rglob("*") if p.is_file()))
            for file in files:
                self.assertEqual((root / "one" / file).read_bytes(), (root / "two" / file).read_bytes())

    def test_refuse_input_write_and_ambiguous_kinds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_library(root / "in")
            before = (root / "in/manifest.json").read_bytes()
            for output in (root / "in", root / "in/out", root):
                with self.assertRaisesRegex(ValueError, "disjoint"):
                    atlas.build(root / "in", output, {"nosing": "n_*"})
            with self.assertRaisesRegex(ValueError, "multiple kinds"):
                atlas.build(root / "in", root / "out", {"one": "n_*", "two": "*"})
            self.assertEqual((root / "in/manifest.json").read_bytes(), before)


class ManifestValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        input_library(self.root / "in")
        atlas.build(self.root / "in", self.root / "out", {"nosing": "n_*"})
        self.path = self.root / "out/manifest.json"
        self.manifest = json.loads(self.path.read_text())
        self.data = (self.root / "out/glb/n_a.glb").read_bytes()

    def check(self, data=None):
        self.path.write_text(json.dumps(self.manifest))
        return validator.Validator("n_a.glb", self.data if data is None else data, require_occlusion=True, manifest=self.path).check()

    def assert_failure(self, result, message):
        self.assertEqual(result["status"], "FAIL", result)
        self.assertTrue(any(message in m["message"] for m in result["messages"]), result)

    def test_pass_and_cli(self):
        self.assertEqual(self.check()["status"], "PASS")
        result = subprocess.run([sys.executable, "-I", str(Path(validator.__file__)), "--require-occlusion", "--manifest",
                                 str(self.path), str(self.root / "out/glb/n_a.glb")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 PASS", result.stdout)

    def test_sha_mismatch(self):
        self.manifest["atlases"]["nosing"]["sha256"] = "0" * 64
        self.assert_failure(self.check(), "sha256 mismatch")

    def test_overlap(self):
        self.manifest["assets"][1]["ao_atlas"]["cell"] = self.manifest["assets"][0]["ao_atlas"]["cell"]
        self.assert_failure(self.check(), "overlap")

    def test_uv_outside_cell_and_half_texel_tolerance(self):
        doc, binary = atlas.read_glb(self.data)
        data = bytearray(binary)
        view = doc["bufferViews"][doc["accessors"][2]["bufferView"]]
        width = self.manifest["atlases"]["nosing"]["size_px"][0]
        struct.pack_into("<f", data, view["byteOffset"], (4 + .49) / width)
        self.assertEqual(self.check(atlas.encode_glb(doc, data))["status"], "PASS")
        struct.pack_into("<f", data, view["byteOffset"], (4 + .75) / width)
        self.assert_failure(self.check(atlas.encode_glb(doc, data)), "outside cell")
        struct.pack_into("<f", data, view["byteOffset"], -.49 / width)
        self.assertEqual(self.check(atlas.encode_glb(doc, data))["status"], "PASS")
        struct.pack_into("<f", data, view["byteOffset"], -.75 / width)
        self.assert_failure(self.check(atlas.encode_glb(doc, data)), "outside cell")

    def test_leftover_occlusion_texture(self):
        doc, binary = atlas.read_glb(self.data)
        doc["materials"][0]["occlusionTexture"] = dict(index=0, texCoord=1)
        self.assert_failure(self.check(atlas.encode_glb(doc, binary)), "still carries occlusionTexture")

    def test_invalid_cells(self):
        for cell in ([0, 0, 3, 3], [1, 0, 4, 4], [512, 0, 4, 4], [0, 0, 4, 2]):
            with self.subTest(cell=cell):
                self.manifest["assets"][0]["ao_atlas"]["cell"] = cell
                self.assert_failure(self.check(), "aligned power-of-two")

    def test_missing_wrong_size_and_non_grayscale_atlas(self):
        info = self.manifest["atlases"]["nosing"]
        file = self.root / "out" / info["path"]
        raw = file.read_bytes()
        file.unlink()
        self.assert_failure(self.check(), "No such file")
        file.write_bytes(raw)
        info["size_px"] = [1, 1]
        self.assert_failure(self.check(), "size_px mismatch")
        rgb = (atlas.PNG_SIGNATURE + atlas.png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
               + atlas.png_chunk(b"IDAT", zlib.compress(bytes(4))) + atlas.png_chunk(b"IEND", b""))
        file.write_bytes(rgb)
        info.update(sha256=atlas.digest(rgb), size_px=[1, 1], bytes=len(rgb))
        self.assert_failure(self.check(), "8-bit grayscale")

    def test_missing_uv_and_no_manifest_behavior(self):
        self.assertEqual(validator.Validator("n_a.glb", self.data).check()["status"], "PASS")
        self.assert_failure(validator.Validator("n_a.glb", self.data, require_occlusion=True).check(), "without occlusionTexture")
        doc, binary = atlas.read_glb(self.data)
        del doc["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_1"]
        self.assert_failure(self.check(atlas.encode_glb(doc, binary)), "ao_atlas requires one")


if __name__ == "__main__":
    unittest.main(verbosity=2)
