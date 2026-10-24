# Shinjuku shop hours batch 1 — log (OD-32)

Tracking: data-research-05 brief, 2026-10-24; revised the same day (Lead review, OD-32 amendment, per-shop backfill). Output: `shinjuku-hours-batch1.json` (schema `gteki.research.hours/0.1`).
Facts only. No current open/closed status is asserted anywhere.

Two rules run through the file:

- **Dated official hours** (per shop): the page prints an hours line and a date on the same page, the dated item itself is about hours (営業時間・休業・変更 etc.), and the date is no older than 2026-04-27. Entries carry the printed date in `pageDate`.
- **Undated official hours** (OD-32 amendment, 2026-10-24): hours from undated official pages may be recorded with `pageDate: null` and `basis: "undated-official"`. Applied here to every shop page that prints hours and to the four building-hours pages.

## Scope read

| Source file (branch) | POIs |
| --- | --- |
| `shinjuku-merchants-batch1.json` (`claude/data-research-sjk-merchants-batch1`, head bfc27902) | 6 |
| `shinjuku-merchants-batch2.json` (`claude/data-research-sjk-merchants-batch2`) | 576 |
| `shinjuku-odakyu-dept.json` (`ds/odakyu-dept-shinjuku`, head 73554b05) | 1 |
| `shinjuku-recovery-batch1.json` (`ds/sjk-recovery-odakyu-keio`, head 36bc6361) | 15 |
| total POIs | 598 |
| building entries | 4 |
| total entries | 602 |

Every `poiId` in the JSON was checked against its file: the 598 ids match the union of the four files exactly, and each entry's `sourceId` is one of that POI's cited sources. The recovery POIs were remapped by source to the current head, whose ids are 001–004, 007–014 and 016–018 (005, 006 and 015 were removed upstream): DAISO → 007, カラダファクトリー → 008, アトリエはるか → 009, クリスピー・クリーム・ドーナツ → 010, PRESS BUTTER SAND → 011, ルノアール → 012, MIGNON → 013, ファミリーマート → 014, さがたに → 016, ツツミ → 017, 日比谷花壇 → 018.

Each POI was read only on the host its existing source cites. No page was read on jreast.co.jp, ecute.jp, jr-cross.co.jp, tobu.co.jp, sogo-seibu.jp, odakyu-sc.com, keiosc.co.jp, keio-sc.jp, keio-mall.jp, doutor.co.jp, megaineichiba.jp, Google Maps, Tabelog or any aggregator.

## Method

- Fetch: plain `curl`, default UA, no custom headers or referer, sequential, 0.5–0.7 s apart; `WebFetch` only for the two pages curl could not return (see GAPs).
- Page loads: 74 (first pass) + 23 (sample test) + 4 (building re-read) + 400 (per-shop backfill) + 191 (batch 2) = 692 across the session; each pass stayed within its cap.
- Pages were decoded and the printed hours line read off the page text. Nothing was inferred from another page, from a building-wide default, or from memory.
- Hours text is kept exactly as printed (full-width characters kept). Dynamic `営業中` status text and last-order / reservation notes outside the printed hours line were dropped; printed labels (`箱根そば本陣`, `[お知らせ] 土日祝は…`, `【2021.6.21～当面の間】…`) are kept.
- `retrievedAt` is the fetch time in UTC.

## Coverage

Batch 2 (576 POIs) cites three mall floor guides. Those pages print shop names and floors only — no hours, no date. Per-shop hours live on each shop's detail page (`/floorguide/detail/?scd=…`) on the same host.

