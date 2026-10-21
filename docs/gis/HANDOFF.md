# Lane D — GIS data factory handoff

Updated: 2026-10-21 · Issue: [#10](https://github.com/nurockplayer/gteki/issues/10) · Lead: Opus 5.5 (architecture, integration, review, delivery) · Implementation and tests: Codex GPT-6.1 Sol (xhigh, fast tier) through PR #19 and POI round 3, then Sonnet 5.5 subagents (Owner policy of 2026-10-21: Codex is review-only) · Independent review: separate read-only Codex GPT-6 Astra (high) sessions plus the PR Codex bot.

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
| `inspect-poi` | Literal inventory of POI/facility CSV, ZIP, GeoJSON and PDF sources: fields, value tables, geometry types, declared/assumed CRS, ZIP member-name encodings. Never geocodes text and never joins anything to a graph. |
| `inspect-vintages` | HTTP-range ZIP reader for multi-hundred-MB PLATEAU archives. It reads only the central directory and selected members, under strong-ETag, final-URL and Content-Range identity checks. |
| `rights` | Rights evidence register. Each source records its package, site, file-embedded and resource scopes separately, with hashed pointers. Every publish gate is HOLD. |
| `overlap` | Bbox-only spatial relation between acquired layers, with projected separation. Explicitly not evidence of feature alignment or connectivity. |
| `gap-packet` | Per-station UNKNOWN/HOLD packets computed from the reports. |
| `scripts/blender_import_check.py` | Headless Blender glTF import. Compares the imported bbox with the recorded one and renders review images. |

Reproduce the full run with `pnpm --dir tools/gis install --frozen-lockfile`, then `pnpm --dir tools/gis gis acquire --all` and `pnpm --dir tools/gis exec tsx src/real-run.ts`. Details are in [tools/gis/README.md](../../tools/gis/README.md). Raw bytes, full feature-detail tables, GLBs and candidate graphs stay in `$GTEKI_GIS_STORE` (default `~/.gteki/gis-store`, mode 700). Only small, auditable records are committed.

## Verified checks

- PR #18 baseline: `typecheck` 0 · `test` **82/82** · `test:real` **3/3** · `acquire --all --offline` **13/13** hashes · real run **16/16** CLI invocations exit 0. The Opus lead re-ran these independently. The current candidate's numbers are under [POI rights and PLATEAU vintages](#poi-rights-and-plateau-vintages-2026-10-21).
- CRS: two independent controls from the official GSI 測量計算サイト `bl2xy` (JGD2011, zone IX, retrieved 2026-10-20) match within **0.05 mm**. Envelope-corner roundtrips are below 1e-6 m.
- GLB readback: bbox error ≤ **0.006 mm**. Independent Blender 5.2.2 import of both full-file GLBs reproduces the recorded local bbox to within float32 precision (see [evidence/](evidence/)).

## Station results

### Ikebukuro — PLATEAU `13116` ubld mesh `53394576` (2023 東京都 LidarSLAM source; rights: see [register](rights/README.md))

- SHA-256 `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`, 35,427,963 bytes. 1 `uro:UndergroundBuilding`, **1 group literally named 「池袋駅_B1地下通路」**, 3 Rooms, 3 Door objects, 7 installations (EF_25 壁・バリア, EF_35 階段・スロープ category, EF_80 輸送機能, EF_30 屋根・床・舗装; labels come from the acquired codelist).
- Footprint about **360 m × 369 m**, vertical extent **7.7 m** (TP 25.50–33.17 m). The literal group name and the narrow height range are consistent with a **single B1 passage level only**. No Metro B2/B4 levels, platforms, gates or paid boundaries are present as explicit elements. Do not assume that further levels exist elsewhere in this file.
- 98,173 polygon uses = 58,761 definitions + 39,412 xlink reuses (23,954 reversed). The full GLB has 58,761 polygons and 64,811 triangles.
- R1 walking network (CKAN package `pdl-jp-1.0`, content 2019-01-28): 1,887 nodes / 2,196 links, one weak component, 0 anomalies. Every node has `in_out=1`, elevation is blank everywhere and **no CRS is declared**. As a result, its spatial relation to the PLATEAU geometry is **UNKNOWN** (no metric comparison is made from an assumed CRS). `rt_struct` (8 codes) and `lev_diff` (4 codes) distributions are reported but deliberately **not** decoded.
- Packet: [gaps/ikebukuro.md](gaps/ikebukuro.md).

### Shinjuku — PLATEAU `13104` ubld mesh `53394536` + Toei Oedo E27 (CKAN package `pdl-jp-1.0`, published until 2027-03-12; rights: see [register](rights/README.md))

- SHA-256 `013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977`, 43,830,765 bytes. 1 `uro:UndergroundBuilding` named 「新宿駅周辺エリア」, 153 Rooms, 1,364 Doors, 1,911 FloorSurfaces, 1 installation. **No explicit floor labels** are present.
- Footprint about **506 m × 479 m**, vertical extent **30.2 m** (TP 15.32–45.49 m). The full GLB has 65,013 polygons, 148,950 triangles and 30,358 nodes. The per-object node granularity makes the Blender import slow (measured in [evidence/](evidence/)), so runtime assets should be merged per Room or surface class by the asset lane.
- E27 network: 233 nodes / 263 links, one weak component, 0 anomalies, all 263 endpoints checked. Literal `floor` values: −6 … 1. Station map: 18 layers, 465 features, literal labels 1階 / 地下1・2・3・5・6階.
- **Key finding: the only PLATEAU underground file for 新宿区 is spatially DISJOINT from every acquired E27 layer, about 184–237 m apart (bbox-based).** The E27 data therefore cannot be paired with the PLATEAU ubld geometry. Any E27 3D scene needs another geometry source or a field survey. This pairing is on **HOLD**.
- Packet: [gaps/shinjuku.md](gaps/shinjuku.md).

## Rights / publication gate

| Output | Gate |
| --- | --- |
| PLATEAU-derived GLB/renders | **HOLD.** The packages declare `plateau` (Site Policy §3: PDL 1.0, CC BY 4.0-compatible, municipal copyright and individual-law caveats). The acquired 2025 ubld files have **no exact parent-resource match** in the CKAN packages, so their resource licence is UNKNOWN. The metadata ZIPs say "Licensed under CC BY 4.0" for the datasets they describe. The station lead decides on inclusion after verifying geometry; the Owner approves release with the exact attribution and modification text. |
| Hokonavi-derived candidate graphs | Package `pdl-jp-1.0` (R1 and E27, from hashed CKAN snapshots, each resource matched by exact URL). Attribution and a processing notice, no implication of government authorship. Internal only because they are `UNVERIFIED`. |
| S10 Toei store CSVs, S03 facility ZIP/PDFs | Package `CC-BY-4.0`; resource level UNKNOWN; third-party content not cleared. Inventory only. |
| PLATEAU codelists/schemas, catalog snapshots, S03 landing page | UNKNOWN. Internal inspection only. |
| Operator maps (JR, Metro, Tobu, Seibu, Keio, Odakyu, Toei pages …) | Not acquired. Reference-only per the dossier. |

## Handoff to station leads (A/B), shared core (C) and assets (E)

1. **Ikebukuro (A):** the PLATEAU B1 passage is the only open 3D geometry acquired. Use it as a geometry candidate for a B1 slice after verifying it against permitted references or a field survey. It has no route graph, no gates and no other levels. R1 is an outdoor/peripheral network, not an indoor graph. Neither R1 file declares a CRS; JGD2011 lon/lat is only inferred from the MLIT spec (see Gap research). Under that inference, the 176 R1 nodes inside the B1 passage bbox are all floor 0 or 0.5 and no `rt_struct=5` (地下通路) link crosses it, so R1 does not appear to model this B1 passage.
2. **Shinjuku (B):** E27 is the only open indoor graph, and it does not overlap the PLATEAU ubld file. No 2025 PLATEAU ubld file is catalogued for E27's mesh `53394525`. One E27 underground-passage link (`b80b3f4aef474ac2aa25c6680b26177a`) contradicts itself: `rank` SBS (slope 5–8 %) but `vtcl_slope=1` (0 %), both field-surveyed. Treat its slope as UNKNOWN. Choose between (a) an E27-first slice whose geometry is derived from the E27 station-map polygons (PDL 1.0) with **no invented heights** (only literal floor values) and (b) a PLATEAU-area slice with no open graph. Both are HOLD for verified routing.
3. **Shared core (C):** the frames `ikebukuro-plateau-ubld-v0` / `shinjuku-plateau-ubld-v0` are arbitrary processing origins, not station reference points. They are a proposal for the #2 coordinate contract and are not imposed. Field names follow the source-register schema.
4. **Assets (E):** GLB nodes carry `gml_id` extras for traceability. Merging for runtime should keep a sidecar mapping back to the IDs.

## Known gaps / next steps

- Done: MLIT code tables decoded per spec version; R1 GeoJSON acquired (no CRS there either); E27↔PLATEAU coverage checked against the 2025 catalog and the 2023 archives; S10, S03 and PLATEAU related POI acquired with their rights evidence (see below).
- Still open: which spec version R1 actually follows; R1's verified datum; PLATEAU vintages before 2023; operator-floor equivalence and floor-to-height mapping; paid/unpaid boundaries; resource-level and third-party rights for every source.
- Next targeted research:
  - Prove that each 2025 ubld file the catalog API serves is byte-identical to a member of a CKAN-listed package ZIP. The range reader can do this. A match would link the file to the package `plateau` declaration by exact archive membership.
  - Decode S03 `path-level-geom` (`Path` type, local frame) from its specification PDF. Inventory only until a frame is established.
  - Find an open geometry source for E27's mesh `53394525`, or plan a field survey.
- Use the operator-permission/field-survey template: [gaps/operator-survey-questions.md](gaps/operator-survey-questions.md).

## Gap research (2026-10-21, merged in PR #19)

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

## POI rights and PLATEAU vintages (2026-10-21)

PR: #__PR__.

Full evidence: [research/poi-rights-and-vintages.md](research/poi-rights-and-vintages.md) (generated). Rights register: [rights/README.md](rights/README.md). Fix trail: [research/poi-rights-round1b.md](research/poi-rights-round1b.md), [round2](research/poi-rights-round2.md), [round3](research/poi-rights-round3.md), [rounds 4–6](research/poi-rights-round4.md).

**New commands:** `inspect-poi` (CSV/ZIP/GeoJSON/PDF literal inventory), `inspect-vintages` (HTTP-range reader that pulls only the ZIP central directory and selected members from multi-hundred-MB PLATEAU archives, with strong-ETag, final-URL and Content-Range identity checks) and `rights` (evidence register). All three fail closed and write atomically.

**Sources:** 15 added (34 total), all hashed: the two S10 Toei store CSVs (新宿, 新宿西口), the S03 Tokyo 新宿駅周辺施設 ZIP with its specification, reference PDF and landing page, six CKAN package snapshots (S10, S03, PLATEAU 13104 2023/2025, 13116 2025, Hokonavi E27), the two 2025 PLATEAU `related` ZIPs and the PLATEAU site policy.

**Rights findings** (the register keeps package, site, file-embedded and resource scopes separate; every resource-level licence stays UNKNOWN and every publish gate HOLD):
- S10 and S03: CKAN package `CC-BY-4.0`, linked to each resource by exact URL (S03 through the hashed pre-redirect URL pointer). Package level only.
- E27 (Toei Oedo 新宿): package `pdl-jp-1.0` (公共データ利用規約 第1.0版) from a hashed `station_oedo_shinjuku` snapshot. Both resource URLs match exactly; resource licence fields are null.
- PLATEAU: packages declare `plateau` → Site Policy §3 (PDL 1.0; municipal copyright and individual-law caveats kept). The eight 2025 ubld/metadata/codelists/schemas files fetched through the catalog API have **no exact parent-resource match** in the CKAN package, so they stay UNKNOWN. The two 2023 vintage members link through their exact parent archive URL. Both metadata ZIPs literally contain "Licensed under CC BY 4.0" under `MD_Metadata/identificationInfo/MD_DataIdentification/resourceConstraints`, which is recorded as FILE_EMBEDDED for the described dataset only.
- The earlier "CC BY 4.0" labels on the PLATEAU ubld files in this handoff were manifest labels, not evidence. They are corrected below.

**POI findings:**
- S10: 5 rows (新宿) and 17 rows (新宿西口). There are no coordinate columns, so locations stay text-only and are not geocoded.
- S03: 25 members, about 31,000 features across 1F–4F, B1F–B5F, M1F and MB2F. The member names are undeclared CP932 (the ZIP has no UTF-8 flag). Raw bytes are the identity and the Japanese name is recorded as a labelled candidate. The `geojson-level-geom-*` members have no CRS (RFC 7946 is only an assumption). The `path-level-geom-*` members use a non-GeoJSON `Path` type in an undeclared local frame, so their bbox is UNKNOWN. Original-data fields: none found. Route content: INVENTORY_ONLY and never joined to a graph. Landing page: published 2023-02-28 from data first released March 2020; that is not a survey date.
- PLATEAU related (13104/13116): 7 members each (shelter, park, landmark, station, railway, emergency route, border). The 2023 shelter/park layers sit inside the 2025 package. No original-source fields.

**2023 vintage:** the range reader read 14.0 MB of the two 777–791 MB 2023 新宿区 CityGML archives. Each holds only ubld mesh `53394536`, the same as 2025. Both members (43,830,773 B and 43,830,139 B) pass CRC32 and SHA-256 checks. All 40 E27 layer comparisons are DISJOINT, so **no PLATEAU vintage acquired so far covers E27**.

**Verification (Opus lead, Node 26 OrbStack container, `--memory 4g --cpus 2`):** `typecheck` 0 · `test` **406/406** · `test:real` **6/6** · real run **25/25** · `acquire --all --offline` 34/34 · digest `57d5e579f559bff361ec90e230322cb62015817c8a593d24c74ebede63b70062` (commit 444a4b9). All 4 GLB outputs are byte-identical to main.

**Review:** fresh read-only Codex GPT-6 Astra (high) sessions.
- Round 1: P1 weak ETags combined across ranges; P2 incomplete bbox at the visit limit; P2 projected Points recorded as lon/lat.
- Round 2: P1 negated licence text promoted to a licence; P2 feature-level CRS ignored; P2 depth cutoff giving a complete bbox; P2 stale POI reports accepted; P2 superseded vintage rights kept.
- Round 3: P1 redirect final URL not pinned; P2 stale overlap inputs; P2 linked/malformed CRS treated as declared; P2 vintage receipts promoted before validation.
- Round 4: P1 final-URL match overriding the hashed resolution pointer; P1 XML rights scope; P2 malformed coordinate nesting; P2 stale network inspections. The lead added CP932 member-name candidates and network freshness checks in `overlap`/`gap-packet`.
- Round 5 (P2 only): metadata namespace allow-list; coded/linked constraints kept apart from free text; R1 per-source resource membership; rights evidence freshness; property-scan cap; atomic POI report bundles.
- Round 6 (P2 only): conflicting resource licence fields kept as CONFLICTING_DECLARATIONS with licence UNKNOWN; validated effective CRS required in vintage/network/overlap; CSV coordinate range checks; literal counts tracked apart from blank/non-scalar sentinels.
- Round 7 (fresh read-only Astra on `93a978b`, the round-6 fix commit): **pending: Codex CLI unavailable.** Every `codex` process on the host, `codex --version` included, hung in `_dyld_start` and was reported to the Owner. The run was stopped after 2.5 h with no output. It was not relaunched, and no Sonnet review stands in for it. The merge baseline is still an independent Codex review at head.

Implementation: Codex GPT-6.1 Sol through round 3, then Sonnet 5.5 subagents under the Owner's 2026-10-21 policy (Codex is review-only). Sol twice ran an unapproved browser "Oracle" review on its own initiative. Those runs are not part of the review record.

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
