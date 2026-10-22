# DR-RT: retry of the sources that could not be read in R1, R2 and R3 (R8)

## 1. Header

- Tracking: issue #165 item R8. Updates `DR-IK-station-facts.md` (R1: DR-IK-07, 08, 17; Section 6a.1 rows), `DR-SJ-station-facts.md` (R2: DR-SJ-12, 16; Q1, Q3, C), `DR-changes-since-2023.md` (R3: CH-IK-01, 02, 06, 09; CH-SJ-15, 16; DR-CH-15, 16, 27, 30, 33).
- Checked: 2026-10-22 (JST).
- Method: desk research. Each unread source was tried again, with alternate official URLs, ward- or Tokyo-hosted copies, and an attempt at Wayback Machine snapshots. Tools: HTTP status probes (curl, status line only), WebFetch (small-model page summaries), WebSearch, and the ego-lite browser for page text up to the lead's freeze notice (browser task space closed when the notice arrived; no browser use after that; later reads used WebFetch and WebSearch only). PDFs that the fetch tool auto-saved to the harness tool-results folder (outside the repo) were opened with the Read tool only when 5 MB or smaller, and deleted afterwards. Three over-limit files (7.6 MB, 7.1 MB, 9.8 MB) were deleted unread. Nobody was contacted; no forms, no sign-ups; no Toei per-exit coordinate feed; no `related` values (S10, S03, PLATEAU).
- Owner decisions applied: OD-02 no JR East data (JR content not recorded); OD-01 Tobu gate names not used (not listed here); OD-03 relative label placement is layout, not fact; OD-05 third-party pages and news are indicators only.
- Reading note: rows marked "fetch summary" were read through WebFetch's summariser, not verbatim. Strings quoted from PDFs were read directly from the page images with the Read tool.
- Short result: Keio (whole site, 503) and ISP (connection refused) are still unreachable; Odakyu is still unreachable; Wayback was not retrievable from this session. New and readable: the Toshima 2026-03-25 committee page and 資料2; the 地下道 No.3/No.4 wording in an opened document; the C1b release (planned dates only); the Tobu FY2024 results slides; PARCO's own site (new URL); the terms of 東武百貨店, 東武ホープセンター, PARCO. **No source read states a passage or an opening for any of the 20 search-only POIs, or for the 南通路西改札 to Exit 4 pair, beyond what R1 already has. No row added to Section 6.**

## 2. Retry table

Status words: READ = text read; UNREACHABLE = still no content; PARTIAL = reachable, relevant part unread.

