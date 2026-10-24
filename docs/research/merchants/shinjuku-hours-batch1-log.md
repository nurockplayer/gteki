# Shinjuku shop hours batch 1 — log (OD-32)

Tracking: data-research-05 brief, 2026-10-24; revised twice the same day (Lead review, then the OD-32 amendment). Output: `shinjuku-hours-batch1.json` (schema `gteki.research.hours/0.1`).
Facts only. No current open/closed status is asserted anywhere.

Two rules run through the file:

- **Per-shop hours** (598 POI entries): only where the page prints a qualifying date — ≤180 days, on a notice about hours — on or after 2026-04-27.
- **Building-level hours** (4 building entries): per the OD-32 amendment of 2026-10-24, undated official pages may be recorded, marked `basis: "undated-official"` (see the amendment section below).

## Scope read

| Source file (branch) | POIs |
| --- | --- |
| `shinjuku-merchants-batch1.json` (`claude/data-research-sjk-merchants-batch1`, head bfc27902) | 6 |
| `shinjuku-merchants-batch2.json` (`claude/data-research-sjk-merchants-batch2`, head e6b57d83) | 576 |
| `shinjuku-odakyu-dept.json` (`ds/odakyu-dept-shinjuku`, head 73554b05) | 1 |
| `shinjuku-recovery-batch1.json` (`ds/sjk-recovery-odakyu-keio`, head 36bc6361) | 15 |
| total POIs | 598 |
| building entries | 4 |

Every `poiId` in the JSON was checked against the current head of its file: the 598 ids match the union of the four files exactly, and each entry's `sourceId` is one of that POI's cited sources. The recovery POIs were remapped by source to the current head, whose ids are 001–004, 007–014 and 016–018 (005, 006 and 015 were removed upstream): DAISO → 007, カラダファクトリー → 008, アトリエはるか → 009, クリスピー・クリーム・ドーナツ → 010, PRESS BUTTER SAND → 011, ルノアール → 012, MIGNON → 013, ファミリーマート → 014, さがたに → 016, ツツミ → 017, 日比谷花壇 → 018.

Each POI was read only on the host its existing source cites. No page was read on jreast.co.jp, ecute.jp, jr-cross.co.jp, tobu.co.jp, sogo-seibu.jp, odakyu-sc.com, keiosc.co.jp, keio-sc.jp, keio-mall.jp, doutor.co.jp, megaineichiba.jp, Google Maps, Tabelog or any aggregator.

## Date rule applied (OD-32, as revised)

A date counts only when it is printed on the same page as the hours **and** the dated item itself is about hours (営業時間・休業・変更 etc.) **and** it is no older than 2026-04-27. A news date on an unrelated product or event notice does not qualify (reason `dated notice not about hours`).

## Method

- Fetch: plain `curl` with the default UA, no custom headers or referer, sequential, 0.5–0.7 s apart; `WebFetch` only for the two pages curl could not return (see GAPs).
- 101 page loads in total (98 curl, 3 WebFetch), under the 400 cap.
- Pages were decoded and the printed hours line and any printed date read off the page text. Nothing was inferred from another page, from a building-wide default, or from memory.
- Hours text is kept exactly as printed (full-width characters kept). Last-order notes outside the printed hours line were dropped.
- `retrievedAt` is the fetch time in UTC.

## Coverage and the load budget

The 576 batch-2 POIs each cite one of three mall floor-guide pages. Those pages (Lumine Est / Lumine Shinjuku / NEWoMan) print shop names and floors only — no hours, no date. Per-shop hours live on each shop's detail page (`/floorguide/detail/?scd=…`) on the same host.

Reading all 576 detail pages would exceed the 400-load cap, so:

- 12 POIs per mall were read (stratified, 36 pages): 35 print an hours line, 1 prints none; **2** carried a dated notice and both turned out to be product news, not hours, so under the revised rule neither qualified.
- **Random test of the unread pool**: seed `20261024`, `random.Random(20261024).sample(pool, 20)` over the 540 floor-guide POIs whose detail pages had not been read. All 20 pages returned 200 and printed an hours line; **1 of 20** printed a dated notice at all (`10月1日よりハロウィン限定パン販売！ 2026.10.01`, a product notice, not about hours). **0 of 20 (0%)** carried a date that qualifies under the revised rule.

