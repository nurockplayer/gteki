# DR-SJ: Shinjuku E27 public station facts (exit 2, toilets, step-free, transfers)

## 1. Header

- Tracking: issue #165 item R2; GTEki #5 (station facts); M0-01 coverage-gap ranks 7 (S10 positions) and 14 (Shinjuku part: transfers, exits, hours); Shinjuku Lane B's four questions (Q1 exit 2, Q2 toilets, Q3 step-free, Q4 rights).
- Checked: 2026-10-22 (JST, afternoon). Desk research only; public sources only; no one contacted; no raw data from `~/.gteki/gis-store` opened.
- Method: Toei pages are behind a bot filter that returns an empty page to `curl`/WebFetch, so they were read in ego-lite (a real browser) as page text, plus the page's own same-origin data feed (`/subway/stations/json/<station>.json`). Per-exit coordinate values in that feed were deliberately not recorded. PDFs were read with `pdftotext` (S03 spec) or looked at as images (the two 新宿区 maps, which have no text layer). The S10 CSV was opened for its header row only; no row values were read. Keio's site returned 503 "under maintenance" for every page and PDF tried, so Keio is UNKNOWN throughout.
- Facts only. Nothing here states a route, a connection, a lift link, a height, a position or an hour that a source did not state in text. Source map images were not transcribed.
- Shop names, hours, addresses and URLs from S10, S03 and PLATEAU are not written here (see section 5).

## 2. Summary

| Item | Question | Covered? | Exact resource / field | Verifiable join method | Rights |
|---|---|---|---|---|---|
| Lane B Q1 | Official exit 2: which passage, which lines/gates, step-free means; does S03 describe exit nodes/edges? | **Partial.** Toei and Keio state only that exit 2 of 新宿線 新宿駅 (jointly used 京王新線 station) was closed from the first train on 2024-03-30 for the ミヤコ新宿ビル demolition, and Toei's page still lists it as 閉鎖中 on 2026-10-22. Which passage it left from, which gates it served and any step-free means are **not stated in text** (only on a detour drawing in the notice PDF). S03: **no** exit/entrance node or edge type is defined in its public spec. | Toei exit list `出入口一覧` (DR-SJ-01); closure notice + PDF (DR-SJ-05); S03 spec `屋内測位新宿ターミナル オープンデータ仕様書` §2.2.1, §3.2.4-3.2.10, §4 (DR-SJ-09) | Text match of exit label "2出口" is a candidate only. A real E27/S01 join needs S03 CRS and Path transform: **GIS ranks 1/8, not attempted.** | Toei page: FACTS_ONLY_REFERENCE. S03: subset cleared, CRS UNKNOWN |
| Lane B Q2 | Toilets and facility POIs for E27 | **S10: no toilets.** Toei official pages: **partial**, existence only (per line "バリアフリートイレ: あり"); **no floor or gate** in text. Third-party notes give floor/gate (unofficial). | S10 CSV columns `配置, 施設名, 設置場所, 営業時間・利用時間, サイズ・口数（コインロッカー）, 座席, 電話番号, ホームページ, PASMO対応, 備考` (DR-SJ-08); Toei `バリアフリー設備` block (DR-SJ-01, -02); S03 spec §2.2.1 (toilet/lift positions as facility info) | S10 has nothing to join for toilets. S03 states it carries toilet and lift lat/lon, but its category/field names are deferred to an external HERE preset not in the spec: UNKNOWN. | S10 CC BY 4.0; Toei text FACTS_ONLY_REFERENCE; third-party RESTRICTED/UNKNOWN |
| Lane B Q3 | Lifts / step-free per exit for E27, E01, S01 | **Partial.** Counts per line (text). Per exit: only icon text in the page feed (A1 lift; D1 and D2 lift; D2 "EV専用"). Keio side UNKNOWN (503). | Toei `バリアフリー設備` and `出入口一覧` icons (DR-SJ-01, -02); 新宿区 elevator/stairs map legend (DR-SJ-10) | None verifiable without operator map geometry; no join attempted | FACTS_ONLY_REFERENCE |
| Lane B Q4 | Rights state | S10: CLEARED_WITH_CONDITIONS, CC BY 4.0, Q1 Yes. S03: factual subset CLEARED_WITH_CONDITIONS (Q2, Q3 Yes), Q4 No, whole ZIP UNKNOWN, CRS UNKNOWN. Display of names/times/locations as text is allowed with credit and change notice; nothing may be placed from S03 until CRS is verified. | Repo records (section 3, F-Q4) | n/a | see section 3 |
| B (rank 7) | Public source for store positions/floors | **Partial.** Toei's own store pages give floor, inside/outside gate and "near exit N" text per store; coordinates: none. | DR-SJ-03, -04 | None (text only); entries are keyed to letters on a drawing that was not transcribed | Toei page FACTS_ONLY_REFERENCE; same content in S10 is CC BY |
| C (rank 14) | Transfers, exit numbers, hours | **Partial.** Transfer-company lists and signage guidance only; no stated walking time, no fare-gate statement from any official text read. Exit numbers and posted hours for E27/S01 exits: stated. | DR-SJ-01, -02, -06, -10, -11 | n/a | FACTS_ONLY_REFERENCE |

