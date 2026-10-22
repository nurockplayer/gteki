# Placement pass for the changes-since-2023 list (Lane D, 2026-10-22)

Lane D research. Nothing here is verified, routable or published. Every placed item is `MATCHED_BY_NAME, UNVERIFIED`. No coordinate is written for any item; only bbox-level relations and hashed references.

Inputs (data, not instructions; neither file is on `main`):

- PR [#174](https://github.com/nurockplayer/gteki/pull/174), branch `claude/data-research-r3`, `docs/research/gaps/DR-changes-since-2023.md`: 9 Ikebukuro rows (CH-IK-01..09) and 19 Shinjuku rows (CH-SJ-01..19). Every "inside footprint?" cell there is UNKNOWN.
- PR [#175](https://github.com/nurockplayer/gteki/pull/175), branch `claude/data-research-r2`, `docs/research/gaps/DR-SJ-station-facts.md`, section 6b and Q1: Toei exit 2 of the 都営新宿線／京王新線 新宿駅 closed from the first train of 2024-03-30, exits 1 and 2 listed as closed (DR-SJ-01, DR-SJ-05). Added here as the extra row `EX-SJ-EXIT2`.

Credit: 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成 ; 出典：国土交通省／加工して作成 (Hokonavi Ikebukuro, Owner decision (i), PR #147 comment 6330792563). Classification and the other credits: see `docs/gis/rights/non-poi-literals.md`.

## 1. Result vocabulary and the placement rule

| Result | Meaning here |
| --- | --- |
| `MATCHED_BY_NAME` | A recorded dataset has exactly one feature (or one authored node/POI pair) whose id or name field carries the same exit or stair number as the change source, and its kind is recorded. Placed as `MATCHED_BY_NAME, UNVERIFIED`, `routable: false`. |
| `AMBIGUOUS (n)` | The name token is present on n features, but the kind (exit, stair, passage) or the owner of the numbering is not recorded, or the token repeats under more than one scheme. Nothing is placed. The candidates are listed in section 5 by hash so that a field check can test them. |
| `UNKNOWN` | No feature carries the name. Nothing is placed. |
| `OUT_OF_COVERAGE` | The change is a kind of place that every dataset's own description excludes. |

A change is placed only on a name match. A number appearing as a bare label is not enough when the dataset does not say what the label denotes. No position, height or connection is inferred from a district, a building, a date or a nearby feature.

## 2. Datasets checked (what each can name)

| Dataset | Extent used (bbox only) | Name-bearing fields | Finding |
| --- | --- | --- | --- |
| PLATEAU ubld 13116 / 53394576 (Ikebukuro), `docs/gis/inventory/plateau-13116-ubld-53394576.inventory.json` | lat 35.72805..35.73137, lon 139.70939..139.71337 | one `gml:name` on the `CityObjectGroup` (池袋駅_B1地下通路) | No stair, exit or passage names. G0 audit: "No names on rooms or passages ... no exit numbers". Stairs and ramps appear only as `EF_35` installations (2 observed in the inventory), without numbers. |
| PLATEAU ubld 13104 / 53394536 (Shinjuku), `docs/gis/inventory/plateau-13104-ubld-53394536.inventory.json` | lat 35.69070..35.69501, lon 139.69803..139.70362 | one `gml:name` on the `uro:UndergroundBuilding` (新宿駅周辺エリア) | No stair, exit or passage names. Stairs, escalators, elevators: `UNKNOWN`, 0 observed. 155 compact features, 1 carries a name. |
| `docs/gis/overlaps/` | not present (the directory is `docs/gis/overlap/`; it holds bbox relations, no names) | none | Not used for naming. |
| Ikebukuro station repo, `stations/ikebukuro/gteki/{graph,pois}.json`, `data/graph.src.json` | 62 graph nodes, 52 POIs; all 62 nodes fall inside the ubld 13116 bbox (see 3.1) | node ids and POI ids/names authored by GTEki | 20 `exit` nodes and 3 `stair_end` nodes (`x13f`, `x4f`, `x36f`); 38 exit POIs. Exit numbers come from the Toshima 2022 guide and the Tokyo Metro yard map as facts (G0 audit); geometry comes from PLATEAU stair tops. Public passages are named 中央通路, 北通路, 南通路 and similar. No `C1b`, `2b`, `1b`, `地下道` or 第3/第4号線 object. |
| Hokonavi Ikebukuro R1 node/link GeoJSON (store copy, `docs/gis/networks/hokonavi-ikebukuro-walk-*`) | lat 35.72414..35.73373, lon 139.69534..139.72292 | none: node keys are `node_id, lat, lon, floor, in_out, link*_id`; link keys are `link_id, start_id, end_id, distance, rank, ...` | No name or number field. Ids are numeric network ids. Cannot name anything. |
| Hokonavi E27 network and station map (Toei Oedo E27 only), `docs/gis/acquisitions/hokonavi-oedo-*` | network bbox lat 35.68684..35.68902, lon 139.69834..139.69963; station-map bbox not recorded (CRS undefined in the inventory) | network: none (ids only). Station map: `name` is blank on 453 of 465 features; the other 12 are floor features (class (b), not printed). | No stair, exit or passage name or number. The network bbox lies entirely south of the ubld 13104 bbox (top edge 35.68902 against bottom edge 35.69070), so the two layers do not overlap. The Shinjuku station repo says of its own exit POIs: "Exit number/name not in source (coverage gap)"; its `poi:exit:N` ids are internal ordinals, not official numbers. |
| S03 Tokyo data, `tokyo-s03-zip` (Shinjuku terminal; 25 members; 11 `geojson-level-geom-*` files, 15,556 features, WGS84 lon/lat by the specification's default rule per `2026-10-22-shinjuku-poi-next-gaps.md` section A) | all levels together: lat 35.68652..35.69531, lon 139.69653..139.70374 (partly inside ubld 13104 and partly inside the E27 network bbox) | per feature: `display_name`, `facility`, `entities`; entity file `com-entity.geojson` (423 entities) with `name`. Hashed ids and counts only here (POI guard covers S03). | 402 features are of kind `stairs`; all 402 carry one identical generic label and no number, so stair numbers cannot be matched to any stairs feature. 82 entities have a short code-like name (1 to 3 characters: numbers 1..22 plus letters and letter-number codes). They group a point on B1F, a point on B3F and polygons on 1F in the cases tested; the kind they denote is not recorded and the specification defines no exit or entrance type (#175 DR-SJ-09). Details in section 5. |

Rights notes: S03 neutral geometry and factual fields may be used (Owner Q2/Q3), but this file prints no S03 value. The Toei data feed's per-exit coordinates were not used (Owner decision pending). PLATEAU ubld `gml:name` values are class (a) and appear above with the credit. E27 labels and ids are class (b) and are not printed.

## 3. Placed item

### 3.1 CH-IK-04, stairs 36 and 37: `MATCHED_BY_NAME, UNVERIFIED`

| | Stair 36 / exit 36 | Stair 37 / exit 37 |
| --- | --- | --- |
| Dataset | Ikebukuro station repo, `stations/ikebukuro/gteki/` | same |
| Feature reference | POI `exit-36` (connector node `x36f`, kind `stair_end`, floor `b1`) | POI `exit-37` (connector node `x37`, kind `exit`, floor `street`) |
| Name basis | The POI id and its name carry the number 36; the change source names stair/exit 36 | same for 37 |
| Inside ubld 13116 bbox | yes (bbox arithmetic, local ENU converted with a spherical-tangent approximation; margin to the nearest bbox edge is about 100 m) | yes |
| Inside Hokonavi Ikebukuro bbox | yes | yes |
| E27 layer extent | not applicable (Shinjuku only) | not applicable |

Caveats that keep this `UNVERIFIED`:

- PLATEAU itself carries no exit numbers. The link number to position is GTEki's own map reading (Toshima 2022 guide, Tokyo Metro yard map: facts only), matched to PLATEAU stair-top closures within 1 to 7 m (G0 audit). `exit-36`'s own note says PLATEAU surveys only the lower flight of that stair.
- The #174 text calls them "stairs 36 and 37" (a committee statement about new escalators and an elevator, outcome unknown). The repo calls them exits 36 and 37. The match is on the number only, and the repo pairs the number with the exit stairs at those locations.
- This places the stairs that exist in the repo data. Whether escalators or an elevator were built (the change) remains `UNKNOWN`.

Field check: stand at the east-side stairs by the Seibu/Yodobashi frontage, read the posted number on each exit, record whether escalators or a lift now sit beside the stairs, and take the position with the field method already used for the other exits.

## 4. Per-item results

Abbreviations: TOKEN = token-only candidates (section 5); the datasets named are those in section 2.

### 4.1 Ikebukuro (#174 section 2a)

| id | Change (short) | Result | Why | A field check would need |
| --- | --- | --- | --- | --- |
| CH-IK-01 | Fukutoshin exit `C1b` (new), C1 renamed `C1a` | UNKNOWN | No `C1`, `C1a` or `C1b` in the repo graph or POIs. The G0 audit lists the Echika/Fukutoshin C exits as not modelled by the ubld. Hokonavi has no names. The street end may lie inside the Hokonavi bbox, but no feature names it. | Exit sign photo, which passage it joins, lift presence, opening date; its position |
| CH-IK-02 | Metro exit `2b` closed 2024-09-30 to 2025-07-07 (planned) | UNKNOWN | No exit `2`, `2a` or `2b` in the repo (the 38 exit POIs are numbered 4 to 43, none below 4, with letter suffixes only on 6a/6b). | Open or closed today; sign; position |
| CH-IK-03 | Metro exit `1b`, sign changed | UNKNOWN | No exit `1` or `1b` in the repo. | Sign; position |
| CH-IK-04 | stairs 36 / 37, escalators and lift considered | MATCHED_BY_NAME, UNVERIFIED | Section 3.1 | Section 3.1 |
| CH-IK-05 | 西口 and 直上西 district redevelopment (district plan) | UNKNOWN | A district, not a named feature. The repo exits 5, 6a, 6b, 7, 8, 9 are west-side exits, but #174 names none of them, so no link is made. | Hoarding and re-routing at exits 5 to 9 (#174 FC-CH-04) |
| CH-IK-06 | 地下道第3号線 / 第4号線 (city-planned designations, 西池袋一丁目) | UNKNOWN | The designations are planning line numbers. No repo object is named 地下道 or 第3/第4号線; the repo's passages (中央通路, 北通路, 南通路, west/east B1 exit passages) are different names. The number 3 or 4 is not a stair or exit number here and is not matched. | A map from the planning lines to physical passages from the ward; a field walk of the west passage |
| CH-IK-07 | 東西自由通路 north deck over the tracks (concept) | UNKNOWN | Not built. The repo's 北通路 (a B1 passage) is a different object from the 北デッキ and is not matched. | Nothing until built |
| CH-IK-08 | 東口 station-front plaza re-plan (concept) | UNKNOWN | Not built; no named feature. | Nothing until built |
| CH-IK-09 | Tobu Tojo line tracks and platforms, 350 m deck (announced) | OUT_OF_COVERAGE | Platforms, tracks and fare-paid areas are outside every dataset by their own description: the G0 audit says the ubld does not model fare-paid concourses or platforms, and Hokonavi is a street-level walk network. | Not applicable until a plan with a footprint exists |

### 4.2 Shinjuku (#174 section 2b) and the extra row

| id | Change (short) | Result | Why | A field check would need |
| --- | --- | --- | --- | --- |
| CH-SJ-01 | West Exit B1 stairs No.1 (closed 2023-11-14) and No.2 (closed 2023-10-23) | AMBIGUOUS (4 + 4, TOKEN) | S03 has a bare label equal to 1 and one equal to 2, each on 1 entity and 4 features (2 polygons on 1F, a point on B1F, a point on B3F), all inside the ubld 13104 bbox and outside the E27 network bbox. The label does not say stair, exit or passage, and the same numbers are shared across several numbering schemes in the file (see 5.2). The 402 `stairs` features carry no number. E27 and the ubld carry no numbers. Not placed. | Walk the plaza, record which numbered signs exist and which are stairs; mark the entities in section 5 on a plan; test whether label 1 and 2 are the plaza stairs. The closures predate nothing in S03 that records them. |
| CH-SJ-02 | West Exit B1 north passage (closed 2023-11-10) | UNKNOWN | S03 has 3 passage-like names (JR/Keio and JR/Odakyu passages and one West underground exit); none is a "north passage" of the plaza and none is matched. No other dataset names a passage. | A dated walk of the plaza, passage endpoints and their position |
| CH-SJ-03 | West Exit elevators A and B, temporary lifts | UNKNOWN | S03 has 103 elevator-kind features under one generic label. Elevators are not covered by the exit/stair/passage rule. Bare labels `A` and `B` exist but their kind is unrecorded and they are not accepted. | Lift positions and the current lift list |
| CH-SJ-04 | B1 public restroom No.1 abolished, No.2 renamed | UNKNOWN | S03 has 17+17 gendered toilet labels and 6 multipurpose, none numbered as No.1 or No.2. A toilet is a POI; S03 values are not quoted. No other dataset. | Walk; toilet position and name |
| CH-SJ-05 | Bus area stair No.12 closed 2023-02-28; WE bus stop moves | AMBIGUOUS (4, TOKEN) for stair 12; UNKNOWN for the bus stop | S03 has a bare label equal to 12: 1 entity, 4 features, inside the ubld 13104 bbox and outside the E27 network bbox. Same token-only limits as CH-SJ-01. Bus stops: no feature. | Same walk as CH-SJ-01 |
| CH-SJ-06 | カリヨンデッキ deck demolition | UNKNOWN | No feature named for the deck in any dataset (S03 name search found none). | Deck outline from a dated walk |
| CH-SJ-07 | West underground passage switch, 2024-11-16 (temporary passages, 70 cm level change) | UNKNOWN | Passages as a set are not named in any dataset; S03 vintage predates the switch. | A dated plan of the open passages and level changes |
| CH-SJ-08 | West ground passage switch, 2024-11-23 | UNKNOWN | As CH-SJ-07. | As CH-SJ-07, ground level |
| CH-SJ-09 | B1 rotary reduced; taxi stands moved | UNKNOWN | No named rotary or taxi stand. | Rotary outline |
| CH-SJ-10 | Ground flow change, 2025-09-27 | UNKNOWN | No named feature. | Ground flows |
| CH-SJ-11 | West ground passages, 2026-02-17 | UNKNOWN | No named feature. | As CH-SJ-08 |
| CH-SJ-12 | West underground passages, 2026-04-07 (sections not passable, 70 cm change) | UNKNOWN | No named feature. | As CH-SJ-07, dated after 2026-04-07 |
| CH-SJ-13 | Stair 11 (B1 to ground, bus side) closed; temporary stair built, 2026-06-23 | AMBIGUOUS (4, TOKEN) | S03 has a bare label equal to 11: 1 entity, 4 features, inside the ubld 13104 bbox and outside the E27 network bbox. Token-only. The new temporary stair has no feature anywhere. | Walk; record stair 11 and the temporary stair, with positions |
| CH-SJ-14 | Road improvement on the plaza surface, 2026-10 to 2027-02 | UNKNOWN | No named surface feature; S03 1F covers the area but names none of these works. | Not a placement target (surface works); observe curb and crossing changes |
| CH-SJ-15 | 新宿駅西口 district development plan (Odakyu site) | UNKNOWN | A site, not a named feature. | Hoarding outline |
| CH-SJ-16 | Keio B2 platform extension and new gate (FY2030) | UNKNOWN | No named feature; future work. | Deferred (#174 FC-CH-05) |
| CH-SJ-17 | 西南口 district development | UNKNOWN | S03 has south-exit names for JR, Odakyu and Keio lines but none named 西南口; no match. | Hoarding outline |
| CH-SJ-18 | 東西自由通路 inside JR station, works complete 2024-03-08 | UNKNOWN | No dataset names it. S03's passage-like names are other passages. | Not applicable inside the paid area |
| CH-SJ-19 | West plaza design principles | UNKNOWN | A policy, not a feature. | None |
| EX-SJ-EXIT2 | Toei/Keio 新宿線 新宿駅 exit 2 closed from 2024-03-30; exit 1 also listed closed ([#175](https://github.com/nurockplayer/gteki/pull/175), DR-SJ-01, DR-SJ-05) | AMBIGUOUS (4, TOKEN); E27 layer: OUT_OF_COVERAGE | Not placed. (1) E27 is the Oedo line only: no exit number in its data, and the Shinjuku station repo notes "Exit number/name not in source", so its `poi:exit:2` is an internal ordinal, not the official exit 2. (2) S03 has a bare label equal to 2 on 1 entity, 4 features (the same entity that CH-SJ-01 would use for stair 2), inside the ubld 13104 bbox and outside the E27 network bbox. S03 defines no exit or entrance type, and S03 nav nodes were not used. The same label cannot be both the plaza's stair 2 and the Toei exit 2, which is itself the ambiguity. (3) S03 predates the closure. | A dated walk: the exit 2 gate and which passage it served (the notice has this only on a drawing); position by a field method. The Toei per-exit coordinates are not used. |

## 5. Token-only candidates in S03 (not placed)

### 5.1 Candidates for the numbers the change lists name

References are `sha256` of the decimal entity id text, first 12 hex characters (S03 values are not printed). Each entity groups 4 level features: 2 polygons on 1F, 1 point on B1F, 1 point on B3F. All 4 are inside the ubld 13104 bbox and outside the E27 network bbox.

| Label (the number) | Entity ref | Used by |
| --- | --- | --- |
| 1 | `47c8fbae13ae` | CH-SJ-01 |
| 2 | `892478ad49ce` | CH-SJ-01, EX-SJ-EXIT2 |
| 11 | `fe06d95094c2` | CH-SJ-13 |
| 12 | `8d3d3e64d1e0` | CH-SJ-05 |

Feature refs (same hashing of the feature id), in the order 1F, 1F, B1F, B3F:

- label 1: `f3a090d21a72`, `1a15cdb4ce49`, `9c436bdaad71`, `7a2d9e823fae`
- label 2: `192c181b1d5c`, `212d4f83327a`, `83624cc25f7a`, `f971053ff6e8`
- label 11: `402f847d090a`, `3d44faa8b2bb`, `2d9400f28ec9`, `0befce514d87`
- label 12: `c20bc048fcf1`, `e4622380689a`, `3acc05bacf6b`, `eeb8be187c21`

### 5.2 Why they are not accepted

- The kind is not recorded: the B1F and B3F items are passage-kind points and the 1F items are unclassified polygons; none is `stairs`-kind, and the 402 `stairs` features carry no number.
- The numbering is not unique across schemes. The label 3 sits on 2 separate entities: one inside the ubld 13104 bbox and one inside the E27 network bbox (6 features in all). The code-like names include plain numbers 1..22 and letter-number codes, which cannot all belong to the West Exit plaza stairs.
- The same entity is the only candidate for both CH-SJ-01 (stair 2) and the Toei exit 2, so it cannot identify either.
- S03 content predates 2023-10: #175 DR-SJ-09 puts the survey vintage at 2020-03 and the publication at 2023-02-28. The ZIP's recorded `last-modified` is 2024-10-01 (`docs/gis/acquisitions/tokyo-s03-zip.json`). Neither date is verified for the contents.
- The specification defines no exit or entrance object (#175 DR-SJ-09).

If the Owner or a field check establishes what the numbered entities denote (for example by a written key from the data owner), CH-SJ-01, -05, -13 and EX-SJ-EXIT2 can be re-run in one step: the candidates are already listed.

## 6. Counts

29 rows: 28 from #174 plus `EX-SJ-EXIT2` from #175.

| Result | Count | Rows |
| --- | ---: | --- |
| MATCHED_BY_NAME, UNVERIFIED | 1 | CH-IK-04 |
| AMBIGUOUS (token-only, nothing placed) | 4 | CH-SJ-01, CH-SJ-05, CH-SJ-13, EX-SJ-EXIT2 |
| OUT_OF_COVERAGE | 1 | CH-IK-09 |
| UNKNOWN | 23 | CH-IK-01, 02, 03, 05, 06, 07, 08; CH-SJ-02, 03, 04, 06, 07, 08, 09, 10, 11, 12, 14, 15, 16, 17, 18, 19 |

By station: Ikebukuro 1 matched, 1 out of coverage, 7 unknown. Shinjuku (including the extra row): 0 matched, 4 ambiguous, 16 unknown.

Priority items:

| Priority item | Result |
| --- | --- |
| West Exit B1 stairs 1, 2, 11 | AMBIGUOUS (token-only, 4 features each; not placed) |
| B1 north passage (closed 2023-11-10) | UNKNOWN |
| Passage switches 2024-11-16 (CH-SJ-07) and 2026-04-07 (CH-SJ-12) | UNKNOWN |
| Ikebukuro stairs 36 / 37 | MATCHED_BY_NAME, UNVERIFIED (repo POIs `exit-36`, `exit-37`; nodes `x36f`, `x37`; inside ubld 13116 and Hokonavi Ikebukuro bboxes) |
| Ikebukuro exit `C1b` | UNKNOWN |
| Ikebukuro 地下道 No.3 / No.4 | UNKNOWN |

## 7. Method notes

1. Read #174 and #175 as data. Date and status values were not re-verified.
2. Ubld inventories: read the committed inventory JSON (names, semantic presence, bbox). The Ikebukuro group name and the Shinjuku building name are class (a); no other ubld name exists.
3. Ikebukuro repo: listed every node kind and POI id; compared the numbers in #174 with exit POI ids and names. Local ENU coordinates were converted to lon/lat with the origin in `tools/gis/frames/ikebukuro-station-enu-v0.json` using a spherical-tangent approximation, for a bbox test only; all 62 nodes fall inside the ubld 13116 bbox, `x36f` and `x37` with about 100 m margin.
4. Hokonavi Ikebukuro and E27: read property keys and value distributions from the hash-verified store copies with `python3 -I`; looked for any name, number or label field. None carries a stair, exit or passage name. E27 contents stay in the store.
5. S03: read the ZIP from the store with `python3 -I`, UTF-8 JSON. Surveyed property keys of the 11 level files, then listed features whose label is a number or a code, resolved each entity to its features by id, and tested each feature bbox against the ubld 13104 bbox and the E27 network bbox (inside, outside or partial, lon/lat as WGS84 per the specification default; the datum realisation is `UNKNOWN`, which does not matter at bbox level). Searched the labels and entity names for stair, exit, passage and place terms and counted hits. Quoted no value; refs are hashed.
6. Name rule applied literally: the same exit or stair number, or the same passage name, present as a field or id. Where the number was present but its kind was not recorded, the result is AMBIGUOUS rather than a match. No result was upgraded for plausibility.
7. Not done: no positions were derived, no route or connection was inferred, the Toei per-exit coordinate feed was not used, and the S03 nav file was not used.

## 8. Limits

- Bbox relations are bbox-level only. "Inside" is not a statement that a feature is on the ground at that spot.
- The S03 inventory report records station relevance as conditional numeric bbox arithmetic. That limit applies here too.
- Dates in this file come from #174 and #175. Their sources were desk-read there, not re-opened here.
- The one placed item is placed at the stairs that the repo already models, not at any change. Nothing in this file says a stair, exit or passage is open or closed today.

## 9. Update from data-research R8 (PR [#197](https://github.com/nurockplayer/gteki/pull/197), DR-RT-01..29)

None of these changes a result in section 4 or a count in section 6. Placement is still bounded by the datasets in section 2.

- **CH-IK-06:** the abolition (廃止) of 地下道第3号線 / 第4号線 is now confirmed in an opened document: the ward-hosted 東京都市計画道路の変更, 告示 令和6年11月11日. It is a planning designation that names no passage or exit. The result stays UNKNOWN, because no repo object or dataset feature carries the designation.
- **Metro exits 1a and C4:** Toshima 資料2 (2026-03-25) reports them back in service from 3月6日. Neither exit id is modelled in `stations/ikebukuro/gteki/pois.json` or the graph. This is not placed, and it is recorded as a dated fact only. Whether to add the exits is the Ikebukuro route lane's decision (ikb-route-ac).
- **CH-IK-01, exit C1b:** still planned-only (2024年11月下旬). R8 did not find the actual opening date. The result stays UNKNOWN.