POIs whose detail page was not read are marked UNKNOWN with reason `no hours printed`, meaning the cited floor-guide page itself prints no hours. That is a statement about the page on record, not a claim that the shop has no hours.

## Per-site counts

| Site / source | POIs | OK | no date | date > 180 d | dated notice not about hours | no hours printed | unreadable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| www.kotsu.metro.tokyo.jp (Toei Shinjuku) | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| www.opendata.metro.tokyo.lg.jp (Toei Nishi-guchi CSV) | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| www.tokyometro.jp (Metro Shinjuku) | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| www.lumine.ne.jp/est (floor guide, 12 read) | 245 | 0 | 11 | 0 | 0 | 234 | 0 |
| www.lumine.ne.jp/shinjuku (floor guide, 12 read) | 230 | 0 | 12 | 0 | 0 | 218 | 0 |
| www.newoman.jp/shinjuku (floor guide, 12 read) | 101 | 1 | 10 | 0 | 1 | 89 | 0 |
| www.odakyu-dept.co.jp | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| 15 chain pages (recovery batch 1) | 15 | 0 | 10 | 3 | 1 | 1 | 0 |
| buildings (Lumine Est / Lumine Shinjuku / NEWoMan / Odakyu hours pages) | 4 entries | 4 | 0 | 0 | 0 | 0 | 0 |
| **total** | **602 entries** | **5** | **48** | **4** | **2** | **542** | **1** |

The 234 for Lumine Est is 233 unread floor-guide POIs plus `shop-sjk-lumineest-002663`; the three building counts share the floor-guide `sourceId`s and are listed on their own row.

## The OK entry, and the two that were withdrawn

| POI | Page | Printed hours | Qualifying date |
| --- | --- | --- | --- |
| `shop-sjk-newoman-003262` (PUPA) | shop detail, NEWoMan | `11:00～23:00 ※THE ALLEYは12:00～22:00までの営業` | 2026-10-24 |

The PUPA page's notice is `『ジ・アレイ』の営業時間変更と休業のお知らせ` (2026.10.24) — an hours/closure notice, printed on the same page as the hours line, which itself carries the `※THE ALLEY…` clause. It concerns THE ALLEY, a tenant printed on that same hours line, not PUPA's own core hours; if the Lead reads the rule as "about this shop's hours", this entry also drops to `dated notice not about hours`.

Withdrawn under the revised rule:

- `shop-sjk-newoman-001856` (LA MAISON DU CHOCOLAT) — dated items are `INSOLITE FUMÉ 2026.10.17` and `WINTER 2026 2026.09.16`, product news.
- `shop-sjk-rec-018` (日比谷花壇 新宿小田急エース店) — dated items are `今週のおすすめは「AUTUMN ROSE」2026.10.20` and `秋のバラをピックアップ！「フラワーピクニック」開催 2026.10.13`, product/event news.

Display wording for the station writer (not stored):

> `11:00～23:00 ※THE ALLEYは12:00～22:00までの営業`（出典日 2026-10-24 時点の情報です。変更されている場合があります）

## Why the rest are UNKNOWN

- **Toei Shinjuku (1, `page unreadable`).** `www.kotsu.metro.tokyo.jp` returns a 200 page that is an Incapsula bot-challenge shell (no content, no hours, no date) to both curl and WebFetch. GAP; no workaround attempted.
- **Tokyo Metro (4, `no date`).** curl gets 403; the page is readable through WebFetch and prints per-shop hours (e.g. OOTORI BANANA `10:00～21:00`) but prints no date.
- **Toei Nishi-guchi CSV (1, `no date`).** The CSV has a 営業時間 column (`7:00～23:00` for the FamilyMart row) but the file prints no date.
- **Lumine Est / Lumine Shinjuku / NEWoMan shops (540 unread + 33 read-without-date, `no hours printed` / `no date`).** Floor-guide pages have no hours; sampled detail pages print hours but the only dates seen were unrelated product news, so nothing qualifies.
- **Odakyu Department Store (1, `date older than 2026-04-27`).** `www.odakyu-dept.co.jp/shinjuku/hour_acces/` prints the building hours (`■地下2階～2階 10：00→20：30` etc.). The only date on the page is `2025年1月15日` (a parking-change notice), before the 180-day window.
- **Chain shops (3 old dates, 10 no date, 2 dated notices not about hours, 1 no hours).**
  - Old dates: カラダファクトリー (shop news `2026.02.05`), ミニヨン (opening notice `2022年12月3日`), ジュエリーツツミ (hours note `【2021.6.21～当面の間】`).
  - No date: ゼッテリア, 箱根そば本陣 北館/南館, 吉野家, DAISO, アトリエはるか, クリスピー・クリーム・ドーナツ, カフェルノアール, ファミリーマート, 十割蕎麦 さがたに.
  - Dated notices not about hours: LA MAISON DU CHOCOLAT, 日比谷花壇.
  - No hours: PRESS BUTTER SAND 新宿小田急エース店 — the page is a pickup-order page; its only date (`2026年10月25日`) is the shortest pickup slot, not a page date.
