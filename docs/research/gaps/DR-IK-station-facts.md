# DR-IK: Ikebukuro public facts for the 20 search-only POIs (R1)

## 1. Header

- Gap refs: `docs/gis/research/m0-01-coverage-gaps.md` rank 2 (rows IK-04, IK-05, IK-07); station gaps `gap-west-stairs`, `gap-west-corridor-exits`, `gap-ne-north`, `gap-metro-tobu-gates`, `gap-south-west`, `gap-tobu-jr-link`, `gap-step-free`, `gap-hours`; PR #140 ("Per-POI evidence: the 20 search-only POIs", `stations/ikebukuro/docs/coverage-gaps.md`); tracking issue #165 item R1.
- Checked: 2026-10-22.
- Method: desk research of public pages; nothing downloaded beyond page text, plus five small files read for facts only (Toshima underground-map PDF 428 KB, Toshima plan PDF 665 KB, Toshima barrier-free summary PDF 4 MB, Tokyo Metro yard-map PNG 2.8 MB, Tobu map GIF 62 KB). All were kept outside the repo (scratchpad). Page text was read in the ego-lite browser (innerText) or WebFetch; the load-bearing Japanese strings for Metro, Tobu, 東武百貨店, Hope Center and JR were re-read from browser text. Toshima landing/plan/site-policy pages (DR-IK-05, 09, 16) were read through WebFetch summaries only (the browser was redirected to a translation proxy); the Toshima PDFs themselves were read directly. No one was contacted. No `related` field values (S10, S03, PLATEAU) are written here.
- Rule applied: facts only. A label drawn on a schematic map says what the operator or ward calls a place and in what order labels are drawn. It does not identify which surveyed opening or PLATEAU flight is that exit.
- Short result: public sources give names, building/landmark attachments, operator-published lift lists and some time-restriction flags. **No source read states, in words, which passage or hall an exit stair leaves from for exits 5-9, 14, 16, 19, 23-25, 29-31, none gives an exit-level opening hour, and none identifies a gate line against columns. No row closes the PR #140 blocker.** Exit 9 (field item B2) stays open.

## 2. Summary table

Blocker = the PR #140 identification gap (which opening/stair is which gate or exit). "Drawn" = as drawn on the cited schematic; not a measurement.

| POI id | What public sources state (facts) | source_ids | Closes PR #140 blocker? | Remaining field item |
|---|---|---|---|---|
| `exit-9` (first) | Tokyo Metro lists Exit 9 among its exits (list revised 2026年3月): nearby 三井住友銀行（池袋支店） and 西口バスターミナル; no 地上行エレベーター mark; no time-restriction asterisk. Toshima 2022 guide draws "9" on the west-facing edge of the block that also carries 13/14/15, immediately south of 10 and north of 8, with a stair symbol. Metro 3D yard map (2026.3) also labels 9, on the north-west side beyond 8. No source says in words which passage/hall the stair leaves from, gives a column position, or states a fare-gate-free status for it. | DR-IK-01, 03, 04 | **No.** Adds the landmark pair and the 10/9/8 order, which the lane already used as a consistency check; adds no measurement. | B2 (unchanged). Add: photograph the exit-name sign at the stair head for facts only. |
| `exit-8` | Metro-listed; nearby 東京都豊島合同庁舎 / 豊島都税事務所; no lift mark, no time flag. Toshima guide draws 8 at the west end of the passage with a stair symbol, south of 9, near the Fukutoshin side. | DR-IK-01, 04 | No | C1 (and B2 for order) |
| `exit-14` | **Not in Tokyo Metro's exit list and not seen on its 3D map.** Toshima guide draws 14 in the 13/14/15 block, below 15. No source read says whose exit it is, which passage it leaves from, or its hours. | DR-IK-01, 03, 04 | No | B3 |
| `exit-16` | Not in Metro's list or 3D map. Toshima guide draws 16 on the Tobu Hope Center block (north part), next to 17. The Toshima 2016 plan names 東武ホープセンター as one of two underground-mall operators in scope. No exit table. | DR-IK-01, 03, 04, 09 | No | B3 |
| `exit-19` | Toshima guide: labelled 西口（中央） / West Exit (Cntrl) "19", drawn south of Tobu 中央2改札 and north of the Marunouchi 中央通路西改札, stair symbol attached. Metro 3D map labels 19 with a lift pictogram and 地上へ nearby, but Metro's text exit list and its accessibility page do not list 19. Separate JR page text (not usable, see Owner decisions) mentions a lift behind the stairs towards the West Exit after leaving 中央1改札. Nothing links these to each other. | DR-IK-03, 04; (DR-IK-11) | No | B4; FC-IK-01 |
| `exit-5` | Metro-listed; nearby エソラ池袋 / ステーションコンファレンス池袋 / 東武百貨店 池袋店 / メトロポリタンプラザ / ルミネ池袋; no lift mark; no time flag. Metro 3D map labels 5 beside a 地上へ lift pictogram, but Metro's accessibility page lists the ground lift for Y09 at Exit 4 (エソラ), not 5. Toshima guide draws 5 at the Esola frontage. | DR-IK-01, 02, 03, 04 | No | D1 |
| `exit-6a` | Metro-listed; nearby 城北ビル / 東武百貨店 池袋店; no lift mark; no time flag. Toshima guide draws 6a at the south-west tip of the Tobu Hope Center block. | DR-IK-01, 03, 04 | No | D1 |
| `exit-6b` | Metro-listed; nearby 東武百貨店 池袋店; no lift mark; no time flag. Toshima guide draws 6b beside the Tobu department store block, north of 6a. | DR-IK-01, 03, 04 | No | D1 |
| `exit-7` | Metro-listed; nearby 第一西池ビル / 東武百貨店 池袋店; no lift mark; no time flag. Toshima guide draws 7 at the north end of the south Hope Center block, a stair symbol facing west. | DR-IK-01, 03, 04 | No | D1 (and B6) |
| `exit-23` | Not in Metro's list or 3D map. Toshima guide draws 23 at the north-west stair of the 池袋ショッピングパーク block. | DR-IK-04 | No | G2 |
| `exit-24` | Not in Metro's list. Toshima guide draws 24 and 25 as two separate labels, one above the other, each with a stair symbol, on the west side of the 池袋ショッピングパーク block north of the shopping-park passage. Nothing says which stair is which except that drawing. | DR-IK-04 | No | G1 |
| `exit-25` | As 24. | DR-IK-04 | No | G1 |
| `exit-29` | Metro lists 29: nearby としま区民センター only; no lift mark; no time flag. Toshima guide draws 29 at the northern stair of the shopping-park block. Not seen on Metro's 3D map. | DR-IK-01, 04 | No | G2 |
| `exit-30` | Not in Metro's list. Toshima guide draws "30" and "31" together in one box with a single stair symbol on the east side of the block. | DR-IK-04 | No | G2, FC-IK-03 |
| `exit-31` | As 30. Whether this is one stairway with two numbers or two stairways is not stated. | DR-IK-04 | No | G2, FC-IK-03 |
| `metro-m-central-west-gate` | Name appears on three official pages: Metro accessibility (lift inside the fare zone from the platform terminus end to 中央通路西改札), Toshima guide (Central Passage West Gate, drawn first of three along 中央通路), 東武ホープセンター access page ("中央通路西改札を出て地下通路を西口方面へ"). 東武百貨店 calls it 丸ノ内線中央連絡西改札 (name variant). Toshima's 2019 barrier-free summary calls the gates on the Central Passage 中央通路に面する改札口. Operator: Tokyo Metro. | DR-IK-02, 04, 07, 08, 10 | **Partial**: passage, operator, order west-to-east as drawn. Not which opening. | A1 (+ record printed name); A3 |
| `metro-m-central-gate` | Name appears only on the Toshima guide (中央通路中央改札 / Central Passage Central Gate), drawn between the west and east gates. Metro's own pages read do not list it (accessibility lists only west and east). | DR-IK-04 | Partial (as above) | A1 |
| `metro-m-central-east-gate` | Metro accessibility: 改札外 lift 中央通路東改札～３４番出入口, escalator 中央通路東改札～３５番出入口, wheelchair toilet etc. at 中央通路東改札外広場. Toshima guide: drawn east of the central gate, near 36/37. Metro's exit list marks the ground lift on 35, not 34 (internal mismatch). | DR-IK-01, 02, 04 | Partial (as above) | A1; FC-IK-02 |
| `tobu-central-gate-1` | Tobu's own station map labels 中央1改札口 (and 中央2, 北, 南, JR線のりかえ改札口). Toshima guide: Tobu 中央改札1 drawn south of the Central Passage, with Tobu platform symbol; Central Gate 2 drawn north of it. 東武百貨店 page lists 東上線中央改札1・2. | DR-IK-04, 06, 07 | Partial (operator, passage, side as drawn) | A2; F3 (for the north-end claim) |
| `tobu-central-gate-2` | As above; Toshima guide draws 中央改札 2 north of the Central Passage, next to the Tobu north gate. | DR-IK-04, 06, 07 | Partial | A2 |