| Source | Earlier status (file + item) | Retry result | New facts (one line) | Updates | source_id |
|---|---|---|---|---|---|
| Keio 新宿 / 京王新線新宿 station pages | R2 DR-SJ-12: HTTP 503 | UNREACHABLE: HTTP 503 "server under maintenance" (browser, WebFetch, curl; top page also 503) | none | R2 Q1, Q3 stay UNKNOWN | DR-RT-01 |
| Keio 2023-08-02 release (two PDF paths) | R3 DR-CH-15: 503 | UNREACHABLE: HTTP 503 on both `nr20230802_shinjuku.pdf` and `nr230802v02.pdf` | none (Keio's own text on the B2 platform / new gate still comes only from the 2026-05-13 release copy and the ward sheet in R3) | R3 CH-SJ-16 unchanged | DR-RT-02 |
| Odakyu 新宿 station page, site top, policy | R2 DR-SJ-16 / R3 DR-CH-16: timeout, 504 | UNREACHABLE: browser "ERROR: The request could not be satisfied", WebFetch HTTP 504, curl timeout | none | R2 Odakyu items stay UNKNOWN | DR-RT-03 |
| Wayback Machine snapshots of Keio and Odakyu pages | not tried | UNREACHABLE from this session: WebFetch refuses `web.archive.org`; `archive.org/wayback/available` returned HTTP 429 | none; **deferred (browser freeze until 19:30)** | none | DR-RT-04 |
| ISP (池袋ショッピングパーク) site | R1 DR-IK-17: connection refused | UNREACHABLE: connection refused again (browser, WebFetch https and http, curl) | none | R1 DR-IK-17 stays DISCOVERED | DR-RT-05 |
| 池袋PARCO access | R1 DR-IK-17: HTTP 502 | READ at the new host `ikebukuro.parco.jp/info/` (old `parco.jp/ikebukuro/access/` now 404) | the page states address, hours and facility list; **no exit number, passage, gate or walking time** | R1 DR-IK-17 | DR-RT-06 |
| PARCO terms | R1 DR-IK-17: not read | READ | private use only; no copy, transmit, distribute, translate or adapt beyond it without permission | R1 DR-IK-17 terms | DR-RT-06 |
| 東武百貨店 access and terms | R1 DR-IK-07: terms unread | READ (fetch summary) | page content unchanged from R1 (no numbered exit); terms read: use limited to private use and quotation | R1 DR-IK-07, Owner decision 4 | DR-RT-07 |
| 東武ホープセンター access and terms | R1 DR-IK-08: terms unread | READ (fetch summary) | page: no hours for passages, no elevators, no exit numbers; terms as above | R1 DR-IK-08, Owner decision 4 | DR-RT-08 |
| Toshima 第14回 委員会 (2026-03-25) page, 次第, 会議録 | R3 DR-CH-27: 資料2, 資料3 not opened | READ (page and minutes); 資料2 READ; 資料3 PARTIAL (7.8 MB, over the limit, not read) | 資料2 is Tokyo Metro's: exits 1a and C4 reopened on March 6 (see 3.1) | R3 DR-CH-27; R1 gap-hours, 3.7 | DR-RT-09, 10, 11 |
| Toshima guideline landing page | R1 DR-IK-05 | READ again | updated 2025-08-04; no 令和8年 version listed; the 資料3 update is not yet on it | R1 6(b) | DR-RT-12 |
| 池袋駅付近地下道 No.3/No.4 (廃止) | R3 CH-IK-06: wording only in a search summary | READ in an opened document | table rows "池袋駅付近地下道第3号線 1. 廃止" and "第4号線 1. 廃止" | R3 CH-IK-06 | DR-RT-13, 14 |
| Tokyo Metro C1b opening date | R3 CH-IK-01: plan only | READ the Metro release (PDF) | planned dates only: 供用開始日 2024年11月下旬（予定）; actual date still not found | R3 CH-IK-01 | DR-RT-18 |
| Exit 2b reopening | R3 CH-IK-02: not found | not found; theatre reopening confirmed | theatre reopened 2025-09-06 (Tokyo bureau text); 2b reopening date not stated anywhere read | R3 CH-IK-02 | DR-RT-20, 21, 22 |
| Tobu FY2024 results material (2025-05-19) | R3 DR-CH-33: not opened | READ (48-page PDF, pages 23-37 viewed) | 3面3線 to 3面4線; roadmap FY2027 approvals, FY2030 start; no gate, lift or passage statement | R3 CH-IK-09 | DR-RT-16 |
| Tobu 2024-03-26 release; 事業 page; 統合報告書2026 | R3 DR-CH-29, 33 | release and page READ; integrated report NOT read (9.8 MB) | 工事期間 2027年度〜2043年度（予定）※解体含む | R3 CH-IK-05, 09 | DR-RT-15, 17 |
| Odakyu / Metro / Tokyu 2024-03-25 joint release (Metro-hosted copy) | R3 DR-CH-16: Odakyu original 504 | READ | construction start 2024-03-25, completion FY2029; **no passage, gate or exit statement** | R3 CH-SJ-15 | DR-RT-19 |
| Keio barrier-free plan (Tokyo-hosted) | R2 Q3: Keio side UNKNOWN | READ (1 page) | Keio states a second barrier-free route is complete at 新宿 (route level; no exit) | R2 Q3 | DR-RT-23 |
| Toshima 特定事業計画 (2020-03) | not read | READ (pages 1-6, 43-47) | ISP, Hope Center and Tobu department store facility items (2020 status); no exit numbers | R1 3.3, 3.4 | DR-RT-24 |
| 11番階段 notice (Tokyo / Odakyu) | R3 CH-SJ-13 | READ (image) | confirms stair 11 closure and temporary stair from first train 2026-06-23 | R3 CH-SJ-13 | DR-RT-25 |

## 3. Findings (facts only)

### 3.1 Ikebukuro: exits 1a, C4, C1b, 2b

- Tokyo Metro's 資料2 for the 14th committee ("池袋ターミナル案内サインの変更について 東京メトロ") says exit 1a (Yurakucho) and exit C4 (Fukutoshin) "2022年から閉鎖" for the Marui rebuild; "１ａ、Ｃ４は3月6日に供用開始しております。（ビルは3月14日オープン）". The slide prints no year; it was tabled at the committee of 2026-03-25. It also says Metro distributed correction stickers for its 地下案内図 and 周辺案内図 to the sign managers. [DR-RT-10]
- On the same slide an overhead sign for C4 is shown with the note "設置位置変更に伴う矢印変更、EV設置に伴う表示追加" (arrow changed, lift display added). It says an elevator display was added for C4; it does not give the lift's route, levels or hours. [DR-RT-10]
- Effect on R1: the Toshima guide of 令和4年1月 (DR-IK-04) draws 1a and C4 as closed; per this slide both were back in service on March 6 (year as above). R1's `*` time-restriction flags for 1a and C4 therefore describe exits in service. Neither exit is among the 20 POIs. [DR-RT-10, DR-RT-12]
- C1b: Tokyo Metro's release of 2024-09-02 (Metro news 24-56), page 3 "新設出入口の概要": 出入口名称 "東京メトロ副都心線池袋駅 C1b出入口"; 構造 "階段、エレベーター（1基・20人乗り）"; 供用時間 "始発から終発まで（予定）"; 供用開始日 "2024年11月下旬（予定）". The body says the new exit has an elevator "地上行". Every date and the hours are marked planned. No document read states the actual opening date. The release does not name 西通路東改札; that pairing comes from Metro's accessibility page (R1 DR-IK-02). [DR-RT-18]
- Exit 2b: the Toshima-hosted route guide for 東京芸術劇場 (text "発行：2022.12.16"; file name dated 20250917) says "池袋駅 2b 出口は、東京芸術劇場直結の出入口です" and routes from 2b (B1F) by stairs, then an elevator to 1F. The theatre's access page (undated) says the theatre connects directly to exit 2b, that the stair from the exit leads to theatre B1, and that a wheelchair stair-lift is used by telling staff by intercom (fetch summary). [DR-RT-22, DR-RT-20]
- Theatre closure: Tokyo's 生活文化局 case sheet (令和7年9月分) says the theatre was closed from 令和6年9月30日 for equipment renewal and reopened on 令和7年9月6日（土曜日）. [DR-RT-21]
- No document read states that exit 2b reopened or on what date. Metro's earlier slide (R3 DR-CH-22) gave a planned closure of 2024-09-30 to 2025-07-07, which differs from the theatre's actual reopening date. [DR-RT-21, R3 DR-CH-22]

### 3.2 Ikebukuro: 地下道 No.3 and No.4

- Toshima hosts a Tokyo 都市計画 document titled "東京都市計画道路の変更" (PDF metadata: created 2024-05-21, modified 2024-12-12). Its lead sentence changes and abolishes (変更及び廃止) listed roads including "池袋駅付近地下道第3号線及び池袋駅付近地下道第4号線". Its 変更概要 table has the rows "池袋駅付近地下道第3号線: 1. 廃止" and "池袋駅付近地下道第4号線: 1. 廃止". Also abolished: 池袋駅付近街路第5号線. Renamed: 池袋駅付近広場第2号線 and 街路第4号線 to 補助線街路第78号線. The stated reason: "まちに人を送り出すための基盤整備、…駅とまちが一体となった快適性、回遊性の高い都市空間を創出するため変更する。" [DR-RT-13]
- The ward's package page (updated 2024-12-26) lists the same two designations under a 告示 dated 令和6年11月11日 and a 内閣総理大臣の認定 dated 令和6年10月23日; it does not itself say "abolished" per item. [DR-RT-13]
- A Tokyo 都市計画駐車場 draft (第29号池袋西口駐車場, 素案, from the Cabinet Office site) has a plan drawing whose legend marks "計画変更廃止区域" in yellow and carries a text label "地下道3" near it. The draft's own text covers area (0.57 ha to 0.93 ha) and levels (地下2〜3層 to 地下5層); it says nothing about what 地下道3 is physically. [DR-RT-14]
- A 都市計画 designation is a planning line. These documents do not state that any passage exists, was open, or was closed, and they do not tie 地下道 No.3 or No.4 to any exit number or POI. [DR-RT-13, DR-RT-14]

### 3.3 Ikebukuro: redevelopment and Tobu

- Tobu's results slides (2024年度, dated 2025-05-19), page 33: policy for 池袋駅西口再開発; roadmap 都市計画決定 in FY2024, 組合設立認可 and 事業計画認可 in FY2027, 権利変換計画認可 and 工事着工 in FY2030, 工事竣工 later (no year printed). For the Tobu-only block: an "アトリウム空間", a plaza above the Tojo tracks, and "池袋駅を3面3線から3面4線化". Page 30 chart: 池袋駅西口 [再開発] 着工 around 2030, 順次竣工 after 2040. No ticket gate, lift or underground passage statement. [DR-RT-16]
- Tobu's 2024-03-26 release (with the redevelopment association): 工事期間 "2027年度〜2043年度（予定）※解体含む"; 特区域面積 約6.1 ha; towers A (地上41階) B (地上50階) C (地上33階). One perspective image is captioned "地上から中央地下通路を望む"; that is an artist's image, not a statement about existing passages. [DR-RT-15]
- Tobu's 事業 page: 準備組合区域 about 4.6 ha and Tobu-only area about 1.5 ha, 都市計画決定 in 2024年度; image caption "駅まち結節空間". No station-facility detail. [DR-RT-17]
- The Tobu integrated report 2026 (9.8 MB) was not read. A search excerpt says it records a contractor for the Tobu-only block and "2027年度の事業認可" as the target; this is not verified. [DR-RT-17]
- Passage effects of the Odakyu / Keio redevelopment are still not stated in any readable official text; see 3.5.

### 3.4 Ikebukuro: the 20 POIs, PARCO, ISP, department store, Hope Center

- 池袋PARCO's own access page lists address 南池袋1-28-2, hours, and facility services (multipurpose toilet at 本館B2F・7F and P'PARCO 6F). It contains no exit number, no 地下通路 and no gate statement (fetch summary and browser text). The page carries the note "当面の間営業時間を短縮しております". [DR-RT-06]
- 東武ホープセンター access page: no passage hours, no elevator statement; Seibu and Yurakucho routes are described as going by the underground passage "toward the west exit" (direction, not an exit number). Same statement as R1 DR-IK-08. [DR-RT-08]
- 東武百貨店 access page: states a direct connection to the 西口 and lists gates by operator; no 地下通路, hours or elevator statement; no numbered exit. [DR-RT-07]
- Toshima's 特定事業計画 (file dated 2020-03-25; status columns as of 令和元年度末): for 池袋ショッピングパーク — "地下出入口（明治通り歩道上）の段差の解消を図る" and "中央通路側出入口のスロープ構造の改修を検討する", both 未着手; and a note that adding escalators to existing stairs was judged difficult. For 東武ホープセンター — "地上出入口階段の破損箇所の改修と、階段両側への手すり設置について検討する", 未着手. No exit numbers are given. [DR-RT-24]
- A news article (trafficnews, 2024-10-01, indicator only, not officially sourced) says ISP has 10 exits including 44, with 23-26 on the east station building side, 29 and 31-33 across 明治通り, and 28 and 44 on the traffic island. It cites a 1964 trade magazine and a stock photo and quotes no official. Not used as fact. [DR-RT-29]
- For the 20 POIs: nothing in any retried source names an exit stair's passage or hall and a second endpoint; no exit-level hours were found. R1 Section 6a.1 stands unchanged. [all above]

