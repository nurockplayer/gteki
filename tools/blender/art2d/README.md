# art2d typesetting

Reproduces the text layer of the 2D art in `assets/library/source/art2d/`. The AI draws no text (style bible §10); all copy is typeset here, after generation.

```bash
python3 -I tools/blender/art2d/typeset.py INPUT_DIR SPEC_JSON FONT_DIR OUTPUT_DIR
```

- `INPUT_DIR`: raw plates (PNG), one per spec key.
- `SPEC_JSON`: per plate, `lines` (`[text, weight R|B, size, gravity, dx, dy, fill, stroke]`, sizes and offsets as fractions of the image), optional `crop_cx` (2:3 crop of a landscape plate) and `rejected`. The full format is in the script docstring.
- `FONT_DIR`: `NotoSansJP-Regular.otf` and `NotoSansJP-Bold.otf` (notofonts/noto-cjk tag Sans2.004, commit 523d033, SIL OFL 1.1). The font is not in the repo; only glyphs rendered into the images are.
- `OUTPUT_DIR`: receives one JPEG (quality 90) per plate; `REJECTED_` prefix for rejected plates.

Needs `python3` and ImageMagick (`magick`). No network. The shipped JPEGs are the source of record: they were resized to 1024 px long edge, quality 85 afterwards (`source/art2d/provenance.json`, `shipped`).
