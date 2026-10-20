# Texture budget and dedupe — kit 0.1.0

Updated 2026-10-21 · contract `gteki-asset/0.1` (additive changes only) · lane: Issue #11.

**Result:** compared with the previous library (PR #17 at `d77257b`), the kit downloads **21 % less** and needs **56 % less unique GPU texture memory**. Rendered quality is unchanged (SSIM ≥ 0.998 on every showcase and close-up camera). A scene that loads a **kit bundle** and clones it per placement goes further. On the 29-item concourse demo it downloads **4.25 MiB instead of 13.66 MiB** and uses **111.5 MiB of texture memory in Godot instead of 952 MiB**, and loads in about 0.26 s instead of 1.6 s, compared with loading each placement's GLB, which is what the shared core does today. Every GLB is still self-contained, JPEG-only and byte-reproducible, and imports into Godot 4.7 and three.js unchanged.

## What changed

| Lever | Where | Effect |
| --- | --- | --- |
| **Texel-density sizing.** `tex_res` is both the cap and the target texels per metre. A material that repeats every 0.25 m gets a 256 px texture instead of being stored at 4096 px/m. | `materials.texture_res` | 9 of 31 textured materials smaller: steel, tactile, perforated metal and gate bodies at 512; escalator tread and nosing at 256 |
| **Flat-map factorisation.** A map whose per-channel std is below 1 level (albedo), 2 levels (roughness/metal) or 1.5 levels (normal, about 0.7° of tilt) is exported as the material factor, not a texture. The statistics are taken from the exact 8-bit PNG values, in float64. | `materials.texture_plan` | 36 of 93 maps dropped. Sign faces and the UI screen keep albedo only; painted steel and enamel panels lose their flat ORM (and the accent panel its flat albedo); terrazzo loses a flat normal |
| **Aspect-matched sign faces.** A 4.6:1 bar sign gets 1024×256 instead of 1024², and a map totem gets 512×1024, at the same texels per metre. | `signage._face_shape` | 33 MiB less unique GPU memory across the kit |
| **Kit bundle** (`gteki-kit-bundle/0.1`). One GLB per scene, with images, samplers, textures and materials stored once. Placements are clones that share GPU resources. | `tools/blender/bundle_kit.py`, [contract §7](asset-contract.md#7-kit-bundles--gteki-kit-bundle01-derived-optional) | cross-asset dedupe without external files, so the Lane C fence and Godot's self-contained rule still hold |

The manifest records each textured material's plan, for example `"textures": {"gteki_floor_terrazzo": {"res": 1024, "maps": ["albedo", "orm"]}}`, and the validator checks the GLBs against it.

### Options evaluated and not adopted (yet)

| Option | Measured | Decision |
| --- | --- | --- |
| **Shared external textures** (`.gltf` + image folder) | — | Rejected. Godot's `gteki_assets.gd` (Lane C) refuses GLBs that are not self-contained, and the Web fence must map every external URI. The bundle gets the same dedupe inside one GLB. |
| **WebP** (`EXT_texture_webp`, q88) | concourse bundle 3.37 MiB vs 4.25 MiB JPEG | Not now. It re-encodes lossy JPEG (generation loss), GPU memory is unchanged, and Godot's runtime loader gives it no mipmaps, just as for JPEG. |
| **KTX2 / Basis** (`KHR_texture_basisu`: ETC1S for colour and ORM, UASTC + RDO for normals) | concourse bundle **4.75 MiB, 36 MiB GPU est.** (vs 4.25 / 145) in three.js with `KTX2Loader`; `basisu` 2.50 output is deterministic | **Opt-in candidate only.** It needs `KTX2Loader` plus a transcoder in the shared core (Lane C). ETC1S at default settings loses detail on some maps: albedo median 39.6 dB (worst 28.3, terrazzo), ORM median 47.3 dB (perforated-steel mask 19.3), normals median 48.1 dB (worst 42.0). Images must be a multiple of 4 (the 682×1024 posters must be resized). A shippable variant needs per-map settings (UASTC for masks) and a quality gate. |
| meshopt / quantised geometry | — | Not tested. Geometry is now about 8 MiB of the 21 MiB library and about 2 MiB of the 4.25 MiB concourse bundle, so it is the next lever, but it needs a Godot import test first. The contract keeps meshopt out of the canonical GLB. |

## Measurements

Machine: Apple M2 Pro. Blender 5.2.2, Godot 4.7.2 (Metal Forward+), three.js 0.180 in Chromium (Claude's built-in browser), with the GPU synced each frame by a 1-pixel readback. *Baseline* is the committed library at `d77257b`; *now* is this branch. GPU memory "est." is width × height × 4 bytes × 4/3 for mips, per unique image.

### Library (`tools/blender/texture_budget.py`)

| MiB | Baseline | Now | Change |
| --- | ---: | ---: | ---: |
| Download, all 48 GLBs | 26.50 | 21.03 | −21 % |
| Embedded image bytes | 18.46 | 13.01 | −30 % |
| Unique image bytes | 3.88 | 2.42 | −38 % |
| GPU est., all 48 GLBs loaded once | 2203 | 1153 | −48 % |
| GPU est., unique images | 437 | 192 | −56 % |
| Images: instances / unique | 414 / 83 | 320 / 60 | |
| Whole kit as one bundle (`--all`) | 11.84 | 10.37 | −12 % |

### Layouts: cost by loading strategy

`per_instance` loads one GLB per placed item (the shared core's `ctx.loadGlb` and `manifestScene` today). `per_asset` loads each distinct GLB once and clones it. `bundle` loads one bundle and clones it.

| Layout | Strategy | Download MiB, baseline → now | GPU est. MiB, baseline → now |
| --- | --- | ---: | ---: |
| Concourse (29 items, 20 assets) | per_instance | 13.66 → 10.78 | 1266 → 666 |
| | per_asset | 8.26 → 6.19 | 731 → 319 |
| | **bundle** | 5.26 → **4.25** | 315 → **145** |
| Vertical (11 items, 11 assets) | per_instance | 4.46 → 3.48 | 224 → 67 |
| | bundle | 3.96 → 3.37 | 155 → 55 |

### Godot 4.7 runtime (`GLTFDocument.append_from_file`, as `gteki_assets.gd` loads), concourse

RENDER_TEXTURE_MEM_USED after 5 frames, with a window and the Metal renderer. Load time is the median of 3 runs.

| Concourse, 29 placements | Textures | Texture memory MiB | Load ms (3 runs) | Median |
| --- | ---: | ---: | ---: | ---: |
| Baseline, one GLB per placement | 239 | 952.0 | 1698 / 1461 / 1575 | 1575 |
| **Now**, one GLB per placement | 172 | **502.0** | 905 / 1176 / 871 | 905 |
| Baseline bundle + `duplicate()` | 60 | 238.5 | 431 / 530 / 425 | 431 |
| **Now bundle + `duplicate()`** | **43** | **111.5** | 262 / 256 / 247 | **256** |

The editor import of the bundle produces 34 `StaticBody3D`, matching the manifest's `collision_nodes`, and shares its textures across assets. `Node.duplicate()` of an asset root adds no textures or meshes. Godot's runtime glTF loader creates JPEG textures **without mipmaps**, so measured memory sits below the estimate. That is also an aliasing risk (see Lane C notes below).

### three.js (`tools/blender/web_preview/bench.html`), concourse, 1280×720

| Strategy | Requests | Download MiB | GPU textures | GPU est. MiB | Load ms | First frame ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| per_instance, baseline | 29 | 13.66 | 232 | 1265.8 | 1009 | 3231 |
| per_instance, now | 29 | 10.78 | 169 | 665.8 | 396 | 1669 |
| per_asset, baseline | 20 | 8.26 | 133 | 730.7 | 1925 | 4574 |
| per_asset, now | 20 | 6.19 | 91 | 318.7 | 320 | 803 |
| bundle, baseline | 1 | 5.26 | 61 | 314.7 | 465 | 1022 |
| **bundle, now** | 1 | **4.25** | 44 | **145.3** | 324 | 755 |
| bundle, now, WebP q88 (not adopted) | 1 | 3.37 | 44 | 145.3 | | |
| bundle, now, KTX2 + `KTX2Loader` (not adopted) | 1 | 4.75 | 44 | 36.3 | | |

All rows draw 244 calls. "GPU textures" is `renderer.info.memory.textures`; it includes the one environment map (the bundle row is 43 kit images + 1). The KTX2 estimate counts 1 byte per texel (ETC1S/UASTC transcoded to a compressed GPU format).

The bytes, texture counts and GPU estimates are deterministic. The timings are medians of 3 runs on the library just before the final flat-map statistics fix (bytes within 1 %); they come from a shared dev machine with other jobs running, so read them as ranges. Re-runs on the final library in a background (throttled) browser pane are not comparable and are not shown. Frame time is the same for every strategy (same 244 draw calls in view), because the gain is memory and load, not shading.

### Image quality

Renders are Blender EEVEE round-trips of the GLBs (`render_preview.py`, 1920×1080, 64 samples), compared with `magick compare` against the baseline renders. Close-ups are 1280×720.

| Camera | SSIM | PSNR dB |
| --- | ---: | ---: |
| concourse_approach | 0.9988 | 42.4 |
| concourse_gates | 0.9989 | 42.5 |
| concourse_gates_closed | 0.9983 | 40.4 |
| concourse_paid_side | 0.9984 | 46.3 |
| vertical_hero | 0.9997 | 57.7 |
| closeup_gate | 0.9996 | 56.0 |
| closeup_escalator | 0.9987 | 51.9 |
| closeup_tactile | 0.9987 | 51.0 |
| closeup_column | 0.9990 | 54.0 |
| closeup_bench | 0.9986 | 42.9 |
| closeup_wall | 0.9998 | 61.0 |
| closeup_totem | 0.9989 | 47.6 |
| closeup_vending | 1.0000 | 75.3 |
| closeup_kiosk | 0.9995 | 53.6 |
| sign_hanging | 0.9991 | 43.9 |
| sign_wall | 0.9994 | 48.6 |
| sign_totem | 0.9988 | 49.5 |

![Close-ups, baseline (left) and now (right): perforated bench, tactile dots, escalator treads](img/texture_budget_closeups.jpg)

The lowest close-up scores belong to the bench (perforated steel at 512) and the tactile and tread textures (512 and 256). At pixel level they are indistinguishable in side-by-side crops: no moiré, no lost holes or dots.

## Regression tests

- **`tools/blender/build.sh validate`** runs `texture_budget.py --check tools/blender/catalog/budget.json` after the contract validator. It fails when:
  - an image is larger than its material's planned `res`;
  - a planned `res` is above the library's `texture_resolution` (supplied poster images are planned too, capped at `tex_res`);
  - a material samples more images than its plan keeps;
  - a GLB embeds the same image bytes twice;
  - a GLB and the manifest disagree;
  - the committed library exceeds the byte or GPU limits.

  The limits only apply to the library they were measured on (`kit_v0_1.json` at 1024), so station catalogs and HQ builds are checked by the rules alone. Raise a limit deliberately, in the PR that needs it, with numbers.
- **`tools/blender/build.sh selftest`** runs the stdlib self-tests: the validator, the budget checker (each rule plus the scoping), and the bundle tool. The bundle tool's test covers dedupe, the material-name conflict, repeated-name tags, determinism, extraction fidelity, alternate image sources and image headers.
- **`tools/blender/build.sh repro`**: two clean builds (fresh texture caches) are byte-identical to each other and to the committed library.
- **Bundle round trip:** `bundle --all`, then `extract` for each of the 48 assets. Every extract validates exactly like its source (`validate_glb.py` reports identical apart from file size), with identical node names, extras and TRS.

## Using a bundle (station leads)

```sh
python3 tools/blender/bundle_kit.py bundle --library assets/library \
  --ids gteki_gate_array_6w1,gteki_bench_4seat,gteki_sign_totem --out stations/<id>/gteki/assets/kit.glb
```

```js
// three.js — load once, clone per placement (clones share geometry/material/texture)
const kit = (await ctx.loadGlb('assets/kit.glb')).scene.children[0];
const byId = new Map(kit.children.map((c) => [c.name, c]));        // asset roots keep their ids
const gate = byId.get('gteki_gate_array_6w1').clone();
const contractName = (o) => o.userData.gteki_name ?? o.name;        // repeated names are suffixed on load
```

```gdscript
# Godot — duplicate() shares meshes and materials
var kit := (load("res://.../kit.glb") as PackedScene).instantiate().get_child(0)
var gate := kit.get_node("gteki_gate_array_6w1").duplicate()
func contract_name(n: Node) -> String: return n.get_meta("extras", {}).get("gteki_name", n.name)
```

Build the bundle from the assets your scene places, rather than `--all`. A bundle holds every listed asset whether or not the scene places it.

## Notes for Lane C (shared core); proposals only, no core code changed

1. **URI cache in `ctx.loadGlb`.** `manifestScene` and scene modules that place one GLB several times load and upload it each time. On the concourse demo that is 10.78 MiB vs 6.19 MiB download and 666 vs 319 MiB GPU with the same library. A per-URI promise cache plus `clone()` needs ref-counted disposal. Scene modules can do this themselves today, or load a bundle.
2. **KTX2.** Adding `KTX2Loader` and the Basis transcoder behind the asset fence would cut GPU texture memory about 4× (145 → 36 MiB est. on the concourse bundle) for about 12 % more download. That is the core's decision. The kit will ship a KTX2 variant only after the core can load it and a per-map quality gate exists.
3. **Godot runtime mipmaps.** `GLTFDocument` at runtime leaves JPEG textures without mipmaps, which means aliasing on floors at distance. Calling `generate_mipmaps()` on loaded images, or using KTX2, would fix it at about +33 % memory.

## Reproduce

```sh
sh tools/blender/build.sh && sh tools/blender/build.sh selftest && sh tools/blender/build.sh repro
python3 tools/blender/texture_budget.py assets/library --compare /path/to/old/library \
  --layout tools/blender/showcase/concourse_demo.json --layout tools/blender/showcase/vertical_demo.json
python3 tools/blender/bundle_kit.py bundle --library assets/library --layout tools/blender/showcase/concourse_demo.json \
  --out tools/blender/out/bundles/kit_concourse.glb
GTEKI_COMPARE_LIBRARY_DIR=/path/to/old/library pnpm --dir tools/blender/web_preview dev   # then /bench.html?strategy=bundle
```

The old library is `git show d77257b:assets/library/...`. The Godot runtime probe is a 60-line `SceneTree` script and is not committed; its method is described above.
