# Transcription log — Ikebukuro merchant batch 2

Read with the plain-text web reader; source read timestamps recorded as 2026-10-24T02:56:55Z (UTC). Directory names were transcribed as printed. No descriptions, hours, images, maps, logos, or layouts were copied. Zones are copied as printed. ISP's leading category marker 薬 is dropped from マツモトキヨシ as required; no other category markers were treated as part of names.

## 池袋ショッピングパーク (ISP)

- Directory page read: https://www.web-isp.co.jp/floorguide/ — 2026-10-24T02:56:55Z (UTC; page listing all zones).
- Shop detail links followed from the listing in page order in the same session on 2026-10-24 (UTC), using `https://www.web-isp.co.jp/floorguide/detail/?cd=<code>`; codes are embedded in each imported ID. All linked detail pages returned except `cd=000092`, which timed out twice during the session; its exact listing name and detail URL code were visible on the directory page/link.
- Listed 55; imported 53; skipped 2 (マツモトキヨシ, スターバックス コーヒー 南館店; retained in batch 1); excluded 0.
- Non-shop facilities: none in the shop listing; none imported from outside it.
- Name uncertainty: none. The name はなまるダイニングセレクト and code 000092 were visible on the source listing/link; its detail page was not retrievable after two attempts.

## 東武ホープセンター

- South zone page read: https://tobuhopecenter.jp/floorguide/south-zone/ — 2026-10-24T02:56:55Z (UTC).
- Center zone page read: https://tobuhopecenter.jp/floorguide/center-zone/ — 2026-10-24T02:56:55Z (UTC).
- North zone page read: https://tobuhopecenter.jp/floorguide/north-zone/ — 2026-10-24T02:56:55Z (UTC).
- Listed 43; imported 43; skipped 0; excluded 0. Pages present shop lists only; the separate facility/service links (toilets, ATMs, lockers, information, parking) were not in the shop listings and were not imported.
- No store code was printed in the directory links, so IDs use the required `shop-ikb-hope-<NNN>` sequence, in page order across South, Center, then North zones (001–043).
- Name uncertainty: none.

## Echika池袋

- Main directory and shop list read: https://www.metropro-sc.jp/echika-ikebukuro/ — 2026-10-24T02:56:55Z (UTC).
- Shop detail pages followed via `https://www.metropro-sc.jp/echika-ikebukuro/shop/index.jsp?bf=1&fmt=6&shopid=<shopid>` in the same session on 2026-10-24 (UTC); each `shopid` is recorded in its ID.
- Listed 26; imported 23; skipped 3 (Patio de METRO, Tabio; retained in batch 1; Soup Stock Tokyo, shopid 1099, skipped by the lead as a likely duplicate of batch 1 `shop-ikb-mr-001`, which comes from the Tokyo Metro shop page and has no area); excluded 0.
- Non-shop facilities: none in the shop listing.
- Name uncertainty: none.

## Lead review (2026-10-24)

- All 119 names were found verbatim on the directory pages (100% name check, beyond the 20% spot-check); every ISP `cd` and Echika `shopid` in an ID appears on the source page.
- All 8 kana aliases (Echika) were found verbatim on their shop detail pages.
- `evidence.method` set per source: OD-23/OD-31 for ISP and Echika, OD-23/OD-33 for Hope Center.
