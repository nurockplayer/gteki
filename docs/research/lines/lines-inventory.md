# Line inventory: every railway line at Ikebukuro and Shinjuku (Phase 0)

- **Lane:** lines-lead (multi-line expansion), reporting to the director gteki-1b. Phase 0 of the Owner's request "start work on each railway line at Ikebukuro and Shinjuku".
- **Checked:** 2026-10-24 (JST). Basis: `origin/main` at `724459b8`.
- **Method:** repo records only (dossier, `docs/gis/**`, `docs/research/gaps/**`, decision files, both stations' `gteki/` data). One local read of the S03 ZIP already held in the GIS store (`~/.gteki/gis-store/raw/fc3466…`, acquired by GIS on 2026-10-21) to **count** line-infrastructure entities per operator. No value from it is written here. No web page was fetched, nobody was contacted and no account was made.
- **Not in scope:** shops and in-station facilities (toilets, lockers, ATMs, ticket offices) belong to data-research-05. This file covers line infrastructure only: ticket gates, platforms, transfer gates and passages, exits, lifts and escalators.
- **Separate stations stay separate.** 新宿三丁目 (M09/F13/S02), 西武新宿 (SS01) and 新宿西口 (E01) are not part of 新宿 here. They are joined only by a public connection that a source proves. The same applies to 東池袋 and Echika as places: an Echika exit is listed under the line whose exit it is, and Echika is never treated as a station.

## 1. Reading rules

**Layers** (what a line can reach today):

| Layer | Means | Does not mean |
| --- | --- | --- |
| (a) Searchable line POI | A gate, platform, transfer gate, exit or lift/escalator that search can find. Facts only, `UNVERIFIED`. Without position evidence it is **AREA_ONLY** (the source names an area or level) or **SEARCH_ONLY** (no area): `floorId: null`, `displayPosition: null`, `connectorNodeIds: []`, so the router answers `unknown_goal` (the #369 contract) | A position, a level match, a route, current status |
| (b) Walkable segment with geometry | Edges on surveyed geometry with access evidence (the Ikebukuro G0 standard: geometry evidence **and** a documented access fact) | Fare-paid concourses or platforms unless a source models them |
| (c) Visual only | Geometry may be drawn, but nobody may walk it (`visual_only`, access fences) | Any access claim |

**Rights state** of a source, for line facts:

- **DECIDED-OK**: an Owner or director decision allows the named use (decision id given).
- **DECIDED-NO**: a decision excludes it.
- **PENDING**: the terms have not been read or no decision exists. Terms checks go to the GIS data factory, and the ruling is gteki-1b's.
- **UNUSABLE**: no decision is needed because a standing rule already blocks access (login, account sign-up, no public file).

## 2. Sources for line facts and geometry

| Source (repo id or dossier id) | Lines it speaks to | What it gives for lines | Rights state | Decision / record |
| --- | --- | --- | --- | --- |
| Toshima 池袋駅地下空間案内図 2022 (`toshima-underground-guide-2022`, I-05) | IK: JR, Tobu, Seibu, Metro ×3 | Gate and exit names as printed. Relative placement is layout and is never used (OD-03) | DECIDED-OK, facts only, `REFERENCE_ONLY` | #26; OD-03 |
| Toshima サインガイドライン 案 Ver1.3 p20 (`toshima-terminal-sign-guideline-draft-v1.3`) | IK: exits | Six exit-name mappings (e.g. 東口（中央）37「西武東口」), as names and aliases only | DECIDED-OK, names only, never route evidence | OD-22 |
| Tokyo Metro pages: yard map 2026.3, バリアフリー設備, exit list (`tokyometro-ikebukuro-*`, S07) | IK: M25, Y09, F09; SJ: M08 | Gate names, exit numbers and letters (C-series), lifts and escalators by named end pair, in or outside the fare zone | DECIDED-OK, facts only | #26 |
| Seibu Railway site (I-04, DR-SH-01/04) | IK: Seibu | 西武南口 and its hours, 1F and B1F gates (text), gate and exit names on the drawing as a name list | DECIDED-OK, facts only | OD-25 |
| 東武百貨店 / 東武ホープセンター / PARCO pages | IK: Tobu, Metro (connection facts) | Simple connection facts, e.g. 東上線中央改札1・2, 中央通路西改札を出て… | DECIDED-OK, conditions in OD-18 | OD-18 |
| ISP site; Sunshine City site | IK: Seibu, Metro (attributes) | e.g. Seibu 1F gate → 36番階段; exit 35 lift | DECIDED-OK, POI attributes only, never the sole route-end evidence | OD-23, OD-24 |
| Toei station pages (DR-SJ-01/02/05/06, DR-SX-01) | SJ: S01, E27 | Combined exit list A1, 1–8 with tags (京王新線口, 新都心口), closures (1, 2), posted hours, lift and escalator counts per line | DECIDED-OK, facts only; the per-exit coordinate feed stays unused | OD-01 A; "Already decided" table |
| 新宿区 Terminal Map and elevator/stairs map, 2025-11 (S09, DR-SJ-10) | SJ: all | Image-only sheets. Only legend text has been transcribed so far | DECIDED-OK, facts only | #26 (ward maps) |
| **S03** 東京都都市整備局「新宿駅周辺の施設情報等」(`tokyo-s03-zip`) | SJ: JR, Odakyu, Keio, Keio New Line, M08, E27 (and gates that may be E01) | Named entities and per-level features (section 4.2). Base data **2020-03**, published 2023-02-28 | **DECIDED-OK** for neutral geometry and factual fields, with credit and a change notice. Placement is **HOLD**: CRS UNKNOWN | Q2, Q3 Yes; Q4 No; `docs/gis/rights/tokyo-s03-zip.json` |
| PLATEAU 13116 `ubld` (`plateau-ubld-13116`) | IK: public B1 passages around every line | Surveyed B1 free-passage geometry. No gates, no paid areas, no platforms | DECIDED-OK (CC BY 4.0, credit) | Q8 |
| PLATEAU 13104 `ubld` 53394536 | SJ: unknown which passages | 30,358 features, 153 Rooms, TP 15.32–45.49 m, no floor labels. Bbox-disjoint from E27; 8 of the 11 S03 level files intersect its bbox (conditional on S03's CRS) | DECIDED-OK (CC BY 4.0) | Q8; M0-01 SJ-01 |
| MLIT ほこナビ E27 network and map | SJ: E27 only | The shipped E27 slice | Ships under the Owner's #16 override, which is **not a rights PASS** and does not extend to other lines | #16; Q11 No |
| Toei open CSVs 駅基本情報, 障害者設備一覧, EV点検 (DR-NS-15/16) | SJ: S01, E27 | Per-station equipment yes/no, depth, monthly lift outages. No positions | **PENDING**: the catalog states CC BY 4.0, but there is no acquisition or rights record | none |
| Keio site and PDFs (S05, DR-SJ-12) | SJ: Keio, Keio New Line, S01 (Keio manages the shared station) | Floor PDFs (2026-03), works notices (2026-09/10), platforms | **PENDING**: terms reserve copying, processing and secondary use, and whether they also ban commercial use (the Tobu class) is unread. The site returned 503 on 2026-10-22 | none (OD-28 allows Wayback snapshots as secondary only) |
| Odakyu site (S06, DR-SJ-16) | SJ: Odakyu | Platforms, gates, planned 2027-03 IC-only change | **PENDING**: terms require prior permission; class unread; the page timed out | none (OD-28 as above) |
| だれでも東京 portal (DR-SH-22) | IK: Metro, Seibu (counts) | Lift counts, platform-door platforms 2～6 (Seibu) | **PENDING**: terms not read | OD-26 |
| ほこナビ `nwd_shibuya_sendagaya_shinjuku` (2021-05) and S02 (2018-10) | SJ: street and peripheral network | 2D walking network; indoor share UNKNOWN | **PENDING**: PDL 1.0 at package level, resource licence null, no record. At most context-only, like R1 (OD-17) | none |
| JR East site, maps and lift hours (I-01, S04) | IK, SJ: JR | n/a | **DECIDED-NO** | OD-02 A |
| Tobu Railway station map gate names (I-03) | IK: Tobu | n/a | **DECIDED-NO** | OD-01 B |
| ODPT station data, including the JR Challenge data | both | n/a | **DECIDED-NO** for data: the Owner registers the key personally, and redistribution is barred without consent | "Already decided" table |
| PLATEAU `related` station/railway layers | both | n/a | **DECIDED-NO** | Q5 No |
| Ecomo, Yahoo!乗換案内 and other aggregators | both | pointers only | **DECIDED-NO** for data | OD-05; I-09 terms |
| MLIT 屋内地図 新宿 H29/H30/R2 (G5, SJ-07) | SJ: all | Indoor map with a step and slope network (2020-10, including the 2020-07 東西自由通路) | **UNUSABLE**: the download needs a login, and account sign-up is ruled out | OD-21 |
| ほこナビ E01 新宿西口 and E28 都庁前 | other stations | n/a | **DECIDED-NO** for shipping (GIS may inspect; nothing ships) | OD-19 B |

## 3. Per-line status

### 3.1 Ikebukuro

| Line | In station data today | Usable fact sources now | Geometry / network | Layer reachable now | Main blockers |
| --- | --- | --- | --- | --- | --- |
| **JR East** (Yamanote, Saikyo, Shonan-Shinjuku) | 3 gates: `jr-central-gate-1`, `jr-central-gate-2`, `jr-south-gate`, routed to the gate on the public side | Toshima guide (gate names), sign guideline (exit names), Metro yard map (transfer-direction facts) | PLATEAU B1 public side only; the JR paid concourse and platforms are not modelled | (a) and (b) for the 3 gates. Further JR gates only as names printed on the Toshima guide, not yet transcribed. Platforms: **no usable source** (OD-02), so they stay UNKNOWN | OD-02 leaves no first-party source; platforms need a non-JR public source or a field check |
| **Tobu Tojo** (TJ-01) | 2 gates, search-only: `tobu-central-gate-1`, `-2` | Toshima guide (names, including a Tobu north gate drawn beside 中央改札2, not yet transcribed); 東武百貨店 (OD-18) | Gates not identified in PLATEAU (`gap-metro-tobu-gates`) | (a) gates; (b) none | OD-01 B removes the Tobu map; platforms UNKNOWN; field check A2 |
| **Seibu Ikebukuro** (SI-01) | none (exits 37 and 38, named 西武東口 and 西武口 via OD-22, are routed as exits) | Seibu site (OD-25): 西武南口 (hours 7:00～22:30), 1F gate, B1F gate; drawing labels 西武南口, 東口（南）, 東口（中央）. ISP: 1F gate → 36番階段 (OD-23). Platform numbers: the Seibu page has not been read for them yet | Seibu gates are not in PLATEAU (the 1F gate is above the B1 survey) | (a) gates, exits, platforms once read; (b) none | Read the Seibu page for platforms and lifts; だれでも東京 terms (PENDING) |
| **Metro Marunouchi M25** | 3 gates, search-only (central passage west, central, east) | Metro pages (#26): in-fare lift ホーム（終端寄り）～中央通路西改札; outside-fare lift and escalator 中央通路東改札～34/35 (the two Metro pages disagree on 34 and 35, FC-IK-02) | Gates not identified in PLATEAU | (a) gates plus platform and lift POIs; (b) none | Field checks A1, A3, FC-IK-02 |
| **Metro Yurakucho Y09** | 1 gate, search-only: `metro-y-south-west-gate` | Metro: 南通路西改札, 南通路東改札; outside-fare lift and escalators 南通路西改札～4番（エソラ） | Gates not identified (`gap-south-west`) | (a) both gates, platform, lifts; (b) none | Field check F2 / I8 |
| **Metro Fukutoshin F09** | none | Metro: 西通路東改札, outside-fare lifts to C9 (B1F–1F per the outage table) and C1b; Hope Center: 西通路東改札 (OD-18) | Echika and the C exits are **not in** PLATEAU 13116 (G0) | (a) gates, C exits, platform, lifts; (b) none; (c) none | No geometry source for the Fukutoshin side at all |

Ikebukuro totals today: 38 exits, 9 gates (3 routed), 6 passage and hall POIs, 5 shops (`stations/ikebukuro/gteki/pois.json`).

### 3.2 Shinjuku

| Line | In station data today | Usable fact sources now | Geometry / network | Layer reachable now | Main blockers |
| --- | --- | --- | --- | --- | --- |
| **JR East** | none (`gap:transfers`) | **S03 entities**: 12 JR gate and exit names, 2 of them shared transfer gates with Keio and Odakyu. Toei page: JR line names in its transfer list (Toei's own text) | S03 level and path geometry (CRS UNKNOWN); PLATEAU 13104 `ubld` (coverage UNKNOWN) | (a) AREA_ONLY (R-1 allowed), gates and platforms: S03 also has 14 JR platform entities (1–4, 7–16) | 2020 vintage (S03 predates the 2020-07 東西自由通路, see G5); S03 CRS |
| **Odakyu** | none | **S03**: 4 gate names plus 5 platform entities (2–6, with service labels) | as JR | (a) AREA_ONLY: gates and platforms | 2020 vintage (R-2 note); the Odakyu site is PENDING; the planned 2027-03 IC-only change must not be applied early (dossier S06) |
| **Keio** (京王線) | none | **S03**: 5 gate names (2 exit-only), plus the shared JR/Keio transfer gate | as JR | (a) AREA_ONLY: gates. Platforms UNKNOWN | Keio site PENDING; 2026-09/10 works notices (dossier S05) postdate S03 |
| **Keio New Line** (京王新線) **and Toei Shinjuku Line S01** (one shared station, managed by Keio per Toei's page) | none | **S03**: 京王新線口 (2 entities), 新都心口. Toei page: exits 3–5 京王新線口, 6–8 新都心口, 1 and 2 閉鎖中 (2 since 2024-03-30), S01 lift 1 and escalators 14 | as JR | (a) gates and the exit list; platforms UNKNOWN | Toei's exit list mixes S01 and E27 exits, and the page does not say which is which; Keio PENDING; the Toei CSVs PENDING |
| **Metro Marunouchi M08** | none | **S03**: 丸の内線 東口改札口, 西口改札口, one further gate entity. Metro pages (#26): exit list, のりかえ出口案内 (unread) and accessibility | as JR | (a) gates, exits, lifts | Metro pages not yet read for M08; the dossier warns that the HTML exit list has a stray template entry (S07) |
| *(reference)* **Toei Oedo E27** | 16 POIs, routable slice (`gap:exit-numbers` open) | Already shipped. **S03 adds 5 named Toei gate entities**; at least one name matches an E01 gate tag in Toei's E01 feed, so station assignment per entity is UNKNOWN | E27 network (#16 override) | (b) done. Naming the 3 unnamed E27 gates from S03 needs S03 positions | Never merge E01 into E27 by name |

Shinjuku today: E27 only (16 POIs). Its platform POI note says other operators are not modelled; `docs/stations/shinjuku/search-expected.md` changes when other lines arrive (sjk-search-78).

## 4. Notes by source

### 4.1 Ikebukuro, what is already decided and wired

- Gates are identified on PLATEAU only for JR 中央1, 中央2 and 南 (Toshima guide). The other 6 gate POIs stay search-only for the reason in `stations/ikebukuro/docs/coverage-gaps.md`: no document says which opening is which gate.
- Every new Ikebukuro line POI in Phase 1 is therefore layer (a). It becomes (b) only through the existing field checks (A1–A3, F2, F3, B2, I8, FC-IK-02), which are already in `field-checklist.md` and `docs/research/field-collection-list.md`.
- Platforms for JR, Tobu and Seibu: no decided-OK source states platform numbers in text today (Seibu's page has not been read for them yet). Platforms are not invented from general knowledge.

### 4.2 S03 line-infrastructure content (counts only)

Read locally from the GIS store copy (ZIP sha256 `fc3466270c08593a…`, 2,317,035 B). Names stay out of this file. They go into the Phase 1 data file with the S03 credit 「出典：東京都都市整備局「新宿駅周辺の施設情報等」」 and a change notice (Q2).

| Group | Count | Notes |
| --- | --- | --- |
| Named entities (`com-entity.geojson`, 423 in all) about lines | 52 | JR 12 gates (2 shared transfer gates) + 14 platforms (1–4, 7–16; first count missed them because their names start with the number), Odakyu 4 gates + 5 platforms, Keio 5 (+1 commercial unit with the same gate name), Keio New Line 3, Metro M08 3 + 1 station entity, Toei 5 (E27 or E01, see 3.2) |
| Level features, `barrier: gate` | 37 | Mostly unnamed |
| Level features, lifts / escalators / stairs | 103 / 284 / 402 | Unnamed, with level label only. Not useful as search POIs until there is a position |
| Level files | 11 (B5F…4F, M1F, MB2F) | Level labels are S03's own. They are not station floors and not elevations |
| `v5_nav.json` | 2,506 nodes / 2,653 links | Source references only; 0 edges exported (`routable: false`) |

Category codes on entities are almost all empty (402 of 423), so operator and kind come from the printed name. Entities point to level features by `$id`; resolving an entity's level is part of the extraction.

### 4.3 What the vintage means

S03 is base data of 2020-03. Known later changes in the repo records: the 2020-07 東西自由通路 (G5), Keio New Line works notices in 2026-09 and 10 (S05), and the closure of Toei exit 2 on 2024-03-30 (DR-SJ-05). S03 names are therefore historical facts with a date. Each POI carries the note 「2020年3月時点のデータです。現在は変更されている場合があります」 / "As of March 2020 data; may have changed". Current status is UNKNOWN, never "open". This is ruling R-2.

## 5. Work packages (ranked: transfer value × readiness)

| # | Package | Lines | Ready? | Output | Lane / writer | Worker |
| --- | --- | --- | --- | --- | --- | --- |
| **WP1** | **Shinjuku S03 line POIs**: gates, transfer gates and JR and Odakyu platforms (45 after review; PR #411) as AREA_ONLY (S03 level label in notes) | SJ: JR, Odakyu, Keio, Keio New Line, M08 | Yes (R-1 allowed JR names from S03) | `docs/research/lines/shinjuku-line-pois.json` (format agreed with sjk-search-78: `poi:<operator>-<kind>:<n>`, sources with rights values) + contract | lines-lead → **sjk-search-78** (adds to `import-e27.ts` and regenerates) | Luna (routine extraction script, store read-only), lead review |
| **WP2** | **Ikebukuro Metro** gates (add 南通路東改札 and the Fukutoshin gates), platforms, lifts and escalators by end pair, C-series exits | IK: M25, Y09, F09 | Yes (#26) | `docs/research/lines/ikebukuro-line-pois.json` batch 1 | lines-lead → **ikb-route-15** | DeepSeek ds-research with ego-lite allowed (Metro refuses plain requests), or Luna if pages can be read without a browser |
| **WP3** | **Ikebukuro Seibu** gates, platforms, lifts, 西武南口 hours | IK: Seibu | Yes (OD-25) | same file, batch 2 | lines-lead → ikb-route-15 | same worker as WP2 |
| **WP4** | **Shinjuku M08 + S01** from Metro and Toei pages: exits and lifts; reconcile with S03 names; split the Toei exit list only where a source says which line | SJ: M08, S01 | Yes (#26, OD-01 A) | same file as WP1, batch 2 | lines-lead → sjk-search-78 | same worker as WP2 |
| **WP5** | **Ikebukuro JR and Tobu names from the Toshima guide**: transcribe the remaining printed gate names (e.g. the Tobu north gate) under OD-01 B, OD-02 and OD-03 | IK: JR, Tobu | Yes; the guide is cached by the Ikebukuro lane | batch 3 | lines-lead (judgment on the rights boundary) → ikb-route-15 | Sonnet 5.5 or lead |
| **WP6** | **Rights checks**: Keio and Odakyu terms (facts class), だれでも東京 terms, Toei CC BY CSVs (acquire + rights record), ほこナビ 2021 Shinjuku network record | SJ: Keio, Keio New Line, S01, Odakyu; IK: Seibu, Metro | Ask now | rights records + a ruling request | **GIS data factory** (terms), gteki-1b (ruling) | GIS lane |
| **WP7** | **S03 CRS and Path transform; validate `v5_nav.json`** (GIS ranks 1/8). Prior art: `docs/stations/shinjuku/research/2026-10-21-tokyo-terminal-join.md` already decodes the drawing transform (v5_nav `d[0].t` then `com-map` `ref_frame.transform` to lon/lat, provisionally WGS84, no datum correction) and finds 15 reciprocal E27 pairs (median 1.85 m). WP7 starts by validating that method (GIS agrees) | SJ: all | Hard; GIS-owned; needs gteki-1b to schedule | positions for WP1 POIs; the only open candidate for Shinjuku layer (b) beyond E27 | GIS data factory | Sol (hard) |
| **WP8** | **PLATEAU 13104 `ubld` coverage map**: which rooms are which public passages, against S03 levels once WP7 lands | SJ: all | After WP7 | coverage table; candidates for layer (c), later (b) | GIS data factory | Luna |
| **WP9** | **Keio / Odakyu platforms and facts** from first-party pages or Wayback (OD-28, secondary only) | SJ: Keio, Odakyu | After WP6 | batch for sjk-search-78 | lines-lead → sjk-search-78 | routine worker |
| **WP10** | **Field items for lines**: add transfer-gate and platform checks to the field list (Ikebukuro A1–A3, F2, F3, FC-IK-02 exist; Shinjuku FC-SJ-05 transfers exists) | both | Doc only | additions to `field-collection-list.md` | lines-lead (data-research owns the file) | none |

Order of value: Shinjuku JR↔Odakyu/Keio/M08 transfers are the busiest, so WP1 comes first. Ikebukuro Metro (three lines, the most gate POIs still missing) is WP2. Every package in Phase 1 adds layer (a) only. Layer (b) for any new line waits on field checks (Ikebukuro) or WP7 (Shinjuku).

**Writer load.** Both writers already import from a single data file per batch. A per-operator file merged by the build is not proposed now. It is raised only if a writer becomes the bottleneck, and it goes to gteki-1b before any schema change.

## 6. Requests

**Rulings for gteki-1b** (R-1 and R-2 decided by gteki-1b on 2026-10-24, under the Owner's delegation)

- **R-1 decided: allowed.** OD-02 excludes JR East's own data (its floor maps and pages). JR gate names recorded in non-JR sources (S03, the Toshima guide) are facts and may be used. Each such POI cites that non-JR source as its evidence, never a JR page.
- **R-2 decided: allowed.** S03 POIs carry 「2020年3月時点」 / "as of March 2020", status UNKNOWN, AREA_ONLY, no position, and are never route evidence.
- **R-3 open:** decided once GIS has checked the terms.
- **WP5 boundary (lines-lead judgment, 2026-10-24, as gteki-1b asked; gteki-1b may overrule):** JR and Tobu gate labels printed on the Toshima underground guide (2022-01; sha256 `db85abf7…7a15`) are ward facts under #26, the same class as the shipped `tobu-central-gate-1/-2`. JR names rest on R-1. Tobu's own station map and JR pages are never used, not even as an alias or a second source (OD-01 B, OD-02). Drawn placement stays out (OD-03). The map prints no platform numbers. Expected new POIs: JR 北改札 and Tobu 北改札, plus a Seibu name variant (地下改札 / B1F Gate) for `seibu-b1f-gate`.
- **WP12 result (2026-10-24, ds-ikebukuro; lines-lead agrees): no transfer facts.** We read the Toshima underground guide (2022-01) for JR and Tobu transfers. Page 2, the map, has no text layer, so it was read as an image. It prints no のりかえ / 乗換 label and no sentence linking one line to another. A gate drawn inside a line's coloured area is drawn layout (OD-03), not a printed transfer statement. So nothing is recorded and no PR is opened (local branch `ds/lines-wp12-ikb-transfers`, commit 2e736ce8, not pushed). JR and Tobu transfers at Ikebukuro remain covered only by the Metro and Seibu pages (WP11, #452) and by field checks (WP10).

As asked:

- **R-1.** OD-02 ("no JR East data"): does it also exclude JR facility names taken from a **non-JR** source (S03, CC BY; the Toshima guide)? Ikebukuro already ships three JR gate names from the Toshima guide. Recommendation: allowed when the source is not JR East, with the source cited per POI.
- **R-2.** S03 vintage: may S03 line POIs ship with the 2020-03 dated note and status UNKNOWN (section 4.3)? Recommendation: yes, AREA_ONLY only, with no position and no route until a newer source or a field check confirms them.
- **R-3.** After WP6, the facts class of the Keio and Odakyu sites (the Metro class under #26, or the Tobu class like OD-01 B).

**Terms checks for the GIS data factory** (WP6): the Keio site terms (https://www.keio.co.jp/contact/site/), the Odakyu policy (https://www.odakyu.jp/policy/), the だれでも東京 terms, acquisition and rights records for the Toei 駅基本情報 and 障害者設備一覧 CSVs (DR-NS-15/16), and a record for ほこナビ `nwd_shibuya_sendagaya_shinjuku`. Status questions: WP7 (S03 CRS) and WP8.

**For core-search** (raised by sjk-search-78): confirm the #369 contract shape (`floorId: null`, empty `connectorNodeIds`, `unknown_goal`) covers the Shinjuku bundle as well as Ikebukuro.

## 7. What this file does not establish

- It places no POI, states no route and adds no rights clearance. Counts from S03 are counts; the names have not been checked against today's signs.
- It does not say which Toei exits belong to S01 and which to E27, and it does not assign S03's Toei gate entities to E27 or E01.
- No platform number is stated for any line without a decided-OK source.
- Historical closures (e.g. Ikebukuro 1a and C4, Shinjuku Toei exits 1 and 2) are not reopened by any map that still draws them; their status stays as each source states it, otherwise UNKNOWN.
