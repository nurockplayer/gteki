# Ikebukuro shop hours batch 1 — transcription log (OD-32)

Facts only. Output: `ikebukuro-hours-batch1.json`. Hours are recorded only where the page that
prints them also prints a qualifying date; nothing is inferred from another page, a building-wide
default, or memory. No current status is asserted.

## Method

- Worktree `.claude/worktrees/ds-research`, branch `ds/ikebukuro-hours-batch1` from `origin/main`
  (`70bdc305`).
- Scope read from the research files at the heads of their branches
  (verified 2026-10-24 before building the output; every `poiId` re-confirmed present):
  - `claude/data-research-ikb-merchants-batch2` `9cd35158` — `ikebukuro-merchants-batch2.json`
    (118 POIs), `ikebukuro-merchants-batch3.json` (2 POIs)
  - `claude/data-research-ikb-merchants-batch4` `b3fb248f` — `ikebukuro-merchants-batch4.json`
    (210 POIs)
  - `ds/ikb-merchants-batch5-seibu` `320975ab` — `ikebukuro-merchants-batch5.json` (13 POIs)
  - 343 POIs in total; 343 entries, each id used once.
- Fetch: plain `curl -sL`, default UA, no custom headers, no referer, sequential with ~0.6 s
  between requests, no browser, no JavaScript execution. HTML parsed from the response in memory;
  no pages saved. **395 page loads** in total (cap 400).
- OD-32 gate as applied:
  - `OK` only when the page that prints the hours also prints a date on/after 2026-04-27.
  - Director ruling of 2026-10-24 applied: a date counts only if the notice it belongs to is
    itself about hours (営業時間/休業/変更) and is ≤180 days old. Other dated notices
    (shop news, product news, event notices) do not count — those POIs are `UNKNOWN` with reason
    `dated notice not about hours`.
  - No date at all on the page → `no date`.
- Hours text copied as printed, full-width characters kept; no prices, descriptions, images or
  last-order notes added beyond what the hours cell/line prints.
- Sampled reading (director ruling): seed `20261024`, 20 POIs drawn at random from the 343 →
  2 of 20 qualified (10%). Note: the per-POI page read had already completed before the ruling
  arrived, so the full per-POI classification below is reported rather than only the sample.

## Per-site counts (POIs)

| Source | POIs | OK | no date | dated notice not about hours | no hours printed | page unreadable |
| --- | --- | --- | --- | --- | --- | --- |
| isp-floorguide-2026-10 (池袋ショッピングパーク) | 53 | 0 | 46 | 7 | 0 | 0 |
| tobuhopecenter-floorguide-2026-10 (東武ホープセンター) | 43 | 0 | 43 | 0 | 0 | 0 |
| echika-ikebukuro-2026-10 (エチカ池袋) | 22 | 0 | 20 | 2 | 0 | 0 |
| lumine-ikebukuro-floorguide-2026-10 (ルミネ池袋) | 176 | 0 | 153 | 23 | 0 | 0 |
| esola-ikebukuro-floorguide-2026-10 (エソラ池袋) | 33 | 33 | 0 | 0 | 0 | 0 |
| tobu-dept-ikebukuro-2026-10 (東武百貨店 池袋店) | 1 | 0 | 0 | 0 | 1 | 0 |
| seibu-shop-ikebukuro-2026-10 (エミオ池袋) | 11 | 0 | 9 | 2 | 0 | 0 |
| seibu-shop-ikebukuro-station-2026-10 (西武池袋駅) | 2 | 0 | 2 | 0 | 0 | 0 |
| tokyometro-ikebukuro-shops-2026-10 | 2 | 0 | 0 | 0 | 0 | 2 |
| **Total POIs** | **343** | **33** | **273** | **34** | **1** | **2** |

## Building entries (poiId null)

