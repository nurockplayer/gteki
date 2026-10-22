# Ikebukuro G0 — source audit (2026-10-20)

Lane: Ikebukuro (Opus 5.5 Session A). Status: **G0 PASS for the PLATEAU B1 passage geometry as a rendering and geometry-evidence source. G0 GAP for access/hours/gates** (not in any open dataset; desk facts from official references only, see below).

All files were fetched by script into the git-ignored `data-cache/ikebukuro/` and are **not** committed. Reproduce with `stations/ikebukuro/pipeline/fetch_sources.sh`, which re-checks the hashes below.

## Acquired files

Retrieved 2026-10-20T10:44:13Z.

| File | Source URL (exact) | Bytes | sha256 |
| --- | --- | --- | --- |
| `53394576_ubld_6697_op.gml` | `https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml` | 35,427,963 | `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09` |
| `metadata.zip` | `…/assets/23/b8d8c3-dbe0-4bf1-b74a-3c18b6a087c1/13116_toshima-ku_pref_2025_citygml_1_op_metadata.zip` | 21,755 | `9c75c7135d5b1693db5474c0756eeb5632496d9d1fbcfd8ca7882c4cbea7d624` |
| `codelists.zip` | `…/assets/82/77b46c-5983-448a-9d89-c0663ddc0652/13116_toshima-ku_pref_2025_citygml_1_op_codelists.zip` | 805,989 | `183a3f554d816837f92c865124fa3cd2605e1c8f6ca7c58318b0241e718c5600` |
| `plateau_ubld_index.json` | `https://api.plateauview.mlit.go.jp/datacatalog/citygml/13116,13104?types=ubld` | 2,540 | `7e5abc03…` (API snapshot, will change) |
| `hokonavi_link.csv` / `hokonavi_node.csv` | MLIT ほこナビDP 池袋 (R1 in dossier) | 370,498 / 279,843 | `a0f83765…` / `2477e6f2…` |
| `toshima_related.zip` | PLATEAU 豊島区 2025 related | 28,543 | `df356f6e…` |

The PLATEAU API still lists the same single `ubld` file for 豊島区 (`features: 2`, `maxLod: 4`), so the dossier's resource identification holds.

## What the GML actually contains

- One `uro:UndergroundBuilding` (`13116-ubld-1`, `creationDate 2024-03-15`, `lodType 4.1`) plus one `CityObjectGroup` named **`池袋駅_B1地下通路`**.
- Three LOD4 `Room`s. `room1` is the passage network (FloorSurface 3,335 / InteriorWall 12,348 / Ceiling 6,971 / Closure 669 polygons; 81 `Door`, 236 `Window` openings). `room2`/`room3` are two small stair rooms near the north-west.
- `IntBuildingInstallation` functions from the shipped codelists: `EF_25` walls & barriers (10,948 polygons), `EF_35` **stairs & ramps** (128), `EF_80` **transport** (1,044; escalator/lift candidates), `EF_30` floor elements (80).
- CRS `EPSG:6697` (JGD2011 lat, lon + orthometric height). Envelope lat 35.728049–35.731372, lon 139.709387–139.713366, height 25.50–33.17 m.
- Metadata resource table: `uro:UndergroundBuilding / bldg:lod4MultiSurface` ← **東京都 2023 LidarSLAM計測, 地図情報レベル 500**. This is a source-scale class, not a measured RMS error.
- Walkable floor area ≈ **22,850 m²**. Main walking levels cluster at 27.6 m and 27.9 m TP, with ramps/stairs to 25.9–26.2 m (east, ISP side) and to ~28.4–29.1 m.

### Semantics that are absent (must not be inferred)

No names on rooms or passages, no ticket gates, no paid/unpaid boundary, no operating hours, no operator boundaries, no shop identities, no accessibility attributes, no exit numbers. `Door`/`Window`/`Closure` are openings and virtual boundaries only.

### Coverage observed (desk analysis, not field-verified)

