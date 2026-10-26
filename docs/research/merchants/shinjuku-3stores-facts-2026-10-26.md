# DR: 京王百貨店, 高島屋 and 新宿サブナード — facts-only store POIs (2026-10-26, phase A)

## 1. Header

- Date: 2026-10-26. All times below are **JST** and carry their zone; Wayback capture IDs are UTC by definition and are labelled as such.
- Purpose: phase A of the facts-only store POIs for 京王百貨店, 高島屋新宿店 and 新宿サブナード (Shinjuku, E27), for `docs/research/merchants/shinjuku-dept-stores.json`. Phase A records facts and source JSON only; no `import:e27`, no `bake:surface`, no generated files (heavy lock held until after 2026-10-26 15:00 JST).
- Method: `curl` only, **default User-Agent, no added headers**, requests spaced ≥0.6 s apart, **43 requests** in total (table in §6). No browser, no sign-ins, no forms, no uploads. A 403, challenge or JavaScript-only page is recorded as a GAP; where the live host refuses the page, Wayback is used and the capture ID logged. No page from an OD-34-excluded site was read.
- Rights basis: the OD-34 source list as relayed for this task (Tokyo Metro station pages, Toei pages, the registered CC BY CSVs, JCSC, 新宿区 after quoting its terms; LUMINE / NEWoMan / 小田急百貨店 / マルイ / 伊勢丹 only if they print one of the store names). Director rulings applied: #502 (a quoted restriction on use beyond 私的利用 makes a source **corroboration only**) and #522 (facts only where the use clause's scope does not reach an anonymous visitor). 京王 (railway and store), 小田急 railway, JR East, 高島屋 and サブナード sites are **corroboration only** and were not used as a basis; none was read in this pass.

## 2. Result

| Store (brief) | POI id | Printed name (quoted) | Source and printed exits | Read (JST) | Floors printed? | OD-34 class |
|---|---|---|---|---|---|---|
| 京王百貨店 | `shop-sjk-keio` | 「京王百貨店」 (en: `Keio Dept. Store`) | Tokyo Metro exit data, 新宿駅 A14 and A15 | 2026-10-26 05:59 JST | none | facts only |
| 高島屋新宿店 | `shop-sjk-takashimaya` | 「高島屋タイムズスクエア」 (en: `Takashimaya Times Square`) | Tokyo Metro exit data, 新宿駅 A8 / A9 and 新宿三丁目駅 E8 | 2026-10-26 05:59 JST | none | facts only |
| 新宿サブナード | `shop-sjk-subnade` | 「サブナード」 (en: `Subnade`) | Tokyo Metro exit data, 新宿駅 B10 | 2026-10-26 05:59 JST | none | facts only |

**Names not printed.** No facts-only source read prints the full brief names: 「京王百貨店 新宿店」, 「高島屋新宿店」 or 「新宿サブナード」. The POIs therefore carry the printed labels exactly as above (`京王百貨店`, `高島屋タイムズスクエア`, `サブナード`), and each note says so. `高島屋タイムズスクエア` is the printed name of the complex that houses the department store; the store's own name is not printed by this source. Nothing is composed into a name the source does not print.

## 3. Quotes and detail

All quotes are the `facilities.ja` / `facilities.en` string of the row named, reproduced only as far as the store label; the rest of each row (other facilities) is not copied.