Gap-level (not among the 20 POIs):

| Item | What public sources state | source_ids | Closes blocker? | Remaining |
|---|---|---|---|---|
| `gap-south-west` (Yurakucho 南通路西改札 / 東改札) | Names confirmed by Metro accessibility (lift and escalators 南通路西改札～４番出入口（エソラ), escalators to 南通路東改札; 改札外 per page), Toshima guide (南通路西改札 drawn west of the JR 南改札 label, 南通路東改札 east of it), 東武百貨店 page (有楽町線南通路西改札), Hope Center page (南通路西改札 leads to the West Exit passage). | DR-IK-02, 04, 07, 08 | Partial | F2 |
| `gap-tobu-jr-link` | Tobu's map labels a JR線のりかえ改札口 and a 南改札口; no public source read states whether the passage west of the JR block is open to non-ticket holders. | DR-IK-06 | No | F3 |
| `gap-step-free` | Metro lists ground lifts only at Exits 4, 34 (accessibility page) / 35 (exit list), C1b, C9; none at 5-9, 29. JR page lists three lifts with hours (see 3.4; restricted). No public source gives lift type, levels or hours for the Hope Center / West Exit hall. | DR-IK-01, 02, 11 | No | H2, FC-IK-01, FC-IK-02 |
| `gap-hours` | Metro flags 1a, 2a, 1b, 39, 40, C4 as time-restricted (hours not given); no flag on 5-9, 29. No hours for the other exits. | DR-IK-01 | No | H1 |

## 3. Findings (facts only)

### 3.1 Exit 9 (B2)

- Tokyo Metro's 出口案内 on the 池袋 station page (改定日：2026年3月) lists exit 9 with nearby 三井住友銀行（池袋支店） and 西口バスターミナル; the list has no 地上行エレベーターあり mark on 9 and no `*` (time-restriction) mark on it. [DR-IK-01]
- The same list's footnote: marked (`*`) exits have time limits; the page does not give the hours. [DR-IK-01]
- Toshima's 2022 underground guide has a labelled square "9" on the west-facing edge of the block that also holds 13, 14 and 15, directly under "10" and above "8", with a stair pictogram. This is a drawing; it carries no scale tie to the PLATEAU survey. [DR-IK-04]
- Metro's 3D yard map ([2026.3現在]) labels 9 on the north-west side of the B1F passage, beyond 8 and 7. [DR-IK-03]
- No page read states which hall, plaza or passage exit 9's stair starts from, which side of the passage, or any column count. [DR-IK-01, 03, 04]
- Consequence for PR #140: the order 10, 9, 8 is the same in both maps; the lane already treats that as a consistency check. It is not the "map-position re-measurement within ~3 m". [DR-IK-03, 04]

