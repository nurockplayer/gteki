# POI IDs researched but not in `pois.json` or the graph (2026-10-25, updated 2026-10-26)

Companion to [`gap-table-2026-10-25.md`](gap-table-2026-10-25.md). Basis `origin/main` `2e7323c0` (2026-10-26 02:11 JST). Every row below was checked against `stations/<id>/gteki/pois.json`: **all of them are now shipped with these IDs except the two held M08 gates**. Do not import the shipped IDs again.

## Shinjuku — WP4, 43 POIs shipped (#509) + 2 gates held

File: [`shinjuku-line-pois-wp4.json`](shinjuku-line-pois-wp4.json) (research merged in #421). Rights cleared: Metro OD-34 §2, Toei OD-01 A. Shipped in #509 as search-only POIs (no position, no connector).

- **Held:** Metro M08 gates (2): `poi:tokyometro-gate:3`, `poi:tokyometro-gate:4` — both may be the same physical gates as the shipped S03 pair `poi:tokyometro-gate:1/:2`; identity is unconfirmed, so import them only after the WP10 field check, or they become duplicate gate results.
- Metro M08 exits, 28: `poi:tokyometro-exit:a6` … `a18`, `b5` … `b18` (incl. `b12a`, `b12b`) — shipped. 7 are printed closed and 13 carry a time limit (WP4 notes).
- Metro M08 lifts (4): `poi:tokyometro-lift:1` … `:4` — shipped.
- Metro M08 escalators (2): `poi:tokyometro-escalator:1`, `:2` — shipped.
- Toei 新宿 station exits, 9: `poi:toei-exit:a1`, `poi:toei-exit:1` … `:8` — shipped. The source prints one station-level list and does not say which exits belong to S01 and which to E27, so line affiliation is unverified. Exits 1 and 2 are printed 閉鎖中; three carry 京王新線口 and three 新都心口. None is routable.

## Ikebukuro — WP11 Seibu platforms, 7 POIs, shipped (#506)

File: [`transfer-facts-wp11.json`](transfer-facts-wp11.json) `newPois` (research merged in #452; rights OD-25, facts only). Platform legend read from the Seibu station map dated 2026-08-01; 1, 4 and 6 are alighting-only. Shipped search-only in #506.

`seibu-platform-1`, `seibu-platform-2`, `seibu-platform-3`, `seibu-platform-4`, `seibu-platform-5`, `seibu-platform-6`, `seibu-platform-7`

## No transfer POIs pending

WP11's 72 transfer facts carry no gate, passage or exit name (`viaLabels` empty by design), so they produce no POI. The gate-level names exist only inside operator diagrams; a follow-up needs a reader that can view `figure_platform_f09_a.png` and the Toei 構内図.

## Not researched, therefore not listed

Platform numbers for JR and Tobu (Ikebukuro) and for Metro M25/Y09/F09, Keio, S01, M08 and E27 are printed in no usable text page (WP2/WP4 `notFound`); Seibu's are the 7 above. They are NONE, not ready-to-import. E27 already ships one platform POI (`poi:platform:oedo`) without a printed number.
