# DR-SH: Ikebukuro step-free per exit, passage and exit hours, Seibu gates (R12)

## 1. Header

- Tracking: issue #165 item R12, requested by the Ikebukuro route lane (ikb-route-fb). Context: #3, #203 (A1: the two short "stairs" edges), #206 (`stations/ikebukuro/docs/step-free-coverage.md`, gaps `gap-step-free`, `gap-hours`). Builds on `DR-IK-station-facts.md` (R1, ids `DR-IK-nn`) and `DR-retry-unread-sources.md` (R8, ids `DR-RT-nn`).
- Checked: 2026-10-22 (JST). Public pages only; nobody contacted; no sign-ups.
- Method: WebFetch page summaries (reads marked "FS") and plain page requests whose text was read directly; five small PDFs/images (all under 5 MB) were read for text and then deleted with the scratch directory (nothing is kept, nothing goes into the repo). Tokyo Metro pages refuse plain requests (Access Denied), so Metro facts are read by WebFetch (FS) or carried forward from R1 (browser DOM read, same day). No browser was opened for R12. No JR East content is recorded (OD-02); no Tobu gate names are used (OD-01); the OD-18 sites (東武百貨店, ホープセンター, PARCO) gave nothing new. Per OD-22 the Toshima underground guide drawings (incl. the Ver1.3 draft exit mapping on p20) are an exit-name and alias source only, never route evidence; per OD-03 relative label placement is layout, not fact.
- Short result:
  1. **Nothing public states a ramp, slope, lift or stairs-only for the two #203 flights** (`e_hall`→`e_low` toward exit 35; `s41_j`→`s41_f` near exit 41). No text names them or their passage. Text slopes and lifts do exist nearby but belong to other places (section 3.1).
  2. **New text facts:** Sunshine City's official barrier-free page says the nearest exit 35 has a lift to street level (a route note saying exit 35 is the nearest exit and that a lift is used to reach street level), which supports Metro's exit list (lift on 35) and conflicts with Metro's accessibility page wording (lift to 34, escalator to 35).
  3. **Hours:** still no stated hours for 中央通路, 南通路, 北通路 or for Metro exits. New stated hours exist only for the Sunshine City underground-passage entrance (7:00～23:30), ISP facility times, and the Seibu 南口 (7:00～22:30).
  4. **Seibu:** one text statement names both ends: ISP's access page says the route from the Seibu 1F gate goes down the 36番階段 beside 東口（南）, across from the gate. Seibu's own site gives no gate-to-passage text. Seibu terms are consistent with facts-only use (not like Tobu §8) but are all-rights-reserved with a no-modification clause; flagged (section 8).

## 2. Summary table

| Question | What public text states | Closes the gap? | source_ids |
|---|---|---|---|
| Q1a Step-free per exit | Metro lists ground lifts at 4, 34 (accessibility page) / 35 (exit list), C1b, C9 (R1). New: Sunshine City says exit 35 has a lift to ground. New: Tokyo's 2026-06-30 Metro plan sheet lists a 副都心線 池袋 lift "改札階～地上" in a building (no exit named). ISP states a priority lift B1–B2 (parking), not a street link. No source states step-free per exit for 5-9, 14, 16, 19, 23-25, 29-31. | Partly: exit 35 now has two text sources | DR-SH-06, 07, 09, 10, 15, 22, 23 |
| Q1b #203 flight (a): east B1 hall down toward exit 35 | No text about any ramp, slope, lift or stairs for it. | **No** | all read |
| Q1c #203 flight (b): South Passage near exit 41 | No text. Nothing read mentions exit 41. | **No** | all read |
| Q2 Hours: 中央通路, 南通路, 北通路, Metro 34-37, ISP entrances | Passages: no hours anywhere. Metro: a footnote that exits marked with an asterisk have time limits, hours not given (R1: no `*` on 34-37). ISP: facility hours 月～土 10:00～21:00, 日・祝 10:00～19:30 (facility, not stated as entrance hours). Sunshine City 地下道入口 beside サンシャインビジョン: 7:00～23:30 (change possible for inspection). 北通路 "opened 2020": no source found. | **No** for the passages and Metro exits; yes for two private entrances | DR-SH-07, 09, 14, 15 |
| Q3 Seibu gates | Seibu's text gives only 西武南口 7:00～22:30 and AED locations near the 1F and B1F gates. The station drawing (not text) labels 西武南口, 東口（南）, 東口（中央）. ISP text: Seibu 1F gate to 東口（南） and 36番階段. | One two-ended statement, single source (ISP) | DR-SH-01, 04, 16 |
| Seibu terms | 「著作権について」: no copying/diversion/reprinting/distribution beyond private use without permission; no modification; no quotation clause; no commercial-use ban | Verdict FACTS_ONLY_REFERENCE; flag | DR-SH-02 |

