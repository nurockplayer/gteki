"""Texture/download budget report and regression check for kit libraries (stdlib only).

  python3 tools/blender/texture_budget.py assets/library [--compare OLD_LIBRARY]
      [--layout tools/blender/showcase/concourse_demo.json ...]
      [--check tools/blender/catalog/budget.json] [--json out.json]

Per library: total bytes, embedded image bytes, image instances vs unique images
(by content hash), and estimated GPU texture memory. GPU memory is an estimate:
width x height x 4 bytes (RGBA8, how WebGL/Godot upload JPEG/PNG/WebP) x 4/3 for
the mip chain; KTX2 images count 1 byte per pixel (BC7/ASTC 4x4) x 4/3.

Per layout (showcase-style {"items": [{"glb": ".../<id>.glb"}]}), three loading
strategies are costed:
  per_instance  every placed item loads its GLB (what a naive loader does)
  per_asset     each distinct GLB is loaded once and instanced (cache by URI)
  bundle        one kit bundle of the used assets: each unique image once

--check fails (exit 1) when a library exceeds the budget file or breaks a rule:
  * an image's size exceeds the manifest's texture plan for its material
  * the same image bytes are embedded twice in one GLB
"""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_glb import encode_glb, parse_glb  # noqa: E402

MIB = 1024 * 1024


