# 新宿駅 Shinjuku (E27) — expected search results (for Lane C)

Issue #106. This table is the contract for Lane C's per-station, table-driven search test. Lane B already checks every row below against the real `createSearchIndex` (`@gteki/search`) in `stations/shinjuku/test/search-truth.test.ts`; Lane C may copy the table into its own test. Nothing here changes ranking or UI.

**What is modelled.** Only the Toei Oedo Line Shinjuku station (E27), from the MLIT E27 station map and walking network (published under the Owner's #16 override; licence basis unconfirmed, not covered by PDL 1.0). JR, Keio, Odakyu, Tokyo Metro, the Toei Shinjuku Line and Shinjuku-nishiguchi (E01) are **not** modelled, so they must never produce a hit.

**How the index reads a POI.** `createSearchIndex` matches the query against every `names[].text` and `aliases[].text` of a POI (all languages together), after NFKC, lower-casing, katakana→hiragana and removal of spaces and punctuation. Per text: exact 100, prefix 80, suffix 70, substring 60, all-tokens/all-script-runs 40, ordered-subsequence fuzz up to 40; +5 if the POI has connectors; the best text scores the POI. Fuzz scores below 30 are subsequence noise, not a match: the tests count only hits with score >= 30 as "strong".

## Station-name anchor

The station-name hits ride on `poi:platform:oedo`, the one existing POI that stands for the station. Its names reuse the station record's own wording (`station.json`): ja 新宿駅（都営大江戸線）ホーム, en Toei Oedo Line platform (Shinjuku Station, E27). Its note says that other operators' facilities are not modelled. No new POI was added for the station name.

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
| ホーム / 月台 | generic | `poi:platform:oedo` | only platform in the dataset (B6, paid side) |

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
| 出口 / でぐち / deguchi / exit | generic | all six exits (score 105 each) | generic aliases on every exit; the list is not ranked by distance |
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
| 改札 / 剪票口 / gate | `poi:gate:1`, `:2`, `:3` | The notes give travellers an approximate position; gate-link counts and F106 cluster counts live in `evidence.method` (1, 4 and 1; all 6 points are counted once) |

## Negative cases (must return no Shinjuku POI claim)

All of these return no hit with score >= 30. `JR`, `山手線` and `Yamanote` return no hit at all.

| Query | Why nothing may match |
| --- | --- |
| JR / JR新宿 / 山手線 / Yamanote / 中央線 | JR is not modelled. No name, alias or note claims a JR facility; the aliases were also written so that the ranker's subsequence rule cannot turn "JR" into a hit |
| 京王 / 京王線 / 小田急 / 小田急線 / 丸ノ内線 / 東京メトロ / Tokyo Metro / 都営新宿線 | other operators / lines, not modelled |
| 西口 / 南口 / 東口 / 新宿西口 / E01 | the exits and Shinjuku-nishiguchi are other stations' data; our exits say 側 (side), never 口 after a direction |
| 屋根なし | no exit says 「屋根なし」: the E27 roof codes around exits 2 and 4 are mixed (see above). Do not add this word back without a source |
| 3番出口 / Exit 3 / A1出口 | there are no official exit numbers in the dataset; the id `poi:exit:3` is internal |

## Known ranker behaviour (Lane C, not changed here)

- Fuzz noise below 30: queries like `Keio` or `Odakyu` still return exits at a score of 6 to 9 through ordered-subsequence matching against long names and aliases. A minimum score of about 30 in the UI would drop it; the tests assume it.
- `A1` returns elevators, B1 exits and gates 1 and 2 at 45 because the all-script-runs rule only needs an "a" and a "1" somewhere in the text. It is not an exit-number match, and `A1出口` returns nothing.
- `Toei Shinjuku Line` returns the Oedo platform at 45 (the tokens toei, shinjuku and line all occur in its en name). The row reads "Toei Oedo Line platform (Shinjuku Station, E27)", so it does not claim the Shinjuku Line.
- `no roof` (en) returns `poi:exit:1` through the token rule ("no" occurs in "north", "roof" in "roofed"). It is not a claim that exit 1 has no roof.
- Several rows tie at the same score (all six exits for `exit`). The order among ties is by name, then id.
