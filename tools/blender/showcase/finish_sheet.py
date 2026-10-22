#!/usr/bin/env python3
"""Contact sheet helper for a finish pack (stdlib; `assemble` needs ImageMagick, the `magick` command; no Blender).

  finish_sheet.py layouts --pack assets/library/finishes --dir DIR [--mock DIR/finish_passage_mock.glb]
      writes DIR/studio_<id>.json for every finish and DIR/passage.json (render_preview.py layouts)
  finish_sheet.py assemble --pack assets/library/finishes --dir DIR --out docs/assets/img/batch1_finishes.jpg [--font FONT.ttf]
      labels DIR/studio_<id>.png (800x450 each) in two columns under DIR/passage.png (1600x900)

`assemble` needs ImageMagick (`brew install imagemagick`). The label font is `--font`, else the GTEKI_FONT
environment variable, else the first of Arial (macOS) or DejaVu Sans (Linux) that exists, else ImageMagick's
own default font.

Render each layout with the reference setup (docs/assets/style.md section 7), e.g.
  blender -b --factory-startup -P tools/blender/render_preview.py -- --layout DIR/studio_<id>.json --res 800x450 --out DIR/studio_<id>.png
"""
import argparse
import json
import os
import subprocess
import sys

FONT_CANDIDATES = ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                   "/usr/share/fonts/dejavu/DejaVuSans.ttf")
LENS = 24
TAN_H = 18.0 / LENS  # half horizontal field of view (36 mm sensor)


def finishes(pack):
    man = json.load(open(os.path.join(pack, "manifest.json")))
    out = []
    for rec in man["finishes"]:
        doc = json.load(open(os.path.join(pack, rec["finish_json"]["file"])))
        out.append((rec, doc))
    return out


def studio_layout(pack, doc):
    w, h = (doc["sample"]["repeats"] * r for r in doc["repeat_m"])
    glb = os.path.abspath(os.path.join(pack, "glb", doc["id"] + ".glb"))
    if doc["sample"]["plane"] == "floor":
        cam = {"pos": [0, -w * 1.05, w * 0.85], "look_at": [0, 0, 0], "lens": LENS}
    else:
        vis = min(w, 2.4)  # metres of wall across the frame
        d = vis / 2 / TAN_H
        zc = min(h / 2, 0.9)
        cam = {"pos": [0, -d, zc], "look_at": [0, 0, zc], "lens": LENS}
    return {"title": doc["id"], "mode": "studio", "exposure": -0.2, "items": [{"glb": glb, "pos": [0, 0, 0]}], "camera": cam}


def passage_layout(mock, kit):
    items = [{"glb": os.path.abspath(mock), "pos": [0, 0, 0]},
             {"glb": os.path.join(kit, "gteki_sign_hanging_navy_left.glb"), "pos": [-0.2, 4.0, 0]},
             {"glb": os.path.join(kit, "gteki_bench_4seat.glb"), "pos": [1.4, 6.6, 0], "yaw": 90}]
    return {"title": "SYNTHETIC KIT DEMO - finish look-dev passage, not a station layout", "mode": "interior",
            "exposure": -0.35, "items": items,
            "camera": {"pos": [-1.2, 0.5, 1.45], "look_at": [0.4, 6.5, 1.15], "lens": 20}}


def cmd_layouts(a):
    os.makedirs(a.dir, exist_ok=True)
    for _, doc in finishes(a.pack):
        json.dump(studio_layout(a.pack, doc), open(os.path.join(a.dir, f"studio_{doc['id']}.json"), "w"), indent=1)
    kit = os.path.abspath(os.path.join(a.pack, "..", "glb")) if a.kit is None else a.kit
    json.dump(passage_layout(a.mock or os.path.join(a.dir, "finish_passage_mock.glb"), kit),
              open(os.path.join(a.dir, "passage.json"), "w"), indent=1)


def magick(*args):
    subprocess.run(["magick", *args], check=True)


def pick_font(arg):
    """The label font file: --font, GTEKI_FONT, a known system font, else None (ImageMagick's default)."""
    wanted = arg or os.environ.get("GTEKI_FONT")
    if wanted:
        if not os.path.isfile(wanted):
            sys.exit(f"font not found: {wanted}")
        return wanted
    return next((path for path in FONT_CANDIDATES if os.path.isfile(path)), None)


def label(src, dst, text, size, font=None):
    magick(src, *(["-font", font] if font else []), "-pointsize", str(size), "-fill", "white", "-undercolor", "#000000c0",
           "-gravity", "northwest", "-annotate", "+10+8", f" {text} ", dst)


def cmd_assemble(a):
    font = pick_font(a.font)
    tiles = []
    for rec, doc in finishes(a.pack):
        res = doc["maps"][next(iter(doc["maps"]))]["size"][0]
        ru, rv = doc["repeat_m"]
        kib = rec["texture_bytes"] / 1024
        text = (f"{doc['id'].replace('gteki_finish_', '')}  |  {doc['role']}  |  repeat {ru:g} x {rv:g} m  |  {res} px  |  {kib:.0f} KiB"
                + ("  |  tint" if doc["tint"] else ""))
        dst = os.path.join(a.dir, f"label_{doc['id']}.png")
        label(os.path.join(a.dir, f"studio_{doc['id']}.png"), dst, text, 17, font)
        tiles.append(dst)
    rows = []
    for i in range(0, len(tiles), 2):
        row = os.path.join(a.dir, f"row_{i // 2}.png")
        magick(*tiles[i:i + 2], "+append", row)
        rows.append(row)
    passage = os.path.join(a.dir, "passage_label.png")
    label(os.path.join(a.dir, "passage.png"), passage,
          "in context: terrazzo + granite border, kick plate, wainscot blue, enamel, line_accent band tinted #b6007a, spandrel ceiling", 20, font)
    magick(passage, *rows, "-append", "-strip", "-sampling-factor", "4:2:0", "-quality", str(a.quality), a.out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("layouts", "assemble"):
        p = sub.add_parser(name)
        p.add_argument("--pack", required=True)
        p.add_argument("--dir", required=True)
    sub.choices["layouts"].add_argument("--mock")
    sub.choices["layouts"].add_argument("--kit", help="kit glb directory (default: <pack>/../glb)")
    sub.choices["assemble"].add_argument("--out", required=True)
    sub.choices["assemble"].add_argument("--quality", type=int, default=82)
    sub.choices["assemble"].add_argument("--font", help="label font file (default: $GTEKI_FONT, else Arial or DejaVu Sans if present)")
    a = ap.parse_args()
    {"layouts": cmd_layouts, "assemble": cmd_assemble}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