- **Buildings (4 entries).** Recorded as OK under the OD-32 amendment below; they are not per-shop hours and carry no page date.

## GAPs

1. `https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html` — bot challenge, unreadable (1 POI).
2. `https://www.tokyometro.jp/station/shinjuku/shop/index.html` — 403 to curl; readable via WebFetch.
3. `https://www.odakyu-dept.co.jp/shinjuku/information/` — 403; not needed, the hours page `hour_acces/` answered instead.

## OD-32 amendment (2026-10-24): undated official pages

The director amended OD-32 on 2026-10-24: hours from **undated** official pages may also be recorded, for building-level entries, marked as such. The four building-hours pages were read once more for this revision (4 loads) and the four building entries now carry:

- `status: "OK"`, `pageDate: null`, `basis: "undated-official"`, `note: "店舗により異なる場合あり"`;
- `hoursText` exactly as printed — the 館営業時間 line(s), keeping printed exceptions such as restaurant floors and the zone-level blocks (エキナカ／フードホール／エキソト for NEWoMan), stopping before the per-shop `営業時間の異なるショップ` list;
- service-counter lines (ルミネカードカウンター受付, 免税カウンター) were not treated as 館営業時間 and are not included.

The four entries:

| Building | Page | Printed hours |
| --- | --- | --- |
| ルミネエスト新宿 | `https://www.lumine.ne.jp/est/information/hours/` | `ショッピング 平日 11:00 ～ 21:00 土日祝 10:30 ～ 21:00 レストラン 平日/土日祝 11:00 ～ 22:00` |
| ルミネ新宿 | `https://www.lumine.ne.jp/shinjuku/information/hours/` | `ショッピング 11:00 ～ 21:00 ルミネ1-7F レストラン 11:00 ～ 22:30` |
| ニュウマン新宿 | `https://www.newoman.jp/shinjuku/information/hours/` | `ショッピング 月～土 11:00 ～ 20:30 日・祝日 11:00 ～ 20:00 エキナカ（フード） … フードホール 7:00～23:00 エキソト 7:00～23:00` (full printed block in the JSON) |
| 小田急百貨店 新宿店 | `https://www.odakyu-dept.co.jp/shinjuku/hour_acces/` | `■地下2階～2階 10：00→20：30 ※日曜・祝日は20：00まで ■7階 10：00→20：00 … ※その他、一部の売場やカフェは営業時間が異なる場合があります。` |

小田急百貨店 新宿店 had no building entry before this amendment; one was added (`poiId: null`). The department-store POI itself (`shop-sjk-odakyudept`) is untouched and stays UNKNOWN, as instructed — per-shop entries are a later batch.

Display wording for the station writer:

> `11:00 ～ 21:00`（GT-Eki 確認日 2026-10-24 時点の公式表記。変更されている場合があります）＋ 官方頁面連結

Operational rules carried with the amendment: building hours are **hidden or re-checked after 180 days**; precedence is **merchant-stated > dated official > undated official**.

## Still open for the Lead

1. **PUPA** — see above: an hours notice for a tenant on the same printed hours line. Keep or drop.
2. **Unread mall detail pages** — the 20-page random test found no qualifying date (0%), and the 36 stratified pages found none either. A full read of the remaining 540 is roughly 540 loads (two batches) if the Lead wants certainty rather than the sample. Under the amendment, a later batch can also record undated per-shop hours.

## Totals

602 entries in the JSON = 598 POI entries (one per POI in scope) + 4 building entries.
OK 5 (1 per-shop, 4 building) · UNKNOWN 597 (no date 48, date older than 2026-04-27 4, dated notice not about hours 2, no hours printed 542, page unreadable 1).
JSON parses (`json.load`), all `poiId`s unique, 598 POIs covered exactly once, all ids present at the current head of their source file.
