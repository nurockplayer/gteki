# Mobile profile and gate cost in the station scenes — kit 0.1.0

Updated 2026-10-21 · contract `gteki-asset/0.1` ([§8](asset-contract.md#8-build-profiles-full-and-mobile)) · lane: Issue #11.

**Result:** `PROFILE=mobile` builds the same 48 assets, with the same ids, params, sockets, collision and flap hinges, into `assets/library/mobile/`. Compared with the full library, it downloads **5.86 MiB instead of 21.03 MiB**. It draws **105 instead of 515** calls for one of each asset and needs **51 MiB instead of 1153 MiB** of estimated GPU texture memory. Both tiers pass the same validator, texture-budget, Godot 48/48, Web 48/48 and reproducibility checks.

In the two station scenes, measured on scratch copies of their branches:

- Three naive mobile gate arrays would push Ikebukuro's low tier past its own 28-draw budget.
- With a `THREE.BatchedMesh` per material, one mobile gate array costs **+1 draw call** in total, wherever and however many are placed. The flaps can still animate.

Where gates go, how many aisles they have, and how they look stay with each station lead. The placements below are measurement probes, not layout proposals.

## What the mobile profile changes

| Lever | Full | Mobile |
| --- | --- | --- |
| Draws per asset | one per material per group | Static `VIS_*` groups merge into `VIS_body`. Pivoted groups (gate flaps) stay separate nodes, so they can still be animated |
| Materials | `gteki_*` PBR, 1–3 JPEG maps each | Every colour-only material folds into one kit-wide palette. `gteki_palette` is opaque and `gteki_palette_blend` is glass: a 64×64 PNG with 4×4-texel swatches for albedo + alpha, ORM and emissive (strength 4). Each face's UV is the centre of its swatch, so mip levels never bleed. Content materials keep their own textures, as JPEG: sign faces (`gteki_sign_face_*`), screens and posters |
| Geometry | full bevels and segments | Visual parts use half the segments (cylinders ≥ 8, tubes ≥ 6) and no bevels, and tube paths are Douglas–Peucker simplified (distance to the chord segment, at half the tube radius). **Collision is byte-identical to full**: `build.py` generates each asset a second time at full detail (bmesh only) and keeps that twin's colliders. `bounds_m` covers the tier's own visuals and colliders, within 3.1 mm of full |
| Lightmap UV | — | `UVLightmap` (glTF `TEXCOORD_1`) on every visual mesh, for stations that bake lighting (Ikebukuro does). Smart UV Project can fold a chart over itself (square columns, escalators), so every face whose triangles overlap another's (in Blender's own tessellation, which the exporter writes) is detached into its own chart and the layout is repacked; a face that folds over itself is split into triangles first. The build checks again after the final repack and after UV quantization. `validate_glb.py` fails a mobile visual primitive without UV1, and any UV1 that is not a dense VEC2, is NaN/Inf, leaves the unit square, collapses a triangle of at least 1 mm² to a point or line, or overlaps (triangles, strips and fans alike). Slivers below 1 mm² may collapse when UVs snap to the 1/65536 grid (17 stair-nosing slivers in the current library, each ≤ 0.19 mm²) |
| Texture binding | implicit UV0 | Every texture is bound to UV0 by an explicit UV Map node in Blender, and exports with `texCoord` omitted (glTF's default, 0). Without that node the exporter wrote `texCoord: -1` (invalid) or a nondeterministic `1`. `validate_glb.py` now fails any texture, in a core or an extension slot, whose effective `texCoord` (including a `KHR_texture_transform` override) is not an int ≥ 0 naming an existing `TEXCOORD_n` |
| Manifest | — | Top-level `"profile": "mobile"`; `materials` and `textures` list what was exported (palette plan included). The full manifest is byte-identical to before |

Kept on purpose: sign-face text and posters. Mobile cannot read colour from vertex colours, because Godot 4.7 imports `COLOR_0` but never enables `vertex_color_use_as_albedo`; that is why the profile uses a palette texture instead. Lost on purpose: fine surface detail. Terrazzo, tile grout and brushed metal become flat colours.

## Library, full → mobile

`texture_budget.py`, and the GLB manifests. "Draws" counts one per material per mesh, the same as three.js and Godot without batching.

| | Full | Mobile |
| --- | ---: | ---: |
| Download, 48 GLBs | 21.03 MiB | 5.86 MiB |
| Draws, one of each asset | 515 | 105 |
| Visual triangles | 198,623 | 64,736 |
| GPU est., all 48 GLBs loaded once | 1153 MiB | 51 MiB |
| Unique images | 60 | 19 |
| Whole kit as one bundle (`--all`) | 10.37 MiB | 5.79 MiB |

| Asset | KiB | Draws | Triangles |
| --- | --- | --- | --- |
| `gate_array_6w1` | 532 → 266 | 34 → 13 (12 flaps + body) | 9,562 → 3,214 |
| `escalator_s600_r3500_down` | 1094 → 541 | 21 → 1 | 26,946 → 6,870 |
| `stairs_straight_w2400_r3000` | 1202 → 302 | 16 → 2 | 17,176 → 4,676 |
| `passage_straight_w4_l6` | 933 → 48 | 10 → 1 | 1,216 → 432 |
| `lift_portal_w1000` | 834 → 79 | 18 → 1 | 2,394 → 1,090 |
| `bench_4seat` | 355 → 78 | 5 → 1 | 2,325 → 992 |
| `sign_hanging_navy_left` | 82 → 60 | 5 → 3 | 1,054 → 324 |
| `vending_machine` | 394 → 333 | 37 → 2 | 5,896 → 4,716 |

Sign and screen faces keep their own textures (re-encoded as JPEG q88), so signs and the vending machine shrink least.

Concourse demo (29 items), from `texture_budget.py --layout`:

| Strategy | Full, download / GPU est. | Mobile, download / GPU est. |
| --- | ---: | ---: |
| per_instance | 10.78 / 666 MiB | 3.02 / 50 MiB |
| per_asset | 6.19 / 319 MiB | 2.34 / 37 MiB |
| bundle | 4.28 / 145 MiB | 2.33 / 36 MiB |

The 29 placements hold 55.0k triangles on full and 24.2k on mobile. In three.js (`bench.html`, per_asset), the default view draws **63 calls on mobile against 244 on full**.

## Godot full ↔ mobile

![Godot 4.7, default import; each pair is full (left) and mobile (right): gate array, escalator, stairs, lift portal, vending machine, hanging sign](img/godot_full_vs_mobile.jpg)

Both libraries import with default settings (`run_import_test.sh --screenshot`). Silhouettes, colours, emissive panels, sign faces and posters match. The mobile tier loses tile grout on the lift-portal wall, terrazzo speckle and cabinet bevels; round parts show more facets. The Godot parity test (StaticBody3D and CollisionShape3D per `-colonly` node, sockets, flap nodes per aisle) passes 48/48 on both tiers.

## Gate cost in the real station scenes

**Method.** The scenes were scratch copies (`git archive`) of `feat/ikebukuro-g0-slice` at `7c1ff27` (PR #14) and `claude/shinjuku-e27-l2-stage2` at `00a49da` (PR #16 plus 20 commits), each run on its own Vite dev server. Nothing under `stations/**` in this repository was changed. A probe module (not committed) placed `gteki_gate_array_6w1` at each verified gate in the scene's own coordinates. For each gate it rendered the scene pass once from 8 m in front, at eye height 1.6 m, at 1280×720, with and without the gates, and read `renderer.info`. Post-processing passes (GTAO, bloom) are not included; they add their own passes on the high tier.

- **Ikebukuro:** 3 gate nodes (`g_jr_c2`, `g_jr_c1`, `g_jr_s`), each gate placed 1 m beyond the node along its verified approach edge. The scene has no gates today, so every cost is added.
- **Shinjuku:** 4 distinct gate lines (from 5 gate edges) from `layout.gates`. The kit gates replace the procedural box gates: body, top and IC reader are hidden during the kit measurement. The `gateOk` material is shared with other trim, so it stays visible.

Δ = with kit − without, per view. A view sees one to all of the gates, because frustum culling ignores walls.

| Station, tier | Base calls / triangles per view | Strategy | Full kit: Δ calls / Δ triangles | Mobile kit: Δ calls / Δ triangles |
| --- | --- | --- | --- | --- |
| Ikebukuro low (`?q=mobile`) | 23 / 120k · 24 / 120k · 28 / 121k | naive clone | +34 · +68 · +102 / +9.6k–28.7k | **+13 · +26 · +39** / +3.2k–9.6k |
| | | merged per material (static) | +11 / +28.7k always | +1 / +9.6k always |
| | | **BatchedMesh per material** | +11 / +9.6k–28.7k | **+1** / +3.2k–9.6k |
| Ikebukuro high | 24 / 202k · 25 / 202k · 29 / 203k | same as low | same deltas | same deltas |
| Shinjuku low (`?q=low`) | 86 / 130k · 66 / 120k · 96 / 129k · 55 / 108k | naive clone | +31…+99 / +8.9k–28.0k | +10…+36 / +2.6k–9.0k |
| | | merged | +8 / +37.6k always | −2 / +12.2k always |
| | | **BatchedMesh** | +8 / +8.9k–28.0k | **−2 or −3** / +2.6k–9.0k |
| Shinjuku high | same within ±1 (crowd) | same | same | same |

| Memory added, for all placed gates | Full kit | Mobile kit |
| --- | ---: | ---: |
| GLB download (one file, cloned) | 532 KiB | 266 KiB |
| GPU textures (est.) | 18.7 MiB (5 textures) | 0.06 MiB (palette) |
| GPU geometry: naive / BatchedMesh | 0.33 / 0.33 MiB | 0.24 / 0.24 MiB |
| GPU geometry: merged (3 to 4 gates baked) | 0.98–1.31 MiB | 0.72–0.96 MiB |

What this means for the station leads (offers, not decisions):

1. **Ikebukuro's low tier** documents at most 28 draw calls. The scene uses 23–28 at these views today. Three naive mobile gates add up to 39, and naive full gates up to 102. With a `BatchedMesh` per material, all three gates cost **+1** on mobile, and the flaps can still animate: `setMatrixAt` per flap instance. A merged mesh also costs +1, but the flaps are baked open and it never culls.
2. **Shinjuku** renders procedural box gates in 3–4 draws today. The mobile kit as a BatchedMesh replaces them for **2–3 fewer draw calls**, with real cabinets, IC readers and flaps, and about 3k triangles per gate in view.
3. **Lighting.** Ikebukuro lights its scene with a lightmap and no dynamic lights, so unbaked kit PBR materials render near-black there (checked in the probe frames). Before kit props can be used there, the station needs to bake them, using the mobile tier's `UVLightmap` (TEXCOORD_1), or give them local light. Shinjuku's local fill lights light the kit gates correctly.
4. **Frame time** at 1280×720 on an M2 Pro desktop (scene pass, 20 frames, synced by a 1-pixel readback): every delta was within run-to-run noise, below 1 ms. Phone GPU frame time has not been measured. It belongs with each station's L2 walkthrough on the target device.
5. Godot has no `BatchedMesh`. The palette still means one material per tier in Godot, so a station can merge static kit meshes with `SurfaceTool` and keep the flap nodes. This was not measured in either station.

```js
// three.js: one BatchedMesh per material for every placed kit asset (flaps stay animatable)
const byMat = new Map();
for (const inst of placed) {
  inst.updateMatrixWorld(true);
  inst.traverse((o) => {
    if (!o.isMesh || /colonly/.test(o.name)) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(o);
  });
}
for (const [mat, meshes] of byMat) {
  const geos = [...new Set(meshes.map((m) => m.geometry))];
  const verts = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const idx = geos.reduce((n, g) => n + (g.index?.count ?? g.attributes.position.count), 0);
  const bm = new THREE.BatchedMesh(meshes.length, verts, idx, mat);
  const gid = new Map(geos.map((g) => [g, bm.addGeometry(g)]));
  for (const m of meshes) {
    const id = bm.addInstance(gid.get(m.geometry));
    bm.setMatrixAt(id, m.matrixWorld);
    m.userData.batch = { bm, id };   // animate a flap: rotate its node, updateMatrixWorld(), setMatrixAt(id, …)
    m.visible = false;               // the batch draws it now; keep the node for transforms
  }
  scene.add(bm);
}
```

## Independent review

A fresh read-only Codex review of `f87559e` found one P1, six P2 and one P3. All are fixed in this branch:

| # | Finding | Fix |
| --- | --- | --- |
| P1 | Mobile simplification shrank colliders derived from visual bounds (barrier rails ±0.070 → ±0.0666 m; the review found 3 assets, the follow-up check found the slat bench and, once bevels were skipped, the ticket kiosk) | Mobile builds take their colliders from a full-detail twin of the same asset. All 48 mobile GLBs now carry byte-identical collision positions, indices and transforms |
| P2 | Props and signs bevel in bmesh, so "no bevels" missed them | The bmesh bevel is skipped on low-detail parts too (vending machine 5,896 → 4,716 triangles) |
| P2 | UV1 charts overlapped in square columns and escalators | Overlapping faces get their own charts and the layout is repacked; the validator fails any UV1 overlap |
| P2 | Douglas–Peucker measured distance to the infinite line | Distance to the chord segment |
| P2 | Extension texture slots and `KHR_texture_transform.texCoord` escaped the texCoord rule | Every textureInfo in a material is checked at its effective `texCoord`; self-tests cover both |
| P2 | A relative `OUT` broke `build.sh web` | `OUT` is made absolute |
| P2 | The BatchedMesh recipe left the source meshes drawing | The recipe hides each source mesh |
| P3 | §8 said `texCoord` is explicit; the export omits the default 0 | §8 states the effective binding |

A second fresh read-only Codex review, of `9c3c34a`, confirmed all eight fixes with decoded-GLB evidence. It byte-compared all 299 collision nodes, re-derived every number on this page and found bounds within 0.05 mm of the vertices. It then found four P2 and one P3 gaps, which were not defects in the committed assets but places where the repair and the validator could let a bad lightmap through. All five are fixed:

| # | Finding | Fix |
| --- | --- | --- |
| P2 | The builder fan-split faces and ignored overlaps within one face, so a folded quad passed and a concave face could be flagged wrongly | Detection uses Blender's own loop triangles and counts same-face overlaps; a folded face is split into triangles, then detached |
| P2 | UV1 of triangle strips and fans was never checked | Strips and fans are expanded into triangles before the overlap test |
| P2 | Missing, non-VEC2, sparse, NaN or out-of-square UV1 passed | Mobile visual primitives must have UV1; it must be a dense VEC2 (float or normalized), finite, one per vertex, and inside [0, 1] |
| P2 | A texture-like object under material `extras` was taken as a texture slot | `extras` are skipped at every level |
| P3 | The last repack was never checked | Each repack is checked, and the layout is checked again after quantization |

A third review, of `a5fa9a9`, confirmed these and found one more P2: an out-of-range UV1 was reported but still entered the overlap grid, so a coordinate of 10⁶ could enumerate billions of grid cells. Out-of-range UV1 now stops at the FAIL, and the grid cell is never smaller than the largest triangle. Self-tests cover it, along with normalized UNORM16, VEC3 and count-mismatch UV1.

## Commands

```sh
PROFILE=mobile sh tools/blender/build.sh            # build assets/library/mobile + validate (budget_mobile.json)
PROFILE=mobile sh tools/blender/build.sh godot      # Godot 4.7 import parity, 48/48
PROFILE=mobile sh tools/blender/build.sh web        # three.js GLTFLoader parse, 48/48
PROFILE=mobile sh tools/blender/build.sh repro      # two clean builds identical to each other and to assets/library/mobile
sh tools/blender/godot_import/run_import_test.sh --screenshot assets/library/mobile/glb <out>
python3 tools/blender/bundle_kit.py bundle --library assets/library/mobile --ids <ids> --out kit_mobile.glb
```
