#!/usr/bin/env python3
"""Guide-mascot UI SVGs (#132 / #195): the engine.

The drawing lives in `mascot_shapes.py` (one list of primitives per character and expression). This script turns it
into minified, deterministic SVGs and writes, under `assets/library/mascots/ui/`:

    <character>_<expression>.svg   ten files, `viewBox="0 0 64 64"`, transparent background, flat fills only
    index.json                     the file map plus licence, attribution and design reference
    preview/*.png                  32 px and 48 px previews on white, and contact_32_48.png with all twenty

Usage:
    python3 -I tools/blender/art2d/mascot_svg.py            # regenerate everything
    python3 -I tools/blender/art2d/mascot_svg.py --check    # fail on stale, oversized or forbidden output

`--check` fails if an SVG is missing, over 4096 bytes, contains a filter/image/text/gradient/mask (or a background
rect), if the index is stale, if a preview is missing, or if regeneration would change any committed byte.

Determinism: the same drawing gives the same bytes. Previews are rasterised with ImageMagick (`magick`). Its built-in
SVG renderer on this host drops strokes on paths and shapes, so the previews are drawn from the same primitives with
ImageMagick's MVG renderer at 4x, then resized; the SVGs themselves are checked byte-for-byte. Run this single-process
on the shared host (`lockf -k /tmp/gteki-local-test.lock ...`).
"""

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "assets" / "library" / "mascots" / "ui"
PREVIEW_DIR = OUT_DIR / "preview"
SHAPES_FILE = HERE / "mascot_shapes.py"

CHARACTERS = ("cat", "dog")
EXPRESSIONS = ("neutral", "happy", "encourage", "sorry", "unsure")
SIZE_LIMIT = 4096
PREVIEW_SIZES = (32, 48)
# Draw the primitives at 4x (256 px) and resize down, so strokes are smooth at 32/48 px.
PREVIEW_RENDER = 256
PREVIEW_SCALE = PREVIEW_RENDER / 64.0
CONTACT = "contact_32_48.png"
# Lower-case substrings that must never appear: no filters, raster images, text, gradients or masks.
FORBIDDEN = ("<filter", "<image", "<text", "<linearGradient".lower(), "<radialGradient".lower(), "<mask", "filter=", "url(#")


def _num(value):
    """One decimal at most, no trailing `.0`, and never `-0` (so byte output is stable)."""
    text = "%.1f" % float(value)
    if text.endswith(".0"):
        text = text[:-2]
    return "0" if text == "-0" else text


def _element(prim):
    kind = prim["shape"]
    transform = prim.get("transform")
    fill = prim.get("fill", "none")
    stroke = prim.get("stroke", "#3B2A22")
    parts = []
    if kind == "circle":
        parts.append('<circle cx="%s" cy="%s" r="%s"' % (_num(prim["cx"]), _num(prim["cy"]), _num(prim["r"])))
    elif kind == "ellipse":
        parts.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s"' % (
            _num(prim["cx"]), _num(prim["cy"]), _num(prim["rx"]), _num(prim["ry"])))
        if prim.get("rotate") is not None:
            if transform is not None:
                raise ValueError("an ellipse takes rotate or transform, not both")
            transform = "rotate(%s %s %s)" % (
                _num(prim["rotate"]), _num(prim["cx"]), _num(prim["cy"]))
    elif kind == "path":
        parts.append('<path d="%s"' % prim["d"])
    else:
        raise ValueError("unknown primitive shape %r" % kind)
    parts.append(' fill="%s"' % fill)
    if stroke != "none":
        parts.append(' stroke="%s" stroke-width="%s"' % (stroke, _num(prim.get("width", 2.2))))
        # Both are inherited presentation attributes set once on the root element; only an override costs bytes here.
        if kind == "path":
            cap = prim.get("cap", "round")
            join = prim.get("join", "round")
            if cap != "round" or join != "round":
                parts.append(' stroke-linecap="%s" stroke-linejoin="%s"' % (cap, join))
    if transform is not None:
        parts.append(' transform="%s"' % transform)
    return "".join(parts) + "/>"


