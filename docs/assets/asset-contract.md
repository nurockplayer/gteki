# GTEki Asset Export Contract — `gteki-asset/0.1`

Status: **Proposed by Lane E (Issue #11).** Minimal contract for reusable station kit GLBs. Shared core (#2) owns the runtime scene/asset-manifest schema; this file only fixes what a kit GLB guarantees so Web (Three.js) and Godot can consume it without per-asset fixes. Changes are versioned; breaking changes bump the minor version while `0.x`.

Kit assets are **generic, parametric building blocks** (passages, gates, stairs, escalators, signs, props). They are not replicas of any operator's equipment or of a specific Ikebukuro/Shinjuku location, and they carry **no navigation truth**. Placement, art direction and which variants a station uses belong to the station Opus leads.

## 1. Units, axes, origin

| Item | Rule |
| --- | --- |
| Units | 1 glTF unit = **1 metre**. No scene scale; root node scale is `1`. |
| Up | glTF standard **+Y up**, right-handed. (Authored in Blender Z-up; converted by exporter with `export_yup`.) |
| Front | glTF standard: the asset's front / entry side faces **+Z**. |
| Travel axis | Linear modules (passages, gate arrays, stairs, escalators) run along local **−Z**: entry edge at `z = 0`, far end at `z = −length`. |
| Origin | Floor level (`y = 0` is the walking surface at the entry), centred in X. Vertical modules rise toward −Z (`y = rise` at the exit). |
| Placement | `extras.gteki.placement` is one of `linear` (entry edge at z=0, extends −Z, walking surface y=0), `wall` (wall plane at z=0, projects into the room toward +Z, may recess into −Z), `free` (footprint centred on the origin, base y=0) or `ceiling` (hangs from above; origin on the floor below its centre). |
| Transforms | All mesh transforms are applied; no negative scales; child nodes have identity scale; the root node is at identity (no translation or rotation). |
| Grid | Default dimensions snap to **0.05 m**; module lengths default to multiples of 0.30 m (tactile-block pitch) but this is a convenience, not a requirement. |
| Below floor | Geometry under `y = 0` (structural slabs, escalator pits) is allowed only when `params.allow_below_floor` is set; validators and the Godot import test honour it. |
| Approach aprons | Anything the asset puts on the floor in front of its entry (e.g. a gate approach plate) starts at `z = 0`; the functional part's own span is recorded in params (e.g. `cabinet_span_z_m`). |

## 2. Node naming and roles

Every GLB has exactly one root node named after the asset id, e.g. `gteki_gate_array_4w1`. Ids are also file names, so they must be a single safe component: `[A-Za-z0-9_][A-Za-z0-9_-]*` (the build rejects anything else).

| Prefix / suffix | Role | Web | Godot |
| --- | --- | --- | --- |
| `VIS_*` | Render mesh | render | `MeshInstance3D` |
| `*-colonly` (e.g. `COL_floor-colonly`) | Collision only (boxes / ramps / simple hulls) | hide; feed to physics | auto `StaticBody3D` + shape (import hint). A station catalog entry with `"collision": false` builds the asset without them |
| `SOCKET_*` | Empty: snap point for modular joining | read transform + extras | `Node3D` marker |
| `LIGHTHINT_*` | Empty: suggested light placement (emissive fixtures) | optional | optional |

Animatable sub-parts are separate `VIS_*` nodes with their motion recorded in params (gate flaps: `VIS_flap_<aisle>_<L|R>`; each node's origin is its hinge, and yawing it about +Y by `flap_close_yaw_deg.L`/`.R` swings the stored flap across the aisle — reach per aisle in `flap_reach_m`). Collision meshes are deliberately simpler than visuals: stairs and escalators collide as a **smooth ramp** (character-controller friendly); gate cabinets collide as boxes; gate flaps do **not** collide (aisles stay open — gating behaviour is runtime logic, not geometry).

## 3. Metadata (`extras`)

Root node `extras.gteki` (object):

```json
{
  "contract": "gteki-asset/0.1",
  "id": "gteki_gate_array_4w1",
  "family": "gate",
  "variant": "array_4w1",
  "version": "0.1.0",
  "generator": "tools/blender/gteki_assets/families/gates.py",
  "params": { "aisles": 4, "wide_aisles": [3] },
  "bounds_m": { "min": [-1.6, 0, -1.4], "max": [1.6, 1.05, 0] },
  "triangles": 5120,
  "dimension_basis": "generic-typical",
  "placement": "linear",
  "fidelity": "generic kit; not a replica of any operator equipment or station",
  "navigation": "none — visual/physical only; routing truth lives in the station graph",
  "provenance": "original procedural geometry and textures; see assets/library/PROVENANCE.md",
  "license": "CC-BY-4.0 — original GTEki work; attribution: GTEki contributors",
  "license_spdx": "CC-BY-4.0",
  "rights_class": "original",
  "attribution": "GTEki contributors"
}
```

**Rights fields.** The Owner decided the licences in Issue #123: the kit's original procedural assets are CC BY 4.0 (attribution "GTEki contributors") and AI-generated 2D images are CC0 1.0. The schema has a rights class `original` and three further keys, all defined in `tools/blender/gteki_assets/contract.py`:

| Key | Value | Notes |
| --- | --- | --- |
| `license_spdx` | `CC-BY-4.0` | SPDX id. A poster light box built from the kit's own posters is `CC-BY-4.0 AND CC0-1.0` (CC0 for the image, CC BY for the geometry). |
| `rights_class` | `original` | The class for everything the kit generates itself. Third-party material never uses this class. |
| `attribution` | `GTEki contributors` | The credit line. |

One switch, `contract.EMBED_SPDX`, controls all of it. It is **on** since the AO rollout rebuild (#160):

- The three keys are written into every GLB's `extras.gteki` and every manifest, at the top level of both `manifest.json` files and in each asset's record.
- `contract.LICENSE` is `CC-BY-4.0 — original GTEki work; attribution: GTEki contributors`, and the GLB `asset.copyright` is `GTEki contributors. CC-BY-4.0`.
- Libraries built before the rollout carry the old `UNDECIDED` string and no rights keys. `REUSE.toml` records the decided licence for them.
- `validate_glb.py` checks the three keys: if any is present, all three must be non-empty strings and `rights_class` must be `original`.
- Path-level licences for files that are not GLBs (posters, contact sheets, third-party data) are in the root `REUSE.toml`; the credits are in `NOTICE`.

`SOCKET_*` extras: `{ "socket": "start" | "end" | "left" | "right" | ..., "width": m, "height": m }`. Two modules join when sockets coincide with opposite facing (socket local −Z points out of the module).

`dimension_basis` values: `generic-typical` (widely published typical/standard values, recorded in the catalog), `synthetic` (chosen for look only), `station-verified` (only when a station lead supplies sourced measurements — never set by the kit itself).

## 4. Materials and textures

- glTF 2.0 core PBR metallic-roughness. Allowed extensions: `KHR_materials_emissive_strength` (signs, light diffusers, gate indicators), `KHR_texture_transform` *not* used. No Draco/meshopt in the canonical GLB (derivatives may be optimized by the Web build).
- Material names are stable and prefixed `gteki_` (e.g. `gteki_floor_terrazzo`). Runtime may **swap materials by name** to apply station-specific palettes or deduplicate textures across GLBs.
- Determinism: the same catalog, code and `--tex-res` produce byte-identical GLBs (`tools/blender/build.sh repro`).
- Textures embedded as JPEG (base colour, normal, ORM roughness/metal; the occlusion map is PNG), **at most 1024 px** in the canonical Web GLB. The generator can re-export at 2048/4096 for a high-quality Godot build from the same parameters (`--tex-res`).
- Textures are tileable, generated procedurally from seeded code. **Texture budget** ([texture-budget.md](texture-budget.md)): `--tex-res` is both the cap and the target density in texels per metre, so a material that repeats every 0.25 m ships a 256 px texture rather than 1024. A map that is flat (per-channel std below 1 level for albedo, 2 for roughness/metal, 1.5 for normal) is exported as the material's factor instead of a texture. So a `gteki_*` material may have any subset of the three maps; `manifest.json` lists each textured material's `res` and kept `maps` under `textures`.
- **Baked ambient occlusion** (both tiers; one map per asset, shared by all its visual materials): an 8-bit greyscale PNG sized by tier and by the asset's largest bounds extent (`full`: 256 px under 1.5 m, 512 px under 6 m, else 1024 px, because escalators and other long assets fit many small parts into one atlas; `mobile`: 128 px under 1.5 m, else 256 px. When the charts do not fit with their 4 px gaps, or an automatically sized mobile atlas still has an area-weighted median AO density under 8 px/m (mobile joins every static part into one atlas), the build steps the map up one size at a time, to at most 1024 px, and the manifest's `occlusion_res` records the size used. A station catalog entry may pin the size on both tiers with `"ao_res"`: 128, 256, 512 or 1024), exported as the core `occlusionTexture` on `texCoord` 1 (the `UVLightmap` layer, `TEXCOORD_1`), AO in the R channel, strength 1.0. It is not packed into ORM, has no extras flag and is not KTX2. Cycles bakes it on the CPU (fixed seed and samples, no denoiser) with a 0.4 m distance: the asset's own visual meshes plus a temporary floor at Z=0 occlude; glass (`gteki_glass_*`) receives AO but does not occlude (baked in a second pass); collision, sockets and light hints do not occlude; gate flaps are baked open. A numpy blur and a 4 px dilation into the gutter keep mips from bleeding, and the build is byte-reproducible. Because the map is shared, the `TEXCOORD_1` of all visual nodes of an asset is **one atlas**: islands never overlap across nodes (so one mesh may not be instanced at several nodes), stay at least 4 px of the map apart and inside [0, 1]. Mobile UV1 uses conformally unwrapped, connected face nets with seams chosen in stable geometry order to avoid foldovers and excessively sparse charts. Chart density is normalized in world space; packing uses a 5 px gap (Blender pads each boundary by half that gap), with a deterministic rectangle pass retained only if it increases fill. A disposable legacy UV reference also prevents a mobile map reduction from lowering the prior median density (within 0.001 px/m); if the new layout needs a larger map, lowers fill, adds islands, or fails, the valid legacy layout is retained (fill tolerance 0.001 percentage points). Only the chosen layout is baked. An explicit `ao_res` pin is never enlarged for density. Full retains its original Smart UV Project layout and packing. `manifest.json` lists `occlusion` among each material's maps, with `occlusion_res`. `validate_glb.py` fails an `occlusionTexture` that is not `texCoord` 1 or has strength other than 1, a primitive without `TEXCOORD_1`, a map that is not a 128², 256², 512² or 1024² PNG, visual materials that do not share one map, and overlapping UV1 across the visual nodes. A visual material without the map passes while the kit is rolled out; `validate_glb.py --require-occlusion` makes it a FAIL.
- Sign faces use material `gteki_sign_face*` with a dedicated 0–1 UV island per face so runtime can apply canvas/text textures. Kit sign art contains only generic arrows/colour bands — **no operator brand marks, typefaces copied from operators, or station names.**

## 5. Budgets (LOD0, observed per asset in the manifest)

No hard FPS numbers are asserted here (see acceptance.md). The manifest records triangles, materials, texture plans and GLB bytes for every asset so station leads can budget. Godot generates mesh LODs automatically on import; the Web build may use meshopt simplification on derivatives.

`tools/blender/catalog/budget.json` caps the committed library (download, unique image bytes, estimated GPU texture memory). `tools/blender/build.sh validate` fails when the cap is exceeded, when an image is larger than its material's plan, when a material samples more or fewer images than its plan keeps (or samples any without a plan), or when one GLB embeds the same image twice.

## 6. Delivery files

- `assets/library/glb/<id>.glb` — canonical exports.
- `assets/library/manifest.json` — id → file, sha256, bytes, triangles, materials, bounds, params, sockets.
- `assets/library/PROVENANCE.md` — inputs and rights for every asset and texture.
- `assets/library/finishes/` — the finish pack (§9); `assets/library/mobile/finishes/` — its mobile tier.
- Regenerate with `tools/blender/build.sh` (see `tools/blender/README.md`).

## 7. Kit bundles — `gteki-kit-bundle/0.1` (derived, optional)

A bundle is one self-contained GLB holding several kit assets, so textures and materials shared between assets are stored and uploaded once. It is a **derived build output** (never committed to `assets/library`); make it from the assets a scene actually places:

```sh
python3 tools/blender/bundle_kit.py bundle --library assets/library --layout my_layout.json --out kit.glb   # or --ids a,b / --all
python3 tools/blender/bundle_kit.py extract --bundle kit.glb --id gteki_bench_4seat --out bench.glb
python3 tools/blender/bundle_kit.py info --bundle kit.glb
```

- Scene 0 has one root node, the bundle root, whose `extras.gteki_bundle` is `{contract, kit_version, texture_resolution, assets: [{id, node, source_sha256, source_bytes}]}`. Its children are the asset roots, in that order.
- Each asset root and its subtree are copied from the source GLB unchanged: node names, transforms, `extras.gteki`, sockets, `COL_*-colonly`, `LIGHTHINT_*` and flap hinges are all kept, and the asset root stays at identity. The one addition is `extras.gteki_name`, described below.
- Images are deduplicated by MIME type and content hash, samplers and textures by content, and materials by `gteki_*` name. Two materials with the same name but different content are an error. Geometry is not shared between assets.
- Assets that carry a baked occlusion map (§4) define a shared material (e.g. `gteki_palette`) differently, because each has its own map. The bundle keeps one copy per asset, named `<material>~<asset id>` with the original name in `extras.gteki_name` (as for repeated node names); `extract` restores it. Materials differing in anything else than `occlusionTexture` are still a conflict error. Instances of one asset share its material, but different asset types no longer batch together per original material.
- Output is deterministic. `bundle` refuses a library whose GLBs no longer match `manifest.json`, and `extract` rebuilds a standalone GLB that validates exactly like the source.
- **Use it by cloning.** Load the bundle once, then clone an asset root per placement: three.js `Object3D.clone()`, Godot `Node.duplicate()`. Clones share geometry, materials and textures, so they add draw calls but no GPU memory.
- **Repeated names.** Both importers make node names unique across the *whole file*. A second asset's `SOCKET_end` or `VIS_flap_0_L` loads as `SOCKET_end_1` / `VIS_flap_0_L_1` in three.js `GLTFLoader`, and as `SOCKET_end2` / `VIS_flap_0_L2` in Godot 4.7. So the bundle writes the original name to `extras.gteki_name` on every node whose name occurs more than once in the bundle; `extract` removes it again. To get a node's contract name in a bundle, read `extras.gteki_name` and fall back to the node name: `object.userData.gteki_name ?? object.name` in three.js, `node.get_meta("extras", {}).get("gteki_name", node.name)` in Godot. Look nodes up inside their asset root, never by name across the whole bundle. Godot also strips the `-colonly` suffix when it turns those nodes into `StaticBody3D`, exactly as it does for a single GLB.

## 8. Build profiles: `full` and `mobile`

`--profile` (`PROFILE=` in `build.sh`) selects how the same catalog is exported. Both profiles produce the same asset ids, params, sockets, `COL_*-colonly` collision, `LIGHTHINT_*` empties and flap hinge nodes, so a scene can switch tier by switching library directory. Root `extras.gteki` differs only in `profile`, `triangles` and `bounds_m`, which describes each tier's own visuals and colliders (mobile is within a few millimetres of full). Measurements and station guidance are in [mobile-profile.md](mobile-profile.md).

- **`full`** (default) is everything in §1–§7: `assets/library/`.
- **`mobile`** writes to `assets/library/mobile/` by default. The manifest has a top-level `"profile": "mobile"`; a manifest without it is `full`. Root extras carry `profile: "mobile"`.
  - Visual nodes: static `VIS_*` groups are merged into one `VIS_body`. Groups that have a pivot (gate flaps `VIS_flap_<aisle>_<L|R>`) stay separate nodes with the same names, origins and `flap_close_yaw_deg`.
  - Materials: every material without an image of its own is folded into the kit palette, `gteki_palette` (opaque) or `gteki_palette_blend` (alpha-blended glass). That is a 64×64 PNG with 4×4-texel swatches for albedo + alpha, ORM and emissive (`KHR_materials_emissive_strength` 4), sampled at the swatch centre with nearest filtering and no mipmaps (`magFilter` and `minFilter` 9728; the validator fails a mipmapped palette sampler). The palette is identical in every mobile GLB, so a bundle stores it once. Materials with content images (sign faces, screens, posters) keep their `gteki_*` names and embed JPEG maps. `manifest.json` `materials` lists the exported names, and `textures` includes the palette plan.
  - UVs: every texture samples `TEXCOORD_0` (`texCoord` omitted, glTF's default). `TEXCOORD_1` (`UVLightmap`) is a lightmap layout on every visual mesh, one UV space per mesh shared by its primitives, inside the unit square with no overlapping triangles (a `full` asset has it too once it carries the occlusion map, §4, where the UV space is shared by all its visual nodes). `validate_glb.py` fails a missing, malformed, non-finite, out-of-range, collapsed (UV area ~0 over ≥ 1 mm² of geometry) or overlapping UV1 (strips and fans are expanded).
  - Geometry: visual parts use about half the segments and no bevels. Collision is byte-identical to `full`: the build generates a full-detail twin of each asset and keeps its colliders.
- Byte limits are per profile: `tools/blender/catalog/budget.json` for `full`, `budget_mobile.json` for `mobile`, each with `applies_to.profile`. The per-image rules, the texCoord check (core and extension slots, `KHR_texture_transform` overrides; `extras` are not texture slots) and the lightmap checks apply to every library; only `mobile` requires UV1 on every visual mesh, and any asset with an `occlusionTexture` needs it and a joint overlap check across its visual nodes.

## 9. Finish packs — `gteki-finish/0.1`

A **finish** is a surface material a station applies to its own geometry (floor, wall, ceiling, band, trim) instead of placing a kit module. It is a tileable texture set whose repeat is given in metres, plus a flat sample GLB. Stations that paint floors and walls with runtime canvas textures swap them for a finish by name. Finishes are visual only: they carry no collision, no navigation truth and no station measurements.

### Layout

Each tier has its own pack, a library root of its own:

```text
assets/library/finishes/                  full tier   (mobile: assets/library/mobile/finishes/)
  manifest.json                           pack manifest (below)
  glb/gteki_finish_<name>.glb             sample GLB, one per finish
  gteki_finish_<name>/
    albedo.jpg  orm.jpg  normal.jpg       the maps that are not flat (any subset; declared mobile normals: normal.png)
    finish.json                           everything a station needs to apply the finish
```

- **The pack is separate from the kit manifest** so the kit's 48 records, its catalog and its budget stay as they are. `catalog/finishes_v0_1.json` defines the pack; `kind: "finish-pack"` makes `build.py` write the directories and the `finishes` section.
- **Sample GLBs sit in a flat `glb/` directory** because the existing tools take a library root with `glb/` and `manifest.json`: `validate_glb.py`, `build.sh godot`, `build.sh web`, `texture_budget.py` and `bundle_kit.py` all work on the pack unchanged. A `<id>/sample.glb` layout would need a change in every one of them.
- The sample GLB embeds the **same map bytes** as the loose files (JPEG, or the declared mobile normal PNG), and `validate_finish.py` checks that, including the image MIME type. Its baked occlusion map (§4, the image its `occlusionTexture` uses) belongs to the sample, not to the finish, and is not compared. So the pipeline that loads the sample GLB is loading the finish.

### `manifest.json`

The same fields as the kit manifest (`contract`, `kit_version`, `catalog`, `texture_resolution`, `license`, `profile` for the mobile tier, `assets` with one record per sample GLB: sha256, bytes, triangles, `textures` plan, bounds), plus:

| Field | Meaning |
| --- | --- |
| `finish_pack` | `"gteki-finish/0.1"` |
| `finishes[]` | per finish: `id`, `role`, `gteki_role`, `tint`, `repeat_m`, `dir`, `finish_json` and `files.<map>` (`file`, `bytes`, `sha256`, relative to the pack), `sample_glb`, `texture_bytes` |

### `finish.json`

| Field | Meaning |
| --- | --- |
| `format`, `id`, `kit_version`, `tier` | `gteki-finish/0.1`; the id equals the directory name, the sample GLB name and the **material name** inside the sample (`gteki_finish_*`, so a runtime can also swap by name); `full` or `mobile` |
| `role` | one of `floor`, `wall`, `ceiling`, `band`, `trim`: what the finish is for |
| `gteki_role` | hint for stations that key materials by their own surface role (Ikebukuro's `scene/materials.ts`): `floor`, `wall` or `ceiling`. Bands and trims dress walls, so they say `wall`. A hint only; the station decides |
| `facility` | station facility types the finish fits: `concourse`, `passage`, `paid_area`, `gate_surround`, `platform`, `back_of_house`. `use` says it in words and `pattern` describes the look |
| `source_material` | the kit material it derives from (`null` for the tint base) |
| `repeat_m` | `[u, v]`: the size in metres of one texture repeat |
| `uv` | orientation (below) |
| `maps.albedo`, `maps.orm`, `maps.normal` | `file`, `size` `[w, h]`, `bytes`, `sha256`. A map is listed only if it ships |
| `mobile_normal_format` | optional `"png"`, copied from the catalog param only in the mobile tier: requires `maps.normal.file = "normal.png"`. Without it, all maps are JPEG. Full-tier files omit this field |
| `factors` | `baseColorFactor` (linear RGBA), `roughnessFactor`, `metallicFactor`: exactly what the sample GLB's material carries. A shipped map has a neutral factor (`[1,1,1,1]`, 1, 1); an omitted map is replaced by its value here |
| `omitted_maps` | the maps replaced by a factor |
| `texel_density_px_per_m` | `size / repeat_m` |
| `tint`, `tint_info` | `true` for a finish the station multiplies by a colour at runtime (below) |
| `sample_glb`, `sample` | relative path (`../glb/<id>.glb`); the swatch's plane (`floor` or `wall`), repeats per side and size in metres |
| `dimension_basis`, `generator`, `license`, `provenance` | `synthetic`; the code that makes it; the kit's licence and provenance claim (original procedural work, no external image) |

### Maps

- `albedo.jpg` is sRGB. `orm.jpg` is linear: R = 1 (no baked AO), G = roughness, B = metallic. `normal.jpg` (or declared `normal.png`) is linear, tangent space, **OpenGL (+Y up)**, as in the kit.
- JPEG quality 88, square, power-of-two sizes, tileable on both axes. They are the kit generators (`texsynth.py`) with the kit's seeds, so a finish looks like the same kit material.
- **Director-approved mobile exception:** `gteki_finish_floor_granite_tile` and `gteki_finish_floor_tile600` declare `mobile_normal_format: "png"` in the catalog. Only their mobile normal maps use the cached generator PNG unchanged, at 512 px; the sample GLB embeds those identical bytes as `image/png`. Blender's JPEG encoder always uses 4:2:0 chroma subsampling, which breaks the wrap of the thin grout on the texture edge at 512 px. Lossless PNG preserves it. GPU memory is unchanged; download grows slightly. All other maps and the full tier keep JPEG.
- **Flat maps become factors**, by the kit rule ([§4](#4-materials-and-textures)): a finish may ship any subset of the three. Terrazzo has no normal map; the tint base's ORM is a roughness of 0.30.
- **Size follows the repeat**: the smallest power of two giving at least `repeat_m` x 1024 px per repeat, at most 1024, at least 128. The mobile tier halves the density (`--tex-res 512`): at most 512, at least 128. The mobile palette fold does **not** apply: finishes are textures by nature and keep their own material.

### Repeat and orientation

A texture repeat is `repeat_m` metres. On a surface whose UVs are in metres, scale them by `1 / repeat_m` (three.js `texture.repeat.set(1 / ru, 1 / rv)` with `RepeatWrapping`; Godot `uv1_scale = Vector3(1 / ru, 1 / rv, 1)`).

| Role | u | v |
| --- | --- | --- |
| `floor` | east, in the surface plane | north |
| `wall`, `band`, `trim` | along the wall | up |
| `ceiling` | east | south (the kit's box UV, so the image reads un-mirrored from below) |

Image rows run from v high (top) to v low, as in glTF once the exporter's V flip is applied (three.js `TextureLoader` with its default `flipY` is equivalent). Patterns line up with the repeat edges, so joints and tile lines stay in phase as long as the surface UV starts at a multiple of `repeat_m`:
- Panel finishes (`wall_enamel_panel`, `wall_wainscot_blue`) carry the kit's 1.2 m module joint (8 mm, dark `#0D0D0E`, rough) **centred on the repeat's u edges**, so adjacent repeats close it. Vertical joints only, like the kit's wall panels: there is no horizontal joint, so the finish also fits a 1.1 m wainscot and a full-height wall.
- `wall_kick_plate` has brushed streaks along u. `ceiling_spandrel` has 100 mm strips along u.
- Tile finishes carry their grout: granite 600 x 300 mm (u x v), tile 600 x 600 mm.

### Tint finishes

`tint: true` marks a finish whose **texture stays neutral** and whose colour the station sets at runtime, such as the line-colour stripe (`gteki_finish_band_line_accent`; Shinjuku's `line_accent` slot, for example Ōedo `#b6007a`). The base is near-white painted metal (`#F2F2F0`, roughness 0.30, faint orange peel) and its albedo is a shipped map, so the formula is the same in every engine:

```text
rendered base colour = albedo texture (linear) x baseColorFactor        per channel, in linear light
set baseColorFactor = the line colour as linear RGB                     (three.js material.color.set("#b6007a"), Godot albedo_color)
```

The base is about 0.89 in linear light, so the stripe renders about 11 % darker than its hex. Multiply the factor by 1.12 (clamped to 1) to match the hex. The colour is never baked into any texture, so one set of files serves every line. Clone the material per colour; they share the textures.

### Validation

- `tools/blender/validate_finish.py <pack>` (stdlib only; `build.sh validate` runs it) checks, per finish: the manifest and `finish.json` schema; every listed file exists with the sha256 and bytes in `finish.json` and in the manifest; sizes are powers of two, match the JPEG/PNG headers and stay within the pack's `texture_resolution`; factors are neutral where a map ships; directories, manifest and sample GLBs list the same ids; the sample GLB has exactly one material named like the finish and embeds exactly the loose maps; **tiling** and **tint base**. PNG normals require the mobile declaration; an undeclared PNG or a declared PNG shipped as JPEG fails. The stdlib decoder handles 8-bit RGB/RGBA PNG and filters 0–4; generator PNGs use filter 0.
- **Tiling** compares opposite edges of the albedo and normal maps. For each axis it divides the mean absolute difference across the wrap by the mean difference between neighbouring rows at the edges (never less than 8 levels). A seamless texture scores about 1 (0.1 to 1.0 on the pack); more than 2 fails. It catches cropped or unwrapped textures, not subtle mismatches.
- **Tint base:** a tint finish's mean albedo must be at least 225 in every sRGB channel and within 8 levels across channels.
- The sample GLBs go through `validate_glb.py` like any asset. They have no collision, so each gets the same `no collision node` WARN as the signs and tactile strips.
- `texture_budget.py` reports the pack on its own rows (loose map bytes and estimated GPU memory) and caps them with `limits.finishes_mib` and `limits.finishes_gpu_mib` in `budget.json` / `budget_mobile.json` ([texture-budget.md](texture-budget.md)).
- Output is byte-reproducible: `build.sh repro-finishes` (part of `repro`) builds the pack twice from clean caches and compares every file, then compares with the committed pack.

### Sample GLB

`glb/<id>.glb` is one quad of 2 x 2 repeats (4 x 4 for the 0.25 m tint base, so that it is at least 1 m), with exactly the finish's material and metric UVs: `[0, n]`. Floors lie flat at `y = 0` facing up (`placement` `free`, centred on the origin). Every other role stands on the wall plane `z = 0` facing +Z, from `y = 0` up (`placement` `wall`); that includes ceilings, which a swatch cannot show any better. The root has the usual `extras.gteki` (`family` `finish`, `params` with the role, facility and `repeat_m`).

### Station use

- **Ikebukuro:** pick the finish by `gteki_role` (and `facility`) for the matching surface in `scene/materials.ts`, set the UV scale from `repeat_m`, and use the mobile tier (at most 512 px) on the low tier.
- **Shinjuku:** the tint finish is the separate `line_accent` slot. Everything else is a plain glTF metal-rough material, so it needs no lightmap and no baked AO.
- Which finish goes where, and whether the wall is dressed at all, is the station lead's decision.
- **Licence (#131 merged).** The pack is original kit output under CC BY 4.0 (attribution "GTEki contributors"). `REUSE.toml` covers its loose maps and sample GLBs through `assets/library/**`. The strings embedded in `finish.json`, the manifest and the sample GLBs still read `UNDECIDED` (`contract.LICENSE`) until the `EMBED_SPDX` rebuild of the library, which rewrites the pack along with the kit. `REUSE.toml` is the record until then.

## 10. Dressing pieces: `gteki_role` and origins

Dressing pieces (`family: "dressing"`, generators in `families/dressing.py`) go on geometry a station already has: an escalator slab or truss, a stair's treads, a floor plan. They are **visual only** (no `COL_*-colonly` nodes) and carry no structure of their own. Every size is a catalog param, in millimetres, so a station gets a piece that fits its geometry while the kit holds no station measurements.

**Station role.** A dressing piece may carry `gteki_role`, a string. It is the same key the runtime loaders read, so it is **not a passive tag**: a station that loads the GLB directly gets the behaviour below. `packages/scene-api/src/index.ts` (`roleOf`, `sceneFromGlbRoles`, with the `WALKABLE_ROLES` and `COLLIDER_ROLES` sets) and `packages/godot/addons/gteki/gteki_assets.gd` (`_own_role`, `_tag_roles`, with the `WALKABLE` and `COLLIDER` lists) share one vocabulary and one rule set:

| Value | What the runtime does with every mesh under the node | Pieces |
| --- | --- | --- |
| `barriers` | counts as a **collider**: scene-api adds it to `colliders`, Godot sets `gteki_collider` and builds a trimesh `StaticBody3D` from it. Stays drawn (only the role `collider` hides its own geometry) | railings, fare fences, stair handrails and side skirts |
| `transport` | the same as `barriers` (collider, drawn) | escalator parts (balustrade, moving handrail, newels, comb plates, optional skirts and static treads) |
| `stairs_ramps` | counts as a **walkable surface**: scene-api adds it to `walkable`, Godot sets `gteki_walkable`. No collision body is made | only pieces that lie on a walkable surface, such as stair nosing strips |

- Both loaders read `extras.gteki_role` after trimming and lower-casing it; an empty string counts as absent. **Children inherit the nearest ancestor's role**, so one value on the root would cover the whole piece. The kit still writes it on the root and on every `VIS_*` node (`extras.gteki_role`), next to `extras.gteki`, not inside it, so a bake that reads either level sees the same value. The manifest entry has `gteki_role` (not `role`: a station manifest's asset `role` is the separate `visual`, `collision` or `visual+collision` of `packages/schema`, which the loaders also read).
- A GLB has one role. A stair kit that mixes nosing strips with rails or skirts has no single role and omits the key. Catalog entries that a station bakes should keep walkable and non-walkable parts in separate pieces.
- Both profiles carry it: mobile merges the static groups into `VIS_body`, and that node and the root carry the same value. `validate_glb.py` fails a `gteki_role` outside `barriers`, `transport` and `stairs_ramps`, a root and `VIS_*` nodes (`VIS_body` too) that do not all carry the same value, and a tagged GLB with a `VIS_*` node or root left without it.
- What the role does **not** do is change the GLB's geometry or add `COL_*-colonly` nodes (dressing stays visual only) or navigation: the kit still claims no navigation truth. The collider and walkable behaviour is the *station runtime's* reading of the tag when it loads the GLB as is.

**Default and opt-out.** The generators set a default role (escalator parts `transport`, railings and fare fences `barriers`, stair nosing `stairs_ramps`, stair rails and skirts `barriers`, a nosing-and-rails mix none), because Ikebukuro's bake sorts pieces by it. A station that places the same piece as pure decoration and does not want it to collide or become walkable sets `gteki_role` in its catalog entry, which overrides the generator default (`tools/blender/build.py`, next to `dimension_basis` and `notes`):

- `"gteki_role": null` drops the role: no `gteki_role` extras, no manifest key, and the loaders treat the piece as plain visual geometry. Shinjuku's visual-only dressing uses this.
- `"gteki_role": "<role>"` sets another allowed value (`barriers`, `transport` or `stairs_ramps`). Anything else fails the build.
- Leaving the key out keeps the generator default.

**Origins.** The origin is the point a station anchors to, in the §1 frame (the exporter turns the authored +Y into −Z). Anything that reaches in front of the origin (`z > 0` in glTF) is allowed, like an approach apron.

| Generator | Placement | Origin |
| --- | --- | --- |
| `escalator_dressing` | `linear` | floor level, centred in X, on the bottom comb plate line. The escalator rises toward −Z; the comb-to-comb run is `params.comb_run_m`. The newel and handrail turnaround reach about 0.55 m in front of the origin, and the optional skirts `landing_mm` in front |
| `stair_dressing` | `linear` | floor level under the first (bottom) nosing, centred in X. Risers climb toward −Z; the handrail's lower extension starts 0.75 m in front |
| `railing_run` | `free` | the plan origin of `params.points` (`[x_mm, y_mm]`, +y is −Z), floor level. `start` and `end` sockets sit on the first and last point and face outward along the run |

**Anchor class.** These origins differ from the plain §1 `placement` rules (an escalator newel reaches in front of a `linear` entry line; a railing run starts at its first point instead of being centred like other `free` pieces). The catalog entry says so with `"anchor"`, which the build copies to `extras.gteki.anchor` and to the manifest entry (omitted when absent, so other assets stay byte-identical). `placement` keeps its value, so loaders that branch on it see no change. The Godot import test checks the origin by the anchor class when there is one, and by `placement` otherwise:

| `anchor` | Origin | Godot import checks |
| --- | --- | --- |
| `linear_run` | entry line at z=0, the run extends toward −Z; newels, handrail ends and post caps may reach up to 1 m in front, and a piece mounted on its host may start up to one riser above the floor | `extends_negative_z`, `front_reach_within_1m`, `base_between_slab_and_first_riser` (−0.1 m to 0.5 m, or lower with `allow_below_floor`) |
| `surface` | a flat finish sample (§9) lying on its wall plane at z=0, base y=0, instead of projecting into the room like other `wall` pieces | `floor_min_y_near_zero`, `lies_on_wall_plane` (z within ±1 cm) |
| `edge_anchored` | one end or the foot of the piece, which extends from there (a run's first point, a lamp's pole) | `floor_min_y_near_zero`, `origin_on_footprint` (the origin lies within the plan footprint, 6 cm tolerance) |

The kit catalog sets `linear_run` on every `escalator_dressing` and `stair_dressing` entry and `edge_anchored` on every `railing_run` entry; the finish pack sets `surface` on its `wall` samples. Any other value fails the build.

`params.allow_below_floor` is set only where a piece sinks into the station's slab: escalator skirts (60 mm) and static treads (45 mm). Textures use the usual metric UV0; the mobile tier adds the TEXCOORD_1 lightmap layout. A station that bakes with its own second UV set uses UV0 for materials only.