## 3. Findings (facts only)

### Q1: exit 2

- The Toei 新宿 station page (one page for 新宿線 S01 and 大江戸線 E27) lists exits A1, 1 to 8. Exits 1 and 2 are tagged 閉鎖中 (closed); exits 3, 4, 5 are tagged 【京王新線口】; exits 6, 7, 8 are tagged 【新都心口】; A1 is tagged 【マインズタワー方面改札】. The page does not say which exits belong to E27 and which to S01 except through these tags. [DR-SJ-01]
- Exit 2 on that page has no gate tag and no hours; its nearby-landmark list names JR東京総合病院, JR新宿ビル, ミヤコ新宿ビル and バスタ新宿. No lift or escalator icon on exit 2. [DR-SJ-01]
- Toei and 京王電鉄 jointly announced on 2024-01-29 that 2番出口 of 京王新線・都営新宿線 新宿駅 (a jointly used station) would close from the first train of 2024-03-30 because of the ミヤコ新宿ビル demolition. The notice PDF carries a detour drawing (ground and underground) with no text on which passage or gate exit 2 served and no step-free statement. Contact given is the Keio customer centre. [DR-SJ-05]
- No source read states that exit 2 reopened; Toei's page still shows 閉鎖中 on 2026-10-22. [DR-SJ-01]
- The Toei 新宿 page's exit list is filled from a data feed whose per-exit records have a field spelled `cordinate`; values are not recorded here and their reuse is not licensed (Toei site policy, DR-SJ-07). [DR-SJ-01]
- The 新宿区 Terminal Map (as of 2025-11) is a graphic with no text layer; at the resolution viewed, its underground sheet shows exit numbers 3, 4, 5 around the 京王新線 concourse; no label for exit 2 was located in the part inspected. Not a statement that exit 2 is absent. [DR-SJ-10]
- The 新宿区 elevator/stairs map states (text on the sheet) that exit numbers printed in brown are generally stairs-only. Which numbers are brown was not transcribed. [DR-SJ-10]
- S03 public spec: facility information covers position (including toilets and lifts, as lat/lon), name, shape (rectangle), floor number and 出入口利用時間情報 (operating times of stairs and lifts); the Level Geometry feature collection has `start_of_operation`, `end_of_operation`, `etc`; features have `entities`, `internal_entities`, `entity_name`, `int_address`, `location`, `group`, `line_width`, `label_area`; nav nodes have `mx`, `my`, `p` (property list), `l` (levels with `lid`, `gid`); nav links have `n1`, `n2`, `d`, `dm`, `dz`, `p`. **No exit or entrance node/edge type and no category list is defined**; categories come from an external "HERE Venues" property preset the spec refers to but does not include. The spec says the data is a snapshot from the survey and shops and entrances may differ from today. [DR-SJ-09]
- S03 is dated before the closure (published 2023-02-28 on 2020-03 data, spec dated 2023-02), so any S03 exit-2 hours or geometry predates the 2024-03-30 closure. [DR-SJ-09, DR-SJ-05]
- Keio's own 新宿 pages and PDFs returned 503 "server under maintenance" on 2026-10-22: UNKNOWN what Keio states. [DR-SJ-12]

