# Ikebukuro shop hours batch 1 — transcription log (OD-32, amended)

Facts only. Output: `ikebukuro-hours-batch1.json`. Hours are recorded only from the official page
that prints them, for the source the POI already cites; nothing is inferred from another page, a
building-wide default, or memory. No current status is asserted.

## Method

- Worktree `.claude/worktrees/ds-research`, branch `ds/ikebukuro-hours-batch1` from `origin/main`
  (`70bdc305`).
- Scope read from the research files at the heads of their branches (verified 2026-10-24; every
  `poiId` re-confirmed present at the latest head):
  - `claude/data-research-ikb-merchants-batch2` `9cd35158` — `ikebukuro-merchants-batch2.json`
    (118 POIs), `ikebukuro-merchants-batch3.json` (2 POIs)
  - `claude/data-research-ikb-merchants-batch4` `b3fb248f` — `ikebukuro-merchants-batch4.json`
    (210 POIs)
  - `ds/ikb-merchants-batch5-seibu` `320975ab` — `ikebukuro-merchants-batch5.json` (13 POIs)
  - 343 POIs in total; 343 entries, each id used once.
- Fetch: plain `curl -sL`, default UA, no custom headers, no referer, sequential, ≥0.6 s between
  requests, no browser, no JavaScript execution, no workaround attempted for 403. HTML parsed in
  memory; no pages saved.
- 367 page loads in total: 11 parser samples, 298 per-POI pages, 2 inspection fetches, 10
  エソラ池袋/ホープセンター pages, 46 Lumine re-reads. This is 1 over the 366 the director approved
  (one page, `scd=000530`, was fetched twice); reported here.
- Hours text is copied as printed. Runs of whitespace are normalised to one space and `<br>` to a
  newline; full-width characters (`～`, `：`, `※`, `〈〉`) are kept.
- Sampled reading (director ruling, seed `20261024`): 20 POIs drawn at random from the 343. The
  per-POI read had already completed before the ruling arrived, so the full classification below
  is reported rather than the sample rate alone.

## OD-32 amendment (director, 2026-10-24)

- Hours printed on **undated** official pages may now be recorded, both building-level and per
  shop, for sources cleared by OD-34. Those entries carry `"basis":"undated-official"` and
  `pageDate: null`.
- A dated notice counts only if the notice itself is about hours (営業時間/休業/変更) and is
  ≤180 days old. No entry in this batch ends up relying on a dated notice: エソラ池袋's
  site-wide notices were judged not to date individual shops' hours, so all its entries are
  `undated-official` with `pageDate: null`.
- Display wording for the station writer (not stored in the JSON):
  「<hoursText>（GT-Eki 確認日 2026-10-24 時点の公式表記。変更されている場合があります）」,
  with a link to the entry's `url` (official page).
- Refresh: hide or re-check undated entries after 180 days — i.e. by **2027-04-22**.
- Precedence: merchant-provided > dated official > undated official.
- Building entries use `"note":"店舗により異なる場合あり"` when the building hours page prints
  館営業時間.

## Per-site counts (POIs)

| Source | POIs | OK (undated-official) | no hours printed | page unreadable |
| --- | --- | --- | --- | --- |
| isp-floorguide-2026-10 (池袋ショッピングパーク) | 53 | 53 | 0 | 0 |
| tobuhopecenter-floorguide-2026-10 (東武ホープセンター) | 43 | 43 | 0 | 0 |
| echika-ikebukuro-2026-10 (エチカ池袋) | 22 | 22 | 0 | 0 |
| lumine-ikebukuro-floorguide-2026-10 (ルミネ池袋) | 176 | 176 | 0 | 0 |
| esola-ikebukuro-floorguide-2026-10 (エソラ池袋) | 33 | 33 | 0 | 0 |
| tobu-dept-ikebukuro-2026-10 (東武百貨店 池袋店) | 1 | 0 | 1 | 0 |
| seibu-shop-ikebukuro-2026-10 (エミオ池袋) | 11 | 11 | 0 | 0 |
| seibu-shop-ikebukuro-station-2026-10 (西武池袋駅) | 2 | 2 | 0 | 0 |
| tokyometro-ikebukuro-shops-2026-10 | 2 | 0 | 0 | 2 |
| **Total POIs** | **343** | **340** | **1** | **2** |

