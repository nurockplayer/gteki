# Shinjuku shop hours batch 1 — log (OD-32)

Tracking: data-research-05 brief, 2026-10-24. Output: `shinjuku-hours-batch1.json` (schema `gteki.research.hours/0.1`).
Facts only. No current open/closed status is asserted anywhere; hours appear only where the page that prints them also prints a date on or after 2026-04-27.

## Scope read

| Source file (branch) | POIs |
| --- | --- |
| `shinjuku-merchants-batch1.json` (`claude/data-research-sjk-merchants-batch1`) | 6 |
| `shinjuku-merchants-batch2.json` (`claude/data-research-sjk-merchants-batch2`) | 576 |
| `shinjuku-odakyu-dept.json` (`ds/odakyu-dept-shinjuku`) | 1 |
| `shinjuku-recovery-batch1.json` (`ds/sjk-recovery-odakyu-keio`) | 15 |
| total POIs | 598 |
| building entries added | 3 |

Each POI was read only on the host its existing source cites. No page was read on jreast.co.jp, ecute.jp, jr-cross.co.jp, tobu.co.jp, sogo-seibu.jp, odakyu-sc.com, keiosc.co.jp, keio-sc.jp, keio-mall.jp, doutor.co.jp, megaineichiba.jp, Google Maps, Tabelog or any aggregator.

## Method

- Fetch: plain `curl` with the default UA, no custom headers or referer, sequential, 0.5–0.7 s apart; `WebFetch` only for two pages curl could not return (see GAPs).
- 74 page loads in total (71 curl, 3 WebFetch), under the 400 cap.
- Pages were decoded and the printed hours line and any printed date (更新日/掲載日/お知らせ/ニュース date) were read off the page text. Nothing was inferred from another page, from a building-wide default, or from memory.
- Hours text is kept exactly as printed (full-width characters kept). Last-order notes that are not part of the printed hours line were dropped; the one exception is noted below.
- `retrievedAt` is the fetch time in UTC.

## Coverage and the load budget

The 576 batch-2 POIs each cite one of three mall floor-guide pages. Those pages (Lumine Est / Lumine Shinjuku / NEWoMan) print shop names and floors only — no hours, no date. Per-shop hours live on each shop's detail page (`/floorguide/detail/?scd=…`) on the same host, and individual pages print hours but, apart from a "最新ショップニュース" date, no update date.

Reading all 576 detail pages would exceed the 400-load cap, so 12 POIs per mall were read (stratified: every n-th POI in the source order, 36 pages):

- 35 of 36 print an hours line; `shop-sjk-lumine-002663` (Lumine Shinjuku) prints none.
- 2 of 36 also print a shop-news date on or after 2026-04-27 (recorded as OK, see "Decision for the Lead").
- The remaining 33 print hours with no printed date.

POIs whose detail page was not read are marked UNKNOWN with reason `no hours printed`, meaning the cited floor-guide page itself prints no hours. That is a statement about the page on record, not a claim that the shop has no hours.

## Per-site counts

| Site / source | POIs | OK | UNKNOWN no date | UNKNOWN date > 180 d | UNKNOWN no hours printed | UNKNOWN unreadable |
| --- | --- | --- | --- | --- | --- | --- |
| www.kotsu.metro.tokyo.jp (Toei Shinjuku) | 1 | 0 | 0 | 0 | 0 | 1 |
| www.opendata.metro.tokyo.lg.jp (Toei Nishi-guchi CSV) | 1 | 0 | 1 | 0 | 0 | 0 |
| www.tokyometro.jp (Metro Shinjuku) | 4 | 0 | 4 | 0 | 0 | 0 |
| www.lumine.ne.jp/est (floor guide, 12 read) | 245 | 0 | 11 | 0 | 234 | 0 |
| www.lumine.ne.jp/shinjuku (floor guide, 12 read) | 230 | 0 | 12 | 0 | 218 | 0 |
| www.newoman.jp/shinjuku (floor guide, 12 read) | 101 | 2 | 10 | 0 | 89 | 0 |
| www.odakyu-dept.co.jp | 1 | 0 | 0 | 1 | 0 | 0 |
| 15 chain pages (recovery batch 1) | 15 | 1 | 10 | 3 | 1 | 0 |
| buildings (Lumine Est / Lumine Shinjuku / NEWoMan hours pages) | 3 entries | 0 | 3 | 0 | 0 | 0 |
| **total** | **601 entries** | **3** | **51** | **4** | **542** | **1** |

The 234 for Lumine Est is 233 unread floor-guide POIs plus `shop-sjk-lumineest-002663`; the building counts sit in the three floor-guide rows of the table above only through their `sourceId`.

## The three OK entries

