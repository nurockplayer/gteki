# GTEki Blender asset factory (Lane E)

Reproducible, parametric generators for a **generic, reusable station kit** (passages, junctions, fare-gate arrays, stairs, escalators, lift portals, wayfinding signs, props, ceiling luminaires, wall trim, column cladding). Output is contract GLB (`docs/assets/asset-contract.md`) for the Three.js Web client and Godot 4. The kit carries no navigation truth and does not replicate any operator's equipment or any specific Ikebukuro/Shinjuku location; station leads decide placement and art direction.

## Requirements

- Blender 5.2 LTS (`brew install --cask blender`). The committed library is built with 5.2.2, and `build.sh repro` compares against it only on 5.2, because each GLB embeds the exporter version. Blender 4.2–5.1 are untested: the generators may run, but their output bytes will differ.
- Godot 4.x for the import test (tested 4.7.2, `brew install --cask godot`)
- pnpm for the Three.js viewer / load test (`brew install pnpm`) — never npm/npx/yarn
- No pip packages: generators use Blender's bundled numpy; `validate_glb.py` is stdlib only.

## Commands

```bash
tools/blender/build.sh            # generate assets/library from the catalog + validate
tools/blender/build.sh all        # + Godot headless import + Three.js load test
tools/blender/build.sh repro      # two clean builds must be byte-identical to each other and to assets/library
tools/blender/build.sh selftest   # validator, texture budget and bundle tool self-tests (stdlib only)
ONLY=gteki_gate_array_4w1 tools/blender/build.sh build   # rebuild a subset
TEX_RES=2048 OUT=/tmp/kit_hq tools/blender/build.sh build # high-res textures (Godot HQ)
PROFILE=mobile tools/blender/build.sh all                 # mobile tier into assets/library/mobile (palette, merged VIS_body, UV1)
```

Viewer: `pnpm --dir tools/blender/web_preview install && pnpm --dir tools/blender/web_preview dev`, then open `/?asset=<id>` or `/?mode=gallery`.

Texture budget (`docs/assets/texture-budget.md`): `build.sh validate` also runs
`texture_budget.py assets/library --check tools/blender/catalog/budget.json`. For a before/after report, run
`python3 tools/blender/texture_budget.py assets/library --compare <old_library> --layout tools/blender/showcase/concourse_demo.json`.

Kit bundles (one GLB per scene; textures and materials stored once; clone per placement):
`python3 tools/blender/bundle_kit.py bundle --library assets/library --layout <layout.json> --out kit.glb` (also `--ids`, `--all`, `extract`, `info`).
Load benchmark: run the viewer and open `/bench.html?strategy=per_instance|per_asset|bundle`. Bundles are served from `tools/blender/out/bundles/`, and setting `GTEKI_COMPARE_LIBRARY_DIR` serves a second library as `&lib=compare`.

Godot screenshots: `sh tools/blender/godot_import/run_import_test.sh --screenshot assets/library/glb <out>`.

Blender round-trip renders (re-imports the GLBs, lights them from `LIGHTHINT_*`):
`blender -b --factory-startup -P tools/blender/render_preview.py -- --layout <layout.json> --out shot.png`.

Editable sources: add `--save-blend <dir>` to `build.py` to save a `.blend` per asset (keep outside Git), or change parameters in a catalog and rebuild — the catalog plus code is the source of truth.

## Layout

| Path | Purpose |
| --- | --- |
| `build.py`, `build.sh` | Catalog → GLB batch build, manifest, validation, import tests |
| `catalog/kit_v0_1.json` | Shared kit variants (ids, generator, params) |
| `gteki_assets/contract.py` | Contract constants (`gteki-asset/0.1`) |
| `gteki_assets/mesh.py` | bmesh builders (box, prism, extrusions, cylinder, tube sweeps), metric box UVs |
| `gteki_assets/asset.py` | Asset assembly: parts → bevel + weighted normals → joined `VIS_*`, `*-colonly` collision, sockets, light hints, extras, GLB export |
| `gteki_assets/texsynth.py` | Seeded **tileable** numpy textures (terrazzo, tiles, metals, tactile blocks, treads, …) |
| `gteki_assets/materials.py` | Stable `gteki_*` PBR material library |
| `gteki_assets/families/*.py` | Generators by family (`passage`, `gates`, `vertical`, `signage`, `props`, `fixtures`) |
| `render_preview.py` | GLB round-trip renders |
| `validate_glb.py` | Stdlib contract validator (`--self-test` included) |
| `texture_budget.py` | Download / GPU texture report, before-after compare, layout costing, budget check (`catalog/budget.json`) |
| `bundle_kit.py` | `gteki-kit-bundle/0.1`: pack assets into one GLB with shared images/materials; extract; info |
| `godot_import/` | Godot 4 project: headless import report + screenshot mode |
| `web_preview/` | Three.js viewer, load-strategy bench (`bench.html`), Node GLTFLoader load test |

## Fixtures (batch D1)

`families/fixtures.py` holds the finishes-and-dressing generators that stations fit to geometry they already have. Their params are in millimetres (`*_mm`) and live in the catalog entry, so a station catalog passes its own length, width, depth or height; the kit itself carries no station measurement. All materials come from the style palette, so the mobile palette is unchanged. None of the pieces has a `COL_*-colonly` node (validate reports one WARN each, as for tactile strips): luminaires hang from the ceiling, trim is centimetres proud of a wall, and a column sleeve dresses a column whose collider stays the station's.

