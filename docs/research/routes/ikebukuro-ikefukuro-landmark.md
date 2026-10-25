# Ikebukuro landmark evidence: いけふくろう (route gap G11)

**Evidence card for the missing L2 route origin (2-week plan, week 1, item 1; #342, #165). Written
2026-10-25 by `ds-research` for data-research-05. Base commit `d1ed1986` (`origin/main`, 2026-10-25).
Docs only: no station data was changed by this card.**

The route card (`ikebukuro-first-slice-route.md`, G11) records that the L2 route should start at the
いけふくろう landmark but cannot: the repo has no node, POI or source-backed position for it. This
card collects what public sources *print* about where the statue is, and then asks which existing
graph element, if any, that printed text names. It adds no data.

## 1. The gap, and what #342 allows

- `stations/ikebukuro/data/graph.src.json`: the strings 「いけふくろう」 and 「ふくろう」 occur **0**
  times — no POI, node, note or source. The card also has no `displayPosition` for any POI.
- #342 ruling 7 allows a factual name plus a location marker, and nothing more: no replica, no
  modelled statuette, and no position that is not source-backed.
- So the question this card can answer is: does any usable source print where the statue is, in
  words, and does that wording name something the graph already has? It does **not** answer the
  position, because nothing may be placed from a map image or a photo.

## 2. Sources read

All fetched on 2026-10-25 with plain `curl`, default user agent, ≥0.6 s apart (§8). Rights follow
OD-34 and OD-23 in [`../owner-decisions-pending.md`](../owner-decisions-pending.md).

| Source | URL | Printed date | Rights | Relevant? |
|---|---|---|---|---|
| 豊島区 区内のあちこちに「ふくろう」「みみずく」 | `https://www.city.toshima.lg.jp/132/miryoku/meguru/sanpo/fukurou.html` | 更新日：2025年2月3日 | facts only (OD-34 (c)) | **yes** — names and places the statue |
| 豊島区 ふくろうめぐり 2．池袋駅東口編 | `https://www.city.toshima.lg.jp/132/bunka/kanko/006337/017492.html` | 更新日：2025年5月20日 | facts only (OD-34 (c)) | **yes** — same wording as the row above |
| 豊島区とふくろう (children's page) | `https://www.city.toshima.lg.jp/kids/gaiyou/fukuro.html` | 更新日：2025年6月2日 | facts only (OD-34 (c)) | **yes**, name + role only |
| 池袋ショッピングパーク アクセス (ISP) | `https://www.web-isp.co.jp/access/` | no date printed | facts only (OD-23), with its limits | **yes** — a route relation to the statue |
| 東京メトロ 池袋駅 | `https://www.tokyometro.jp/station/ikebukuro/`, `/index.html` | — | facts only (OD-34 (2)) | **no** — both returned **403** (GAP) |
| 東武ホープセンター | `https://tobuhopecenter.jp/`, `/access/` | — | facts only (OD-34 (2)) | **no** — the site prints 「池袋駅西口の地下」; `/access/` is 404 |
| 西武 駅ナカポータル 池袋 | `https://www.seibu-shop.jp/floorguide/station/?station=st01` | — | facts only (OD-34 second round) | **no** — no mention of the statue |
| 西武鉄道 池袋駅 | `https://www.seiburailway.jp/railway/station/ikebukuro/` | — | not checked here | **no** — no mention of the statue |
| JR東日本 | `https://www.jreast.co.jp/` | — | corroboration only (OD-34 (1)) | **no** — **403** (GAP) |

Two ward PDFs were also tried for a printed mention: `13_shiryou1.pdf` (池袋駅コア整備方針2024,
200, full text extracted, 0 hits for ふくろう) and `touzaideck_seibikihonnkousou.pdf` (404).

## 3. What the printed text says

### 3.1 豊島区 — the statue's place, in the ward's own words

> 「東口の待ち合わせスポット「いけふくろう」」

(`…/sanpo/fukurou.html`). Under the heading 「JR池袋駅 東口」, the same page prints:

> 「待ち合わせ場所の定番となった「いけふくろう」の像。」
> 「地下1階JR改札付近にあります。」
> 「所在地：南池袋1-28」

The 池袋駅東口編 page prints the identical three sentences under the identical heading; the
children's page gives only the name and the role (「池袋駅東口の待ち合わせスポット「いけふくろう」」).

Read strictly, the ward says: the statue is at **JR池袋駅 東口, on floor B1 (地下1階), near the JR
ticket gates (JR改札付近)**, and it gives an address (南池袋1-28) but no coordinates.

### 3.2 ISP — a route relation, in printed steps

The ISP access page prints an example route from the JR gates, in numbered steps:

> 「JR北改札を出て右に進む」
> 「いけふくろうの像の横を通りすぎ、地上へ行く階段は上がらずに地下通路をそのまま道なりに進む」
> 「短いエスカレーターを降りると池袋ショッピングパークのレンガ通りにでます（右：南館、左北館）」

This is a *relative* statement: leaving **JR北改札** and turning right, the statue stands beside the
path, at a point where a stairway leads up to the street; the walker passes it and stays on the
underground level. It gives no distance, no bearing and no coordinate.

OD-23 limits this source: facts only, no copied text into the product, and **never the sole evidence
for either end of a route**. The sentences above are recorded here for verification; they are not
product copy, and this source alone may not turn the statue into a route endpoint.

## 4. What the text establishes, and what it does not

**Establishes**, as printed words:

- the station and side: JR池袋駅 東口;
- the level: 地下1階 (B1), and, in ISP's words, that the statue is on the underground path rather
  than up the stairs at street level;
- the vicinity: 「JR改札付近」 (ward), and, relative to one named gate, that the statue is passed
  immediately after leaving 「JR北改札」 and turning right (ISP);
- an address: 南池袋1-28;
- the role: 待ち合わせ場所 / 待ち合わせスポット.

**Does not establish**:

- any position or distance — no coordinates, no metres from a gate, exit or stair;
- *which* JR gate it is nearest: the ward's 「JR改札」 is generic and the graph holds four JR gates
  (中央1, 中央2, 南, 北);
- whether it stands at the foot of the stairs, beside their mouth, or somewhere along the passage —
  ISP only says the walker passes it and then declines the stairs;
- any passage **name**: ISP writes 「地下通路」 without a proper name, and no source read here joins
  the statue to 「中央通路」 or any other named passage;
- anything from a map image or a photograph: none was opened for this card, and no position was
  taken from one.

## 5. What the graph already has, and whether the printed text names it

Names in `graph.src.json` that could conceivably match, and the verdict for each:

| Printed words | Graph element | Kind | Named by the source? |
|---|---|---|---|
| いけふくろう / ふくろう | — | — | no graph element carries this name (0 occurrences) |
| 「JR北改札」 (ISP) | `jr-north-gate` — 「JR 北改札 / JR North Gate」 | ticket-gate POI, `connectorNodeIds: []` → search-only | **yes, name-identical** — but the POI has no node and cannot be routed to or from |
| 「JR改札付近」 (ward) | 4 named gate POIs (中央1, 中央2, 南, 北) | ticket gates | no — the wording is generic and names none of them |
| 東口 + 地下1階 (ward) | `east-exit-b1` — 「東口（地下）/ East Exit (B1)」 | area POI, connector `c_e2` (a routable junction) | **only at word level**: the ward prints 東口 and 地下1階 but never the bracketed name 「東口（地下）」, and it does not say the statue is inside that area's connector |
| 「地下通路」 (ISP) | `central-passage` — 「中央通路」, and the east-side passage nodes | area POI / junctions | no — ISP's phrase is generic and does not name 中央通路 |
| 「レンガ通り」 (ISP) | ISP POI notes say 「池袋ショッピングパーク レンガ通り」 for 2 entries | shop POI notes, not a graph name | no — the statue is passed *before* the escalator down to レンガ通り, not in it |
| (any) | `exit-22` 東口（北）, `exit-37` 東口（中央）, `exit-38` 東口（南） | exit POIs | no — no source read here ties the statue to an exit number |

Caution from the same ward page: it also prints 「地下1階・チェリーロードの天井にもふくろうがいます！」
and names 「アゼリアロード」 for *other* owls. Those are different objects; a passage name printed for
another owl must not be transferred to いけふくろう.

**Verdict.** No existing graph node or passage is named by any printed location statement for
いけふくろう. The one graph element the text names is the **JR 北改札 POI** (`jr-north-gate`), and it
is search-only. The nearest match that is routable is the **area** `east-exit-b1` (「東口（地下）」),
and that match is by the words 東口 and 地下1階 only — not by a proper name and not by any statement
that places the statue at that area's connector. Per the brief, the difference is stated rather than
inferred: there is no name match to attach the statue to, so nothing is attached.

## 6. What would close G11

Either of these, and not a reading of a map:

1. a printed statement on a usable source that places the statue at a **named passage or exit** the
   graph already has (for example a sentence that names 中央通路 or an exit number beside the
   statue), or one that prints a position; or
2. a field check that records the statue's position and its relation to a named graph node.

Until one of those exists, the most this card supports is the factual name plus the B1 east-exit
area from the ward text — a description, not a point. The L2 route therefore still cannot start at
the landmark, and the route card's G11 stays open.

## 7. Rights, and what is not reused

- 豊島区 pages: facts only (OD-34 (c)). The sentences above are recorded as evidence with URL and
  page date; nothing is copied into product strings.
- ISP: facts only under OD-23 (all rights reserved, no quotation clause; not covered by OD-18). The
  quotes are for verification only, no text is copied into the product, and ISP is never the sole
  evidence for either end of a route — which is the second reason this card stops at a description.
- Tokyo Metro, 東武ホープセンター, 西武: facts only under OD-34, but none of them printed anything
  usable here (two 403s, one 404, two pages with no mention).
- JR東日本: corroboration only under OD-34 (1), and its homepage returned 403, so there is no
  corroboration to record either. No JR East text is used.
- No image, map tile or photograph was read for position; the right to read a map image is not the
  same as a licence to take coordinates from it, and neither was used.

## 8. Fetch log

16 requests, plain `curl`, ≥0.6 s apart, 2026-10-25 JST. All used the default user agent except
#4, which was repeated as #5 with the default agent and came back byte-identical:

| # | URL | HTTP | Note |
|---|---|---|---|
| 1 | `…/132/miryoku/meguru/sanpo/fukurou.html` | 200 | quotes §3.1 |
| 2 | `…/kids/gaiyou/fukuro.html` | 200 | name + role |
| 3 | `…/132/bunka/kanko/006337/017492.html` | 200 | same wording as #1 |
| 4 | `https://www.web-isp.co.jp/access/` | 200 | quotes §3.2; this read carried an empty user agent by mistake |
| 5 | `https://www.web-isp.co.jp/access/` | 200 | default user agent, 24,261 bytes, text identical to #4 — #4's text is the one quoted |
| 6 | `https://www.tokyometro.jp/station/ikebukuro/` | 403 | GAP |
| 7 | `https://www.tokyometro.jp/station/ikebukuro/index.html` | 403 | GAP |
| 8 | `https://www.tobuhopecenter.jp/` | 301 | → `https://tobuhopecenter.jp/` |
| 9 | `https://www.tobuhopecenter.jp/access/` | 301 | → `…/access/`, 404 |
| 10 | `https://tobuhopecenter.jp/` | 200 | prints 「池袋駅西口の地下」 — west side |
| 11 | `https://tobuhopecenter.jp/access/` | 404 | GAP |
| 12 | `https://www.jreast.co.jp/` | 403 | GAP (corroboration only in any case) |
| 13 | `https://www.city.toshima.lg.jp/documents/49279/13_shiryou1.pdf` | 200 | 0 hits for ふくろう |
| 14 | `…/405/machizukuri/toshikekaku/documents/touzaideck_seibikihonnkousou.pdf` | 404 | GAP |
| 15 | `https://www.seibu-shop.jp/floorguide/station/?station=st01` | 200 | no mention |
| 16 | `https://www.seiburailway.jp/railway/station/ikebukuro/` | 200 | no mention |

Nothing was bypassed, no one was contacted, and no sign-in, form or upload was used.
