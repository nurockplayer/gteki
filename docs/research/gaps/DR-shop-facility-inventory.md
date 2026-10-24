# DR — Shop and facility source inventory (Ikebukuro, Shinjuku)

Research date: 2026-10-24. All read times are UTC, same day.

Scope: source inventory only, for station shops and station facilities at Ikebukuro and Shinjuku. **Counts and URLs only — no shop names, no description text, no logos, photos, maps or layouts copied.** Line infrastructure (ticket gates, platforms, transfers, exits, lifts as route) is out of scope here and belongs to lines-lead; this file only records where facility directories live.

Rights: **UNKNOWN (lead decides)** for every row, except where the terms check below records an
explicit licence (KSJ N02-2023: CC BY 4.0). No reuse decision is made in this file.

Method: official pages only, read-only, one page at a time, nothing downloaded or saved. Two readers were used, both recorded per row:

- `plain-HTTP` — plain HTML fetched with a text client (`curl`), no JavaScript executed. Counts were taken from the server-rendered HTML (counted link/store-code occurrences), so they are exact counts of entries present in the markup, not estimates.
- `WebFetch` — page fetched and converted to markdown by the harness fetcher; used only where the plain reader is refused at the network edge. Counts from this reader are exact as listed in the converted page, but were not re-counted from raw HTML.

No browser was used. The worker's resident rules forbid browsers, so the conditional ego-lite allowance in the brief was not exercised; pages that need JavaScript to show their entries are recorded as GAP rather than read another way.

## A. Commercial directories