## 3. Findings (facts only)

### 3.1 Step-free per exit, and the two #203 flights

- Tokyo Metro バリアフリー設備 (FS, 2026-10-22): 改札外 lifts are 丸ノ内線 "中央通路東改札～３４番出入口", 有楽町線 "南通路西改札～４番出入口（エソラ）", 副都心線 "西通路東改札～Ｃ９番出入口 西通路東改札～C１b出入口"; 改札内 "ホーム（終端寄り）～中央通路西改札". Escalators: "中央通路東改札～３５番出入口" (up and down); no wheelchair-accessible escalators; no スロープ or 段差 wording anywhere on the page. [DR-SH-06]
- Metro's exit list (R1, rendered DOM, list rev. 2026年3月) marks the ground lift on 35, not 34; the two Metro pages therefore disagree. A WebFetch re-read of the top page this session returned only part of the JS list (A1, A2, C4) and a 改定日 of 2019年7月5日 for that block; R1's DOM read stands as the authority for 34-37. [DR-IK-01, DR-SH-07]
- Sunshine City official 「バリアフリー情報サイト（アクセス）」, route marker texts (page script, paraphrased): スタート marker: a route note saying exit 35 is the nearest exit and that a lift is used to reach street level; "エレベーター（地下通路入口）": a lift beside the large screen goes down to B1; "スロープ" marker: a slope alongside a staircase is available The slope is in Sunshine City's own underground passage on the way to its B1 information desk; the text names no station passage and no exit number for it. Not the #203 flights. [DR-SH-10]
- Sunshine City main access page: the page says exit 35 is nearest, the route follows サンシャイン60通り, and an escalator entrance to the underground passage is beside the サンシャインビジョン screen This is an escalator on that page and a lift on the barrier-free page for what is described as the entrance at the vision screen; the two pages are not reconciled, and the 2026/10/14 notice says the the サンシャインシティ地下道入口 escalators (B1～1F, 3 units) is stopped 2025年9月2日 ～ 2026年12月末(予定). [DR-SH-09, 10, 11]
- ISP facilities page: a priority lift links the ISP mall (B1) and the public parking (B2) located on B1 beside the Starbucks in the 南館; and a slope beside the Starbucks 南館店 is for use The slope's two ends are not named. ISP news (更新日 2024/06/01) repeats the lift (B1 to B2, for wheelchair users, the elderly and others; a note that the lift may be used for deliveries). [DR-SH-14, 15]
- Toshima 特定事業計画 (file dated 2020-03-25; R1年度末 status; full text re-read): for ISP a plan item to remove the level difference at the underground entrance on the 明治通り sidewalk and a plan item to consider renovating the slope structure of the 中央通路-side entrance, both 未着手; the second line implies the central-passage-side entrance has a slope structure but gives no exit number or level. For Seibu: a plan item to consider lifts to each platform or, with others, a first-to-last-train lift to the 東口 with the note the note says a 2016 survey found many obstacles and building it is difficult (status その他). For Metro: a related item on guidance when a first-to-last-train 東口 lift is built (未着手) and a lift-position sign item "（タカセ前エレベーター）" (完了). For the Seibu above-ground link: "池袋駅東西連絡通路（南デッキ）とダイヤゲートとを結び、池袋駅東西移動のバリアフリー化を実現するため、ビックリガード上空デッキの整備を行う", lift one 13-person lift on the station-side east end, status 完了. These are 2019/2020 plan statuses, not current service statements; the deck is above ground, outside the B1 graph. [DR-SH-18]
- Tokyo 都市整備局, Metro 整備計画 様式2 (令和8年6月30日): a row for 池袋 副都心線, period to 令和6年度, lift from the gate level to ground inside a building. No exit named; consistent with the C1b release (DR-RT-18). [DR-SH-23]
- だれでも東京 (Tokyo Welfare bureau portal, data as of 2025.01.29): 東京メトロ (survey 2025.11.13) lifts 7 units, capacity 11, wheelchair toilets 3 on B2F,B1F; 西武線 (survey 2025.11.14) lift 1 unit, 13 persons, door width 90 cm, depth 150 cm, wheelchair toilet B1F, platform doors on 2～6番ホーム. Counts only; no exit, level pair or hours. Terms not read. [DR-SH-22]
- Toshima バリアフリーマップ page (updated 2025-11-07) lists no station or passage data; the ward's WebGIS portal (wagmap) was not opened (map script, not text). [DR-SH-20, 21]
- Not found: any text about a slope, lift or stairs for the east B1 hall to exit 35 or the South Passage near exit 41. The Toshima 基本構想 概要 says only that gates face the Central Passage and states the policy of an aim of smooth vertical movement with little detour. [DR-IK-10, DR-SH-19]

