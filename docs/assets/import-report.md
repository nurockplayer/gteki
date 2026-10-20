# GTEki kit 0.1.0 — import and quality report

Contract `gteki-asset/0.1` · 48 GLBs · 26.5 MiB · 198,623 visual triangles · generated 2026-10-20.

Everything below was measured on the committed library (`assets/library/glb`) with the commands shown. Nothing in this kit is a measurement of Ikebukuro, Shinjuku or any other real station; all assets are `generic-typical` or `synthetic` (see [`PROVENANCE.md`](../../assets/library/PROVENANCE.md)).

## Environment

| Tool | Version |
| --- | --- |
| Blender (headless generator + round-trip renders) | 5.2.2 LTS, `--factory-startup` |
| Godot (import + screenshots) | 4.7.2-stable, Forward+ on Metal (Apple M2 Pro) |
| Web viewer / loader | three.js 0.180, Vite 7, Node 26.10, pnpm 12.11 |
| Validator | `tools/blender/validate_glb.py` (Python stdlib only) |

## Results

| Check | Command | Result |
| --- | --- | --- |
| Batch build, 48 assets, cold texture cache | `tools/blender/build.sh build` | PASS · ~240 s of generator time on M2 Pro (slowest asset 30 s, most of it cold texture synthesis; cached rebuilds take seconds) |
| Contract validator (structure, accessor bounds, index range, NaN, transforms, naming, extras, AABB vs `bounds_m`) | `tools/blender/build.sh validate` | **42 PASS · 6 WARN · 0 FAIL** |
| Godot 4.7 headless import, with parity against `manifest.json` (StaticBody3D + CollisionShape3D per `-colonly` node, socket position and outward direction, flap nodes per aisle, placement-class origin checks) | `tools/blender/build.sh godot` | **48/48 PASS** · 299 StaticBody3D / 299 CollisionShape3D · 51 sockets |
| Godot negative test (corrupted manifest: socket yaw, collision count, aisle count) | `GTEKI_MANIFEST=bad.json run_import_test.sh` | 3/3 faults reported, exit 1 |
| Web: GLTFLoader parse in Node | `tools/blender/build.sh web` | **48/48 parsed** |
| Web: browser viewer, whole kit | `pnpm --dir tools/blender/web_preview dev` → `/?mode=gallery` | renders; 198,623 tris · 578 draw calls · 414 textures |
| Reproducibility | `tools/blender/build.sh repro` | **PASS** · 48/48 GLBs byte-identical across two clean builds (fresh texture caches) and the committed library |
| Round-trip render (GLB → empty Blender scene) | `render_preview.py` with `tools/blender/showcase/*.json` | images below |

The six validator WARNs are intentional and documented: the four `sign_hanging_*` assets have no collider because they hang above head height, and the two `tactile_strip_*` assets have no collider because they are 4 mm floor overlays.

## Per-family budget

| Family | Assets | Triangles | KiB per GLB | Max materials |
| --- | --- | --- | --- | --- |
| passage (straight + end/corner/tee/cross nodes) | 10 | 384–3,520 | 656–1,234 | 10 |
| gate (fare-gate arrays) | 4 | 3,802–9,562 | 443–652 | 11 |
| vertical (stairs, escalators, lift portal) | 6 | 2,394–29,030 | 988–1,582 | 11 |
| signage | 10 | 244–1,054 | 86–217 | 4 |
| props | 18 | 30–5,896 | 98–782 | 23 |

About 70 % of the bytes are embedded 1024² JPEG textures; geometry is small. Each GLB is self-contained (it embeds its own copy of shared materials), so a scene that loads 40 GLBs downloads repeated terrazzo and metal textures. This is the main web-performance follow-up; see Known gaps.

## Visual evidence

Synthetic layouts in `tools/blender/showcase/` are explicitly marked *"SYNTHETIC KIT DEMO — not a station layout"*. They exist to show how the pieces read together, not as a proposal for either station.

| | |
| --- | --- |
| ![Concourse approach](img/concourse_approach.jpg) | ![Gate line](img/concourse_gates.jpg) |
| Approach: ticket kiosks, wayfinding totem, hanging signs, tactile guidance, 6+2-aisle gate line | Gates: IC readers, LCD, status lamps, wide accessible aisle |
| ![Closed flaps](img/concourse_gates_closed.jpg) | ![Paid side](img/concourse_paid_side.jpg) |
| Flaps posed **closed** from the GLB's own params (`close_flaps`) | Paid side: columns, bench, lift portal, blade sign |
| ![Vertical](img/vertical_hero.jpg) | ![Godot contact sheet](img/godot_contact_sheet.jpg) |
| Stairs with landing and escalators | Same GLBs imported by Godot 4.7 with default import settings |
| ![Web gallery](img/web_gallery.jpg) | ![Web viewer](img/web_viewer_escalator.jpg) |
| three.js gallery of all 48 assets | three.js single-asset viewer (sockets on) |

