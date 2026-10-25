# Store entrances: printed station ties for the store POIs (2026-10-25)

Fills the gteki-fa gap: the store POIs for 小田急百貨店, 新宿マルイ (3 buildings), ルミネ新宿
(ルミネ1 / ルミネ2 / ルミネエスト), ニュウマン新宿, 伊勢丹新宿店 (本館 / メンズ館), 東武百貨店
池袋店, ルミネ池袋, エソラ池袋 and 池袋パルコ are search-only — no `floorId`, no `position`, no
`connectors` — so brand search shows the card but cannot route to the store. This file records,
per store, what a **facts-only** source **prints** about which station element an entrance is
tied to. It imports nothing and changes no POI.

Base: `origin/main` 7e23fc36 (2026-10-25).

## Method

- **Sources.** Facts-only sources only, as listed in the brief: the stores' own access pages
  (LUMINE, NEWoMan, ESOLA, 東武百貨店, 小田急百貨店, 新宿マルイ, 伊勢丹 per #522). JR, Keio,
  Odakyu (railway), Sogo-Seibu and PARCO are corroboration only and were not used as evidence;
  池袋パルコ's own site is in that class, so it contributes no row evidence here. No ward, Tokyo
  Metro or Toei page is cited: `tokyometro.jp` answered 403 and no facts-only station page was
  needed once the stores' own pages had been read.
- **Fetching.** `curl` only, its default User-Agent, no `-A`/UA header and no other added header,
  requests ≥0.6 s apart — **47 requests** in total: 34 for the research and 13 re-reading the cited
  pages to check the quotes after review (§Fetch log, round 2). No logins, no forms, no browser, no
  ego-lite. Times in the log are UTC (JST = UTC+9).
- **Fallbacks.** A 403, challenge or timeout is retried through Wayback where a snapshot exists,
  otherwise recorded as a GAP. `www.mistore.jp` still returns no HTTP response from this host
  (§GAP-1), so the 伊勢丹 access page was read from a Wayback copy of the same URL; the quote is
  the archived page's text and the snapshot date is recorded.
- **Quotes.** A 「」 string is a continuous stretch of one printed line (or of consecutive printed
  lines where the source breaks a sentence), with no words added, dropped or reordered. Section
  headings and line labels (電車でお越しの方, 京王線 …) stay outside the quotation marks. Where a
  source prints a list or a map legend (東武百貨店), it is marked as a transcription and listed in
  printed order.
- **Name matching (this is the whole of the mapping rule).** Each element name printed in the
  source is compared with the POI names in `stations/<station>/gteki/pois.json` after (a) dropping
  spaces, full-width or half-width, and (b) dropping a leading operator/line qualifier printed
  before the station name (`JR`, `小田急線`, `京王線`, `西武池袋線`, `東武東上線`,
  `東京メトロ…線` …) when the same qualifier appears on either side.
  - **exact** — the element name is identical after that normalisation, e.g. printed
    「JR池袋駅南改札」 vs POI 「JR 南改札」 (element 南改札).
  - **near** — the same place under a different word (`改札` vs `改札口` / `口`, or
    `中央改札1` vs `中央1改札`). Recorded, but **never** treated as the same element: that would
    be inference.
  - No POI in the bundle has the name → **no matching POI**.
- **Verdicts** (the lead's ruling of 2026-10-25 applied here). **READY** requires all three: (a)
  the printed text names the station element **exactly** as an existing POI names it, ignoring only
  operator prefixes and spaces; (b) the printed text says the store entrance is at or directly
  from that element — wording such as 直結, 直通, 正面, すぐ, 改札前; and (c) the statement attaches
  to that one store POI — a tie printed for a building complex (ルミネ新宿) is not a per-POI tie.
  Anything else is **PARTIAL**,
  with the reason. **FIELD** = nothing printed that could be used; the reason is given. A
  station-level claim (「…駅直結」, 「新宿駅南口より徒歩1分」) is not a tie to an element; a walking
  time is not a connection; a gate listed in a map legend is not a printed entrance tie.
- Nothing was inferred from a map, a photo or a distance beyond the printed words. Printed walk
  times are quoted only where the source prints them; no distance or route was computed.

## Result

14 store POIs: **1 READY**, **11 PARTIAL**, **2 FIELD**. The single READY row is ルミネ池袋
(「JR池袋駅南改札、正面右手よりすぐ」 → `jr-south-gate` 「JR 南改札」).
Four rows were read as READY at some point and ended PARTIAL on the lead's rulings of 2026-10-25
(新宿マルイ 本館, ルミネ1, ルミネ2, 東武百貨店); the reasons are in each row and in §Notes.

ルミネ1 / ルミネ2 are PARTIAL for a reason that was corrected in review: the printed
「ルミネ口より直通」 **is** an exact namesake of `poi:keio-gate:4` 「京王線　ルミネ口」 (an earlier
revision wrongly said no POI had that name), but the access page prints one 電車 section for the
ルミネ新宿 complex and does not say which building that entrance serves. A READY verdict has to
attach to one store POI, so the tie is recorded as a complex-level lead for the field check, not as
a routing tie for either building.

| Store POI (`gteki/pois.json`) | Store (as printed) | Verdict | Printed statement (verbatim) | Named station element (as printed) | Matching POI in `pois.json` | Store floor printed | Source (URL, snapshot) | Date |
|---|---|---|---|---|---|---|---|---|
| `shop-sjk-odakyudept` | 小田急百貨店 新宿店 | **PARTIAL** | 「① 地上出口より青梅街道に向かって直進、「ユニクロ」が出店している新宿西口パレットビル前の横断歩道を新宿西口ハルクの館に向かってお進みください。約３０ｍ直進すると右手に見える１階正面入口からご入店ください。」「② 新宿エルタワー前（新宿西口ロータリー入口の交差点）の横断歩道を新宿西口ハルクの館に向かってお進みください。渡った先「喫茶ピース」右手の入口からご入店ください。」 | 地上出口 (no name printed) | **no matching POI** | 1階 (1階正面入口) | `https://www.odakyu-dept.co.jp/info/v4l5d000001cquyy-att/20250917.pdf` (2 pp., 株式会社 小田急百貨店, 2025 年 9 月, 改定日 2025-09-27) | 2026-10-25 |
| `shop-sjk-marui-honkan` | 新宿マルイ 本館 | **PARTIAL** — the printed gate is a waypoint in a ~600 m walking route, not the entrance; 「JR西口改札」 vs POI 「JR西口」 is a 改札/口 near match | 「JR線(新宿駅)から…車いす25分」(route heading, as printed) 「中央西口を出て右に曲がり、JR西口方面に80mほど進みます。**JR西口改札前**で左に曲がり、40mほど進んで｢地上出口1｣階段手前を右に曲がります。つきあたりにある2号機エレベーターでB2Fに降りて右に曲がり、メトロプロムナードを500mほど進むと、右手に**新宿マルイ本館B1F入口**がございます。」 | JR西口改札 / 地上出口1 | **near**: `poi:jreast-gate:10` 「JR西口」 (改札 vs 口, not the same element). 地上出口1: no matching POI | B1F (本館B1F入口, reached via メトロプロムナード) | `https://www.0101.co.jp/003/access/` | 2026-10-25 |
| `shop-sjk-marui-annex` | 新宿マルイ アネックス | **PARTIAL** | 「メトロプロムナードを400mほど進んで、B4出口にあるエレベーターで地上に出ます。新宿通りを左に曲がると新宿三丁目交差点がありますので、ＪＴＢを目印として伊勢丹の対角に横断し、新宿通りを80mほど進むと、右手に**新宿マルイアネックス**がございます。」 (quote is the JR route; 三越方面改札 is printed in the 丸ノ内線 新宿三丁目駅 route on the same page) | B4出口 / 三越方面改札 | **no matching POI** (the bundle's six `exit` POIs carry descriptors, not exit numbers; no gate named 三越方面改札) | not printed | `https://www.0101.co.jp/005/access/` | 2026-10-25 |
| `shop-sjk-marui-men` | 新宿マルイ メン | **FIELD** | — the access page prints the location, 駐車場 and 駐輪場 only (Park One 新宿マルイメン駐車場, 駐車場までのルートのご案内); no train, gate, exit or passage line | — | — | not printed | `https://www.0101.co.jp/074/access/` | 2026-10-25 |
| `shop-sjk-lumine1` | ルミネ新宿 ルミネ1 | **PARTIAL** — `poi:keio-gate:4` 「京王線　ルミネ口」 matches the printed 「ルミネ口」 exactly and 「ルミネ口より直通」 is a 直通 tie, but the page prints one 電車 section for the ルミネ新宿 complex and does not say which building that entrance serves: complex-level tie, no per-building attribution. The other two lines do not count: 新宿駅南口 is printed once for JR, 小田急 and 京王 together (reading it as the JR gate is inference) and 徒歩1分 is a walking time; 新宿駅京王新線口 is also 徒歩1分 | 「新宿駅南口より徒歩1分」「ルミネ口より直通」「新宿駅京王新線口より徒歩1分」 — each printed under its own line label (JR・小田急線・京王線 / 京王線 / 京王新線・都営新宿線・都営大江戸線・), section heading 電車でお越しの方 | 新宿駅南口 / ルミネ口 / 京王新線口 | **exact**: `poi:keio-gate:4` 「京王線　ルミネ口」 (the 直通 line; strongest lead for the field check). 新宿駅南口 would be `poi:jreast-gate:7` 「JR南口」 but the printed 南口 is shared, not JR-specific. **exact name, no tie**: `poi:keio-gate:1` / `:2` 「京王新線　京王新線口」 with 徒歩1分 | not printed | `https://www.lumine.ne.jp/shinjuku/access/` | 2026-10-25 |
| `shop-sjk-lumine2` | ルミネ新宿 ルミネ2 | **PARTIAL** — same page, same reasons as ルミネ1 (complex-level tie, no per-building attribution) | same page, same three statements (the page gives one 電車 section for both buildings; 所在地 prints both) | 新宿駅南口 / ルミネ口 / 京王新線口 | same as ルミネ1: **exact** `poi:keio-gate:4` 「京王線　ルミネ口」 (直通 line); **exact name, no tie** `poi:keio-gate:1` / `:2` 「京王新線　京王新線口」 (徒歩1分); 新宿駅南口 → `poi:jreast-gate:7` 「JR南口」 only by inference | not printed | `https://www.lumine.ne.jp/shinjuku/access/` | 2026-10-25 |
| `shop-sjk-lumineest` | ルミネエスト新宿 | **PARTIAL** | 「JR新宿駅中央東改札または東改札から徒歩1分」 (section heading 電車でお越しの方) | 中央東改札 / 東改札 | **near**: `poi:jreast-gate:5` 「JR中央東口」 and `poi:jreast-gate:9` 「JR東口」 (改札 vs 口) | not printed | `https://www.lumine.ne.jp/est/access/` | 2026-10-25 |
| `shop-sjk-newoman` | ニュウマン新宿 | **PARTIAL** | 「JR各線「新宿駅」**ミライナタワー改札・甲州街道改札・新南改札**方面へお越しください。」「都営新宿線・都営大江戸線・京王新線「新宿駅」より徒歩5分。」「東京メトロ副都心線「新宿三丁目駅」より徒歩3分。（**E10出口** 出てすぐ）」 | ミライナタワー改札 / 甲州街道改札 / 新南改札 / E10出口 | **near**: `poi:jreast-gate:3` 「JR 新南口 ミライナタワー改札口」, `poi:jreast-gate:4` 「JR 新南口　甲州街道口」, `poi:jreast-gate:2` 「JR 新南口」 (改札 vs 改札口/口). E10出口: no matching POI | not printed | `https://www.newoman.jp/shinjuku/access/` | 2026-10-25 |
| `shop-sjk-isetan-honkan` (PR #524, not merged) | 伊勢丹新宿店 本館 | **PARTIAL** | 「東京メトロ丸の内線：**伊勢丹方面改札**〜（徒歩約1分）」「東京メトロ副都心線：**新宿三丁目交差点改札**〜（徒歩約2分）：**伊勢丹正面改札**〜（徒歩約30秒）」「都営新宿線：**新宿三丁目改札**〜（徒歩約3分）」「※伊勢丹正面改札は、午前7時～午後3時は駅からの出場専用。午後3時～終電までは駅への入場専用。」 | 伊勢丹方面改札 / 新宿三丁目交差点改札 / 伊勢丹正面改札 / 新宿三丁目改札 (all 新宿三丁目駅) | **no matching POI** — the bundle holds 新宿駅 only; no 新宿三丁目駅 gate POI exists | not printed | `https://www.mistore.jp/store/shinjuku/access.html` via Wayback snapshot `20261014182417` (`http://web.archive.org/web/20261014182417/https://www.mistore.jp/store/shinjuku/access.html`) — direct read times out, GAP-1 | 2026-10-25 |
| `shop-sjk-isetan-mens` (PR #524, not merged) | 伊勢丹新宿店 メンズ館 | **PARTIAL** | same page: it prints one 住所 (〒160-0022 東京都新宿区新宿3-14-1) and one 電車 section for 伊勢丹; nothing is printed for メンズ館 separately (the メンズ館 floor guide only links 「アクセス・営業情報」) | 伊勢丹方面改札 / 新宿三丁目交差点改札 / 伊勢丹正面改札 / 新宿三丁目改札 | **no matching POI** (as 本館) | not printed | as 本館; メンズ館 page `https://www.mistore.jp/store/shinjuku/shops_mens.html` via snapshot `20260608083222` | 2026-10-25 |
| `shop-ikb-tobudept` | 東武百貨店 池袋店 | **PARTIAL** — 「池袋駅西口 直結」 is station-level (and no POI is named 池袋駅西口); the gate names sit in the access map's legend, which does not print a tie from the store entrance to each gate | 「池袋駅西口 直結」; the access map's gate legend is a **transcription** (operator headings and gate names are separate printed lines, listed here in printed order): 〈JR〉 北改札 / 中央改札1・2 / 南改札 / メトロポリタン改札; 〈西武池袋線〉 B1F改札口; 〈東京メトロ 有楽町線〉 有楽町線南通路西改札; 〈東武東上線〉 東上線北改札 / 東上線中央改札1・2 / 東上線南口改札; 〈東京メトロ 丸ノ内線〉 丸ノ内線中央連絡西改札; 〈東京メトロ 副都心線〉 副都心線西通路東改札 | 池袋駅西口 (station-level) / 北改札, B1F改札口, 有楽町線南通路西改札, 東上線北改札, 副都心線西通路東改札, 南改札, 中央改札1・2 | **name-exact, but no printed entrance tie**: `jr-north-gate` 「JR 北改札」, `jr-south-gate` 「JR 南改札」, `seibu-b1f-gate` 「西武池袋線 B1F改札口」, `metro-y-south-west-gate` 「有楽町線 南通路西改札」, `tobu-north-gate` 「東武東上線 北改札」, `metro-f-west-east-gate` 「副都心線 西通路東改札」. **near**: 中央改札1・2 → `jr-central-gate-1/2`, 東上線中央改札1・2 → `tobu-central-gate-1/2`. No matching POI: 池袋駅西口, メトロポリタン改札, 東上線南口改札, 丸ノ内線中央連絡西改札 | not printed | `https://www.tobu-dept.jp/ikebukuro/access/` | 2026-10-25 |
| `shop-ikb-lumine` | ルミネ池袋 | **READY** | 「JR池袋駅南改札、正面右手よりすぐ」 (section heading 電車でお越しの方) | 南改札 | **exact**: `jr-south-gate` 「JR 南改札」 | not printed | `https://www.lumine.ne.jp/ikebukuro/access/` | 2026-10-25 |
| `shop-ikb-esola` | エソラ池袋 | **PARTIAL** | 「エソラ池袋 \| **東京メトロ有楽町線池袋駅直結**の駅ビル」 (page title, printed in the HTML `<title>` and `<h1>`) | 東京メトロ有楽町線池袋駅 (the station, no exit/gate/passage named) | **no matching POI** (no POI is the station itself; the two 有楽町線 gate POIs are not named on the page) | not printed | `https://www.metropro-sc.jp/esola-ikebukuro/` | 2026-10-25 |
| `shop-ikb-parco` | 池袋パルコ | **FIELD** | — 池袋パルコ's own site is **corroboration only** (OD-34, #502 ruling: §1(1) is a quoted use restriction), so it cannot be the evidence; its `/access/` path serves a not-found page (HTTP 200) and `/info/` prints 住所 and 営業時間 only. No facts-only source read here prints an entrance tie for this store | — | — | not printed | `https://ikebukuro.parco.jp/access/` (not-found page), `/info/` | 2026-10-25 |

## Notes

- **東武百貨店.** The gate names above are printed on the store's own access page as the legend of
  its station access map, under 「池袋駅西口 直結」. The page prints no distance, no route and **no
  store floor** for them, so nothing beyond the names and the 直結 claim is recorded. Under the
  lead's ruling that is PARTIAL: 直結 is claimed at station level (池袋駅西口, no such POI), and a
  legend is not a printed tie from the store entrance to each gate.
- **新宿マルイ 本館.** The page prints only a **車いす recommended route** per line
  (「最寄駅から車いすをご利用する場合の推奨ルート」, 5–30 min); the route quoted in the row runs
  500 m along メトロプロムナード as a deliberate detour. 「JR西口改札前」 is a waypoint inside that
  route, not the entrance; the entrance it prints is 本館B1F入口, reached along メトロプロムナード.
  「JR西口改札」 vs POI 「JR西口」 is also a 改札/口 near match. The other routes on the page name
  「中央西口」 (`poi:jreast-gate:1` 「JR 中央西口（出口専用）」), 「西口地下改札」,
  「京王西口改札」, 「中央改札口」, 「三越方面改札」 and 「新宿三丁目交差点方面改札」 — all as
  the first step of a route to the B1F entrance, none printed as the entrance itself, so none is a
  tie. PARTIAL on both counts.
- **ルミネ新宿.** One 電車 section serves both ルミネ1 and ルミネ2 (the page prints both buildings'
  住所), so the same quotes and verdicts are recorded for both POIs. 「ルミネ口より直通」 (printed
  under the line label 京王線) is the strongest lead: ルミネ口 is `poi:keio-gate:4`
  「京王線　ルミネ口」 exactly, and 直通 is a printed direct connection from that gate. It stays
  **PARTIAL** because the page prints one access section for the complex and does not say which
  building the direct entrance serves — the tie has no per-building attribution, so wiring it to
  both ルミネ1 and ルミネ2 could be wrong for one of them. The other two statements do not count:
  新宿駅南口 is printed once under 「JR・小田急線・京王線」 together, so reading it as the JR gate is
  inference, and 徒歩1分 is a walking time rather than a connection; 「新宿駅京王新線口より徒歩1分」
  names `poi:keio-gate:1` / `:2` 「京王新線　京王新線口」 exactly but is again a walking time.
- **伊勢丹新宿店.** The store's access page answers from 新宿三丁目駅: the four named elements are
  gates of that station, and `stations/shinjuku/gteki/pois.json` holds 新宿駅 POIs only, so none of
  them can be mapped without a 新宿三丁目駅 bundle. The メンズ館 has no access text of its own.
  Both 伊勢丹 POIs live on the unmerged draft PR #524, not on `main`.
- **Printed floors.** Only two rows print a store floor: 小田急百貨店 (1階正面入口) and 新宿マルイ
  本館 (本館B1F入口). No other source read here prints which floor an entrance is on.
- **Near matches — not the same element (lead's ruling 2026-10-25), so they stay PARTIAL and go to
  the field list.** 「JR西口改札」 (新宿マルイ 本館) vs `poi:jreast-gate:10` 「JR西口」;
  「中央東改札」/「東改札」 (ルミネエスト) vs `poi:jreast-gate:5` 「JR中央東口」 /
  `poi:jreast-gate:9` 「JR東口」; 「ミライナタワー改札」/「甲州街道改札」/「新南改札」 (ニュウマン) vs
  `poi:jreast-gate:3` 「JR 新南口 ミライナタワー改札口」 / `poi:jreast-gate:4` 「JR 新南口　甲州街道口」 /
  `poi:jreast-gate:2` 「JR 新南口」; 「中央改札1・2」 (東武百貨店) vs `jr-central-gate-1` /
  `jr-central-gate-2`; 「東上線中央改札1・2」 (東武百貨店) vs `tobu-central-gate-1` /
  `tobu-central-gate-2`. Each pair names the same place in different words; whether they are one
  element is a field question, not a textual one.

## GAPs

- **GAP-1 — 伊勢丹 direct read.** `www.mistore.jp` still completes TCP/TLS but returns no HTTP
  response from this host: `/store/shinjuku/access.html` status 000 after 18.1 s (13:06:44Z);
  `www.isetan.mistore.jp/shinjuku.html` 301 with the redirect target never answering (13:07:44Z).
  The access page was therefore read from a Wayback snapshot (2026-10-14). A fresh direct read can
  only be done from a network the site answers.
- **GAP-2 — Tokyo Metro station pages.** `https://www.tokyometro.jp/station/ikebukuro/` answered
  **403** with an Akamai "Access Denied" body (397 bytes, 13:06:29Z). No Tokyo Metro page was needed
  for any row above, so no Wayback retry was made.
- **GAP-3 — 池袋パルコ.** No facts-only source prints an entrance tie. Closing it needs a facts-only
  source (a ward page, a Tokyo Metro/Toei page, or a tenant's own site) or a field check.
- **GAP-4 — 新宿マルイ メン.** The store's access page prints parking only. Its ordinary route is
  probably on the store's floor guide (JavaScript-only) or nowhere; a field check would settle it.

## Fetch log

`curl`, default User-Agent, no added headers, ≥0.6 s apart. Status is the final HTTP code; `000` =
no HTTP response (timeout / no answer). All times 2026-10-25 UTC.

| # | UTC | Target | URL | Status | Bytes | Note |
|---|---|---|---|---|---|---|
| 1 | 13:04:46 | 小田急百貨店 | `https://www.odakyu-dept.co.jp/shinjuku/` | 200 | 83,452 | store top; found the 営業時間・アクセス link |
| 2 | 13:04:47 | 新宿マルイ | `https://www.0101.co.jp/003/` | 200 | 61,834 | store page |
| 3 | 13:04:58 | 小田急百貨店 | `…/shinjuku/hour_acces/index.html` | 200 | 21,493 | hours, address, parking; 周辺案内 is an image (alt only), no station text |
| 4 | 13:04:59 | 新宿マルイ | `https://www.0101.co.jp/003/access/` | 200 | 33,665 | 本館 access (wheelchair routes) |
| 5 | 13:05:00 | 新宿マルイ | `https://www.0101.co.jp/005/access/` | 200 | 35,214 | アネックス access |
| 6 | 13:05:01 | 新宿マルイ | `https://www.0101.co.jp/074/access/` | 200 | 26,509 | メン access: parking only |
| 7 | 13:05:14 | LUMINE | `https://www.lumine.ne.jp/access/` | 200 | 16,640 | NOT FOUND page, discarded |
| 8 | 13:05:23 | LUMINE | `https://www.lumine.ne.jp/` | 200 | 36,199 | store links |
| 9 | 13:05:27 | LUMINE | `https://www.lumine.ne.jp/shinjuku/` | 200 | 45,260 | |
| 10 | 13:05:32 | LUMINE | `https://www.lumine.ne.jp/shinjuku/access/` | 200 | 25,740 | ルミネ1 / ルミネ2 access |
| 11 | 13:05:33 | LUMINE | `https://www.lumine.ne.jp/est/access/` | 200 | 24,993 | ルミネエスト access |
| 12 | 13:05:34 | LUMINE | `https://www.lumine.ne.jp/ikebukuro/access/` | 200 | 23,957 | ルミネ池袋 access |
| 13 | 13:05:50 | NEWoMan | `https://www.newoman.jp/` | 200 | 34,439 | |
| 14 | 13:05:52 | 東武百貨店 | `https://www.tobu-dept.jp/ikebukuro/` | 200 | 60,228 | |
| 15 | 13:05:55 | 東武百貨店 | `https://www.tobu-dept.jp/ikebukuro/access/` | 200 | 17,591 | 直結 claim + gate legend |
| 16 | 13:05:56 | NEWoMan | `https://www.newoman.jp/shinjuku/` | 200 | 40,788 | |
| 17 | 13:06:01 | NEWoMan | `https://www.newoman.jp/shinjuku/access/` | 200 | 24,574 | |
| 18 | 13:06:27 | 小田急百貨店 | `…/shinjuku/floorguide/index.html` | 200 | 24,186 | floor list, no access text |
| 19 | 13:06:27 | エソラ池袋 | `https://www.metropro-sc.jp/esola-ikebukuro/` | 200 | 62,909 | 直結 claim in the title only |
| 20 | 13:06:29 | 東京メトロ | `https://www.tokyometro.jp/station/ikebukuro/` | **403** | 397 | Akamai "Access Denied" (GAP-2) |
| 21 | 13:06:39 | 小田急百貨店 | `https://www.odakyu-dept.co.jp/sitemap/` | 200 | 14,605 | nav check |
| 22 | 13:06:40 | エソラ池袋 | `https://www.metropro-sc.jp/esola-ikebukuro/access/` | 404 | 5,132 | no access page |
| 23 | 13:06:41 | — | (malformed: the URL argument was mistyped as `--max-time`) | 000 | 0 | probe discarded, not used |
| 24 | 13:06:44 | 伊勢丹 | `https://www.mistore.jp/store/shinjuku/access.html` | **000** | 0 | no HTTP response in 18.1 s (GAP-1) |
| 25 | 13:07:42 | 小田急百貨店 | `…/shinjuku/floorguide/01/index.html` | 200 | 24,389 | 1F floor guide, no access text |
| 26 | 13:07:43 | 池袋パルコ | `https://ikebukuro.parco.jp/access/` | 200 | 14,675 | "ページが見つかりませんでした" page |
| 27 | 13:07:44 | 伊勢丹 | `https://www.isetan.mistore.jp/shinjuku.html` | 301 | 0 | redirect target never answered in 18.2 s (GAP-1) |
| 28 | 13:08:20 | 小田急百貨店 | `https://www.odakyu-dept.co.jp/info/v4l5d000001cquyy-att/20250917.pdf` | 200 | 542,206 | 2-page PDF; text read with `pdftotext` |
| 29 | 13:08:30 | 新宿マルイ | `https://www.0101.co.jp/074/` | 200 | 61,834 | same generic page as #2, no store text |
| 30 | 13:08:37 | 池袋パルコ | `https://ikebukuro.parco.jp/info/` | 200 | 49,714 | 住所 / 営業時間 only |
| 31 | 13:09:05 | Wayback API | `https://archive.org/wayback/available?url=mistore.jp/store/shinjuku/access.html` | 200 | 254 | snapshot `20261014182417` |
| 32 | 13:09:10 | Wayback copy | `http://web.archive.org/web/20261014182417/https://www.mistore.jp/store/shinjuku/access.html` | 200 | 260,578 | 伊勢丹 access page (archived) |
| 33 | 13:09:23 | Wayback API | `…/available?url=mistore.jp/store/shinjuku/shops_mens.html` | 200 | 262 | snapshot `20260608083222` |
| 34 | 13:09:28 | Wayback copy | `http://web.archive.org/web/20260608083222/https://www.mistore.jp/store/shinjuku/shops_mens.html` | 200 | 119,418 | メンズ館 floor guide; no access text |

### Round 2 — quote re-verify (after the oracle review)

Same fetch rules (`curl`, default User-Agent, no added headers, requests ≥0.6 s apart). Times are the
completion times recorded on the saved responses; the purpose of every request is to check that each
「」 quote in the table is a continuous substring of the cited page.

| # | UTC | Target | URL | Status | Bytes | Note |
|---|---|---|---|---|---|---|
| 35 | 13:38:32 | LUMINE | `https://www.lumine.ne.jp/shinjuku/access/` | 200 | 25,740 | quote re-verify (ルミネ1 / ルミネ2) |
| 36 | 13:38:34 | LUMINE | `https://www.lumine.ne.jp/ikebukuro/access/` | 200 | 23,957 | quote re-verify (ルミネ池袋) |
| 37 | 13:39:19 | 東武百貨店 | `https://www.tobu-dept.jp/ikebukuro/access/` | 200 | 17,591 | quote re-verify (直結 claim + legend) |
| 38 | 13:39:22 | NEWoMan | `https://www.newoman.jp/shinjuku/access/` | 200 | 24,574 | quote re-verify |
| 39 | 13:39:23 | 新宿マルイ | `https://www.0101.co.jp/003/access/` | 200 | 33,665 | quote re-verify (本館) |
| 40 | 13:39:24 | LUMINE | `https://www.lumine.ne.jp/est/access/` | 200 | 24,993 | quote re-verify (ルミネエスト) |
| 41 | 13:41:15 | 小田急百貨店 | `https://www.odakyu-dept.co.jp/info/v4l5d000001cquyy-att/20250917.pdf` | 200 | 542,206 | quote re-verify; text read with `pdftotext` |
| 42 | 13:41:16 | エソラ池袋 | `https://www.metropro-sc.jp/esola-ikebukuro/` | 200 | 62,909 | quote re-verify (title / h1) |
| 43 | 13:41:38 | 新宿マルイ | `https://www.0101.co.jp/074/access/` | 200 | 26,509 | quote re-verify (メン: parking only, FIELD) |
| 44 | 13:41:40 | 新宿マルイ | `https://www.0101.co.jp/005/access/` | 200 | 35,214 | quote re-verify (アネックス) |
| 45 | 13:42:12 | Wayback copy | `http://web.archive.org/web/20261014182417/https://www.mistore.jp/store/shinjuku/access.html` | 200 | 260,576 | quote re-verify (伊勢丹, archived) |
| 46 | 13:43:17 | 池袋パルコ | `https://ikebukuro.parco.jp/access/` | 200 | 14,675 | quote re-verify; not-found page body (HTTP 200) |
| 47 | 13:43:18 | 池袋パルコ | `https://ikebukuro.parco.jp/info/` | 200 | 49,714 | quote re-verify; 住所 / 営業時間 only |

Request count: **47** — round 1 **34** (#23 malformed and discarded; 33 responses read) and round 2
**13** quote re-verify reads. Every request made for this file is listed above.

## Gap in the record itself

- The ルミネ1 / ルミネ2 POIs are two rows with one quote set; if the importer ever needs a
  per-building entrance, that page does not print one.
- 伊勢丹 rows point at POI ids that exist only on draft PR #524. If #524 changes or drops those ids,
  those two rows need re-keying.