### 3.2 Opening hours

- Metro: a footnote says that exits marked with an asterisk have time limits; no hours for any exit or passage; flagged exits per R1: 1a, 2a, 1b, 39, 40, C4 (1a and C4 reported back in service, DR-RT-10). No flag on 34-37 in R1. Absence of `*` is not a statement of 24-hour access. Metro lists hours only for two Fukutoshin escalator segments ("始発～24：00", "始発～24：15"). [DR-SH-06, 07, DR-IK-01]
- Sunshine City: the entrance beside サンシャインビジョン is open 7:00～23:30 ; hours may change for equipment inspection. Same page: 東池袋駅 passage "7:00～23:00". [DR-SH-09]
- ISP: whole facility 10:00～21:00 (月～土) and 10:00～19:30 (日・祝); elevator 10:00～21:00 (月～土); Starbucks 南館店 7:00～22:30 and 北館店 7:00～22:00 (shop hours). No statement ties these to the street-side entrances or to passage opening. The mall describes itself as connected directly to the station East Exit (池袋駅東口直結). [DR-SH-14]
- Seibu: 西武南口 "7:00～22:30"; 定期券うりば (B1) 平日7:00～20:00, 土休日10:00～18:00; 特急券うりば (1F) 7:00～20:00. [DR-SH-01]
- Echika: shop hours only (e.g. one shop "7:30-23:00(平日)"); no passage hours. [DR-SH-25]
- 北通路: no source states an opening date or hours. The ward's ウイロード page (updated 2024-03-11) says a public underground passage linking east and west on the north side of the station, built in 大正14年 and gives no hours; it does not say it is the lane's 北通路. 中央通路 and 南通路 appear only as name labels (Metro, ISP access page). [DR-SH-24, 06, 16]
- ISP's own site is now readable (refused in R1/R8) but states no entrance hours. Toshima 防災推進計画 re-read: no hours. [DR-SH-13, 26]

### 3.3 Seibu gates and connections

- Seibu station page text: AED AED locations near the 1F and B1F gates; hours for 西武南口; "ワイド型改札機" listed without a gate name. The text names no 中央口 or 北口 and no passage or exit number. Elevator, escalator and stair positions are images. [DR-SH-01]
- Seibu station drawing (image, "2026.8.1", not text, not copied): labels 西武南口, 東口（南）, 東口（中央）; two B1F passage ends carry arrows with line names. Counted as a name list only; per OD-03/OD-22 it is not connection evidence. [DR-SH-04]
- ISP 「アクセス」 (text, no date): the route from the Seibu 1F gate goes down the 36番階段 beside 東口（南）, across from the gate; after the stairs, turn right; after about 10 m the ISP メトロ口 (南館, near Pompadour) is on the left; and for Marunouchi the ISP メトロ口 is immediately on the left after leaving 丸ノ内線 中央通路東改札. Both ends named for Seibu 1F gate and 36番階段 (and 東口（南）). The Seibu gate is "1階改札", not a Seibu gate name. [DR-SH-16]
- Seibu barrier-free list: Ikebukuro marked 〇 for elevator, escalator, wide gate, handle-type electric wheelchair, tactile map, braille handrail plate and braille fare table (no locations). [DR-SH-03]
- Seibu renewal news (2022-03-25, 2023-04-11): no gate names or passages. [DR-SH-05]
- Seibu terms (「サイトのご利用にあたって」 → 著作権について): copying, diversion, reprinting and distribution beyond private use without the rights holder's permission are prohibited, as is modifying any work in whole or part; an English line barring reproduction without written permission. No quotation clause, no commercial-use ban, no date. [DR-SH-02]