### 3.2 West stairs group (8, 14, 16, 19)

- Exits 8 and 9 are Metro-listed. Exits 14, 16, 19 are absent from Metro's text list; 19 (only) is drawn on Metro's 3D map. [DR-IK-01, 03]
- Toshima guide: 19 is labelled 西口（中央）/ West Exit (Cntrl); 20a/20b/20c are 西口（北）; 4 is 西口（南）. 14 and 16 carry no hall name. [DR-IK-04]
- Toshima's 2016 plan scope: 東武ホープセンター, 池袋ショッピングパーク and the connecting underground passages (passages ~28,800 m2 of ~40,200 m2). It does not list exits. Disaster-control parties named: JR East, Seibu, Tobu, Tokyo Metro, 東武百貨店, 東武百貨店ホープセンター事業部, そごう・西武, 池袋ショッピングパーク, パルコ. [DR-IK-09]
- 東武ホープセンター: "池袋西口公園バス停より徒歩2分 / 池袋駅西口より階段で地下1Fへ" (a stair from the West Exit to B1; no exit number). Shop hours 10:00～21:00 vary per shop; these are shop hours, not passage hours. [DR-IK-08]
- Lift hours on JR's page (restricted source): "中央1改札を出て西口方面階段裏エレベーター 5時から0時30分" and centre lift 6時10分～23時, and the east-side Metro lift 4時45分～0時30分. Nothing states these are at exit 19 or any numbered exit. [DR-IK-11]

### 3.3 West corridor (5, 6a, 6b, 7)

- All four are Metro-listed with nearby 東武百貨店 池袋店 (5: also エソラ池袋, ステーションコンファレンス池袋, メトロポリタンプラザ, ルミネ池袋; 6a: 城北ビル; 7: 第一西池ビル). None has a lift mark or a `*` mark. [DR-IK-01]
- The Metro list says "nearby facility/building", not "directly connected"; no source read states a direct underground link from any numbered exit into a building. [DR-IK-01]
- Toshima guide order as drawn: 5 at the Esola frontage in the south; 6a at the south-west tip and 6b north of it beside the Tobu department store block; 7 at the north end of the south Hope Center block. [DR-IK-04]
- 東武百貨店 says it is 池袋駅西口 直結 and lists gate names by operator; it does not mention any numbered exit. [DR-IK-07]
- Metro's accessibility page lists the Yurakucho ground lift at Exit 4 (エソラ) and none at 5, 6a, 6b, 7. This says no Metro lift is listed there; it does not say no step-free route exists. [DR-IK-02]

### 3.4 North-east (23, 24, 25, 29, 30, 31)

- Only 29 (and 33, 34, 35) are in Metro's list; 29's nearby facility is としま区民センター. 23, 24, 25, 30, 31 are not in the Metro list. [DR-IK-01]
- Toshima guide: 23 and 29 at the north-west and north stairs of the 池袋ショッピングパーク block; 24 and 25 two separate labels one above the other (each with a stair symbol); "30" and "31" in one box with one stair symbol; 32, 33, 34, 35 further south-east. [DR-IK-04]
- Toilet pictograms near 24/25 and 26 carry time labels (月~土 10:00-21:00, 日・祝 10:00-19:30). They label toilets, not stairs, and are not exit hours. [DR-IK-04]
- Metro: ground lift marked on 35 in the list, but the accessibility page words the lift as 中央通路東改札～３４番出入口 and the escalator as 中央通路東改札～３５番出入口. The two Metro pages disagree on 34/35. [DR-IK-01, 02]
- The ISP official site and the PARCO access page could not be read on 2026-10-22 (connection refused / HTTP 502). [DR-IK-17]

### 3.5 Gates (Marunouchi central west / central / east; Tobu central 1 / 2)

- Marunouchi: 中央通路西改札 and 中央通路東改札 in Metro's own text; 中央通路中央改札 only on the Toshima guide. Drawn order west, central, east along 中央通路 with the passage label between west and central. [DR-IK-02, 04]
- Metro: 改札内 lift ホーム（終端寄り）～中央通路西改札; 改札外 lift 中央通路東改札～３４番出入口. [DR-IK-02]
- Toshima 2019 barrier-free summary (medium-term project): "中央通路に面する改札口では、他事業者とJR混同しない案内方法等を検討" — gates face the Central Passage and are confusable between operators. [DR-IK-10]
- Tobu: own map labels 中央1改札口, 中央2改札口, 北改札口, 南改札口, JR線のりかえ改札口 plus a callout 丸ノ内線・副都心線 改札口 (its pointer target is not interpreted). Toshima draws 中央改札2 north and 中央改札1 south of the Central Passage; JR 中央2改札 north, 中央1改札 south. Both as drawn. [DR-IK-04, 06]
- Name variants for the same gate across operators: 中央通路西改札 (Metro, Toshima, Hope Center) vs 丸ノ内線中央連絡西改札 (東武百貨店); 中央改札1 (Toshima) vs 中央1改札口 (Tobu) vs 東上線中央改札1・2 (東武百貨店). [DR-IK-02, 04, 06, 07, 08]
- 東武ホープセンター: from 中央通路西改札 (Marunouchi), 南通路西改札 (Yurakucho), 西通路東改札 (Fukutoshin, "左方向へ") the route to the Hope Center runs through the underground passage towards the West Exit. Each is phrased "改札を出て", i.e. after leaving the gate; no exit number. [DR-IK-08]

