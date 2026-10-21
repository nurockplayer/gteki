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
- S10: Shift_JIS, 5 (新宿) and 10 (新宿西口) populated rows, no coordinates (`UNKNOWN`). Location text is kept literally. 新宿三丁目 was not acquired.
- S03: per-level geometry, Path drawings and `v5_nav.json`, as described under Handoff → Shinjuku. Opening hours are kept as literals.
- PLATEAU `related`: Shinjuku 110 shelters / 168 parks / 201 landmarks / 48 stations / 108 railway / 45 emergency routes / 1 border. Toshima 42 / 62 / 143 / 35 / 81 / 26 / 1.
- No POI becomes a node, edge, door or floor.

**Review:** an independent rights audit by a separate GPT-6 Astra session (it never saw the code) reached the same layer verdicts, and both review rounds were fresh read-only Astra (high) sessions.
- Round 1 returned REQUEST_CHANGES with two P1s, both fixed: the S03 scope was lost in the summary and gap projections, and curl redirects could reach private hosts.
- Round 2: **APPROVE**. It verified all 45 acquisitions, 74 stored files, 101 quoted clauses and 14 identities.

**Verification (Opus lead's independent online rerun):** `typecheck` 0 · `test` **291/291** · `test:real` **10/10** · `acquire --all` 45/45 · real run **23/23** · digest `7d7acad25836772cc8de5bf0531fccb1ae3ed04c10b6013c1c5491164ad049a2`. The GLBs are unchanged.

**PR #34 automated Codex review:** seven rounds with nine P2 findings, all fixed with regression tests. (1) S03 entity opening times are in a field named `hours`, which the opening-time classifier missed. Fixed with a shared `OPENING_TIME_FIELD` pattern and a regression test. The 236 populated `hours` values are now reported as literals. (2) `gap-packet` now adds a HOLD for each expected POI or rights report that is missing, instead of dropping the source silently when other reports loaded. (3) `summarize` refuses unless exactly one gap packet per station exists. (4) The research doc now derives the legacy S10 URL and terms-URL statements from the stored acquisition records instead of fixed text. (5) A cached acquisition is accepted only while it still matches the current manifest: the same direct URL, or the same catalog snapshot and JSON pointer for catalog-resolved sources, and the same supporting-document IDs and requested URLs. (6) The S10 CSV header `営業時間・利用時間` is now a literal location/time field. (7) `summarize` rebuilds each station's expected gap-packet POI content and refuses if any entry was dropped or changed. (8) A gap packet now includes the rights reports of every POI source it admits through a bbox match, not only the sources whose manifest names that station. As a result, Ikebukuro now carries the `plateau-13104-related` layer verdicts, and `summarize` and `test:real` check this with the same shared rule. (9) The cached-record check for catalog-resolved sources reruns the current `resolution.match` selector, through a shared `selectCatalogResource`, and requires the same pointer and URL. Changing the selector therefore forces a re-acquisition. Digest `7d7acad25836772cc8de5bf0531fccb1ae3ed04c10b6013c1c5491164ad049a2`; the GLBs are unchanged.
