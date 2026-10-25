# Ikebukuro hours batch 2 — facility and station hours (OD-32 as amended)

Facts only. Output: `ikebukuro-hours-batch2.json`. Scope: the 168 POIs in
`stations/ikebukuro/data/graph.src.json` at `origin/main` (`883f6e69`) that batch 1
(`ikebukuro-hours-batch1.json`, 348 shops + 6 building rows) does not cover. Batch 1 is the import
tracked by #486. Nothing is inferred from another page, a building-wide default, or memory, and no
current status is asserted.

## Method

- Worktree `.claude/worktrees/ds-research`, branch `ds/ikb-hours-batch2` from `origin/main`
  (`883f6e69`).
- 516 graph POIs − 348 shops batch 1 covers = **168 POIs** in scope (exits 53, ticket gates 16,
  service 29, toilets 23, escalators 14, ATM 12, elevators 7, lockers 7, other 7).
- For each POI the page its cited source records was checked for hours for that facility. Nothing
  is fetched per POI when the source is one page: the page lists all of its facilities at once.
- Fetch: plain `curl -sSL`, **default User-Agent**, no custom headers, sequential, 0.7 s between
  requests, **12 requests** (limit 150). No browser, no JavaScript, no workaround attempted for
  403. HTML was parsed in memory; no page is kept.
- Hours text is copied as printed; runs of whitespace are normalised to one space. Full-width
  characters (`～`, `：`, `※`, `〈〉`) are kept.
- `basis` is `undated-official` with `pageDate: null` unless the page's dated notice is about
  hours. None of the pages read prints a date at all, so no entry relies on a dated notice.
- Where the page prints no hours for the facility, no entry is made and no hours are inferred
  from the building's hours.

## Pages read (2026-10-25, UTC)

| Source | Page | Time | HTTP | Result |
| --- | --- | --- | --- | --- |
| `lumine-ikebukuro-facilities-2026-10` | https://www.lumine.ne.jp/ikebukuro/information/ | 05:23:12Z | 200 | 1 counter time + 2 printed statements |
| `esola-ikebukuro-facilities-{3f,4f,6f,7f,8f}-2026-10` | https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=3f … `fid=8f` | 05:23:13–19Z | 200 | floor tables; no hours for the facility rows |
| `tobudept-ikebukuro-facilities-2026-10` | https://www.tobu-dept.jp/ikebukuro/information/detail/6 | 05:23:20Z | 200 | no hours for the facilities |
| `tobudept-ikebukuro-facilities-kids-2026-10` | https://www.tobu-dept.jp/ikebukuro/information/detail/7 | 05:23:21Z | 200 | no hours for ベビー休憩室 |
| `tobudept-ikebukuro-facilities-access-2026-10` | https://www.tobu-dept.jp/ikebukuro/information/detail/8 | 05:23:22Z | 200 | no hours for バリアフリートイレ |
| `tokyometro-ikebukuro-shops-2026-10` | https://www.tokyometro.jp/station/ikebukuro/shop/index.html | 05:23:23Z | **403** | GAP |
| `tokyometro-ikebukuro-accessibility-2026-10` | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | 05:23:23Z | **403** | GAP |
| `seibu-ikebukuro-station-2026-10` | https://www.seiburailway.jp/railway/station/ikebukuro/ | 05:23:24Z | 200 | 駅施設の営業時間 section |

## Entries (5 OK, all `undated-official`, `pageDate` null)

| POI | Facility | Source | hoursText (as printed) |
| --- | --- | --- | --- |
| `service-ikb-lumine-001` | ルミネ池袋 B1 インフォメーション | `lumine-ikebukuro-facilities-2026-10` | `11:00～21:00` (受付時間) |
| `toilet-ikb-lumine-001` | ルミネ池袋 8F 多目的トイレ | `lumine-ikebukuro-facilities-2026-10` | `ご利用時間は営業時間に準ずる` |
| `toilet-ikb-lumine-002` | ルミネ池袋 10F 多目的トイレ | `lumine-ikebukuro-facilities-2026-10` | `ご利用時間は営業時間に準ずる` |
| `service-ikb-seibu-003` | 西武鉄道 池袋駅 お忘れ物取扱所（西武南口） | `seibu-ikebukuro-station-2026-10` | `7:00～22:30` |
| `seibu-minami-guchi` | 西武南口 | `seibu-ikebukuro-station-2026-10` | `7:00～22:30` |

- The two 多目的トイレ rows carry the page's own statement, not a numeric time. The building's
  11:00–21:00 hours (batch 1) are **not** copied into them.
- The ルミネ池袋 授乳室 rows (6F TULLY'S COFFEE with U内, 8F) print their floors but no hours; they
  are skipped, not given the building hours.
- 西武南口 is an exit-like POI whose source page does print a time in 駅施設の営業時間; it is the
  only such POI in the skipped exit/gate group.

## GAP (56 POIs)

- `https://www.tokyometro.jp/station/ikebukuro/shop/index.html` returns **403** to plain curl.
  Its 28 POIs (14 services, 12 ATMs, 2 lockers) stay without hours.
- `https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html` also returns **403**.
  Its 28 POIs (3 toilets, 14 escalators, 7 elevators, 4 ticket gates) stay without hours.
- Not worked around; recorded as GAP, as in batch 1.

## Skipped (107 POIs)

- **71 exit, gate and passage POIs**: the cited sources (Tokyo Metro yard maps and print yard map,
  豊島区 underground guide and sign guideline, PLATEAU) are maps or directories that print no
  hours for them. No page fetch was spent on them beyond the map pages already read for the data.
- **36 facility POIs whose page prints no hours for the facility**: ルミネ池袋 授乳室 ×2,
  エソラ池袋 授乳室/トイレ ×7, 東武百貨店 店内案内所/AED/コインロッカー/ベビー休憩室/バリアフリートイレ
  ×25, 西武鉄道 AED ×2.

**Totals: 168 POIs — 5 OK, 56 GAP (403), 107 skipped.**

## Assumptions

- **Seibu Railway page.** The brief lists "Seibu shop portal" under the usable operators. The six
  Seibu POIs cite `seiburailway.jp`, which the repo already uses facts-only under OD-25
  (`docs/research/facilities/facilities-batch3-log.md`) and which the graph source records as
  `facts-only, REFERENCE_ONLY`. The two printed rows are recorded from that page on that basis. If
  the lead wants only `seibu-shop.jp`, drop `service-ikb-seibu-003` and `seibu-minami-guchi`.
- **LUMINE toilets.** 「ご利用時間は営業時間に準ずる」 is recorded as printed; no numeric hours are
  written.
- **Tokyo Metro 403.** The GAP covers both the shop page (services, ATMs, lockers) and the
  barrier-free page (toilets, escalators, elevators, gates); no alternate URL was tried.
- **Pages with no dates.** The LUMINE and Seibu pages print no content date, and none of the pages
  read carries a dated notice about hours, so every entry is `undated-official` with
  `pageDate: null`.