### 3.5 Shinjuku: Keio, Odakyu, exit 2

- Keio: every Keio URL tried returned HTTP 503 again (top page, 新宿 and 京王新線 station pages, both release PDF paths, the site-policy page). Nothing was read. [DR-RT-01, DR-RT-02]
- Odakyu: the station page and top page are unreachable by three methods. [DR-RT-03]
- Keio's barrier-free plan form (令和7年6月30日, hosted by Tokyo): "オリンピック・パラリンピック対応として2駅（飛田給駅、新宿駅）については2つ目のバリアフリールートの整備が完了している". It is a station-level statement; it names no exit and no lift. [DR-RT-23]
- Odakyu / Tokyo Metro / Tokyu Land release of 2024-03-25: starts new construction of block A, completion FY2029; the plan view shows block A (Metro Marunouchi Line Shinjuku station side) and block B (Odakyu station side); one image caption is "商業機能イメージ（地下1階・駅コンコース）". No passage, gate or exit statement. [DR-RT-19]
- 2026-06-23 notice (Tokyo and Odakyu logos): stair 11 closed and a temporary stair built, because of the 新宿駅直近地区土地区画整理事業; the legend lists "エレベーター 西口地上↔西口地下" and "仮設階段 西口地上↔西口地下". Same facts as R3 CH-SJ-13. [DR-RT-25]
- Exit 2 of 京王新線 新宿: no source read states a reopening, a passage, a gate side or a step-free means. Nothing found changes R2 Q1. [DR-RT-01, 02, 23, 25]
- Transfers (fare gate, walking time) and Keio step-free per exit: no statement found in any retried source. [DR-RT-01, 23]