| Building | Source | Status | Reason / pageDate |
| --- | --- | --- | --- |
| 池袋ショッピングパーク | isp-floorguide-2026-10 | UNKNOWN | no date (`/facilities/` prints 全館 10:00～21:00（月～土） / 10:00～19:30（日・祝）, no date) |
| 東武ホープセンター | tobuhopecenter-floorguide-2026-10 | UNKNOWN | dated notice not about hours (top page prints 営業時間 10:00～21:00; its dates are event/news only) |
| エチカ池袋 | echika-ikebukuro-2026-10 | UNKNOWN | no hours printed (`/shop/hours.jsp` says hours differ by shop and points to a PDF list) |
| エソラ池袋 | esola-ikebukuro-floorguide-2026-10 | OK | 2026-10-12 |
| ルミネ池袋 | lumine-ikebukuro-floorguide-2026-10 | UNKNOWN | no date (`/information/hours/` prints 館営業時間, no date) |
| エミオ池袋 | seibu-shop-ikebukuro-2026-10 | UNKNOWN | no hours printed (listing prints per-shop hours only) |

Totals including buildings: 349 entries — 34 OK, 315 UNKNOWN
(275 `no date`, 35 `dated notice not about hours`, 3 `no hours printed`, 2 `page unreadable (403)`).

## The one qualifying site: エソラ池袋

- Every エソラ池袋 shop/floor page and the 営業時間 page print a site-wide お知らせ block:
  - `2026-10-12` 設備工事に伴う一部休業店舗のお知らせ（3F）
  - `2026-05-27` 営業時間変更のお知らせ
- Both notices match the ruling's hours keywords (休業 / 営業時間・変更) and are ≤180 days old;
  the newest printed date, 2026-10-12, is recorded as `pageDate` for all 33 shop entries and the
  building entry.
- Per-shop hours were taken from the printed hours cell of the shop's floor table
  (`/esola-ikebukuro/shop/floor.jsp?fid=…`), which also carries the same dated notice block;
  the floor page read is the `url` recorded for each entry. Shop id → row matched by `shopid`;
  all 33 names matched the research files exactly.
- Caveat for the Lead: on sub-pages the script shows only the first notice item; the 2026-05-27
  item is present in the markup but hidden. The 2026-10-12 notice is about 3F construction
  closures, not about every shop's hours. If the Lead judges that a site-wide/3F notice does not
  vouch for a B1 shop's hours, all 33 エソラ池袋 entries and its building entry should be demoted
  to `UNKNOWN` (`dated notice not about hours`); the hours text itself is unaffected.

## GAPs

- `https://www.tokyometro.jp/station/ikebukuro/shop/index.html` returns **403** (Akamai) to plain
  curl, twice. Not worked around. The 2 POIs from that source are `UNKNOWN`,
  reason `page unreadable (403)`.
- Two URL patterns guessed from the site nav returned 404 and were replaced with the linked page:
  `/ikebukuro/hours/` → `/ikebukuro/information/hours/`; metropro `/hours/` → `/shop/hours.jsp`.
- 池袋ショッピングパーク pages print shop hours but no date anywhere; 東武ホープセンター zone pages
  print per-shop hours in tables but no date; ルミネ池袋 and 西武/エミオ pages print hours without
  dates. Their only dates are shop-news/product-news dates, which do not qualify under the ruling.

## Notes for the Lead

- `tobu-dept.jp` was read for the 東武百貨店 池袋店 POI. It is not on the brief's exclusion list
  (`tobu.co.jp` is), but it is the same company; flag for the rights review if that matters.
- The 東武百貨店 池袋店 POI is kept as a POI entry, not converted to a building entry. Its top page
  prints no hours at all.
- 東武ホープセンター POIs were not fetched one by one: the 43 entries point at the three zone pages
  (south / center / north) they were transcribed from; those pages print per-shop hours but no date.
- No browser, no JavaScript, no oracle/LLM tool, no contact with anyone, no rights decision made.
- Retrieval times are UTC. Pages read between 2026-10-24T11:36Z and 2026-10-24T11:48Z.