## Building entries (poiId null)

| Building | Source | Status | hoursText (as printed) |
| --- | --- | --- | --- |
| 池袋ショッピングパーク | isp-floorguide-2026-10 | OK, undated-official | 全館 10:00～21:00（月～土） / 10:00～19:30（日・祝） |
| 東武ホープセンター | tobuhopecenter-floorguide-2026-10 | OK, undated-official | 10:00～21:00 |
| エチカ池袋 | echika-ikebukuro-2026-10 | UNKNOWN — no hours printed | — (page says hours differ by shop and points to a PDF list) |
| エソラ池袋 | esola-ikebukuro-floorguide-2026-10 | OK, undated-official | ショップ 10:30～21:30 / レストラン 11:00～23:00 / ※店舗により一部異なります |
| ルミネ池袋 | lumine-ikebukuro-floorguide-2026-10 | OK, undated-official | B1～7F ショッピング 11:00～21:00 / 8F～9F レストラン 11:00～22:00 |
| エミオ池袋 | seibu-shop-ikebukuro-2026-10 | UNKNOWN — no hours printed | — (listing prints per-shop hours only) |

All four OK building entries carry `"note":"店舗により異なる場合あり"`.

**Totals: 349 entries — 344 OK (all `undated-official`, `pageDate` null), 5 UNKNOWN
(3 `no hours printed`, 2 `page unreadable (403)`).**

## How the undated hours were read

- 池袋ショッピングパーク: each shop's detail page, `営業時間` block (`月～土 10：00～21：00 /
  日・祝 10：00～19：30 / ※館営業時間に準ずる`). Building hours from `/facilities/` (全館).
- 東武ホープセンター: the three zone pages' per-shop `営業時間` table rows; no per-POI fetch.
  Building hours from the top page (`10:00～21:00`).
- エチカ池袋: each shop's detail page (`10:00-21:00` style).
- ルミネ池袋: each shop's detail page. Fashion shops print weekday/weekend rows
  (`平日 11:00 ~ 21:00 / 土日祝 11:00 ~ 21:00`); restaurants print a single range. Building hours
  from `/ikebukuro/information/hours/`.
- エソラ池袋: the printed `営業時間` cell of each shop's floor table
  (`/esola-ikebukuro/shop/floor.jsp?fid=…`), matched by `shopid`; all 33 names matched the
  research files exactly. Building hours from `/esola-ikebukuro/shop/hours.jsp`.
- エミオ池袋 / 西武池袋駅: each shop's detail page (`6:30A.M.～10:45P.M.` style).
- 東武百貨店 池袋店: the cited top page prints no hours at all → `no hours printed`.
- 東武ホープセンター's zone pages and every other site carry no date tied to hours.

## GAPs

- `https://www.tokyometro.jp/station/ikebukuro/shop/index.html` returns **403** (Akamai) to plain
  curl, twice. Not worked around. Its 2 POIs are `UNKNOWN`, reason `page unreadable (403)`.
- エチカ池袋 and エミオ池袋 print no 館営業時間 on any page read (エチカ points to a dated PDF
  list instead); their building entries stay `UNKNOWN`.
- 東武百貨店 池袋店: the cited page prints no hours; kept `UNKNOWN`.

## Notes for the Lead

- `tobu-dept.jp` was read; the director cleared it (東武百貨店 is a separate company from
  東武鉄道, OD-34). Only `tobu.co.jp` is excluded.
- The 東武百貨店 池袋店 POI stays a POI entry, not a building entry.
- ホープセンター POIs were not fetched one by one: their entries point at the zone page
  (south / center / north) they were transcribed from, which prints per-shop hours.
- No browser, no JavaScript, no oracle/LLM tool, no contact with anyone, no rights decision made.
- Retrieval times are UTC, recorded per entry (pages read between 2026-10-24T11:46Z and
  2026-10-24T11:58Z).

## Addendum 2026-10-25 — the five batch-1 POIs (`ikebukuro-merchants.sample.json`)