### 3.6 Terms and modification/redistribution

- 東武百貨店 and 東武ホープセンター: no numbered clauses. 情報の利用制限: content is protected by copyright and use other than "私的利用" or "引用" permitted by copyright law is prohibited. No clause addresses modification or redistribution separately; linking needs prior consultation. No date shown. [DR-RT-07, 08]
- PARCO 利用規約 §1: no use beyond private use without prior consent; no copying, transmission, distribution, transfer, lending, translation or adaptation beyond private use. "Updated Feb. 24, 2021". [DR-RT-06]
- Tokyo Metro terms §1(1) and §1(2): copyright held by Metro or the original holder; use beyond private use or quotation needs Metro's licence; no clause on modification. [DR-RT-27]
- Seibu policy (「著作権について」): copying, diversion, reprinting and distribution beyond private use without permission prohibited; "改変" prohibited. [DR-RT-26]
- Tokyo 都市整備局 site policy: copyright with the bureau; copying or diversion barred except private-use copying and quotation; no modification clause; neither 政府標準利用規約 nor CC BY mentioned. The Cabinet Office top page shows only "Copyright © Cabinet Office, Government of Japan" and no terms link. [DR-RT-28]

## 4. Source records

Common: checked 2026-10-22. "FS" = fetch summary (small-model summary of the page).