## 3b. Per-item evidence (lead's wiring format)

Retrieved 2026-10-22 for every row. "Both?" = both endpoints named in the same text statement.

| Item | URL | Retrieved | Location + paraphrase | Rights | Both? |
|---|---|---|---|---|---|
| `e_hall`→`e_low` ramp/lift/stairs | none | 2026-10-22 | no statement found | n/a | no |
| `s41_j`→`s41_f` ramp/lift/stairs | none | 2026-10-22 | no statement found; exit 41 not mentioned | n/a | no |
| Exit 35 has a lift to street | https://sunshinecity.jp/file/official/barrierfree/access.html | 2026-10-22 | route marker "スタート": a route note saying exit 35 is the nearest exit and that a lift is used to reach street level | UNKNOWN (© only; no terms clause; see 8.2) | no (exit and "地上"; the lower level is not named) |
| Exit 35 escalator; lift to 34 | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | 2026-10-22 (FS) | heading エスカレーター: "中央通路東改札～３５番出入口"; エレベーター 改札外: "中央通路東改札～３４番出入口" | FACTS_ONLY_REFERENCE | yes (gate and exit) |
| South Passage west gate to Exit 4 lift | same page | 2026-10-22 (FS) | "南通路西改札～４番出入口（エソラ）" | FACTS_ONLY_REFERENCE | yes |
| Sunshine passage entrance hours | https://sunshinecity.jp/information/access_train.html | 2026-10-22 | 池袋駅 block: the entrance beside サンシャインビジョン is open 7:00～23:30 | UNKNOWN | no (entrance only) |
| ISP central-passage-side entrance slope structure | https://www.city.toshima.lg.jp/documents/15443/tokuteijigyoukeikau_31.pdf (ISP section, item ④) | 2026-10-22 | a plan item to consider renovating the slope structure of the 中央通路-side entrance (2020, 未着手) | FACTS_ONLY_REFERENCE | no (no exit number or level) |
| ISP slope beside Starbucks 南館 | https://www.web-isp.co.jp/facilities/ | 2026-10-22 (FS) | Slope note: a slope beside the Starbucks 南館店 is for use | UNKNOWN (see 8.1) | no |
| ISP priority lift B1 to B2 | https://www.web-isp.co.jp/facilities/ ; https://www.web-isp.co.jp/news/detail/?cd=000031 | 2026-10-22 (FS) | a priority lift links the ISP mall (B1) and the public parking (B2) | UNKNOWN | yes (B1 mall and B2 parking; not a street link) |
| Seibu 1F gate to 36番階段 and 東口（南） | https://www.web-isp.co.jp/access/ | 2026-10-22 (FS) | 西武線をご利用の方: the route from the Seibu 1F gate goes down the 36番階段 beside 東口（南）, across from the gate | UNKNOWN (see 8.1) | yes (gate and stair); single source |
| Marunouchi 中央通路東改札 to ISP メトロ口 | same | 2026-10-22 (FS) | 丸ノ内線: the ISP メトロ口 (南館, near Pompadour) is immediately on the left after leaving 丸ノ内線 中央通路東改札 | UNKNOWN | yes (gate and ISP entrance) |
| Seibu 南口 hours | https://www.seiburailway.jp/railway/station/ikebukuro/ | 2026-10-22 | 駅施設の営業時間: 西武南口 7:00～22:30 | FACTS_ONLY_REFERENCE | no |
| Metro exits time-limited | https://www.tokyometro.jp/station/ikebukuro/index.html | 2026-10-22 (FS, partial) | 出口案内 footnote: a footnote that exits marked with an asterisk have time limits | FACTS_ONLY_REFERENCE | no |
| Seibu above-ground east-west link lift | https://www.city.toshima.lg.jp/documents/15443/tokuteijigyoukeikau_31.pdf (ビックリガード上空デッキ) | 2026-10-22 | the 池袋駅東西連絡通路（南デッキ） is to link with ダイヤゲート one 13-person lift, status 完了 (R1年度末) | FACTS_ONLY_REFERENCE | yes (南デッキ and ダイヤゲート); above ground, 2019 status |

## 4. Source records

Common: checked 2026-10-22. FS = WebFetch summary.