- Modeled: the free B1 passage network around the station — Central Passage (中央通路), North Passage area, South Passage, the passages alongside the JR concourse on the west and east sides, the Tobu Hope Center and West Exit network, the Cherry Road/ISP side and the long south-east corridor to the Metro exits 39–43.
- **Not modeled:** fare-paid concourses of JR East, Tobu, Seibu and Tokyo Metro, and their platforms; Echika (Fukutoshin side, C exits); shops' interiors; street level. These appear as `ClosureSurface` boundaries or simply as gaps.
- Stair tops: of 218 clustered closure-surface groups, the horizontal ones at 31–33 m sit at the tops of stairs and match exits listed in the Toshima underground guide (the official cross-operator map) and OSM within 1–7 m (e.g. 26, 28, 32, 33, 34, 35, 39, 40, 41, 42, 43, 9, 10, 11, 15, 17). These are geometry-evidenced exit candidates; the exit **numbers** come from official facts.

## Rights

- PLATEAU 3D city model: licence is the catalogue's **PLATEAU Site Policy 「３．著作権について」**; a "CC BY 4.0" clause in the metadata is unconfirmed and is not shown in the app (#161). GTEki may redistribute derived geometry (GLB) with attribution and modification notice: *"出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成"*, with the modification detail (reprojected to a local ENU frame, triangulated and re-encoded as glTF by GTEki) kept in the source `notes`.
- MLIT ほこナビ R1: PDL 1.0, 2019 data, all nodes `in_out=1` (outside), no elevation. **Not used for the indoor graph.**
- Toshima 2022 underground guide and Tokyo Metro Ikebukuro yard map: **REFERENCE_ONLY**, `usage: facts-only`. Read only to establish facts (which openings are which gate or exit, which passages are public). No image, tracing, layout, pictogram or logo is copied into the repository or the build. The Toshima PDF is kept in the git-ignored `data-cache/ikebukuro/reference_only/` folder. The Tokyo Metro map images returned *Access Denied*, so its facts were read from the official page.
- JR East station maps: **not used.** The research dossier listed them (I-01), but the official map images returned HTTP 403 and were never obtained, read or cached, and JR East's site terms forbid reuse. No fact in `data/graph.src.json` cites JR East. The JR gate names and positions (JR 中央1改札, JR 中央2改札, JR 南改札) come from the Toshima guide (`af-jr-central-gates`, `af-jr-south-gate`). Traced 2026-10-21 across the cache, the pipeline, the graph source and the session record; `jreast` appears only as an operator id for gate POIs.
- OpenStreetMap (ODbL): used only as a **cross-check** of exit positions. No OSM coordinates or tags are copied into GTEki data, so no derived database is created.

## Owner decision (2026-10-21): facts vs. works, public release

- **Facts and works are separated.** Exit numbers, gate names and access facts (which passage is public, which opening is which exit or gate) that can be checked independently may be used and published. The protected works themselves (map images, drawings, layout, pictograms, logos, typefaces, tracings) are not reproduced. This is how the two REFERENCE_ONLY sources above are used.
- **JR East:** traced as above. It was not used, so no source entry is added.
- **Public release:** cleared ("ship directly"). Field verification stays a stated gap. The UI says the data is desk-verified, not field-verified, and that hours are unknown.

## Verification standard used by this lane

An Ikebukuro edge is `verified` only when **both**:

1. **Geometry evidence:** every 0.5 m sample along the edge lies on a PLATEAU FloorSurface or EF_35 stair/ramp footprint, and no unexplained height jump occurs. This is checked by `pipeline/build_station.py` and fails the build otherwise.
2. **Access evidence:** an official operator or municipal source states that the passage, exit or gate is public, and identifies it.

Hours stay `null` (unknown) unless an official source states them. This is **desk verification against a 2023 survey and 2026 official references, not a field survey**, and the UI must say so.

## G0 verdict

| Item | Status |
| --- | --- |
| Exact resource, version, hash, retrieval time | PASS |
| License and redistribution of derived geometry | PASS (PLATEAU Site Policy with attribution, #161) |
| CRS, axis order and vertical datum | PASS (EPSG:6697 lat/lon/H; ENU frame documented in extractor) |
| Geometry coverage enumerated | PASS (B1 free passages; paid areas absent) |
| Topology / access / hours in open data | **GAP**: hand-authored graph with per-edge evidence, hours unknown |
| Field verification | **HOLD**: none performed; survey brief in `coverage-gaps.md` (not a release blocker per the Owner, 2026-10-21) |
| Facts from REFERENCE_ONLY sources in a public, commercial product | PASS (Owner decision 2026-10-21: facts/works separation) |
| JR East sources | PASS (traced: not used) |