| POI | Page | Printed hours | Date printed on the same page |
| --- | --- | --- | --- |
| `shop-sjk-newoman-003262` (PUPA) | shop detail, NEWoMan | `11:00～23:00 ※THE ALLEYは12:00～22:00までの営業` | 2026-10-24 |
| `shop-sjk-newoman-001856` (LA MAISON DU CHOCOLAT) | shop detail, NEWoMan | `月～土 11:00～20:30 日・祝日 11:00～20:00` | 2026-10-17 |
| `shop-sjk-rec-015` (日比谷花壇 新宿小田急エース店) | shop.hibiyakadan.com | `月〜日 10:00〜21:00` | 2026-10-20 |

The date on all three is a same-page お知らせ/ニュース date; none of the three pages states an update date. The PUPA hours line keeps its printed `※THE ALLEY…` clause because that clause is part of the printed hours line; it refers to a different tenant.

Display wording for the station writer (not stored):

> `11:00～23:00 ※THE ALLEYは12:00～22:00までの営業`（出典日 2026-10-24 時点の情報です。変更されている場合があります）

and likewise with 2026-10-17 and 2026-10-20.

## Why the rest are UNKNOWN

- **Toei Shinjuku (1, `page unreadable`).** `www.kotsu.metro.tokyo.jp` returns a 200 page that is an Incapsula bot-challenge shell (no content, no hours, no date) to both curl and WebFetch. Counted as a GAP; no workaround attempted.
- **Tokyo Metro (4, `no date`).** curl gets 403; the page is readable through WebFetch and prints per-shop hours (e.g. OOTORI BANANA `10:00～21:00`) but prints no date.
- **Toei Nishi-guchi CSV (1, `no date`).** The CSV has a 営業時間 column (`7:00～23:00` for the FamilyMart row) but the file prints no date.
- **Lumine Est / Lumine Shinjuku / NEWoMan shops (540 unread + 33 read-without-date, `no hours printed` / `no date`).** Floor-guide pages have no hours; sampled detail pages print hours but no update date (shop-news date only on 2 of 36).
- **Odakyu Department Store (1, `date older than 2026-04-27`).** `www.odakyu-dept.co.jp/shinjuku/hour_acces/` prints the building hours (`■地下2階～2階 10：00→20：30` etc.). The only date on the page is `2025年1月15日` (a parking-change notice), before the 180-day window.
- **Chain shops (3 old dates, 10 no date, 1 no hours).**
  - Old dates: カラダファクトリー (shop news `2026.02.05`), ミニヨン (opening notice `2022年12月3日`), ジュエリーツツミ (hours note `【2021.6.21～当面の間】`).
  - No date: ゼッテリア, 箱根そば本陣 北館/南館, 吉野家, DAISO, アトリエはるか, クリスピー・クリーム・ドーナツ, カフェルノアール, ファミリーマート, 十割蕎麦 さがたに.
  - No hours: PRESS BUTTER SAND 新宿小田急エース店 — the page is a pickup-order page; its only date (`2026年10月25日`) is the shortest pickup slot, not a page date.
- **Buildings (3 entries, `no date`).** The three mall `…/information/hours/` pages print the building-wide hours but no date, so no building-wide hours are recorded; the entries are kept only to show the page was read.

## GAPs

1. `https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html` — bot challenge, unreadable (1 POI).
2. `https://www.tokyometro.jp/station/shinjuku/shop/index.html` — 403 to curl; readable via WebFetch (not a GAP for the hours themselves, but the site blocks plain curl).
3. `https://www.odakyu-dept.co.jp/shinjuku/information/` — 403; not needed, the hours page `hour_acces/` answered instead.

## Decision for the Lead

1. **お知らせ/ニュース dates.** The three OK entries, and any future NEWoMan shop page, qualify only because the brief counts an お知らせ date as a page date. The dates are shop-news dates, not stated update dates. If the Lead wants a stricter rule (stated 更新日 only), these three become UNKNOWN `no date`.
2. **Unread mall detail pages.** 540 floor-guide POIs were not opened one by one (400-load cap). Their detail pages print hours; around 1 in 6 of the sampled pages carried a dated shop-news item. A follow-up batch can read the remaining pages if the date rule above is settled — roughly 540 loads, so two batches.
3. **Building entries.** Kept as UNKNOWN so the writer cannot mistake them for recorded hours.

## Totals

601 entries in the JSON = 598 POI entries (one per POI in scope) + 3 building entries.
OK 3 · UNKNOWN 598 (no date 51, date older than 2026-04-27 4, no hours printed 542, page unreadable 1).
JSON parses (`json.load`), all `poiId`s unique, 598 POIs covered exactly once.
