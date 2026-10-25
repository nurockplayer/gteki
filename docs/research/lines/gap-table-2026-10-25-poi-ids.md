# POI IDs researched but not in `pois.json` or the graph (2026-10-25)

Companion to [`gap-table-2026-10-25.md`](gap-table-2026-10-25.md). Basis `origin/main` `cc4fb010`. Every row below was checked against `stations/<id>/gteki/pois.json`: no ID is present.

## Shinjuku — WP4, 45 POIs, ready-to-import

File: [`shinjuku-line-pois-wp4.json`](shinjuku-line-pois-wp4.json) (research merged in #421). Rights cleared: Metro OD-34 §2, Toei OD-01 A. Target writer: sjk-search-78.

- Metro M08 gates (2): `poi:tokyometro-gate:3`, `poi:tokyometro-gate:4` — names may duplicate the S03 pair `poi:tokyometro-gate:1/:2`; identity unconfirmed (WP4 notes).
- Metro M08 / M08 exits, 28: `poi:tokyometro-exit:a6` … `a18`, `b5` … `b18` (incl. `b12a`, `b12b`).
- Metro M08 lifts (4): `poi:tokyometro-lift:1` … `:4`.
- Metro M08 escalators (2): `poi:tokyometro-escalator:1`, `:2`.
- Toei S01 exits, 9: `poi:toei-exit:a1`, `poi:toei-exit:1` … `:8` (1 and 2 printed closed; three carry 京王新線口, three 新都心口).

## Ikebukuro — WP11 Seibu platforms, 7 POIs, ready-to-import

File: [`transfer-facts-wp11.json`](transfer-facts-wp11.json) `newPois` (research merged in #452; rights OD-25, facts only). Platform legend read from the Seibu station map dated 2026-08-01; 1, 4 and 6 are alighting-only. Target writer: ikb-route-15.

`seibu-platform-1`, `seibu-platform-2`, `seibu-platform-3`, `seibu-platform-4`, `seibu-platform-5`, `seibu-platform-6`, `seibu-platform-7`

## No transfer POIs pending

WP11's 72 transfer facts carry no gate, passage or exit name (`viaLabels` empty by design), so they produce no POI. The gate-level names exist only inside operator diagrams; a follow-up needs a reader that can view `figure_platform_f09_a.png` and the Toei 構内図.

## Not researched, therefore not listed

Platform numbers for JR/Tobu/Seibu (Ikebukuro), Metro M25/Y09/F09, Keio, S01, M08 and E27 are printed in no usable text page (WP2/WP4 `notFound`). They are NONE, not ready-to-import.
