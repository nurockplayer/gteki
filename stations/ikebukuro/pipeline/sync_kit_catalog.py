"""Copy the Lane E station catalog GLBs into the station folder, where the explorer can serve them.

    python3 -I stations/ikebukuro/pipeline/sync_kit_catalog.py [--check] [--kinds escalator[,rails,nosing]]
        [--src-full DIR] [--src-mobile DIR] [--station gteki/station.json] [--dest DIR]

scene/kit_catalog.json (the Lane E catalog) and scene/kit_placements.json (which anchor loads which id on which
tier) are written by build_kit_catalog.py from the survey anchors; the GLBs are Lane E's built output, kept outside
the repo. Only the (id, tier) pairs some placement actually loads are copied:

    <src-full>/glb/<id>.glb     -> gteki/kit/catalog/high/<id>.glb   (desktop, "high" tier)
    <src-mobile>/glb/<id>.glb   -> gteki/kit/catalog/low/<id>.glb    (phone, "low" tier)

Batch A is `--kinds escalator`: the 5 escalator ids, high tier only, because every escalator placement lists `high`
alone. Batch B adds `rails` (the 21 stair handrails, also high only: rails are drawn on `main_route` flights only and
that tier filter keeps them off phones); BATCH_KINDS is the union the station ships, so plain `--check` covers both.
Later batches add `nosing` by extending BATCH_KINDS. A kind is read from the catalog entry's generator
(`escalator_dressing`) or the id's maker suffix (`_nosing`, `_rails_...`).

Each source must match the sha256 and size its tier's manifest.json records. --check changes nothing and exits
non-zero when a copy is missing or stale (byte-compared with the source manifest when the Lane E tree is present,
and always with the sha256 the source record gteki-ikb-catalog-0-1-0 pins in gteki/station.json), when a file sits
in the catalog folder that the plan does not produce, or when the source record pins a file no placement loads.
Without --check it copies and prints the paths to keep in data/graph.src.json assets[id=b1].files, plus the sha256
map for the source record.

Same pattern as sync_kit.py, kept separate because the sources, the tier folders and the selection differ.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATION = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(STATION))
CATALOG = os.path.join(STATION, "scene", "kit_catalog.json")
PLACEMENTS = os.path.join(STATION, "scene", "kit_placements.json")
STATION_JSON = os.path.join(STATION, "gteki", "station.json")
DEST_REL = os.path.join("kit", "catalog")

SOURCE_ID = "gteki-ikb-catalog-0-1-0"
LANE_E = ("/Users/tachikoma/Developer/gteki/.claude/worktrees/gteki-lane-e-int/tools/blender/.cache/ike_cb3b29b")
# tier -> (default source folder, manifest file name, destination folder under gteki/kit/catalog/)
TIERS = {
    "high": (os.path.join(LANE_E, "ike_full"), "manifest.json", "high"),
    "low": (os.path.join(LANE_E, "ike_mobile"), "manifest.json", "low"),
}
BATCH_KINDS = ("escalator", "rails")  # batch A + B; "nosing" joins with a later batch
KINDS = ("escalator", "rails", "nosing")


def sha256_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def kind_of(entry):
    """The batch kind of a catalog entry: escalator, nosing or rails."""
    if entry["generator"] == "escalator_dressing":
        return "escalator"
    if entry["id"].endswith("_nosing"):
        return "nosing"
    if "_rails_" in entry["id"]:
        return "rails"
    raise SystemExit(f"sync_kit_catalog: {entry['id']}: unknown generator {entry['generator']!r}")


def plan(catalog, placements, kinds):
    """(tier, id) -> anchors that load it on that tier, for the selected kinds."""
    kinds_of = {a["id"]: kind_of(a) for a in catalog["assets"]}
    out = {}
    for p in placements["placements"]:
        for part, pid in p["ids"].items():
            if pid not in kinds_of:
                sys.exit(f"sync_kit_catalog: placement {p['anchor']} uses {pid}, which is not in {os.path.basename(CATALOG)}")
            if kinds_of[pid] not in kinds:
                continue
            for tier in p["tiers"].get(part, []):
                if tier not in TIERS:
                    sys.exit(f"sync_kit_catalog: placement {p['anchor']} has unknown tier {tier!r}")
                out.setdefault((tier, pid), []).append(p["anchor"])
    return {k: sorted(v) for k, v in out.items()}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; exit non-zero on drift")
    ap.add_argument("--kinds", default=",".join(BATCH_KINDS), help=f"comma-separated batch kinds ({', '.join(KINDS)}); default {','.join(BATCH_KINDS)}")
    ap.add_argument("--src-full", default=TIERS["high"][0], help="Lane E full/desktop output folder (holding glb/ and manifest.json)")
    ap.add_argument("--src-mobile", default=TIERS["low"][0], help="Lane E mobile/phone output folder (holding glb/ and manifest.json)")
    ap.add_argument("--station", default=STATION_JSON, help="the station.json holding source record " + SOURCE_ID)
    ap.add_argument("--dest", default=os.path.join(STATION, "gteki", DEST_REL),
                    help="folder holding the high/ and low/ tier folders (default gteki/kit/catalog); the source record keys stay kit/catalog/...")
    args = ap.parse_args(argv)

    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    for k in kinds:
        if k not in KINDS:
            sys.exit(f"sync_kit_catalog: unknown kind {k!r}; expected one of {', '.join(KINDS)}")
    srcs = {"high": args.src_full, "low": args.src_mobile}

    catalog = read_json(CATALOG)
    placements = read_json(PLACEMENTS)
    pairs = plan(catalog, placements, kinds)
    pins = {}
    if os.path.isfile(args.station):
        record = next((s for s in read_json(args.station)["sources"] if s["id"] == SOURCE_ID), None)
        pins = record.get("sha256", {}) if record else {}
    manifests = {}
    for tier, (src, manifest, _dst) in TIERS.items():
        path = os.path.join(src, manifest)
        if os.path.isfile(path):
            manifests[tier] = {a["id"]: a for a in read_json(path)["assets"]}

    problems, declare, record = [], [], {}
    for tier, pid in sorted(pairs):
        rel = f"{DEST_REL}/{TIERS[tier][2]}/{pid}.glb"
        dst = os.path.join(args.dest, TIERS[tier][2], f"{pid}.glb")
        entry = manifests.get(tier, {}).get(pid)
        declare.append(rel)
        if args.check:
            if not os.path.isfile(dst):
                problems.append(f"gteki/{rel} is missing (run without --check)")
                continue
            digest = sha256_of(dst)
            if rel not in pins:
                problems.append(f"gteki/{rel} is not pinned by {SOURCE_ID}")
            elif pins[rel] != digest:
                problems.append(f"gteki/{rel} differs from the {SOURCE_ID} pin in {os.path.relpath(args.station, REPO)}")
            if entry is not None and (digest != entry["sha256"] or os.path.getsize(dst) != entry["bytes"]):
                problems.append(f"gteki/{rel} differs from the {tier} manifest (stale copy or a rebuilt kit)")
            continue
        if entry is None:
            problems.append(f"{tier}: {pid} is not in the manifest of --src-{'full' if tier == 'high' else 'mobile'}")
            continue
        src = os.path.join(srcs[tier], entry["file"])
        if not os.path.isfile(src):
            problems.append(f"{tier}: {src} is missing")
            continue
        if sha256_of(src) != entry["sha256"] or os.path.getsize(src) != entry["bytes"]:
            problems.append(f"{tier}: {src} differs from its manifest entry (sha256 or bytes)")
            continue
        same = os.path.isfile(dst) and open(src, "rb").read() == open(dst, "rb").read()
        if not same:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            print(f"copied {tier}/{os.path.basename(src)} -> {dst}")
        record[rel] = entry["sha256"]

    if args.check:
        # A copy no placement loads any more is stale, and so is a pin that no copy backs.
        for tier, (_src, _manifest, dst_dir) in TIERS.items():
            folder = os.path.join(args.dest, dst_dir)
            planned = {pid for t, pid in pairs if t == tier}
            for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
                if not name.endswith(".glb") or name[:-4] not in planned:
                    problems.append(f"{os.path.join(args.dest, dst_dir, name)} is not a catalog copy any placement loads")
        for rel in sorted(pins):
            if rel not in declare:
                problems.append(f"{SOURCE_ID} pins {rel}, but no placement loads it for kinds {','.join(kinds)}")

    for p in problems:
        print("ERROR", p, file=sys.stderr)
    if not args.check:
        print(f"keep as assets[id=b1].files in data/graph.src.json and gteki/station.json (source {SOURCE_ID}):")
        print(json.dumps(sorted(declare), indent=1))
        print("sha256 for the source record:")
        print(json.dumps({k: record[k] for k in sorted(record)}, indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
