# 西武池袋本店 — facts-only source check (2026-10-26)

- **Question:** does a facts-only source print the name 西武池袋本店 (or as printed), its floors, and where it connects, so the store can become one search-only POI in `stations/ikebukuro`?
- **Answer:** **yes, the name.** 一般社団法人日本ショッピングセンター協会 (JCSC) prints 「西武池袋本店」 in its 2026年オープンSC（一覧表）, as a key tenant of LINKS IKEBUKURO (row 18, note 8; the list page itself prints no update date). The POI is `shop-ikb-seibu-honten`, search only.
- **Not printed by any facts-only source used here:** the store's floors, and a station connection/entrance. Both stay out of the POI (`floorId` null, no connector), and a connection is not inferred.
- **Rights:** JCSC's 2026 list page carries no use terms (its only policy page is the personal-data privacy policy), so facts only under OD-34 — the same ruling as the PARCO JCSC record (#512, 2026-10-25). 西武池袋本店's own site (Sogo & Seibu) is **corroboration only** under OD-34 r3 (business-purpose ban) and was not used as a source. Time zone: all times JST.

## 1. Sources that print the name

| # | Source | URL | Printed text (verbatim) | Date on the page | Read |
|---|---|---|---|---|---|
| A | JCSC 2026年オープンSC（一覧表） | `https://www.jcsc.or.jp/sc_data/sc_open/sc_list` | Row 18: 「6月30日」「ヨドバシカメラマルチメディア池袋、LINKS IKEBUKURO (注8)」「東京都豊島区南池袋1-28-1」「㈱ヨドバシ建物」「75,390」「ヨドバシカメラマルチメディア池袋、**西武池袋本店**」「93 (注9)」. Note 8: 「**西武池袋本店**、池袋ショッピングパークを含む。」 | none printed on the list page (the site-search result entry shows 2026/02/20 更新, but that is the search UI, not the page) | 2026-10-26 05:15 JST |
| B | 豊島区「池袋ターミナル案内サインガイドライン（案（草案）Ver1.3）」 | `https://www.city.toshima.lg.jp/documents/56546/20260519131956.pdf` | Glossary (PDF p56, printed p42): 「**西武池袋本店**  Seibu Ikebukuro Main Store」. Sign mock-up (PDF p30, printed p16) shows 「西武池袋本店」 with the 東口（中央） direction. | draft, 2026-03 (registered `datasetDate`) | 2026-10-26 05:17 JST |
| C | 豊島、もっと楽しく FUN 池袋 (2025年3月), PDF page 2 | `https://www.city.toshima.lg.jp/documents/55769/1_toshimafun_ja.pdf` | Prose: 「**東口には西武池袋本店**、池袋パルコ。」 | 2025-03 | 2026-10-26 05:17 JST |