| source_id | title | publisher | URL | update date as stated | terms / licence (+ terms URL) | modification | redistribution | availability | rights class | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| DR-RT-01 | 京王 新宿 / 京王新線新宿 station pages, site top | 京王電鉄 | https://www.keio.co.jp/train/station/ko01_shinjuku/ ; https://www.keio.co.jp/train/station/ko01_newline_shinjuku/ ; https://www.keio.co.jp/ | n/a | https://www.keio.co.jp/contact/site/ also 503 (earlier DOS:S05, not re-read) | UNKNOWN | UNKNOWN | UNREACHABLE (HTTP 503, "Server is under maintenance") | UNKNOWN | Tried by browser, WebFetch, curl. |
| DR-RT-02 | 京王 2023-08-02 新宿駅 release (two paths) | 京王電鉄 | https://www.keio.co.jp/news/update/news_release/news_release2023/nr20230802_shinjuku.pdf ; https://www.keio.co.jp/news/backnumber/ir_news2023/nr230802v02.pdf | 2023-08-02 (per R3) | as DR-RT-01 | UNKNOWN | UNKNOWN | UNREACHABLE (HTTP 503) | UNKNOWN | Search listing gave the "shinjuku" spelling; R3 had tried "shinjyuku". |
| DR-RT-03 | 小田急 新宿 station page, top, 利用規約 | 小田急電鉄 | https://www.odakyu.jp/station/shinjuku/ ; https://www.odakyu.jp/ ; https://www.odakyu.jp/policy/ | n/a | not read | UNKNOWN | UNKNOWN | UNREACHABLE (browser error page, WebFetch 504, curl timeout) | UNKNOWN | Retry later. |
| DR-RT-04 | Wayback Machine snapshots | Internet Archive | https://web.archive.org/ ; https://archive.org/wayback/available | n/a | not read | UNKNOWN | UNKNOWN | UNREACHABLE (WebFetch refuses the host; availability API HTTP 429) | UNKNOWN | **Deferred (browser freeze until 19:30).** Any snapshot would be secondary and must carry the snapshot date. |
| DR-RT-05 | 池袋ショッピングパーク site | 池袋ショッピングパーク | https://www.web-isp.co.jp/ | n/a | https://www.web-isp.co.jp/terms/ (DOS:I-08) not read | UNKNOWN | UNKNOWN | UNREACHABLE (connection refused to 103.240.13.135:443; http fallback also refused) | UNKNOWN | |
| DR-RT-06 | 池袋PARCO アクセス＆施設案内; ご利用規約 | パルコ | https://ikebukuro.parco.jp/info/ ; https://ikebukuro.parco.jp/info/?gcd=facilities ; https://www.parco.co.jp/terms/ | page not stated; terms "Updated Feb. 24, 2021" | §1: no use beyond private use without consent; no reproduction, transmission, distribution, transfer, lending, translation, adaptation beyond private use (https://www.parco.co.jp/terms/) | no | no | PAGE_READ (browser text for the page and terms; FS for the facility sub-page) | FACTS_ONLY_REFERENCE | Old URL `parco.jp/ikebukuro/access/` returns 404. No exit statement. |
| DR-RT-07 | アクセス (東武百貨店 池袋店); 利用規約 | 東武百貨店 | https://www.tobu-dept.jp/ikebukuro/access/ ; https://www.tobu-dept.co.jp/policy.html | not stated | 情報の利用制限: only private use and quotation as permitted by copyright law; linking needs prior consultation (https://www.tobu-dept.co.jp/policy.html) | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | No numbered clauses; no date. Gate names listed on the access page are not recorded here (OD-01, OD-02). |
| DR-RT-08 | アクセス・駐車場 (東武ホープセンター); 利用規約 | 東武ホープセンター | https://tobuhopecenter.jp/info/access/ ; https://tobuhopecenter.jp/terms/ | not stated | as DR-RT-07 wording; top-page-only links (https://tobuhopecenter.jp/terms/) | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | No numbered clauses; no date. |
| DR-RT-09 | 豊島区池袋駅周辺地域再生委員会 (第14回) page; 次第; 会議録 | 豊島区 | https://www.city.toshima.lg.jp/405/kuse/shingi/kaigichiran/006335.html ; https://www.city.toshima.lg.jp/405/kuse/shingi/kaigichiran/2605191305.html ; https://www.city.toshima.lg.jp/documents/56546/20260519131717.pdf ; https://www.city.toshima.lg.jp/documents/56546/20260521094554.pdf | meeting 2026-03-25; page updated 2026-08-19 | site policy as DR-IK-16 (https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html) | no | no | PAGE_READ (FS); FILE_INSPECTED (次第 62 KB, minutes first 3 pages) | FACTS_ONLY_REFERENCE | Page lists: 次第, 資料1 (539 KB), 資料2 (236 KB), 資料3 (7,785 KB), 資料4 (616 KB), 会議録 (258 KB). Minutes: the secretariat explained 資料1, 3, 4; Tokyo Metro explained 資料2. |
| DR-RT-10 | 資料2 池袋ターミナル案内サインの変更について 東京メトロ | 東京地下鉄 (via 豊島区) | https://www.city.toshima.lg.jp/documents/56546/20260519131902.pdf | slide undated; 2026-03-25 meeting | as DR-RT-09 | no | no | FILE_INSPECTED (236 KB, 1 page) | FACTS_ONLY_REFERENCE | Shows a drawn map extract; not transcribed. |
| DR-RT-11 | 資料3 池袋ターミナル案内サイン整備計画およびガイドラインの更新について | 豊島区 | https://www.city.toshima.lg.jp/documents/56546/20260519131956.pdf | 2026-03-25 meeting | as DR-RT-09 | UNKNOWN | UNKNOWN | DISCOVERED (7.8 MB, 66 pages; over the 5 MB limit; fetched by the tool and deleted unread) | UNKNOWN | A search summary says it recounts the 2017-05 guideline and the 2018-05 and 2020-03 updates; not verified. May hold a newer sign plan or map. Needs an Owner decision (section 8). |
| DR-RT-12 | 池袋ターミナル案内サインガイドライン (landing, re-check) | 豊島区 | https://www.city.toshima.lg.jp/405/1705251510.html | 2025-08-04 | as DR-RT-09 | UNKNOWN | UNKNOWN | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Lists Ver1.2 (令和2年3月) guideline, summary, sign plan 1/2 and 2/2, and the 令和4年1月 map notice. No 令和8年 item. |
| DR-RT-13 | 東京都市計画道路の変更 (PDF) and 池袋駅西口地区に係る都市計画の決定・変更について (page) | 東京都 / 豊島区 (hosted copy) | https://www.city.toshima.lg.jp/documents/42251/toshikeikakudouro78.pdf ; https://www.city.toshima.lg.jp/433/2210180837.html | PDF metadata 2024-05-21 / 2024-12-12; page 2024-12-26; 告示 令和6年11月11日 | site policy as DR-IK-16 | no | no | FILE_INSPECTED (3.4 MB; pages 1-3 viewed); page PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Wording of 廃止 read here. A planning designation, not a physical statement. |
| DR-RT-14 | 東京都市計画駐車場の変更（素案）第29号池袋西口駐車場 (with 理由書) | 東京都 (Cabinet Office council material) | https://www.chisou.go.jp/tiiki/kokusentoc/tokyoken/tokyotoshisaisei/dai27/siryou11.pdf | drawing approval line 令和5年6月14日 | no terms link found on the Cabinet Office top page | UNKNOWN | UNKNOWN | FILE_INSPECTED (699 KB; pages 1-4 viewed) | FACTS_ONLY_REFERENCE | Map not transcribed. |
| DR-RT-15 | 池袋駅西口地区における都市計画について (release) | 東武鉄道 / 池袋駅西口地区市街地再開発準備組合 | https://www.tobu.co.jp/cms-pdf/releases/20240326163646grM2XOPaw_bgEhNtCVzkFw.pdf | 2024-03-26 | https://www.tobu.co.jp/sitepolicy/ (第7条, 第8条; see R1 DR-IK-06) | no | no | FILE_INSPECTED (869 KB, 2 pages) | FACTS_ONLY_REFERENCE | |
| DR-RT-16 | 2024年度 決算説明資料 | 東武鉄道 | https://www.tobu.co.jp/cms-pdf/explanatory_materials/20250515175429HXVHlmhBPLcsErTuHwNBYA.pdf | 2025-05-19 | as DR-RT-15 | no | no | FILE_INSPECTED (2.6 MB, 48 pages; pages 24-37 viewed) | FACTS_ONLY_REFERENCE | Pages 30 and 33 hold the Ikebukuro items. |
| DR-RT-17 | まちづくり事業 page; 統合報告書2026 section02 | 東武鉄道 | https://www.tobu.co.jp/corporation/dev/communitydev/ ; https://www.tobu.co.jp/pdf/ir/integrated_report/2026/section02.pdf | not stated | as DR-RT-15 | no | no | PAGE_READ (FS); report DISCOVERED (9.8 MB, over limit, deleted unread) | FACTS_ONLY_REFERENCE | |
| DR-RT-18 | 副都心線池袋駅の新設出入口を備えたホテル増築棟を開発！ (release 24-56) | 東京地下鉄 | https://www.tokyometro.jp/news/images_h/metroNews240902_56.pdf ; https://www.tokyometro.jp/news/2024/218891.html | 2024-09-02 | as DR-RT-27 | no | no | FILE_INSPECTED (609 KB, 3 pages) | FACTS_ONLY_REFERENCE | Dates and hours are planned values. |
| DR-RT-19 | 「新宿駅西口地区開発計画」新築着工 (joint release) | 小田急電鉄・東京地下鉄・東急不動産 | https://www.tokyometro.jp/news/images_h/metroNews240325_g09.pdf ; https://www.tokyometro.jp/news/2024/217676.html | 2024-03-25 | as DR-RT-27 | no | no | FILE_INSPECTED (1.4 MB; pages 1-3 viewed of 6) | FACTS_ONLY_REFERENCE | Pages 4-6 not viewed. |
| DR-RT-20 | 池袋駅からのアクセス (東京芸術劇場) | 東京芸術劇場 | https://www.geigeki.jp/access/ | not stated | terms page not found (https://www.geigeki.jp/terms/ is 404) | UNKNOWN | UNKNOWN | PAGE_READ (FS) | UNKNOWN | The page also describes ticket-gate directions for other operators; not recorded (OD-02). |
| DR-RT-21 | 生活文化局に寄せられた都民の声と対応事例（令和７年９月分） | 東京都 生活文化局 | https://www.seikatubunka.metro.tokyo.lg.jp/documents/d/seikatubunka/r709jirei_pdf | 令和7年9月分; PDF created 2025-10-27 | as DR-RT-28 | no | no | FILE_INSPECTED (186 KB, 1 page) | FACTS_ONLY_REFERENCE | |
| DR-RT-22 | 東京芸術劇場 視覚障害者向けルート案内 (池袋駅 2b 出口から) | 東京都歴史文化財団 (Creative Well) | https://creativewell.rekibun.or.jp/RM_GeiGeki_v1_20250917.pdf | 発行：2022.12.16 (text); file name 20250917 | not read | UNKNOWN | UNKNOWN | FILE_INSPECTED (192 KB, 4 pages) | UNKNOWN | Photos and route drawing not transcribed. |
| DR-RT-23 | 京王電鉄株式会社 鉄道駅バリアフリーに関する整備計画 様式2 | 京王電鉄 (hosted by 東京都) | https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_bunyabetsu_machizukuri_bfree_pdf_tetsudo_bfree_ev_02-1 | 令和7年6月30日 | as DR-RT-28 | no | no | FILE_INSPECTED (317 KB, 1 page) | FACTS_ONLY_REFERENCE | A copy of a Keio document on a Tokyo site; the Keio original was not reachable. |
| DR-RT-24 | 池袋駅地区バリアフリー基本構想に基づく特定事業計画 | 豊島区 | https://www.city.toshima.lg.jp/documents/15443/tokuteijigyoukeikau_31.pdf | file modified 2020-03-25 | site policy as DR-IK-16 | no | no | FILE_INSPECTED (1.7 MB; pages 1-6 and 43-47 viewed) | FACTS_ONLY_REFERENCE | 2020 status; other pages not viewed. |
| DR-RT-25 | 階段閉鎖・新設のお知らせ（11番階段、2026年6月23日始発より） | 東京都 / 小田急電鉄 | https://www.shinjuku-kojiinfo.metro.tokyo.lg.jp/pdf/news_20260514_01.pdf | PDF created 2026-02-17, modified 2026-04-23; effective 2026-06-23 | terms not read | UNKNOWN | UNKNOWN | FILE_INSPECTED (751 KB, 1 page) | FACTS_ONLY_REFERENCE | Drawing not transcribed. |
| DR-RT-26 | 池袋駅 (re-read); サイトのご利用にあたって | 西武鉄道 | https://www.seiburailway.jp/railway/station/ikebukuro/ ; https://www.seiburailway.jp/policy/ | not stated | 「著作権について」: copying, diversion, reprinting, distribution beyond private use prohibited; modification prohibited (https://www.seiburailway.jp/policy/) | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Exit and lift routes are images only; a search summary quoting "34番出入口裏側のエレベーター" was not found on the page. |
| DR-RT-27 | 利用規約 (re-read) | 東京地下鉄 | https://www.tokyometro.jp/terms/index.html | not stated | §1(1), §1(2): use beyond private use or quotation needs Metro's licence; no modification clause; §3 no framing | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Terms record for the Metro-hosted documents DR-RT-18 and DR-RT-19. |
| DR-RT-28 | サイトポリシー (都市整備局); chisou.go.jp top | 東京都 都市整備局; 内閣府 | https://www.toshiseibi.metro.tokyo.lg.jp/policy ; https://www.chisou.go.jp/ | policy page shows a placeholder date (1900-01-01) | 都市整備局: no copying or diversion except private-use copying and quotation | no | no | PAGE_READ (FS) | FACTS_ONLY_REFERENCE | Cabinet Office: no terms link in the footer. 生活文化局 (DR-RT-21) site policy not read; assumed same family, UNKNOWN. |
| DR-RT-29 | どこにも行けない「44番出口」なぜ生まれた？ (news article) | 乗りものニュース (Trafficnews) | https://trafficnews.jp/post/135224 | 2024-10-01 | not read | UNKNOWN | UNKNOWN | PAGE_READ (FS) | UNKNOWN (indicator only, OD-05) | Not an operator source; no official quoted. |

