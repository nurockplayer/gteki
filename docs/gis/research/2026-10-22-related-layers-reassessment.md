# PLATEAU related layers: per-layer licence reassessment (2026-10-22)

Lane D research. Nothing here is implemented, acquired, routable or verified. This note only proposes. All web pages were read on 2026-10-22 (landing, terms and catalogue-metadata pages only; no dataset was downloaded). No feature name or attribute value from any related layer, S10 or S03 appears here: layers are described by counts, schema field names and hashes.

Context: the Owner asked (through director gteki-80) for as much data as possible to go live within what the licences allow. Q5 and Q6 ("No") were defaults, not licence findings. The Owner's answers are in `docs/gis/decisions/2026-10-22-owner-rights-answers.md` and [#39 comment 6324726321](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321). The director has approved #171 B2 (KSJ N02-2025 for station and railway) and B3 (Shinjuku ward park list) at their defaults; see `docs/gis/research/2026-10-22-shinjuku-poi-next-gaps.md` section B.

## 1. Findings that shape every verdict

1. **The PLATEAU copy adds no restriction, but it also grants nothing for non-commercial origins.** The G-Spatial package declares `license_id: plateau`, which points at the PLATEAU site policy section 3 (Public Data Licence 1.0, stated as compatible with CC BY 4.0) (<https://www.mlit.go.jp/plateau/site-policy/>, accessed 2026-10-22). The same policy says a rights notice, where given, takes precedence over the default, and it does not list the "related" data. The seven GeoJSON files carry only the root keys `features`, `name`, `type` (from `docs/gis/poi/plateau-13104-related.json`): no licence metadata, no CRS. Origin, vintage, creator (PASCO) and converter (PLATEAU CMS) exist only in the PLATEAU data-catalog GraphQL description, which the repo hashes. The package is a mixed-origin archive, so the archive-level licence cannot be read as relicensing a KSJ non-commercial layer (same reasoning as `docs/gis/rights/plateau-13104-related.json`: "site/origin terms alone do not cover this derivative").
2. **The PLATEAU copies are lossy re-encodings.** The station layer is points (N02 stations are lines); the border layer is a single LineString (N03 is polygons); a `高さ` (height) field appears on the station, shelter and landmark layers that is not an origin field; some layers drop origin fields. For CC BY origins the copy would be shippable under the origin licence, but a direct KSJ re-source is better: the licence is stated by the data owner on the product page we cite, vintages are newer, geometry is original, and the credit string is defined by KSJ.
3. **Q12/(b) road risk acceptance does not transfer to the non-commercial KSJ layers.** The road case was an unverified scope of a survey approval. P20, P13 and N10 carry an explicit `非商用` label on their product pages, and the old KSJ terms (<https://nlftp.mlit.go.jp/ksj/other/agreement_02.html>) limit such data to non-commercial use and exclude redistributing copies. The only exception (article 3(2)) is for GIS analysis results that are not databases; a redistributed geometry layer is not that. Only the Owner could knowingly accept that risk; this note does not recommend it, and the data would be poor anyway (P20 2012, P13 2010).
4. **KSJ current terms** (<https://nlftp.mlit.go.jp/ksj/other/agreement.html>, <https://nlftp.mlit.go.jp/ksj/other/agreement_01.html>): products labelled CC BY 4.0 fall under the government-standard-terms edition that is compatible with CC BY; commercial use, copying and public transmission are allowed with a source credit (example form: 出典：国土交通省国土数値情報ダウンロードサイト（当該ページのURL）), plus a separate statement when the data is edited, and not presenting edited data as government-made. Products labelled "CC BY 4.0, partial restriction" may carry different provider terms, and non-commercial or unlabelled products follow the old terms.
5. **`context-glb` cannot take these layers as it stands.** `tools/gis/src/context.ts` accepts only source ids matching `^plateau-(\d{5})-(bldg|tran)-(\d{8})$`, `ContextKind` is `'bldg' | 'tran'`, mesh coverage is by 3rd-level mesh, and the scanner reads CityGML `bldg:Building` / `tran:Road`. A new sibling command is needed (section 4), reusing the window, frame and tagging code.

## 2. Per-layer table

Counts are Shinjuku 13104 / Toshima 13116 (Ikebukuro). Fields are schema names only. All PLATEAU files have an undeclared CRS (`crs_declared: false`). Whether a feature falls inside a station window is UNKNOWN (only bbox intersection was computed).

| Layer | Features (13104 / 13116) | Geometry | Origin product and vintage | Origin licence and level | PLATEAU copy adds terms? | Verdict | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| station | 48 / 35 | Point | KSJ N02-2024 (reference 2024-12-31); current edition N02-2025 (reference 2025-12-31, released 2026-04) | CC BY 4.0, product page, 2020 onward: <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html> (and `-2024`) | No extra restriction found; only PASCO and PLATEAU CMS creator/converter credits | `REPLACE_WITH:KSJ N02-2025` | CC BY 4.0 at product level, commercial redistribution allowed with credit and change notice. Direct source is newer, keeps the original station lines, is director-approved (B2). Fallback if the direct file disappoints: the hash-verified PLATEAU N02-2024 copy, shippable under the same CC BY. |
| railway | 108 / 81 | LineString 103, MultiLineString 5 / 79, 2 | KSJ N02-2024, as above | as above | as above | `REPLACE_WITH:KSJ N02-2025` | Same product as station. The page lists no related law and no GSI approval notice; its construction note mentions GSI tiles as a working tool only. |
| border | 1 / 1 | LineString (origin is polygons) | KSJ N03-2025 (reference 2025-01-01); current edition N03-2026 (reference 2026-01-01) | CC BY 4.0, product page: <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html> (and `-2025`) | No | `REPLACE_WITH:KSJ N03-2026` (lowest priority) | CC BY 4.0, original polygons are on the page. The page prints a 測量法 reproduction-approval notice (N03-2025: R 6JHf 503; N03-2026: R 7JHf 351) after the source description; it is not phrased as a user duty, but carry it verbatim as the cautious reading. The base is GSI 国土基本情報 (see landmark), so the director may prefer to cap it; value at station scale is a single ward outline. |
| shelter | 110 / 42 | Point | KSJ P20 避難施設, FY2012, JGD2000 | **非商用** (non-commercial), product page; latest and only edition: <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P20.html> | No | `HOLD_RESTRICTED` for the PLATEAU layer; `REPLACE_WITH:` Shinjuku ward 指定緊急避難場所一覧 (`t131041d0000000115`) and Toshima ward 指定緊急避難場所一覧 (`t131164d0000000003`), partial | Origin forbids commercial use and copy redistribution. Clean replacements exist at dataset-level CC BY 4.0 but are thin: Shinjuku 10 rows (2023, from the earlier research), Toshima one 17,408-byte CSV (created 2022-04, modified 2022-08, row count and columns not read). Coordinate columns for Toshima are UNKNOWN. Gated on header inspection and on B1 (below). |
| park | 168 / 62 | Point | KSJ P13 都市公園, FY2011 (reference 2010-03), JGD2000 | **非商用**, product page; latest edition: <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P13.html> | No | Shinjuku: `REPLACE_WITH:Shinjuku ward 都市公園・都立公園一覧` (`t131041d2025000003`). Toshima: `HOLD_RESTRICTED` | Shinjuku: dataset-level CC BY 4.0 by the data owner, CSV with latitude, longitude, area (about 178 rows, INFERRED), director-approved (B3). Toshima: the ward's 32 catalogue datasets include no park list; no clean source found. |
| emergency route | 45 / 26 | LineString / MultiLineString (39+6 / 24+2) | KSJ N10 緊急輸送道路, FY2024 (reference 2024-03), JGD2011 | **非商用**, product page: <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N10-2024.html>. The page also prints GSI approvals R 6JHf 503 and R 2JHs 664 (re-checked 2026-10-22: N03-2025 and N10-2024 both print an R 6JHf approval; N03-2026 prints R 7JHf 351) | No | `HOLD_RESTRICTED` for the PLATEAU layer; `REPLACE_WITH:Tokyo 建設局 緊急輸送道路` (`t000014d2000000030`), gated | Origin is non-commercial. Tokyo's Bureau of Construction publishes the emergency transport road network map: dataset-level CC BY 4.0, one ZIP of 1,147,904 bytes, created and modified 2024-05-08, resource licence field empty. Format, CRS and whether it is vector are UNKNOWN (not downloaded; the host page returned 403). Gated on inspecting the ZIP and on B1. Covers both wards if vector. |
| landmark | 201 / 143 | Point | GSI 数値地図（国土基本情報）, 2025-10-15, PASCO, converted by PLATEAU CMS; approval 令7関公第296号 | GSI page <https://www.gsi.go.jp/kibanjoho/kibanjoho40027.html>: copying or using the data needs an application under 測量法 articles 29 or 30; no open licence stated | Approval number carried by the catalogue; its downstream scope and wording are unpublished | `NOT_USED` (GSI layer; director decision 1, section 5); municipal lists in section 7  | See section 5. Q7 was No; the GSI scope is UNKNOWN and no external inquiry is allowed (#165). |
| (all) archive | 2 ZIPs | | | | | not applicable | The ZIPs stay split per layer; nothing ships as a whole archive. |

Other KSJ products checked for completeness (product pages, 2026-10-22): P12 観光資源 (non-commercial, 2014, JGD2000, <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P12.html>) and P35 道の駅 (non-commercial, 2018, <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P35.html>) are `HOLD_RESTRICTED` and are not in the related packages. P05-2022 市町村役場等及び公的集会施設 is labelled CC BY 4.0 but prints a GSI map-image approval note (<https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05-2022.html>); same GSI-approval group as landmark, not pursued. N02 and N03 are labelled plain CC BY 4.0 on their pages (not the partial-restriction label).

Net: the clearly shippable set is station, railway, border (KSJ direct) and the Shinjuku park points. Shelter and emergency route have clean but unverified replacements (gated, decision 2). Toshima parks have none. The GSI landmark layer is not used; municipal lists are checked in section 7 (decision 1).

## 3. Credit strings

Use the KSJ page's own example form plus the edit statement the terms require. They are proposals; the exact display text for the app is the director's call, but the elements are required.

| Source | Proposed credit (shown as-is where the layer renders) | Basis |
| --- | --- | --- |
| N02-2025 | 「出典：国土交通省国土数値情報ダウンロードサイト（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html）を加工して作成」 | KSJ terms example plus edit statement. The N02 page prescribes no wording of its own. |
| N03-2026 | 「出典：国土交通省国土数値情報ダウンロードサイト（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html）を加工して作成」 and, verbatim, 「測量法に基づく国土地理院長承認（複製）R 7JHf 351」 | KSJ terms plus the notice printed on the page. |
| Shinjuku park list | 「出典：新宿区「都市公園・都立公園一覧」（https://catalog.data.metro.tokyo.lg.jp/dataset/t131041d2025000003）を加工して作成」 | Same pattern as the S10 and S03 credits in the Owner answers. The portal's exact credit wording is not yet snapshotted: UNKNOWN until next-gaps action 4. |
| Municipal shelter lists | 「出典：新宿区「指定緊急避難場所一覧」」「出典：豊島区「指定緊急避難場所一覧」」 plus change notice | Same pattern, pending the portal terms snapshot. |
| Tokyo emergency routes | 「出典：東京都建設局「緊急輸送道路」」 plus change notice | Same pattern. |

The existing PLATEAU credit for buildings and roads is unchanged and is shown separately.

## 4. Implementation specs (proposal only)

### 4.1 Shared design: a new `gis context-overlay <station>` command

`context-glb` cannot carry 2D layers (section 1, point 5). Proposed sibling command, reusing `buildContextWindow` / disc selection, `loadFrame`, `stationLocal` (note: it takes latitude first, then longitude, then height; a swapped-axis regression test is mandatory), `parseMergeSpec`, `CONTEXT_ROLE`, `EXPLORER_ROLE_WORDS`, the receipt-in-`docs/gis/context/` pattern, and the provenance sidecar.

- **Config:** add an `overlays` list to `tools/gis/sources/context/<station>.json` (source id, kind, input member). Mesh-coverage logic does not apply; selection is "feature geometry meets a window disc".
- **Output files (store, private):** `out/overlay-<station>-...-<digest>.geojson` and optional `.glb`, plus `.provenance.json`. The GeoJSON holds station-frame metre coordinates `[x, y, z]` (not lon/lat) and a top-level `crs` note of `station-enu frame`.
- **Properties kept:** only `gteki_role: "context"`, `navigation_use: "NOT_FOR_ROUTING"`, `visual_only: true`, `kind`, `source_id`, `source_sha256`, a stable `feature_hash` (sha256 of source feature index plus source hash), and the credit key. **No source attribute is copied**: no names, codes, operators, line names, addresses, heights, areas. If the Owner wants N02 names later it is a separate decision (the CC BY licence covers them, but trademark and "plain factual label" caveats from the rights records apply).
- **GLB form (optional):** merged by kind like `--merge kind`: `ctx_rail_all`, `ctx_station_all`, `ctx_border_all`, `ctx_route_all` as thin flat ribbons (line width 1.5 to 4 m, triangle strips), `ctx_park_all`, `ctx_shelter_all` as small flat markers. Node names must not contain any `EXPLORER_ROLE_WORDS` entry (the readback fails otherwise, as in the existing code). Extras carry the same fields as the GeoJSON plus `window` and `frame_id`.
- **Vertical rule (decided, see sections 5 and 8):** these layers are 2D and are placed at one constant z per station, never draped on DEM or PLATEAU terrain. Shinjuku: symbolic street z = 0 (no datum asserted). Ikebukuro: render z = the street floor `renderElevationM` (32.5), a render anchor and not a TP ground height. The scene side owns any depth offset.
- **Receipt hygiene:** the committed receipt in `docs/gis/context/` lists counts per kind and feature hashes only; it must contain no source value (rule from issue #124).
- **Tests (all layers):**
  1. Geometry-only: a fixture GeoJSON with Japanese-named attributes yields output whose property key set is exactly the allow-list; assert none of the fixture's attribute values or key names appear in the GeoJSON, GLB extras, sidecar or receipt (mirror of the existing "road meshes are geometry only" test in `tools/gis/test/context.test.ts`).
  2. Axis order and frame: a known lon/lat point maps to the expected station-frame metres; swapped input fails.
  3. Window selection against discs, including a line that only crosses a disc edge.
  4. Role/navigation tags and explorer-role-word check; credit text present in extras and receipt.
  5. Hash pinning: the stored source hash is re-verified before use; a changed byte fails.
  6. Determinism: same input gives the same digest and output hash.
  7. Size budget assertion per output (see estimates).
  8. Readback of the GLB (counts and bounds within 1 mm), as for the building and road meshes.

Size note: every output below is tiny (tens of KB); memory is trivial, so none of this needs the heavy-job gating of the building meshes. Estimates are mine, not measured.

### 4.2 Station and railway: `ksj-n02-2025`

- **Inputs:** register source id `ksj-n02-2025` (direct URL on the product page, file `N02-25_GML.zip`, 14.2 MB, nationwide, JGD2011 B,L). Members to use: the Station and RailroadSection layers. The page does not show member file names or the GeoJSON axis order, so both are UNKNOWN until the ZIP listing is read after acquisition; the converter must read the axis order from the file or fail. Also register the product page and `agreement_01.html` as hashed supporting snapshots, and record the 2020-onward CC BY 4.0 line as the licence evidence. Register fields: `license_name` CC BY 4.0 (product-level), `attribution_text` the credit above, `publish_gate` CONDITIONAL (credit and change notice), `routable: false`.
- **Fields kept:** geometry plus `kind` in {`rail_line`, `station_line`}. No class or line codes are kept (not N02_001 either), in line with "no codes" in section 4.1; underground versus at-grade is NOT in N02, so rail ribbons must not be read as showing track level. Say so in the credit page, not in the data.
- **Output:** `rail` and `station` overlay in the station frame for Ikebukuro first (Toshima is the ready station), Shinjuku when unblocked.
- **Credit:** N02-2025 string in section 3.
- **Size:** store 14.2 MB; output about 5 to 30 KB GeoJSON and under 50 KB GLB per station (INFERRED from the PLATEAU copies: 108 and 81 whole-ward railway features at 40 KB and 28 KB, with a window covering a small part of a ward).
- **Extra tests:** feature count inside the window recorded as a hash-bearing count; a check that no feature outside the ward bbox plus margin is read; fallback path test using the PLATEAU copy shape (point stations) if needed.

### 4.3 Border: `ksj-n03-2026`

- **Inputs:** `ksj-n03-2026`, Tokyo file `N03-20260101_13_GML.zip` (12.54 MB), polygon layer; select the ward polygons whose code matches the station's ward and render only their boundary lines inside the window. The edition's approval notice R 7JHf 351 travels in the credit.
- **Fields kept:** geometry plus `kind: ward_boundary`. No city name, no codes.
- **Size:** 1 to 3 KB. **Tests:** as 4.1 plus notice-present test.
- **Priority:** last. One ward outline has little product value, and it shares the GSI-base question with landmark.

### 4.4 Shinjuku park points: `shinjuku-ku-parks-2025` (Shinjuku only)

- **Inputs:** one CSV on the Tokyo open-data host, 28,672 bytes, modified 2026-01-26 (from the earlier research); register with the dataset page as the licence evidence (dataset-level CC BY 4.0, resource licence empty: the B1 reasoning). Columns used: latitude and longitude only. CRS is UNKNOWN (no CRS column): record `crs: UNKNOWN`, add a sanity check that every point lies in the ward bbox and near PLATEAU footprints, and keep `crs_basis` visible in the receipt.
- **Fields kept:** geometry plus `kind: park_point`. No name, address, area or remarks. Area is a number only; do not invent a polygon from it.
- **Credit:** Shinjuku string in section 3.
- **Size:** about 178 rows in the store; window output under 2 KB. **Tests:** as 4.1 plus CSV encoding and header-schema pin.
- **Gate:** next-gaps action 4 (snapshot the ward and portal terms pages) before the first publish.

### 4.5 Municipal shelters (gated; not ready for an implementation PR)

- **Inputs:** `t131041d0000000115` (Shinjuku, CSV 4,096 bytes, modified 2023-04-30) and `t131164d0000000003` (Toshima, CSV 17,408 bytes, modified 2022-08). Shinjuku has latitude and longitude columns. Toshima columns are UNKNOWN.
- **Fields kept:** geometry plus `kind: shelter_point`; no image or image-licence columns, no capacity, no disaster flags, no names.
- **Gate:** read both headers, record row counts and CRS status, snapshot the portal terms. If Toshima has no coordinates, Ikebukuro shelters stay out. Expected window output is under 1 KB.
- **Credit and tests:** as in sections 3 and 4.1.

### 4.6 Tokyo emergency routes (gated; not ready for an implementation PR)

- **Inputs:** `t000014d2000000030`, ZIP `kinkyu_yusou.zip` (1,147,904 bytes, 2024-05-08). Contents UNKNOWN; if the ZIP is a PDF or image map, the verdict falls back to `HOLD_RESTRICTED`. If it is vector, read CRS and axis order from the files.
- **Fields kept:** geometry plus `kind: emergency_route_line`; no road names, route class or document fields.
- **Size:** store about 1.1 MB; window output about 3 to 15 KB. **Credit and tests:** as above.
- **Note:** the N10 product page printing GSI approvals applies to N10, not to this Tokyo dataset; but check the Tokyo ZIP for any third-party base-map notice.

### 4.7 Suggested PR order

1. Register `ksj-n02-2025` plus supporting snapshots, acquire, and the `context-overlay` command with the station and rail kinds (Ikebukuro first).
2. Shinjuku park points (after the portal terms snapshot).
3. Header and ZIP inspections for shelters and Tokyo emergency routes, then their PRs if the inspections pass.
4. N03-2026 border, only if the director keeps it.

Each PR also updates the decisions record (a new dated note recording that B2/B3 supersede the Q5/Q6 defaults for these sources), the rights register entries, the README context section and `docs/gis/HANDOFF.md`.

## 5. Director decisions (總監依 Owner 委託, gteki-80, 2026-10-22)

Questions 1 to 4 below were put to the director, gteki-80, who decided them under the Owner's delegation. The decision was relayed to Lane D in session on 2026-10-22, and this section is its durable record.

1. **Landmark: option (c).** The GSI 国土基本情報 landmark layer is not used. Road risk acceptance (b) does not extend to landmarks, because the scope of approval 令7関公第296号 is unpublished and it is a statutory-procedure question (GSI page <https://www.gsi.go.jp/kibanjoho/kibanjoho40027.html>). The municipal lists in section 7 are used if they prove clean; otherwise no landmark layer ships.
2. **B1 applies to the shelter and Tokyo emergency-route replacements** after a portal-terms snapshot. Two conditions apply: the data must be vector, and the field and ZIP-format checks must pass. If either fails, the layer stays HOLD.
3. **Border: N03-2026 ships, carrying the GSI approval notice printed on its product page.** Unlike landmark, the approval text is public.
4. **Vertical placement:** see section 8. The Ikebukuro value comes from the Ikebukuro visual lead (ikb-visual-ff); the Shinjuku value comes from the Shinjuku visual lead (sjk-visual-71).
5. **Non-commercial layers (P20, P13, N10):** no risk acceptance; they stay held. Toshima parks have no clean source, so Ikebukuro shows no parks unless one is found.
6. **Unknowns that remain unknown:** N02-2025 member file names and GeoJSON axis order; Toshima shelter CSV columns and row count; Tokyo emergency-route ZIP format; the Tokyo portal's exact credit wording; every window feature count; the park CSV CRS; the GSI scope of 令7関公第296号.

## 6. Sources (all accessed 2026-10-22)

- KSJ product pages: N02-2025 <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html>; N03-2025 `.../KsjTmplt-N03-2025.html`; N03-2026 `.../KsjTmplt-N03-2026.html`; N10-2024 `.../KsjTmplt-N10-2024.html`; P20 `.../KsjTmplt-P20.html`; P13 `.../KsjTmplt-P13.html`; P12 `.../KsjTmplt-P12.html`; P35 `.../KsjTmplt-P35.html`; P05-2022 `.../KsjTmplt-P05-2022.html` (all under `https://nlftp.mlit.go.jp/ksj/gml/datalist/`).
- KSJ terms: <https://nlftp.mlit.go.jp/ksj/other/agreement.html>, <https://nlftp.mlit.go.jp/ksj/other/agreement_01.html>, <https://nlftp.mlit.go.jp/ksj/other/agreement_02.html>.
- PLATEAU site policy <https://www.mlit.go.jp/plateau/site-policy/>; G-Spatial package metadata <https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13104-shinjuku-ku-2025> (`license_id: plateau`).
- GSI: <https://www.gsi.go.jp/kibanjoho/kibanjoho40027.html>, <https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html>.
- Tokyo open-data catalogue metadata: `package_show` for `t000014d2000000030` and `t131164d0000000003`; `package_search` for organisation `t131164` (32 datasets, none a park or emergency-route list); `t131164d2025000003` returned 404.
- Repo evidence: `docs/gis/rights/plateau-13104-related.json`, `plateau-13116-related.json`, `docs/gis/poi/plateau-13104-related.json` and `plateau-13116-related.json` field and count inventories, `tools/gis/sources/sources.yaml` (14 direct layer asset entries, `plateau-related-provenance`), `tools/gis/README.md` and `tools/gis/src/context*.ts`.

## 7. Landmark option (c): municipal lists (director decision via Owner delegation)

Decision: the director, acting on the Owner's delegation, chose option (c) of section 5 item 1. The GSI 国土基本情報 landmark layer is not used. Landmarks come from clean municipal lists, or stay out. Research only: nothing here is acquired, implemented or verified. Catalogue metadata (CKAN `package_show`, dataset ids from `package_search` per organisation) and landing/terms pages were read on 2026-10-22. No dataset file was downloaded and no row value is recorded here. Where a column is named below it comes from the earlier header-row read in `docs/gis/research/2026-10-22-shinjuku-poi-next-gaps.md` (items 8 to 10); every other column fact is UNKNOWN.

### 7.1 Test applied ("clean")

1. Dataset-level licence CC BY 4.0 (`license_id: CC-BY-4.0`, title 表示（CC BY）).
2. Resource licence fields present or empty: recorded either way (all empty or absent below).
3. WGS84 lat/lon columns or another stated CRS.
4. Coverage overlapping the roughly 300 m station windows (Ikebukuro, Shinjuku).
5. No third-party restriction note.

Item 4 cannot be answered from the catalogue: `datastore_active` is false for every resource below, so the CKAN datastore exposes no row counts or columns, and counts inside a station window are UNKNOWN until the files are acquired and read after the freeze.

### 7.2 Findings common to all candidates

- Every dataset below has `license_id: CC-BY-4.0`. The dataset notes carry no third-party or usage-restriction statement (Shinjuku notes are one short line; Toshima notes only say the ward publishes the data). Extras hold only an update-frequency key.
- No resource has its own licence field (absent in every `package_show` resource object). This is the same dataset-level-only shape the Owner accepted for S03 (Q3) and that B1 extends to non-KSJ sources; it is recorded here, not decided here.
- Portal terms URL, as linked from the catalogue's API-spec pages (Toshima): <https://portal.data.metro.tokyo.lg.jp/terms/> (labelled Terms of Service). On 2026-10-22 a fetch of that URL returned only a "site closed, please wait" notice, and a fetch of <https://catalog.data.metro.tokyo.lg.jp/terms> and of the dataset landing pages returned HTTP 403; so the terms text and landing pages could not be re-read today. The repo already holds an earlier acquisition of the portal terms with the S10 catalogue (`docs/gis/acquisitions/tokyo-s10-catalog.json`, `docs/gis/research/poi-rights-s10-s03-related.md`). A fresh hash-verified snapshot is still needed for these datasets (next-gaps action 4).
- None of these datasets states a CRS in the catalogue metadata (the Toshima spec pages say "not stated"). The Digital Agency 自治体標準オープンデータセット is the evident schema set for the Shinjuku files (tag 自治体標準オープンデータセット; definition tables A, C and D at <https://www.digital.go.jp/resources/open_data/municipal-standard-open-dataset> via the page <https://www.digital.go.jp/resources/open_data/municipal-standard-data-set-test>, accessed 2026-10-22). The definition workbook was not machine-readable in this lane, so the schema's coordinate-system wording is UNKNOWN and is not assumed.
- Shinjuku files carry image and image-licence columns (per the earlier header read). Those columns, descriptions, URLs, phone numbers and hours must not be copied (same exclusions as the overlay spec in section 4.1 above and section 4.4 above). The images are a possible third-party-rights area; they are simply excluded.
- A municipal facility list is a facility point layer, not a nameless GSI landmark layer. Per the overlay spec in the earlier section 4.1, the overlay keeps geometry only, so the output would be unlabelled points. Ward lists also stop at the ward boundary; whether a station window crosses into another ward is UNKNOWN.

### 7.3 Per-dataset table

Sizes are CKAN resource `size` (bytes). Dates are resource `created` / `last_modified` and dataset `metadata_modified`.

| Dataset id | Title (catalogue) | `license_id` | Resource (format, size, URL) | Resource licence field | Columns (names only) | CRS / lat-lon | Resource dates; dataset `metadata_modified` | Coverage in station window | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `t131041d0000000113` | 新宿区の公共施設情報 (Shinjuku 公共施設; 267 data rows per the earlier header read) | CC-BY-4.0 | CSV, 97,280, <https://www.city.shinjuku.lg.jp/content/000399965.csv> | Absent | Earlier header read: an ID, name, address parts, latitude, longitude, altitude type and value, hours, accessibility flags, description, image and image-licence columns | Lat and lon columns present; no CRS column; CRS value UNKNOWN | 2023-04-30 / 2023-04-30; 2025-12-12 | UNKNOWN (ward-wide list; per-window count not computed) | `CANDIDATE_CLEAN`, pending the terms snapshot and a header and CRS check. Currency is 2023. |
| `t131041d0000000131` | 新宿区の観光ポイント (Shinjuku 観光ポイント; 6 data rows) | CC-BY-4.0 | CSV, 3,072, <https://www.city.shinjuku.lg.jp/content/000399980.csv> | Absent | Earlier header read: a per-record CRS name and code, latitude, longitude, description and image columns | Lat and lon columns plus a per-record CRS declaration (declared value not read: UNKNOWN) | 2023-04-30 / 2023-04-30; 2025-12-12 | UNKNOWN | `CANDIDATE_CLEAN` on the checks, pending the terms snapshot and header check; value is low (6 rows) and may add nothing inside a window. |
| `t131041d0000000114` | 新宿区の文化財一覧 (Shinjuku 文化財; not in the brief, found next to the others) | CC-BY-4.0 | CSV, 294,912, <https://www.city.shinjuku.lg.jp/content/000399966.csv> | Absent | UNKNOWN (not read) | UNKNOWN whether coordinates exist | 2023-04-30 / 2023-04-30; 2025-12-12 | UNKNOWN | `UNKNOWN` (licence-clean; coordinates unseen). Optional: include in the header check. |
| `t131041d0000000064` | 新宿区の公共施設情報, resource covering health centres and similar (older duplicate title; not in the brief) | CC-BY-4.0 | RDF 23,552 (<https://data.odp.jig.jp/rdf/jp/tokyo/shinjuku/772.rdf>) and CSV 3,072 (<https://data.odp.jig.jp/viewcsv/jp/tokyo/shinjuku/772.csv>), both on a third-party host | Absent on both | UNKNOWN | UNKNOWN | 2017-02-27 / 2022-04-06; 2025-12-12 | UNKNOWN | `UNKNOWN`; not pursued (health-centre subset, stale, hosted by a third party, 3,072 bytes). Do not confuse with `t131041d0000000113`, which is the 267-row list. |
| `t131164d0000000005` | 観光施設一覧 (Toshima 観光施設) | CC-BY-4.0 | CSV, 4,096, <https://www.opendata.metro.tokyo.lg.jp/toyoshima/R4_tourism.csv> | Absent | UNKNOWN (catalogue spec page lists none) | UNKNOWN (CRS "not stated"; lat and lon columns unseen) | 2022-04-12 / 2022-08-21; 2025-12-12 | UNKNOWN (4 KB, so few rows; count INFERRED to be small, not measured) | `UNKNOWN` (licence-clean; columns and CRS unseen). |
| `t131164d0000000007` | 文化財一覧（国もしくは地方公共団体が指定、登録、選定等行った文化財の一覧）(Toshima 文化財) | CC-BY-4.0 | CSV, 79,872, <https://www.opendata.metro.tokyo.lg.jp/toyoshima/R4_cultural_property.csv> | Absent | UNKNOWN | UNKNOWN (CRS "not stated") | 2022-04-12 / 2022-08-21; 2025-12-12 | UNKNOWN | `UNKNOWN` (licence-clean; columns and CRS unseen). |
| `t131164d0000000010` | 公共施設一覧 (Toshima 公共施設) | CC-BY-4.0 | CSV, 78,848, <https://www.opendata.metro.tokyo.lg.jp/toyoshima/R4_public_facility.csv> | Absent | UNKNOWN | UNKNOWN (CRS "not stated") | 2022-04-12 / 2022-08-21; 2025-12-12 | UNKNOWN | `UNKNOWN` (licence-clean; columns and CRS unseen). |

No dataset is `NOT_CLEAN` on licence grounds: all seven rows carry dataset-level CC BY 4.0 with no stated third-party note. This rests on CKAN metadata only; the landing pages returned 403 and the portal terms page was closed, so the absence of a third-party note is unconfirmed until the terms snapshot. Five of them are `UNKNOWN` only because the column and CRS evidence is missing, not because anything restrictive was found. Nothing found so far changes the earlier statement that the Toshima ward has no park list.

### 7.4 Consequence for the landmark layer

- Shinjuku: a landmark-style facility point layer is feasible from `t131041d0000000113` alone (and `t131041d0000000131` if the director wants the 6 tourism points), conditional on the steps in (c).5.
- Ikebukuro (Toshima): no Toshima list has any confirmed coordinate column. Until the header check passes, Ikebukuro has no landmark layer. If none of the three Toshima files has coordinates, Ikebukuro landmarks stay out (option (c) fallback: "otherwise landmarks stay out").
- Credit pattern, pending the terms snapshot: 「出典：新宿区「公共施設情報」」 and 「出典：豊島区「公共施設一覧」」 plus the change notice, same shape as section 3. Not final.
- Output stays the form of the earlier section 4.1: geometry plus `kind: landmark_point` and the allow-listed hash fields only; no name, address, description, URL, image or flag column.

### 7.5 Next acquisition steps (after the host freeze ends, 19:30 JST)

1. Snapshot the terms and licence pages as hashed supporting documents: <https://portal.data.metro.tokyo.lg.jp/terms/> (retry; it served a closed-site notice on 2026-10-22) and <https://creativecommons.org/licenses/by/4.0/deed.ja> (already held, reuse the stored hash).
2. Snapshot the CKAN metadata, one per dataset, as supporting documents: `https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=<id>` for `t131041d0000000113`, `t131041d0000000131`, `t131041d0000000114`, `t131164d0000000005`, `t131164d0000000007`, `t131164d0000000010`. Skip `t131041d0000000064`.
3. Register and acquire the six CSV resources (URLs in the table) with `gis acquire`, one source each, with the catalogue resource id and expected size as cross-checks; declare each expected final URL because the runner allows no redirects. The Shinjuku files are on `www.city.shinjuku.lg.jp`, the Toshima files on `www.opendata.metro.tokyo.lg.jp`; Toshima hosts have no other known fetch problem but were not tested.
4. Read each header only. Record in the repo: column names, row counts, the CRS column or its absence, the declared CRS value for `t131041d0000000131`, and the count of rows inside each station window as a number only (Ikebukuro and Shinjuku, using the earlier section 4.1 frame code and a swapped-axis check). Commit counts, hashes and column names only, never a row value.
5. Per dataset, move to `CLEAN` if: the terms snapshot matches the CC BY statement, lat/lon columns exist, the CRS is stated or a sanity check against the ward bbox and PLATEAU footprints passes with `crs: UNKNOWN` recorded, and the window count is above zero. Otherwise `NOT_CLEAN` (reason: no coordinates, or no window coverage) and the landmark layer for that station stays out.
6. B1 coverage is decided: the director chose option (c), using the lists if they prove clean (section 5, decision 1). The remaining gate is evidence (terms snapshot, header, CRS and window count), not a further question.

Sources (accessed 2026-10-22): `package_search` for organisations `t131041` (137 datasets) and `t131164` (32 datasets) and `package_show` for each id above at <https://catalog.data.metro.tokyo.lg.jp/api/3/action/>; spec pages <https://spec.api.metro.tokyo.lg.jp/spec/t131164d0000000010-b1a0680aebbc5d8b102d9705f880ce7d-0?lang=en> and <https://spec.api.metro.tokyo.lg.jp/spec/t131164d0000000007-83def088cb55c24a0cae4251717412d7-0?lang=en>; <https://www.digital.go.jp/resources/open_data/municipal-standard-data-set-test>; the portal terms URL above.

## 8. Vertical placement of the 2D overlays (station leads, 2026-10-22)

Neither station drapes the overlays on DEM or PLATEAU terrain per vertex. A source ground height may be kept as provenance only. The scene side owns any depth offset, draw order and z-fight handling, so GIS bakes no lift.

| Station | z in the station frame | Recorded as | Evidence |
| --- | --- | --- | --- |
| Shinjuku (`shinjuku-station-enu-v0`) | 0 | "symbolic street z = 0 (no datum asserted)" | `stations/shinjuku/tools/import-surface.ts` height note; `scene/surface-data.ts`. Surface and context buildings are both flattened to street z = 0. |
| Ikebukuro | 32.5 (constant) | "render z = street floor renderElevationM", not TP ground | `stations/ikebukuro/gteki/station.json`, ordinal-0 street floor `renderElevationM`. That floor has `elevationM: null` and `elevationSource: "unknown"`, so the value is a render anchor and not a surveyed height. |