B and C are already registered sources (`toshima-terminal-sign-guideline-draft-v1.3` and `identity-toshima-fun`, facts-only under #342 and OD-34). A is registered for this POI as `jcsc-ikebukuro-links-open-sc` (datasetDate null: no update date is printed on the list page; the year 2026 comes from the list title 「2026年オープンSC」).

## 2. Floors and connection

- **Floors:** not printed in A. B and C print no floor range for the store. The B2–8F range in the repo's closure research comes from trade press (S16, `diamond-rm.net`, terms unread) and from the store's own site (corroboration only under OD-34 r3); neither is usable as the POI's facts-only source, so the POI carries **no floors**.
- **Connection:** no facts-only source read here prints that the store is directly connected to the station. What the sources do print:
  - A places the store inside the LINKS IKEBUKURO complex (キーテナント; 東京都豊島区南池袋1-28-1). The row's 6月30日 opening date is the complex's, not the store's own opening date.
  - C places it on the **East Exit** side (「東口には…」).
  - B's exit mapping (資料3-3 p20) prints the East Exit entrances 37「西武東口」 and 38「西武口」 but **does not print the store name there** (exit-name source only, OD-22); its glossary and sign mock-ups do print the store name, but a mock-up is not route or position evidence.
- The POI therefore keeps `connectorNodeIds: []`, `displayPosition: null` and `floorId: null`, and refuses to route (search only).

## 3. Sources tried that did not print the store name

| Source | URL | Result |
|---|---|---|
| 西武鉄道 池袋駅 page (registered facts-only, OD-25) | `https://www.seiburailway.jp/railway/station/ikebukuro/` | 200, 63,220 B. No 西武池袋本店 / 百貨店. Its exit-like labels are 西武南口, 1F改札口付近 and B1F改札口付近; the station map is an image. No exit list page is linked (only バスのりば and 池袋駅の店舗情報). |
| 東京メトロ 池袋駅 page (Wayback, live 403 from this host) | `https://web.archive.org/web/20260329150449/https://www.tokyometro.jp/station/ikebukuro/index.html` | 200. Prints 西武鉄道 only (transfer line list). No store name. |
| 東京メトロ 池袋駅 バリアフリー設備 (Wayback) | `https://web.archive.org/web/20240206004404/https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html` | 200, 151,205 B decompressed. No 西武 / 百貨店 text. |
| 東京都交通局 (Toei) 池袋駅 page | `https://www.kotsu.metro.tokyo.jp/subway/stations/ikebukuro.html` (and `/ikebukuro/`) | 200 but an Incapsula JS challenge page (212 B, `_Incapsula_Resource`), no content — **GAP**. Wayback CDX returns no capture for this URL (tried `https://` prefix and the exact `http://` URL), so no Wayback fallback — **GAP**. |
| JCSC 全国SC一覧 (PDF) / SC別基礎データ一覧 | `https://www.jcsc.or.jp/data/basic.html` | Not used. The page states 「本データの利用は、SC協会会員の組織内における利用に限られます」 and the basic-data list is 会員限定; it is also login/member-gated, so nothing was fetched from it. The opening-SC list (A) is a separate page with no use terms. |
| 西武池袋本店 own site (Sogo & Seibu) | not fetched | Corroboration only under OD-34 r3; nothing copied. |

## 4. Rights check (JCSC)

- The JCSC 2026 list page's footer links only 「個人情報保護方針」; the page text has no 利用規約 / 著作権 / 無断転載 / 複製 clause (searched the fetched HTML). This is the same site state recorded for the PARCO record in #512 on 2026-10-25, so JCSC is facts-only under OD-34.
- The separate 全国SC一覧 page does carry a member-internal-use limitation (quoted above). It is a different page and dataset; it was not used.
- Adopted fact from A: the store name 「西武池袋本店」 only. The address, opening date and tenant count are recorded here as context, not copied into the POI as position or route evidence.

## 5. Fetch log

Own requests, in order (JST). Every request used curl's default User-Agent, no added headers, spaced ≥0.6 s apart; no login-gated page was fetched; no form, post or upload. `sha256` is the first 8 hex characters of the saved page.

| # | JST | Target | Status | Bytes | sha256 |
|---|---|---|---|---|---|
| 1 | 05:14 | `https://www.seiburailway.jp/railway/station/ikebukuro/` | 200 | 63,220 | `6f0f8ff6…` |
| 2 | 05:14 | `https://www.kotsu.metro.tokyo.jp/subway/stations/ikebukuro.html` | 200 | 212 | `d0203228…` (Incapsula challenge) |
| 3 | 05:14 | `https://www.kotsu.metro.tokyo.jp/subway/stations/ikebukuro/` | 200 | 212 | `d0203228…` (same challenge) |
| 4 | 05:14 | Wayback CDX `tokyometro.jp/station/ikebukuro/` | 200 | — | snapshots listed in-chat |
| 5 | 05:14 | Wayback CDX `kotsu.metro.tokyo.jp/subway/stations/ikebukuro*` | 200 | — | `[]` (no capture) |
| 6 | 05:14 | Wayback availability API, Toei URL | 429 | — | rate-limited |
| 7 | 05:14 | `https://www.jcsc.or.jp/pt_events/p_20211029_90046` (PARCO record; re-read for the site's terms state) | 200 | 41,704 | `0e39457c…` |
| 8 | 05:15 | `https://www.jcsc.or.jp/?s=西武池袋本店` | 200 | 28,653 | `6bbe9404…` |
| 9 | 05:15 | `https://www.jcsc.or.jp/sc_data/sc_open/sc_list` | 200 | 56,168 | `ecb2733b…` |
| 10 | 05:15 | `https://www.jcsc.or.jp/pt_events/p_20260514_113761` (the search result's stale link) | 404 | 29,209 | — |
| 11 | 05:16 | Wayback CDX `tokyometro.jp/station/ikebukuro/&from=2025` | 200 | — | `[]` |
| 12 | 05:16 | Wayback CDX `kotsu.metro.tokyo.jp/subway/stations/ikebukuro.html` | 200 | — | `[]` |
| 13 | 05:16 | Wayback CDX `tokyometro.jp/station/ikebukuro*&from=2024` | 200 | — | snapshots listed in-chat |
| 14 | 05:16 | `https://web.archive.org/web/20260329150449id_/https://www.tokyometro.jp/station/ikebukuro/index.html` | 302 | 0 | — |
| 15 | 05:17 | `https://web.archive.org/web/20240206004404id_/.../accessibility/index.html` | 200 | 13,164 raw | gzip body; refetched with `--compressed` |
| 16 | 05:17 | `https://web.archive.org/web/20240206004326id_/.../index.html` | 200 | 15,666 raw | gzip body |
| 17 | 05:17 | Same Tokyo Metro snapshots with `--compressed` | 200 | 92,929 / 92,839 / 151,205 | `68eeef2a…` / `103e93c6…` / `2f15a75a…` |
| 18 | 05:17 | `https://www.city.toshima.lg.jp/documents/55769/1_toshimafun_ja.pdf` | 200 | 8,586,042 | `d66dfa92…` |
| 19 | 05:17 | `https://www.city.toshima.lg.jp/documents/56546/20260519131956.pdf` | 200 | 7,971,405 | `b31c5976…` |
| 20 | 05:18 | `https://www.jcsc.or.jp/?s=LINKS IKEBUKURO` | 200 | 28,605 | `54d3a2ab…` |
| 21 | 05:19 | `https://www.jcsc.or.jp/data/basic.html` (to check the 全国SC一覧 terms) | 200 | 29,254 | `a49b80b4…` |
| 22 | 05:20 | Wayback CDX exact `http://www.kotsu.metro.tokyo.jp/subway/stations/ikebukuro.html` | 200 | — | `[]` |

## 6. Result

- New source record: `jcsc-ikebukuro-links-open-sc` (REFERENCE_ONLY / facts-only).
- New POI: `shop-ikb-seibu-honten`, category `shop`, name 「西武池袋本店」, no aliases, no position, no floor, no connector, `paid` null.
- Rebuilt with `SOURCE_DATE_EPOCH=1792594800 python3 -I stations/ikebukuro/pipeline/build_station.py` (2026-10-26 05:22 JST): OK, 66 nodes / 67 edges verified. POI total 526 → 527; search-only POIs 494 → 495.