| Facility / operator | Station | Official directory URL(s) actually read | What it lists | Entries | Floor / zone label | Detail URL pattern (store code?) | Page date | Read (UTC) | Method | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| ルミネ池袋 (Lumine) | Ikebukuro | https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=1f (and b1f…10f) | Shops and restaurants (retail, food, service) | 177 (exact; unique store codes across 11 floor pages) | Yes — per-floor pages, B1F–10F | `…/floorguide/detail/?scd=000404` — 6-digit store code | none printed | 08:48–08:49 | plain-HTTP | The default floorguide page lists only 18 featured entries; the full list needs one request per floor. No duplicate codes across floors. |
| ルミネ新宿 ルミネ1 (area01store01) | Shinjuku | https://www.lumine.ne.jp/shinjuku/floorguide/?area=area01store01&floor=1f (and b2f, b1f, 2f–8f) | Shops and restaurants | 124 (exact) | Yes — B2F–8F | `…/floorguide/detail/?scd=000233` | none printed | 08:48–08:49 | plain-HTTP | |
| ルミネ新宿 ルミネ2 (area02store01) | Shinjuku | https://www.lumine.ne.jp/shinjuku/floorguide/?area=area02store01&floor=1f (and 2f–7f) | Shops and restaurants | 108 (exact) | Yes — 1F–7F; 2F alone has 65 entries | same pattern | none printed | 08:48–08:49 | plain-HTTP | No overlap in store codes with ルミネ1; combined ルミネ新宿 total = 232. |
| ルミネエスト新宿 | Shinjuku | https://www.lumine.ne.jp/est/floorguide/?area=area01store01&floor=1f (and b2f, b1f, 2f–8f) | Shops and restaurants | 245 (exact) | Yes — B2F–8F | `…/floorguide/detail/?scd=002253` | none printed | 08:48–08:49 | plain-HTTP | B1F alone has 49 entries. |
| NEWoMan 新宿 | Shinjuku | https://www.newoman.jp/shinjuku/floorguide/?area=area01nman01&floor=1f (floors 1f–7f, m2f) and `?area=area02nman01&floor=…` (100f, 101f, 103f) | Shops and restaurants | 101 (exact): area01 65 (floors 1F–7F, M2), area02 36 (site labels these zones エキナカ 24, エキソト 7, フードホール 5) | Yes — floor for area01, zone label for area02 | `…/shinjuku/floorguide/detail/?scd=001851` | none printed | 08:48–08:49 | plain-HTTP | area02 entries carry the operator's zone labels (エキナカ 24, エキソト 7, フードホール 5) instead of floors; the labels are kept as printed and no physical location is inferred from them. |
| 小田急百貨店 新宿 | Shinjuku | https://www.odakyu-dept.co.jp/shinjuku/ and https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97 (pages 1–5) | Brands by category, with floor and department | 275 (exact — the page prints 該当件数：275件) | Yes — フロア and 売場 per entry (e.g. floors as 地下1階, ２階) | No per-store detail URL; rows link to floor-guide pages `…/shinjuku/floorguide/<floor>/index.html`. Pagination: `…&page=N` | none printed | 08:50–08:51 | plain-HTTP | The site is live and prints the address 西新宿1-5-1; whether the physical store is open is not established by a live website and is left UNKNOWN here. Floor-guide pages themselves carry the shop plan only as images/PDF links (`…/floorguide/01/<id>-att/01.pdf`), so the brand-result page is the countable surface. |
| 京王百貨店 新宿 | Shinjuku | https://www.keionet.com/shinjuku/ | — | UNKNOWN | — | — | — | 08:51 and 09:01 (two attempts) | plain-HTTP | GAP: every path under keionet.com redirects to `https://www.keionet.com/error_res.html`, title 「メンテナンス中」 (システムメンテナンス中). No directory readable; not a JS issue. |
| エソラ池袋 (Esola) | Ikebukuro | https://www.esola-ikebukuro.com/ → https://www.metropro-sc.jp/esola-ikebukuro/ and `…/shop/floor.jsp?fid=b1` (b1, 1f–8f) | Shops and restaurants, plus service counters and ATM entries | 42 (exact; per-floor tables, includes service counters/ATM, not only shops) | Yes — B1–8F | `…/shop/index.jsp?bf=1&fmt=6&shopid=1028` — numeric shop ID | none printed | 08:52 | plain-HTTP | esola.jp is **not** this facility: it is an unrelated live-house site, and its HTTPS certificate does not match (`CN=*.sakura.ne.jp`), so that host failed TLS verification. The correct official domain redirects to the Metro Properties site. |
| 東武百貨店 池袋 (floor guide only) | Ikebukuro | https://www.tobu-dept.jp/ikebukuro/floormap/detail/B2F (and B1F, 1F–15F) | Shops and restaurants per floor | 881 (exact; unique shop IDs across 17 floor pages, no duplicates) | Yes — B2F–15F; 10F–15F sparse (1–13 entries each) | `…/ikebukuro/shop/102211501/` — numeric shop ID | none printed | 08:53 | plain-HTTP | Service guide (`…/ikebukuro/service/`) splits into tabs (店内・施設のサービス, 施設・設備のサービス) that are rendered client-side; only one tab's content is in the HTML. |
| 新宿サブナード | Shinjuku | https://www.subnade.co.jp/ (and http://, and …/shop/) | — | UNKNOWN | — | — | — | 08:53–08:54 (two attempts) | plain-HTTP | GAP: DNS resolves (163.44.2.142) but the server refuses connections on both 443 and 80 (`Couldn't connect to server`, curl exit 7). Host looks down, not JS-gated. |
| メトロプロムナード (新宿) | Shinjuku | https://www.tokyometro.jp/metropromenade/ | — | UNKNOWN | — | — | — | 09:07–09:09 (four attempts) | plain-HTTP + WebFetch | GAP: no official directory located. The path 301-redirects to `/metropromenade/index.html`, which returns 404 (checked over both http and https). Candidate domains (metrompromenade.com, metro-promenade.com/.jp, metropromenade.jp/.com) have no DNS records. Not listed as a tenant directory on the Metro Properties shopping-centre site either. |

Other commercial directory found while reading A (not in the brief, recorded for planning): **Echika 池袋** (Tokyo Metro in-station, Metro Properties) — https://www.metropro-sc.jp/echika-ikebukuro/shop/floor.jsp?fid=bf, 26 entries (exact; 26 unique `shopid`s, lead recount), B1F only, detail pattern `…/shop/index.jsp?bf=1&fmt=6&shopid=…`, read 09:01 UTC, plain-HTTP.

## B. JR East in-station shops (エキナカ)

