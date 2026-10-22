"""Copy Lane E kit GLBs into the station folder, where the explorer can serve them.

    python3 -I stations/ikebukuro/pipeline/sync_kit.py [--check]

The explorer bundles only files under stations/ikebukuro/gteki/ (a symlink into assets/library/ is refused), so
each piece listed in scene/kit/kit.json is copied byte for byte:

    assets/library/glb/<id>.glb         -> gteki/kit/high/<id>.glb   (desktop tier)
    assets/library/mobile/glb/<id>.glb  -> gteki/kit/low/<id>.glb    (phone tier)

The kit manifests (assets/library/manifest.json, assets/library/mobile/manifest.json) record each GLB's sha256
and size; a source whose bytes differ from its manifest entry is an error. --check changes nothing and exits
non-zero when a source is missing, disagrees with its manifest, or a copy is out of date. The last lines print the
paths to keep in data/graph.src.json assets[id=b1].files (the production build refuses undeclared files).

Same pattern as sync_finish_packs.py (finish packs), kept separate because the sources and tiers differ.
"""
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATION = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(STATION))
KIT_JSON = os.path.join(STATION, "scene", "kit", "kit.json")
LIBRARY = os.path.join(REPO, "assets", "library")

# tier -> (folder under assets/library, manifest, folder under gteki/)
TIERS = {
    "high": ("glb", "manifest.json", "kit/high"),
    "low": (os.path.join("mobile", "glb"), os.path.join("mobile", "manifest.json"), "kit/low"),
}


def sha256_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def plan(kit):
    """[(tier, id, source path, destination path, gteki-relative destination)] for every piece and tier."""
    out = []
    for tier, (src_dir, _manifest, dst_dir) in TIERS.items():
        for pid in sorted(kit["pieces"]):
            rel = f"{dst_dir}/{pid}.glb"
            out.append((tier, pid, os.path.join(LIBRARY, src_dir, f"{pid}.glb"), os.path.join(STATION, "gteki", rel), rel))
    return out


def main(argv):
    check = "--check" in argv
    with open(KIT_JSON, encoding="utf-8") as f:
        kit = json.load(f)
    problems, declare = [], []
    manifests = {}
    for tier, (_src, manifest, _dst) in TIERS.items():
        with open(os.path.join(LIBRARY, manifest), encoding="utf-8") as f:
            manifests[tier] = {a["id"]: a for a in json.load(f)["assets"]}
    for tier, pid, src, dst, rel in plan(kit):
        entry = manifests[tier].get(pid)
        if entry is None:
            problems.append(f"{tier}: {pid} is not in the {tier} kit manifest")
        elif not os.path.isfile(src):
            problems.append(f"{tier}: {os.path.relpath(src, REPO)} is missing")
        else:
            if sha256_of(src) != entry["sha256"] or os.path.getsize(src) != entry["bytes"]:
                problems.append(f"{tier}: {os.path.relpath(src, REPO)} differs from its manifest entry (sha256 or bytes)")
            same = os.path.isfile(dst) and open(src, "rb").read() == open(dst, "rb").read()
            if check and not same:
                problems.append(f"{tier}: gteki/{rel} is out of date (run without --check)")
            elif not check and not same:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)
                print(f"copied {os.path.relpath(src, REPO)} -> gteki/{rel}")
        declare.append(rel)
    # A copy no piece asks for any more is stale.
    for tier, (_src, _manifest, dst_dir) in TIERS.items():
        folder = os.path.join(STATION, "gteki", dst_dir)
        for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if name[:-4] not in kit["pieces"] or not name.endswith(".glb"):
                problems.append(f"{tier}: gteki/{dst_dir}/{name} is not listed in scene/kit/kit.json")
    for p in problems:
        print("ERROR", p, file=sys.stderr)
    print("keep as assets[id=b1].files in data/graph.src.json and gteki/station.json:")
    print(json.dumps(sorted(declare), indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