- **京王百貨店.** 新宿駅 A14 and A15, the label 「京王百貨店」 (English label `Keio Dept. Store`). A15 is also printed as the exit for 新宿駅（京王線・京王新線）, ルミネ1 and 新宿駅西口地下広場; A14 and A15 print the same store label. The 2016 print page cross-read (§4) prints 「京王百貨店」 at A15. No floors are printed in either read.
- **高島屋.** 新宿駅 A8 and A9 print 「高島屋タイムズスクエア」 (English label `Takashimaya Times Square`) together with JR新宿駅 南口・新南改札, ルミネ2 and ルミネ エスト; 新宿三丁目駅 E8 prints the same label alone. The 2016 print page prints it at A8 / A9. No floors are printed in either read.
- **サブナード.** 新宿駅 B10 prints 「サブナード」 (English label `Subnade`) together with 新宿区役所, 新宿ゴールデン街, 新宿東宝ビル and ホテルグレイスリー新宿. The 2016 print page prints 「サブナード」 at B10. No floors are printed in either read (the operator's own floor guide is image-only and the operator site is corroboration only in any case).

## 4. Source used, and why it is facts only

- **Tokyo Metro exit data — used.** `https://www.tokyometro.jp/station/exit.json` is the JSON the 新宿駅 and 新宿三丁目駅 pages load for their 出入口・周辺地図 modal (the station pages call it from `/station/exit.json`). The live **HTML page returns 403** from this host (`https://www.tokyometro.jp/station/shinjuku/index.html`, HTTP 403, 410 bytes, 2026-10-26 05:59 JST), but the **live JSON returns 200** (445,757 bytes, SHA-256 `e05abf041cce32e0efac843f3c67169b03634f45fa02614112700c57eb51693a`, 2026-10-26 05:59 JST); a 2026-09-08 Wayback capture of the same file (capture 20260908151007, read 2026-10-26 05:58 JST) is byte-for-byte the same size. Tokyo Metro station pages are facts-only in this repository (registered decision: [#26 comment](https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404), 2026-10-21; the same class as the 池袋駅 English page in `stations/ikebukuro/data/graph.src.json`). Only the printed facility labels (`京王百貨店`, `高島屋タイムズスクエア`, `サブナード`) and their exit numbers are taken; no route, floor or wording is taken. An independent older read of the same station's facility list, the 2016 print page `https://www.tokyometro.jp/station/shinjuku/map/index_print.html` (Wayback capture 20160730203340, read 2026-10-26 05:53 JST), prints the same three labels (京王百貨店 at A15; サブナード at B10; 高島屋タイムズスクエア at A8 / A9).

**Lead note (2026-10-26 06:05 JST).** The cited basis is the Wayback capture of `exit.json` (`20260908151007`, UTC; 445,757 bytes, SHA-256 `8524c81c…`, re-read by the lead; all three labels present), not the live read: Tokyo Metro is read through Wayback from this host because its live site returns 403. The live 200 read above is kept only as the research log.

## 5. Sources tried and their classification

| Source | Read (JST) | What it printed | Class for this task |
|---|---|---|---|
| Tokyo Metro 新宿駅 / 新宿三丁目駅 exit data | 2026-10-26 05:59 JST | the three labels in §2 | **facts only — used** |
| Tokyo Metro station HTML pages | 2026-10-26 05:59 JST | HTTP 403 | GAP (data file read instead) |
| Toei 新宿駅 / 新宿三丁目駅 / 新宿西口駅 pages, live | 2026-10-26 05:49 JST | Incapsula JS challenge, 212-byte page, no content | GAP |
| Toei 新宿駅 page, Wayback capture 20260101004957 | 2026-10-26 05:51 JST | station data, 乗り換え lines (京王線, 小田急線), barrier-free counts; no store labels | not used (nothing to take) |
| Toei 新宿三丁目駅 page, Wayback capture 20260101005053 | 2026-10-26 05:57 JST | station data only; no store labels | not used |
| JCSC (`jcsc.or.jp`) site and site search | 2026-10-26 05:50–05:57 JST | no 利用規約 page found (only 個人情報保護方針); search finds no ＜SC概要＞ page for the three stores. The 全国SC一覧 page states: 「「全国SC一覧」（以下、「本データ」）の利用は、SC協会会員の組織内における利用に限られます。本データで提供されるデータの著作権は、すべて当協会に帰属します。」 — member-only | not used (no store record; the SC list is member-only) |
| 新宿区 pages | 2026-10-26 05:55–05:56 JST | terms quoted below | **corroboration only — not used** |
| LUMINE 新宿 / ルミネエスト access, NEWoMan access | 2026-10-26 05:57 JST | 京王線 (railway) only; no 京王百貨店 / 高島屋 / サブナード labels | not used (nothing to take) |
| 新宿マルイ 本館 / アネックス / メン 店舗・アクセス pages | 2026-10-26 05:58 JST | station and line names only; no 京王百貨店 / 高島屋 / サブナード labels | not used (nothing to take) |
| 小田急百貨店, 伊勢丹 sites | not read in phase A | — | not needed (no expected store label) |
| keionet.com, takashimaya.co.jp, subnade.co.jp, JR East | not read | — | corroboration only, never a basis |

**新宿区 terms (quoted, 2026-10-26 05:56 JST, https://www.city.shinjuku.lg.jp/kusei/about.html, HTTP 200):** 「本サイト上の文書・画像などの無断使用・転載、二次利用を禁止します。掲載されている情報は、個人的かつ非営利的な使用目的だけのために利用する場合に限り、複製、使用、ダウンロードすることができます。著作権法上の「私的使用」や「引用」の範囲を越えて、本ページのコンテンツの使用を希望する場合は事前に問合せ担当課または区政情報課までお問い合わせください。事前の許可がない限り、転載、変更、発行、配布、掲示などは一切できません。」 The clause restricts *use* to 個人的かつ非営利的な使用目的, which is the #502 class (a quoted use restriction covering purposes beyond private use) — **corroboration only**, so no 新宿区 page is used as a basis.

**JCSC site-wide terms:** none found. The site map links only 個人情報保護方針 ([about_jcsc/privacypolicy](https://www.jcsc.or.jp/about_jcsc/privacypolicy)); the member-only restriction quoted above belongs to the 全国SC一覧 data page. No store record was found on the public event pages, so nothing was taken.

## 6. GAP list

| ID | Gap | Detail | What would close it |
|---|---|---|---|
| SJ3-GAP-1 | Exact store names | No facts-only source read prints 「京王百貨店 新宿店」, 「高島屋新宿店」 or 「新宿サブナード」. The POIs carry the printed labels (`京王百貨店`, `高島屋タイムズスクエア`, `サブナード`). | A facts-only source that prints the full names (e.g. a JCSC ＜SC概要＞ page or a Metro/Toei page using the full label). |
| SJ3-GAP-2 | Floors | No facts-only source read prints floor labels for any of the three. | A facts-only floor-guide or ＜SC概要＞ page that prints floors. |
| SJ3-GAP-3 | Toei station pages, live | Incapsula JS challenge (212-byte page) from this host; Wayback copies carry no store labels. | Re-read when the live host answers without the challenge. |
| SJ3-GAP-4 | Tokyo Metro station HTML | HTTP 403 from this host; only the JSON data file could be read live. | Re-read the HTML page directly if the 403 clears. |
| SJ3-GAP-5 | 新宿区 as a source | Terms restrict use to 個人的かつ非営利的な使用目的 (#502 class), so the ward pages are corroboration only. | A director ruling, or a 新宿区 dataset published under an open licence. |

## 7. Fetch log (JST; JST = UTC+9)

**43 requests.** Wayforward captures are read through `web.archive.org`; the capture ID is the Wayback timestamp (UTC).

| # | JST | Target | URL | Status | Bytes | Note |
|---|---|---|---|---|---|---|
| 1 | 2026-10-26 05:49:49 | Toei 新宿 | `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | 200 | 212 | Incapsula challenge page, no content |
| 2 | 2026-10-26 05:49:50 | Toei 新宿三丁目 | `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-sanchome.html` | 200 | 212 | same challenge |
| 3 | 2026-10-26 05:49:51 | Toei 新宿西口 | `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-nishiguchi.html` | 200 | 212 | same challenge |
| 4 | 2026-10-26 05:50:12 | JCSC home | `https://www.jcsc.or.jp/` | 200 | 109,030 | |
| 5 | 2026-10-26 05:50:14 | JCSC SCデータ | `https://www.jcsc.or.jp/sc_data/` | 200 | 35,624 | |
| 6 | 2026-10-26 05:50:15 | JCSC SC list (guessed path) | `https://www.jcsc.or.jp/sc_data/sc_list` | 404 | 29,205 | |
| 7 | 2026-10-26 05:50:26 | JCSC 全国SC一覧 | `https://www.jcsc.or.jp/sc_data/sc_open/sc_list` | 200 | 56,168 | no prefecture data in HTML |
| 8 | 2026-10-26 05:50:39 | JCSC site search | `https://www.jcsc.or.jp/?s=サブナード` | 200 | 28,497 | one contest-result hit only |
| 9 | 2026-10-26 05:50:40 | JCSC site search | `https://www.jcsc.or.jp/?s=京王百貨店` | 200 | 28,889 | seminar pages only |
| 10 | 2026-10-26 05:50:42 | JCSC site search | `https://www.jcsc.or.jp/?s=高島屋新宿` | 200 | 27,912 | no hits |
| 11 | 2026-10-26 05:50:52 | JCSC オープンSC archive | `https://www.jcsc.or.jp/data/open_sc/index.html` | 200 | 26,983 | |
| 12 | 2026-10-26 05:51:01 | JCSC 全国SC一覧 data page | `https://www.jcsc.or.jp/data/basic.html` | 200 | 29,254 | member-only clause quoted in §5 |
| 13 | 2026-10-26 05:51:12 | Wayback availability | `https://archive.org/wayback/available?url=kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | 429 | 117 | rate limited |
| 14 | 2026-10-26 05:51:13 | Wayback availability | `…?url=tokyometro.jp/station/shinjuku/index.html` | 429 | 117 | rate limited |
| 15 | 2026-10-26 05:51:15 | Wayback availability | `…?url=tokyometro.jp/station/shinjuku-sanchome/index.html` | 429 | 117 | rate limited |
| 16 | 2026-10-26 05:51:16 | Wayback availability | `…?url=kotsu.metro.tokyo.jp/subway/stations/shinjuku-sanchome.html` | 429 | 117 | rate limited |
| 17 | ~2026-10-26 05:51 | Toei 新宿, Wayback | `https://web.archive.org/web/2025/https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | 200 | 59,478 | capture 20260101004957; no store labels |
| 18 | 2026-10-26 05:51:42 | Tokyo Metro 新宿, Wayback | `https://web.archive.org/web/2025/https://www.tokyometro.jp/station/shinjuku/index.html` | 200 | 91,178 | capture 20260113174400; transfer lines only |
| 19 | 2026-10-26 05:51:45 | Tokyo Metro 新宿三丁目, Wayback | `https://web.archive.org/web/2025/https://www.tokyometro.jp/station/shinjuku-sanchome/index.html` | 200 | 95,974 | capture 20260101005135; transfer lines only |
| 20 | ~2026-10-26 05:52 | Wayback CDX | `http://web.archive.org/cdx/search/cdx?url=tokyometro.jp/station/shinjuku/*…` | 200 | — | path discovery |
| 21 | ~2026-10-26 05:53 | Wayback CDX | `…?url=tokyometro.jp/station/shinjuku/map/&matchType=prefix…` | 200 | — | path discovery |
| 22 | ~2026-10-26 05:54 | Wayback CDX | `…?url=tokyometro.jp/station/shinjuku-sanchome/map/&matchType=prefix…` | 200 | — | path discovery |
| 23 | 2026-10-26 05:53:56 | Tokyo Metro 新宿 出入口・周辺地図 (print) | `https://web.archive.org/web/20160730203340/https://www.tokyometro.jp/station/shinjuku/map/index_print.html` | 200 | 1,674,098 | capture 20160730203340; prints the three labels |
| 24 | 2026-10-26 05:55:13 | Tokyo Metro 新宿三丁目 map (print) | `https://web.archive.org/web/20171029234049/https://www.tokyometro.jp/station/shinjuku-sanchome/map/index_print.html` | 200 | 115,236 | capture 20171029234049; no store labels |
| 25 | 2026-10-26 05:55:23 | Tokyo Metro 新宿三丁目 A1 exit | `https://web.archive.org/web/20160505112720/https://www.tokyometro.jp/station/shinjuku-sanchome/map/exit_a1.html` | 200 | 57,093 | capture 20160505112720; map image only |
| 26 | 2026-10-26 05:55:34 | 新宿区 home | `https://www.city.shinjuku.lg.jp/` | 200 | 128,185 | |
| 27 | 2026-10-26 05:55:48 | 新宿区 privacy | `https://www.city.shinjuku.lg.jp/privacy.html` | 200 | 65,450 | |
| 28 | 2026-10-26 05:55:52 | 新宿区 site information | `https://www.city.shinjuku.lg.jp/site_information.html` | 200 | 71,381 | no rights clause |
| 29 | 2026-10-26 05:56:00 | 新宿区 about this site | `https://www.city.shinjuku.lg.jp/kusei/about.html` | 200 | 67,486 | **term quoted in §5** |
| 30 | 2026-10-26 05:56:04 | 新宿区 homepage policy | `https://www.city.shinjuku.lg.jp/kusei/kusei00_100005.html` | 200 | 60,110 | index page, no clause |
| 31 | 2026-10-26 05:56:36 | Tokyo Metro 新宿 map (2011 print) | `https://web.archive.org/web/20111103154922/https://www.tokyometro.jp/station/shinjuku/map/print.html` | 200 | 17,619 | capture 20111103154922; no store labels |
| 32 | 2026-10-26 05:57:01 | JCSC contest result | `https://www.jcsc.or.jp/cat_convention/p_20160929_5710` | 200 | 38,894 | prints 「サブナード」 as a participant affiliation, not a store record |
| 33 | 2026-10-26 05:57:15 | LUMINE 新宿 access | `https://www.lumine.ne.jp/shinjuku/access/` | 200 | 25,740 | 京王線 only |
| 34 | 2026-10-26 05:57:17 | ルミネエスト access | `https://www.lumine.ne.jp/lumineest/access/` | 200 | 16,640 | no store labels |
| 35 | 2026-10-26 05:57:18 | NEWoMan access | `https://www.newoman.jp/access/` | 200 | 15,413 | no store labels |
| 36 | 2026-10-26 05:57:42 | Toei 新宿三丁目, Wayback | `https://web.archive.org/web/2025/https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-sanchome.html` | 200 | 53,723 | capture 20260101005053; no store labels |
| 37 | 2026-10-26 05:58:12 | 新宿マルイ 本館 | `https://www.0101.co.jp/003/` | 200 | 61,834 | no store labels |
| 38 | 2026-10-26 05:58:13 | 新宿マルイ 本館 access | `https://www.0101.co.jp/003/access/` | 200 | 33,665 | 京王線 only |
| 39 | 2026-10-26 05:58:18 | 新宿マルイ アネックス access | `https://www.0101.co.jp/005/access/` | 200 | 35,214 | no store labels |
| 40 | 2026-10-26 05:58:19 | 新宿マルイ メン access | `https://www.0101.co.jp/074/access/` | 200 | 26,509 | no store labels |
| 41 | 2026-10-26 05:58:38 | Tokyo Metro exit data, Wayback | `https://web.archive.org/web/2026/https://www.tokyometro.jp/station/exit.json` | 200 | 445,757 | capture 20260908151007 |
| 42 | 2026-10-26 05:59:31 | Tokyo Metro exit data, live | `https://www.tokyometro.jp/station/exit.json` | 200 | 445,757 | **used**; SHA-256 in §4 |
| 43 | 2026-10-26 05:59:32 | Tokyo Metro 新宿 page, live | `https://www.tokyometro.jp/station/shinjuku/index.html` | 403 | 410 | HTML blocked; JSON read instead |

## 8. Phase B note

`import:e27`, `bake:surface`, the search-truth run, `search-expected.md` and `apps/web/src/search-stations.test.ts` are not run here: they are data processing under the heavy lock, held with a long queue until after 2026-10-26 15:00 JST. The lead runs phase B.
