# GTEki Blender asset factory (Lane E)

Reproducible, parametric generators for a **generic, reusable station kit** (passages, junctions, fare-gate arrays, stairs, escalators, lift portals, wayfinding signs, props). Output is contract GLB (`docs/assets/asset-contract.md`) for the Three.js Web client and Godot 4. The kit carries no navigation truth and does not replicate any operator's equipment or any specific Ikebukuro/Shinjuku location; station leads decide placement and art direction.

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
ONLY=gteki_gate_array_4w1 tools/blender/build.sh build   # rebuild a subset
TEX_RES=2048 OUT=/tmp/kit_hq tools/blender/build.sh build # high-res textures (Godot HQ)
```

Viewer: `pnpm --dir tools/blender/web_preview install && pnpm --dir tools/blender/web_preview dev`, then open `/?asset=<id>` or `/?mode=gallery`.

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
| `gteki_assets/families/*.py` | Generators by family |
| `render_preview.py` | GLB round-trip renders |
| `validate_glb.py` | Stdlib contract validator (`--self-test` included) |
| `godot_import/` | Godot 4 project: headless import report + screenshot mode |
| `web_preview/` | Three.js viewer + Node GLTFLoader load test |

## Writing a generator

A generator is `fn(asset_id, params, tex_res) -> Asset` registered in its module's `GENERATORS`. Author in Blender Z-up with the entry edge at `y = 0`, travel/rise toward `+Y`, walking surface at `z = 0` (exported as glTF +Y up, entry at z=0 extending to −Z, front +Z). Use:

- `a.part(group, bevel=…)` for visuals; parts in a group are joined into one `VIS_<group>` mesh (fewer draw calls). Small chamfers (2–6 mm) plus weighted normals are what make hard-surface pieces read as finished rather than blockout.
- `a.col_box` / `a.col_ramp` for simple collision (`COL_*-colonly`); stairs/escalators collide as ramps.
- `a.socket(name, loc, yaw, width=…, height=…)` for snap points (local +Y Blender = outward).
- `a.light_hint(name, loc, kind=…, …)` where a fixture emits light.
- Materials by stable name; add new ones with `materials.register()`. Keep everything original: no brand marks, no copied pictograms, no text in textures.

Determinism: all randomness is seeded, textures are cached by content hash, UVs are quantized after modifiers; `build.sh repro` guards it.
