# Ikebukuro station kit catalog: provenance and licence basis

Closes row 1 of the [G0 audit](G0-audit-2026-11-08.md) GAP list (#1044). Written 2026-11-08 20:15 JST at main `4584dca0`, from the repository history and code only; nothing was rebuilt.

Covers `stations/ikebukuro/gteki/kit/catalog/{high,low}/*.glb` (153 GLBs) and `kit/catalog/{high,low}/atlas/*.png` (4 AO atlases), the files of source `gteki-ikb-catalog-0-1-0` in `gteki/station.json`.

## Who made them, and how

| Step | What | Where | History |
|---|---|---|---|
| 1. Survey anchors | Stair nosing lines and escalator lanes read from the PLATEAU `ubld` survey triangles (positions only, rounded to 1 mm) | `stations/ikebukuro/pipeline/build_dressing_anchors.py` writes `scene/dressing_anchors.json` | #94 era, regenerated against the #193 extract in #204 (2026-10-22) |
| 2. Catalog | One catalog entry per stair flight (nosing strip, handrails) and escalator lane, in the `CATALOG=` format of `tools/blender/catalog` | `stations/ikebukuro/pipeline/build_kit_catalog.py` writes `scene/kit_catalog.json` and `scene/kit_placements.json` (stdlib only, deterministic) | Added by commit `3a512c06`, PR #155 (2026-10-22); whole-mm risers in `3909908d`; 0.1 mm retry in `1d4d0413` |
| 3. Geometry and textures | Blender builds the GLBs from that catalog with the kit generators `escalator_dressing` and `stair_dressing` (`tools/blender/gteki_assets/families/dressing.py`, PR #143, added 2026-10-22 by `e39b6569`). Textures are the kit's seeded procedural syntheses (`texsynth.py`) embedded as JPEG; the AO atlases are baked from the same meshes (`tools/blender/ao_atlas.py`) | Lane E build tree kept outside the repo, built with `tools/blender/build.sh` / `build.py` | Batches A (escalators) #703/#965, B (stair handrails), C (61 nosing strips, packed AO atlas) |
| 4. Copy into the station | Byte-for-byte copy, checked against the sha256 and size each tier's `manifest.json` records | `stations/ikebukuro/pipeline/sync_kit_catalog.py` (`--check` in CI against the pins in `station.json`) | commits `24864d53`, `e74164c5`, `7de2bec0`, `117cdc3b`, `6ce673bd`, PR #965 |

Author of the code and the build: GTEki contributors (the repository's own commits above). The embedded GLB header reads `copyright: "GTEki contributors. CC-BY-4.0"`, generator `Khronos glTF Blender I/O`.

## Inputs

| Input | Third-party? | Evidence |
|---|---|---|
| `tools/blender/gteki_assets/**` code and `tools/blender/catalog/*.json` parameters | No, repository code (Apache-2.0 for the code, CC BY 4.0 for what it generates) | [assets/library/PROVENANCE.md](../../../assets/library/PROVENANCE.md): geometry and procedural textures "produced entirely by the code in this repository from catalog parameters; no external file is read" |
| Textures in the GLBs | No. Seeded numpy synthesis; no photographs, no texture packs. The only code path that loads an external image (`materials.external_image`) is taken by materials whose spec carries an `image` key (poster light boxes), and `families/dressing.py` has no image or poster reference | `grep` of `families/dressing.py` (0 hits), PROVENANCE.md "Not used anywhere" |
| Dimensions (flight step counts, rise, tread, escalator width and angle, positions) | Derived numbers only, from PLATEAU `ubld` (MLIT): no PLATEAU mesh, texture or attribute is copied into the GLBs. This is why the source's attribution carries the PLATEAU line 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」 and the "dimensions derive from PLATEAU data, modified" sentence | `scene/dressing_anchors.json` `source` block (PLATEAU Site Policy §3, GML and extract sha256 pinned); PR #155 body ("every station-verified entry cites the sha256 of the anchors file and the PLATEAU GML") |
| Operator drawings, operator photographs, other downloaded models | None found | Same PROVENANCE.md section; the catalog build reads `scene/kit_catalog.json` and the generators only |

## Licence basis

- The GLBs, the atlas PNGs and their manifests are original GTEki generator output. Licence CC BY 4.0, attribution "GTEki contributors", decided by the Owner for the whole Lane E kit in #123 (2026-10-22, recorded in PROVENANCE.md "Licence") and mapped in `REUSE.toml` (`stations/*/gteki/kit/**`).
- The PLATEAU-derived dimensions are not relicensed. They stay under the PLATEAU Site Policy 「３．著作権について」, as `station.json` already states for this source, and the credit above is shown with it.
- The pinned sha256 values in `station.json` (`gteki-ikb-catalog-0-1-0`) and the `sync_kit_catalog.py --check` run in CI tie the shipped bytes to the builds above.

## Limits of this record

- The Lane E build tree itself is not in the repository, so this document rests on the code, the commit history and the pinned hashes, not on a rebuild at the audit date. A rebuild would reproduce the manifest hashes only on the same Blender version.
- The GLB header says CC-BY-4.0 while PLATEAU-derived numbers keep the PLATEAU line; a lint that fails when the embedded licence differs from `station.json` was suggested in the audit and is not added here.
