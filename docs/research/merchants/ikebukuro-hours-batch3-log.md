# Ikebukuro hours batch 3 — 西武池袋本店 store hours (OD-32)

Facts only. Output: `ikebukuro-hours-batch3.json`. Scope: the one POI
`shop-ikb-seibu-honten` (西武池袋本店) in `stations/ikebukuro/data/graph.src.json`. The store's own
page is the only source; nothing is inferred from another site, a building default or memory, and
no current status is asserted.

## Rights

そごう・西武's site terms ban business or profit use only (§2(8)). Under OD-35 (see
`docs/research/use-tiers.md` and #578) Sogo-Seibu is **facts only, `recheck-at-C`**; hours are
facts. OD-32 rules apply: only the store's own page. The page prints no date, so the entry is
`basis: "undated-official"` with `pageDate: null`.

## Method

- Worktree `.claude/worktrees/ds-flash`, branch `data/ikb-seibu-hours` from `origin/main`
  (`6cb7d2df`).
- Fetch: plain `curl -sSL`, **default User-Agent**, no custom headers, sequential. The first
  request was made without `-L` to record the 301, then the same URL with `-L`; both are logged.
  HTML was parsed in memory; no page is kept.
- Hours text is copied as printed; runs of whitespace are normalised to one space. Full-width
  characters (`～`, `＝`, `［］`) are kept.
- The page prints no date and carries no notice about the store's own hours, so
  `basis: "undated-official"` and `pageDate: null`. (The linked 営業時間変更売場のお知らせ page's
  dated notices are floor-specific; see `note`.)

## Pages read (UTC, fetched 2026-11-01; = 2026-11-02 JST)

| # | Request | Time (UTC) | HTTP | Bytes | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET https://www.sogo-seibu.jp/ikebukuro/` (no `-L`) | 2026-11-01T21:53:23Z | **301** | 0 | `Location: https://www.sogo-seibu.jp/ikebukuro` |
| 2 | `GET https://www.sogo-seibu.jp/ikebukuro/` (`-L`, follows 301) | 2026-11-01T21:53:28Z–21:53:29Z | 200 | 1,248,431 | top page; link to `/ikebukuro/opening-hours` |
| 3 | `GET https://www.sogo-seibu.jp/ikebukuro/opening-hours` | 2026-11-01T21:53:43Z | 200 | 914,570 | **hours page** |
| 4 | `GET https://www.sogo-seibu.jp/ikebukuro/access` | 2026-11-01T21:53:44Z–21:53:45Z | 200 | 1,187,367 | no store hours (parking page only) |
| 5 | `GET https://www.sogo-seibu.jp/ikebukuro/topics/eigyojikan` (linked 営業時間変更売場のお知らせ) | 2026-11-01T21:54:12Z | 200 | 1,122,810 | floor-specific dated notices |

5 requests total (limit 150).

## Entry (1 OK)

| POI | Source | hoursText (as printed) |
| --- | --- | --- |
| `shop-ikb-seibu-honten` | `sogo-seibu-ikebukuro-opening-hours-2026-11` | `午前10時～午後8時` |

The hours page prints 「西武池袋本店 営業時間」 followed by 「午前10時～午後8時」. The same page
prints separate hours for individual floors (デパチカ, 日比谷花壇, 別館 tenant rows, 免税カウンター,
ルイ・ヴィトン, 池袋コミュニティ・カレッジ); they are kept as printed in the batch file's `note`,
not folded into the store-level `text`.

The access page (request 4) prints parking hours only (「営業時間：24時間駐車可能」 and a
10:00–20:00 receipt-counter time), not store hours; no entry is taken from it.

The linked notice page (request 5) restates the store-level 「午前10時～午後8時」 and prints
floor-specific changes: 3階＝コスメティックス エルメス・イン・カラー changed to 午前11時～午後7時
from 2026-09-30, and デパチカ from 2026-11-02. Those notices are about floors, not the store's own
hours, so they do not set `pageDate`; they are recorded in `note`.

## GAP

None.

## Assumptions

- **Store-level text.** `text` is the page's store-level line 「午前10時～午後8時」 only. Floors
  that print different hours keep them in `note`, as the brief asks; none of them overrides the
  store's `text`.
- **No page date.** The page prints no content date, and none of its dated notices is about the
  store's own hours, so the entry is `undated-official` with `pageDate: null`.
- **`retrievedAt`.** The fetch was 2026-11-01T21:53:43Z (2026-11-02 06:53 JST). The batch entry
  keeps the UTC timestamp; the POI's date-only `hours.retrievedAt` is `2026-11-01`, the UTC date
  part of that timestamp.