- **First pass**: 12 POIs per mall read (stratified, 36 pages) plus a random test of the unread pool (seed `20261024`, 20 pages): of 56 pages read before the amendment, every one printed an hours line except one, and no page carried a date that qualified under the strict rule.
- **Per-shop backfill (batch 1)**: 400 loads, in the Lead's priority order — NEWoMan 101 (all read), LUMINE新宿 230 (all read), the recovery 15 chain pages (all read), then LUMINE EST 54 of 245 (the 12 previously sampled first, then file order). LUMINE EST stopped there because of the 400-load cap.
- **Batch 2**: the remaining 191 LUMINE EST detail pages, 191 loads, all HTTP 200. 189 print an hours line and are now recorded as undated official; 2 print none. All three malls are now read end to end.

## Per-site counts

| Site / source | POIs | OK | no hours printed | no date | other |
| --- | --- | --- | --- | --- | --- |
| www.kotsu.metro.tokyo.jp (Toei Shinjuku) | 1 | 0 | 0 | 0 | 1 (page unreadable) |
| www.opendata.metro.tokyo.lg.jp (Toei Nishi-guchi CSV) | 1 | 0 | 0 | 1 | 0 |
| www.tokyometro.jp (Metro Shinjuku) | 4 | 0 | 0 | 4 | 0 |
| www.lumine.ne.jp/est (all 245 read) | 245 | 243 | 2 | 0 | 0 |
| www.lumine.ne.jp/shinjuku (all 230 read) | 230 | 224 | 6 | 0 | 0 |
| www.newoman.jp/shinjuku (all 101 read) | 101 | 101 | 0 | 0 | 0 |
| www.odakyu-dept.co.jp (department-store POI) | 1 | 0 | 0 | 0 | 1 (date older than 2026-04-27) |
| 15 chain pages (recovery batch 1) | 15 | 14 | 1 | 0 | 0 |
| buildings (Lumine Est / Lumine Shinjuku / NEWoMan / Odakyu hours pages) | 4 entries | 4 | 0 | 0 | 0 |
| **total** | **602 entries** | **586** | **9** | **5** | **2** |

All 586 OK entries carry `pageDate: null` and `basis: "undated-official"` except one: `shop-sjk-newoman-003262` (PUPA) keeps its dated OK (`pageDate: 2026-10-24`), unchanged as instructed.

The shops whose detail page prints no hours line (or only a pointer to another site) stay `no hours printed`:

- LUMINE新宿: `shop-sjk-lumine-002665`, `shop-sjk-lumine-003202`, `shop-sjk-lumine-000269`, `shop-sjk-lumine-002663`, `shop-sjk-lumine-002379`, `shop-sjk-lumine-002380` (the last two print only `※最新の営業時間については下記のよしもと公式サイトをご確認ください`, which is not a time).
- LUMINE EST: `shop-sjk-lumineest-002520` (リズリサ), `shop-sjk-lumineest-003453` (MIZUNO SPORTSTYLE).
- `shop-sjk-rec-011` (PRESS BUTTER SAND — a pickup-order page with no hours block).

## Building entries (OD-32 amendment)

Four building-hours pages, read once more for this revision. Each entry has `status: "OK"`, `pageDate: null`, `basis: "undated-official"`, `note: "店舗により異なる場合あり"`, and `hoursText` as printed — the 館営業時間 line(s) including printed exceptions (restaurant floors; for NEWoMan the エキナカ／フードホール／エキソト blocks), stopping before the per-shop `営業時間の異なるショップ` list. Service-counter lines (ルミネカードカウンター受付, 免税カウンター) were not treated as 館営業時間 and are not included.

| Building | Page | Printed hours (full text in the JSON) |
| --- | --- | --- |
| ルミネエスト新宿 | `https://www.lumine.ne.jp/est/information/hours/` | `ショッピング 平日 11:00 ～ 21:00 土日祝 10:30 ～ 21:00 レストラン 平日/土日祝 11:00 ～ 22:00` |
| ルミネ新宿 | `https://www.lumine.ne.jp/shinjuku/information/hours/` | `ショッピング 11:00 ～ 21:00 ルミネ1-7F レストラン 11:00 ～ 22:30` |
| ニュウマン新宿 | `https://www.newoman.jp/shinjuku/information/hours/` | `ショッピング 月～土 11:00 ～ 20:30 … フードホール 7:00～23:00 エキソト 7:00～23:00` |
| 小田急百貨店 新宿店 | `https://www.odakyu-dept.co.jp/shinjuku/hour_acces/` | `■地下2階～2階 10：00→20：30 ※日曜・祝日は20：00まで ■7階 10：00→20：00 … ※その他、一部の売場やカフェは営業時間が異なる場合があります。` |