### Q2: toilets and facility POIs

- S10 (東京都交通局「駅構内のお店」): the catalog text lists the dataset as 《その他の事業》 stores with coin-locker dimensions and an opening-hours note; the CSV header has the ten columns named in section 2. There is no facility-type or toilet column, and the Toei store pages the data mirrors list only shops, coin lockers, ID-photo booths, ATMs, a stroller-rental service and a baby-goods vending machine. **S10 has no toilets**, no coordinate columns, no floor column (floor is inside `設置場所` text). Row counts consistent with the repo record: 5 (新宿), 10 populated (新宿西口). [DR-SJ-08, DR-SJ-03, DR-SJ-04]
- Toei official 新宿 page: 新宿線 and 大江戸線 each "バリアフリートイレ（車椅子使用者対応トイレ）: あり". No floor, no gate, no multipurpose-toilet wording. The 設備 block is otherwise empty for 大江戸線 and says only "この駅は京王電鉄の管理駅です" for 新宿線. [DR-SJ-01]
- Toei official 新宿西口 (E01) page: "バリアフリートイレ（車椅子使用者対応トイレ）: あり"; no floor or gate. [DR-SJ-02]
- The station drawing (構内図) on both Toei pages is an image; toilet marks on it were not read. [DR-SJ-01, DR-SJ-02]
- Unofficial, for pointing only: Yahoo!乗換案内 lists a 多機能トイレ for 大江戸線 as "B4F通路内", for 新宿線 as "新都心口改札外" and for 京王電鉄 as "ホーム（エレベータ隣）" with no credited data source and no update date. らくらくおでかけネット (エコモ財団, citing 東京都交通局 data) says toilets are inside the gate for 新宿線, 大江戸線 and 新宿西口, with no floor or gate and no date; for 新宿西口 it lists wheelchair-capable, ostomate and baby-bed facilities, inside gates only. [DR-SJ-13, DR-SJ-14]
- The 新宿区 maps (2025-11) carry accessible-toilet and toilet symbols and 6:00-23:00 hour tags on some; no per-station toilet text was transcribed. [DR-SJ-10]

### Q3: lifts and step-free

- 新宿 page, Toei: 新宿線 lifts 1, escalators 14, "1ルートの確保: 済み"; 大江戸線 lifts 2, escalators 16, "1ルートの確保: 済み". The page says nothing about which exits those routes use. [DR-SJ-01]
- 新宿西口 page, Toei: lifts 4, escalators 18, "1ルートの確保: 済み". A PDF on step and gap at the Oedo Line platform is linked from both pages (not read). [DR-SJ-02]
- Per-exit icons in the 新宿 page feed: A1 carries a lift icon and an escalator (up-complete) icon; exit 8 an escalator (up) icon; no other 新宿 exit carries an icon. [DR-SJ-01]
- Per-exit data in the 新宿西口 feed: D1 icon code 1 and D2 icon code 1 (the code the 新宿 page renders as 'エレベーターのある出口'; the E01 legend itself was not rendered), D2 also with remark "EV専用", D5 escalator icon; the remaining D exits carry no icon. The same feed also holds 23 entries named A6 to B18 that do not belong to E01; the page's own exit list did not render in the session, so this feed is not treated as authoritative. [DR-SJ-02]
- Unofficial: らくらくおでかけネット says the 大江戸線 lift is at exit A1 beside Mines Tower, and gives a 新宿線 lift linking ground, 京王モール and the underground car park near the Keio department store; Yahoo!乗換案内 gives lift routes "ホーム⇔B4F通路⇔マインズタワー方面改札" and "マインズタワー方面改札⇔A1出口" for 大江戸線 and "ホーム⇔B4F通路⇔京王新線口改札" for 新宿線. These are not operator text read by this study. [DR-SJ-13, DR-SJ-14]
- Keio (京王新線 新宿 lifts, toilets): UNKNOWN, site down. [DR-SJ-12]

