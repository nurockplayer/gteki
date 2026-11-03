# Coverage matrix: every line and store at 新宿 and 池袋

Built 2026-11-01 11:4x JST by the data lead (data-research-05) for the Owner's goal: every line and every department store at both stations. Basis: `origin/main` at `c97c37a2` (2026-11-01 11:2x JST). Public facts only; private-tier additions are recorded in gteki-private and are not counted here.

This is the one-screen view. The cell-by-cell evidence stays in [`gaps/coverage-sjk-ikb.md`](gaps/coverage-sjk-ikb.md) (2026-10-29) and the rights detail in [`lines/gap-table-2026-10-25.md`](lines/gap-table-2026-10-25.md); this file adds the navmesh and issue state since then.

**How the cells were filled.** POI counts are `jq` group counts over `stations/<id>/gteki/pois.json` and `tenants.json` at the basis SHA. "Routed" means the POI has a `floorId` and graph connectors. The scene column follows the coverage table's rule: a named interior or facade counts, generic placeholder shopfronts (#584, #605) do not.

**Columns.**
- **Source / rights**: where the public facts come from and their class (OD-34 / OD-35 tiers).
- **3D**: y = modelled, partial = some of its public area is modelled, n = none.
- **Walk / navmesh**: public walk graph and the baked navmesh paths (#669). Since #676, the live-scene bake leaves many paths incomplete (#684: Shinjuku 196 of 238 routes, Ikebukuro 542 of 1054); those draw as dashed fallbacks.
- **POIs / tenants**: what is in `pois.json` / `tenants.json`. s = search-only (no floor, no connector).
- **Search / route**: search = found by the search box; route = a route can end at it.
- **Open**: the issue, PR or field item (#533 numbering) that moves the row. **Field items are unscheduled:** the 2026-11-01 run did not take place and no date is set (Owner, via the director, 2026-11-02 04:5x JST). "field (unscheduled)" marks a row that waits on it; the field sheets stay as they are until a date is set.

## Lines

| Station · line | Source / rights | 3D | Walk / navmesh | POIs / tenants | Search / route | Open |
|---|---|---|---|---|---|---|
| 池袋 JR 山手線 | Toshima underground guide 2022 + PLATEAU 13116 (OD-02 A); jreast.co.jp corroboration only (OD-34 §1); ODPT JR indoor data GAP (challenge-only licence, not acquired) | partial: B1 public concourse and the gate line; paid area and platforms n | partial: 66-node / 67-edge B1 graph; navmesh baked, many paths incomplete (#684) | 4 gates (3 routed: 中央×2, 南); no platform POIs (no platform source) | search y; route to 3 gates | field (unscheduled) items 1, A2 / FC-IK-01 (北・メトロポリタン口); #684 |
| 池袋 JR 埼京線・湘南新宿ライン | same as 山手線 (shared gates) | partial (shared concourse) | partial (shared) | shared gates; no platforms | search y (gates); route to gates only | as above |
| 池袋 東武東上線 | Toshima guide 2022; tobu.co.jp corroboration only (OD-01 B, OD-34 r2) | n: no line-specific space; 中央改札 sits on the B1 concourse | n: 2 中央改札 POIs have a floor but no connector | 5 gates (中央×2 on B1, 北, 南, JR連絡); + 5 platforms, 1 lifts, 1 escalators, 1 toilets (search-only, Tobu text) | search y; route n | field (unscheduled) items 11, 26 |
| 池袋 西武池袋線 | OD-25 + OD-34 §2, facts only | n | n | 2 gates + 7 platforms (1–7番), s; exits 37/38 carry 西武東口/西武口 aliases | search y; route n | field (unscheduled) gate↔opening items; ISP メトロ口 print ties 1階改札 stair 36 (desk) |
| 池袋 Metro 丸ノ内線 M25 | tokyometro.jp facts (OD-34 §2) | n | n: 3 gates on B1 floor, no connector | 3 gates + 2 lifts + 2 escalators | search y; route n | field (unscheduled) items 6, 9 (A1/A3, FC-IK-02) |
| 池袋 Metro 有楽町線 Y09 | tokyometro.jp facts (OD-34 §2) | n | n: 1 of 2 gates on B1 floor, no connector | 2 gates + 2 lifts + 4 escalators | search y; route n | field (unscheduled) items 2, 3 (F2, I8) |
| 池袋 Metro 副都心線 F09 | tokyometro.jp facts (OD-34 §2); Echika / C exits absent from PLATEAU 13116 | n: GAP 2026-11-03 (see DR-new-3d-indoor-sources; JST) | n | 2 gates + 3 lifts + 8 escalators + 11 C exits, s | search y; route n | field (unscheduled) items 4, 5; geometry source missing |
| 新宿 JR 山手線 (14・15番線) | S03 2020-03 names (R-1); jreast.co.jp corroboration only; ODPT JR indoor data GAP (challenge-only licence, not acquired) | n | n: S03 graph held (#557 publish gate; 2,254 edges carry reason codes) | platforms 14, 15 + 10 shared JR gates, s; facilities GAP (operator pages only) | search y; route n | S03 Check A/B, field (unscheduled) items 30, 50–54; #623 |
| 新宿 JR 中央線快速・中央本線 (7・8・11・12番線; 特急 9・10) | as 山手線 | n | n (S03 held) | platforms 7–12, s; facilities GAP (operator pages only) | search y; route n | as 山手線 |
| 新宿 JR 中央・総武線各停 (13・16番線) | as 山手線 | n | n (S03 held) | platforms 13, 16, s; facilities GAP (operator pages only) | search y; route n | as 山手線 |
| 新宿 JR 埼京線・湘南新宿ライン (1–4番線) | as 山手線 | n | n (S03 held) | platforms 1–4, s; facilities GAP (operator pages only) | search y; route n | as 山手線 |
| 新宿 小田急線 | S03 (Q2/Q3 OK); odakyu.jp corroboration only (OD-34 r5a) | n | n (S03 held) | 3 gates + 5 platforms (2–6) + 2 JR連絡, s; facilities GAP (operator pages only) | search y; route n | S03; field (unscheduled) gate items |
| 新宿 京王線 | S03; keio.co.jp corroboration only (r5a); 京王モール flat ban (§3) | n | n (S03 held) | 8 gates (incl. 京王新線口, 新都心口) + 1 JR連絡, s; facilities GAP (operator pages only) | search y; route n | S03; field (unscheduled) gate items |
| 新宿 京王新線 | S03 + Toei CSV (CC BY 4.0, #501) | n | n | shares the 京王新線口 / 新都心口 gate POIs | search y; route n | field (unscheduled): tag the gates by line |
| 新宿 都営新宿線 S01 | Toei facts OD-01 A; Toei CSV CC BY 4.0 (#501) | n | n | 9 Toei exits (1–8, A1), line unattributed except A1 | search y; route n | field (unscheduled): exit attribution (Toei CSV cannot split S01 / E27) |
| 新宿 都営大江戸線 E27 | MLIT ほこナビ E-27 (#16 override, not a rights PASS) | y: 9 levels, gates, platform, exits | y: 233-node / 263-edge graph; navmesh baked, 196 of 238 routes incomplete (#684); 8 steep/flat vertical edges marked approximate (#655) | 3 gates (unnamed), 1 platform, 6 exits, 3 lifts, 3 toilets: 13 routed, the 3 lifts placed but search-only | search y; route y | gate names (field); #684; #644 (floors via field (unscheduled) items 60–61) |
| 新宿 Metro 丸ノ内線 M08 | tokyometro.jp facts (OD-34 §2), Wayback | n | n | 2 gates + 28 exits + 4 lifts + 2 escalators, s | search y; route n | field (unscheduled): gate identity (WP10) |
| 西武新宿線 (西武新宿駅, separate station) | operator facts, search-only endpoint | n | n | `poi:sep-seibu-shinjuku`, s | search y; route n | field (unscheduled) items 57–59 (FC-SEP-01–03) |
| 新宿三丁目 (副都心 F13, 丸ノ内 M09, 新宿 S02) | operator facts, search-only endpoint | n | n | `poi:sep-shinjuku-sanchome`, s | search y; route n | field (unscheduled) items 57–59 |
| 新宿西口 (大江戸 E01) | operator facts, search-only endpoint | n | n | `poi:sep-shinjuku-nishiguchi`, s | search y; route n | field (unscheduled) items 57–59 |

## Department stores and station buildings

| Station · store | Source / rights | 3D | Walk / navmesh | POIs / tenants | Search / route | Open |
|---|---|---|---|---|---|---|
| 池袋 西武池袋本店 | JCSC 2026 list (facts); store site corroboration only (r3); tenants promoted to public tier (#578, OD-35) | n | n | 1 POI, s; 307 tenants | search y (store + brands); route n | field (unscheduled) entrance; present layout (renovation)<br>GAP 7F: not listed (read 2026-11-02T14:38:33Z)<br>GAP 8F: not listed (read 2026-11-02T14:38:33Z)<br>GAP 別館 RF: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 9F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 7F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 6F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 5F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 4F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 3F: not listed (read 2026-11-02T14:38:46Z)<br>GAP 別館 B2F: not listed (read 2026-11-02T14:38:46Z) |
| 池袋 東武百貨店 | store site usable (OD-34 §2) | n | n | 1 POI, s; 860 tenants | search y; route n | field (unscheduled) item 26 |
| 池袋 ルミネ池袋 | lumine.ne.jp usable (OD-34 §2) | partial: named facade, B1 directory board (#598) | partial: routed via `jr-south-gate` (#531); the door itself is not surveyed | 1 POI + 176 shop POIs | search y; route y (to the gate) | door survey (not a field (unscheduled) item) |
| 池袋 エソラ池袋 | usable (OD-34 §2) | n | n | 1 POI + 33 shop POIs | search y; route n | field (unscheduled) item 25 |
| 池袋 PARCO | JCSC (facts); floor guide facts-only (OD-35, director 2026-11-02; supersedes #502) | n | n | 1 POI, s; 148 tenants | search y; route n | field (unscheduled) item 27 |
| 池袋 Echika | Tokyo Metro facts | n: candidate: DR-IKG-01 (S facts only), DR-IKG-02 (class unknown); no public geometry grant | n | 22 shop POIs | search y; route n | geometry source; no printed entrance tie |
| 池袋 ISP (池袋ショッピングパーク) | facts (printed access) | n (B1 passage drawn; no named interior) | n: printed tie only | 53 shop POIs | search y; route n | desk exhausted 2026-11-02: the only position text is ISP's own site (OD-23: never sole evidence) and `metro-m-central-east-gate` has no connector → field (unscheduled) V3 |
| 池袋 東武ホープセンター | facts (printed access) | n | n | 43 shop POIs | search y; route n | field (unscheduled) entrance |
| 新宿 伊勢丹 本館・メンズ館 (and the B5–B3 promenade levels) | facts only (#522); tenants public tier (#578) | n | n | 2 POIs, s; 83 sections (本館 67, メンズ 16) + 1464 brands (本館 1154, メンズ 310) | search y; route n | field (unscheduled) items 47, 48, 56 |
| 新宿マルイ 本館 / アネックス / メン | facts only (no quoted ban) | n | n | 3 POIs, s; 157 tenants (63 / 56 / 38) | search y; route n | field (unscheduled) items 40, 41 (メン: E2 attribution inconsistent) |
| 新宿 高島屋 (タイムズスクエア) | store site: private use and quotation (data lead 2026-10-28, #591; use-tiers.md) → facts-only: brands as tenants (#591), store hours (#709) | n | n | 1 POI, s; 366 tenants | search y; route n | field (unscheduled) entrance and name |
| 新宿 京王百貨店 | store shop-search JSON (facts, OD-35, director 2026-11-02; supersedes #516 §5 / #502 corroboration-only) | n | n | 1 POI, s; 593 tenants | search y; route n | field (unscheduled) item 55 |
| 新宿 小田急百貨店 (西口ハルク) | usable (OD-34 r2) | n | n | 1 POI, s; 269 tenants | search y; route n | field (unscheduled) item 39 |
| 新宿 ルミネ1・ルミネ2 | usable (OD-34 §2) | n | n | 2 POIs + 230 shop POIs | search y; route n | field (unscheduled) items 43, 44 |
| 新宿 ルミネエスト | usable (OD-34 §2) | n | n | 1 POI + 246 shop POIs | search y; route n | field (unscheduled) item 45 |
| 新宿 NEWoMan | usable (OD-34 §2) | n | n | 1 POI + 102 shop POIs | search y; route n | field (unscheduled) item 46 |
| 新宿 サブナード | site reachable again 2026-11-01T21:32Z (refused on 10-25); its own terms (`/legal/` §1) are a private-use limit (OD-35 "private use and quotation" class, data lead 2026-11-02), but the floor guide is an image-only PDF (`floorguide20261022.pdf`, no text layer) and the site lists no shops as text → tenants GAP (map-image precedent: 高島屋 1F/3F/6F/8F, #591); 85 directory cards facts-only, floors GAP | n | n | 1 POI, s | search y; route n | field (unscheduled) item 55 |
| 新宿 小田急エース / 京王モール | refuse every use (OD-34 §3; OD-35 class, terms re-read 2026-11-02T16:57Z, unchanged); 15 recovered POIs facts-only (#604) | n | n | 15 shop POIs (`shop-sjk-rec-`); tenants GAP (terms) | search y; route n | field (unscheduled) entrances |
| 新宿 メトロプロムナード | Tokyo Metro 2018 press release (M08 tie) | n | n | 4 shop POIs (`shop-sjk-metro-`) | search y; route n | field (unscheduled) item 56 |

## What the matrix says

- **Routed today:** Toei E27 (13 of 16 POIs), JR Ikebukuro (3 gates on the B1 graph), ルミネ池袋 (via the JR south gate). Everything else, 17 of 20 line rows and 18 of 19 store rows, is search-only.
- **Modelled in 3D:** the E27 levels at Shinjuku and the B1 public concourse at Ikebukuro. No other operator's paid area, platform or named store interior is modelled.
- **The blockers that gate most rows:** at Shinjuku, the JR, 小田急 and 京王 rows wait on the held S03 graph and the unmodelled S03 levels (#623); 京王新線, S01 and M08 wait first on field gate and exit attribution, and have no walk geometry of their own either. At both stations, every store except ルミネ池袋 and every Ikebukuro non-JR gate waits on an entrance or gate tie that only a field receipt can give, and no field run is scheduled (store connectors come from field receipts only, `import-e27.ts`).
- **JR paid areas and platforms, both stations:** the only geometry found, ODPT 「歩行空間ネットワーク／構内地図データ（JR東日本 池袋駅・新宿駅）」 (2026-10-26), is licensed to 公共交通オープンデータチャレンジ participants only. Director ruling 2026-11-02 04:2x JST: GTEki does not enter the challenge and does not acquire the data, for either tier. Recorded as a GAP in [`gaps/geometry-sources-2026-11-01.md`](gaps/geometry-sources-2026-11-01.md) and #165; reopened only if the Owner later decides to register.
- **Regression to watch (2026-11-03 JST):** #684 cut complete navmesh routes SJK 166→42, IKB 1054→512. Current gates: Shinjuku has 92 complete / 146 incomplete routes and 6 fallback edges (#708), with 0 connector wall hits (#685 gate, unchanged); Ikebukuro has 704 complete routes (#708), 478 incomplete routes (#698), 7 fallback edges (#708), and 316 connector wall hits (#698). #731 leaves the public gates unchanged. #710 (#645 step 2a, OPEN) is expected to cut IKB unvalidatedJoins 496→126; refresh this line when it merges.