| Facility / operator | Station | URL(s) tried | What it lists | Entries | Floor / zone label | Store code in URL | Read (UTC) | Method | Notes |
|---|---|---|---|---|---|---|---|---|---|
| JR East station pages (`/estation/`) | Ikebukuro, Shinjuku | https://www.jreast.co.jp/estation/ , `…/estation/station/info.aspx?StationCd=127` , `…/estation/stations/514.html` | — | UNKNOWN | — | — | 08:57–08:58 | plain-HTTP + WebFetch | GAP: whole domain answers **403 Access Denied** (Akamai) to the plain reader even with browser headers and a referer, and WebFetch also gets 403. These station pages are an official listing of JR East in-station shops, but no claim is made that they are the only one; B is blocked at source for this read. |
| JR東日本クロスステーション | — | https://www.jretc.co.jp/ | — | UNKNOWN | — | — | 08:58, 09:01 | plain-HTTP | GAP: no DNS records for `jretc.co.jp` / `www.jretc.co.jp`. |
| ecute (JR東日本クロスステーション) | — | https://www.ecute.jp/ | Shop directories for 9 centres | 0 relevant | n/a | — | 08:58 | plain-HTTP | Reachable and countable, but the centre list is 赤羽, 秋葉原, edition, maach, 日暮里, 大宮, 大宮ノース, 品川, 立川, 上野 — **no 池袋 and no 新宿**. |
| ディラ (Dila) | — | https://dila.co.jp/ | — | 0 relevant | — | — | 08:58 | plain-HTTP | `dila.co.jp` is an unrelated language school, not the JR East エキナカ brand. No official ディラ directory was located. |
| ルミネ池袋 / ルミネ新宿 / NEWoMan 新宿 (JR East group station buildings) | Ikebukuro, Shinjuku | see table A | Shops | 177 / 232 / 101 | yes | `scd` | 08:48–08:49 | plain-HTTP | These are the reachable official route to JR-side station shops while `jreast.co.jp` is blocked. Rights for using them stay UNKNOWN (lead decides). |
| Echika 池袋 (Tokyo Metro, in-station) | Ikebukuro | https://www.metropro-sc.jp/echika-ikebukuro/shop/floor.jsp?fid=bf | In-station shops | 26 (exact; lead recount) | B1F | `shopid` | 09:01 | plain-HTTP | Not JR East; recorded because it is the other in-station directory at Ikebukuro. |

## C. Station facility directories

"Flags only" means the page marks whether each facility exists (○/ー) rather than giving a count of installations.

