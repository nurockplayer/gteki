# Shinjuku first-slice route evidence card: Oedo Line platform → B1 north ticket gates

- **Task:** data-research-05, 2-week L2 plan week 1 item 1 (Issues [#5](https://github.com/nurockplayer/gteki/issues/5), [#165](https://github.com/nurockplayer/gteki/issues/165)).
- **Checked:** 2026-10-25, on `386beb9f` (`origin/main`) plus this docs branch. Data read: `stations/shinjuku/gteki/{station,graph,pois}.json`, sha256 `515baed2…`, `06d61931…`, `cc4f39fc…` (the graph files last changed in `010f1c5d`, #463).
- **Status:** the graph path is fully source-backed (every edge and node cites a resolvable source). It is **not** a current public-navigation claim: rights rest on an Owner override, opening hours are UNKNOWN, and heights and accessibility are not measured. Nothing here is a rights PASS or an acceptance sign-off.
- **No station data was changed.** This card is the record of what the committed data and router actually say.

## 1. The choice

| Role | POI | Name (en) | Floor | Connector node |
| --- | --- | --- | --- | --- |
| Start landmark | `poi:platform:oedo` | Toei Oedo Line platform (Shinjuku Station, E27) | B6 (`toei-nwd-m6`) | 21 candidate nodes; the router chose `n:e31954cbec9e4b1cac647326d5bcb4e4` |
| Destination | `poi:gate:2` | Ticket gates (B1, north side) | B1 (`toei-nwd-m1`) | `n:d9cd1bb0f76a440d83010e5b9f63ad65` |

Why this pair:

- It is the station's own anchor pair: the platform is the search top hit for 新宿 / Shinjuku / E27 / 大江戸線, and a ticket gate is a bounded, paid↔free destination inside the E27 extent (`docs/stations/shinjuku/search-expected.md`).
- It is short (136.5 m of source link length, 14 edges, two escalators, one gate), the router already returns it, and every edge is a published E27 NWD link.
- It includes the fare boundary and two level changes, so the card exercises the parts of the stack a first slice needs (gate aisle, escalator direction, floor labels) without depending on a street exit whose current operating status cannot be established from the sources (§6, G-08).
- The destination is indoor. Street context (PLATEAU surface) is not part of this route's evidence, so #161's credit-wording question does not attach to this card.

The alternative considered and not chosen was `poi:platform:oedo → poi:exit:1` (the route quoted in `docs/stations/shinjuku/README.md` G2: 194 m, 4 floor changes, 23 edges). It is the same source-backed graph, but its destination's operating status is unknown: Toei reports closures affecting official exits 1 and 2 (checked 2026-10-22), E27 carries no official exit numbers, and so that notice has never been mapped to `poi:exit:1` (§6, G-08). That makes it a weaker *first* slice, not a weaker route.

## 2. The path the router returns

Command (repo root, single process; `@gteki/cli` route script, the same `routeBetween` the web explorer uses):

```bash
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:platform:oedo poi:gate:2 --from-poi --goal-poi --today 2026-10-25
```

Observed result (exact values):

| Field | Value |
| --- | --- |
| `ok` | true |
| `steps` / nodes | 14 edges / 15 nodes |
| `totalLengthM` | 136.5 (sum of the source links' `distance` attribute; see G-04) |
| `estimatedSeconds` | 146.55 (router paces: walk 1.2 m/s, escalator 0.75 m/s, 45 s per lift; a model, not a measurement) |
| `floorChanges` | 2 (B6→B3, B3→B1) |
| `crossesFareBoundary` | true (one gate edge, `e:3763bee44e4740ac86216e99e212f8d1`) |
| `unknowns` | `hours` on 14 of 14 edges |
| `stale` | false at `today=2026-10-25` (`staleAfterDays` default 730) |
| `evidenceCheckedDate` | 2026-10-20 |
| `oldestSourceDate` | 2026-09-17 |
| `sourceIds` | `mlit-hokonavi-e27-nwd`, `mlit-hokonavi-e27-stationmap` |
| `expiredSourceIds`, `undatedSourceIds` | none |
| `operatorIds` | `["toei"]` |
| `synthetic` | false |

Narration (ja): 出発 / エスカレーターで上へ・地下3階へ / 約6m 直進 / 左へ曲がり約21m。約4m先の分岐はそのまま直進 / 右へ曲がり、さらに右へ曲がり約9m / エスカレーターで上へ・地下1階へ / 左へ曲がり約9m / 左へ曲がり約8m / 右へ曲がり約8m / 改札を通過 / 目的地に到着. The en narration has the same 11 instructions.

### 2.1 Nodes, in traversal order

Every node's `sourceRefs` is one `{sourceId: "mlit-hokonavi-e27-nwd", featureId}` reference whose `featureId` equals the node id suffix; all 15 resolve to `station.json → sources` (checked in the run below).

| # | Node id | Floor | Kind |
| --- | --- | --- | --- |
| 0 | `n:e31954cbec9e4b1cac647326d5bcb4e4` | B6 | platform |
| 1 | `n:f05b059c1a26438aa642be9782e20e89` | B6 | escalator_end |
| 2 | `n:c99810e72aa449b284a4d630880a7aa9` | B3 | escalator_end |
| 3 | `n:c2d390021c29442f86dda359e503febd` | B3 | junction |
| 4 | `n:6bd46cd107a4491bba3469e8f51f9900` | B3 | junction |
| 5 | `n:180ce956ffb7470b9cc42ec7e75255d4` | B3 | junction |
| 6 | `n:453ea111f1524cef8f3ac139bbf2e26b` | B3 | junction |
| 7 | `n:5d2a3fac668d4a068a98e0b9e3aeaf5d` | B3 | escalator_end |
| 8 | `n:57e00b46b8804e7f95bd92ba9a20fb7b` | B1 | escalator_end |
| 9 | `n:2d2bc35b4043433da2914b2705ef69bb` | B1 | junction |
| 10 | `n:1452afaefe044bc98bdd66b7a746842c` | B1 | junction |
| 11 | `n:94efe2c9901d474c8369e21de5b8b16c` | B1 | junction |
| 12 | `n:1dce5642e8164d59a63976316f18b8a0` | B1 | junction |
| 13 | `n:c8d8d8290e5b419bafc8582997846052` | B1 | ticket_gate (paid side of the gate line) |
| 14 | `n:d9cd1bb0f76a440d83010e5b9f63ad65` | B1 | ticket_gate (destination; `poi:gate:2` connector) |

The destination node is the same node as `poi:gate:2`'s only connector, so the route ends exactly at the gate POI's mapped position, on its free side (`poi:gate:2.paid` = false).

### 2.2 Edges, with per-edge evidence

All 14 edges are `verification: "verified"`, `closed: false`, `hours: null`, `maint_date: 2025-09-19`, and carry both a `geometryEvidence` and an `accessEvidence` block. In every row the geometry source is **S1** and the access sources are **S1 + S2** (§3); all resolve (assertion run in §7). "One-way" is the NWD `direction = 2` value (`edge.direction: "forward"`); the router may only traverse it in the stored direction.

| # | Edge id | Mode | Length | Floors | Paid | Fare boundary | Wheelchair | Steps | One-way | Geometry evidence method | Access evidence method | Link attributes (route_type / width m / lev_diff / roof) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `e:451d2ec8f7c84ec5ba9d95591af20721` | walk | 3.4 m | B6→B6 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 2 / 1 / 2 |
| 2 | `e:2768d162a2d648cf9df2fc76ca89257f` | escalator | 35.5 m | B6→B3 | true | false | false | true | yes | space-category:B023 (route_type=6) | nwd-link-present; fare: GSI `toll` both ends | 6 / 2 / 5 / 2 |
| 3 | `e:9609e8988c7f4ca8a2842bbc882d036e` | walk | 5.8 m | B3→B3 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 4 | `e:291d449b63224d49ae45000c2c16b7ca` | walk | 3.8 m | B3→B3 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 5 | `e:55ef6f47ff854c04b6c1a8800ad16e12` | walk | 16.8 m | B3→B3 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 6 | `e:a4ed9fc953984c52a914f0cbe73cd318` | walk | 4.8 m | B3→B3 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 7 | `e:525935a8223f47698df67818a2af4362` | walk | 9.0 m | B3→B3 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 8 | `e:2692fe08625f4a3f92d69a1380a58ccd` | escalator | 30.1 m | B3→B1 | true | false | false | true | yes | space-category:B023 (route_type=6) | nwd-link-present; fare: GSI `toll` both ends | 6 / 2 / 5 / 2 |
| 9 | `e:38541dff6da6468697900bff23840f98` | walk | 8.6 m | B1→B1 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 10 | `e:8fcace9d16974a91ae8617b1423de276` | walk | 4.3 m | B1→B1 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 11 | `e:b56c4b8d15ec46118120e3430388d9f0` | walk | 3.5 m | B1→B1 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 12 | `e:02c8371d589e429b8c006d60f3d6b73e` | walk | 5.2 m | B1→B1 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 13 | `e:f9e5aa8338b241b5b78933927d42a12a` | walk | 2.6 m | B1→B1 | true | false | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: GSI `toll` both ends | 1 / 4 / 1 / 2 |
| 14 | `e:3763bee44e4740ac86216e99e212f8d1` | gate | 3.1 m | B1→B1 | true | **true** | true | false | – | source-attribute:route_type=1 | nwd-link-present; fare: **gate: toll transition + F106 ≤8 m** | 1 / 2 / 1 / 2 |

`nwd-link-present` is stored with `(maint_date=2025-09-19)` on every row. "GSI `toll` both ends" is the stored `spatial-join:space.toll / spatial-join:space.toll`. Link #14 is the only paid↔free transition on the path and the only edge whose fare state comes from the gate rule rather than the space join. Link attributes are the NWD link fields (`roof`: 2 = roofed; `lev_diff`: 5 = a level change; source spec in S1's `notes`).

## 3. Sources behind every edge

Both sources are in `station.json → sources` and in `stations/shinjuku/sources/manifest.json` (hashes and raw-file URLs). Raw files are not committed.

| Id | S1 `mlit-hokonavi-e27-nwd` | S2 `mlit-hokonavi-e27-stationmap` |
| --- | --- | --- |
| Title | 歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）［GeoJSON形式］ | 構内地図データ（都営地下鉄大江戸線 新宿駅）［GeoJSON形式］ |
| Publisher | 国土交通省（ほこナビDP） | 国土交通省（ほこナビDP） |
| Dataset page (URL) | https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45 | same dataset page |
| Resource download URL | https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/d4519a9a-917a-4de8-9104-83e21246c04c/download/nwd_oedo_shinjuku_geojson.zip | https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip |
| ZIP sha256 | `f3d9c3224e042ba2919730136ddbd88c411fac0af58875085007f5ceaae497ff` | `43a297c028a4ffca3d3bdb3fb1da486e97291a276eadca56801c3b00fa4a9090` |
| `retrievedAt` | 2026-10-20T10:45:52Z | 2026-10-20T10:45:52Z |
| `datasetDate` | 2026-09-17 | 2026-09-17 |
| Rights (`station.json`) | `PUBLISHED_UNDER_OWNER_OVERRIDE` | `PUBLISHED_UNDER_OWNER_OVERRIDE` |
| Licence basis | Unconfirmed. Published under the Owner's #16 override (decision date 2026-10-21, https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757). PDL 1.0 is **not** treated as covering these resources (#39 Q11 = No, https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917). Provider inquiry open. | same |
| Usage in this route | Edge/node geometry, link attributes and the walking network itself | Fare-area (`toll`) and facility points behind access evidence and the gate cluster |
| Attribution (required wording, verbatim) | 「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成, `modified: true` | 「構内地図データ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成, `modified: true` |
| Publication period | Limited publication for 公共交通オープンデータチャレンジ2026 until **2027-03-12**; `validUntil` is `null` (so the router does not mark routes expired) | same |
| Format / spec | GeoJSON; MLIT 歩行空間ネットワークデータ整備仕様 (2024-07), layer-1 attributes only | GeoJSON; 階層別屋内地理空間情報データ仕様書 (GSI 2019-03) |

Rights summary for this card: **included in the project under the Owner's #16 override; external reuse rights are unresolved.** The dataset page lists PDL 1.0, but the project does not take it as covering these resources (#39 Q11 = No), and redistribution/reuse after 2027-03-12 is unconfirmed. Both credits must travel with any route card UI that shows this path (the public `apps/web` build does this; see `docs/stations/shinjuku/README.md` G0).

Endpoint POI evidence (both checked 2026-10-20):

| POI | `evidence.sourceIds` | Method (stored) | Note (stored) |
| --- | --- | --- | --- |
| `poi:platform:oedo` | S1 + S2 | NWD floor=-6 nodes inside GSI paid (toll=2) walkway on 地下6階 | Track/direction assignment per platform side not in source → not shown |
| `poi:gate:2` | S1 + S2 | toll transition links clustered (≤30 m) + GSI F106 ≤8 m; 1 gate link; F106 points nearest this cluster on this level: 4 | Position is approximate, taken from the mapped ticket gates |

## 4. Negative case: a searchable JR gate has no route

Chosen case: `poi:jreast-gate:7` (JR南口 / JR South Exit), one of the 45 S03 search-only POIs (#411, `tokyo-s03-zip`, facts-only names as of 2020-03, `AREA_ONLY`, no floor, no connector, `paid: null`).

It is genuinely searchable — `createSearchIndex(bundle).search("JR南口")` returns it top with score 100 (next hits score 40; `小田急線` likewise returns platform/gate hits at 80 with 0 connectors). But it has `connectorNodeIds: []`, so the product must refuse rather than invent an entrance. Observed router results:

```bash
# destination
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:platform:oedo poi:jreast-gate:7 --from-poi --goal-poi
# → { ok: false, reason: "unknown_goal", message: "destination has no verified entrance" }, path [], polyline [], instructions { ja: [], en: [] }

# origin
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:jreast-gate:7 poi:gate:2 --from-poi --goal-poi
# → { ok: false, reason: "unknown_start", message: "origin has no verified entrance" }
```

This is the intended fail-safe behaviour, not a bug: the S03 import contract (`docs/research/lines/shinjuku-line-pois-contract.md` §2) fixes `connectorNodeIds: []` and says "the router answers `unknown_goal`". The same rule covers the other 44 S03 POIs; the shared importer reports 45 `poi.unroutable` warnings and 0 errors (`stations/shinjuku/data/import-report.json`).

Other refusals observed on the chosen route (same command, profile changed):

| Profile | Result | Why |
| --- | --- | --- |
| `--unpaid-only` | `no_path`, "origin poi:platform:oedo is inside the paid area" | The platform is on the paid side (`poi.platform.paid` = true); a traveller without a ticket cannot start there. Fails closed, as designed. |
| `--strict-hours` | `no_path`, "No traversable path connects the start to a goal." | Every edge has `hours: null`; the strict profile excludes unknown hours. The dataset publishes no opening hours. |
| `--step-free` | **ok**, a different 26-edge path (166.3 m as the router measures — lift rides add time, not length; est. 401.2 s, 2 floor changes, same fare boundary) using lifts (B6→B3→B1) | The walking route uses stairs/escalators, which are `wheelchair: false`; a lift-based alternative exists in the same E27 graph. Not evidence-checked in this card (Follow-ups). |

## 5. Freshness and geographic limits

- **Dates.** Source dataset page last modified 2026-09-17; raw files acquired 2026-10-20T10:45:52Z and hashed; every edge's link `maint_date` is 2025-09-19; every evidence block's `checkedDate` is 2026-10-20. At `today=2026-10-25` the route is **not stale** under the 730-day rule (oldest source 2026-09-17).
- **What the dates do not cover.** The network content is a 2025-09 snapshot (README G0). Changes after that — West Exit closures/works (freshness checklist FR-03), the Toei exit 1/2 closure notice (FR-05), and any later construction — are **not known to be reflected**. The reusable slice must be re-checked when the dataset updates (FR-10, due 2027-01-22).
- **Publication limit.** The dataset page states availability only until 2027-03-12; reuse after that date is unconfirmed (FR-18). `validUntil` is deliberately `null`, so the router treats the route as valid and the limit is a rights matter, not a routing one.
- **Extent.** E27 (Toei Oedo Line) only: 233 nodes, 263 edges, 61 POIs (16 routable E27 POIs + 45 S03 search-only), 9 NWD levels from 1F/street to B6 (`toei-nwd-1`, `toei-nwd-0`, `toei-nwd-m0_5`, `-m1`, `-m2`, `-m2_5`, `-m3`, `-m4_5`, `-m6`). JR, Keio, Odakyu, Toei Shinjuku Line, Tokyo Metro and Shinjuku-nishiguchi (E01) are **not** in the graph; no transfer passage exists in it.
- **Frame.** Station-local ENU, origin 35.687 N, 139.6994 E, declared `JGD2011` / `EPSG:6668` in `station.json`; the source is GeoJSON lon/lat read in that frame. Floors carry `elevationM: null`; only display-only `renderElevationM` exists (B6 −42.87 m … street 0 m) — symbolic, not measured.
- **Vertical truth.** The source publishes no elevations and every node has `position.z: null`. The route's two floor changes are level labels from the NWD `floor` attribute, not measured heights (G-04).

## 6. Gap list

Legend: **S** = the route is currently blocked as a public-current claim until this is resolved; **C** = caveat the UI must show; **F** = follow-up, not blocking this card's conclusion.

| Id | Class | Gap | Affects | Citation / precedent |
| --- | --- | --- | --- | --- |
| G-01 | S | **Rights are not cleared.** Both E27 resources ship under the Owner's #16 override; the licence basis is unconfirmed, PDL 1.0 is not taken to cover them, and reuse after the 2027-03-12 publication period is open. Every edge and both POIs depend on this. | All 14 edges, both POIs, the whole card | #16 override (2026-10-21), #39 Q11 = No; source register 2026-10-22; `gap:reuse-after-publication`; FR-18 |
| G-02 | C | **Freshness stops at the 2025-09 snapshot.** Dataset published 2026-09-17 but content dated by link `maint_date` 2025-09-19; later closures/works are not known to be included. | All edges | README G0; FR-03, FR-10; #203 A8 (aged sources) |
| G-03 | C | **Opening hours are UNKNOWN on all 14 edges** (dataset has no `start_time`/`end_time`), so the router reports `hours` on every step. Operator hours published for official exits 4–8 do not cover these passages or the north gates, and official exit numbers are not mappable to E27 POIs. | All 14 edges | `accessEvidence.note`; FR-14; FR-05; README G2 |
| G-04 | C | **Heights and lengths are not measured.** Every node's z is null and every floor elevation is null; render heights are symbolic estimates, so floor changes are labels. Edge `lengthM` is the source link `distance`; whether that field includes the vertical run is UNKNOWN in this card. The 136.5 m / 146.55 s figures are therefore source facts plus a pace model, not a survey. | All nodes/edges; §2 totals | README G1; importer header; #203 A1 (stairs tagged end-to-end), B3 ("verified" ≠ on-site) |
| G-05 | C | **Not step-free.** The chosen path uses two one-way escalators (`wheelchair: false`, `steps: true`). A lift-based alternative exists in the graph but was not evidence-checked here, and lift data has a known F012 cross-check gap (elevator 2 has no B3 F012 point). Barrier-free claims require source evidence and continuity. | Edges 2 and 8; destination | import-report `liftCrossCheck`; acceptance G0; README G2 (unknown list) |
| G-06 | C | **Escalator direction is one-way in the data and time-of-day reversal is UNKNOWN.** Both escalator edges are `direction: "forward"`; the dataset does not say whether they reverse at peak times, so the route is only correct while they run up. | Edges 2 and 8 | README G2; acceptance G0 (no guessed 24-hour access) |
| G-07 | C | **Fare state is derived, not published.** No link-level fare attribute exists; `paid`/`crossesFareBoundary` come from a GSI `toll` spatial join, propagation along non-gate links, and the gate rule next to F106 points. The only paid↔free transition on the path is edge 14. The full 8-shard fare-containment replay is not done. | Edge 14 and the route's fare flag | importer header (0 anomalies); #156 (fare replay gate) |
| G-08 | F | **Street exits are not usable as a destination yet.** The alternative platform → exit 1 route (194 m, 23 edges, 4 floor changes) is equally source-backed, but the current operating status of `poi:exit:1` is unknown: the Toei page tags official exits 1 and 2 as closed (checked 2026-10-22), E27 has no official exit numbers, and the mapping from that notice to `poi:exit:1` is itself UNKNOWN. The router carries no closure state and does not incorporate the notice, so it would present the path as usable whatever the exit's real status. | Any exit-terminating route; not the chosen gate route | FR-05, `gap:exit-numbers`; #203 A2/A4 (exit levels and names); `docs/stations/shinjuku/search-expected.md` |
| G-09 | C | **Destination is a descriptor, not an official name, and its position is approximate.** `poi:gate:2` = "Ticket gates (B1, north side)" from the F106 cluster and compass side; 4 F106 points are nearest this cluster; no official gate name/number is in the source. Operator gate names exist only as separate S03 search-only POIs and are never merged. | Destination | POI evidence; S03 contract §2; #411 |
| G-10 | C | **Desk-checked only, not on site.** Every fact here is a desk check of two datasets (2025-09 snapshot, checked 2026-10-20). Nothing was observed in the station; the route card must say so rather than implying field verification. | Whole card | #203 B1 ("desk-checked, not on site" line), B3 |
| G-11 | F | **Street context is outside this route's evidence.** `data/surface.json` (PLATEAU 2025 新宿区) is render-only and is credited separately; its REUSE mapping and credit wording are an open item. No PLATEAU data feeds this path. | Nothing on this path | #161 |
| G-12 | F | **No cross-operator continuation.** The graph cannot route to JR/Keio/Odakyu/Metro platforms or gates; 45 such POIs are search-only. Extending the slice beyond the E27 boundary needs sourced passages. | Destination choice | #5 scope; #411; README "Coverage gaps" |

Positive findings for the record: on the chosen path **no edge or node has missing or unresolvable evidence** — all 14 edges have geometry and access evidence citing S1 (and S2 for access), and all 15 nodes' `sourceRefs` cite S1 with feature ids that match. The gaps above are rights, freshness, hours, vertical truth, accessibility and naming, not broken provenance.

## 7. Reproduction and checks

```bash
# main route (§2)
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:platform:oedo poi:gate:2 --from-poi --goal-poi --today 2026-10-25

# negative case (§4)
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:platform:oedo poi:jreast-gate:7 --from-poi --goal-poi
node --import tsx packages/cli/src/route.ts stations/shinjuku poi:jreast-gate:7 poi:gate:2 --from-poi --goal-poi

# profile refusals (§4)
# … --unpaid-only | --strict-hours | --step-free
```

Assertions run for this card, in one process against the committed bundle (`parseStationFiles` + `createRouter` + `routeBetween`, app settings `fare: ticketed`, `stepFree: false`, `today: 2026-10-25`):

- route `ok`, 14 steps, 15 nodes, 136.5 m, 146.55 s, 2 floor changes, `crossesFareBoundary: true`, `unknowns: [{hours: 14}]`, `stale: false`.
- every path node 0–14 in §2.1; every edge id, mode and length in §2.2;
- for all 14 edges: `geometryEvidence.sourceIds` and `accessEvidence.sourceIds` resolve to `station.json → sources` (14/14 true);
- for all 15 nodes: every `sourceRefs[].sourceId` resolves (15/15 true);
- `search("JR南口")` → `poi:jreast-gate:7`, score 100, 0 connectors; `search("小田急線")` top hits all 0 connectors.

## 8. Assumptions

- The brief named `stations/shinjuku/data/graph.src.json`; no such file exists on `main` for Shinjuku (only Ikebukuro has one). The station's routing truth is `stations/shinjuku/gteki/graph.json`, as `docs/stations/shinjuku/README.md` states, and that is what the router and this card read.
- "Source-backed" is read as: every edge and node on the path cites source ids that resolve, and the source is either cleared or shipped under an Owner override. E27 qualifies through the override, so the path is source-backed while G-01 stays open.
- The destination is the mapped B1 north ticket-gate POI, not a street exit, because no street exit has a verified current status (§1, G-08).
- `today=2026-10-25` was used only for the router's staleness verdict; no other date was inferred.