### 3.6 Yurakucho South Passage gates and the Tobu-JR link

- Yurakucho: 南通路西改札 and 南通路東改札 (Metro accessibility; Toshima guide, drawn west and east of the JR 南改札 label). 改札外 lift and escalators from 南通路西改札 to Exit 4 (エソラ). [DR-IK-02, 04]
- Tobu map: JR線のりかえ改札口 exists as a Tobu gate name; the page and maps read do not say whether the passage along the JR west side is open to non-ticket holders. [DR-IK-06]

### 3.7 Step-free and hours (cross-cutting)

- Metro ground lifts by exit: 4 (list and accessibility), 34 (accessibility) or 35 (list), C1b, C9. No numbered exit in the 20 appears. [DR-IK-01, 02]
- Metro's lift outage notice for 2026年10月: inspections B2F-B1F/B1F-1F on 2026年10月16日 (Fukutoshin); times 9:00〜17:00. Not a normal operating-hours statement. [DR-IK-01]
- Metro `*` time-limited exits: 1a, 2a, 1b, 39, 40, C4 (C4 also 閉鎖中 in the Toshima 2022 guide). Hours not given. [DR-IK-01, 04]
- Exit-level opening hours for 5, 6a, 6b, 7, 8, 9, 14, 16, 19, 23-25, 29-31 are not stated anywhere read. Absence of a `*` is not a statement of 24-hour access. [DR-IK-01]
- Seibu states 西武南口 7:00～22:30 and 定期券うりば hours; no Ikebukuro passage hours. [DR-IK-12]

### 3.8 Data availability

- ODPT's Tokyo Metro catalogue lists 10 datasets (駅情報 JSON among them; no separate station-facility dataset), all under 公共交通オープンデータ基本ライセンス. Whether 駅情報 carries exit or lift fields was not checked (no payload read). [DR-IK-15]

## 4. Source records

Common: checked 2026-10-22.