| source_id | title | publisher | URL | date | terms (+URL) | modification | redistribution | availability | rights class | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| DR-SH-01 | 池袋駅 (駅の情報) | 西武鉄道 | https://www.seiburailway.jp/railway/station/ikebukuro/ | not stated | https://www.seiburailway.jp/policy/ | no | no | PAGE_READ (text read; FS re-check) | FACTS_ONLY_REFERENCE | Guide images only for lifts and gates. |
| DR-SH-02 | サイトのご利用にあたって (著作権について) | 西武鉄道 | https://www.seiburailway.jp/policy/ | not stated | the page itself; see 3.3 | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Same shape as Metro's terms (no quotation clause), without Tobu §8's commercial ban. Flag 8.3. |
| DR-SH-03 | バリアフリー情報一覧 | 西武鉄道 | https://www.seiburailway.jp/railway/barrierfree/list/ | not stated | as DR-SH-02 | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Marks only. |
| DR-SH-04 | 池袋駅構内案内図 SI01_1.png | 西武鉄道 | https://www.seiburailway.jp/railway/station/image/SI01_1.png | "2026.8.1" printed | as DR-SH-02 | no | no | FILE_INSPECTED once (145 KB), deleted | FACTS_ONLY_REFERENCE | A drawing; names only, not copied. |
| DR-SH-05 | 池袋駅・豊島園駅 リニューアル news | 西武鉄道 | https://www.seiburailway.jp/newsroom/news/20220325_renewal ; .../20230411_renewal | 2022-03-25; 2023-04-11 | as DR-SH-02 | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Nothing on gates. |
| DR-SH-06 | 池袋駅 バリアフリー設備 | 東京地下鉄 | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | not stated | https://www.tokyometro.jp/terms/index.html | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Same as DR-IK-02; plain requests get Access Denied. |
| DR-SH-07 | 池袋駅 駅トップ (出口案内) | 東京地下鉄 | https://www.tokyometro.jp/station/ikebukuro/index.html | block shows 2019年7月5日 in FS; R1 read 改定日 2026年3月 | as DR-SH-06 | no | no | PAGE_READ (FS, partial) | FACTS_ONLY_REFERENCE | R1's DOM read is the authority. |
| DR-SH-09 | 電車でのアクセス（池袋駅・東池袋駅） | サンシャインシティ | https://sunshinecity.jp/information/access_train.html | not stated | no terms clause found; footer carries a copyright notice with all rights reserved; https://sunshinecity.jp/siteinfo.html (browser, JS and cookies only) | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | See 8.2. |
| DR-SH-10 | バリアフリー情報サイト（アクセス） | サンシャインシティ | https://sunshinecity.jp/file/official/barrierfree/access.html | not stated | as DR-SH-09; credits a survey by the 日本バリアフリー観光推進機構 | UNKNOWN | UNKNOWN | PAGE_READ (route texts are in page script) | UNKNOWN | Coordinates and photos in the script are not recorded. |
| DR-SH-11 | 館内エスカレーター更新工事（運転停止）について | サンシャインシティ | https://sunshinecity.jp/news/entry-32868.html | 2026/10/14 | as DR-SH-09 | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Planned stop dates. |
| DR-SH-13 | 池袋ショッピングパーク top | ISP | https://www.web-isp.co.jp/ | not stated | https://www.web-isp.co.jp/terms/ | no | no | PAGE_READ (FS); readable now | FACTS_ONLY_REFERENCE | Was DISCOVERED (unreachable) in R1/R8. |
| DR-SH-14 | 営業時間・施設案内 | ISP | https://www.web-isp.co.jp/facilities/ | not stated | as DR-SH-13 | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Hours, lift, slope. |
| DR-SH-15 | エレベーターのご案内 | ISP | https://www.web-isp.co.jp/news/detail/?cd=000031 | 更新日 2024/06/01 | as DR-SH-13 | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | |
| DR-SH-16 | アクセス | ISP | https://www.web-isp.co.jp/access/ | not stated | as DR-SH-13 | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | JR lines on this page are not recorded (OD-02). |
| DR-SH-17 | ISP サイトご利用について | ISP | https://www.web-isp.co.jp/terms/ | not stated | §3 著作権等: no use (複製, 改変, 販売, ライセンス, 出版, 頒布) without prior permission beyond personal use in legal limits; no quotation clause; §5 links to top page only, no framing, no business-purpose linking | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | |
| DR-SH-18 | 池袋駅地区バリアフリー基本構想に基づく特定事業計画 | 豊島区 | https://www.city.toshima.lg.jp/documents/15443/tokuteijigyoukeikau_31.pdf | file dated 2020-03-25 (status end R1年度) | https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html (DR-IK-16) | no | no | FILE_INSPECTED (1.7 MB, full text), deleted | FACTS_ONLY_REFERENCE | DR-RT-24 read pages 1-6, 43-47 only; now Seibu, Metro, ISP and 南デッキ items too. |
| DR-SH-19 | 池袋駅地区バリアフリー基本構想 概要版 | 豊島区 | https://www.city.toshima.lg.jp/documents/15443/baria_gaiyou.pdf | PDF 2019-03 | as DR-SH-18 | no | no | FILE_INSPECTED (4.1 MB, text), deleted | FACTS_ONLY_REFERENCE | = DR-IK-10. |
| DR-SH-20 | 豊島区バリアフリーマップ | 豊島区 | https://www.city.toshima.lg.jp/158/kenko/sekatsu/2506171407.html | 2025-11-07 | © Toshima City; site policy as above | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | No station data. |
| DR-SH-21 | 豊島区地図情報システム バリアフリーマップ | 豊島区 | https://www2.wagmap.jp/toshima-bfm/Portal | n/a | not read | UNKNOWN | UNKNOWN | DISCOVERED (not opened) | UNKNOWN | Map application. |
| DR-SH-22 | 池袋駅のバリアフリー情報 | 東京都 (だれでも東京) | https://www.daredemo-tokyo.metro.tokyo.lg.jp/facility/traffic/101010695/ | data as of 2025.01.29; surveys 2025.11.13-14 | not read | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | JR block ignored (OD-02). Tobu block not recorded (OD-01). |
| DR-SH-23 | 東京地下鉄 鉄道駅バリアフリーに関する整備計画 様式2 | 東京都都市整備局 | https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_bunyabetsu_machizukuri_bfree_pdf_tetsudo_bfree_ev_08_07-pdf | 令和8年6月30日 | https://www.toshiseibi.metro.tokyo.lg.jp/policy (DR-RT-28) | no | no | FILE_INSPECTED (167 KB), deleted | FACTS_ONLY_REFERENCE | |
| DR-SH-24 | ウイロード(WE ROAD) | 豊島区 | https://www.city.toshima.lg.jp/436/miryoku/shiru/shotengai/weroad.html | 2024-03-11 | as DR-SH-20 | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | |
| DR-SH-25 | エチカ池袋 access / floor guide | Metro Properties | https://www.metropro-sc.jp/echika-ikebukuro/shop/floor.jsp | not stated | all rights reserved (DR-IK-13) | no | no | PAGE_READ | UNKNOWN | Shop hours only. |
| DR-SH-26 | 池袋駅周辺地下街防災推進計画 (text re-read) | 豊島区 | https://www.city.toshima.lg.jp/documents/17945/ikebukurotikabousaisuishinkeikaku.pdf | 2016-10-07 | as DR-SH-18 | no | no | FILE_INSPECTED, deleted | FACTS_ONLY_REFERENCE | = DR-IK-09; no hours. |
| DR-SH-27 | 池袋駅コア・ゾーンガイドライン 2020 (副都心交通戦略); 基盤整備方針 | 豊島区 | https://www.city.toshima.lg.jp/documents/30928/022_shiryou2-2_ikebukurohukutosinkoutuusennryaku_2020kousinban.pdf (7.6 MB); https://www.city.toshima.lg.jp/documents/24758/7-saiseiiinkai-shiryou2-4.pdf (6.9 MB) | 2020 | as DR-SH-18 | UNKNOWN | UNKNOWN | DISCOVERED (over 5 MB, not read) | UNKNOWN | Search snippets only; may describe passages. |