Full-resolution PNGs were rendered to a scratch directory and are deliberately **not** committed. Re-create them with:

```sh
blender -b --factory-startup -P tools/blender/render_preview.py -- \
  --layout tools/blender/showcase/concourse_demo.json --camera gates --res 1920x1080 --out /tmp/gates.png
```

## Import notes for consumers

- **Axes and units:** metres, glTF +Y up. Linear modules start at z=0 and extend toward −Z. Walking surfaces are at y=0. Sockets point outward along their local −Z. Godot and three.js need no rotation or scale fix.
- **Collision:** in Godot, `COL_*-colonly` nodes become `StaticBody3D` with default import settings. In three.js they load as ordinary meshes named `…-colonly`; hide them, or feed them to your physics engine. Stairs and escalators collide as smooth ramps.
- **Materials:** standard metallic-roughness PBR with an ORM texture. `KHR_materials_emissive_strength` is the only extension; Draco and meshopt are not used. Material names (`gteki_*`) are stable, so runtimes can swap materials by name.
- **Glass:** `gteki_glass_*` is alpha-blended. Expect normal sorting artefacts in both engines when you look through two glass layers; for close-up views, set Godot's depth-draw mode or three.js `depthWrite` as you prefer.
- **Exporter warning:** Blender prints "More than one shader node tex image used for a texture" for the ORM packing. The warning is harmless; the glTF uses one ORM texture per material.
- **HQ path:** `TEX_RES=2048 OUT=/path/to/hq tools/blender/build.sh build` (or `TEX_RES=4096`) regenerates every texture at higher resolution, with the same physical relief and seamless tiling. Write HQ builds to a separate `--out`; `--only` refuses to mix resolutions in one manifest.

## Independent review

A fresh read-only GPT-6 Astra (high) review of WIP commit `9d48ca4` found 4 P1 and 4 P2 issues. All eight are fixed in this branch:

| # | Finding | Fix |
| --- | --- | --- |
| P1 | Wide-aisle flaps left ~14 cm gaps when closed; sliding flaps could not hide in a 0.22 m cabinet | Flaps redesigned as hinged fan doors stored along the cabinet face. Each node origin is its hinge, and `flap_close_yaw_deg` swings it across the aisle; verified from GLB vertices to stop 10 mm short of centre in every aisle, wide ones included |
| P1 | Root `extras.gteki.params` turned lists and booleans into JSON strings | Root extras are rewritten after export with exact JSON types |
| P1 | Validator passed GLBs containing NaN positions or out-of-range indices | Validator decodes POSITION and index data; self-test covers both cases |
| P1 | Godot test printed PASS regardless of failed checks | Required checks now FAIL and set a non-zero exit; added parity checks against the manifest and a guard against the runner exiting 0 without a report |
| P2 | Normal relief fell ~4× at 2048 textures | Strength now scales with resolution (tactile slope p99 0.82 at 1024, 0.85 at 2048) |
| P2 | Escalator tread texture had a seam | Periodic pitches snap to whole cycles per tile; wrap step is now 0 |
| P2 | `--only` typos succeeded silently and relabelled the texture resolution | Unknown ids and resolution mismatches abort before anything is written |
| P2 | Provenance overstated poster rights | Wording now limited to the recorded evidence; the Owner confirms provider terms before licensing |

## Known gaps / blockers

1. **Texture dedupe for Web.** Shared materials are embedded per GLB. Proposed fix: a `.gltf` + shared texture directory and KTX2/Basis variant, or runtime material swap by `gteki_*` name. Do this before a scene loads dozens of kit pieces over mobile networks.
2. **Wall openings.** Passages have solid walls; the lift portal and shop fronts are wall-mounted decorations, not cut openings. Station leads who need a doorway should use a passage node or request a `passage_straight` `openings` parameter.
3. **Glass sorting** is described in Import notes; no fix in the kit.
4. **Vending machine** has 24 material slots (product-face colours), which is fine on desktop. If draw calls matter on phones, the next step is an atlas.
5. **Not measured:** phone GPU frame times. The kit ships no scene; frame-time evidence belongs with each station's L2 walkthrough.
6. **Licence:** the repository licence is undecided. Every GLB says so in `extras.gteki.license`.
