"""Batch-generate kit GLBs from a catalog.

Run through Blender (no GUI):

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/build.py -- \
      --catalog tools/blender/catalog/kit_v0_1.json --out assets/library

Options:
  --only id1,id2     build a subset (manifest entries for others are kept)
  --tex-res N        texture resolution (default 1024; 2048/4096 for Godot HQ)
  --save-blend DIR   also save an editable .blend per asset (keep outside Git)
  --manifest PATH    manifest path (default <out>/manifest.json)
"""

import argparse
import glob
import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from gteki_assets import contract  # noqa: E402
from gteki_assets.families import PLACEMENT, REGISTRY  # noqa: E402


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--tex-res", type=int, default=contract.DEFAULT_TEX_RES)
    ap.add_argument("--save-blend", default="")
    ap.add_argument("--manifest", default="")
    args = ap.parse_args(argv)

    with open(args.catalog) as f:
        catalog = json.load(f)
    only = {s for s in args.only.split(",") if s}
    glb_dir = os.path.join(args.out, "glb")
    manifest_path = args.manifest or os.path.join(args.out, "manifest.json")

    unknown = sorted(only - {item["id"] for item in catalog["assets"]})
    if unknown:
        sys.exit(f"[gteki] --only names ids not in {args.catalog}: {', '.join(unknown)}")
    previous = {}
    if only and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            old = json.load(f)
        if old.get("texture_resolution") != args.tex_res:
            # one manifest describes one texture resolution; mixing would mislabel kept GLBs
            sys.exit(f"[gteki] --only with --tex-res {args.tex_res} but {manifest_path} is "
                     f"{old.get('texture_resolution')}; rebuild everything or use another --out")
        previous = {a["id"]: a for a in old.get("assets", [])}

    # Export into a staging directory and publish only if every asset succeeds,
    # so a failed build never leaves a manifest that disagrees with glb/.
    os.makedirs(glb_dir, exist_ok=True)
    staging = tempfile.mkdtemp(prefix=".build-", dir=args.out)
    try:
        _build(args, catalog, only, previous, glb_dir, staging, manifest_path)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _build(args, catalog, only, previous, glb_dir, staging, manifest_path):
    entries = []
    failures = []
    for item in catalog["assets"]:
        aid = item["id"]
        if only and aid not in only:
            if aid in previous:
                entries.append(previous[aid])
            continue
        gen = REGISTRY.get(item["generator"])
        if gen is None:
            failures.append((aid, f"unknown generator {item['generator']}"))
            continue
        t0 = time.time()
        try:
            asset = gen(aid, item.get("params", {}), args.tex_res)
            if item.get("dimension_basis"):
                asset.dimension_basis = item["dimension_basis"]
            if item.get("notes"):
                asset.notes = item["notes"]
            asset.placement = item.get("placement") or PLACEMENT.get(item["generator"], "free")
            asset.build()
            entry = asset.export(staging, save_blend_dir=args.save_blend or None)
        except Exception as e:  # keep building the rest, fail at the end
            import traceback

            traceback.print_exc()
            failures.append((aid, repr(e)))
            continue
        entry["tags"] = item.get("tags", [])
        entry["build_seconds"] = round(time.time() - t0, 2)
        entries.append(entry)
        print(f"[gteki] {aid}: {entry['triangles']} tris, {entry['bytes'] / 1024:.0f} KiB, {entry['build_seconds']} s", flush=True)

    if failures:
        for aid, err in failures:
            print(f"[gteki] FAILED {aid}: {err}", file=sys.stderr)
        print(f"[gteki] nothing published; {glb_dir} and {manifest_path} are unchanged", file=sys.stderr)
        sys.exit(1)

    for path in glob.glob(os.path.join(staging, "*.glb")):
        os.replace(path, os.path.join(glb_dir, os.path.basename(path)))
    if not only:
        # a full build defines the library: drop GLBs no longer in the catalog
        keep = {f"{e['id']}.glb" for e in entries}
        for path in glob.glob(os.path.join(glb_dir, "*.glb")):
            if os.path.basename(path) not in keep:
                os.remove(path)
                print(f"[gteki] removed stale {os.path.basename(path)}", flush=True)

    order = {a["id"]: i for i, a in enumerate(catalog["assets"])}
    entries.sort(key=lambda e: order.get(e["id"], 1e9))
    for e in entries:
        e.pop("build_seconds", None)  # keep the manifest reproducible
    manifest = {
        "contract": contract.CONTRACT,
        "kit_version": contract.KIT_VERSION,
        "catalog": os.path.relpath(os.path.abspath(args.catalog), os.path.abspath(args.out)),
        "texture_resolution": args.tex_res,
        "license": contract.LICENSE,
        "assets": entries,
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    main(argv)