def image_size(raw):
    """(width, height, kind) from JPEG/PNG/WebP/KTX2 headers."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", raw[16:24])
        return w, h, "png"
    if raw[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(raw):
            if raw[i] != 0xFF:
                break
            marker, length = raw[i + 1], struct.unpack(">H", raw[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", raw[i + 5:i + 9])
                return w, h, "jpeg"
            i += 2 + length
        raise ValueError("JPEG without SOF")
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        chunk = raw[12:16]
        if chunk == b"VP8X":
            w = 1 + int.from_bytes(raw[24:27], "little")
            h = 1 + int.from_bytes(raw[27:30], "little")
        elif chunk == b"VP8L":
            bits = int.from_bytes(raw[21:25], "little")
            w, h = 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
        else:
            w, h = struct.unpack("<HH", raw[26:30])
            w, h = w & 0x3FFF, h & 0x3FFF
        return w, h, "webp"
    if raw[:12] == b"\xabKTX 20\xbb\r\n\x1a\n":
        w, h = struct.unpack("<II", raw[20:28])
        return w, h, "ktx2"
    raise ValueError("unknown image format")


def gpu_bytes(w, h, kind):
    return w * h * (1 if kind == "ktx2" else 4) * 4 / 3


def scan_glb(path):
    data = path.read_bytes()
    doc, binary = parse_glb(data)
    views = doc.get("bufferViews", [])
    images = []
    for index, image in enumerate(doc.get("images", [])):
        view = views[image["bufferView"]]
        start = view.get("byteOffset", 0)
        raw = binary[start:start + view["byteLength"]]
        w, h, kind = image_size(raw)
        images.append(dict(index=index, sha=hashlib.sha256(raw).hexdigest(), bytes=len(raw),
                           w=w, h=h, kind=kind, gpu=gpu_bytes(w, h, kind)))
    # which materials sample each image (for the texture-plan check)
    users, sampled = {}, {}
    textures = doc.get("textures", [])
    for material in doc.get("materials", []):
        refs = [material.get("pbrMetallicRoughness", {}).get(k) for k in ("baseColorTexture", "metallicRoughnessTexture")]
        refs += [material.get(k) for k in ("normalTexture", "emissiveTexture", "occlusionTexture")]
        for ref in refs:
            if ref:
                tex = textures[ref["index"]]
                source = tex.get("source")
                for ext in tex.get("extensions", {}).values():
                    source = ext.get("source", source)
                users.setdefault(source, set()).add(material.get("name"))
                sampled.setdefault(material.get("name"), set()).add(source)
    for image in images:
        image["materials"] = sorted(users.get(image["index"], ()))
    return dict(file=path.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), images=images,
                material_images={k: len(v) for k, v in sampled.items()})


def scan_library(root):
    root = Path(root)
    glbs = {p.stem: scan_glb(p) for p in sorted((root / "glb").glob("*.glb"))}
    manifest = json.loads((root / "manifest.json").read_text())
    meta = {k: v for k, v in manifest.items() if k != "assets"}
    return glbs, {a["id"]: a for a in manifest["assets"]}, meta


def summarize(glbs, ids=None, counts=None):
    """Cost of loading `ids` (each `counts[id]` times when strategy is per-instance)."""
    ids = list(glbs) if ids is None else ids
    counts = counts or {i: 1 for i in ids}
    total = sum(glbs[i]["bytes"] * counts[i] for i in ids)
    inst = [im for i in ids for _ in range(counts[i]) for im in glbs[i]["images"]]
    unique = {im["sha"]: im for im in inst}
    return dict(
        glbs=sum(counts[i] for i in ids),
        bytes=total,
        image_bytes=sum(im["bytes"] for im in inst),
        image_instances=len(inst),
        unique_images=len(unique),
        unique_image_bytes=sum(im["bytes"] for im in unique.values()),
        gpu_instances=sum(im["gpu"] for im in inst),
        gpu_unique=sum(im["gpu"] for im in unique.values()),
    )


def layout_costs(glbs, layout_path):
    items = json.loads(Path(layout_path).read_text())["items"]
    counts = {}
    for item in items:
        stem = Path(item["glb"]).stem
        counts[stem] = counts.get(stem, 0) + 1
    ids = list(counts)
    per_instance = summarize(glbs, ids, counts)
    per_asset = summarize(glbs, ids)
    geometry = per_asset["bytes"] - per_asset["image_bytes"]
    bundle = dict(download=geometry + per_asset["unique_image_bytes"], gpu=per_asset["gpu_unique"])
    return dict(
        layout=str(layout_path), items=len(items), distinct_assets=len(ids),
        per_instance=dict(download=per_instance["bytes"], gpu=per_instance["gpu_instances"]),
        per_asset=dict(download=per_asset["bytes"], gpu=per_asset["gpu_instances"]),
        bundle=bundle,
    )


def budget_applies(budget, manifest_meta):
    """Byte limits only hold for the library they were measured on (catalog + resolution);
    the per-image rules hold for every library."""
    want = budget.get("applies_to", {})
    return all(Path(str(manifest_meta.get(k, ""))).name == Path(str(v)).name if k == "catalog"
               else manifest_meta.get(k) == v for k, v in want.items())


def check(glbs, manifest, budget, manifest_meta=None):
    problems = [f"{aid}: in manifest.json but its GLB is missing" for aid in manifest if aid not in glbs]
    for aid, glb in glbs.items():
        if aid not in manifest:
            problems.append(f"{aid}: GLB is not in manifest.json")
            continue
        # the manifest is the integrity record consumers (and bundle_kit) trust
        for key in ("sha256", "bytes"):
            if key in manifest[aid] and manifest[aid][key] != glb[key]:
                problems.append(f"{aid}: GLB {key} {glb[key]} differs from manifest {manifest[aid][key]}")
        plan = manifest[aid].get("textures")
        cap = (manifest_meta or {}).get("texture_resolution")
        for name, entry in (plan or {}).items():
            if cap and entry["res"] > cap:
                problems.append(f"{aid}: {name} plan res {entry['res']} exceeds texture_resolution {cap}")
        for name, n in glb.get("material_images", {}).items():
            if plan is not None and name in plan and n > len(plan[name]["maps"]):
                problems.append(f"{aid}: {name} samples {n} images but its plan keeps {plan[name]['maps']}")
        seen = {}
        for im in glb["images"]:
            if im["sha"] in seen:
                problems.append(f"{aid}: image {im['index']} duplicates image {seen[im['sha']]} (same bytes)")
            seen[im["sha"]] = im["index"]
            if plan is None:
                continue
            for name in im["materials"]:
                if name in plan and max(im["w"], im["h"]) > plan[name]["res"]:
                    problems.append(f"{aid}: {name} image {im['w']}x{im['h']} exceeds plan {plan[name]['res']}")
    if manifest_meta is not None and not budget_applies(budget, manifest_meta):
        return problems
    limits = budget.get("limits", {})
    s = summarize(glbs)
    measured = {
        "library_mib": s["bytes"] / MIB,
        "unique_image_mib": s["unique_image_bytes"] / MIB,
        "gpu_unique_mib": s["gpu_unique"] / MIB,
        "gpu_all_glbs_mib": s["gpu_instances"] / MIB,
    }
    for key, value in measured.items():
        if key in limits and value > limits[key]:
            problems.append(f"budget {key}: {value:.2f} > {limits[key]}")
    return problems


def _png_header(w, h, salt=b""):
    """Enough of a PNG for image_size(); `salt` makes distinct bytes."""
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", w, h) + b"\x08\x02\x00\x00\x00" + salt


def _fake_glb(images, material_refs):
    """GLB with `images` (bytes) and one material sampling `material_refs` image indices."""
    binary, views = b"", []
    for raw in images:
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary += raw + b"\0" * (-len(raw) % 4)
    slots = ["baseColorTexture", "metallicRoughnessTexture"]
    pbr = {slot: {"index": i} for slot, i in zip(slots, material_refs)}
    material = {"name": "gteki_test", "pbrMetallicRoughness": pbr}
    if len(material_refs) > 2:
        material["normalTexture"] = {"index": material_refs[2]}
    doc = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": len(binary)}], "bufferViews": views,
           "images": [{"bufferView": i, "mimeType": "image/png"} for i in range(len(images))],
           "textures": [{"source": i} for i in range(len(images))], "materials": [material]}
    return encode_glb(doc, binary)


def self_test():
    import tempfile

    budget = {"applies_to": {"catalog": "kit.json", "texture_resolution": 1024}, "limits": {"library_mib": 1.0}}
    meta = {"catalog": "../x/kit.json", "texture_resolution": 1024}
    plan = {"gteki_test": {"res": 512, "maps": ["albedo", "orm"]}}
    cases = {
        "clean": ([_png_header(512, 512, b"a"), _png_header(256, 512, b"b")], [0, 1], 0),
        "oversized": ([_png_header(1024, 1024, b"a"), _png_header(512, 512, b"b")], [0, 1], 1),
        "duplicate": ([_png_header(512, 512, b"a"), _png_header(512, 512, b"a")], [0, 1], 1),
        "extra_map": ([_png_header(512, 512, b"a"), _png_header(512, 512, b"b"), _png_header(512, 512, b"c")], [0, 1, 2], 1),
    }
    with tempfile.TemporaryDirectory() as tmp:
        for name, (images, refs, want) in cases.items():
            path = Path(tmp) / f"gteki_{name}.glb"
            path.write_bytes(_fake_glb(images, refs))
            glbs = {path.stem: scan_glb(path)}
            got = check(glbs, {path.stem: {"textures": plan}}, budget, meta)
            assert len(got) == want, (name, got)
        # byte limits: enforced for the matching library, skipped for another catalog / resolution
        glbs = {path.stem: scan_glb(path)}
        tight = dict(budget, limits={"library_mib": 1e-9})
        assert any("budget library_mib" in p for p in check(glbs, {path.stem: {"textures": plan}}, tight, meta))
        for other in ({"catalog": "station.json", "texture_resolution": 1024}, {"catalog": "kit.json", "texture_resolution": 2048}):
            assert not any("budget" in p for p in check(glbs, {path.stem: {"textures": plan}}, tight, other))
        assert check(glbs, {}, budget, meta) == [f"{path.stem}: GLB is not in manifest.json"]
        # a plan above the library's texture_resolution (e.g. an uncapped supplied image)
        path.write_bytes(_fake_glb([_png_header(2048, 1024, b"p")], [0]))
        big = {path.stem: {"textures": {"gteki_test": {"res": 2048, "maps": ["albedo"]}}}}
        assert check({path.stem: scan_glb(path)}, big, budget, meta) == [
            f"{path.stem}: gteki_test plan res 2048 exceeds texture_resolution 1024"]
        glbs = {path.stem: scan_glb(path)}
        # file digest and size must match the manifest entry
        g = glbs[path.stem]
        assert check(glbs, {path.stem: {"sha256": g["sha256"], "bytes": g["bytes"]}}, budget, meta) == []
        stale = check(glbs, {path.stem: {"sha256": "0" * 64, "bytes": g["bytes"] + 1}}, budget, meta)
        assert [p.split(":")[1].split()[1] for p in stale] == ["sha256", "bytes"], stale
        both = {path.stem: {"textures": plan}, "gteki_gone": {"textures": plan}}
        assert [p for p in check(glbs, both, budget, meta) if "gteki_gone" in p] == ["gteki_gone: in manifest.json but its GLB is missing"]
    for w, h in ((512, 256), (1024, 1024)):
        assert image_size(_png_header(w, h)) == (w, h, "png")
    print("texture_budget self-test: PASS")


def fmt(n):
    return f"{n / MIB:8.2f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("library", nargs="?")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--compare", help="another library directory (e.g. a baseline copy)")
    ap.add_argument("--layout", action="append", default=[])
    ap.add_argument("--check", help="budget JSON; exit 1 on violations")
    ap.add_argument("--json", help="write the full report as JSON")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        if not args.library:
            return 0
    if not args.library:
        ap.error("library directory required")

    libs = [("current", args.library)] + ([("compare", args.compare)] if args.compare else [])
    report = {}
    for label, root in libs:
        glbs, manifest, meta = scan_library(root)
        report[label] = dict(library=str(root), summary=summarize(glbs),
                             layouts=[layout_costs(glbs, l) for l in args.layout])
        if label == "current":
            current = (glbs, manifest, meta)

    print(f"{'MiB':>34} {'current':>8}" + (f" {'compare':>8}" if args.compare else ""))
    rows = [("library download (all GLBs)", "bytes"), ("embedded image bytes", "image_bytes"),
            ("unique image bytes", "unique_image_bytes"), ("GPU est. all GLBs loaded once", "gpu_instances"),
            ("GPU est. unique images", "gpu_unique")]
    for title, key in rows:
        line = f"{title:>34} {fmt(report['current']['summary'][key])}"
        if args.compare:
            line += f" {fmt(report['compare']['summary'][key])}"
        print(line)
    for label in report:
        s = report[label]["summary"]
        print(f"{label}: {s['image_instances']} image instances, {s['unique_images']} unique")
    for i, layout in enumerate(args.layout):
        print(f"\nlayout {layout}")
        for strategy in ("per_instance", "per_asset", "bundle"):
            line = f"{strategy:>34}"
            for label in report:
                c = report[label]["layouts"][i][strategy]
                line += f"  dl {fmt(c['download'])} gpu {fmt(c['gpu'])}"
            print(line)
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2) + "\n")
    if args.check:
        glbs, manifest, meta = current
        budget = json.loads(Path(args.check).read_text())
        problems = check(glbs, manifest, budget, meta)
        if not budget_applies(budget, meta):
            print(f"budget limits skipped: library is not {budget.get('applies_to')} (per-image rules still checked)")
        for p in problems:
            print(f"FAIL {p}")
        print(f"budget check: {'FAIL' if problems else 'PASS'}")
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