## 5. What this does not establish

- Whether any ramp, slope or lift sits at `e_hall`→`e_low` or `s41_j`→`s41_f`; the silence of these pages is not evidence of stairs only.
- Which of Metro's two pages is right about the exit 34/35 lift; Sunshine City's text supports 35 but is a private page, so the conflict stays open (FC-IK-02).
- That the Sunshine City lift or slope is part of any station passage; it is Sunshine City's route text from the street.
- Passage hours (中央通路, 南通路, 北通路) or Metro exit hours; the ISP facility hours are not entrance hours. Absence of `*` is not 24-hour access.
- That a 北通路 opened in 2020, or which passage the ward's ウイロード is in the lane's naming.
- Seibu gate names other than 西武南口, or any Seibu gate-to-passage link beyond the ISP sentence (single source, undated).
- Any current service: the ward 2019-2020 plan statuses, the 2024 ISP news date and the 2025 survey dates are the sources' own dates.
- The contents of the two ward PDFs over 5 MB (DR-SH-27) and the ward WebGIS.

## 6. Handoff for ikb-route-fb

Only text-stated facts; the Toshima drawings are exit-name/alias only (OD-22).

1. **Nothing here unlocks wheelchair routing for either #203 flight, and nothing sets `wheelchair: true` on any edge.** No text names a ramp, slope, lift or stairs-only for the east B1 hall to exit 35 or the South Passage near exit 41. Keep the honest note geometry-only, type unconfirmed and field item I12.
2. Exit 35 lift: two text sources now (Metro exit list in R1; Sunshine City page). Metro's accessibility page words it as lift to 34 and escalator to 35. UNVERIFIED conflict; data should not pick 34 or 35 until FC-IK-02 (and FC-SH-03) is done.
3. Hours: nothing unlocks `hours:"require_known"` for any passage or Metro exit. Only text hours: Sunshine City 地下道入口 7:00～23:30 (outside the graph), ISP facility times, Seibu 南口 7:00～22:30. These are not edge hours.
4. Seibu gate wiring: the only two-ended text is ISP's route note that the route from the Seibu 1F gate goes down the 36番階段 beside 東口（南）, across from the gate (single source, UNVERIFIED, ISP terms pending, 8.1). Seibu's own text gives no gate-to-passage statement; do not add a Seibu gate POI from text alone. Names usable as aliases once rights are settled: 西武南口, 東口（南）, 東口（中央）.
5. ISP: the 中央通路-side entrance slope structure (2020 ward plan) and the slope beside the Starbucks 南館店 are text slopes inside ISP, with no exit number.

