#!/usr/bin/env python3
"""Typeset the text layer onto AI-generated 2D art plates (GTEki art2d pipeline).

The AI never draws text. Every plate is generated without any lettering and the copy
is added here with ImageMagick, so the exact wording is reviewable and reproducible.

Usage:
    python3 -I typeset.py INPUT_DIR SPEC_JSON FONT_DIR OUTPUT_DIR

    INPUT_DIR   raw plates, one file per spec key (for example b1_ike_anime_duo.png)
    SPEC_JSON   copy spec, see below
    FONT_DIR    directory holding NotoSansJP-Regular.otf and NotoSansJP-Bold.otf
                (Noto Sans JP, notofonts/noto-cjk tag Sans2.004, SIL OFL 1.1;
                the font is not committed to the repository)
    OUTPUT_DIR  created if missing; receives <key without extension>.jpg (quality 90)

Spec format: a JSON object keyed by plate file name. Each value is an object:
    lines     list of [text, weight, size, gravity, dx, dy, fill, stroke]
                text     the string to draw
                weight   "R" (Regular) or "B" (Bold)
                size     point size as a fraction of the image height (0.05 = 5 %)
                gravity  ImageMagick gravity: North, South, West, East, Center, ...
                dx, dy   offset from the gravity anchor as a fraction of the image
                         width (dx) and height (dy)
                fill     fill colour, "#rrggbb"
                stroke   "#rrggbb" for a drop shadow (the same colour at 69 % alpha,
                         offset down-right), or "" for none. Use a shadow on busy plates.
    crop_cx   optional. Crop a 2:3 portrait out of a landscape plate, centred at this
              fraction of the width (0.5 = centre), clamped to the image.
    rejected  optional, true to prefix the output with REJECTED_ (reject log).
    brand     optional, free text (the fictional brand); not used here.

Needs only python3 (stdlib) and ImageMagick's `magick`. No network.
"""
import json
import os
import subprocess
import sys


def image_size(path):
    out = subprocess.check_output(["magick", "identify", "-format", "%w %h", path])
    w, h = map(int, out.split())
    return w, h


def build_command(src, spec, fonts):
    """Return (magick argv without the output path, final width, height)."""
    w, h = image_size(src)
    cmd = ["magick", src]
    if "crop_cx" in spec:  # 2:3 portrait crop from a landscape plate
        cw = round(h * 2 / 3)
        x0 = min(max(0, round(spec["crop_cx"] * w - cw / 2)), w - cw)
        cmd += ["-crop", f"{cw}x{h}+{x0}+0", "+repage"]
        w = cw
    for text, weight, size, gravity, dx, dy, fill, stroke in spec["lines"]:
        pt = round(size * h)
        x = round(dx * w)
        y = round(dy * h)
        common = ["-gravity", gravity, "-font", fonts[weight], "-pointsize", str(pt),
                  "-kerning", str(round(pt * 0.04))]
        if stroke:  # offset drop shadow for legibility on busy plates
            o = max(2, pt // 16)
            sx = x + (o if gravity != "East" else -o)
            sy = y + (o if gravity != "South" else -o)
            cmd += common + ["-fill", stroke + "b0", "-annotate", f"{sx:+d}{sy:+d}", text]
        cmd += common + ["-fill", fill, "-stroke", "none", "-annotate", f"{x:+d}{y:+d}", text]
    return cmd, w, h


def main(argv):
    if len(argv) != 5:
        sys.exit(__doc__)
    indir, spec_path, font_dir, outdir = argv[1:]
    with open(spec_path, encoding="utf-8") as fh:
        copy = json.load(fh)
    os.makedirs(outdir, exist_ok=True)
    fonts = {"B": os.path.join(font_dir, "NotoSansJP-Bold.otf"),
             "R": os.path.join(font_dir, "NotoSansJP-Regular.otf")}
    for name, spec in copy.items():
        src = os.path.join(indir, name)
        if not os.path.exists(src):
            print("missing", name)
            continue
        cmd, w, h = build_command(src, spec, fonts)
        prefix = "REJECTED_" if spec.get("rejected") else ""
        out = os.path.join(outdir, f"{prefix}{os.path.splitext(name)[0]}.jpg")
        subprocess.check_call(cmd + ["-quality", "90", out])
        print("ok", name, w, h)


if __name__ == "__main__":
    main(sys.argv)
