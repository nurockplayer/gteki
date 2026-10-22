# DR-SX: Shinjuku E27 exit identification, official aliases, facility facts

## 1. Header

- Tracking: issue #165 item R11 (requested by sjk-search-19); GTEki #106; GTEki #5 (station facts). Extends `DR-SJ-station-facts.md` (R2); ids DR-SJ-01..16 are cited from there, not re-read.
- Checked: 2026-10-22 (JST). First pass ~17:10 (repo only, quota limit hit); second pass ~21:10 (after 19:30): Toei 新宿 JA page, its exit-list data feed (non-coordinate fields only; coordinate fields were stripped in the browser before output and never recorded) and the Toei English pages, read in ego-lite one page at a time. No downloads. Public sources only; nobody contacted.
- Rules applied: OD-01 (Toei plain facts usable), OD-02 (no JR East data), OD-05 (aggregators are indicators only), OD-06; Toei per-exit coordinate feed not used.
- The repo file was re-created at 21:15 because the earlier copy was no longer in the scratchpad.

## 2. Summary

1. **Q1 (is any of the six E27 exit points the closed official exit 1 or 2?): GAP. Not determinable from stated facts.**
   - Official side: Toei tags exits 1 and 2 as 閉鎖中. Exit 1 has no landmark text (ー). Exit 2's landmarks are JR東京総合病院, JR新宿ビル, ミヤコ新宿ビル, バスタ新宿. The closure notice calls it "2番出口 of 京王新線・都営新宿線 新宿駅" [DR-SJ-05]. No official text read says which line's structure exits 1 or 2 belong to.
   - Repo side: the six E27 exit points are described only by floor, a computed relative compass word and the device at the node (3b, REPO-1..5). The repo records no exit number, street or building for any of them.
   - Nothing stated links the two sets. No match is claimed for exit 1 or 2 and none is excluded. What would settle it: plate text read at each of the six E27 exit points (FC-SX-01).
2. **One candidate lead, not a match:** Toei flags exit A1 as the only 新宿 exit with a lift icon; in repo data the only exit point whose node has a lift link is `poi:exit:3`. The Toei page does not say A1's lift is an 大江戸線 lift (only the tag マインズタワー方面改札), so the unique-attribute test is not met. Settled by FC-SX-02.
3. **Aliases:** English "Shinjuku" (S-01 / E-27), "Shinjuku-nishiguchi" (E-01), "Oedo Line" are on Toei's English pages. Traditional/Simplified Chinese and Korean official names: **GAP, not found** on Toei's site; the only language menu mention is of machine translation (3c).
4. **Facilities:** Toei text says only "バリアフリートイレ: あり" per line and lift/escalator counts; no floor, no gate. Comparison with `poi:toilet:1-3` and `poi:elevator:1-3` is "not determinable" throughout (3d).

## 3. Findings

### Repo-data facts (read-only; `stations/shinjuku/gteki/{pois,graph,station}.json`, `data/plan.json`, `tools/import-e27.ts`)

- [REPO-1] The importer takes each GSI facility F108 (exit point) on map level 1 or B1 and attaches the nearest same-floor walkway node within 6 m. Names are generated: a floor word (地上 for map level 1, 地下1階 for B1) plus a compass word computed from the node position relative to the centroid of all E27 nodes. The compass word is a relative direction inside the slice, not a street-side statement. Every exit POI carries the note "Exit number/name not in source (coverage gap)".
- [REPO-2] Six exit POIs: `poi:exit:1` (street level, "north"), `:2` (street level, "northwest"), `:3` (street level, "south"), `:4` (street level, "south"), `:5` (B1, "north"), `:6` (B1, "south"). `poi:exit:3` sits on node floor `toei-nwd-1` (1F); exit:1, :2, :4 at street (0); exit:5, :6 at B1.
- [REPO-3] Link at each exit node (graph.json, importer-derived from the MLIT walking-network data, not operator statements): exit:1 one stairs link; exit:2 one level walk link (wheelchair true); exit:3 one **elevator** link (wheelchair-accessible code 5) plus one walk link; exit:4 one walk link; exit:5 one stairs link (B1); exit:6 one walk link (B1).
- [REPO-4] GSI space category containing the F108 point or node (plan.json): exit:1 point in B021 (stairs); exit:3 node in B022 (elevator); exit:5 point and node in B021; exit:6 in B029; exit:2 and exit:4: no containing space polygon. The meaning of B029 is not stated in the repo and is not interpreted.
- [REPO-5] Edge attribute `roof` at the exit nodes (raw codes; meaning not documented in the repo and not verified): exit:1 code 2; exit:2 code 1; exit:3 elevator link 2, walk link 1; exit:4 code 1; exit:5 code 2; exit:6 code 2.
- [REPO-6] All six exits `paid:false` in pois.json. No operator fare-gate text is attached.
- [REPO-7] NWD link maint_date 2025-09-19, after the 2024-03-30 exit-2 closure; all exit edges carry `closed:false`, `hours:null`. The dataset does not record closures, which says nothing about whether any exit is open. The Shinjuku README cites only OSM for the exit-2 closure and calls it outside E27 data.