def svg_bytes(primitives):
    body = "".join(_element(prim) for prim in primitives)
    # stroke-linecap/linejoin are inherited, so the defaults live on the root instead of on every path.
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"'
            ' stroke-linecap="round" stroke-linejoin="round">%s</svg>\n' % body).encode()


def drawings():
    """{file stem: primitives} in CHARACTERS × EXPRESSIONS order."""
    spec = importlib.util.spec_from_file_location("gteki_mascot_shapes", SHAPES_FILE)
    if spec is None or spec.loader is None:
        raise SystemExit("cannot load %s" % SHAPES_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    drawn = {}
    for character in CHARACTERS:
        for expression in EXPRESSIONS:
            drawn["%s_%s" % (character, expression)] = getattr(module, "%s_%s" % (character, expression))()
    return drawn


def index_bytes():
    doc = {}
    for character in CHARACTERS:
        doc[character] = {expression: "%s_%s.svg" % (character, expression) for expression in EXPRESSIONS}
    doc["licence"] = "CC-BY-4.0"
    doc["attribution"] = "GTEki contributors"
    doc["design_ref"] = "#132 v1"
    return (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()


_TRANSFORM = re.compile(r"(rotate|translate)\(([^)]*)\)")


def _mvg(prim):
    """One MVG drawing command for a primitive, so ImageMagick draws it with strokes (its SVG parser drops them)."""
    scale = _num(PREVIEW_SCALE)
    prefix = "stroke-linecap round stroke-linejoin round scale %s,%s " % (scale, scale)
    for name, args in _TRANSFORM.findall(prim.get("transform", "")):
        values = [value.strip() for value in args.replace(",", " ").split()]
        if name == "rotate" and len(values) == 3:
            angle, cx, cy = values
            prefix += "translate %s,%s rotate %s translate -%s,-%s " % (cx, cy, angle, cx, cy)
        elif name == "rotate" and len(values) == 1:
            prefix += "rotate %s " % values[0]
        elif name == "translate":
            prefix += "translate %s " % ",".join(values)
        else:
            raise ValueError("cannot preview transform %r" % prim.get("transform"))
    kind = prim["shape"]
    if kind == "circle":
        return prefix + "circle %s,%s %s,%s" % (
            _num(prim["cx"]), _num(prim["cy"]), _num(prim["cx"] + prim["r"]), _num(prim["cy"]))
    if kind == "ellipse":
        return prefix + "ellipse %s,%s %s,%s 0,360" % (
            _num(prim["cx"]), _num(prim["cy"]), _num(prim["rx"]), _num(prim["ry"]))
    return prefix + "path '%s'" % prim["d"]


def render_png(primitives, target):
    args = ["magick", "-size", "%dx%d" % (PREVIEW_RENDER, PREVIEW_RENDER), "xc:white"]
    for prim in primitives:
        args += [
            "-fill", prim.get("fill", "none"),
            "-stroke", prim.get("stroke", "#3B2A22"),
            # MVG scales the stroke width with the drawing's scale, so this stays in 64-unit values.
            "-strokewidth", _num(prim.get("width", 2.2)),
            "-draw", _mvg(prim),
        ]
    subprocess.run(args + ["-strip", str(target)], check=True)


def preview_names():
    names = []
    for character in CHARACTERS:
        for size in PREVIEW_SIZES:
            for expression in EXPRESSIONS:
                names.append("%s_%s_%d.png" % (character, expression, size))
    return names


def write_previews(drawn):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        large = {}
        for stem, primitives in drawn.items():
            large[stem] = Path(scratch) / (stem + ".png")
            render_png(primitives, large[stem])
        tiles = {}
        for character in CHARACTERS:
            for size in PREVIEW_SIZES:
                for expression in EXPRESSIONS:
                    stem = "%s_%s" % (character, expression)
                    png = PREVIEW_DIR / ("%s_%d.png" % (stem, size))
                    subprocess.run([
                        "magick", str(large[stem]), "-resize", "%dx%d" % (size, size), "-strip", str(png),
                    ], check=True)
                    tiles[(character, size, expression)] = png
        # Contact sheet: pad every tile to the largest preview size plus a margin, join each row, stack the rows. Plain
        # `magick +append`/`-append` rather than `montage`, which needs a font for its labels even when there is none.
        cell = max(PREVIEW_SIZES)
        margin = 4
        rows = []
        for character in CHARACTERS:
            for size in PREVIEW_SIZES:
                padded = []
                for expression in EXPRESSIONS:
                    stem = "%s_%s_%d" % (character, expression, size)
                    target = Path(scratch) / (stem + ".png")
                    subprocess.run([
                        "magick", str(tiles[(character, size, expression)]),
                        "-background", "white", "-gravity", "center", "-extent", "%dx%d" % (cell, cell),
                        "-bordercolor", "white", "-border", str(margin), str(target),
                    ], check=True)
                    padded.append(str(target))
                row = Path(scratch) / ("row_%s_%d.png" % (character, size))
                subprocess.run(["magick", *padded, "+append", str(row)], check=True)
                rows.append(str(row))
        subprocess.run(["magick", *rows, "-append", "-strip", str(PREVIEW_DIR / CONTACT)], check=True)


def generate():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drawn = drawings()
    sizes = {}
    for stem, primitives in drawn.items():
        data = svg_bytes(primitives)
        (OUT_DIR / (stem + ".svg")).write_bytes(data)
        sizes[stem] = len(data)
    (OUT_DIR / "index.json").write_bytes(index_bytes())
    write_previews(drawn)
    for stem, size in sizes.items():
        print("%-20s %4d B" % (stem + ".svg", size))
    print("wrote %d SVGs, index.json and %d previews in %s" % (
        len(sizes), len(preview_names()) + 1, OUT_DIR.relative_to(ROOT)))


def check():
    failures = []
    drawn = drawings()
    for stem, primitives in drawn.items():
        name = stem + ".svg"
        path = OUT_DIR / name
        expected = svg_bytes(primitives)
        if len(expected) > SIZE_LIMIT:
            failures.append("%s: %d B over the %d B limit" % (name, len(expected), SIZE_LIMIT))
        if not path.exists():
            failures.append("%s: missing" % name)
            continue
        actual = path.read_bytes()
        if actual != expected:
            failures.append("%s: differs from a fresh regeneration (%d B committed, %d B generated)" % (
                name, len(actual), len(expected)))
        if len(actual) > SIZE_LIMIT:
            failures.append("%s: %d B over the %d B limit" % (name, len(actual), SIZE_LIMIT))
        text = actual.decode("utf-8")
        low = text.lower()
        for marker in FORBIDDEN:
            if marker in low:
                failures.append("%s: forbidden element or reference %r" % (name, marker))
        if 'viewBox="0 0 64 64"' not in text:
            failures.append("%s: viewBox is not 0 0 64 64" % name)
        if "<rect" in low:
            failures.append("%s: contains a rect (the background must stay transparent)" % name)
    index_path = OUT_DIR / "index.json"
    if not index_path.exists():
        failures.append("index.json: missing")
    elif index_path.read_bytes() != index_bytes():
        failures.append("index.json: differs from a fresh regeneration")
    for name in preview_names() + [CONTACT]:
        if not (PREVIEW_DIR / name).exists():
            failures.append("preview/%s: missing" % name)
    if failures:
        for failure in failures:
            print("FAIL: " + failure, file=sys.stderr)
        return 1
    biggest = max(len(svg_bytes(primitives)) for primitives in drawn.values())
    print("PASS: %d mascot SVGs, deterministic, no forbidden elements (largest %d B of %d)" % (
        len(drawn), biggest, SIZE_LIMIT))
    print("PASS: index.json and %d previews are in place" % (len(preview_names()) + 1))
    return 0


def main(argv):
    unknown = [arg for arg in argv if arg != "--check"]
    if unknown:
        print("usage: mascot_svg.py [--check]", file=sys.stderr)
        return 2
    return check() if "--check" in argv else generate()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