| Operator / page | Station | URL read | Facility types covered | Counts? | Labels | Page date | Read (UTC) | Method | Notes |
|---|---|---|---|---|---|---|---|---|---|
| JR East station facility pages | Ikebukuro, Shinjuku | `https://www.jreast.co.jp/estation/…` | UNKNOWN | — | — | — | 08:57–08:58 | plain-HTTP + WebFetch | GAP: 403 from the domain edge (see B). |
| 東京メトロ 施設・店舗 | Ikebukuro | https://www.tokyometro.jp/station/ikebukuro/shop/index.html | Shops plus facility types: ATM (7), コインロッカー (1), 東京メトロッカー＋ (1), モバイルバッテリー (1), CocoDesk (1), 外貨両替 (2), Echika (1), plus station-area facilities (2) | 46 entries (exact) | Exit/gate labels such as 36番出口, C6出入口, 改札内; no floor numbers | none printed | 09:11 | WebFetch (plain reader 403) | Static page, no pagination. Detail links are slug pages (`<slug>.html#adjacent`), no store code. |
| 東京メトロ 施設・店舗 | Shinjuku | https://www.tokyometro.jp/station/shinjuku/shop/index.html | Shops plus ATM (3), コインロッカー (1), 東京メトロッカー＋ (1), モバイルバッテリー (1), モバイルWi-Fi (1) | 14 entries (exact) | Exit/gate/platform labels (A8出入口付近, 東口改札付近, 丸ノ内線ホーム); no floor numbers | none printed | 09:10 | WebFetch (plain reader 403) | Static page, no pagination. |
| 東京メトロ バリアフリー設備 | Ikebukuro | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | エレベーター (6), エスカレーター (14), 階段昇降機 (1), 車いす対応トイレ (3), 乳幼児用設備 (3), オストメイト (3) | 30 location entries (exact) | 改札内/改札外, platform side, exit numbers; level labels like 中二階 but no floor numbers | none printed (only lift-suspension notices dated 2026-10/11) | 09:13 | WebFetch (plain reader 403) | The `…/barrierfree/index.html` slug serves the same content. Toilets appear only as 車いす対応トイレ; no plain トイレ or 多機能トイレ category. |
| 東京メトロ バリアフリー設備 | Shinjuku | https://www.tokyometro.jp/station/shinjuku/accessibility/index.html | エレベーター (4), エスカレーター (2), 階段昇降機 (0), toilet facilities (3) | 9 location entries (exact) | Area/gate and exit-code labels; no floor numbers | none printed | 09:14 | WebFetch (plain reader 403) | Low entry count for a multi-line station; worth a second look if this becomes load-bearing. |
| 都営地下鉄 (Toei) | Ikebukuro, Shinjuku | https://www.kotsu.metro.tokyo.jp/subway/stations/ikebukuro.html , `…/shinjuku.html` | UNKNOWN | — | — | — | 08:58 | plain-HTTP + WebFetch | GAP: Incapsula bot challenge — the plain reader gets a 212-byte `noindex` stub with a script tag; WebFetch returns empty content. |
| 小田急電鉄 各駅設備一覧 | Shinjuku | https://www.odakyu.jp/station/facilities/ (station page: https://www.odakyu.jp/station/shinjuku/) | 12 facility categories: エレベーター, エスカレーター, ホームドア, 車いす用スロープ, ハンドル形電動車いす, 車いす対応型個室トイレ, オストメイト対応型個室トイレ, ベビー対応設備, 駅構内触知案内板, ホーム待合室, 定期券発売窓口, AED | Flags only (○/ー per station) | Facility categories as rows, stations as columns; 新宿 is a column; no zones | 2026年3月23日現在 (printed) | 08:59 | plain-HTTP | The table is transposed: facility categories are rows and stations are columns, and 新宿 appears as a column. The station page itself shows a barrier-free map legend and links floor/elevator maps only as PDFs (not downloaded). odakyu.jp is **corroboration-only** and its rights stay UNKNOWN after the terms check (§ Terms checks); its flags are not stored facts. |
| 京王電鉄 新宿駅 | Shinjuku | https://www.keio.co.jp/train/station/ko01_shinjuku/ | エレベーター, エスカレーター, 車イス対応エスカレーター, 車イス用昇降機, スロープ, トイレ (車イス対応・オストメイト対応・ベビーシート), 触知案内, 行先案内板, ホーム待合室, AED | Flags only | Station-level; maps are PDFs (`…/station_map/pdf/ko01_shinjuku*.pdf`, not downloaded) | none printed | 09:00 | plain-HTTP | Facility block is under the `#facility` anchor. Coin lockers and ATMs are not on this page. keio.co.jp is **corroboration-only** and its rights stay UNKNOWN after the terms check (§ Terms checks). |
| 西武鉄道 バリアフリー情報一覧 | Ikebukuro | https://www.seiburailway.jp/railway/barrierfree/list/ (station page: https://www.seiburailway.jp/railway/station/ikebukuro/) | バリアフリートイレ, エレベーター, エスカレーター, ワイド型改札機, ハンドル型電動車いす, 点字触知図版, 点字手すりプレート, 点字運賃表 | Flags only; 池袋 row all ○ | Station rows | none printed | 08:59 | plain-HTTP | Seibu serves 池袋 (Ikebukuro line); 西武新宿駅 is a separate station and does appear in this list, but it is not JR/Metro 新宿駅. Seibu's station shop portal is https://www.seibu-shop.jp/floorguide/station/?station=st01 (エミオ池袋, PePe), a JS portal not counted here. |
| 東武鉄道 池袋駅 | Ikebukuro | https://www.tobu.co.jp/railway/guide/station/info/7105/ | 定期券売り場, エスカレーター, 待合室, エレベーター, コインロッカー, バリアフリートイレ, 男性用/女性用トイレ with ベビーチェア・ベビーシート, 構内マップ; plus platform step/gap notes | Flags only | Station-level, platform numbers | none printed | 09:00 | plain-HTTP | No ATM listed. The network-wide barrier-free map is a PDF (`/pdf/guide/barrierfreemap.pdf?20260428`) — not downloaded. **tobu.co.jp is corroboration-only**: the page gives flags only, with no count and no page date, so it cannot independently support a stored facility fact. |
| 東武鉄道 at 新宿 | Shinjuku | — | — | — | — | — | — | — | Not applicable: Tobu serves 池袋, not 新宿. |
| 小田急 at 池袋 / 京王 at 池袋 | Ikebukuro | — | — | — | — | — | — | — | Not applicable: neither operator serves 池袋. |
| Lumine floor guides (facility legends) | Ikebukuro, Shinjuku | same floorguide URLs as table A | Facility icons on floor maps: 女子トイレ, 男子トイレ, バリアフリートイレ | No counts | Per floor | none printed | 08:48–08:49 | plain-HTTP | Facilities exist only as map icons/legend, not as an enumerable list — not a facility directory. |