## 5. What this does not establish

- Anything the Keio or Odakyu sites say. Wayback snapshots were not retrieved.
- The actual opening date of exit C1b, or when exit 2b reopened. Only planned dates (C1b) and the theatre's reopening date (2025-09-06) are documented.
- That 地下道第3号線 or 第4号線 corresponds to any particular passage or exit; the documents give a planning designation and a drawing legend only.
- That the 地下道 abolition was carried out on the ground. The ward page lists the notice date; it does not state a physical change.
- Which exit number leads to ISP, PARCO, the 東武百貨店 or the Hope Center; none of their pages names one.
- The content of 資料3 (66 pages, possibly a newer sign plan or map) and of the Tobu integrated report 2026; both exceed the 5 MB limit and were not read.
- That 1a and C4 are open now (only that the slide reports a service start on March 6 of a year the slide does not print, tabled 2026-03-25).
- Any fare-gate statement or walking time for transfers at Ikebukuro or Shinjuku.
- Keio step-free per exit, or exit 2's passage, gates or step-free means.

## 6. Handoff

### (a) Ikebukuro lead

No row added. Test applied: a source states both endpoints and the passage for one of the 20 POIs, or for the 南通路西改札 to Exit 4 pair. None of the retried sources does. The closest statements are listed so the lead can confirm they do not qualify:

