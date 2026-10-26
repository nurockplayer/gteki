# S03 Check B — independent control-point scouting (desk only)

**Written:** 2026-10-26 18:30 JST. **Result: 0 eligible measured pairs.** The permitted Metro exit list has names but no coordinates; PLATEAU and KSJ have geometry but no exact station-name match to an S03 level feature or S03-derived POI. There is insufficient new independent control to set a residual threshold or clear `CHECK_B_RESIDUAL_UNVERIFIED`.

This is evidence for the director, not a ruling. The S03 HOLD remains. [#547](https://github.com/nurockplayer/gteki/pull/547) verifies the v5_nav frame's internal consistency only; absolute accuracy and station alignment remain open. No source, geometry, coordinate, route, correction or NOTICE entry is added to the product.

## 1. Rights and candidate inventory

Rights follow the dispatch's OD-34 data-lane rules and the [line gap table and PENDING list](gap-table-2026-10-25.md). PLATEAU/KSJ conditions are recorded in [`docs/gis/rights/README.md`](../../gis/rights/README.md) and [B2](../../gis/research/2026-10-22-shinjuku-poi-next-gaps.md). Earlier product-publication refusals are not upgraded here: this brief authorizes desk control scouting, with credit, only.

| Candidate | Rights class and basis | Printed coordinates / geometry and datum | URL and retrieval / inspection time | Result |
| --- | --- | --- | --- | --- |
| Tokyo Metro `exit.json` | **Usable, facts only**, OD-34 §2; cite Wayback | **No coordinates or geometry** in any of 1,042 rows; no datum field | [Wayback exit data](http://web.archive.org/web/20260908151007/https://www.tokyometro.jp/station/exit.json), retrieved 2026-10-26 18:25:34 JST | **GAP: missing positions.** 新宿 28 rows, 新宿三丁目 23, 西新宿 17 |
| PLATEAU 13104 2025 related station layer | **CC BY with conditions**; layer verdict `CLEARED_WITH_CONDITIONS`, KSJ N02-2024 origin, PLATEAU PDL / CC BY alternative; credit and change notice | **48 Point features**, 2-element `geometry.coordinates`; named stations, no exit/gate names. No `crs` member or datum declaration in this file; upstream N02-2024 provenance is recorded, not a file-level datum declaration | [Station GeoJSON](https://assets.cms.plateau.reearth.io/assets/7c/5ce191-f5a8-4aac-a48a-df1ea472c80a/13104_shinjuku-ku_pref_2025_station.geojson); stored acquisition 2026-10-21 09:14:04 JST; inspected 2026-10-26 18:28 JST | **GAP: no exact S03 feature/POI name match.** Already in store, not downloaded again |
| PLATEAU 13104 2025 related railway layer | **CC BY with conditions**, same provenance and credit basis as station layer | **108 features:** 103 LineString, 5 MultiLineString; `geometry.coordinates`; line/operator attributes, no station, exit or gate-name field. No `crs` member or datum declaration | [Railway GeoJSON](https://assets.cms.plateau.reearth.io/assets/6f/333acd-650d-45d6-9a0b-f448d77ec9f4/13104_shinjuku-ku_pref_2025_railway.geojson); stored acquisition 2026-10-21 09:14:04 JST; inspected 2026-10-26 18:28 JST | **GAP: no named control point.** Already in store, not downloaded again |
| KSJ N02-2025 station geometry | **CC BY 4.0 with conditions**, product page and brief's B2 authorization; credit/change notice | **10,234 LineString station features nationwide**, not points or polygons. `geometry.coordinates`, station name `N02_005`, line `N02_003`, operator `N02_004`, station/group codes `N02_005c`/`N02_005g`. GeoJSON declares `urn:ogc:def:crs:EPSG::6668`; `.prj` prints JGD2011/GRS80. Product page prints `JGD2011 / （B, L）` and shape 「線」 | [Product page](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html), retrieved 2026-10-26 18:26:55 JST; [ZIP](https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip), stored acquisition 2026-10-22 21:04:22 JST, inspected 2026-10-26 18:28 JST | **GAP: no exact S03 feature/POI station-name match.** ZIP already in store, not downloaded again |
| KSJ N02-2025 railway geometry | **CC BY 4.0 with conditions**, same product/ZIP as above | **21,933 LineString features nationwide**; `geometry.coordinates`, `N02_001`–`N02_004`; no station/exit/gate name. Same CRS declaration | Same KSJ URLs and times as above | **GAP: no named control point.** No nearest-line pairing |
| Metro archived station-page map / ODPT proxy lead | Metro HTML factual labels are **facts only** under OD-34 §2. Underlying coordinate-response licence/provenance **UNKNOWN** in the inspected material; no response used | Archived `metromap.js` references `geo:lat`, `geo:long`, `dc:title`, `odpt:exit` and `ug:Poi`. Those are code field references, **not a retrieved Shinjuku exit-coordinate dataset**; datum not printed there | [Station page capture](http://web.archive.org/web/20260906210441/https://www.tokyometro.jp/station/shinjuku/index.html), retrieved 2026-10-26 18:28:38 JST; [map script capture](http://web.archive.org/web/20260907204125js_/https://www.tokyometro.jp/library/station/js/metromap.js), retrieved 2026-10-26 18:29:09 JST | **UNKNOWN / GAP.** Script obtains coordinates by POST to `/library/common/lib/opendata_tunnel.php`; no proxy/API request, login, key use or third-party map request was made |
| MLIT 新宿駅周辺屋内地図 R2 | Metadata prints 政府標準利用規約; **login-gated**, excluded by this brief | File contents and coordinate fields **not inspected** | [Catalog](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2); **not fetched this pass**; prior evidence in [reason-code note §4](s03-reason-codes-desk-2026-10-26.md#4-geospatialjp--what-the-directors-example-turns-up) | **GAP: login required.** No file GET |
| Toei CSV station facts | **Attributes only, never placing**, [#501 ruling](https://github.com/nurockplayer/gteki/issues/501#issuecomment-6394872033) | Any position fields are outside authorized use | [Rights/mapping note](../../gis/research/2026-10-25-toei-csv-rights-and-mapping.md); not fetched this pass | **Excluded as control**, not a licence ban on factual attributes |

No GSI tiles, 基盤地図情報, third-party map, JR East, Keio or Odakyu site was used. No other uncovered source was treated as usable. The KSJ page mentions GSI material among its upstream sources; this pass uses only the specifically authorized N02 product, never the GSI originals.

**Independence:** the PLATEAU station and railway layers trace to **KSJ N02-2024**, while the direct ZIP is **N02-2025**. These are related editions of one source family, not two independent controls. Neither adds a measured S03 control in this pass. The old Toei E27 overlap is a separate earlier comparison, not a new control measurement here.

## 2. Printed-name matching and near-misses

S03 ZIP identity was verified before reading: SHA-256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31`. Python `zipfile` read members in memory; member names were decoded from ZIP CP437 bytes as Shift_JIS when the UTF-8 flag was absent. All 11 `geojson-level-geom-*` members were inspected: 15,556 features, **532 distinct non-empty `display_name` values**. The checked-in POI file has **45 S03-derived POIs**. Comparison uses the complete printed string, without dropping 「駅」, selecting a nearest feature, or converting a station name into a gate/platform name.

### Matched pairs with distances

| Eligible S03 feature name | Independent control name | Horizontal distance (m) |
| --- | --- | ---: |
| None | None | N/A |

There is no pair for which both a shared feature identity and a usable control position were established. Consequently no distance, centroid, mean translation or residual was calculated. No coordinate was copied into this report.

### Names that overlap, but cannot be measured

Metro `exit.json` prints only these top-level fields: `station_base_name`, `exit_no`, `elevator`, `close`, `usage_limit`, `facilities`, `update`; `facilities` has `ja`/`en` text. There is no coordinate field, datum, gate field or geometry. The archived capture is **2026-09-09 00:10:07 JST** (the timestamp embedded in the Wayback URL is UTC).

| Metro row group | Exact `exit_no` string also present as S03 `display_name` | Interpretation |
| --- | --- | --- |
| 新宿 (`shinjuku`, M08), 28 rows | **25 labels:** A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16, A17, A18, B5, B6, B7, B9, B10, B11, B13, B14, B15, B16, B17, B18 | Label overlap only; **0 positioned Metro controls**. B8, B12a and B12b have no exact S03 `display_name` match |
| 新宿三丁目 (`shinjuku-sanchome`), 23 rows | A1, A2, B4, B5, B9, C7, C8 | **0 positioned controls**. A1/A2/B4/B5/C7/C8 also occur on S03 4F polygons; identical short strings alone do not identify the same exit |
| 西新宿 (`nishi-shinjuku`), 17 rows | 1, 2, A2, A3, A7, C8 | **0 positioned controls**. Numeric labels repeat across S03 features/levels; no proximity-based identity was assigned |

Several M08 label strings occur on multiple S03 levels; B6 also labels a 4F polygon. These were not collapsed to a preferred position. Shared exit labels across Metro station row groups were not counted twice as independent points. `facilities` lists nearby destinations; it supplies neither their positions nor an entrance tie.

### Geometry candidates with no matching S03 feature name

| Source printed station name | Source geometry | Why not a control pair |
| --- | --- | --- |
| PLATEAU 「新宿駅」「新宿三丁目駅」「西新宿駅」 | Station Points, with separate line/operator rows | No exact `display_name` or S03-derived POI name match. The drawing title 「新宿駅」 is map metadata, not a positioned station feature; it does not choose among the operator-specific station points |
| N02 「新宿」「新宿三丁目」「西新宿」 | Station LineStrings, with separate line/operator rows | No exact `display_name` or S03-derived POI name match. A line midpoint cannot substitute for a named S03 gate or platform |
| PLATEAU / N02 railway line names | Railway lines | Line identity does not identify a particular gate, exit or station control point |

These are **semantic near-misses**, not nearest-position matches; no spatial nearest-neighbour search was used to manufacture pairs. In particular, S03 「新宿駅西口交番」 is not the station 「新宿駅」.

## 3. Statistics and recommendation

| Statistic, eligible new independent pairs only | Result |
| --- | ---: |
| n | **0** |
| Median horizontal distance (m) | **N/A** |
| p90 horizontal distance (m) | **N/A** |
| Maximum horizontal distance (m) | **N/A** |
| Mean east offset, S03 minus control (m) | **N/A** |
| Mean north offset, S03 minus control (m) | **N/A** |

**Recommendation:** retain `CHECK_B_RESIDUAL_UNVERIFIED`. This pass supports a finding of **insufficient eligible independent control**, not a numeric PASS or FAIL. **No metre threshold is supported by n = 0.** In particular, neither 5 m nor the earlier E27 residual distribution can be promoted to an independently verified absolute-accuracy threshold by this scouting result.

For context only, the existing [Check B receipt](../../gis/s03/transform-check-92b28d4d3986c27d8203.json) reports 15 reciprocal E27 pairs within 5 m: median 1.854 m, p90 3.367 m, max 3.418 m; mean S03-minus-E27 east +0.934 m and north +0.127 m, **not applied**. Those are the prior source-overlap numbers, not this pass's statistics and not survey control.

The next data requirement is a permitted coordinate-bearing source that prints the same identifiable S03 feature names. The Metro proxy is an unresolved lead, not a verified dataset. MLIT R2 stays a login GAP under the current brief. A director ruling and any source-access/rights disposition remain with the lead; this doc changes no gate.

## 4. Acquisition identity and validation

The private store was checked before downloading PLATEAU or N02. All four existing files matched their acquisition-record SHA-256 values when read in OrbStack:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| S03 ZIP | 2,317,035 | `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31` |
| PLATEAU station GeoJSON | 17,894 | `7e7071807bb493ce3c9eb2ea0b192d817b1a64b93f693e456f81c9589446d929` |
| PLATEAU railway GeoJSON | 58,700 | `eb5d25e83fa3955bdf48d15f222dda3989e524289d8be4c007451e13a5c27f3a` |
| N02-2025 ZIP | 14,903,774 | `aaf76af133b2e771e538fabc4646d2e443dc1d5a67b221382a28d744e706cc9f` |
| Metro Wayback exit JSON | 445,757 | `8524c81cd0d54f96bac3d71251c06f66477ea478114c73d0d2118e43c17f973d` |

The N02 station member is `N02-25_GML/UTF-8/N02-25_Station.geojson`; the railway member is `N02-25_GML/UTF-8/N02-25_RailroadSection.geojson`. No coordinate tuples, S03 transforms or derived positions are published. The S03 Mercator/dev reference scripts were read only; their coordinate-printing examples were not run.

The schema/name inventory ran as `orb-test --heavy --memory 1g --cpus 1 --env GTEKI_RAW_SHINJUKU=/w/.review/raw/shinjuku -- python3 -I .review/raw/shinjuku/checkb/scout.py`, completing 2026-10-26 18:29 JST. An initial inventory run stopped on a filename-parser error (floor names are strings such as `1F`, not numeric ids); that scratch script was corrected before the successful run. No product tests are needed for these two documentation changes. Oracle is assigned to the lead by the brief and was not run by this Codex worker.

A separate scratch validation under the same OrbStack/Python flags passed at 2026-10-26 18:34 JST: five file hashes, S03 member/feature/name/POI counts, PLATEAU and N02 geometry counts, no exact station-name match against either S03 names or S03-derived POI names, Metro schema/row counts and 25 M08 label overlaps. The report was also checked for Shinjuku coordinate literals. Neither scratch script is shipped.

## 5. Fetch log

All request times below are **JST**. Default curl User-Agent; no override or browser impersonation. Requests were sequential, with at least 0.7 s after the preceding response to the same host; redirect hops count individually. **10 requests of 60**, no automated retry. Fetch bodies were kept in a `mktemp -d` under `/private/tmp`; temporary raw copies for OrbStack were under `.review/raw/shinjuku/checkb`. These scratch files are deleted after verification and handoff preparation; no reusable cache is introduced.

| # | Requested at (JST) | URL | HTTP / bytes | Disposition |
| ---: | --- | --- | --- | --- |
| 1 | 2026-10-26 18:25:34 JST | `http://web.archive.org/web/20260908151007/https://www.tokyometro.jp/station/exit.json` | 200 / 445,757 | Cited Metro basis; SHA-256 above |
| 2 | 2026-10-26 18:26:55 JST | `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html` | 200 / 54,969 | Product licence / CRS / geometry metadata; SHA-256 `5999671eaef868c1061ccb4c65ace717db70f72508cf4cc23c137b365b15d2ca` |
| 3 | 2026-10-26 18:26:58 JST | `https://www.tokyometro.jp/station/exit.json` | 200 / 445,757 | **Log only, not cited or used for controls.** SHA-256 `e05abf041cce32e0efac843f3c67169b03634f45fa02614112700c57eb51693a`; differs from capture |
| 4 | 2026-10-26 18:26:58 JST | `http://web.archive.org/web/20260908151007/https://www.tokyometro.jp/station/shinjuku/exit/index.html` | 404 / 4,668 | **GAP**: guessed exit-page capture unavailable; no retry |
| 5 | 2026-10-26 18:28:36 JST | `http://web.archive.org/web/20260908151007/https://www.tokyometro.jp/station/shinjuku/index.html` | 302 / 0 | Redirect to #6 |
| 6 | 2026-10-26 18:28:38 JST | `http://web.archive.org/web/20260906210441/https://www.tokyometro.jp/station/shinjuku/index.html` | 200 / 91,835 | Capture 2026-09-07 06:04:41 JST; inspected links/scripts as text only |
| 7 | 2026-10-26 18:29:07 JST | `http://web.archive.org/web/20260906210441js_/https://www.tokyometro.jp/library/station/js/metromap.js` | 302 / 0 | Redirect to #8 |
| 8 | 2026-10-26 18:29:09 JST | `http://web.archive.org/web/20260907204125js_/https://www.tokyometro.jp/library/station/js/metromap.js` | 200 / 35,106 | Capture 2026-09-08 05:41:25 JST; coordinate-field references / proxy lead only |
| 9 | 2026-10-26 18:29:13 JST | `http://web.archive.org/web/20260906210441js_/https://www.tokyometro.jp/library/station/js/yardmap_v3.js` | 302 / 0 | Redirect to #10 |
| 10 | 2026-10-26 18:29:16 JST | `http://web.archive.org/web/20260907204125js_/https://www.tokyometro.jp/library/station/js/yardmap_v3.js` | 200 / 5,316 | Same capture time as #8; tab/session-state code, no exit-coordinate dataset |

**Blocked / GAPs:** the shell tool rejected the initial force-delete cleanup command; explicit file-by-file deletion of the seven task-owned scratch/raw copies succeeded instead. No outstanding tool-permission blocker remains. No 403 or challenge page was encountered in these ten requests. Missing Metro coordinates, the unavailable exit-page capture, absent S03 station-name matches, the unresolved ODPT response and the unrequested login-gated MLIT files prevent new residual measurements. No source-access restriction was bypassed.

**Credits and processing notice:** 出典：東京都都市整備局「新宿駅周辺の施設情報等」; 東京メトロ（Wayback capture cited above）; 国土交通省 Project PLATEAU「3D都市モデル 新宿区（2025年度）」関連データ（データ作成：株式会社パスコ、station データ変換：PLATEAU CMS）、原典：国土交通省「国土数値情報（鉄道・2024年）」; 国土交通省「国土数値情報（鉄道・2025年）」。CC BY 4.0 / PLATEAU PDL with CC BY alternative as recorded in the rights inventory ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [PLATEAU policy](https://www.mlit.go.jp/plateau/site-policy/)). GTEki がスキーマ・名称の照合と集計を実施。No coordinate or geometry redistribution.