### Open data

| Source | URL | What it holds | Counts for these stations? | Licence as printed | Read (UTC) | Method | Notes |
|---|---|---|---|---|---|---|---|
| 東京都オープンデータカタログ | https://catalog.data.metro.tokyo.lg.jp/ (also https://www.opendata.metro.tokyo.lg.jp/) | UNKNOWN | UNKNOWN | not read | 09:00–09:02 | plain-HTTP + WebFetch | GAP: catalogue host returns 403; the alternate host answers 200 with a zero-byte body. |
| ODPT 公共交通オープンデータセンター | https://developer.odpt.org/ | UNKNOWN | UNKNOWN | not read | 09:00 | plain-HTTP | GAP: single-page app; the HTML says "You need to enable JavaScript to run this app." Catalogue and licence page therefore unread. |
| 国土数値情報 (MLIT) | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html | Railway lines and station locations/attributes (事業者, 路線名, 運営会社); data as of 2023-12-31 | No — lines/stations only, no toilet/locker/ATM/elevator fields | Dataset **N02-2023**（鉄道 2023年度版, data as of 2023-12-31）: オープンデータ（CC_BY_4.0） for 2020 onward; 商用可 otherwise | 09:00–09:02 | plain-HTTP | Exists and is licence-clear, but it is a geometry/identity dataset, not a facility inventory. Checked against `agreement.html` and `agreement_02.html` on 2026-10-24T16:41Z (§ Terms checks): CC BY 4.0-compatible, commercial use allowed with credit, so it may stay as primary evidence. Credit line: 「出典：国土数値情報（鉄道データ）（国土交通省）(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html)（2026年10月24日取得）」. |

## Terms checks (2026-10-25, director ruling)

Plain `curl`, default UA, one page at a time, ≥0.6 s apart; 7 requests in total, all HTTP 200,
all within the 60-request cap. No page text is reproduced beyond the one-sentence clause quotes
below. Rights decisions stay with the lead; this section records what each terms page prints.

| Page | Status | Retrieved (UTC) | sha256 | Bytes | Verdict |
|---|---|---|---|---|---|
| https://www.odakyu.jp/policy/ （ご利用にあたって） | 200 | 16:41:16Z | `f2532d9c677c3a018b3f218904db01a451784d48d8b809545b961e246609fb8d` | 19544 | **corroboration only, no transcription** |
| https://www.keio.co.jp/contact/site/ （サイトのご利用にあたって） | 200 | 16:41:17Z | `5ce69d61e6c98f316c7ae021e51c505339d439879bd5faee82963c855210ba37` | 107588 | **corroboration only, no transcription** |
| https://nlftp.mlit.go.jp/ksj/other/agreement.html | 200 | 16:41:31Z | `ad5df9c766f2c57250e9d6e96147b8c79e2292782276abb7203d967934a07226` | 27978 | current rules (effective 2026-03-23); CC BY 4.0-compatible, credit required |
| https://nlftp.mlit.go.jp/ksj/other/agreement_02.html | 200 | 16:41:32Z | `8e3d49422c498b78e824caa1ae7cee900294617a6ae19c28ed879627a72c0586` | 62499 | 令和2年 rules; 「商用利用も可能です」, CC BY 4.0-compatible |
| https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html | 200 | 16:41:37Z | `15d5b5d1defa1404efad10aaf99d78eac717f2e3ee8ba1b2ba92d75329a373a9` | 52973 | dataset N02-2023: 「2020年（令和2年）以降：オープンデータ（CC_BY_4.0）」 |

- **odakyu.jp** — the terms ban all use of the site's content without prior permission:
  「当社の事前の許諾なく当ウェブサイト上に掲載されている全ての写真、社名ロゴ、画像、文章等コンテンツデータを利用（複製・転用・転載・電磁的加工・送信・頒布・二次的使用・その他これらに類する全ての行為を含む）することは一切お断りいたします。」
  Business use is therefore banned → **corroboration only, no transcription**; rights UNKNOWN.
  Nothing from this site is imported.
