"""Copy Lane E finish packs into the station folder, where the explorer can serve them.

    python3 -I stations/ikebukuro/pipeline/sync_finish_packs.py [--check]

The explorer bundles only files under stations/ikebukuro/gteki/ (a symlink into assets/library/ is refused:
the asset walk follows links only inside the station's own folder). For each pack in scene/finishes.json that
names a `source` folder (repo-relative, under assets/library/), this copies the map files the pack lists
(`maps` and `low`) to gteki/<dir>/ byte for byte and prints the file list to declare in
data/graph.src.json, as `files` of the kit asset (the production build refuses undeclared asset files).

Low-tier maps (`low`) must be at most 1024 px (style.md section 8); the check reads PNG, WebP and JPEG headers.
--check changes nothing and exits non-zero if a source file is missing, too big, or out of date in gteki/.
"""
import json
import os
import shutil
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATION = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(STATION))
MANIFEST = os.path.join(STATION, "scene", "finishes.json")
EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")  # what THREE.TextureLoader decodes; the asset walk also admits .ktx2
MAX_LOW = 1024


def image_size(path):
    """(width, height) from a PNG, WebP or JPEG header, or None."""
    with open(path, "rb") as f:
        head = f.read(64 * 1024)
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", head[16:24])
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        kind = head[12:16]
        if kind == b"VP8X":
            return (1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little"))
        if kind == b"VP8L":
            bits = int.from_bytes(head[21:25], "little")
            return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        if kind == b"VP8 ":
            w, h = struct.unpack("<HH", head[26:30])
            return (w & 0x3FFF, h & 0x3FFF)
    if head[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(head):
            if head[i] != 0xFF:
                i += 1
                continue
            marker = head[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                height, width = struct.unpack(">HH", head[i + 5:i + 9])
                return (width, height)
            i += 2 + struct.unpack(">H", head[i + 2:i + 4])[0]
    return None


def main(argv):
    check = "--check" in argv
    with open(MANIFEST, encoding="utf-8") as f:
        packs = json.load(f).get("packs", {})
    problems, declare = [], []
    for role, spec in sorted(packs.items()):
        source = spec.get("source")
        if not source:
            continue  # files are placed by hand under gteki/<dir>
        src_dir = os.path.realpath(os.path.join(REPO, source))
        if not src_dir.startswith(os.path.join(REPO, "assets", "library") + os.sep):
            problems.append(f"{role}: source {source} is not under assets/library/")
            continue
        low_files = set((spec.get("low") or {}).values())
        names = sorted(set((spec.get("maps") or {}).values()) | low_files)
        dst_dir = os.path.join(STATION, "gteki", spec["dir"])
        for name in names:
            src, dst = os.path.join(src_dir, name), os.path.join(dst_dir, name)
            if not name.lower().endswith(EXTENSIONS) or os.path.basename(name) != name:
                problems.append(f"{role}: {name} must be a png, jpg or webp file name without a folder")
            elif not os.path.isfile(src):
                problems.append(f"{role}: {source}/{name} is missing")
            else:
                size = image_size(src)
                if name in low_files and (size is None or max(size) > MAX_LOW):
                    problems.append(f"{role}: low-tier map {name} is {size}; at most {MAX_LOW} px")
                same = os.path.isfile(dst) and open(src, "rb").read() == open(dst, "rb").read()
                if check and not same:
                    problems.append(f"{role}: gteki/{spec['dir']}/{name} is out of date (run without --check)")
                elif not check and not same:
                    os.makedirs(dst_dir, exist_ok=True)
                    shutil.copyfile(src, dst)
                    print(f"copied {source}/{name} -> gteki/{spec['dir']}/{name}")
            declare.append(f"{spec['dir']}/{name}")
    for p in problems:
        print("ERROR", p, file=sys.stderr)
    if declare:
        print("declare as assets[].files in data/graph.src.json:")
        print(json.dumps(sorted(set(declare)), indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