小田急百貨店 新宿店 had no building entry before the amendment; one was added (`poiId: null`). The department-store POI itself (`shop-sjk-odakyudept`) is unchanged and stays UNKNOWN.

## OD-32 amendment rules (2026-10-24)

- Display wording: 「GT-Eki 確認日 2026-10-24 時点の公式表記。変更されている場合があります」 with the official page linked.
- Undated official hours are hidden or re-checked after 180 days.
- Precedence: **merchant-stated > dated official > undated official**.

## Why the rest are UNKNOWN

- **Toei Shinjuku (1, `page unreadable`).** `www.kotsu.metro.tokyo.jp` returns a 200 page that is an Incapsula bot-challenge shell (no content) to both curl and WebFetch. GAP; no workaround attempted.
- **Tokyo Metro (4, `no date`).** curl gets 403; the Lead's instruction keeps 403 and bot challenges as GAPs, so these were not backfilled. (The shop index was readable once through WebFetch and prints per-shop hours, no date — available if the Lead wants it recorded under the amendment.)
- **Toei Nishi-guchi CSV (1, `no date`).** The CSV's 営業時間 column prints `7:00～23:00` for the FamilyMart row, but the Lead's instruction keeps Toei out of this pass; it is also a CSV, not a shop detail page.
- **LUMINE EST (2, `no hours printed`).** All 245 detail pages are now read; two print no hours line (リズリサ, MIZUNO SPORTSTYLE).
- **Odakyu Department Store POI (1, `date older than 2026-04-27`).** `hour_acces/` prints the building hours, but the only date on the page is `2025年1月15日` (a parking-change notice). The building-level hours are recorded on the building entry; the POI entry is left unchanged.
- **PRESS BUTTER SAND (1, `no hours printed`).** A pickup-order page with no hours block; its only date (`2026年10月25日`) is the shortest pickup slot.

## GAPs

1. `https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html` — bot challenge, unreadable (1 POI).
2. `https://www.tokyometro.jp/station/shinjuku/shop/index.html` — 403 to curl; readable via WebFetch but kept as a GAP per instruction.
3. `https://www.odakyu-dept.co.jp/shinjuku/information/` — 403; not needed, the hours page `hour_acces/` answered instead.

## Batch 2 result

All 191 remaining LUMINE EST detail pages were read (191 loads, HTTP 200 each). 189 print an hours line and are recorded as undated official; 2 print none (`shop-sjk-lumineest-002520` リズリサ, `shop-sjk-lumineest-003453` MIZUNO SPORTSTYLE). Nothing is left to read for LUMINE EST.

Still outstanding across the batch, for whoever picks it up:

- 4 Tokyo Metro shops — curl 403, stays a GAP per instruction.
- 1 Toei Shinjuku shop — bot challenge, stays a GAP.
- 1 Toei Nishi-guchi CSV row — readable, prints hours, no date; not a shop detail page.
- `shop-sjk-rec-011` (PRESS BUTTER SAND) — its page prints no hours.
- `shop-sjk-odakyudept` — its hours are on the building entry; the POI entry is unchanged.

## Totals

602 entries = 598 POI entries (one per POI in scope) + 4 building entries.
OK 586 (585 undated official + 1 dated) · UNKNOWN 16 (no hours printed 9, no date 5, date older than 2026-04-27 1, page unreadable 1).
JSON parses (`json.load`), all `poiId`s unique, 598 POIs covered exactly once, all ids present at the current head of their source file.