- **keio.co.jp** — the terms likewise refuse all reuse of the content:
  「当サイト上に掲載されている全ての写真、社名ロゴ、画像、文章等のデータ等の利用については、複製・転用・転載・電磁的加工・送信・頒布・二次的使用・その他これらに類する全ての行為も含め、一切お断りいたします。」
  Business use is therefore banned → **corroboration only, no transcription**; rights UNKNOWN.
  Nothing from this site is imported.
- **Odakyu Ace and Keio Mall** (separate properties, not cited in this inventory) are **flat bans** under the same ruling: no use at all, not even corroboration.
- **国土数値情報 (KSJ, nlftp.mlit.go.jp)** — each dataset is judged by its own printed
  使用許諾条件 against `agreement.html` / `agreement_02.html`. Dataset **N02-2023**（鉄道
  2023年度版）prints 「2020年（令和2年）以降：オープンデータ（CC_BY_4.0）」, and both agreement
  pages allow commercial use with credit (CC BY 4.0-compatible), so this dataset **may stay as
  primary evidence**. Required credit, as printed: 「出典：国土数値情報（鉄道データ）（国土交通省）
  (https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html)（2026年10月24日取得）」.
  A non-commercial dataset would be removed from use; none of the datasets cited here is
  non-commercial.

## GAP list (unreadable, with error and UTC time)

1. 京王百貨店 新宿 — `www.keionet.com` redirects every path to `/error_res.html` 「メンテナンス中」. 08:51 UTC; retried 09:01 UTC, unchanged.
2. 新宿サブナード — `www.subnade.co.jp` refuses TCP on 443 and 80 (DNS 163.44.2.142). 08:53–08:54 UTC.
3. メトロプロムナード 新宿 — no directory found; `/metropromenade/` 301 → `/metropromenade/index.html` 404; guess domains do not resolve. 09:07–09:09 UTC.
4. JR East (`jreast.co.jp`) — 403 Access Denied (Akamai) for the plain reader with browser headers/referer and for WebFetch; blocks both B (in-station shops) and the JR part of C (facilities). 08:57–08:58 UTC.
5. JR東日本クロスステーション (`jretc.co.jp`) — no DNS records. 08:58 / 09:01 UTC.
6. 都営地下鉄 (`kotsu.metro.tokyo.jp`) — Incapsula JS challenge; stub page with plain reader, empty via WebFetch. 08:58 UTC.
7. 東京都オープンデータカタログ — 403 at `catalog.data.metro.tokyo.lg.jp`; zero-byte 200 at `www.opendata.metro.tokyo.lg.jp`. 09:00–09:02 UTC.
8. ODPT developer site — JavaScript-only app, catalogue unreadable without a browser. 09:00 UTC.
9. `esola.jp` — wrong entity (live house), and TLS fails (`CN=*.sakura.ne.jp`); resolved by using the redirect target `metropro-sc.jp/esola-ikebukuro/`. 08:52 UTC.
10. 東武百貨店 service guide (`…/ikebukuro/service/`) — facility/service tabs render client-side; only the default tab is in the HTML. 08:53 UTC.

Note for the lead: items 4–6 and 8 are readable with a JavaScript-capable reader (the brief allows ego-lite read-only), so they can be handed to Codex or a later worker rather than treated as dead ends.

## Suggested next batches (largest first)

1. 東武百貨店 池袋 — 881 entries, has shop IDs and floors. Largest single source by far.
2. 小田急百貨店 新宿 — 275 entries, prints its own total, floors + 売場 labels, paginated 5 pages.
3. ルミネエスト新宿 — 245 entries with `scd` codes.
4. ルミネ新宿 (ルミネ1 + ルミネ2) — 232 entries, two area parameters.
5. ルミネ池袋 — 177 entries.
6. NEWoMan 新宿 — 101 entries; area02 carries the operator's zone labels エキナカ / エキソト / フードホール as printed. No physical location is inferred from those labels, so which batch it belongs to is left to the lead.
7. 東京メトロ 池袋 施設・店舗 — 46 entries mixing shops and facilities (ATM, lockers).
8. エソラ池袋 — 42 entries, includes service counters.
9. Echika 池袋 — 26 entries, in-station (already transcribed in #407).
10. 東京メトロ 新宿 施設・店舗 — 14 entries.

Facility-only batches are small and flag-based (Odakyu, Keio, Seibu, Tobu matrices); they are cheap but carry no counts, so they are best used to confirm availability rather than to size anything.