| Item | Source | Statement | Why it does not qualify |
|---|---|---|---|
| 南通路西改札 to 西口 passage | 東武ホープセンター access page (DR-RT-08), https://tobuhopecenter.jp/info/access/ ; retrieved 2026-10-22; section: 電車でお越しの場合 (Yurakucho route); one-line text: gate named, then the underground passage "toward the west exit" | direction only | the second endpoint is "西口方面", not Exit 4 or any numbered exit; terms FACTS_ONLY_REFERENCE |
| Exit 2b to 東京芸術劇場 | DR-RT-20, DR-RT-22 | "池袋駅 2b 出口は、東京芸術劇場直結の出入口です" | 2b is not one of the 20 POIs |
| C1b | DR-RT-18 | exit with a 1-car lift, planned service times | not one of the 20 POIs |

Facts for the lead's data notes (facts only, not wiring rows): 1a and C4 service start (DR-RT-10); C1b planned values (DR-RT-18); 地下道 No.3/No.4 廃止 wording (DR-RT-13). The relative-position drawings are layout and were not used (OD-03).

### (b) Shinjuku lead

Keio and Odakyu remain unread. New: Keio-authored statement that a second barrier-free route is complete at 新宿 (DR-RT-23, https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_bunyabetsu_machizukuri_bfree_pdf_tetsudo_bfree_ev_02-1, retrieved 2026-10-22, 令和7年6月30日, one line: 「…新宿駅）については2つ目のバリアフリールートの整備が完了している」; station-level only; rights FACTS_ONLY_REFERENCE). The R2 `gap:transfers` and exit 2 items stay open.

