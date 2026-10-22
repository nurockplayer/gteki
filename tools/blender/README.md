# GTEki Blender asset factory (Lane E)

Reproducible, parametric generators for a **generic, reusable station kit** (passages, junctions, fare-gate arrays, stairs, escalators, lift portals, wayfinding signs, props, and dressing fitted to a station's own stairs, escalators and floor plan). Output is contract GLB (`docs/assets/asset-contract.md`) for the Three.js Web client and Godot 4. The kit carries no navigation truth and does not replicate any operator's equipment or any specific Ikebukuro/Shinjuku location; station leads decide placement and art direction.

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
| `gteki_assets/families/*.py` | Generators by family (`dressing.py`: see below) |
| `render_preview.py` | GLB round-trip renders |
| `validate_glb.py` | Stdlib contract validator (`--self-test` included) |
| `texture_budget.py` | Download / GPU texture report, before-after compare, layout costing, budget check (`catalog/budget.json`) |
| `bundle_kit.py` | `gteki-kit-bundle/0.1`: pack assets into one GLB with shared images/materials; extract; info |
| `godot_import/` | Godot 4 project: headless import report + screenshot mode |
| `web_preview/` | Three.js viewer, load-strategy bench (`bench.html`), Node GLTFLoader load test |

## Writing a generator

A generator is `fn(asset_id, params, tex_res) -> Asset` registered in its module's `GENERATORS`. Author in Blender Z-up with the entry edge at `y = 0`, travel/rise toward `+Y`, walking surface at `z = 0` (exported as glTF +Y up, entry at z=0 extending to −Z, front +Z). Use:

- `a.part(group, bevel=…)` for visuals; parts in a group are joined into one `VIS_<group>` mesh (fewer draw calls). Small chamfers (2–6 mm) plus weighted normals are what make hard-surface pieces read as finished rather than blockout.
- `a.col_box` / `a.col_ramp` for simple collision (`COL_*-colonly`); stairs/escalators collide as ramps.
- `a.socket(name, loc, yaw, width=…, height=…)` for snap points (local +Y Blender = outward).
- `a.light_hint(name, loc, kind=…, …)` where a fixture emits light.
- Materials by stable name; add new ones with `materials.register()`. Keep everything original: no brand marks, no copied pictograms, no text in textures.
- Set `repeat_m` to the material's real repeat. Texture size follows from it (`materials.texture_res`), and maps that come out flat are exported as factors (`materials.texture_plan`), so do not pad a generator with invisible noise to "fill" a map. A face with a single 0–1 UV island that is not square (signs) should draw at its physical aspect (see `signage._face_shape`).

Determinism: all randomness is seeded, textures are cached by content hash, UVs are quantized after modifiers; `build.sh repro` guards it.

## Dressing family

`families/dressing.py` makes pieces that go on geometry a station already has. They have no `COL_*` collision nodes, carry `gteki_role` (contract §9; the station runtime treats `barriers` and `transport` as colliders and `stairs_ramps` as walkable) and take every size as a catalog param in millimetres, so the kit holds no station measurements. The escalator and stair generators reuse `vertical.py`.

| Generator | Params (defaults) | Origin |
| --- | --- | --- |
| `escalator_dressing` | `rise_mm` 4000, `width_mm` 1000, `angle_deg` 30 or `run_mm` (horizontal run between the flat sections, eased ends included), `landing_mm` 800 (newel clearance and skirt length, both ends), `flat_steps` 2, `balustrade` glass or panel, `direction`, `parts` of balustrade, handrail, newel, comb (all four; e.g. `["comb", "newel"]` for a station that keeps its own balustrade), `skirts` false, `treads` false (static treads for flat slabs), `indicators` false; `gteki_role` `transport` (catalog override: `null` or another role) | bottom comb plate line |
| `stair_dressing` | `step_count` 18, `riser_mm` 160, `tread_mm` 300, `width_mm` 2400, `parts` of nosing, handrail, skirt, `handrail_sides` / `skirt_sides` both, left, right or none, `rail_mount` post or wall, `post_spacing_mm` 1800, `skirt_mm` 140, `skirt_drop_mm` 200; `gteki_role` `stairs_ramps` for nosing only, `barriers` for rails and skirts, none for a mix (catalog override: `null` or another role) | floor under the bottom nosing |
| `railing_run` | `points` (`[[x_mm, y_mm], ...]`), `height_mm` 1100 (guard; 1150 for a fare fence), `style` glass or steel, `post_spacing_mm` 1200, `mid_rails` 2 (steel); `gteki_role` `barriers` (catalog override: `null` or another role) | plan origin of `points` |

A catalog entry may set `"gteki_role"` to override a generator's default role: `null` drops it, or another of `barriers`, `transport`, `stairs_ramps` (contract §9).

Variants are the `gteki_escalator_dress_*`, `gteki_stair_*`, `gteki_railing_run_*` and `gteki_fare_fence_*` ids in the catalog. Build them with `ONLY=<ids> tools/blender/build.sh build`.
