# Lane D — GIS data factory handoff

Updated: 2026-10-21 · Issue: [#10](https://github.com/nurockplayer/gteki/issues/10) · Lead: Opus 5.5 (architecture, integration, review, delivery) · Implementation and tests: Codex GPT-6.1 Sol (xhigh, fast tier) · Independent review: separate read-only Codex GPT-6 Astra (high) sessions.

**Status:** this is a reproducible, tested ingestion and inspection run on real public sources. **Nothing here is accepted station topology, a verified route, current-world geometry or a publication approval.** Every normalized record is `UNVERIFIED`, every GLB is `NOT_FOR_ROUTING` and every candidate graph has `routable: false`.

## What exists

`tools/gis/` is a standalone pnpm package (its own `pnpm-workspace.yaml` and lockfile, outside any future root workspace). It has these commands:

| Command | Purpose |
| --- | --- |
| `acquire <id…> \| --all [--offline]` | Resolves PLATEAU URLs from the **live** data-catalog API and saves the API response with its hash. Streams downloads into a content-addressed store outside Git and records URL, headers, bytes, SHA-256 and timestamps in `docs/gis/acquisitions/`. `--offline` re-verifies the hashes. |
| `inspect-citygml` | Streaming (bounded-memory, no DTD/entity resolution) inventory of PLATEAU CityGML: CRS/axis order, envelope, semantic tree, xlink polygon references with `OrientableSurface` sign, and codelist labels resolved from the actual codelist ZIP. Also produces `PRESENT / ABSENT_IN_FILE / UNKNOWN` semantic-presence answers. |
| `crs-roundtrip` | EPSG:6697 (lat, lon, TP height) → JGD2011 / Plane Rectangular CS IX (EPSG:6677) → station-local ENU → glTF (x=E, y=U, z=−N), plus the inverse transforms. |
| `citygml-to-glb` | Bounded or full conversion to GLB. Node name = `gml:id` and extras carry the source/frame/codelist provenance. Writes a provenance sidecar and checks the result by reading it back (node count, triangle count, bbox ≤ 1 mm). |
| `station-frame` | Creates a `station-enu` frame from `stations/<id>/gteki/station.json` (see Street-level context, #39). Refuses an undecided vertical anchor. |
| `context-glb` | Visual-only street-level context GLB (PLATEAU bldg/tran) in the station frame (see Street-level context, #39). |
| `inspect-network` | MLIT 歩行空間ネットワーク CSV/GeoJSON inspection: literal fields, encodings, category distributions, duplicate/dangling/self-loop/component checks and endpoint-geometry checks. Exports a candidate graph that keeps raw attributes verbatim and adds **no edges**. |
| `overlap` | Bbox-only spatial relation between acquired layers, with projected separation. Explicitly not evidence of feature alignment or connectivity. |
| `gap-packet` | Per-station UNKNOWN/HOLD packets computed from the reports. |
| `scripts/blender_import_check.py` | Headless Blender glTF import. Compares the imported bbox with the recorded one and renders review images. |

Reproduce the full run with `pnpm --dir tools/gis install --frozen-lockfile`, then `pnpm --dir tools/gis gis acquire --all` and `pnpm --dir tools/gis exec tsx src/real-run.ts`. Details are in [tools/gis/README.md](../../tools/gis/README.md). Raw bytes, full feature-detail tables, GLBs and candidate graphs stay in `$GTEKI_GIS_STORE` (default `~/.gteki/gis-store`, mode 700). Only small, auditable records are committed.

## Verified checks (this candidate)

- Current candidate (rights research, on top of main `4d5c412`): `typecheck` 0 · `test` **291/291** · `test:real` **10/10** · `acquire --all` **45/45** online · real run **23/23** CLI invocations exit 0 · digest `7d7acad25836772cc8de5bf0531fccb1ae3ed04c10b6013c1c5491164ad049a2` (run, validation and summary agree). The 4 GLB outputs are byte-identical to the merged main. The Opus lead re-ran these independently.
- At PR #18 merge time: `typecheck` 0 · `test` **82/82** · `test:real` **3/3** · `acquire --all --offline` **13/13** hashes · real run **16/16**.
- CRS: two independent controls from the official GSI 測量計算サイト `bl2xy` (JGD2011, zone IX, retrieved 2026-10-20) match within **0.05 mm**. Envelope-corner roundtrips are below 1e-6 m.
- GLB readback: bbox error ≤ **0.006 mm**. Independent Blender 5.2.2 import of both full-file GLBs reproduces the recorded local bbox to within float32 precision (see [evidence/](evidence/)).

## Station results

### Ikebukuro — PLATEAU `13116` ubld mesh `53394576` (CC BY 4.0, 2023 東京都 LidarSLAM source)

- SHA-256 `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`, 35,427,963 bytes. 1 `uro:UndergroundBuilding`, **1 group literally named 「池袋駅_B1地下通路」**, 3 Rooms, 3 Door objects, 7 installations (EF_25 壁・バリア, EF_35 階段・スロープ category, EF_80 輸送機能, EF_30 屋根・床・舗装; labels come from the acquired codelist).
- Footprint about **360 m × 369 m**, vertical extent **7.7 m** (TP 25.50–33.17 m). The literal group name and the narrow height range are consistent with a **single B1 passage level only**. No Metro B2/B4 levels, platforms, gates or paid boundaries are present as explicit elements. Do not assume that further levels exist elsewhere in this file.
- 98,173 polygon uses = 58,761 definitions + 39,412 xlink reuses (23,954 reversed). The full GLB has 58,761 polygons and 64,811 triangles.
- R1 walking network (PDL 1.0, content 2019-01-28): 1,887 nodes / 2,196 links, one weak component, 0 anomalies. Every node has `in_out=1`, elevation is blank everywhere and **no CRS is declared**. As a result, its spatial relation to the PLATEAU geometry is **UNKNOWN** (no metric comparison is made from an assumed CRS). `rt_struct` (8 codes) and `lev_diff` (4 codes) distributions are reported but deliberately **not** decoded.
- Packet: [gaps/ikebukuro.md](gaps/ikebukuro.md).

### Shinjuku — PLATEAU `13104` ubld mesh `53394536` (CC BY 4.0) + Toei Oedo E27 (PDL 1.0, published until 2027-03-12)

- SHA-256 `013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977`, 43,830,765 bytes. 1 `uro:UndergroundBuilding` named 「新宿駅周辺エリア」, 153 Rooms, 1,364 Doors, 1,911 FloorSurfaces, 1 installation. **No explicit floor labels** are present.
- Footprint about **506 m × 479 m**, vertical extent **30.2 m** (TP 15.32–45.49 m). The full GLB has 65,013 polygons, 148,950 triangles and 30,358 nodes. The per-object node granularity makes the Blender import slow (measured in [evidence/](evidence/)), so runtime assets should be merged per Room or surface class by the asset lane.
- E27 network: 233 nodes / 263 links, one weak component, 0 anomalies, all 263 endpoints checked. Literal `floor` values: −6 … 1. Station map: 18 layers, 465 features, literal labels 1階 / 地下1・2・3・5・6階.
- **Key finding: the only PLATEAU underground file for 新宿区 is spatially DISJOINT from every acquired E27 layer, about 184–237 m apart (bbox-based).** The E27 data therefore cannot be paired with the PLATEAU ubld geometry. Any E27 3D scene needs another geometry source or a field survey. This pairing is on **HOLD**.
- Packet: [gaps/shinjuku.md](gaps/shinjuku.md).

## Rights / publication gate

| Output | Gate |
| --- | --- |
| PLATEAU-derived GLB/renders | CC BY 4.0 permits commercial use, modification and redistribution with attribution plus a modification notice (text in the manifest). **Not yet published.** The station lead decides on inclusion after verifying geometry, and the Owner approves release. |
| Hokonavi-derived candidate graphs | PDL 1.0 with attribution and a processing notice, and no implication of government authorship. Stay internal because they are `UNVERIFIED`. |
| PLATEAU codelists/schemas | Rights recorded as `unknown`. Labels are used internally for inspection only. |
| S10 都営 駅構内のお店 CSV (新宿, 新宿西口) | CLEARED_WITH_CONDITIONS at dataset level (CC BY 4.0): factual fields only, plain store names, URLs as pointers. Logos, photos, linked pages and trademarks are **not** cleared. No coordinates. |
| S03 東京都 新宿駅周辺の施設情報 ZIP / 参考資料 PDF | Whole resource **UNKNOWN**. Geometry + factual fields (ZIP) and technical text (PDF) are CLEARED_WITH_CONDITIONS (CC BY 4.0). Promotional `description` prose, linked content and the PDF illustration stay UNKNOWN. 仕様書 PDF: CLEARED_WITH_CONDITIONS. |
| PLATEAU `related` layers (13104, 13116) | shelter (KSJ P20), park (P13), emergency_route (N10): **RESTRICTED** (KSJ non-commercial). station + railway (N02-2024), border (N03-2025, keep the 測量法 approval notice): CLEARED_WITH_CONDITIONS. landmark (GSI 数値地図 origin): UNKNOWN. Whole ZIPs: UNKNOWN (split required). |
| CKAN `package_show` snapshots, PLATEAU catalog API response | UNKNOWN (no self-licence); kept as evidence only. |
| Operator maps (JR, Metro, Tobu, Seibu, Keio, Odakyu, Toei pages …) | Not acquired. Reference-only per the dossier. |

Every rights verdict is about reuse terms only. It never makes data routable or verified, and every publish gate stays HOLD until the Owner approves. Generated table: [rights/README.md](rights/README.md).

## Handoff to station leads (A/B), shared core (C) and assets (E)

1. **Ikebukuro (A):** the PLATEAU B1 passage is the only open 3D geometry acquired. Use it as a geometry candidate for a B1 slice after verifying it against permitted references or a field survey. It has no route graph, no gates and no other levels. R1 is an outdoor/peripheral network, not an indoor graph. Neither R1 file declares a CRS; JGD2011 lon/lat is only inferred from the MLIT spec (see Gap research). Under that inference, the 176 R1 nodes inside the B1 passage bbox are all floor 0 or 0.5 and no `rt_struct=5` (地下通路) link crosses it, so R1 does not appear to model this B1 passage.
2. **Shinjuku (B):** E27 is the only open indoor graph, and it does not overlap the PLATEAU ubld file. No 2025 PLATEAU ubld file is catalogued for E27's mesh `53394525`. One E27 underground-passage link (`b80b3f4aef474ac2aa25c6680b26177a`) contradicts itself: `rank` SBS (slope 5–8 %) but `vtcl_slope=1` (0 %), both field-surveyed. Treat its slope as UNKNOWN. Choose between (a) an E27-first slice whose geometry is derived from the E27 station-map polygons (PDL 1.0) with **no invented heights** (only literal floor values) and (b) a PLATEAU-area slice with no open graph. Both are HOLD for verified routing. **New candidate (rights research):** S03 (東京都都市整備局, March 2020 base data, published 2023-02-28) holds per-level drawing geometry for literal levels B5F…4F, M1F and MB2F around Shinjuku station (lon 139.6965–139.7037, lat 35.6865–35.6953). It also holds a `v5_nav.json` with 2,506 source nodes and 2,653 n1/n2 source links. Its geometry and factual fields are CC BY 4.0. Its CRS is undeclared: the spec says absent means WGS84, but the tool keeps it UNKNOWN. Its nav links are unvalidated source references; 0 edges are exported, `routable: false`. Level labels are not elevations.
3. **Shared core (C):** the frames `ikebukuro-plateau-ubld-v0` / `shinjuku-plateau-ubld-v0` are arbitrary processing origins, not station reference points. They are a proposal for the #2 coordinate contract and are not imposed. Field names follow the source-register schema.
4. **Assets (E):** GLB nodes carry `gml_id` extras for traceability. Merging for runtime should keep a sidecar mapping back to the IDs.

## Known gaps / next steps

- Done in the gap research (below): MLIT code tables decoded per spec version; R1 GeoJSON acquired (it has no CRS either); E27↔PLATEAU coverage checked against the catalog.
- Still open: which spec version R1 actually follows; R1's verified datum; earlier PLATEAU vintages; operator-floor equivalence and floor-to-height mapping; paid/unpaid boundaries.
- Done in the rights research (below): S10, S03 and both PLATEAU `related` ZIPs acquired, inventoried and given evidence-based verdicts.
- Still open (rights): the downstream approval scope and wording for the GSI-origin landmark layers; a self-licence for the CKAN metadata snapshots; permission for any logos, photos or brand artwork.
- Open question (rights, PLATEAU 2025 resource scope): the `plateau-13104-ubld-*`, `-metadata`, `-codelists` and `-schemas` files (and the 13116 equivalents) were resolved through the catalog API, and their URLs have **no exact match** among the resources in the acquired CKAN snapshots `plateau-13104-related-catalog` / `plateau-13116-related-catalog` (the package's resources are an index PDF, a whole-ward `*_2025_citygml_1_op.zip`, a 3D-tiles ZIP, the `related` ZIP and one entry whose URL is not a URL; whether the catalog files belong to that whole-ward ZIP was not tested). The package declares `license_id: plateau` (PLATEAU Site Policy §3, PDL 1.0), so resource-level coverage of those files is unproven. Main's headings and `sources.yaml` label the ubld "CC BY 4.0" on the strength of the research dossier (`#G3`); the only acquired text for that label is the metadata XML clause "Licensed under CC BY 4.0" (`{http://zgate.gsi.go.jp/ch/jmp/}MD_Metadata/identificationInfo/MD_DataIdentification/resourceConstraints/MD_Constraints/useLimitation` in `udx_13104_pref_2025_op.xml`, title 東京都3Dデジタルマップ). It is a file-embedded declaration for the dataset it describes, and it does not name `ubld`. Treat the CC BY 4.0 label as needing confirmation. No rights record in `docs/gis/rights/` covers these files, and the verdicts in this handoff are unchanged.
- Open question (rights, Hokonavi E27 scope): the `station_oedo_shinjuku` CKAN `package_show` reports `license_id: pdl-jp-1.0` (公共データ利用規約 第1.0版), and every resource-level `license` is `null`. Main has no acquired E27 package snapshot (only the research dossier `#S01`), so this comes from the reference run's acquisition record (`hokonavi-oedo-shinjuku-package`, SHA-256 `d975c5953f74f9474cce262138ace6a676129025973f39c1119cfb21f6f3cd88`, 2026-10-21) and has not been re-acquired on main. Whether the package-level PDL 1.0 covers the two E27 resources is therefore an open question. The `CONDITIONAL` gate is unchanged.
- Next targeted research: S03 `v5_nav.json` and level geometry for Shinjuku (verify the CRS against an independent control, decode the local Path/drawing transforms, compare with E27 and PLATEAU, and keep everything non-routable until verified).
- Open test item: on merged main, the first `test:real` run once failed 2/6 (log not captured), and three reruns passed 6/6. The rights-research runs have passed 10/10. Capture the log if it recurs.
- Cosmetic: `rights/README.md` cells show raw JSON for the exclusion objects; a readable rendering is a follow-up.
- Use the operator-permission/field-survey template: [gaps/operator-survey-questions.md](gaps/operator-survey-questions.md).

## Gap research (2026-10-21, stacked on PR #18)

Full evidence: [research/network-codes-and-coverage.md](research/network-codes-and-coverage.md). Fix trail: [research/lane-d-review-fixes.md](research/lane-d-review-fixes.md).

**Added sources:** six, for 19 in total, all hashed. These are the R1 node/link GeoJSON, the MLIT 歩行空間ネットワークデータ specs (2018-03, 2024-07 and the 新旧比較表; PDL 1.0 under the MLIT site terms, with no separate notice in the PDFs), and a PLATEAU `m:533945` ubld catalog snapshot.

**Codebooks:** `tools/gis/codebooks/` holds the 2018-03 and 2024-07 code tables. Each records the table and printed page. A real-data test checks all 235 labels against the acquired PDF text. One 2018 code (`waterway=2`) has no printed label and stays null. Decoding is a literal label lookup. It never sets routability.

**R1 Ikebukuro:**
- CSV and GeoJSON agree on all 1,887 nodes, all 2,196 links and every node coordinate.
- The observed codes fit the 2024-07 spec but not 2018-03, while the CKAN notes say "last updated 2019-01-28". The applicable version is therefore UNKNOWN, with 2024-07 the only candidate.
- Both specs (§2.2) prescribe JGD2011 lon/lat, so R1's CRS is recorded as `EPSG:6668` with status `INFERRED_FROM_SPEC`. Every metric that depends on it is `CONDITIONAL_ON_INFERRED_CRS`.
- Distance check: reading coordinates as lon/lat on GRS80 gives median |Δ| 0.026 m against the recorded `distance` and max 0.055 m. 30 links exceed 0.05 m, so the result is `NO_VERDICT`. Lengths cannot distinguish datums in any case.
- All 2,196 rank checks are `method_unknown` because `r_method` is blank.

**E27 Shinjuku:**
- The codes fit 2024-07.
- Rank check under the survey rules: 262 consistent, 1 inconsistent (link above).
- Every E27 layer lies in 3rd mesh `53394525`. The 2025 catalog lists ubld only for `53394536` (Shinjuku) and `53394576` (Toshima) across the whole 2nd mesh `533945`, so there is no catalogued underground model for E27.
- PLATEAU file bboxes extend outside their nominal meshes, so a mesh name is not coverage. Older vintages are UNKNOWN.

**Rank-check method rules:** these follow the spec's red underlines (表3.3, p21). Under mobility-trace data, only the underlined readings are checked: width C, slope/step A–C upper bounds and slope/step Z. Every other trace case is `not_checkable`, and the check never corrects a rank.

**Verification (Opus lead's independent online rerun):** `typecheck` 0 · `test` **201/201** · `test:real` **6/6** · real run **17/17** · digest `9605494ca38c261d1e49019529eba707bf3feafe0e96adc4bf831a85fda0ae15`. The GLB outputs are byte-identical to PR #18. After the PR-bot fix that resolves `pdftotext` through `PATH` (override with `GTEKI_GIS_PDFTOTEXT`), the digest is `3a59c536b3d0efee1964f814e9144dc501e4262488e750c1889831759354f6e5`, with the same test counts and GLBs.

**Review:** five fresh read-only Codex GPT-6 Astra (high) reviews.
- Rounds 1–4: REQUEST_CHANGES on P2 items only, all fixed. They covered prototype-name codes, invalid join IDs, non-numeric coercion, trace-rank rules (three refinements), offline receipt links and candidate provenance.
- Round 5: **APPROVE**.

## PLATEAU vintages (inspect-vintages)

`gis inspect-vintages` answers whether the 2023 Shinjuku PLATEAU CityGML vintage covers E27's mesh `53394525` or fills the gap left by the 2025 file. Evidence: [vintages/shinjuku-2023.json](vintages/shinjuku-2023.json) (human view [shinjuku-2023.md](vintages/shinjuku-2023.md)); receipts in [acquisitions/vintages/](acquisitions/vintages/); source `plateau-13104-package-2023` (CKAN snapshot, SHA-256 `e92201b02dfe689b6561a699d03cc88c81590708a18e4874d072037c9f7e065d`, evidence only). Tool digest `fa67960baf2d610307b5452d7a16bfa613558f97326b347eb2fd12af98ee4f73`. Method: HTTP range reads only (ZIP end record, central directory, selected `ubld` members); strong ETag + pinned final URL + `206`/`Content-Range` on every range; redirects refused; CRC32 and SHA-256 per member; the report and receipts are promoted as one rollback-safe bundle.

- Reads **14,000,077 bytes** (directory 5,853,508 + members 8,146,569) of two archives (`citygml_2_op.zip` 776,906,633 B, `citygml_1_op.zip` 790,569,445 B). Nothing is downloaded whole.
- Each 2023 archive holds **only one `ubld` mesh, `53394536`** (22,845 entries in `citygml_2_op.zip`, 23,239 in `citygml_1_op.zip`). Neither holds `53394525`, the E27 mesh. `only_2023` and `only_2025` are both empty: the 2023 vintage lists the same single ubld mesh as the 2025 catalog.
- Members: `citygml_2_op.zip` `udx/ubld/53394536_ubld_6697_op.gml` 43,830,773 B (CRC32 `3be2530f`, SHA-256 `37e91af3276c2ee8fc61369409c8d54f85af0e796458474da99abedaa8c9ae3a`) and `citygml_1_op.zip` `udx/ubld/53394536_ubld_6697.gml` 43,830,139 B (CRC32 `ddcc34e3`, SHA-256 `25c55437cff5a95ea81b450b1bc92b9f946c2d8c3e5657eda1174959c79a1fc9`). Both pass CRC32 and SHA-256 and inspect to 30,358 features and 79,363 inventory polygon records with the same envelope (lat 35.6907–35.6950, lon 139.6980–139.7036, TP 15.32–45.49 m, EPSG:6697). The 2025 file is 43,830,765 B with a different hash; the two archives differ from each other by 634 B, and that difference was not analysed.
- **All 40 E27 comparisons are DISJOINT** (2 members × 20 layers: 2 network + 18 station-map), as with the 2025 file. Every layer used a validated `{type:"name"}` EPSG:6668 declaration with a COMPUTED bbox. Linked, malformed, null, assumed, conflicting or INCOMPLETE declarations/bboxes would have been UNKNOWN, never DISJOINT. Each member's CityGML geometry coverage is recorded and was complete (14,350 of 14,350 geometry references resolved; 0 unresolved, 0 unsupported external, 0 unsupported reference records, and 0 coordinate-bearing elements left unconsumed by the bbox scanner), so the bbox is a whole-member bbox. Incomplete coverage, or any disagreeing CRS declaration across station-map members (geographic or projected, e.g. EPSG:6668 vs EPSG:6677), makes the comparison UNKNOWN with an `unknown_reason`. Any coordinate-bearing GML element (`pos`, `posList`, `coordinates`, `coord`) that is not read into a `Polygon`/`LinearRing` (for example `Ring/curveMember/LineString`, `Curve`, `Triangle`, `Point`) counts as unconsumed and also makes coverage incomplete (fail closed; those shapes are not parsed). The vintage report's `input_sources` carries the E27 network reports' transitive inputs (including both walking-network specifications), and offline verification re-checks them through `assertNetworkInspectionCurrent`. Offline verification also fails a report whose `tool_input_sha256` is missing or differs from the current tool fingerprint.
- So the 2023 vintage does **not** provide underground geometry for the E27 area. Pairing E27 with PLATEAU stays on HOLD. This is bbox-only evidence for the one mesh each archive lists. It says nothing about other meshes or about geometry outside `ubld`.
- Everything is UNVERIFIED, `routable: false`, rights HOLD and licence UNKNOWN. The package snapshot is not a licence for the archive members.

## Review trail

The fresh read-only Codex review sessions are recorded in [fix-pass.md](fix-pass.md). Round 1 returned REQUEST_CHANGES with 1×P1 and 6×P2: nested ownership, `OrientableSurface` sign plus xlink reuse, namespace URIs, export membership, `linkID`, dictionary identity and categorical fields. Round 2 confirmed all of those fixed and raised 4×P2 + 1×P3 new edge cases, which were fixed in phase 3. Round 3 (closure) verified all five fixes with code, tests and in-memory probes, found no P0/P1 issues and returned **APPROVE** with no blocking items for tool digest `4b67d0bf4bd9d8ef9c8244416ce4f2c537e2307f6ac04bc151a1fae091f412fe`. An earlier ChatGPT-browser review that the implementer ran on its own initiative is kept, sanitized, under [history/](history/README.md). That route is not a channel the lead approved, and the Codex reviews supersede it.

PR [#18](https://github.com/nurockplayer/gteki/pull/18) automated Codex review raised two P2 findings, both fixed with regressions in tool digest `67f398610e32e391b9622bf25706f9456adbb6c8499381a49e6ad1ecc87a3716`:
- Geographic endpoint checks now skip out-of-range (for example, axis-swapped) positions, which makes coverage PARTIAL instead of CHECKED.
- Acquisition provenance now calls `git` directly rather than through a wrapper.

The real run was regenerated. The GLB bytes are unchanged, and the superseded conversion receipts are in `history/conversions/pre-review-fix/`.

A second automated review raised two more P2 findings, both fixed with digest `9dcf9e0b5afbeb726412dd3ea06aeea50fde82dc70ab7933f262f6f6ffcda876`:
- `real-run` now aborts when fresh acquisition fails, instead of continuing against older stored records.
- Conversion receipts from other tool fingerprints are moved to `history/conversions/tool-<digest>/` automatically, and `summarize` reads only current-fingerprint receipts.

A third automated review raised two more P2 findings, fixed with digest `12983496b3eb750a0698fa3ac6069a240546e63ddc98fc26a97b4e0eb864f4f4`:
- `real-run` converts only after both the frame step and the CRS roundtrip succeed. `overlap`/`gap-packet` run only when every prerequisite command succeeded in the same run.
- A multi-position `MultiPoint` node no longer supplies an arbitrary endpoint coordinate; that endpoint check stays PARTIAL.

The real reports are unchanged.

A fourth automated review found that `real-run` bound its receipt to the pre-frame fingerprint. The receipt is now rebound after frame generation, before conversions and stale-receipt archiving. The run, validation, summary and all 6 conversion receipts now share digest `8b4664ecf4019e146d6adc77f4d65d425b269396f206e7e5b7973b8b2b8306b5`.

A fifth automated review asked that `summarize` refuse incomplete runs. It now exits without writing unless three conditions hold: `real-run.json` is completed with every command at exit 0, the receipt fingerprint equals the current tool fingerprint, and every inventory and network report's source hash matches the recorded acquisition. Current digest: `8cc78e45f9de57cf12133d00beb2e07f5995f43c09c7e356ec6cb221370a4352`.

A sixth automated review raised two more P2 findings, fixed with digest `989c2ae8622867722741daced5f06c253de4493fc88e9fe60e1ab21a6a96592e`:
- A missing bounded-Room conversion is recorded as a failed command, so `real-run` and `summarize` fail.
- Every store-writing entry point (`cli`, `real-run`, `validate`) calls `ensurePrivateStore()`, which sets umask 077 and forces the store root to 0700. New store files are created 0600 and new directories 0700. The existing local store was tightened to match, and no group- or world-readable entries remain.

A seventh automated review raised three more P2 findings, fixed with digest `6d4c26c7ea75dc3b8838a31190d5419ba5584e2bb27a430e620073ccc244df8d`:
- Any report-writing CLI command run outside `real-run` marks `real-run.json` as `invalidated`, and `summarize` refuses invalidated receipts. `summarize` also checks the conversion and CRS-report source hashes against the acquisitions.
- `acquire --offline` compares the stored size against the current manifest's `expected_bytes`.
- Polygon and other unsupported geometries never take node or edge roles.

An eighth automated review raised two more P2 findings, fixed with digest `097463f4985249a454efa867615dcf533516b53eaacb8985584d30a704c500f8`. All 6 GLB outputs are byte-identical to the previous run.
- An endpoint check runs on a `MultiLineString` link only if it has one part or every part starts exactly where the previous one ended. Otherwise the link is skipped and coverage is reported as partial.
- `acquire --offline` no longer rejects a stored object just because its old record says `size_check: MISMATCH`. It still checks SHA-256 and byte count, then compares the size with the current manifest, so an object whose manifest has been corrected comes back as `MATCH` without a new download.

A ninth automated review found that the summary listed 6 conversions while `real-run` ran only 4. The two extras were bounded `--max-polygons 50` receipts written by `test:real`. They shared the current fingerprint, so they had survived archiving. Fixed with digest `97b97e29d215a93b8d12c6c9de9b02ab5533ee823d370e277cbaabe5fb484b09`. All 4 GLB outputs are byte-identical to the previous run.
- Before converting, `real-run` moves every existing conversion receipt to `history/conversions/`.
- `real-run` records the `conversion_run_id` of each conversion it runs.
- `summarize` includes only those conversions, and refuses to run if any of them is missing.
- `test:real` deletes its bounded conversion receipt after checking it.

## Rights research (2026-10-21, after PR #18/#19 merged as `e298fbc` / `eeaf317`)

Full evidence: [research/poi-rights-s10-s03-related.md](research/poi-rights-s10-s03-related.md). Records: [rights/](rights/README.md) (one JSON per source, generated by `gis rights-report`). Inventories: [poi/](poi/). Integration notes: [research/lane-d-integration-report.md](research/lane-d-integration-report.md).

**Added sources:** 26, for 45 in total, all hashed. They cover:
- the S10 CSVs and their catalog snapshot;
- the S03 ZIP, 仕様書 and 参考資料 PDFs and their catalog snapshot;
- both PLATEAU `related` ZIPs with their G空間 catalog snapshots;
- the PLATEAU data-catalog GraphQL response, fetched with a fixed, hashed POST body;
- the 14 direct related-layer GeoJSON assets;
- the terms pages (Tokyo portal terms, CC BY 4.0 deed, PLATEAU site policy, PDL 1.0, KSJ product pages and agreement, GSI terms and survey-approval pages).

**Rights model:** each verdict records the claimed licence, its claim level (RESOURCE / DATASET / SITE_POLICY / ORIGIN_DATASET), the evidence, scope, exclusions and what is not covered. Each evidence item is a snapshot hash, URL, section and a short quoted clause; a real-data test checks that every quoted clause occurs in its stored snapshot.
- `CLEARED_WITH_CONDITIONS` requires an explicit licence covering the exact resource or layer.
- Non-commercial origins are `RESTRICTED`; anything else is `UNKNOWN`.
- A whole-resource verdict is never cleared while any scoped part is not; the tests enforce this.
- Scope and exclusions travel with every exported verdict, including the summary and gap packets.

**Related-layer origins:** each `related` layer is tied to its origin product only after an identity check against the directly acquired asset. All 14 hold: 8 are JSON-equal and 6 are features-equal with name-only differences. The KSJ old-terms non-commercial clause is §1.3(2) in the acquired agreement.

**Acquisition hardening:** acquisition refuses every redirect (Node GET/POST and curl), recording the status and Location. The S03 ZIP and PDFs answered 301 from their catalog URLs, so the manifest now declares their final URLs with the catalog URL and hash pinned.

**Content:**
- S10: Shift_JIS, 5 (新宿) and 10 (新宿西口) populated rows, no coordinates (`UNKNOWN`). Location text stays only in the git-ignored store detail (see the no-literals rule below). 新宿三丁目 was not acquired.
- S03: per-level geometry, Path drawings and `v5_nav.json`, as described under Handoff → Shinjuku. Opening hours stay only in the git-ignored store detail; the committed report has hashes and counts.
- PLATEAU `related`: Shinjuku 110 shelters / 168 parks / 201 landmarks / 48 stations / 108 railway / 45 emergency routes / 1 border. Toshima 42 / 62 / 143 / 35 / 81 / 26 / 1.
- No POI becomes a node, edge, door or floor.

**Review:** an independent rights audit by a separate GPT-6 Astra session (it never saw the code) reached the same layer verdicts, and both review rounds were fresh read-only Astra (high) sessions.
- Round 1 returned REQUEST_CHANGES with two P1s, both fixed: the S03 scope was lost in the summary and gap projections, and curl redirects could reach private hosts.
- Round 2: **APPROVE**. It verified all 45 acquisitions, 74 stored files, 101 quoted clauses and 14 identities.

**Verification (Opus lead's independent online rerun):** `typecheck` 0 · `test` **291/291** · `test:real` **10/10** · `acquire --all` 45/45 · real run **23/23** · digest `7d7acad25836772cc8de5bf0531fccb1ae3ed04c10b6013c1c5491164ad049a2`. The GLBs are unchanged.

**No source values in Git (issue #124, Lane D):** `docs/gis/poi/*.json` previously held literal field values (opening hours, locations, names, addresses, URLs, root properties) from sources with no release permission (KSJ non-commercial P20 shelter / P13 park / N10 emergency route; S03 and S10 descriptions and links). Rule now: **committed reports under `docs/gis/**` contain no literal source field value from any POI source.** Kept: field names, blank/missing/type/distinct counts, feature/entity counts, CRS and bbox statistics, station relevance, evidence ids, derived statuses and short licence clauses. Each distinct value is `{ value_sha256, value_type, count }` (`literal_distribution` became `value_hash_distribution`; `root_properties` values became `{ value_sha256, value_type }`; `literal_location_time_fields` became `location_time_fields`). Verbatim values live only in the git-ignored store detail (`detail.store_path`). `poi-research.ts` and `gaps.ts` consume the hashed form, so `research/poi-rights-s10-s03-related.md` and `gaps/*.json` no longer carry opening-hour strings. Check with `gis check-poi-literals` (read-only; needs the store). The rule is also in the generated `rights/README.md`, `tools/gis/README.md` and `test/poi-literals.test.ts`. Earlier commits still contain the old literals; whether to rewrite history is an Owner decision recorded on #124 and was not attempted. `real-run.json` is invalidated by the regeneration; rerun the real run before `summarize`.

**PR #34 automated Codex review:** seven rounds with nine P2 findings, all fixed with regression tests. (1) S03 entity opening times are in a field named `hours`, which the opening-time classifier missed. Fixed with a shared `OPENING_TIME_FIELD` pattern and a regression test. The 236 populated `hours` values are now reported as literals. (2) `gap-packet` now adds a HOLD for each expected POI or rights report that is missing, instead of dropping the source silently when other reports loaded. (3) `summarize` refuses unless exactly one gap packet per station exists. (4) The research doc now derives the legacy S10 URL and terms-URL statements from the stored acquisition records instead of fixed text. (5) A cached acquisition is accepted only while it still matches the current manifest: the same direct URL, or the same catalog snapshot and JSON pointer for catalog-resolved sources, and the same supporting-document IDs and requested URLs. (6) The S10 CSV header `営業時間・利用時間` is now a literal location/time field. (7) `summarize` rebuilds each station's expected gap-packet POI content and refuses if any entry was dropped or changed. (8) A gap packet now includes the rights reports of every POI source it admits through a bbox match, not only the sources whose manifest names that station. As a result, Ikebukuro now carries the `plateau-13104-related` layer verdicts, and `summarize` and `test:real` check this with the same shared rule. (9) The cached-record check for catalog-resolved sources reruns the current `resolution.match` selector, through a shared `selectCatalogResource`, and requires the same pointer and URL. Changing the selector therefore forces a re-acquisition. Digest `7d7acad25836772cc8de5bf0531fccb1ae3ed04c10b6013c1c5491164ad049a2`; the GLBs are unchanged.

## Street-level context (#39)

Issue [#39](https://github.com/nurockplayer/gteki/issues/39): visual-only PLATEAU surface buildings, plus roads where honest, around the station exits, in the station's ENU frame. First pass: **Ikebukuro only**. Everything stays `UNVERIFIED`, `NOT_FOR_ROUTING`, and every publish gate stays `HOLD` / `CONDITIONAL`. No rights clearance is added.

### What was built

- **Sources** (`tools/gis/sources/sources.yaml`, now 55): catalog snapshot `plateau-catalog-bldg-tran-13116-13104` (`?types=bldg,tran`, gate `HOLD`) and eight per-mesh sources, `plateau-{13116,13104}-{bldg,tran}-{mesh}` (CC BY 4.0, gate `CONDITIONAL`, `resolution: plateau_catalog_api`). Ikebukuro meshes `53394576`/`53394577`; Shinjuku meshes `53394525`/`53394526`. The 2025 `_metadata.zip` lineage resources already exist on main (`plateau-13116-metadata`, `plateau-13104-metadata`) and the new catalog lists the same two URLs, so they were not duplicated.
- **Acquisition.** The hard-coded ubld catalog id is now taken from each source's `resolution.catalog_source_id` (each referenced catalog is refetched once, fresh). `selectCatalogResource` reads `files.<ubld|bldg|tran>` from the `_<type>_` token of the mesh file name; ubld pointers are unchanged. The decoded-stream cap stays 128 MiB, and is raised only for a source whose `expected_bytes` is larger, to exactly that size (hard ceiling 512 MiB). Files are served gzip-encoded; hashes are over the decoded bytes; redirects stay refused.
- **Station frame** (`src/station-enu.ts`, command `gis station-frame <station> [frame_id]`). A new frame kind `station-enu`, read from `stations/<id>/gteki/station.json` (read-only; its SHA-256 is recorded). It is a port of packages/geo `StationFrame` (geodetic to ECEF to ENU on GRS80, x east, y north, `z = height - hM`, no curvature term). `crs.toLocal` and `citygml-to-glb` accept it for any EPSG:6697 source; the frame-to-source provenance check applies only to envelope frames. The frame **refuses** to be created when `origin.hM` is not a number or the CRS is not EPSG:6697. Committed: `tools/gis/frames/ikebukuro-station-enu-v0.json`. The port is pinned to packages/geo by `test/fixtures/station-enu-vectors.json` (points at 0, 250 and 435 m, two origins, 1 mm; the fixture records how it was produced and `scripts/make-station-enu-vectors.mts` regenerates it).
- **Context conversion** (`src/context-scan.ts`, `src/context.ts`, `src/context-window.ts`; command `gis context-glb <station> [--radius M] [--exit-radius M] [--merge none|kind|tiles:<size_m>] [--variant high|low] [--sources id,id]`). Config shape in `tools/gis/sources/context/<station>.json` (`status`, `frame_id`, `radius_m`, `window`, `merge`, `variant`, `sources`, `blocked_reason`). The window, mesh-coverage, merge and variant rules added after the first pass are described under "Window, mesh coverage, merged output and variants" below; the bullets here describe the per-feature (`--merge none`) layout of the first pass.
  - **Pass 1** streams each GML and keeps, per top-level `bldg:Building` / `tran:Road`, only the gml:id, the station-frame XY bbox of all its polygon vertices (every LOD), the polygon count per LOD, the LOD property names and the height range per LOD. **Pass 2** retains whole, converts on arrival and discards only the selected features. Textures (`app:*`) are never read. The existing `scanCityGml`/ubld path is untouched.
  - **Selection:** bbox intersects the window (first pass: one closed disc of radius R around the frame origin; now a union of discs, see below); whole features, geometry never cut.
  - **LOD policy:** buildings LOD2 where they have `lod2Solid` or a `lod2MultiSurface` boundary (every inline LOD2 polygon, installations included), else LOD1; LOD0 never; one LOD per building (unresolved LOD2 solid references fall back to LOD1, never a mix). Roads LOD3 only; LOD1/LOD2 roads are flat at z=0 and are excluded and counted (`road_no_lod3_lod1_lod2_flat_z0`; a LOD3 whose heights are all 0 is `road_lod3_flat_z0`). No ground height is ever synthesised.
  - **Tagging:** every node has `extras.gteki_role = "context"`, `navigation_use: "NOT_FOR_ROUTING"`, `visual_only: true`, `source_id`, `source_sha256`, `lod_used`, `frame_id`, `station_json_sha256`, the PLATEAU attribution text, `gml_id`. Node and mesh names are `ctx_bldg_<gml_id>` / `ctx_road_<gml_id>`; the readback fails the run if any name matches an explorer role word (`floor`, `stairs_ramps`, `walkable`, `ramp`, `stairs`, `wall`, `walls`, `barriers`, `barrier`, `transport`, `collider`, `camera_blocker`, `sign`, `signs`, `signage`, by name, `<role>_` prefix or `<role>.` prefix). `context` is not a role the explorer acts on. Materials are double-sided.
  - **Outputs:** GLB, `.provenance.json` sidecar (per-feature rows, source records and manifests) in the store; receipt in `docs/gis/context/<run_id>.json` (window, rule, counts selected/excluded per reason, triangles, bbox, output sha, peak RSS). The receipt goes under `docs/gis/context/`, not `docs/gis/conversions/`, so `real-run`/`summarize` never mistake it for a ubld conversion. `context-glb` does not invalidate `real-run.json`; `station-frame` does (a frame is a fingerprint input).

### Window, mesh coverage, merged output and variants

Requested by the Ikebukuro station lead (exit connectors reach 249 m, so a plain 250 m disc ends where players surface) and agreed with the Explorer HUD session. Policy version `context-v2`. Still visual-only, `UNVERIFIED`, `NOT_FOR_ROUTING`, rights `CONDITIONAL`/`HOLD`.

- **Window = union of discs.** `window.r_origin_m` (250) around the origin plus `window.r_exit_m` (120) around every node of `stations/<id>/gteki/graph.json` that `window.node_rule` marks. The rule is explicit config, not a guess: a node gets a disc when `node.kind` is in `exit_kinds` (exit connector) **or** `node.floorId` is in `street_floor_ids` (street-level node). Ikebukuro: `exit_kinds ["exit"]`, `street_floor_ids ["street"]`. **Counts in the committed graph (sha256 recorded per run): 62 nodes = 36 `junction@b1`, 20 `exit@street`, 3 `stair_end@b1`, 3 `ticket_gate@b1`; 20 exit connectors, 20 street-level nodes, the same 20 nodes (matched by both fields), so 21 discs without the POI rule (24 with it).** The committed graph has 20 `kind: "exit"` nodes (all on floor `street`; the farthest, `x39`, is 248.6 m out); the station lead's count of 23 exits is the 23 exit POIs with a connector in `pois.json`: 20 end at those street nodes and 3 end at a b1 stair foot (see the next bullet). Other `kind`/`floorId` values can be added to the config lists. The union area is 1.31 times the 250 m disc (257,788 m2 against 196,308 m2). Selection is still whole-feature: a feature is kept when its station-frame bbox meets any closed disc (exact bbox-disc test, `bboxIntersectsAnyDisc`). Receipt `window` records both radii, the rule, the graph sha256 and counts and one row per selected node (`matched_by`).
- **Exit-POI connectors (`node_rule.exit_poi_connectors: true`).** Exit POIs whose connector is a stair foot instead of a street node (exit-36 -> `x36f`, exit-4 -> `x4f`, exit-13 -> `x13f`, all `stair_end` on `b1`; their stairs are outside the survey) also get a disc. Derived, not hard-coded: `stations/<id>/gteki/pois.json` (read-only, sha256 recorded next to the graph's, in the receipt `window.graph.pois`, the mesh extras `pois_sha256` and the scene extras) is read with its explicit fields `pois[].category` (value in `node_rule.exit_poi_categories`, default `["exit"]`) and `pois[].connectorNodeIds`, and every named node must exist in `graph.json` (a missing one fails the run). Ikebukuro: 52 POIs, 38 with category `exit`, 23 with a connector, 23 distinct connector nodes = the 20 exit nodes plus exactly `x13f` (190.3 m from the origin), `x36f` (66.8 m), `x4f` (128.2 m); `window.graph.pois.added_beyond_kind_and_floor` lists them. Other `stair_end` nodes are not exits: the graph has only these three, and the tests show a `stair_end` named by no exit POI, or only by a non-exit POI, gets no disc. Now 23 selected nodes, 24 discs. **Mesh coverage is unchanged:** x13f's disc reaches 310 m, still inside `53394576`/`53394577`; the 50 m margin and the roughly 100-110 m threshold for `53394586` are the same.
- **Mesh coverage, fail closed.** `meshCode3` implements the JIS X 0410 3rd-level mesh (30 x 45 arc-seconds cells, `pp uu q v r w`); Ikebukuro origin 35.7297, 139.7114 is `53394576`, Tokyo Station `53394611` (unit-tested, also against the catalog's own mesh list in `test/fixtures/plateau-catalog-meshes-13116-13104.json` and the served file envelopes). `meshesTouchedByWindow` projects each candidate cell into the station frame and tests it against every disc (closed) widened by `window.mesh_margin_m` (50 m; the served Ikebukuro files overshoot their cell by up to 0.00042 degrees, about 38 m, so a feature stored in a neighbouring file can still reach into the window). Before any source is read `context-glb` fails, naming the meshes, when a needed mesh has no bldg or no tran source in the config, or when a configured needed source is not acquired. **Ikebukuro needs only `53394576` and `53394577` (bldg and tran), which are already configured and acquired, so no source was added.** Without margin the same two meshes suffice; the northern neighbour `53394586` (also in the catalog) first matters at roughly 100-110 m of margin, and `53394587` and `53394566/67` only at 200-300 m of margin. The receipt `mesh_coverage` records the needed meshes, the margin, the needed and the unused configured sources.
- **Merged output (`--merge`, default `kind`).** `kind`: one mesh per kind, `ctx_bldg_all` and `ctx_road_all`, each one primitive with a single material (`building`, `road_surface`), 2 draw calls. `tiles:<size_m>`: grid tiles per kind named `ctx_bldg_t03_05` / `ctx_road_t03_05` (column, row, zero-padded; grid anchored at the window bounding box floored to the tile size; a feature belongs to the tile of its bbox centre and is never split; a centre outside the window box is clamped to the edge tile and counted in `layout.tile_centres_clamped_to_grid`). `none`: the per-feature nodes of the first pass, kept for debugging (library default of `buildContextGlb`; the CLI/config default is `kind`). Mesh **and** node extras carry `gteki_role "context"`, `navigation_use "NOT_FOR_ROUTING"`, `visual_only`, `source_ids`, `source_sha256s`, `frame_id`, `station_json_sha256`, `graph_sha256`, the window spec, `lod_used` counts, `merge`, `variant`, `feature_count`. Mesh names stay role-safe (`ctx_` prefix; the readback rejects any explorer role word).
- **Kinds (`--kinds bldg|tran|bldg,tran`).** Default from the station config's optional `kinds`, else both. Ikebukuro defaults to both kinds. **Roads ship as geometry only under an Owner risk acceptance** (`docs/gis/decisions/2026-10-22-plateau-tran-geometry-risk-acceptance.md`, citing #39 comment 6323977745). It supersedes the merge lead's earlier buildings-only decision. The GSI approval 令7関公第296号 in the `tran` lineage is treated as attribute-scoped, and no `tran` attribute is shipped; the test "road meshes are geometry only" enforces this. The UNKNOWN rights evidence stays as it is. Ikebukuro wiring: low and high are both `--merge tiles:380` with buildings and roads. `--kinds bldg` remains the fallback: low/kind is 1 draw and 10,812 tris; high/tiles:380 is 4 draws and 119,919 tris. Show 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」 as-is wherever the context renders. For the Ikebukuro phone build: `gis context-glb ikebukuro --variant low --kinds bldg`. An excluded kind's sources are not read at all (not even opened in the store), its meshes are absent (`--merge kind` then gives only `ctx_bldg_all`), and mesh coverage is checked only for the requested kinds (so a missing tran mesh does not block a buildings-only run). The receipt records `kinds` (top level, `window.kinds`, `mesh_coverage.kinds` and `excluded_kind_sources`), as do mesh, node and scene extras, and a subset appears in the run id (`...-low-kind-bldg-<digest>`; the full run keeps the earlier id shape), so a buildings-only receipt cannot be mistaken for the full one. Invalid values are refused before anything is read.
- **Feature table.** Without per-feature nodes the sidecar (store) and the receipt (`docs/gis/context/<run_id>.json`) carry `feature_table` (`columns: gml_id, source_id, lod, mesh, tri_start, tri_count`; `tri_start` is the first triangle of the feature in that mesh's triangle sequence). The build throws unless the ranges cover every triangle of every merged mesh exactly once (`validation.feature_table_covers_every_triangle_once`).
- **Variants (`--variant high|low`).** `high`: the first-pass LOD policy. `low`: buildings LOD1 only (never LOD0, never LOD2; a building without LOD1 is excluded and counted as `building_no_lod1_excluded_in_low_variant`); roads unchanged (LOD3 only) with `totals.triangles_by_kind {building, road}` so the lead can decide whether to drop roads from low. No decimation or simplification anywhere.
- **Estimates for the real window (not measured: the real GMLs were not converted in this lane).** From the 2026-10-21 r250 disc run (311 LOD2 buildings = 90,051 triangles, 128 LOD3 roads = 14,190 triangles, 104,241 total, 327 MB peak RSS) scaled by the 1.31 union-area factor: **high about 118k building + 19k road = about 137k triangles** (about 575 features; +/-15 % for density at the exits). **Low: roads unchanged at about 19k; buildings LOD1 about 12-18k** (about 407 buildings at 30-45 triangles each, a prism footprint of n vertices being 4n-4 triangles), so **about 31-37k in total, under the 60k low budget**; the measured LOD1 count comes from the lead's run. Draw calls: 2 with `--merge kind` (plus however many tiles with `tiles:`), against the station's 28-draw budget; the station total of 129k triangles at low quality is met by low (about 31-37k) with room for the underground scene, whereas high (about 137k) alone exceeds it.

### Acquired sources (2026-10-21, online, decoded SHA-256)

| source_id | bytes | sha256 | catalog fileSize |
| --- | ---: | --- | ---: |
| plateau-catalog-bldg-tran-13116-13104 | 34,932 | `cff24d7b1e50a4561188118e6dcff5c57f945f87d4aaa8b1cf3e8ae7efbf5668` | n/a |
| plateau-13116-bldg-53394576 | 153,213,705 | `29009b87ac7c7bf07f2bc8862362629d7c11fb81240b392b2c975ff04f6f7873` | 152,652,335 |
| plateau-13116-bldg-53394577 | 168,102,762 | `96b2c510ac44d955c0902612d0c702ee3594ca699993e0b187cbff86c2b82c37` | 167,549,708 |
| plateau-13116-tran-53394576 | 20,812,006 | `6cc53f9c3ddfa90423ae1ae5c5741ceb004be2ddd6580b533644c449a7d068f7` | 20,812,006 |
| plateau-13116-tran-53394577 | 32,601,545 | `052919a57424e9a6d33edc1bbaad8e2bdea91dac33ebaeb62c032769e0b52cb2` | 32,601,545 |
| plateau-13104-bldg-53394525 | 94,275,150 | `6ee3ab2254dd634b437ebc2afbb5dbb430acb9cc5c2f7cfe687ca637f403d327` | 93,876,352 |
| plateau-13104-bldg-53394526 | 62,700,939 | `b6a84b0148dff5a33fbaf012549eb482979ffa75fd9f764f20fb9a7434fcda3c` | 62,405,121 |
| plateau-13104-tran-53394525 | 34,370,375 | `5b6e432a857c3241766abcda3c3c596b5ff8f298e1ae95051619fbb191c4c195` | 34,370,375 |
| plateau-13104-tran-53394526 | 11,415,006 | `2ff55bf2847f8f9ce30dff083a3fedf77599390d08644002b56c8cf50fe829d5` | 11,415,006 |

The catalog `fileSize` equals the served decoded size for every `tran` file but is 0.33-0.47 % too small for every `bldg` file. A first acquisition with `expected_bytes` set to the catalog value therefore failed (hard cap on the two Ikebukuro files, `MISMATCH` on the two Shinjuku files). The manifest now declares the measured served size, and the sources' notes say so. The bldg bytes were not otherwise checked against another copy.

### Status

- **Ikebukuro: ready.** Frame committed; four sources acquired (the window, with exit discs, needs exactly those four); conversion code and synthetic-fixture tests pass. The real files were **not** converted in this lane (host memory); the lead runs them in a capped container (commands in the README, "Street-level context"; both variants). Measured: a 152.7 MB synthetic bldg file (70 repeated copies of 60 real buildings, 4,200 features) took 4.2 s for both passes at 240 MB peak RSS; the fixture run peaks at 113 MB. For the real files expect roughly 250-400 MB peak RSS and under a minute for all four files; a 1 GB container limit is generous. Memory scales with the selected features, not with the file.
- **Shinjuku: blocked on its vertical anchor.** `stations/shinjuku/gteki/station.json` has `origin.hM: null`, `origin.crs: EPSG:6668` and symbolic floors (`street = 0`, `elevationSource: "symbolic"`), whereas PLATEAU heights are real TP (street is roughly 32 m). Putting TP geometry in a frame whose street is 0 needs either a vertical offset or a different anchor, which the station lead must decide (and, with it, the reference origin). The sources are acquired and `sources/context/shinjuku.json` carries the final config shape with `status: BLOCKED` and the reason; `gis station-frame shinjuku` and `gis context-glb shinjuku` refuse. Nothing for Shinjuku was converted.

### Open questions

- **(a) Footprint.** Resolved by the station lead's request: the window is the union of a 250 m origin disc and 120 m discs around the graph's exit connectors and street-level nodes (above). Open: the 23-versus-20 exit count, and whether R_exit should be larger than 120 m where the streets beyond an exit matter. The selection predicate is one function (`bboxIntersectsAnyDisc`).
- **(b) Shinjuku vertical anchor and reference origin** (above).
- **(c) GSI approval 令7関公第296号.** It appears in the resource CSV for `tran:function` / TrafficArea, and elsewhere in this lane it is recorded as an approval number whose downstream scope is unpublished ("an approval number alone is not permission"). Whether it scopes `tran` road geometry is not established. Roads are therefore the more uncertain part of the context mesh; buildings and roads are separate nodes (`feature_type`, `ctx_bldg_` / `ctx_road_`) and can be dropped independently. No clearance is claimed.
- **(d) Identity gap.** The catalog-API files (this lane) and the CKAN-listed ZIPs (`plateau-13104-package-2023`, earlier vintages) are different publication paths with different sizes and dates: the served GMLs have `Last-Modified` 2026-03-27 and `creationDate` values up to 2026-03-13, and the catalog `fileSize` disagrees with the served size for bldg. Which copy is the authoritative 2025 release, and whether the ZIP members are byte-equal to these files, is not established here.
- **(e) Textures** are skipped: their lineage is aerial photography and their licence is not assessed. The GLB has no textures and flat per-class colours.
- **(f) Occlusion.** `buildOccluders` treats every mesh under the station root as an occluder, so an asset with `role: "visual"` can still occlude the follow camera. Whether context meshes should do so (and what a user inside a building footprint at street level sees) is Lane G's call; the tool does not decide it.

### How Lane G or the station lead would wire it

Lane D does not edit `stations/**`. After the lead produces the GLB (store path in the receipt), the station lead copies it to `stations/ikebukuro/gteki/assets/` and adds a `sources` entry for the PLATEAU bldg/tran meshes (title, `downloadUrls` and per-file `sha256` from the acquisition records, licence CC BY 4.0, attribution "Contains PLATEAU data (MLIT), CC BY 4.0. Modified: ...", `modified: true`) plus an asset:

```json
{ "id": "street-context", "uri": "assets/ikebukuro_street_context.glb", "format": "glb", "floorIds": ["street"],
  "sourceIds": ["<the new station source ids>"], "role": "visual",
  "derivation": "PLATEAU bldg LOD2/LOD1 + tran LOD3 -> tools/gis context-glb ikebukuro --radius 250 (station-enu frame, TP heights, whole features, no textures); receipt docs/gis/context/<run_id>.json" }
```

The GLB is authored directly in the renderer frame `(x, z, -y)` of the station frame, so no `transform` is needed. Nodes carry `gteki_role: "context"`, which the explorer ignores (not walkable, collider, see-through or camera blocker), and `role: "visual"` adds no collision.