### (c) GIS

- Register as FACTS_ONLY_REFERENCE: DR-RT-09, 10, 13, 14, 15, 16, 18, 19, 21, 23, 24, 25. Register as DISCOVERED: DR-RT-11, 17 (unread parts), DR-RT-01, 02, 03, 05 (unreachable).
- DR-RT-12: the Toshima landing page still lists no 令和8年 version; if 資料3 carries a newer map, the 2022 guide (`toshima-underground-guide-2022`) may be superseded.
- R3: update CH-IK-01 (planned values documented, actual date UNKNOWN), CH-IK-02 (theatre reopened 2025-09-06; 2b date UNKNOWN), CH-IK-06 (廃止 wording now read; physical meaning not stated), CH-IK-09 (FY2024 slides read), CH-SJ-15 (joint release read, no passage statement).
- R1: DR-IK-04 notes 1a and C4 closed; add that DR-RT-10 reports both in service. DR-IK-17 PARCO row: now PAGE_READ at the new URL.

## 7. Field-collection items

| id | place | observe | method | est. cost | paid area? | unblocks |
|---|---|---|---|---|---|---|
| FC-RT-01 | Ikebukuro street and passage exits 1a, 2b, C1b, C4 | Whether each is open; posted opening date or notice text on the exit plate; whether 2b's stair and lift are in service | look, copy the plate text (no photos kept in the repo) | 15 min | no | R3 CH-IK-01, CH-IK-02; R1 gap-hours |
| FC-RT-02 | ISP entrances on 明治通り sidewalk and on the 中央通路 side | Exit numbers on the entrance plates; whether the central-passage-side entrance is the slope entrance noted in DR-RT-24 | look, copy plate text | 15 min | no | R1 G1, G2 |

## 8. Owner decisions needed

1. **5 MB cap for two documents.** Not an Owner decision: the cap is a lane rule. **Lead decision (2026-10-22):** one read of selected pages of 資料3 and of the Tobu integrated report 2026 is allowed after the 19:30 browser freeze, recorded as follow-up R8b on #165.
2. **Terms read for 東武百貨店, 東武ホープセンター and PARCO (R1 Owner decision 4).** All three allow only private use and quotation. Confirm the facts-only rule (#26) covers station-access facts from them, with the Tobu gate names kept out (OD-01).
3. **News articles as indicators.** Not a new decision: OD-05 (aggregators are indicators only) and the primary/secondary rule of R3 already cover it. News articles are indicators only and never enter data.

Deferred until the browser freeze ends (19:30): Wayback snapshots of Keio and Odakyu pages; an in-browser retry of Odakyu; the rendered Metro 池袋 exit list (to see 2b, 1a, C4, C1b status); reading selected pages of 資料3 if Decision 1 allows.