### Q4: rights state (from committed repo records, not re-assessed)

- S10 (`tokyo-s10-shinjuku-csv`, `tokyo-s10-shinjuku-nishiguchi-csv`): CLEARED_WITH_CONDITIONS, CC BY 4.0, exact resources covered. Owner Q1 = Yes: publish plain names, times and locations with 「出典：東京都交通局「駅構内のお店」」 and a change notice; logos, photos, trademarks, promotional prose excluded. `stations/shinjuku/sources/manifest.json` still labels S10 as PDL 1.0 (flagged for alignment in PR#127). The catalog still shows "クリエイティブ・コモンズ 表示（CC BY）" and API v1.0.5, data last updated 2025-01-30, created 2019-08-05. [DR-SJ-08, repo `docs/gis/research/poi-rights-s10-s03-related.md`, `docs/gis/research/m0-01-coverage-gaps.md` SJ-12]
- S03 (`tokyo-s03-zip`): factual and geometry subset CLEARED_WITH_CONDITIONS (CC BY 4.0 dataset grant; Owner Q2 and Q3 = Yes); whole ZIP UNKNOWN; Q4 = No (prose, linked content, PDF illustration out); promotional description/url fields UNKNOWN. CRS UNKNOWN for the whole candidate, so the gate for use is CRS (GIS), not rights. [DR-SJ-09, repo SJ-06]
- Still HOLD: S03 placement (CRS and Path transform, GIS ranks 1/8); E27 reuse after 2027-03-12 (Owner #16 override, Q11 = No, not a rights PASS); anything outside the CC BY subsets. This study adds no clearance.
- Operator station pages and maps (Toei, 新宿区, Keio, Metro, JR, Odakyu) are not open data; their text is used here as facts only (Owner decision #26). [DR-SJ-07, DR-SJ-10]

### B (rank 7): positions/floors for Toei store entries

- Toei's public store pages give, per entry: a letter code (配置), a type, 設置場所 as floor plus 改札内/改札外 plus a "near exit N / near gate" phrase, and notes. The letter codes refer to marks on a drawing that was not transcribed. No coordinates, no CRS. [DR-SJ-03, DR-SJ-04]
- Aggregate floors stated: 新宿 (E27/S01 combined page): 5 entries; 3 on B1 outside the gate, 1 on B2 outside, 1 on B2 inside. 新宿西口: 10 entries; 5 on B1 outside the gate, 5 on B3 outside the gate; none inside. Exit/gate tokens and shop details are not copied here (S10 related-value rule). [DR-SJ-03, DR-SJ-04]
- The floor labels are Toei's own and are not mapped to E27 floor layers or to S03 levels. [DR-SJ-03, DR-SJ-04]

### C (rank 14): transfers, exit numbers, hours

- E27 page "乗り換え案内" names: JR山手線, 中央・総武線（各駅停車）, 中央線快速, 埼京線, 湘南新宿ライン; 京王線; 小田急線. It does not name 東京メトロ丸ノ内線 M08 or 新宿西口 E01, and gives no walking time and no fare-gate statement. [DR-SJ-01]
- E01 page names: 東京メトロ丸ノ内線（新宿）（M-08）; JR (same lines); 京王線（新宿）; 小田急線（新宿）; 西武新宿線（西武新宿）. No walking time, no fare-gate statement. [DR-SJ-02]
- Toei's 新宿西口駅と新宿駅について states signage guidance only: following 大江戸線 signs from the JR 西口 exit leads to E01 (convenient for 飯田橋, 上野御徒町, 両国, 門前仲町); from the JR 南口 exit leads to E27 (convenient for 青山一丁目, 六本木, 大門, 築地市場); and 京王新線 and 新宿線 can also be boarded at 新宿. [DR-SJ-06]
- Tokyo Metro's M08 page lists 都営地下鉄, JR東日本, 京王電鉄, 小田急電鉄 as transfer companies; no times or gate statements on that page. Its exit-by-exit transfer subpage (のりかえ出口案内) was not read. [DR-SJ-11]
- Third-party (らくらくおでかけネット) E01 text: a connecting passage leads to JR and 丸ノ内線 新宿 with lifts and wheelchair-capable escalators, and riders should tell staff at their boarding station. It says nothing on fare gates. [DR-SJ-14]
- The 新宿区 maps print a scale bar "約4分 (200m) 4 minute walk"; that is a map scale, not a transfer time. [DR-SJ-10]
- Posted exit hours on the Toei 新宿 page: exits 4, 5, 6, 7 are 6:00～23:00; exit 8 is 7:00～23:00; A1, 3 and the closed 1, 2 show no hours. Remarks A1 【マインズタワー方面改札】; 3 to 5 【京王新線口】; 6 to 8 【新都心口】. [DR-SJ-01]
- Toei 新宿西口 feed hours: the D1 remark carries 10:00～24:00; D2 carries "EV専用"; D3 to D5 carry gate tags (JR新宿駅方面改札, 小滝橋通り方面改札) with no hours. Same caveat as Q3. [DR-SJ-02]
- Fare-gate passage between E27 and JR, Keio, Odakyu, S01, E01 or M08: **not stated in any official text read**. Walking time between any pair: **not stated**. UNKNOWN.

## 4. Source records

| source_id | title | publisher | URL | update date as stated | checked | terms / licence (terms URL) | modification allowed | redistribution allowed | availability | rights class | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DR-SJ-01 | 新宿 (S01/E27) station page, incl. 出入口一覧, バリアフリー設備, 構内図 | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html | not stated (FY2024 ridership shown) | 2026-10-22 | 著作権 reserved; 無断使用・転載禁止 (https://www.kotsu.metro.tokyo.jp/riyo/) | UNKNOWN (no permission stated) | UNKNOWN (prohibited without permission) | PAGE_READ | FACTS_ONLY_REFERENCE | Browser-only; exit list from `/subway/stations/json/shinjuku.json`; coordinates in feed not recorded. 構内図 is an image (`.../shinjuku/i/solid.png`), not read. |
| DR-SJ-02 | 新宿西口 (E01) station page | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-nishiguchi.html | not stated | 2026-10-22 | as DR-SJ-01 | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | Exit list did not render; feed `/subway/stations/json/shinjuku-nishiguchi.json` read; it contains extra non-E01 entries. |
| DR-SJ-03 | 新宿 店舗・ロッカー・ATM等 | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html | not stated | 2026-10-22 | as DR-SJ-01 | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | Same content family as S10; shop values not copied. |
| DR-SJ-04 | 新宿西口 店舗・ロッカー・ATM等 | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku-nishiguchi.html | not stated | 2026-10-22 | as DR-SJ-01 | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | as DR-SJ-03. |
| DR-SJ-05 | 新宿線新宿駅2番出口の閉鎖について (news + PDF `sub_i_2024012911347_h_01.pdf`) | 京王電鉄株式会社 / 東京都交通局 | https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html ; https://www.kotsu.metro.tokyo.jp/pickup_information/news/pdf/2024/sub_i_2024012911347_h_01.pdf | 2024-01-29 | 2026-10-22 | as DR-SJ-01 | UNKNOWN | UNKNOWN | FILE_INSPECTED (PDF text; detour drawing not transcribed) | FACTS_ONLY_REFERENCE | Keio's own copy (`keio.co.jp/news/.../20240129_oshirase.pdf`) returned 503. |
| DR-SJ-06 | 新宿西口駅と新宿駅について | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/subway/map/shinjyuku.html | not stated | 2026-10-22 | as DR-SJ-01 | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | Signage guidance text only. |
| DR-SJ-07 | サイトポリシー | 東京都交通局 | https://www.kotsu.metro.tokyo.jp/riyo/ | not stated | 2026-10-22 | Copyright reserved; copying/diversion only where the Copyright Act allows (private use, quotation) | no | no | PAGE_READ | RESTRICTED (the terms record) | Terms source for DR-SJ-01..06. |
| DR-SJ-08 | 駅構内のお店 (catalog; API specs 新宿, 新宿西口; CSV headers) | 東京都交通局 via 東京都オープンデータカタログ | https://catalog.data.metro.tokyo.lg.jp/dataset/t000018d0000000039 ; https://spec.api.metro.tokyo.lg.jp/spec/t000018d0000000039-7612091588ade77cd214ea1f353f73da-0?lang=en ; https://spec.api.metro.tokyo.lg.jp/spec/t000018d0000000039-e2375c546ff431bcecfd0205dc9187a9-0?lang=en ; https://www.opendata.metro.tokyo.jp/kotsu/other_stores_shinjuku.csv ; https://www.opendata.metro.tokyo.jp/kotsu/other_stores_shinjuku-nishiguchi.csv | API: created 2019-08-05, data last updated 2025-01-30; repo records catalog resource date 2026-09-04 | 2026-10-22 | CC BY (catalog); repo records CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.ja ; https://portal.data.metro.tokyo.lg.jp/terms/) | yes, with change notice | yes, with credit | FILE_INSPECTED (header row only) | REUSABLE_WITH_CONDITIONS | Logos, photos, trademarks excluded; Owner Q1 = Yes. CSV URLs as in DOS:S10. |
| DR-SJ-09 | 新宿駅周辺の施設情報等の更新について (publication page) + 屋内測位新宿ターミナル オープンデータ仕様書 (令和5年2月改訂版, 20 pp.) | 東京都都市整備局 | https://www.toshiseibi.metro.tokyo.lg.jp/kotsu_butsuryu/kotsuseisaku/kotsu_suishin/shinjuku_shisetsu ; https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_kiban_shinjuku_terminal_pdf_shisetsu_siyousho | published 2023-02-28 (page); spec PDF created 2023-02-21 | 2026-10-22 | CC BY (catalog https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000037); subset cleared per repo; whole ZIP UNKNOWN | yes for cleared subset, with notice | yes for cleared subset, with credit | FILE_INSPECTED (spec); ZIP not touched | REUSABLE_WITH_CONDITIONS (subset); UNKNOWN (whole) | Spec states data is a survey-time snapshot. Page lists contact department; not contacted. |
| DR-SJ-10 | 新宿ターミナルマップ and エレベーター・階段マップ (PDFs, "as of November 2025") | 新宿ターミナル案内サイン連絡会 / 新宿区 | https://www.city.shinjuku.lg.jp/content/000423320.pdf ; https://www.city.shinjuku.lg.jp/content/000423322.pdf (landing: https://www.city.shinjuku.lg.jp/kusei/toshikei01_002159_00001.html) | 2025-11 (printed on sheets) | 2026-10-22 | Ward site terms prohibit unauthorised reuse, per DOS:S09 (https://www.city.shinjuku.lg.jp/kusei/about.html; not re-read) | no | no | FILE_INSPECTED (images viewed; no text layer) | FACTS_ONLY_REFERENCE | Nothing transcribed except legend wording. |
| DR-SJ-11 | 新宿駅/M08 | 東京メトロ | https://www.tokyometro.jp/station/shinjuku/index.html | page clock only | 2026-10-22 | per DOS:S07 (https://www.tokyometro.jp/terms/index.html; not re-read) | UNKNOWN | UNKNOWN | PAGE_READ | FACTS_ONLY_REFERENCE | Transfer-company list only. |
| DR-SJ-12 | 京王 新宿 station pages and PDFs | 京王電鉄 | https://www.keio.co.jp/train/station/ko01_shinjuku/ ; https://www.keio.co.jp/train/station/ko01_newline_shinjuku/ ; https://www.keio.co.jp/train/station/station_map/pdf/ko01_newline_shinjuku.pdf | UNKNOWN | 2026-10-22 | per DOS:S05 (https://www.keio.co.jp/contact/site/; not re-read) | UNKNOWN | UNKNOWN | DISCOVERED (HTTP 503, "server under maintenance") | UNKNOWN | Retry later; nothing read. |
| DR-SJ-13 | Yahoo!乗換案内 新宿 station page | LY Corporation / Val Laboratory (credits on page) | https://transit.yahoo.co.jp/station/top/22741 | not stated | 2026-10-22 | not retrieved | UNKNOWN | UNKNOWN | PAGE_READ | UNKNOWN | Facility data not credited to a data owner. Pointer only. |
| DR-SJ-14 | らくらくおでかけネット 新宿 / 新宿西口 | 公益財団法人交通エコロジー・モビリティ財団 | https://www.ecomo-rakuraku.jp/ja/station/新宿/ ; https://www.ecomo-rakuraku.jp/ja/station/新宿西口/ | not stated | 2026-10-22 | Copyright with エコモ財団; no reposting; commercial use declined (https://www.ecomo-rakuraku.jp/ja/info/rule.html) | no | no | PAGE_READ | RESTRICTED | Station data credited to 東京都交通局 on the 新宿西口 page. Pointer only. |
| DR-SJ-15 | JR東日本 新宿 構内図・バリアフリー | JR東日本 | https://www.jreast.co.jp/estation/stations/866.html | not stated | 2026-10-22 | per DOS:S04 (https://www.jreast.co.jp/site/rules.html; no reuse) | no | no | PAGE_READ | RESTRICTED | Graphic map and legend only; nothing used. |
| DR-SJ-16 | Odakyu 新宿 station page | 小田急電鉄 | https://www.odakyu.jp/station/shinjuku/ | UNKNOWN | 2026-10-22 | per DOS:S06 (https://www.odakyu.jp/policy/) | UNKNOWN | UNKNOWN | DISCOVERED (page load timed out) | UNKNOWN | Not read. |

## 5. What this does not establish

- It does not identify which passage or gate official exit 2 led from, whether it reopened, or any step-free means for exit 2. Only the closure date and reason are stated.
- It does not say which numbered exits are E27 exits and which are S01 exits; the Toei page is one combined list with gate tags.
- It does not establish toilet floor or gate from any official text; the unofficial sources are pointers only.
- It does not show that S03 carries exit nodes, toilets or lifts under any particular field name; the spec leaves categories to a preset not provided. No S03 file was opened.
- It states no fare-gate passage and no walking time for any transfer; no route, link or lift connection is asserted.
- E01's page exit list did not render; its feed is partly unrelated.
- Keio and Odakyu content is not read; the Metro exit-by-exit page is not read.
- Store entries: Toei floors are Toei's labels, not E27 layer or S03 level mapping. S10 row values are not copied or checked here.
- Nothing here changes any rights verdict; an operator page being readable is not a licence.
- The 新宿区 maps were looked at as images at moderate resolution; labels that were hard to read were not recorded.

## 6. Handoff

### (a) For the Shinjuku station lead (usable now)

- Exit 2 official fact: closed from the first train 2024-03-30 for the ミヤコ新宿ビル demolition, still listed 閉鎖中 on 2026-10-22; exit 1 also listed 閉鎖中 (reason not stated). [DR-SJ-05, DR-SJ-01; https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html ; https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html]
- Exit tags and posted hours (section 3 C): A1 マインズタワー方面改札; 3-5 京王新線口; 6-8 新都心口; hours 6:00-23:00 for 4-7, 7:00-23:00 for 8. Lane B's note that the app's internal `poi:exit:2` is not official exit 2 is consistent with this. [DR-SJ-01]
- Official lift/escalator counts and "1ルート確保: 済み" per line; A1 is the only 新宿 exit flagged with a lift. [DR-SJ-01, https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html]
- Toilet: official text says only that an accessible toilet exists per line; do not state floor or gate on a platform or in the app until FC-SJ-03. [DR-SJ-01]
- Transfers: only "lines named on the Toei page" can be stated; no fare-gate or time claim (`gap:transfers` stays open). [DR-SJ-01, DR-SJ-06]
- Credit/wording for S10-derived store text: 「出典：東京都交通局「駅構内のお店」」 plus change notice (Owner Q1). S10 has no toilets, so toilet POIs cannot come from it.
- Do not copy the Toei page's per-exit coordinate feed, the 構内図 image, or the 新宿区 maps.

### (b) For GIS

- Register (if not already): DR-SJ-01 to DR-SJ-06, DR-SJ-09 (spec PDF), DR-SJ-10 as FACTS_ONLY_REFERENCE; DR-SJ-08 already has records. The S10 CSV header is the only part of the CSVs read here.
- Depends on GIS rank 1/8: placing S03 toilets, lifts and exits; any S03-to-E27 feature join; checking whether S03's 2023 entrance operating times for exit 2 conflict with the 2024 closure; mapping spec field names (`start_of_operation`, `end_of_operation`, `etc`, `entities`, node `p`) to real property keys in the ZIP.
- Ask the S03 inspection to report, from the file, which property keys name toilets, lifts and entrances (the spec does not).
- No S10 coordinate source was found; rank 7 stays open (only text floor and gate side).

## 7. Field-collection items

| id | place | observe / measure | method | est. cost (min) | paid area? | unblocks |
|---|---|---|---|---|---|---|
| FC-SJ-01 | 京王新線 approach, former exit 2 site | Whether exit 2 is still closed; posted notice text; which passage and gate side the closed exit adjoins | Walk, write down posted text (no photos kept in repo) | 20 | No | `gap:closures`, `gap:exit-numbers` |
| FC-SJ-02 | All street exits of E27/S01 (A1, 1-8) | Exit plate text, line tags, posted hours | Walk the exits, copy plate text | 45 | No | `gap:exit-numbers`, `gap:hours` |
| FC-SJ-03 | E27, S01, E01 accessible toilets | Floor, passage, nearest gate, inside or outside the fare gate, signage text | Walk; note signs | 45 | Yes for inside-gate toilets (E27/E01 per unofficial notes) | Toilet POIs; Q2 |
| FC-SJ-04 | Lifts at A1 and the E27/S01 platform links | Which exits have a working lift; hours; where each lift opens | Walk; note signage | 40 | Yes for platform-side lifts | `gap:heights`, Q3 |
| FC-SJ-05 | E27 to JR, Keio, Odakyu, S01, E01, M08 | Signage wording, whether a fare gate is passed, walking time (stopwatch, own pace) | Walk each pair, note gates | 90 | Yes (gates between operators) | `gap:transfers` |
| FC-SJ-06 | Toei store entries (新宿, 新宿西口) | Floor, gate side and nearest exit text per entry | Walk; compare with DR-SJ-03/04 text | 30 | One B2 inside-gate item needs entry | Rank 7 |

## 8. Owner decisions needed

1. May text facts taken from Toei station pages (exit numbers, tags, closed status, hours, lift counts) go into the repo under the Owner #26 "facts only" rule? Toei's terms reserve rights and allow only Copyright Act exceptions. Class set to FACTS_ONLY_REFERENCE meanwhile. UNKNOWN until decided.
2. Per-exit coordinates exist in the Toei page feed. They were not recorded. Decide whether they may ever be used (recommendation: no; the site policy bars copying).
3. Third-party aggregators (DR-SJ-13, DR-SJ-14): pointers only, or excluded. Their terms are restrictive or not retrieved.
4. For store location text, which basis ships: Toei's page (restricted) or the S10 CSV (CC BY 4.0, Q1 Yes)? Recommendation: S10 only.
5. The `stations/shinjuku/sources/manifest.json` S10 entry still says PDL 1.0 (PR#127 covers it); confirm CC BY 4.0 is the label.
6. Whether to re-check Keio and Odakyu pages once Keio's site is back (public pages only; no contact). No decision is needed to retry; listed because no inquiry is allowed.
