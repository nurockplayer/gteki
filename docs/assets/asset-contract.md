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

Every GLB has exactly one root node named after the asset id, e.g. `gteki_gate_array_4w1`.

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
- Textures embedded as JPEG (base colour, normal, ORM roughness/metal) at **1024 px** for the canonical Web GLB. The generator can re-export at 2048/4096 for a high-quality Godot build from the same parameters (`--tex-res`).
- Textures are tileable, generated procedurally from seeded code. Texel density targets ~1024 px/m for floors and walls.
- Sign faces use material `gteki_sign_face*` with a dedicated 0–1 UV island per face so runtime can apply canvas/text textures. Kit sign art contains only generic arrows/colour bands — **no operator brand marks, typefaces copied from operators, or station names.**

## 5. Budgets (LOD0, observed per asset in the manifest)

No hard FPS numbers are asserted here (see acceptance.md). The manifest records triangles, materials, texture bytes and GLB bytes for every asset so station leads can budget. Godot generates mesh LODs automatically on import; the Web build may use meshopt simplification on derivatives.

## 6. Delivery files

- `assets/library/glb/<id>.glb` — canonical exports.
- `assets/library/manifest.json` — id → file, sha256, bytes, triangles, materials, bounds, params, sockets.
- `assets/library/PROVENANCE.md` — inputs and rights for every asset and texture.
- Regenerate with `tools/blender/build.sh` (see `tools/blender/README.md`).
