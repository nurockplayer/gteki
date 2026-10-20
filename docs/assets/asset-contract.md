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
| Transforms | All mesh transforms are applied; no negative scales; child nodes have identity scale. |
| Grid | Default dimensions snap to **0.05 m**; module lengths default to multiples of 0.30 m (tactile-block pitch) but this is a convenience, not a requirement. |
| Below floor | Geometry under `y = 0` (structural slabs, escalator pits) is allowed only when `params.allow_below_floor` is set; validators and the Godot import test honour it. |
| Approach aprons | Anything the asset puts on the floor in front of its entry (e.g. a gate approach plate) starts at `z = 0`; the functional part's own span is recorded in params (e.g. `cabinet_span_z_m`). |

## 2. Node naming and roles

Every GLB has exactly one root node named after the asset id, e.g. `gteki_gate_array_4w1`. Ids are also file names, so they must be a single safe component: `[A-Za-z0-9_][A-Za-z0-9_-]*` (the build rejects anything else).

| Prefix / suffix | Role | Web | Godot |
| --- | --- | --- | --- |
| `VIS_*` | Render mesh | render | `MeshInstance3D` |
| `*-colonly` (e.g. `COL_floor-colonly`) | Collision only (boxes / ramps / simple hulls) | hide; feed to physics | auto `StaticBody3D` + shape (import hint) |
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
  "license": "UNDECIDED — original GTEki work; repository licence pending Owner decision"
}
```

`SOCKET_*` extras: `{ "socket": "start" | "end" | "left" | "right" | ..., "width": m, "height": m }`. Two modules join when sockets coincide with opposite facing (socket local −Z points out of the module).

`dimension_basis` values: `generic-typical` (widely published typical/standard values, recorded in the catalog), `synthetic` (chosen for look only), `station-verified` (only when a station lead supplies sourced measurements — never set by the kit itself).

## 4. Materials and textures

- glTF 2.0 core PBR metallic-roughness. Allowed extensions: `KHR_materials_emissive_strength` (signs, light diffusers, gate indicators), `KHR_texture_transform` *not* used. No Draco/meshopt in the canonical GLB (derivatives may be optimized by the Web build).
- Material names are stable and prefixed `gteki_` (e.g. `gteki_floor_terrazzo`). Runtime may **swap materials by name** to apply station-specific palettes or deduplicate textures across GLBs.
- Determinism: the same catalog, code and `--tex-res` produce byte-identical GLBs (`tools/blender/build.sh repro`).
- Textures embedded as JPEG (base colour, normal, ORM roughness/metal), **at most 1024 px** in the canonical Web GLB. The generator can re-export at 2048/4096 for a high-quality Godot build from the same parameters (`--tex-res`).
- Textures are tileable, generated procedurally from seeded code. **Texture budget** ([texture-budget.md](texture-budget.md)): `--tex-res` is both the cap and the target density in texels per metre, so a material that repeats every 0.25 m ships a 256 px texture rather than 1024. A map that is flat (per-channel std below 1 level for albedo, 2 for roughness/metal, 1.5 for normal) is exported as the material's factor instead of a texture. So a `gteki_*` material may have any subset of the three maps; `manifest.json` lists each textured material's `res` and kept `maps` under `textures`.
- Sign faces use material `gteki_sign_face*` with a dedicated 0–1 UV island per face so runtime can apply canvas/text textures. Kit sign art contains only generic arrows/colour bands — **no operator brand marks, typefaces copied from operators, or station names.**

## 5. Budgets (LOD0, observed per asset in the manifest)

No hard FPS numbers are asserted here (see acceptance.md). The manifest records triangles, materials, texture plans and GLB bytes for every asset so station leads can budget. Godot generates mesh LODs automatically on import; the Web build may use meshopt simplification on derivatives.

`tools/blender/catalog/budget.json` caps the committed library (download, unique image bytes, estimated GPU texture memory). `tools/blender/build.sh validate` fails when the cap is exceeded, when an image is larger than its material's plan, when a material samples more images than its plan keeps, or when one GLB embeds the same image twice.

## 6. Delivery files

- `assets/library/glb/<id>.glb` — canonical exports.
- `assets/library/manifest.json` — id → file, sha256, bytes, triangles, materials, bounds, params, sockets.
- `assets/library/PROVENANCE.md` — inputs and rights for every asset and texture.
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
- Output is deterministic. `bundle` refuses a library whose GLBs no longer match `manifest.json`, and `extract` rebuilds a standalone GLB that validates exactly like the source.
- **Use it by cloning.** Load the bundle once, then clone an asset root per placement: three.js `Object3D.clone()`, Godot `Node.duplicate()`. Clones share geometry, materials and textures, so they add draw calls but no GPU memory.
- **Repeated names.** Both importers make node names unique across the *whole file*. A second asset's `SOCKET_end` or `VIS_flap_0_L` loads as `SOCKET_end_1` / `VIS_flap_0_L_1` in three.js `GLTFLoader`, and as `SOCKET_end2` / `VIS_flap_0_L2` in Godot 4.7. So the bundle writes the original name to `extras.gteki_name` on every node whose name occurs more than once in the bundle; `extract` removes it again. To get a node's contract name in a bundle, read `extras.gteki_name` and fall back to the node name: `object.userData.gteki_name ?? object.name` in three.js, `node.get_meta("extras", {}).get("gteki_name", node.name)` in Godot. Look nodes up inside their asset root, never by name across the whole bundle. Godot also strips the `-colonly` suffix when it turns those nodes into `StaticBody3D`, exactly as it does for a single GLB.

## 8. Build profiles: `full` and `mobile`

`--profile` (`PROFILE=` in `build.sh`) selects how the same catalog is exported. Both profiles produce the same asset ids, params, sockets, `COL_*-colonly` collision, `LIGHTHINT_*` empties and flap hinge nodes, so a scene can switch tier by switching library directory. Root `extras.gteki` differs only in `profile`, `triangles` and `bounds_m`, which describes each tier's own visuals and colliders (mobile is within a few millimetres of full). Measurements and station guidance are in [mobile-profile.md](mobile-profile.md).

- **`full`** (default) is everything in §1–§7: `assets/library/`.
- **`mobile`** writes to `assets/library/mobile/` by default. The manifest has a top-level `"profile": "mobile"`; a manifest without it is `full`. Root extras carry `profile: "mobile"`.
  - Visual nodes: static `VIS_*` groups are merged into one `VIS_body`. Groups that have a pivot (gate flaps `VIS_flap_<aisle>_<L|R>`) stay separate nodes with the same names, origins and `flap_close_yaw_deg`.
  - Materials: every material without an image of its own is folded into the kit palette, `gteki_palette` (opaque) or `gteki_palette_blend` (alpha-blended glass). That is a 64×64 PNG with 4×4-texel swatches for albedo + alpha, ORM and emissive (`KHR_materials_emissive_strength` 4), sampled at the swatch centre with nearest filtering. The palette is identical in every mobile GLB, so a bundle stores it once. Materials with content images (sign faces, screens, posters) keep their `gteki_*` names and embed JPEG maps. `manifest.json` `materials` lists the exported names, and `textures` includes the palette plan.
  - UVs: every texture samples `TEXCOORD_0` (`texCoord` omitted, glTF's default). `TEXCOORD_1` (`UVLightmap`) is a lightmap layout on every visual mesh, one UV space per mesh shared by its primitives, inside the unit square with no overlapping triangles. `validate_glb.py` fails a missing, malformed, non-finite, out-of-range, collapsed (UV area ~0 over ≥ 1 mm² of geometry) or overlapping UV1 (strips and fans are expanded).
  - Geometry: visual parts use about half the segments and no bevels. Collision is byte-identical to `full`: the build generates a full-detail twin of each asset and keeps its colliders.
- Byte limits are per profile: `tools/blender/catalog/budget.json` for `full`, `budget_mobile.json` for `mobile`, each with `applies_to.profile`. The per-image rules, the texCoord check (core and extension slots, `KHR_texture_transform` overrides; `extras` are not texture slots) and the lightmap checks apply to every library; only `mobile` requires UV1.