| source_id | title | publisher | URL | update date as stated | terms / licence (+ terms URL) | modification | redistribution | availability | rights class | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| DR-IK-01 | 池袋駅 駅トップ (出口案内, のりかえ出口案内, lift outage notice) | 東京地下鉄 (Tokyo Metro) | https://www.tokyometro.jp/station/ikebukuro/index.html | exit guide 改定日 2026年3月; transfer guide 2026年5月1日 (one further block on the page shows 2019年7月5日); 運転停止予定 2026年10月 | All content copyrighted; use, reprint, copy, redistribution without permission prohibited beyond 私的使用/引用 (art. 1). https://www.tokyometro.jp/terms/index.html | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Exit list is JS-populated and read from the rendered DOM. List is Metro's exits only; it omits 19 though the 3D map labels it. WebFetch (summariser) first returned a truncated list; DOM read is the authority. DOS:I-02. |
| DR-IK-02 | 池袋駅 バリアフリー設備 | 東京地下鉄 | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | not stated | as DR-IK-01 | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Lift/escalator pairs per line; two Fukutoshin escalators carry 始発～24：00 / 始発～24：15; no other hours. |
| DR-IK-03 | 池袋駅構内立体図 (simple), figure_yardmap_ikebukuro_simple.png | 東京地下鉄 | https://www.tokyometro.jp/station/yardmap_img/figure_yardmap_ikebukuro_simple.png | [2026.3現在] printed on the image | as DR-IK-01 | no | no | FILE_INSPECTED | FACTS_ONLY_REFERENCE | Viewed once at reduced size (2.8 MB). Labels read: 5, 6a, 6b, 7, 8, 9, 19 and C-series; 14, 16, 23-25, 29-31 not seen at that size. Not stored in the repo. Fetched with a plain page request; the earlier lane reported Access Denied. |
| DR-IK-04 | 池袋駅地下空間案内図の配布について（令和4年1月更新版） + 地下空間案内図 (PDF, 2 pages, 428 KB), undergroundmap_202201.pdf | 豊島区都市整備部 | https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf (landing: https://www.city.toshima.lg.jp/405/1705251510.html) | notice dated 令和4年1月6日; map credit 作成：豊島区都市計画課（2020年4月）; landing page updated 2025年8月4日 | Notice 留意点: adding own info, printed matter, distribution, HP posting is not hindered; altering railway route marks or commercial logo marks, unauthorised reuse (転載), and unlicensed 2nd-hand use are to be refrained from; other uses: consult the contact. No CC statement. Site policy https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html | UNKNOWN (3D/derivative not covered) | UNKNOWN (2D posting allowed; redistribution of derivatives not covered) | FILE_INSPECTED | FACTS_ONLY_REFERENCE | DOS:I-05. No newer map version is listed on the landing page. Changes in this version: 1a and C4 exits closed (Marui demolition). Contact details exist on the notice; not used. |
| DR-IK-05 | 池袋ターミナル案内サインガイドライン (landing page for the underground map) | 豊島区 | https://www.city.toshima.lg.jp/405/1705251510.html | 2025年8月4日 | Site policy as DR-IK-04. Page says follow the notice's 留意点. | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Page heading says 令和2年3月改定 while the browser title says 平成30年5月改定. Links two guideline PDFs (3.7 MB, 5.4 MB, 8.1 MB sign plans) not opened (size). |
| DR-IK-06 | 池袋駅 (station page) and 構内マップ GIF | 東武鉄道 | https://www.tobu.co.jp/railway/guide/station/info/7105/ ; https://www.tobu.co.jp/railway/guide/station/insidemap/7105/ ; https://www.tobu.co.jp/cms-img/stations/20231221095530V2Amh3nWeUA4TlFcBebONQ.gif | not stated on page (file name carries 20231221…; not asserted as a date) | 第7条 no copying/selling/publishing beyond private use without approval; 第8条 no commercial use of the service. https://www.tobu.co.jp/sitepolicy/ | no | no | FILE_INSPECTED (GIF, 62 KB) | FACTS_ONLY_REFERENCE | Gate names only. DOS:I-03. Dossier cited 第7条 only; 第8条 (営業活動の禁止) is an extra constraint. |
| DR-IK-07 | アクセス (東武百貨店 池袋店) | 東武百貨店 | https://www.tobu-dept.jp/ikebukuro/access/ | not stated | 利用規約 link in footer; not read. | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Lists gate names per operator under "池袋駅西口 直結". No numbered exit. |
| DR-IK-08 | アクセス・駐車場 (東武ホープセンター) | 東武ホープセンター (東武百貨店) | https://tobuhopecenter.jp/info/access/ | not stated | 利用規約 link in footer; not read. | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Route text from each operator's gate to the West Exit passage; shop hours 10:00～21:00 (per-shop). |
| DR-IK-09 | 池袋駅周辺地下街防災推進計画（当初） | 池袋駅周辺地下街等協議会 (published by 豊島区) | https://www.city.toshima.lg.jp/405/machizukuri/1706271130.html ; https://www.city.toshima.lg.jp/documents/17945/ikebukurotikabousaisuishinkeikaku.pdf | plan 平成28年10月7日; page 2021年4月20日 | Site policy as DR-IK-04; no CC statement. | UNKNOWN | UNKNOWN | FILE_INSPECTED (8 pages, 665 KB) | FACTS_ONLY_REFERENCE | Scope, areas, managers. No exit table. The plan path in a search result (/405/machizukuri/documents/…) returns 404; the /documents/17945/ path works. |
| DR-IK-10 | 池袋駅地区バリアフリー基本構想 概要版 (baria_gaiyou.pdf) | 豊島区 | https://www.city.toshima.lg.jp/documents/15443/baria_gaiyou.pdf | PDF created 2019-03-22 (metadata); revision 平成31年4月 per search listing, not stated in text read | Site policy as DR-IK-04 | UNKNOWN | UNKNOWN | FILE_INSPECTED (9 pages, 4 MB) | FACTS_ONLY_REFERENCE | One usable statement (gates face the Central Passage). Full concept text (8.8 MB) was auto-saved by the fetch tool, deleted unread (over the 5 MB limit). DOS:I-10. |
| DR-IK-11 | 駅構内図・バリアフリー情報（池袋駅） | 東日本旅客鉄道 | https://www.jreast.co.jp/estation/stations/108.html | not stated | 複製・転用・転載・電磁的加工・送信・頒布・二次的使用 ... 一切お断り. https://www.jreast.co.jp/site/rules.html | no | no | PAGE_READ | RESTRICTED | Text read only. The lane's Owner decision 2026-10-21 records JR East as not used; facts here are noted, not for handoff (a) until the Owner decides (section 8). DOS:I-01. |
| DR-IK-12 | 池袋駅 | 西武鉄道 | https://www.seiburailway.jp/railway/station/ikebukuro/ | not stated | https://www.seiburailway.jp/policy/ (per DOS:I-04; not re-read) | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Gate hours for Seibu 南口 only; no exit facts. DOS:I-04. |
| DR-IK-13 | エチカ池袋 top | Metro Properties | https://www.metropro-sc.jp/echika-ikebukuro/ | not stated; notice 2025年12月24日 on shop hours | All rights reserved; no open licence (per DOS:I-07). | no | no | PAGE_READ | UNKNOWN | Nothing on the 20 POIs. |
| DR-IK-14 | 駅構内図 池袋 / 利用規約 | 交通エコロジー・モビリティ財団 (らくらくおでかけネット) | https://www.ecomo-rakuraku.jp/ja/station_map/%E6%B1%A0%E8%A2%8B/ ; rules https://www.ecomo-rakuraku.jp/ja/info/rule.html | PDF map 2018年2月 per DOS:I-09; page not stated | 無断転載不可; 営利目的での利用はお断り. | no | no | PAGE_READ (PDF not opened) | RESTRICTED | Not mined. DOS:I-09. |
| DR-IK-15 | 公共交通オープンデータ基本ライセンス; 東京メトロ organisation (ckan.odpt.org) | 公共交通オープンデータセンター | https://developer.odpt.org/terms/data_basic_license.html ; https://ckan.odpt.org/organization/tokyometro | not stated | 基本ライセンス: commercial or non-commercial use allowed within the 成果物 (art. 4(7)); no decomposition/modification that impairs original meaning (4(2)(2)); no display outside the 成果物 (4(2)(3)); no public redistribution of data or recoverable derivatives without prior written consent (8(4)(1)); some datasets add 特定利用条件. | UNKNOWN (conditional: no meaning-altering edits) | no (without written consent) | PAGE_READ (no payload) | REUSABLE_WITH_CONDITIONS | Metro catalogue: 10 datasets, all this licence; one 駅情報 JSON; no separate facility dataset visible. Fields of 駅情報 not checked. Key registration needed (DOS:X1). |
| DR-IK-16 | 豊島区 サイトポリシー | 豊島区 | https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html | not stated | Rights held by 豊島区; copying/reuse beyond 私的使用/引用 prohibited without permission; no CC licence on the page. | no | no | PAGE_READ | FACTS_ONLY_REFERENCE | Terms record for DR-IK-04, 05, 09, 10. Open-data CSVs have a separate CC BY 2.1 JP (DOS:I-06); that does not cover these PDFs. |
| DR-IK-17 | 池袋ショッピングパーク (ISP) and 池袋PARCO access pages | ISP; PARCO | https://www.web-isp.co.jp/ ; https://parco.jp/ikebukuro/access/ | n/a | ISP terms per DOS:I-08 (https://www.web-isp.co.jp/terms/); PARCO not read | UNKNOWN | UNKNOWN | DISCOVERED (not readable) | UNKNOWN | ISP: connection refused from this host (browser and WebFetch). PARCO: HTTP 502. Retry later; may hold a "from exit N" statement. |
| DR-IK-18 | Third-party exit listings (ekitan 池袋の出口 and real-estate/map sites) | ekitan, Yahoo, others | https://ekitan.com/sta-info/station/1541/exit | not stated | not read | UNKNOWN | UNKNOWN | DISCOVERED | UNKNOWN | A search snippet suggested "16 = 東武ホープセンター" and "19 = 西口". Not official, not opened, not relied on. |

## 5. What this does not establish

- Which PLATEAU flight, floor opening or gate line is any of the 20 POIs. No page gives a column count, a coordinate, a width or a distance.
- Which hall or passage each exit stair leaves from, in words. The Toshima and Metro drawings are schematics; the Toshima guide itself is dated 2020/2022 and has no newer version listed.
- Whether any exit is reached without passing a fare gate. Metro marks lifts 改札外 and the Hope Center page says "改札を出て ... 地下通路", which implies the passage is outside the gate, but no page ties that to a numbered exit.
- Posted opening hours of any of the 20 exits or the passages. Only Metro's `*` flags and a few lift hours exist.
- Who operates exits 14, 16, 19, 23, 24, 25, 30, 31. Metro does not list them; no other page read says.
- That an exit "next to" a building is directly connected to it.
- That absence of a lift in Metro's lists means no step-free route (other operators' lifts exist: JR page, Tobu page lists lifts without locations).
- Anything about Shinjuku, or anything current after the sources' own dates (Metro list 2026-03; Toshima guide 2022-01).

