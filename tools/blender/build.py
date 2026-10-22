"""Batch-generate kit GLBs from a catalog.

Run through Blender (no GUI):

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/build.py -- \
      --catalog tools/blender/catalog/kit_v0_1.json --out assets/library

Options:
  --only id1,id2     build a subset (manifest entries for others are kept;
                     assets no longer in the catalog are removed)
  --tex-res N        texture resolution (default 1024; 2048/4096 for Godot HQ)
  --save-blend DIR   also save an editable .blend per asset (keep outside Git)
  --manifest PATH    manifest path (default <out>/manifest.json)
  --profile NAME     full (default, canonical library) or mobile (contract §8)
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

from gteki_assets import ao, contract  # noqa: E402
from gteki_assets.asset import Asset  # noqa: E402
from gteki_assets.families import PLACEMENT, REGISTRY  # noqa: E402


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--tex-res", type=int, default=contract.DEFAULT_TEX_RES)
    ap.add_argument("--save-blend", default="")
    ap.add_argument("--manifest", default="")
    ap.add_argument("--profile", default="full", choices=contract.PROFILES)
    args = ap.parse_args(argv)
    Asset.profile = args.profile

    with open(args.catalog) as f:
        catalog = json.load(f)
    only = {s for s in args.only.split(",") if s}
    glb_dir = os.path.join(args.out, "glb")
    manifest_path = args.manifest or os.path.join(args.out, "manifest.json")

    ids = [item["id"] for item in catalog["assets"]]
    unsafe = [repr(i) for i in ids if not contract.is_asset_id(i)]
    if unsafe:
        sys.exit(f"[gteki] {args.catalog}: ids must match {contract.ASSET_ID_PATTERN} "
                 f"(they become file names): {', '.join(unsafe)}")
    repeated = sorted({i for i in ids if ids.count(i) > 1})
    if repeated:
        sys.exit(f"[gteki] {args.catalog} lists these ids more than once: {', '.join(repeated)}")
    unknown = sorted(only - set(ids))
    if unknown:
        sys.exit(f"[gteki] --only names ids not in {args.catalog}: {', '.join(unknown)}")
    previous = {}
    if only and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            old = json.load(f)
        if old.get("profile", "full") != args.profile:
            sys.exit(f"[gteki] --only with --profile {args.profile} but {manifest_path} is "
                     f"{old.get('profile', 'full')}; use another --out")
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
            if args.profile != "full":
                # same generator at full detail (bmesh only): byte-identical colliders in every profile
                Asset.profile = "full"
                try:
                    twin = gen(aid, item.get("params", {}), args.tex_res)
                finally:
                    Asset.profile = args.profile
                asset.use_full_twin(twin)
            if item.get("dimension_basis"):
                asset.dimension_basis = item["dimension_basis"]
            if item.get("notes"):
                asset.notes = item["notes"]
            if "ao_res" in item:
                if item["ao_res"] not in ao.SIZES:
                    raise ValueError(f"ao_res must be one of {ao.SIZES}, got {item['ao_res']!r}")
                asset.ao_res_override = item["ao_res"]
            asset.placement = item.get("placement") or PLACEMENT.get(item["generator"], "free")
            asset.build()
            entry = asset.export(staging, save_blend_dir=args.save_blend or None)
        except Exception as e:  # keep building the rest, fail at the end
            import traceback

            traceback.print_exc()
            failures.append((aid, repr(e)))
            continue
        entry["tags"] = item.get("tags", [])
        if asset.license != contract.LICENSE or asset.provenance != contract.PROVENANCE:
            # supplied artwork (custom posters) carries its own rights, not the library-wide claim
            entry["license"], entry["provenance"] = asset.license, asset.provenance
        entry["build_seconds"] = round(time.time() - t0, 2)
        entries.append(entry)
        print(f"[gteki] {aid}: {entry['triangles']} tris, {entry['bytes'] / 1024:.0f} KiB, {entry['build_seconds']} s", flush=True)

    if failures:
        for aid, err in failures:
            print(f"[gteki] FAILED {aid}: {err}", file=sys.stderr)
        print(f"[gteki] nothing published; {glb_dir} and {manifest_path} are unchanged", file=sys.stderr)
        sys.exit(1)

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
        **contract.rights_fields(),  # {} while contract.EMBED_SPDX is off: the manifest keeps its bytes
        "assets": entries,
    }
    if args.profile != "full":  # the canonical manifest keeps its exact bytes
        manifest = {**{k: v for k, v in manifest.items() if k != "assets"}, "profile": args.profile, "assets": entries}
    # Write the manifest next to its destination before touching glb/, so an
    # unwritable --manifest fails while the live library is still unchanged.
    manifest_dir = os.path.dirname(os.path.abspath(manifest_path))
    try:
        fd, manifest_tmp = tempfile.mkstemp(prefix=".manifest-", suffix=".json", dir=manifest_dir)
    except OSError as e:
        print(f"[gteki] cannot write manifest {manifest_path}: {e}", file=sys.stderr)
        print(f"[gteki] nothing published; {glb_dir} and {manifest_path} are unchanged", file=sys.stderr)
        sys.exit(1)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.chmod(manifest_tmp, 0o644)
        for path in glob.glob(os.path.join(staging, "*.glb")):
            os.replace(path, os.path.join(glb_dir, os.path.basename(path)))
        if not only:
            # a full build defines the library: drop GLBs no longer in the catalog
            keep = {f"{e['id']}.glb" for e in entries}
            for path in glob.glob(os.path.join(glb_dir, "*.glb")):
                if os.path.basename(path) not in keep:
                    os.remove(path)
                    print(f"[gteki] removed stale {os.path.basename(path)}", flush=True)
        else:
            # an --only build must not leave deleted assets behind either: GLB and manifest entry go together
            catalog_ids = {item["id"] for item in catalog["assets"]}
            for aid in previous:
                path = os.path.join(glb_dir, f"{aid}.glb")  # ids from a manifest on disk: only safe file names
                if aid not in catalog_ids and contract.is_asset_id(aid) and os.path.exists(path):
                    os.remove(path)
                    print(f"[gteki] removed {aid}.glb and its manifest entry (no longer in the catalog)", flush=True)
        os.replace(manifest_tmp, manifest_path)
    finally:
        if os.path.exists(manifest_tmp):
            os.remove(manifest_tmp)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    main(argv)