### Official facts

- [DR-SX-01] Toei 新宿 page (one page for S01 and E27). Exit list (feed fields: gateway, landmark names `facilities`, icon codes, remark), read 2026-10-22: A1, 1-8. Remarks: A1 【マインズタワー方面改札】; 1 and 2 閉鎖中; 3, 4, 5 【京王新線口】; 6, 7, 8 【新都心口】. Hours: 4, 5, 6, 7 6:00～23:00; 8 7:00～23:00; A1 and 3 none shown. Icons: A1 lift + escalator(up complete); 8 escalator(up); none elsewhere. The page does not attribute exits to a line except through these tags. The 大江戸線 block of the page lists a Shibuya-ku address (代々木2-1-1) and lists no exits of its own.
- [DR-SX-01] Facilities block: 新宿線 escalators 14, lifts 1; 大江戸線 escalators 16, lifts 2; "1ルートの確保: 済み" for both; "バリアフリートイレ（車椅子使用者対応トイレ）: あり" for both; 設備 block for 大江戸線 empty. Transfers named: JR山手線, 中央・総武線（各駅停車）, 中央線快速, 埼京線, 湘南新宿ライン; 京王線; 小田急線 (JR names are Toei's own text, not JR data).
- [DR-SJ-05] Exit 2 closed from first train 2024-03-30 (ミヤコ新宿ビル demolition); notice names "京王新線・都営新宿線 新宿駅".
- [DR-SX-02] Toei English pages: "Shinjuku", codes S 01 / E 27, adjacent stations "Hatsudai (Keio Line)", "Shinjuku-sanchome (S-02)", "Yoyogi (E-26)", "Tochomae [Tokyo Metropolitan Government] (E-28)"; the page has a "Station Map" link and no exit or facility text. "Shinjuku-nishiguchi", code E 01, adjacent "Tochomae (E-28)" and "Higashi-shinjuku (E-02)".

### 3b. Per-exit table (official exit | operator line | stated facts | source_ids | E27 node match)

Operator line = what the source states; Toei states no line for any exit except through tags.

| Official exit | Operator line (as stated) | Stated facts (landmarks are the page's own list) | source_ids | E27 node match |
|---|---|---|---|---|
| A1 | tag マインズタワー方面改札 | landmarks 新宿マインズタワー, ホテルサンルート東京, JR東京総合病院, JR東日本本社ビル, 小田急サザンタワー, タカシマヤ タイムズスクエア, 代々木第二郵便局; icons lift + escalator | DR-SX-01 | GAP. Candidate lead only: `poi:exit:3` is the only E27 exit point with a lift link; the page does not say which line A1's lift serves |
| 1 | not stated | 閉鎖中; no landmark text; no icon | DR-SX-01 | GAP (nothing to compare) |
| 2 | notice: exit of 京王新線・都営新宿線 新宿駅 | 閉鎖中 (since 2024-03-30); landmarks JR東京総合病院, JR新宿ビル, ミヤコ新宿ビル, バスタ新宿; no icon | DR-SX-01, DR-SJ-05 | GAP: repo records no building or landmark for any of the six points |
| 3 | tag 京王新線口 | no landmark text; no icon; no hours | DR-SX-01 | GAP |
| 4 | tag 京王新線口 | no landmark text; 6:00～23:00; no icon | DR-SX-01 | GAP |
| 5 | tag 京王新線口 | landmarks 新宿郵便局, 工学院大学; 6:00～23:00; no icon | DR-SX-01 | GAP |
| 6 | tag 新都心口 | landmarks 文化女子大学, 文化服飾学院; 6:00～23:00; no icon | DR-SX-01 | GAP |
| 7 | tag 新都心口 | landmarks 京王プラザホテル, 工学院大学; 6:00～23:00; no icon | DR-SX-01 | GAP |
| 8 | tag 新都心口 | landmark 東京都庁; 7:00～23:00; escalator(up) icon | DR-SX-01 | GAP |

Notes: (a) Landmark lists are names only. No street, intersection, side-of-street or "opens to street vs into an underground space" statement is on the Toei page: GAP for every exit; 新宿区 legend (DOS:S09) and Keio pages were not re-read in this pass. (b) 工学院大学 appears under both exit 5 and exit 7, so it identifies neither alone. (c) The transfer page text names landmarks that sit on the 西新宿 side (e.g. 東京都庁, 京王プラザホテル) and on the 代々木 side (A1); the repo's slice has no landmark layer to compare.

### 3c. Alias table (alias | language | official source | date)

| alias | language | official source | date |
|---|---|---|---|
| 新宿 (reading しんじゅく) | ja | Toei JA 新宿 page (DR-SX-01) | 2026-10-22 |
| Shinjuku (station codes S-01 / E-27) | en | https://www.kotsu.metro.tokyo.jp/eng/subway_stations/shinjuku.html (DR-SX-02) | 2026-10-22 |
| Shinjuku-nishiguchi (E-01) | en | https://www.kotsu.metro.tokyo.jp/eng/subway_stations/shinjuku-nishiguchi.html (DR-SX-02) | 2026-10-22 |
| Oedo Line | en | Toei English site navigation, https://www.kotsu.metro.tokyo.jp/eng/ (DR-SX-02) | 2026-10-22 |
| 繁體中文, 简体中文, 한국어 names of 新宿 / 新宿西口 / 大江戸線 | zh-Hant / zh-Hans / ko | **GAP: not found.** Toei's English maps page offers route maps in English, Deutsch, Español, Français, Русский only (https://www.kotsu.metro.tokyo.jp/eng/maps/). A search summary mentioned a site language menu (简体中文, 繁體中文, 한국어) described as machine translation; not confirmed here, and machine translation is not an official name. Guessed zh/ko map-PDF URLs returned 200 for every guess (soft pages), so nothing is inferred from them | 2026-10-22 |

Toei station-name signage standard / multilingual naming guideline: not found in this pass (GAP). The repo's `station.json` names ("Shinjuku Station (Toei Oedo Line)", "新宿站（都營大江戶線）") are repo-authored with no official source cited; do not treat them as official aliases.

### 3d. Facility comparison (Toei text vs repo)

| Item | Toei official text | Repo description | Verdict |
|---|---|---|---|
| Toilets (poi:toilet:1 women, :2 unisex, :3 men) | Per line "バリアフリートイレ（車椅子使用者対応トイレ）: あり"; no floor, gate or multipurpose wording (DR-SX-01) | All three on B3 (`toei-nwd-m3`), `paid:true` (inside fare area per GSI toll); the unisex one is named 男女共用 with no accessible claim | Floor B3 and inside-gate: **not determinable** from Toei text. Unisex vs wheelchair-capable: not determinable (different wording). Indicator only (OD-05): Yahoo!乗換案内 lists the 大江戸線 multipurpose toilet at "B4F通路内" [DR-SJ-13]; the repo plan has no B4 level; unresolved, not to be cited as fact |
| Lifts (poi:elevator:1 1F/B1/B2; :2 B1/B3; :3 B2/B3/B6) | 大江戸線 lifts 2; 新宿線 lifts 1; "1ルートの確保: 済み" | Three lift groups (links grouped within 4 m) | Count: **not determinable** (grouping method differs from a physical lift count; three groups vs 2 stated). Floors served: not stated by Toei |
| Lift at exit A1 | A1 has a lift icon | `poi:elevator:1` links to the exit:3 node (1F) | **Not determinable**; candidate lead only |
| Other exits | no lift icon on 1-7; escalator(up) icon on 8 | exit:1 and :5 stairs; exit:2, :4, :6 level walk | Not comparable until exits are identified |
| Fare zone of exits | no gate statement | exits `paid:false` | Not determinable |

Data are not edited by this file. Coin lockers / ATMs: skipped (low priority).

## 4. Source records

| source_id | title | publisher | URL | date | checked | terms (+URL) | modification | redistribution | availability | rights class | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DR-SX-01 | Toei 新宿 station page and its exit-list feed (non-coordinate fields) | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html | not stated | 2026-10-22 | 著作権 reserved; 無断使用・転載禁止 (https://www.kotsu.metro.tokyo.jp/riyo/) | UNKNOWN | UNKNOWN | PAGE_READ (browser; WebFetch returns an empty page) | FACTS_ONLY_REFERENCE | Same page as DR-SJ-01; coordinate fields stripped before output, not recorded; landmark names and tags are facts, no layout or long text copied |
| DR-SX-02 | Toei English station pages 新宿 and 新宿西口; maps page; English index | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/eng/subway_stations/shinjuku.html ; https://www.kotsu.metro.tokyo.jp/eng/subway_stations/shinjuku-nishiguchi.html ; https://www.kotsu.metro.tokyo.jp/eng/maps/ | not stated | 2026-10-22 | as DR-SX-01 (English site has "Terms & Conditions"; not read) | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | Names and station codes only |
| DR-SX-03 | 新宿ターミナルマップ legend | 新宿区 | https://www.city.shinjuku.lg.jp/content/000423320.pdf | 2025-11 | not re-read this pass | as DR-SJ-10 | no | no | NOT_FETCHED | FACTS_ONLY_REFERENCE | Legend text for street/underground exit labels still unread |
| DR-SX-04 | Repo data (pois/graph/station/plan/import-e27) | GTEki repo | `stations/shinjuku/` in the data-research worktree | 2026-10-20 | 2026-10-22 | repo; underlying MLIT PDL 1.0 | yes with attribution | yes with attribution | FILE_INSPECTED | REUSABLE_WITH_CONDITIONS | Source of REPO-1..7 |
| DR-SX-05 | Web search result summaries (language menu claim) | search engine | n/a | n/a | 2026-10-22 | n/a | n/a | n/a | DISCOVERED | UNKNOWN | Indicator only; unverified, machine translation |

## 5. What this does not establish

- Whether any of the six E27 exit points is official exit 1 or 2, or any other numbered exit.
- Any street, intersection or side-of-street for any exit, and whether each opens to street level or underground space.
- Which line (S01 or E27) exits 3-8 belong to beyond Toei's tags.
- Official Chinese or Korean names, or any Toei signage standard.
- Toilet floor or gate, and lift locations or counts, from an operator text.
- The meaning of `roof` codes and the space code B029.
- The 新宿区 legend and Keio pages were not read in this pass.

## 6. Handoff for sjk-search-19 (and GIS)

- Do not label any E27 exit point with an official number. Q1 is a GAP; keep the repo's neutral names.
- You may state (OD-01): Toei lists exits 1 and 2 as closed (2026-10-22); exit 2 closed 2024-03-30 for the ミヤコ新宿ビル demolition; tags, hours and landmark names per 3b.
- Search leads per 3b: exit 1 has no landmark text; exit 2 landmarks are JR東京総合病院, JR新宿ビル, ミヤコ新宿ビル, バスタ新宿 (the first two also appear under A1/other lists, so JR東京総合病院 alone does not identify exit 2). Check whether any of the six E27 points can be located relative to those buildings from a public source before pairing; do not use Toei coordinates.
- Candidate to test first in the field: `poi:exit:3` against exit A1 (lift). Not a match.
- English names (3c) can be used with their Toei source URLs. Do not present zh/ko names as official.
- GIS: no action.

## 7. Field items (sign photos are private evidence only)

| id | place | observe / measure | method | est. cost (min) | paid area? | unblocks |
|---|---|---|---|---|---|---|
| FC-SX-01 | The six E27 exit points (poi:exit:1-6) | Plate text (exit number, line tag), adjacent street or building name, whether it opens to street or an underground space, device | Walk each; write text; photos private | 40 | No | Q1, per-exit table |
| FC-SX-02 | Exit A1 and `poi:exit:3` location | Whether they are the same lift, which line it serves, floors | Walk; note signage | 20 | possible | Section 2 item 2 |
| FC-SX-03 | E27 accessible toilet(s) | Floor, inside the fare gate or not, nearest gate, sign wording | Walk; note signs | 30 | Yes (inside gate) | 3d toilet row (overlaps FC-SJ-03) |
| FC-SX-04 | E27 lifts | Number, floors served, inside or outside gate | Walk | 30 | Yes | 3d lift row (overlaps FC-SJ-04) |
| FC-SX-05 | Station name signage at E27 | Languages and spellings shown (en, zh, ko) | Walk; write text | 15 | No | 3c zh/ko GAP |

## 8. Owner decisions (new only)

None new. OD-01 covers Toei plain facts; OD-05 keeps the aggregator toilet floor (B4F) as an indicator only.