## 6. Handoff

### (a) Ikebukuro station lead: usable now (facts-only rule, Owner decision #26)

Excluded: DR-IK-11 (JR East) and DR-IK-14 (Ecomo). Not yet usable for DR-IK-07/08 (terms unread; see section 8). Use the fact, not the drawing.

| POI | Fact | source_id | URL |
|---|---|---|---|
| `exit-9` | Metro exit; nearby 三井住友銀行（池袋支店）, 西口バスターミナル; no ground-lift mark; no time-limit mark (list rev. 2026年3月) | DR-IK-01 | https://www.tokyometro.jp/station/ikebukuro/index.html |
| `exit-8` | Metro exit; nearby 東京都豊島合同庁舎, 豊島都税事務所 | DR-IK-01 | same |
| `exit-5` | Metro exit; nearby エソラ池袋, ステーションコンファレンス池袋, 東武百貨店 池袋店, メトロポリタンプラザ, ルミネ池袋 | DR-IK-01 | same |
| `exit-6a`, `exit-6b`, `exit-7` | Metro exits; nearby 城北ビル + 東武百貨店 (6a), 東武百貨店 (6b), 第一西池ビル + 東武百貨店 (7) | DR-IK-01 | same |
| `exit-29` | Metro exit; nearby としま区民センター | DR-IK-01 | same |
| `exit-19` | Named 西口（中央） / West Exit (Cntrl) on the ward guide | DR-IK-04 | https://www.city.toshima.lg.jp/405/1705251510.html |
| `exit-14`, `-16`, `-23`, `-24`, `-25`, `-30`, `-31` | Exist on the ward guide; not in Metro's exit list. No other fact. | DR-IK-01, 04 | as above |
| Marunouchi gates | Names 中央通路西改札 / 中央通路中央改札 / 中央通路東改札; operator Tokyo Metro; gates on the Central Passage; Tobu gates 中央1/中央2 (names) | DR-IK-02, 04, 06, 10 | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html ; ward guide ; https://www.tobu.co.jp/railway/guide/station/insidemap/7105/ |
| Yurakucho gates | 南通路西改札, 南通路東改札; 改札外 lift and escalators 南通路西改札～4番出入口（エソラ） | DR-IK-02 | accessibility page |
| step-free | Metro-listed ground lifts at 4, 34/35 (mismatch), C1b, C9 only; none at the 15 exits | DR-IK-01, 02 | as above |
| hours | Metro `*`: 1a, 2a, 1b, 39, 40, C4; no flag on 5-9, 29 (not a 24-hour statement) | DR-IK-01 | as above |

#### 6a.1 Per-POI evidence in the lead's wiring format

Rule applied: the lead wires a verified edge only when a source fact names **both endpoints**. Retrieved 2026-10-22 for every row. Quotes are single-line text labels from the page or PDF text; nothing graphic is copied. "Level" and "vertical device" are filled only where a source states them in text; a pictogram on a drawing is not counted (the Toshima guide draws stair symbols next to exit labels; that is a graphic, so the column says "text: none").

Source key (publisher / URL / terms status):
- **M-list** = Tokyo Metro 出口案内, 東京地下鉄, https://www.tokyometro.jp/station/ikebukuro/index.html (DR-IK-01). Terms: all rights reserved, no use beyond 私的使用/引用 without permission (https://www.tokyometro.jp/terms/index.html). Status: FACTS_ONLY_REFERENCE.
- **M-acc** = Tokyo Metro バリアフリー設備, 東京地下鉄, https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html (DR-IK-02). Terms and status as M-list.
- **T-guide** = 池袋駅地下空間案内図 (令和4年1月更新版), 豊島区, https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf (DR-IK-04). Terms: notice 留意点, no CC licence; site policy https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html. Status: FACTS_ONLY_REFERENCE; derivative/3D use UNKNOWN.
- **Tobu-map** = 東武鉄道 池袋駅 構内マップ, https://www.tobu.co.jp/railway/guide/station/insidemap/7105/ (DR-IK-06). Terms 第7条/第8条 (https://www.tobu.co.jp/sitepolicy/). Status: FACTS_ONLY_REFERENCE.
- **Hope** = 東武ホープセンター アクセス, https://tobuhopecenter.jp/info/access/ (DR-IK-08). Terms: 利用規約 not read; UNKNOWN.
- **Dept** = 東武百貨店 池袋店 アクセス, https://www.tobu-dept.jp/ikebukuro/access/ (DR-IK-07). Terms not read; UNKNOWN.

