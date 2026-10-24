# WP4 — Shinjuku line POIs from Tokyo Metro (M08) and Toei (S01 / E27)

Draft transcription for review by lines-lead. Data file: [`shinjuku-line-pois-wp4.json`](shinjuku-line-pois-wp4.json). Search-only: nothing here is routable, positioned, floored or claimed to be open.

## Counts

| Operator | ticket_gate | exit | elevator | escalator | total |
| --- | --- | --- | --- | --- | --- |
| Tokyo Metro (`tokyometro`) | 2 | 28 | 4 | 2 | 36 |
| Toei (`toei`) | 0 | 9 | 0 | 0 | 9 |
| **Total** | **2** | **37** | **4** | **2** | **45** |

- Metro exits: A6–A18 and B5–B18. 7 are printed as closed (A10, A11, A13, A14, A15, A18, B9); 13 carry the time-restriction asterisk. B12a is printed with a note that it has an elevator to street level.
- Toei exits: A1 and 1–8. 1 and 2 are printed as closed. Four exits print hours; three carry the 京王新線口 label and three the 新都心口 label; A1 carries the マインズタワー方面改札 label.
- Toei lifts and escalators have no POIs: the page prints only per-line counts (新宿線 escalators 14, elevators 1; 大江戸線 escalators 16, elevators 2) and that a step-free route is secured on both lines. Those facts are in the source entry's `notes`; no location was invented.

## Pages read

All four required pages needed the browser (read-only; no sign-in, forms or downloads). Plain HTTP was not attempted.

1. `https://www.tokyometro.jp/station/shinjuku/index.html` — exit list and transfer section. The exit table exists three times in the DOM (desktop, mobile, modal) and all three copies list the same 28 rows. No entries for another station were present: the page contains no string for the station named in the brief's warning. Browser required (JS tabs and modal).
2. `https://www.tokyometro.jp/station/shinjuku/accessibility/index.html` — lift and escalator locations by end pair, with 改札内 / 改札外. Browser required: the equipment table is rendered in-page and the locations sit inside tooltip lists.
3. `https://www.tokyometro.jp/station/shinjuku/yardmap/index_print.html` — printed exit table. Identical to page 1 (28 rows), so it served as the cross-check. Browser required only because the site blocks plain fetches.
4. `https://www.tokyometro.jp/station/line_marunouchi/position.html?station=shinjuku` — the のりかえ出口案内 page linked from page 1. Read but no facts taken: it has no textual exit or gate list, only station diagrams as images plus a station index. Not added as a source.
5. `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` — Toei exit list, hours, per-line barrier-free counts and step-free status. Browser required: the exit list is populated by script after opening 出入口一覧を表示. The per-exit coordinate feed was not read or recorded.

## Revision dates

- Metro station page: 改定日：2023年12月 (printed in the exit block) → `datasetDate` `2023-12`.
- Metro print page: 改定日：2023年12月 → `datasetDate` `2023-12`.
- Metro accessibility page: no revision date printed → `null`.
- Toei station page: no revision date printed; the only dated data is "各駅データ 2024年度" (ridership), which is unrelated → `datasetDate` `null`.

## Hours printed

Recorded in notes only, for the exact item they are printed for, with the required viewing sentence:

- Metro elevator 東改札～Ａ６番出入口: 6:00～23:00.
- Metro escalator（上り・下り）東改札～Ｂ１１番出入口: 6:00～23:00.
- Toei exits 4, 5, 6, 7: 6:00～23:00; exit 8: 7:00～23:00.

## notFound

- Tokyo Metro platform numbers (text pages show ホーム（池袋寄り） but no 番線 number).
- Toei platform numbers.
- Toei lift/escalator locations or end pairs (counts only).
- A Tokyo Metro gate list beyond the two names used as equipment endpoints.
- Metro exits A1–A5 and B1–B4: not printed anywhere; the table starts at A6 / B5.

## conflicts

None between the pages. Both Metro pages print the same 28 rows and the same revision date. One ambiguity for the lead, not a conflict:

- Metro and Toei both number exits with an A prefix. Metro prints A6–A18, Toei prints A1; the pages never relate the two systems, so Toei A1 must not be matched to any Metro exit.

## For lines-lead

- `poi:tokyometro-gate:3` (東改札) and `:4` (西改札) come from the accessibility page's equipment endpoints. PR #411 holds S03-sourced `poi:tokyometro-gate:1` (丸の内線 東口改札口) and `:2` (丸の内線 西口改札口). The wording differs (東改札 vs 東口改札口), so no `factsForExisting` entry was added and nothing was merged; the ids are kept distinct on purpose. Please decide whether they are the same gates.
- This file adds no facts for the existing E27 POIs in `stations/shinjuku/gteki/pois.json`. Toei's per-line counts cannot be attached to specific internal elevator ids without guessing.
- REUSE annotation is left to lines-lead.
