# Ikebukuro route gap closure: second sources for three access facts, and printed hours (G4, G1)

- **Task:** week 1 item 2 of the 2-week L2 plan, closing gaps in the Ikebukuro first-slice route card (PR [#482](https://github.com/nurockplayer/gteki/pull/482), Issues [#3](https://github.com/nurockplayer/gteki/issues/3), [#165](https://github.com/nurockplayer/gteki/issues/165)).
- **Checked:** 2026-10-25, from `89128bcc` (`origin/main`). Data read: `stations/ikebukuro/data/graph.src.json` → `accessFacts` (the three facts below).
- **Scope:** research only. **No station data was changed**; `ds-ikebukuro` imports whatever is verified here.
- **Fetching:** plain `curl`, default user agent, ≥0.6 s between requests, 13 requests in total (limit 60). A 403 is recorded as a GAP, not retried or worked around.

## 1. What was asked

The PR #482 card records that 145.4 m of its 277.4 m path rests on one 2022 facts-only source (`toshima-underground-guide-2022`) for three access facts (its G4), and that every edge's `hours` is null (its G1: `gap-hours`).

| Access fact | Edge | Length | Current sole source | Fact text (stored, abridged) |
| --- | --- | --- | --- | --- |
| `af-central-passage-west` | `c_w__w_c` | 63.1 m | `toshima-underground-guide-2022` | 中央通路 continues west outside the fare gates, past the Marunouchi Line and Tobu Tojo Line central gates, into the underground hall at 西口 |
| `af-east-jr-passage-north` | `c_n__n_h` | 75.8 m | `toshima-underground-guide-2022` | A public passage runs north from the Central Passage, along the east side of the JR concourse, to 北通路 |
| `af-north-passage` | `n_h__n_c` | 6.5 m | `toshima-underground-guide-2022` | 北通路 is a public passage outside fare gates; east of the Exit 22 stairwell a short flight leads down to the passage between the ISP blocks |

## 2. Result in one table

Usable = OD-34 facts-only class (name, direction, floor, exit number, hours printed by the operator); corroboration-only sources are recorded but never used as evidence.

| Access fact | Verdict | Second source (usable) | What it corroborates | What it does **not** cover |
| --- | --- | --- | --- | --- |
| `af-central-passage-west` | **SECOND SOURCE FOUND** | `tobu-hope-center-access-2026-10` (東武ホープセンター, facts only) | The underground passage leaves the JR **中央改札** and the Marunouchi **中央通路西改札** and runs **toward 西口**; 中央通路 is a named passage with west gates on it | The exact run past the **Tobu Tojo** gates; the west hall's own name |
| `af-east-jr-passage-north` | **PARTIAL** | `isp-access-2026-10` (池袋ショッピングパーク, facts only) | A public underground passage runs from JR **北改札** — no stairs up — past いけふくろう to the ISP blocks; i.e. the north side of the JR concourse is on the public underground network | The 75.8 m north-going run and its arrival at 北通路; no source read here describes that alignment |
| `af-north-passage` | **SECOND SOURCE FOUND** | `isp-access-2026-10` | A short **escalator down** lands directly on **ISP レンガ通り（右：南館、左北館）** — a level change down into the passage between the ISP blocks | The Exit 22 stairwell as the descent's position; 北通路 is not named in that sentence (naming is covered by `toshima-sign-guideline-v1.2` below) |

Additional corroboration found while reading, usable in the same class:

- `toshima-sign-guideline-v1.2` (豊島区, facts only) names the network's three east–west lines — 「３つの東西動線（北通路､中央通路､南通路）を主導線として優先的に案内する」 — and prints the exit-number names this repo already uses: 「◯東口（ 北 ）：現在の｢JR 東口｣：22」, 「◯東口（ 南 ）：現在の｢西武口｣：38」, 「◯西口（中央）：現在の｢西口｣：19」. This is the ward's published guideline Ver1.2 (令和2年3月改定, 2020-03) — a **decided** document, not the later 案 Ver1.3 (2026-03) that OD-22 bars from route evidence. It corroborates passage names and the 22 / 38 exit numbers, but it is **older** than the 2022 map, so it adds naming, not freshness.

## 3. The quoted lines (verbatim, as fetched)

### 3.1 `tobu-hope-center-access-2026-10` — 東武ホープセンター「アクセス・駐車場」

URL https://tobuhopecenter.jp/info/access/ · retrieved 2026-10-25T13:42:46+09:00 · sha256 `d4aca3a35076502ec9ad88ded5d7a52378a1f03c14f68ff63f01f902ed328dad` · OD-34 class: **facts only** (東武ホープセンター https://tobuhopecenter.jp/terms/ read 2026-10-24, 「"私的利用"または"引用"などは著作権法上認められた場合を除き利用することを禁止」 — a legal-exception clause, not a flat ban, so facts are usable; no text, map or layout is reproduced).

> JR池袋駅より徒歩1分 中央改札を出て地下通路を西口方面へ

> 東京メトロ丸ノ内線池袋駅より徒歩1分 中央通路西改札を出て地下通路を西口方面へ

> 東京メトロ有楽町線池袋駅より徒歩1分 南通路西改札を出て地下通路を西口方面へ

Read as facts: the passage west of the JR 中央改札 is public underground route to 西口; the Marunouchi Line's **中央通路西改札** sits on it (and the Yurakucho Line's 南通路西改札 on the South Passage, which is not this card's target). It does **not** mention the Tobu Tojo Line central gates, so that half of `af-central-passage-west` still rests on the 2022 Toshima map alone.

### 3.2 `isp-access-2026-10` — 池袋ショッピングパーク「アクセス」

URL https://www.web-isp.co.jp/access/ · retrieved 2026-10-25T13:42:02+09:00 · sha256 `74388c915cc858ff7454b76d904032268cdcd68c00614bac89af332dc5b0662b` · OD-34 class: **facts only** (ISP https://www.web-isp.co.jp/terms/ read 2026-10-24, 「私的に使用する目的以外に、法的に認められる範囲を超えて…禁止」).

> 1 JR北改札 を出て右に進む

> 2 いけふくろうの像の横を通りすぎ、地上へ行く階段は上がらずに地下通路をそのまま道なりに進む

> 3 短いエスカレーターを降りると池袋ショッピングパークのレンガ通りにでます（右：南館、左北館）

> 東京メトロ丸ノ内線 中央通路東改札から でるとすぐ左手側に池袋ショッピングパークメトロ口（南館ポンパドウル付近）がございます。

Read as facts: (a) the JR **北改札** opens directly onto a continuing public underground passage (no climb to street level), which is the north side of the JR concourse — the south end of `af-east-jr-passage-north`'s run; (b) that passage descends by a short escalator straight into **ISP レンガ通り**, the internal street between 南館 and 北館 — the level change and the "passage between the ISP blocks" that `af-north-passage` describes; (c) 中央通路 carries the Marunouchi Line's **東改札** on its east side, consistent with `af-central-passage` (already two-sourced).

### 3.3 `toshima-sign-guideline-v1.2` — 池袋ターミナル案内サインガイドライン（令和2年3月改定）概要版

URL https://www.city.toshima.lg.jp/documents/17300/saingaidorain-gaiyouban_kaitei1-2.pdf (linked from https://www.city.toshima.lg.jp/405/1705251510.html, page updated 2025-08-04) · retrieved 2026-10-25T13:42:15+09:00 · sha256 `b0e32b223608f6fb706fe840b93a23d6dc75f61b1ab2dbc181a95052a0441ddb` · OD-34 class: **facts only** (豊島区 `city.toshima.lg.jp`, site policy recorded in PR #414) · text layer extracted with `pdftotext`, page 2–4.

> ・３つの東西動線（北通路､中央通路､南通路）を主導線として優先的に案内する (p2, 動線設定の原則)

> ・既存の「北通路」「中央通路」「南通路」との連携を図る (p3, 主要出入口の設定)

> ◯東口（ 北 ）：現在の｢JR 東口｣：22 (p4)

> ◯東口（ 南 ）：現在の｢西武口｣：38 (p4)

> ◯西口（中央）：現在の｢西口｣：19 (p4)

Read as facts: 北通路 and 中央通路 are the ward's own names for two of the three main east–west lines, and the present exit numbers 22 (東口（北）) and 38 (東口（南）) are printed in the adopted guideline. **Limit:** the guideline names passages and exits; it carries no geometry, so it cannot itself place the 75.8 m run.

## 4. Hours (G1)

No read source prints opening hours **for the public passages themselves** (中央通路, 北通路). What the same usable operators do print is the hours of the two underground facilities the route touches at its ends:

### 4.1 ISP — 営業時間・施設案内

URL https://www.web-isp.co.jp/facilities/ · retrieved 2026-10-25T13:42:01+09:00 · sha256 `aad0f0021e4740617ba085e8b2240a7547219d915648611c6bcdaf427457b0eb` · facts only (as §3.2).

> 営業時間 （年中無休） 全館 10:00～21:00（月～土） 10:00～19:30（日・祝）

> ※状況により営業時間を変更させていただく場合がございます。

### 4.2 東武ホープセンター — 営業時間

URL https://tobuhopecenter.jp/info/ · retrieved 2026-10-25T13:42:48+09:00 · facts only (as §3.1).

> 営業時間 ショップ 10:00～21:00 HOPE食堂 10:00～22:00

> ※ショップによって、開店・ラストオーダーの時間が異なります。

What this does and does not settle:

- **Settled:** the ISP blocks — including レンガ通り, the level-change landing of `af-north-passage` — are a shop floor with printed hours (10:00–21:00 Mon–Sat, 10:00–19:30 Sun/holidays, 年中無休). After those hours that passage cannot be assumed open.
- **Not settled:** the public passages (中央通路, 北通路) print no hours anywhere read. The facility hours above are **not** passage hours, so they must not be imported as `hours` on `c_w__w_c`, `c_n__n_h` or `n_h__n_c`; the router's `hours: null` and `unknowns: hours` stay correct.
- **G1 therefore stays open** with a narrower statement: two adjoining underground facilities publish hours; the public passage network has no printed hours in any usable source read here.

## 5. Sources this document adds (register rows for `ds-ikebukuro`)

| Proposed id | Title | Publisher | URL | retrievedAt | OD-34 class | Attribution (facts only, not reproduced) |
| --- | --- | --- | --- | --- | --- | --- |
| `isp-access-2026-10` | 池袋ショッピングパーク アクセス | 池袋ショッピングパーク | https://www.web-isp.co.jp/access/ | 2026-10-25T13:42:02+09:00 | facts only | 池袋ショッピングパーク「アクセス」(facts only) |
| `isp-facilities-2026-10` | 池袋ショッピングパーク 営業時間・施設案内 | 池袋ショッピングパーク | https://www.web-isp.co.jp/facilities/ | 2026-10-25T13:42:01+09:00 | facts only | 池袋ショッピングパーク「営業時間・施設案内」(facts only) |
| `tobu-hope-center-access-2026-10` | 東武ホープセンター アクセス・駐車場 | 東武ホープセンター | https://tobuhopecenter.jp/info/access/ | 2026-10-25T13:42:46+09:00 | facts only | 東武ホープセンター「アクセス」(facts only) |
| `tobu-hope-center-info-2026-10` | 東武ホープセンター 営業時間・施設案内 | 東武ホープセンター | https://tobuhopecenter.jp/info/ | 2026-10-25T13:42:48+09:00 | facts only | 東武ホープセンター「営業時間」(facts only) |
| `toshima-sign-guideline-v1.2` | 池袋ターミナル案内サインガイドライン Ver1.2（令和2年3月改定）概要版 | 豊島区 | https://www.city.toshima.lg.jp/documents/17300/saingaidorain-gaiyouban_kaitei1-2.pdf | 2026-10-25T13:42:15+09:00 | facts only | 豊島区「池袋ターミナル案内サインガイドラインVer1.2 概要版」(facts only; not reproduced) |

Suggested `sourceIds` additions on the imported facts (one per fact, all resolvable once the rows above are added):

- `af-central-passage-west` → add `tobu-hope-center-access-2026-10` (west run past the JR 中央改札 and the Marunouchi 中央通路西改札). The Tobu Tojo gates stay single-source.
- `af-north-passage` → add `isp-access-2026-10` (level change down into ISP レンガ通り). `toshima-sign-guideline-v1.2` supports the passage name.
- `af-east-jr-passage-north` → **no full second source**; `isp-access-2026-10` supports only its southern end (北改札 on the public underground network). It should stay marked as single-source, per OD-18.

## 6. Not used, and why

| Candidate | Result | Reason |
| --- | --- | --- |
| 東京メトロ 池袋駅構内立体図 https://www.tokyometro.jp/station/ikebukuro/yardmap/index.html | **HTTP 403** | GAP: not readable with plain curl on 2026-10-25. The bundle already cites it for facts read earlier; nothing new was added from it. |
| 東武百貨店 池袋店 https://www.tobu-dept.co.jp/ikebukuro/ | **HTTP 403** (floor page also 404) | GAP for this read. OD-34 rates 東武百貨店 facts only, but nothing was read. |
| 西武池袋本店 https://www.sogo-seibu.jp/ | not fetched | OD-34 (third round) rates it **corroboration only** (terms clause 2 item 8 bans business use) — the brief's "usable under OD-34" test fails for it, so it is not used even though it is listed as a candidate. |
| JR East (jreast.co.jp) | not fetched | OD-02 A / OD-34 §1: corroboration only. |
| 東武鉄道 (tobu.co.jp) | not fetched | OD-34 (second round): site policy §8 bans business use → corroboration only. 東武ホープセンター (`tobuhopecenter.jp`) is a different site and is usable facts-only. |
| 豊島区 池袋駅地下空間案内図 (2022-01) | already the sole source | Re-reading it would not add a second source. The newer Toshima document read is the sign guideline (令和2年3月), cited in §3.3. |

## 7. Request log

13 requests, serial, ≥0.6 s apart, default user agent, 2026-10-25 13:41–13:42 JST.

| # | URL | Status |
| --- | --- | --- |
| 1 | https://www.tokyometro.jp/station/ikebukuro/yardmap/index.html | 403 |
| 2 | https://www.web-isp.co.jp/ | 200 |
| 3 | https://www.city.toshima.lg.jp/405/1705251510.html | 200 |
| 4 | https://www.web-isp.co.jp/floorguide/ | 200 (used only to locate the pages below) |
| 5 | https://www.web-isp.co.jp/facilities/ | 200 |
| 6 | https://www.web-isp.co.jp/access/ | 200 |
| 7 | https://www.city.toshima.lg.jp/documents/17300/saingaidorain-gaiyouban_kaitei1-2.pdf | 200 |
| 8 | https://www.tobu-dept.co.jp/ikebukuro/floor/ | 404 |
| 9 | https://www.tobu-dept.co.jp/ikebukuro/ | 403 |
| 10 | https://tobuhopecenter.jp/ | 200 |
| 11 | https://tobuhopecenter.jp/info/access/ | 200 |
| 12 | https://tobuhopecenter.jp/floorguide/ | 200 (no passage or hours text used) |
| 13 | https://tobuhopecenter.jp/info/ | 200 |

No HTML, PDF or image from these pages is committed; only the quoted lines above are recorded as facts.

## 8. Assumptions and limits

- "Usable under OD-34" is applied as recorded in `docs/research/owner-decisions-pending.md`: facts only where the terms keep a legal-exception clause, corroboration only where they ban business use (JR East, tobu.co.jp, 西武池袋本店). No source here has a flat ban, so nothing was dropped for rights.
- Quotes are the pages' own text, copied as printed; the 2022 Toshima map's own drawing was not re-read, so nothing here changes the map's facts.
- Text-layer extraction of the PDF is assumed faithful for the quoted lines; they were read in the `pdftotext -enc UTF-8` output, not visually.
- The ISP and Hope Center hours are **facility** hours, not passage hours, and are recorded as such (§4).
- `af-east-jr-passage-north` remains single-source: this document found only partial support (its southern end), not a second description of the 75.8 m run. Per OD-18 it stays marked as not confirmed by a second public source.