| POI | Source(s) | (a) connects to, as stated | (b) level | (c) stairs / escalator / lift | Both endpoints stated? |
|---|---|---|---|---|---|
| `exit-9` | M-list; T-guide | M-list text row: "9 三井住友銀行（池袋支店） / 西口バスターミナル" (exit to two nearby landmarks). T-guide: exit label "9" only. No passage or hall named. | not stated | text: none (M-list shows no 地上行エレベーターあり mark; that is not a stair statement) | **No** (landmarks only; the underground endpoint is not named) |
| `exit-8` | M-list; T-guide | "8 東京都豊島合同庁舎 / 豊島都税事務所" | not stated | text: none | **No** |
| `exit-14` | T-guide (not in M-list) | label "14" only | not stated | text: none | **No** |
| `exit-16` | T-guide (not in M-list) | label "16" only | not stated | text: none | **No** |
| `exit-19` | T-guide (not in M-list) | label "西口（中央） West Exit (Cntrl) 19" (exit name only) | not stated | text: none | **No** |
| `exit-5` | M-list; T-guide | "5 エソラ池袋 / ステーションコンファレンス池袋 / 東武百貨店 池袋店 / メトロポリタンプラザ / ルミネ池袋" | not stated | text: none (M-acc lists the Y09 ground lift at 4番出入口（エソラ）, not at 5) | **No** |
| `exit-6a` | M-list; T-guide | "6a 城北ビル / 東武百貨店 池袋店" | not stated | text: none | **No** |
| `exit-6b` | M-list; T-guide | "6b 東武百貨店 池袋店" | not stated | text: none | **No** |
| `exit-7` | M-list; T-guide | "7 第一西池ビル / 東武百貨店 池袋店" | not stated | text: none | **No** |
| `exit-23` | T-guide (not in M-list) | label "23" only | not stated | text: none | **No** |
| `exit-24` | T-guide (not in M-list) | label "24" only (a separate label "25") | not stated | text: none | **No** |
| `exit-25` | T-guide (not in M-list) | label "25" only | not stated | text: none | **No** |
| `exit-29` | M-list; T-guide | "29 としま区民センター" | not stated | text: none | **No** |
| `exit-30` | T-guide (not in M-list) | label "30" in the same box as "31" | not stated | text: none | **No** |
| `exit-31` | T-guide (not in M-list) | label "31" in the same box as "30" | not stated | text: none | **No** |
| `metro-m-central-west-gate` | M-acc; T-guide; Hope; Dept | M-acc: "ホーム（終端寄り）～中央通路西改札" (改札内 lift). T-guide: "中央通路西改札 Central Passage West Gate". Hope: "中央通路西改札を出て地下通路を西口方面へ". Dept: "丸ノ内線中央連絡西改札" (variant name). | not stated | M-acc: エレベーター (platform side to this gate, inside the fare zone) | **Yes, but only for the lift**: gate and platform are both named; the platform is not a free-passage node. For the passage side: **No** (Hope names a direction, 西口方面, not a node) |
| `metro-m-central-gate` | T-guide only | "中央通路中央改札 Central Passage Central Gate" (name only) | not stated | text: none | **No** |
| `metro-m-central-east-gate` | M-acc; T-guide | M-acc: "中央通路東改札～３４番出入口" (改札外 エレベーター) and "中央通路東改札～３５番出入口" (under エスカレーター; direction not read from the text). T-guide: "中央通路東改札 Central Passage East Gate". | not stated | M-acc: エレベーター to 34; エスカレーター to 35. M-list marks the ground lift on 35, not 34 (mismatch, FC-IK-02) | **Yes** for gate-34 (lift) and gate-35 (escalator) as text pairs. Wiring should wait on FC-IK-02 because the two Metro pages disagree on which exit has the lift. |
| `tobu-central-gate-1` | Tobu-map; T-guide; Dept | Tobu-map label "中央1改札口"; T-guide "中央改札 1 Central Gate 1"; Dept "東上線中央改札1・2" | not stated | text: none | **No** |
| `tobu-central-gate-2` | Tobu-map; T-guide; Dept | Tobu-map label "中央2改札口"; T-guide "中央改札 2 Central Gate 2" | not stated | text: none | **No** |

Gap-level pairs that do name both endpoints (not among the 20 POIs, listed because they are the only two-endpoint statements found):

| Pair | Source | Exact statement | Level | Device | Both endpoints? |
|---|---|---|---|---|---|
| Yurakucho 南通路西改札 to Exit 4 | M-acc | "南通路西改札～４番出入口（エソラ）" under 改札外 エレベーター; also listed under エスカレーター | not stated | lift and escalator | Yes. Note Exit 4 is already routed; the West gate has no POI yet (`gap-south-west`, F2). |
| Fukutoshin 西通路東改札 to C9 / C1b | M-acc; M-list outage table | "西通路東改札～Ｃ９番出入口 西通路東改札～C１b出入口" (改札外 エレベーター); outage table gives "B1F-1F" for 西通路東改札～Ｃ９番出入口 | B1F-1F (C9 only) | lift | Yes; outside the 20 POIs. |

