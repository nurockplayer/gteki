# Guide mascots — UI set

Two original guide characters (cat and dog) in five expressions each, as flat SVG icons for in-game UI: bubbles,
the search-result panel and error states. Original GTEki vector art drawn in code (design reference `#132 v1`), not a
trace of the AI concept sheets. Rights: CC BY 4.0, attribution "GTEki contributors" (see [Licence](#licence)).

| File | What it is |
| --- | --- |
| `<character>_<expression>.svg` | Ten icons: `cat` / `dog` × `neutral` / `happy` / `encourage` / `sorry` / `unsure` |
| `index.json` | File map per character and expression, plus `licence`, `attribution`, `design_ref` |
| `preview/<character>_<expression>_<32\|48>.png` | Raster previews on white, for review only |
| `preview/contact_32_48.png` | All twenty previews in one sheet |

## Using them

The SVGs are `64 × 64` (viewBox, no width/height), transparent, flat fills, one shared outline colour and no
filters, gradients, masks, text or embedded images — they import cleanly as Godot textures and stay legible at
32–48 px. Show one in a `TextureRect` or a `Sprite2D`; do not add a background of your own, and keep a uniform
integer scale so the outline stays even.

```gdscript
var sheet := "res://assets/library/mascots/ui/"
$Mascot.texture = load(sheet + "cat_sorry.svg")
```

## Which expression to show

| Expression | When |
| --- | --- |
| `neutral` | Default / idle. On screen before a result arrives, and for anything without its own state. |
| `happy` | A successful, complete result the player asked for (route found, arrival, goal reached). |
| `encourage` | Nudging the player to keep going: an empty or very broad search, a prompt to pick a destination or continue. |
| `sorry` | No route exists — the route planner returned `no_path`. |
| `unsure` | The answer is incomplete or uncertain: the search limit was hit (`search_limit`), a value is unknown or only `unknown_*`, or a segment is unconfirmed. |

Two characters, same states: use cat and dog as equals (for example alternate per screen or let the player pick a
guide). Their expressions are interchangeable; nothing in the UI depends on which one is shown.

## Style rules

- Flat fills only, `2.2` stroke in `#3B2A22` (never a shadow, blur or gradient).
- Cat: white `#FFFFFF`, orange `#E8A15A`, inner ear / blush `#F6B8B0`, eyes `#2B1E18` with a white highlight, navy
  neckerchief `#0E2554` with one thin white stripe. No stripes; mouth is `人`-shaped, never `ω`.
- Dog: cream `#FBF3E4`, caramel floppy ears `#C9955C` with inner `#E2B98A`, one head tuft, big dot eyes, blush
  `#F6B8B0`; the yellow `#F5BD1A` backpack shows only as two thin shoulder straps. The paws hold nothing.
- Head-and-chest bust facing right, cut off at the bottom edge of the viewBox.
- Each file must stay at or under 4096 bytes (currently 1.97–3.37 kB).

## Regenerating

The drawing is data in `tools/blender/art2d/mascot_shapes.py`; `tools/blender/art2d/mascot_svg.py` minifies it,
writes the SVGs, `index.json` and the previews, and verifies the result. Never hand-edit an SVG or a preview — the
next run overwrites it.

```sh
# regenerate (single process; the host has a shared lock)
lockf -k /tmp/gteki-local-test.lock python3 -I tools/blender/art2d/mascot_svg.py

# verify: byte-for-byte determinism, missing/oversized files, forbidden elements, index and previews
lockf -k /tmp/gteki-local-test.lock python3 -I tools/blender/art2d/mascot_svg.py --check
```

`--check` fails if an SVG is missing, over 4096 bytes, differs from a fresh regeneration, contains a
filter/image/text/gradient/mask or a background `rect`, if `index.json` is stale, or if a preview is missing.
Previews are drawn from the same primitives with ImageMagick (`magick`, MVG renderer at 4×), because its SVG parser
on this host drops strokes; the SVGs themselves are checked byte-for-byte, so a preview difference never hides an
SVG difference.

## Licence

CC BY 4.0, attribution "GTEki contributors" — original project art, consistent with the rest of `assets/library/`
(Owner decision, Issue #123; mapped in `REUSE.toml`). Provenance and what the record covers:
[`../../PROVENANCE.md`](../../PROVENANCE.md).
