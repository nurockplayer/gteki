# 新宿駅 Shinjuku (E27) — expected search results (for Lane C)

Issue #106. This table is the contract for Lane C's per-station, table-driven search test. Lane B already checks every row below against the real `createSearchIndex` (`@gteki/search`) in `stations/shinjuku/test/search-truth.test.ts`; Lane C may copy the table into its own test. Nothing here changes ranking or UI.

**What is modelled.** Only the Toei Oedo Line Shinjuku station (E27), from the MLIT E27 station map and walking network (published under the Owner's #16 override; licence basis unconfirmed, not covered by PDL 1.0). JR, Keio, Odakyu and Tokyo Metro gates and platforms are listed **by name only** as 45 search-only POIs (#411, see the S03 section at the end). They can produce a hit, but never a route. The Toei Shinjuku Line and Shinjuku-nishiguchi (E01) are **not** modelled and must never produce a hit.

**How the index reads a POI.** `createSearchIndex` matches the query against every `names[].text` and `aliases[].text` of a POI (all languages together), after NFKC, lower-casing, katakana→hiragana and removal of spaces and punctuation. Per text: exact 100, prefix 80, suffix 70, substring 60, all-tokens/all-script-runs 40, ordered-subsequence fuzz up to 40; +5 if the POI has connectors; the best text scores the POI. Fuzz scores below 30 are subsequence noise, not a match: the tests count only hits with score >= 30 as "strong".

## Station-name anchor

The station-name hits ride on `poi:platform:oedo`, the one existing POI that stands for the station. Its names reuse the station record's own wording (`station.json`): ja 新宿駅（都営大江戸線）ホーム, en Toei Oedo Line platform (Shinjuku Station, E27). Its note says that the station is E27 only, and that other operators' gates and platforms are listed by name only from March 2020 data (search only). No new POI was added for the station name.

| Query | Language / kind | Expected top POI | Why |
| --- | --- | --- | --- |
| 新宿 | ja kanji | `poi:platform:oedo` | alias 新宿 (station.json name 新宿駅) |
| 新宿駅 | ja kanji | `poi:platform:oedo` | alias 新宿駅 |
| しんじゅく / シンジュク | kana (katakana folds to hiragana) | `poi:platform:oedo` | alias しんじゅく (reading of 新宿) |
| Shinjuku | en / romaji | `poi:platform:oedo` | alias Shinjuku; also in the en name |
| shinjuku station / shinjuku eki | en / romaji | `poi:platform:oedo` | aliases Shinjuku Station / shinjuku eki |
| E27 / e27 | station code | `poi:platform:oedo` | alias E27 (station.json code, operator toei) |
| 大江戸線 / 都営大江戸線 | ja line | `poi:platform:oedo` | aliases from station.json name 新宿駅（都営大江戸線） |
| Oedo / oedo line / Toei Oedo Line | en line | `poi:platform:oedo` | aliases from station.json en name |
| 新宿站 / 大江戶線 / 都營大江戶線 | zh-Hant | `poi:platform:oedo` | zh-Hant aliases from station.json 新宿站（都營大江戶線） |
| ホーム / 月台 | generic | `poi:platform:oedo` | the E27 platform (B6, paid side); S03 platform names that contain ホーム also match below it (search only) |

## Exits (no official exit numbers; every exit is told apart by descriptors)

Official exit numbers are a coverage gap (`gap:exit-numbers`). The internal ids `poi:exit:N` are **not** exit numbers and never appear in a display name. The names use level, compass side, the adjacent GSI space category within 0.5 m (stairs B021 / elevator B022 / escalator B023 / walkway B029; several are joined with 「と」 / "and"), and the E27 roof code. The compass side is the bearing of the F108 point from the **centroid of the mapped network nodes**, not from the ENU origin. The roof word appears only at street level, and only when the codes of all links within 1.5 m of the F108 point (any floor), plus every link inside the cited stairs / lift / escalator space, agree and none is 99 (不明). Otherwise it is left out.

| POI | ja name | en name |
| --- | --- | --- |
| `poi:exit:1` | 出口（地上・北側・階段に隣接・屋根あり） | Exit (street level, north side, next to stairs, roofed) |
| `poi:exit:2` | 出口（地上・北西側・通路/コンコースに隣接） | Exit (street level, northwest side, next to walkway/concourse) |
| `poi:exit:3` | 出口（地上・南側・エレベーターに隣接） | Exit (street level, south side, next to elevator) |
| `poi:exit:4` | 出口（地上・南側・階段とエスカレーターに隣接） | Exit (street level, south side, next to stairs and escalator) |
| `poi:exit:5` | 出口（地下1階・北側・階段に隣接） | Exit (underground level B1, north side, next to stairs) |
| `poi:exit:6` | 出口（地下1階・南側・通路/コンコースに隣接） | Exit (underground level B1, south side, next to walkway/concourse) |

Only `poi:exit:1` states a roof (all nearby links are roof = 2). `poi:exit:2`, `:3` and `:4` state none because the E27 codes around them disagree: for exit 4 the 3 m approach link is roof = 1 (なし) but the stair link 0.8 m away and the escalator link 1.1 m away are roof = 2 (あり); for exit 2 the approach link at 1.4 m is roof = 1 but two roof = 2 links lie at 1.0 m and 1.3 m. `poi:exit:5` and `:6` state none because a roof says nothing below street level. Nothing in the dataset supports a 「屋根なし」 / "no roof" exit name.

| Query | Kind | Expected top POI(s) | Why |
| --- | --- | --- | --- |
| でぐち / deguchi / exit | generic | all six exits (score 105 each) | generic aliases on every exit; the list is not ranked by distance |
| 出口 | ja generic | the six exits (score 105 each), plus the S03 search-only POIs whose names contain 出口 | the S03 names also contain 出口; those hits have no route (see the S03 section) |
| 出口 地上 | ja | exits 1–4 | prefix of the ja name, 85 |
| street level | en | exits 1–4 | substring of the en name; B1 exits do not say street level |
| 出口 地下1階 | ja | exits 5, 6 | prefix of the ja name. The reverse word order 地下1階 出口 returns nothing (the ranker needs the name's order) |
| exit B1 | en | exits 5, 6 | tokens exit + b1; only the B1 exits carry B1 |
| 屋根あり / roofed | ja / en | `poi:exit:1` | E27 roof = 2 on every nearby link |
| 階段 | ja | exits 1, 4, 5 | B021 stairs space at the F108 point |
| stairs | en | `poi:exit:5` (75, suffix), then exits 1 and 4 (65) | same fact |
| escalator / エスカレーター / 手扶梯 | en / ja / zh-Hant | `poi:exit:4` | B023 within 0.5 m of the exit point |
| exit street level south elevator | en | `poi:exit:3` (105) | alias with all of its descriptors |
| 出口 地面 北側 | zh-Hant | `poi:exit:1` | zh-Hant alias 出口 地面 北側 樓梯 有屋頂 |
| 出口 地面 西北側 | zh-Hant | `poi:exit:2` | zh-Hant alias for the northwest exit |
| でぐち ちじょう きたがわ | kana | `poi:exit:1` | ja-Hrkt alias でぐち ちじょう きたがわ かいだん やねあり |
| deguchi kita-gawa | romaji | `poi:exit:1` among the hits (exit 5 also matches: it is also on the north side) | ja-Latn alias |
| northwest | en | `poi:exit:2` and `poi:gate:1` (65 each) | both are on the north-west side |

## Facilities (from the GSI facility points; no shops, kiosks, benches or vending)

| Query | Expected top POI(s) | Why |
| --- | --- | --- |
| トイレ / 廁所 / toilet | `poi:toilet:1` women, `poi:toilet:2` unisex, `poi:toilet:3` men (all B3) | The notes are traveller text describing each toilet-space representative point; facility codes and the source cross-check live in `evidence.method` |
| 電梯 / elevator / エレベーター | `poi:elevator:1`, `:2`, `:3` (and `poi:exit:3` below them: its name says elevator) | The notes describe stops and any station-map confirmation gap for travellers; F012 levels and cross-check results live in `evidence.method` |
| 改札 / 剪票口 / gate | `poi:gate:1`, `:2`, `:3` (for 改札 the S03 gate names that contain 改札 also match, search only) | The notes give travellers an approximate position; gate-link counts and F106 cluster counts live in `evidence.method` (1, 4 and 1; all 6 points are counted once) |

## Negative cases (must return no E27 claim)

All of these return no hit with score >= 30. `Yamanote`, `都営新宿線` and `E01` return no hit at all. Other operators' names are in the S03 section at the end.

| Query | Why nothing may match |
| --- | --- |
| JR新宿 / Yamanote / 都営新宿線 | no E27 alias or note mentions these. The Toei Shinjuku Line is not modelled |
| 東京メトロ / Tokyo Metro | no strong hit. The S03 Marunouchi gate names do not contain 東京メトロ |
| E01 | Shinjuku-nishiguchi is another station's data. Our exits say 側 (side), never 口 after a direction |
| 屋根なし | no exit says 「屋根なし」: the E27 roof codes around exits 2 and 4 are mixed (see above). Do not add this word back without a source |
| 3番出口 / Exit 3 / A1出口 | there are no official exit numbers in the dataset; the id `poi:exit:3` is internal |

## Known ranker behaviour (Lane C, not changed here)

- Fuzz noise below 30: queries like `Keio` or `Odakyu` still return exits at a score of 6 to 9 through ordered-subsequence matching against long names and aliases. A minimum score of about 30 in the UI would drop it; the tests assume it.
- `A1` returns elevators, B1 exits and gates 1 and 2 at 45 because the all-script-runs rule only needs an "a" and a "1" somewhere in the text. It is not an exit-number match, and `A1出口` returns nothing.
- `Toei Shinjuku Line` returns the Oedo platform at 45 (the tokens toei, shinjuku and line all occur in its en name). The row reads "Toei Oedo Line platform (Shinjuku Station, E27)", so it does not claim the Shinjuku Line.
- `no roof` (en) returns `poi:exit:1` through the token rule ("no" occurs in "north", "roof" in "roofed"). It is not a claim that exit 1 has no roof.
- Several rows tie at the same score (all six exits for `exit`). The order among ties is by name, then id.

## S03 search-only POIs (#411)

Source: `tokyo-s03-zip`, 「出典：東京都都市整備局「新宿駅周辺の施設情報等」」 (CC BY 4.0, modified: names only; dataset 2020-03; ZIP sha256 in `station.json`). Facts only: the names are copied as printed, and no position, floor, connector, fare or English is added.

- 45 POIs, appended after every E27 POI: 23 `ticket_gate`, 19 `platform` and 3 `transfer`. Each has `floorId`, `displayPosition`, `paid` and `connectorNodeIds` empty, and cites only `tokyo-s03-zip`.
- Level labels (B1F, 1F, 2F, B2F) are S03's own. They are AREA_ONLY, not E27 floors and not elevations.
- Each note says 「2020年3月時点のデータです」 / "As of March 2020 data" and 「検索のみ（入口未確認）」 / "search only, entrance not verified". Current status is unknown.
- Routing answers `unknown_goal`, so these POIs never produce a route. The guided-walk tests skip them.
- 「新宿」 and "Shinjuku" still rank the routable Oedo platform (`poi:platform:oedo`) first, although JR platforms 1–4 contain 「湘南新宿ライン」.
- JR, 山手線, 中央線, 京王, 小田急, 丸ノ内線, 西口, 南口, 東口 and 新宿西口 now return these POIs at score 30 and above (see the negative table). None of them is routable.
- Two gates share the name 「京王新線　京王新線口」 in the source (`poi:keio-gate:1` and `:2`). The name is kept as printed and is not disambiguated.