## 7. Field items

Sign photos are private evidence only (not committed).

| id | Place | Observe | Paid area? | Unblocks |
|---|---|---|---|---|
| FC-SH-01 | East B1 hall toward exit 35 (`e_hall`→`e_low`) | Is there a ramp, slope, lift or only steps; step count; posted sign wording | no | #203 A1(a), I12 |
| FC-SH-02 | South Passage near exit 41 (`s41_j`→`s41_f`) | Same | no | #203 A1(b), I12 |
| FC-SH-03 | Exit 35 and 34 stair heads | Which carries the lift and which the escalator; sign wording | no | FC-IK-02 |
| FC-SH-04 | ISP: slope beside Starbucks 南館; central-passage-side entrance | Where the slope starts and ends; exit number on the plate | no | `gap-step-free`, `gap-ne-north` |
| FC-SH-05 | Seibu 1F gate frontage, stair 36 and 東口（南） sign | Printed gate name; whether sign says 36番 and 東口（南） | no | Seibu name and link check |
| FC-SH-06 | Posted hours: Sunshine 地下道入口, ISP entrances, Metro 34-37 | Copy plate or shutter wording | no | `gap-hours` |

## 8. Owner decisions (new only)

1. **ISP terms (DR-SH-17).** All-rights, no copying/modification/reprint without permission, no quotation clause, no business-purpose links. May one-line facts from ISP pages (hours, the 36番階段 route note, the slope and lift lines) be used under #26 facts-only, as OD-18 allows for the other private sites? Not covered by OD-18 today. Rec: yes, single-source UNVERIFIED, no copied text.
2. **Sunshine City pages (DR-SH-09, 10).** No terms clause found, only all rights reserved. Same question for the exit 35 lift and 7:00～23:30 facts. Rec: facts-only reference, UNVERIFIED.
3. **Seibu terms (DR-SH-02).** Confirm Seibu is in the same class as Metro (FACTS_ONLY_REFERENCE; facts-only use consistent; no commercial-use ban, so milder than Tobu §7-8). The no-modification clause matters only if text or the drawing were adapted, which is not proposed.
4. **だれでも東京 / Tokyo bureau pages (DR-SH-22, 23).** Terms for the portal are unread. Counts only, nothing needed for data; leave UNKNOWN unless a use appears.