| Generator | Placement | Params (defaults) | Catalog ids |
| --- | --- | --- | --- |
| `luminaire_linear` | ceiling | `length_mm` 1200, `width_mm` 130, `depth_mm` 40, `cap_mm` 20, `rail_mm` 16, `recess_mm` 4, `ceiling_height_mm` 2800 | `gteki_luminaire_linear_1200` |
| `luminaire_panel` | ceiling | `width_mm` 600, `length_mm` 600, `frame_mm` 22, `lip_mm` 12, `gasket_mm` 6, `recess_mm` 3, `ceiling_height_mm` 2800 | `gteki_luminaire_panel_600` |
| `luminaire_downlight` | ceiling | `diameter_mm` 150, `aperture_mm` 100, `lip_mm` 12, `gasket_mm` 6, `recess_mm` 4, `segments` 24, `ceiling_height_mm` 2800 | `gteki_luminaire_downlight_d150` |
| `trim_run` | wall | `length_mm` 3000, `height_mm` 120, `depth_mm` 12, `bottom_mm` 0, `profile` flat / stepped / bullnose, `material` steel_brushed / wall_panel_accent / floor_granite_dark, `miter_start`, `miter_end` none / inside / outside | `gteki_trim_chair_rail_3000_steel`, `gteki_trim_skirting_3000_steel`, `gteki_trim_skirting_3000_granite` |
| `column_sleeve` | free | `width_mm` 600, `depth_mm` 600, `height_mm` 2800, `plinth_mm` 120, `ceiling_gap_mm` 30, `panel` enamel / accent, `corner_guard` true, `guard_height_mm` 1500, `module_mm` 1200 | `gteki_column_sleeve_600x600_h2800`, `gteki_column_sleeve_900x600_h3200_accent` |

- **Luminaires** have a `SOCKET_ceiling` on the mounting plane (extras `mount: "ceiling"`; `width` is the plan width, `height` how far the fixture hangs). The origin is on the floor under the fixture (contract `ceiling`), so a station with another ceiling height lifts the instance instead of asking for a variant, and every fixture of a kind shares one mesh. The linear module also has `start`/`end` sockets for rows. Each carries one `LIGHTHINT_*` (`linear_led`, `panel`, `downlight`) that `render_preview.py` turns into a matching light. The diffuser is `gteki_light_diffuser`, flush or 3-4 mm recessed in a dark gasket; the frame is a 12 mm lip, so the station's ceiling needs no opening.
- **Trim runs** extrude one profile along X, centred, with the wall plane at y = 0. `length_mm` is measured on the wall face; a mitre (45 degrees) is cut on the profile depth, `outside` leaving the front edge longer. The bevel follows style.md section 5: 2.5 mm / 1 segment ("Trim and small") for `flat` and `stepped`, 1 mm for the already rounded `bullnose`. `start`/`end` sockets chain runs. Texture runs along the trim.
- **Column sleeves** are enamel panels (18 mm) split on `module_mm` with 8 mm shadow gaps over a `gteki_reveal_dark` backing, a brushed kick plate with a 12 mm gap, a gap under the ceiling and 10 mm corner joints. With `corner_guard` four stainless L-guards (40 mm legs, 3 mm sheet) sit on the corners.

Build just these pieces (add `PROFILE=mobile` for the mobile tier): `ONLY=gteki_luminaire_linear_1200,gteki_luminaire_panel_600,gteki_luminaire_downlight_d150,gteki_trim_chair_rail_3000_steel,gteki_trim_skirting_3000_steel,gteki_trim_skirting_3000_granite,gteki_column_sleeve_600x600_h2800,gteki_column_sleeve_900x600_h3200_accent sh tools/blender/build.sh build`.

## Writing a generator

A generator is `fn(asset_id, params, tex_res) -> Asset` registered in its module's `GENERATORS`. Author in Blender Z-up with the entry edge at `y = 0`, travel/rise toward `+Y`, walking surface at `z = 0` (exported as glTF +Y up, entry at z=0 extending to −Z, front +Z). Use:

- `a.part(group, bevel=…)` for visuals; parts in a group are joined into one `VIS_<group>` mesh (fewer draw calls). Small chamfers (2–6 mm) plus weighted normals are what make hard-surface pieces read as finished rather than blockout.
- `a.col_box` / `a.col_ramp` for simple collision (`COL_*-colonly`); stairs/escalators collide as ramps.
- `a.socket(name, loc, yaw, width=…, height=…)` for snap points (local +Y Blender = outward).
- `a.light_hint(name, loc, kind=…, …)` where a fixture emits light.
- Materials by stable name; add new ones with `materials.register()`. Keep everything original: no brand marks, no copied pictograms, no text in textures.
- Set `repeat_m` to the material's real repeat. Texture size follows from it (`materials.texture_res`), and maps that come out flat are exported as factors (`materials.texture_plan`), so do not pad a generator with invisible noise to "fill" a map. A face with a single 0–1 UV island that is not square (signs) should draw at its physical aspect (see `signage._face_shape`).

Determinism: all randomness is seeded, textures are cached by content hash, UVs are quantized after modifiers; `build.sh repro` guards it.