Lead request: add printed hours for `shop-ikb-mr-001` … `shop-ikb-mr-005`, which had no entry in
the 349 above. Branch `docs/ikb-mr-hours` from `origin/main` (`a126b33b`). Fetch as above: plain
`curl`, default UA, sequential, ≥0.6 s apart; 16 responses in total (10 sampled on the earlier
sitting, 6 between 03:32Z and 03:36Z), all HTTP 200, no workaround attempted.

| POI | Shop (research file) | Source | Page | Status | hoursText (as printed) |
| --- | --- | --- | --- | --- | --- |
| `shop-ikb-mr-001` | Soup Stock Tokyo | echika-ikebukuro-2026-10 | `shopid=1099` | OK, undated-official | 8:00-23:00〈LO.22:30〉 |
| `shop-ikb-mr-002` | Patio de METRO | echika-ikebukuro-2026-10 | `shopid=1110` | OK, undated-official | 9:00-21:30 |
| `shop-ikb-mr-003` | Tabio | echika-ikebukuro-2026-10 | `shopid=1103` | OK, undated-official | 10:00-21:00 |
| `shop-ikb-mr-004` | マツモトキヨシ | isp-floorguide-2026-10 | `cd=000088` | OK, undated-official | 月～土 10：00～21：00 / 日・祝 10：00～19：30 / ※館営業時間に準ずる |
| `shop-ikb-mr-005` | スターバックス コーヒー 南館店 | isp-floorguide-2026-10 | `cd=000064` | OK, undated-official | 毎日 7:00～22:30 |

- The three Metro-page POIs have no page of their own (that page is 403, above). Each was matched
  to an Echika shop page by name; `shopid=1099` is confirmed by the phone number it prints
  (`03-5952-5707`), identical to the chain's own エチカ池袋店 page. `shopid=1110` and `shopid=1103`
  print the names Patio de METRO and Tabio.
- ISP pages print the 南館 zone label and the shop's own name; no inference from the 全館 hours.
- `shop-ikb-mr-001` carries `"note":"エチカ池袋店（改札外）として表示。POI の区画は未記入"`: the POI
  records no area, the hours belong to the Echika shop.
- Chain page `soup-stock-tokyo.com/store/detail/?id=1058` was read as a cross-check only (平日・土・
  日・祝 all `08:00 - 23:00 (ラストオーダー22:30)`, `定休日 無休`) and is **not** cited by any entry:
  the site exposes no 利用規約/サイトポリシー page (footer links only プライバシーポリシー and
  カスタマーハラスメントポリシー; `robots.txt` allows `/store/`). Its rights status is therefore
  no recorded terms — a decision for the Lead, not made here. No ban was printed, so nothing is
  reproduced and no page text is copied.
- The same chain lists a separate ルミネ池袋店 (`id=1069`, 11:00-22:00, Lumine 8F). It is not the
  station-concourse shop and its hours are not recorded against `shop-ikb-mr-001`.
- Every page read here is undated. The chain detail page carries JSON-LD `datePublished`
  2018-10-16, which is not a printed content date and is not used.

**Totals after the addendum: 354 entries — 349 OK (all `undated-official`, `pageDate` null),
5 UNKNOWN (unchanged; the 2 Metro-page 403s, 東武百貨店 no hours, エチカ池袋 and エミオ池袋
building rows).**

### GAPs raised by this addendum

- `soup-stock-tokyo.com` has no terms page to read: its rights class is unrecorded. Any later use
  of it as a source needs a Lead ruling first (OD-34).
- The batch-1 POIs are keyed by `shop-ikb-mr-00x`; `ikebukuro-merchants-batch3-log.md` says its own
  imports were numbered `shop-ikb-mr-001 to 007`, while the committed `ikebukuro-merchants-batch3.json`
  uses `shop-ikb-metro-001` and `shop-ikb-metro-002`. The hours file's two UNKNOWN rows follow the
  JSON. The log line is stale — left untouched here.
- This log writes `tobuhopecenter-floorguide-2026-10`; the JSON uses
  `tobu-hopecenter-floorguide-2026-10`. One of the two is wrong for joins — left untouched here.