Summary for the lead: of the 20 POIs, only `metro-m-central-east-gate` has a source text naming both ends of a pair (gate to Exit 34 by lift, gate to Exit 35 by escalator), and that pair carries a 34/35 conflict. `metro-m-central-west-gate` has a gate-to-platform lift whose platform end is not in the free-passage graph. The other 18 stay search-only with the evidence in this table attached. None of the facts gives a level (B1/B2/street) per exit or gate in text.

Do not write the relative label placement ("drawn south of 10") into data as an access fact; it is layout (section 8).

### (b) GIS: sources worth registering

- DR-IK-15 ODPT Metro 駅情報 (JSON, 公共交通オープンデータ基本ライセンス): check, with a key, whether it has exit/facility fields; redistribution of data or recoverable derivatives is barred without written consent.
- DR-IK-01, 02 Tokyo Metro exit list and accessibility page: register as FACTS_ONLY_REFERENCE; the exit list is the only public machine-readable-in-DOM exit-to-landmark table found.
- DR-IK-04 Toshima guide (existing `toshima-underground-guide-2022`): add notice date 令和4年1月6日 and the 留意点 wording; no 2023+ version exists on the landing page.
- DR-IK-09, 10: register as context only (scope, no exits).
- DR-IK-07, 08, 17: register as DISCOVERED; terms unread / pages unreachable; retry ISP and PARCO later.
- Not for registration as usable: DR-IK-11, 14, 18.

## 7. Field-collection items

Existing ids stay as written in `field-checklist.md`. New ids are FC-IK-nn. All items are outside the fare gates; none needs a paid area. Photo rules as in the checklist (facts-only sign photos, never published).

| id | Place | What to observe / measure | Method | Est. cost | Paid area? | Unblocks |
|---|---|---|---|---|---|---|
| B2 (existing) | West Exit hall, west passage | Exit 9 stair start, side, columns from Exit 10's stair. Add: record the sign wording at the stair head. | look, count columns, sign photo | 5 min | no | `exit-9`, `gap-west-stairs` |
| B3, B4, B5, B6, C1 (existing) | West Exit hall | Exits 14, 16, 19, 8 stairs and the two unmatched flights | as listed | 10 min | no | `exit-14/16/19/8`, `gap-west-stairs` |
| D1 (existing) | Passage north of West Exit (South) hall | 5, 6a, 6b, 7: side and column | count columns | 10 min | no | `gap-west-corridor-exits` |
| G1, G2 (existing) | North-east passage | 24/25 stair labels; reachability of 23, 29, 30, 31 | sign photo | 15 min | no | `gap-ne-north` |
| A1, A2, A3 (existing) | Central Passage | Gate side and column. Add: photograph the printed gate-name plates (Metro west gate vs 東武百貨店's name 中央連絡西改札; Tobu 中央1/2). | photo of sign, count columns | 10 min | no | `gap-metro-tobu-gates` |
| F2, F3 (existing) | South Passage; JR west passage | Yurakucho gates; JR-Tobu link ends | look, sign photo | 10 min | no | `gap-south-west`, `gap-tobu-jr-link` |
| H1, H2 (existing) | Along the walk | Posted hours; lifts | photo of sign | 0 extra | no | `gap-hours`, `gap-step-free` |
| FC-IK-01 | Passage west of Tobu 中央1 gate, towards the West Exit stairs and Exit 19 | The lift described on JR's page as 西口方面階段裏エレベーター: exists? which levels does it serve? posted hours? which exit number or sign does it name? | look, sign photo | 5 min | no | `gap-step-free` (West), `exit-19` |
| FC-IK-02 | East of 中央通路東改札, Exits 34/35 | Which exit number the lift and which the escalator surface at (Metro pages disagree: 34 vs 35). | sign photo | 10 min | no | `gap-step-free` (East) |
| FC-IK-03 | East side of the shopping-park block | Exits 30 and 31: one stairway with two numbers, or two stairways. | look, sign photo | 5 min | no | `exit-30`, `exit-31` |

## 8. Owner decisions needed

1. **JR East facts.** The JR page states three lift hours (centre lift 6:10-23:00; east-side Metro-side lift 4:45-0:30; lift behind the West Exit stairs after 中央1改札 5:00-0:30). JR's terms bar every use; the 2026-10-21 decision records JR East as not used. May those facts be used under the #26 facts-only rule, or does "not used" stand? Until decided they are in findings only, not handoff (a).
2. **Label placement as a fact.** Is "9 is drawn immediately south of 10 on the west edge of the block" a fact or layout (the work)? The Toshima notice forbids altered marks and unauthorised reuse; Metro and Tobu terms are stricter. Data should carry exit numbers, names and landmarks; placement is kept in this research file only unless the Owner says otherwise.
3. **Tobu terms 第8条 (no commercial use).** DOS:I-03 cited only 第7条. The facts used from the Tobu map are four to five gate names. Confirm the #26 facts-only rule covers them.
4. **Unread terms (UNKNOWN).** 東武百貨店 (DR-IK-07) and 東武ホープセンター (DR-IK-08) 利用規約 were not read; ISP and PARCO could not be reached. Approve reading them, or keep their content out of data.
5. **ODPT key.** Registering for an ODPT key to inspect 駅情報 fields is an account sign-up to an external service. Under "contact no external party", does a self-service sign-up count? (Not done.)
6. **Toshima notice offers consultation for other uses** (the contact is on the notice). Not used, per the decision of no outside contact. Recorded here only because it is the stated route for a 3D-derivative permission.
7. **Process note.** The fetch tool auto-saved an 8.8 MB Toshima PDF; I deleted it unread. I used the ego-lite browser for page text (no Chrome tools).
