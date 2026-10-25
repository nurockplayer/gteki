# Shinjuku: what public text closes online (2026-10-25)

**Asked by:** data-research-05 (Owner priority, 2026-10-25 17:30). **Written by:** `ds-infra` for data-research-05. **Basis:** `origin/main` `90e51199`. **Docs only: no station data, POI or graph file was changed by this PR.**

Scope: every item in [`shinjuku-field-checklist.md`](shinjuku-field-checklist.md) and every Shinjuku row of [`../lines/gap-table-2026-10-25.md`](../lines/gap-table-2026-10-25.md) marked *field check*, *no source* or *NONE*, plus the WP10 gate-identity question and the four department-store terms classes (伊勢丹新宿店, 高島屋新宿店, 京王百貨店 新宿, 新宿サブナード).

**Result: 5 CLOSED, 10 PARTIAL, 21 FIELD (36 items).** A CLOSED item is one a printed public source settles outright. PARTIAL means a printed source settles part of it and names what is left. FIELD means no printed public source settles it, with the reason.

## 1. How the evidence was taken

- Facts only, printed text only. No position, direction or facility was taken from a map image, a photo, a diagram symbol or a PDF page without a text layer.
- `curl` with its default User-Agent only; no `-A`, `--user-agent` or UA header at any point. Requests spaced ≥0.6 s. **58 requests** this pass; 57 of them are itemised in the fetch log of §7 (55 rows, two of which each cover two attempts — the takashimaya.co.jp row, HTTP/2 error then an HTTP/1.1 retry, and the らくらくおでかけネット terms row, the same URL twice with the second a duplicate by mistake). The one attempt not in the log is the live Toei station page earlier in the pass, which answered a 212-byte challenge and is noted in §7. No login-gated page was ever requested; two operator URLs answered with a challenge (the Toei station page and the Toei congestion PDF), recorded as gaps and never worked around.
- Exhaustion order: operator fact pages (OD-34 usable list) → ward and metropolitan PDFs (printed text only) → operator text pages → Wayback snapshots (URL and snapshot date given per item) → `oracle-ego` (ChatGPT browsing) for the four store sites that `curl` cannot read.
- Two `oracle-ego` runs were used: `20261025-172753-92939-sjk-online-1` (station sources) and `20261025-173937-7107-sjk-stores-1` (the four store policy pages). Every quote obtained that way is labelled **(via oracle-ego / ChatGPT browsing)** where it appears.
- Rights classes used below. Toei facts: **OD-01 A**. Tokyo Metro facts: **OD-34 §2 (facts only)**. らくらくおでかけネット: read this pass, **corroboration only** (§5). The Tokyo Metropolitan Government signage PDF ([`toshiseibi.metro.tokyo.lg.jp`](https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_kiban_shinjuku_terminal_pdf_shinjuku_terminal_1_33)) is **not in OD-34** and its terms were not read: class **UNKNOWN**, so only short gate-name labels are recorded from it. 新宿区 pages: also not in OD-34; only facts are used, and the elevator/stairs map PDF fetched this pass has no text layer at all (`pdftotext` → 2 bytes), the terminal map having been reported the same way by the oracle run.
- Third-party pages that `oracle-ego` also reported (駅ずかん, Yahoo!知恵袋, a rail blog) are **not** cited as evidence anywhere in this document.

## 2. The items

`Gap id` uses the checklist's G-01–G-12. `Field filled` names the data field the finding would fill, and for a CLOSED item says what is importable.

| # | Item | Gap id | Verdict | Evidence (quote · URL · date) | Field filled |
|---|---|---|---|---|---|
| 1 | Checklist stop 1 — running direction of the B6→B3 escalator `e:2768d162a2d648cf9df2fc76ca89257f`, and any posted reversal | G-06 | **FIELD** | No printed direction anywhere. Toei prints counts only: 「エスカレーター : 16台」「エレベーター : 2台」（大江戸線, [新宿 station page, Wayback 2026-09-04](https://web.archive.org/web/20260904120052id_/https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html)）. The Toei 障害者設備一覧 prints only that an escalator exists per level pair (「地上～改札階」「改札階～ホーム階」), never its direction. Direction is drawn in the 構内図 and the ward maps, i.e. image only | `direction` on the two escalator edges |
| 2 | Checklist stop 1 — does a lift serve B6 (platform) and B3 | G-05 | **PARTIAL** | Printed, at station level: E-27 has a ground-to-gate lift and a gate-to-platform lift — 障害者設備一覧 E-27 row: 「エレベーター（地上～改札階）: 地上行エレベーター」「エレベーター（改札階～ホーム階）: ホーム階行エレベーター」「1ルート確保（エレベーター等）: ○」([`subway_barrierfree_oedo.csv`](https://www.opendata.metro.tokyo.lg.jp/kotsu/subway_barrierfree_oedo.csv), read 2026-10-25, CP932). One lift's span is printed: 「1F～B3F」 for the A1 entrance (item 17). **Open:** no text puts a lift at the B6 platform level, gives the second lift's span, or says that any mapped escalator edge is step-free; the station-level 「1ルート確保」 is not evidence about these two edges | `wheelchair` on the two escalator edges; lift landing floors |
| 3 | Checklist stop 2 — steps, thresholds or slopes on the B3 concourse (edges 3–7) | G-05 | **FIELD** | The only station-level printed statement is 「1ルートの確保 : 済み」 (Toei station page, Wayback 2026-09-04), which is not a statement about these edges. No text describes the B3 concourse surface | `wheelchair` on 5 walking edges |
| 4 | Checklist stop 2 — posted concourse or passage hours on B3 | G-03 | **FIELD** | No printed concourse or passage hours. The two printed time blocks at this station are the ones the checklist forbids: 「営業時間：11時00分〜20時00分」 under 定期券販売情報 (Toei station page, Wayback 2026-09-04), and exit hours (item 12). Neither is a passage hour | `hours` |
| 5 | Checklist stop 2 — hoarding or closure on the B3 concourse | G-02 (current state) | **FIELD** | Nothing printed addresses these edges. The only closure notice at this station is the unrelated Shinjuku Line exit-2 one (item 16), and no operator text records the state of the B3 concourse, so the absence of a notice is not a statement that the passage is open | closure note |
| 6 | Checklist stop 3 — running direction of the B3→B1 escalator `e:2692fe08625f4a3f92d69a1380a58ccd` | G-06 | **FIELD** | Same as item 1: counts and per-level presence only, no direction text | `direction` |
| 7 | Checklist stop 3 — does a lift serve B3 and B1 | G-05 | **PARTIAL** | Same printed facts as item 2. **Open:** the floors each lift serves. らくらくおでかけネット adds (corroboration only) 「…新宿線エレベーターに乗り換えると、Ｂ1Ｆ改札口に出られます」 — a B1 gate reached by the **Shinjuku Line** lift, not stated to be an Oedo lift | `wheelchair`, lift landings |
| 8 | Checklist stop 4 — the sign wording that names the gate ahead (pre-read of G-09) | G-09 | **PARTIAL** | Printed gate names exist for E-27, exactly two: 「新宿駅改札 Shinjuku Sta. Gate」「マインズタワー方面改札 Maynds Tower District Gate」 under 都営大江戸線新宿駅 (東京都都市整備局, [新宿ターミナル 案内サイン表記集, March 2016, printed p.15](https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_kiban_shinjuku_terminal_pdf_shinjuku_terminal_1_33), text layer; the Marunouchi pair is on printed p.14). **Open:** nothing ties either name to the B1 north gate (`poi:gate:2`) or to a position; see item 29 | POI name/alias |
| 9 | Checklist stop 4 — confirm the fare boundary is edge 14 only | G-07 | **FIELD** | No printed text states which side of any gate line these concourses are on. The card's `paid: true` flags have no text source | fare state |
| 10 | Checklist stop 4 — posted hours on the B1 paid concourse | G-03 | **FIELD** | As item 4 | `hours` |
| 11 | Checklist stop 5 — printed name, number and hours of the B1 north gate `poi:gate:2` | G-09, G-03 | **PARTIAL** | Names as item 8 (two E-27 names, no position). **Open:** the gate's number, its plate wording and its hours are printed nowhere in text; gate hours are not published for E-27 at all | POI name/alias, `hours` |
| 12 | Checklist stop 6 — `hours` on all 14 route edges | G-03 | **FIELD** | Same as item 4. Explicitly not usable: 定期券販売 11:00–20:00; exit hours 6:00–23:00 / 7:00–23:00; first and last trains | `hours` (14 edges) |
| 13 | Checklist stop 7 — step-free on the 11 walking edges and every lift landing | G-05 | **PARTIAL** | Printed: a step-free route exists station-wide (「1ルートの確保 : ○」 障害者設備一覧; 「1ルートの確保 : 済み」 Toei station page), and its ground entrance is named (§3). **Open:** the walking edges themselves, and which landing sits on the paid or free side. The card's `--step-free` alternative (26 edges, 166.3 m) still has no evidence | `wheelchair` (11 edges) |
| 14 | Checklist stop 8 — closures on the paid route | G-02 (current state) | **FIELD** | As item 5: no printed source describes the current state of these 14 edges | closure note |
| 15 | Checklist stop 9 — the printed exit numbers of `poi:exit:1`–`poi:exit:6` | G-08 | **FIELD** | The Toei station page prints one station-level exit list (A1 and 1–8) and does not say which exits belong to S-01 and which to E-27; the six POIs carry positional descriptors only. Nothing prints a number for an E27 exit point, so no plate text can be tied to these six POIs from public text | POI name/alias (exit numbers) |
| 16 | Checklist stop 9 — the closed exit and whether the closure covers an E27 POI | G-08 | **PARTIAL** | The closure itself is settled: 「ミヤコ新宿ビル解体工事に伴い、京王新線・都営新宿線新宿駅２番出口を閉鎖いたします。閉鎖日：２０２４年３月３０日（土）初電より」 (東京都交通局 notice, page dated 2024-01-29, [Wayback 2026-08-26](https://web.archive.org/web/20260826203356id_/https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html)); the Toei exit list read 2026-10-24 still prints exits 1 and 2 閉鎖中. **Open:** the notice is for the shared station's 2番出口 and cannot be attached to `poi:exit:2` by number (the checklist forbids it) | closure note |
| 17 | **Lead's second question** — are E27 exits 2–6 or their nearest lift-equipped exit served by a lift or escalator | G-05 | **PARTIAL** | Printed, and only this: E-27's one named lift entrance is **A1 (マインズタワー口)**, 「停止階 1F～B3F」「設置場所 A1地上出入口(マインズタワー口)～改札口」「バリアフリー1ルート用 TRUE」 (東京都交通局 EV点検 CSV [`130001_bureau-of-transportation.csv`](https://www.opendata.metro.tokyo.lg.jp/kotsu/130001_bureau-of-transportation.csv), 2026-10 edition, Last-Modified 2026-10-15, read and recorded in PR #508). らくらくおでかけネット agrees (corroboration only): 「マインズタワー並びのＡ1出入口にエレベーターがございます」. **Open:** no printed text gives any numbered exit (1–8) a lift or an escalator, so the data's step-free flags on exits 2–6 are neither confirmed nor contradicted by print, and no printed text names the nearest lift-equipped exit to any of the six POIs — A1 is only the one lift entrance printed for E-27. The data's own Hokonavi-sourced descriptors do say `poi:exit:3` 「エレベーターに隣接」 and `poi:exit:4` 「階段とエスカレーターに隣接」, which is adjacency, not service, and is Hokonavi wording rather than operator text | `wheelchair` on the exit connectors |
| 18 | Checklist §5 — G-01 rights | G-01 | **FIELD** | A rights question, not a station fact. The one rights result of this pass is the four store classes in §5, which are a different lane | — |
| 19 | Checklist §5 — G-04 heights and lengths | G-04 | **FIELD** | Needs a measured survey; no printed public source gives heights, clearances or lengths for this concourse | `height`, `length` |
| 20 | Checklist §5 — G-11 PLATEAU street context | G-11 | **FIELD** | A data-ingest question (PLATEAU), not a station fact; no operator or ward text carries it | context geometry |
| 21 | Checklist §5 — G-12 cross-operator continuation | G-12 | **PARTIAL** | The 2016 signage standard prints gate names for **six line groups across five operators** at this station — JR (ミライナタワー改札 / 甲州街道改札 / 新南改札, beside its entrance names); 小田急 (西口地下改札口 / 西口地上改札口 / 南口改札口); 京王線 (京王西口 / 京王百貨店口 / ルミネ口) and 京王新線 (京王新線口 / 新都心口), one operator in two groups; 丸ノ内線 (東改札 / 西改札); 西武線 (正面口改札 / 北口改札) — names only, and this is a signage selection, not a claim to be a complete inventory of every gate at the station. **Open:** no text says which passages connect them, which is what G-12 needs. The JR names are OD-02 A (corroboration only) and cannot be imported | transfer labels |
| 22 | Checklist §5 — G-02 `stale` | G-02 | **FIELD** | Source age; no lookup can settle it | `stale` |
| 23 | Gap table — JR East (SJ) walkable segments `NONE` | G-12 | **FIELD** | Needs S03's CRS and path transform (WP7); no printed text is a geometry source | graph edges |
| 24 | Gap table — Odakyu (SJ) walkable segments `NONE` | G-12 | **FIELD** | Same | graph edges |
| 25 | Gap table — Keio Line (SJ) walkable segments `NONE` | G-12 | **FIELD** | Same | graph edges |
| 26 | Gap table — **Toei CSV PENDING** (駅基本情報 / 障害者設備一覧 / EV点検) | — | **CLOSED** | Acquired 2026-10-24/25 and ruled under the dataset-level CC BY 4.0 claim with the director's field, credit and role conditions (東京都交通局, attributes only, never geometry). Records, acquisition evidence and the mapping rules are in the still-open PR #508 (`docs/gis/research/2026-10-25-toei-csv-rights-and-mapping.md`, `docs/gis/acquisitions/tokyo-toei-*.json`, `tools/gis/sources/sources.yaml`); the acquire and literals guards on that branch pass. The Shinjuku rows read this pass carry the facts used in items 2, 7, 13 and 17 | rights record + attributes |
| 27 | Gap table — Keio New Line + Toei S01 walkable segments `NONE` | G-12 | **FIELD** | Same as item 23; S-01 has no walkable source. The CSV only adds station-level attributes (S-01: 「地上～改札階」エスカレーター欄が空、「地上行エレベーター」「ホーム階行エレベーター」「1ルート確保 ○」「島式」 — 障害者設備一覧, read 2026-10-25) | graph edges |
| 28 | **WP10** — Metro M08: are the 2 held WP4 gate POIs the same physical gates as the shipped S03 pair | G-09 | **PARTIAL** | Printed: Marunouchi has two gate groups with these names — 「東改札」「西改札」, English「East Gate」「West Gate」 (東京都都市整備局 2016 signage table, printed p.14, text layer) — and Tokyo Metro prints the same two in its own accessibility text: 「ホーム（池袋寄り）～東改札」「西改札～Ａ１２番出入口」「東改札～Ａ６番出入口6:00～23:00」「東改札～Ｂ１２a番出入口」「東改札～Ｂ１１番出入口6:00～23:00」 ([Wayback 2026-02-16](https://web.archive.org/web/20260216060552id_/https://www.tokyometro.jp/station/shinjuku/accessibility/index.html)). No source read prints a third Marunouchi gate. **Open, and why this is not CLOSED:** no source states that the two WP4 POIs and the two S03 POIs denote the same physical gates — that rests on both pairs being the east/west gate groups, i.e. on a count and on wording, not on a printed identity. **Consequence for the data lane:** importing `poi:tokyometro-gate:3`/`:4` as new gates would add gates no source prints, so hold them; but do not delete or merge them into `:1`/`:2` on the strength of this document either — the merge needs each POI's own evidence to trace to the same gate (both pairs cite the same accessibility page end points) or a position match. Caveat: the S03 wording 「丸の内線 東口改札口」/「西口改札口」 is printed by no source; the operator forms are 東改札/西改札 | gate POIs (2 held) |
| 29 | Gap table — Toei E27: naming the 3 shipped gate POIs | G-09 | **PARTIAL** | Two printed names, and a second document that cannot be read by this pass. 東京都都市整備局 (2016) puts 「新宿駅改札」「マインズタワー方面改札」 under 都営大江戸線新宿駅 and puts 「JR 新宿駅方面改札」「小滝橋通り方面改札」 under **都営大江戸線新宿西口駅 (E-01)**. The Toei congestion PDF (2020-08-05, [`station07/20200805.pdf`](https://www.kotsu.metro.tokyo.jp/subway/kanren/congestion/forecast/pdf/station07/20200805.pdf)) answers curl with a 212-byte challenge, so this pass could not read it; the `oracle-ego` run `20261025-172753-92939-sjk-online-1` (ChatGPT browsing, 2026-10-25) reports that its extractable table headings include 「JR新宿駅方面改札」 and 「マインズタワー方面改札」, but that table does not establish either gate's station affiliation or floor — the diagram is image-only. That wording is **second-hand, and not printed text under §1's rule**: it is recorded as a gap, not as a source that conflicts with the 2016 table. **Open:** 3 POIs against 2 printed names; matching needs positions (WP7), and the 2020 naming needs a readable copy. | POI name/alias (3 gates) |
| 30 | E27 floor convention — the card walks B6→B3→B1 | G-04, G-05 | **FIELD** | No printed source read this pass states the Oedo platform's floor or the route's floor sequence. The one verified printed floor reference is the Shinjuku Line transfer level: 「新宿線・京王新線新宿駅へは、Ｂ４Ｆにて新宿線エレベーターにお乗り換えとなります」 (らくらくおでかけネット, corroboration only). The Toei congestion PDF ([`station07/20200805.pdf`](https://www.kotsu.metro.tokyo.jp/subway/kanren/congestion/forecast/pdf/station07/20200805.pdf)) answers a 212-byte challenge to curl, so its floor letters are reported by the oracle run and are not taken as evidence here (§4) | floor labels |
| 31 | Store terms — 京王百貨店 新宿 | — | **CLOSED** | Class **corroboration only**. Quote and URL in §5. Official floor guide `https://www.keionet.com/info/shinjuku/floor/`; printed floors 「B1階・MB階・1階–8階・屋上（京王スカイガーデン）」 ([Wayback 2026-10-14](https://web.archive.org/web/20261014182140id_/https://www.keionet.com/info/shinjuku/floor/)). The live site is a システムメンテナンス中 page (1,939 bytes, 2026-10-25), which is the #415 GAP | rights class |
| 32 | Store terms — 伊勢丹新宿店 | — | **FIELD** | **No governing clause found for the store site**, so the question is open, not partly closed. The only official policy read is the holding company's, and it scopes itself to `www.imhds.co.jp`, not `www.mistore.jp` (via oracle-ego / ChatGPT browsing, 2026-10-25); a floor guide from mistore.jp does not supply terms. Class of the store site: **UNKNOWN**. The group clause, were it to govern, would be in the corroboration-only class (§5). Floor guide `https://www.mistore.jp/store/shinjuku/shops.html`; printed floors 「B2F・B1F・1F–7F・RF」 for the main building, with separate メンズ館 and 周辺施設 sections (via oracle-ego) | rights class (still UNKNOWN) |
| 33 | Store terms — 高島屋新宿店 | — | **CLOSED** | Class **corroboration only**. Quote and URL in §5. Floor guide `https://www.takashimaya.co.jp/shinjuku/floor/`; printed floors 「地下1階・1階–14階」 (via oracle-ego; the live floor page returns a 3,880-byte shell to curl, [Wayback 2026-10-10](https://web.archive.org/web/20261010084013id_/https://www.takashimaya.co.jp/shinjuku/floor/)) | rights class |
| 34 | Store terms — 新宿サブナード | — | **CLOSED** | Class **corroboration only**. Quote and URL in §5. Floor guide `https://www.subnade.co.jp/floorguide/` — HTTP 502 live; the [Wayback 2026-10-14](https://web.archive.org/web/20261014182146id_/https://www.subnade.co.jp/floorguide/) snapshot prints only 「B2（駐車場）」 as text and carries the floor map as an image map plus a PDF, so the printed floor range is **not readable** from text | rights class; floors = GAP |
| 35 | Gap table — 丸井 新宿 (no record) | — | **FIELD** | Not researched this pass: the brief named four stores, not this one. Still no source and no terms read; left open rather than guessed | rights class, source |
| 36 | Source class — らくらくおでかけネット (エコモ財団), used in items 7, 17, 30 | — | **CLOSED** | Terms read 2026-10-25, 2 GETs, default UA: 「当サイトの著作権は、エコモ財団にあります。掲載されている情報（文字、画像等）を無断で他のサイトや印刷物などに転載することはできません。…なお、営利目的での利用はお断りいたします。」 (`https://www.ecomo-rakuraku.jp/ja/info/rule.html`, no revision date printed). A commercial-purpose ban → **corroboration only**; it is not in OD-34, so this is a new class entry to record | rights class |

## 3. The one E27 lift that printed text names

Both the operator's dataset and its accessibility portal name the same single ground entrance for E-27's lift, and nothing names another:

- 東京都交通局, 「都営地下鉄各駅エレベーター点検・工事日程データ (2026年10月)」, [`130001_bureau-of-transportation.csv`](https://www.opendata.metro.tokyo.lg.jp/kotsu/130001_bureau-of-transportation.csv): the only E-27 row is 「E-27_01 / 1F～B3F / A1地上出入口(マインズタワー口)～改札口 / バリアフリー1ルート用 TRUE」. The file carries no S-01 row at all, so it says nothing about the Shinjuku Line's lift even though the Toei station page counts one.
- らくらくおでかけネット, 新宿【都営大江戸線】(corroboration only): 「マインズタワー並びのＡ1出入口にエレベーターがございます。まだ、新宿線エレベーターに乗り換えると、Ｂ1Ｆ改札口に出られます。」

Consequence for the data lane: an accessible approach at E-27 exists and its entrance is A1 — printed. Whether exits 1–8 have any step-free approach is not printed anywhere, and the Toei station page's 出入り口情報 tab is populated by JavaScript: the Wayback snapshot (2026-09-04) contains the tab's label but not its content.

## 4. Floor labels: nothing printed confirms B6 → B3 → B1 (flag, no data change)

The route card walks `poi:platform:oedo` (labelled B6) → B3 → B1. Nothing printed this pass confirms that sequence, and nothing printed contradicts it either: no source read names the Oedo platform's floor, so the card's labels are unverified labels rather than printed facts.

Two things are worth the route lane's attention, and neither is usable as evidence here:

- らくらくおでかけネット (corroboration only) prints the Shinjuku Line transfer level as 「Ｂ４Ｆ」, which is not one of the card's three floors.
- The Toei congestion PDF ([`station07/20200805.pdf`](https://www.kotsu.metro.tokyo.jp/subway/kanren/congestion/forecast/pdf/station07/20200805.pdf)) returns a 212-byte challenge to curl, exactly like the Toei station page, so this pass could not read it. The `oracle-ego` run `20261025-172753-92939-sjk-online-1` (ChatGPT browsing, 2026-10-25) reported that its diagram labels B1F, B3F, B4F, B5F and B7F; a diagram label reported second-hand is not printed text under this document's rule, so it is recorded as a **gap** (source unreadable, floor letters unverified), not as a finding about the platform floor.
- The same unreadable PDF is where item 29's second set of 2020 headings (「JR新宿駅方面改札」「マインズタワー方面改札」) comes from: reported by that same run as extractable table headings, not read by this pass, and with no station affiliation or floor established by the table. Item 29 therefore records them as second-hand and as a gap, not as a printed conflict with the 2016 table.

Consequence: do not re-label the platform's floor, and do not attach an official floor name to any of the three floors, until someone reads a text source or the site.

## 5. The four department-store terms, quoted

Governing ruling: a clause that only restricts copying means facts-only is usable; a clause that restricts use beyond private use — or bans commercial use — means corroboration only, even without the words 営利 or 商用 (director's ruling of 2026-10-25, `docs/research/merchants/dept-store-terms-2026-10-25.md` in #502; see also #501 comment 6394872033). Applied here:

| Store | Page | Quote (verbatim) | Read | Class |
|---|---|---|---|---|
| 京王百貨店 新宿 | `https://www.keionet.com/info/sitepolicy/` | 「当ウェブサイト・ブログに掲載されている全ての情報（文章・画像等）は、特別な場合を除き、著作権法等関係法令で保護されています。閲覧につきましては自由ですが「私的利用」または「引用」などは著作権法等関係法令上認められた場合を除き利用することを禁止いたします。」 | [`Wayback 2026-02-26`](https://web.archive.org/web/20260226170412id_/https://www.keionet.com/info/sitepolicy/); live site is a maintenance page | **corroboration only** |
| 高島屋新宿店 | `https://www.takashimaya.co.jp/aboutinfo/` | 「当社ウェブサイトのコンテンツのご利用は著作権法に定める個人の私的使用のみに限ります。個人の私的使用の範囲を超えて、当社の書面による承諾を得ずにコンテンツの全部または一部を転載、使用、複製、配布、変造、販売等を行うことはできません。」 | [`Wayback 2025-02-14`](https://web.archive.org/web/20250214092722id_/https://www.takashimaya.co.jp/aboutinfo/); live page confirmed via oracle-ego | **corroboration only** |
| 新宿サブナード | `https://www.subnade.co.jp/legal/` | 「当サイトに掲載されている内容を無断使用することはできません。」 (in １ 著作権について, under a clause stating the rights in the site's designs, photographs, text and logos belong to 新宿サブナード株式会社 or its licensors) | [`Wayback 2026-10-12`](https://web.archive.org/web/20261012202212id_/https://www.subnade.co.jp/legal/); live site returns HTTP 502 | **corroboration only** |
| 伊勢丹新宿店 | `https://www.imhds.co.jp/corporate/terms/index.html` (group site only) | 「著作権者の事前の許可なく、これらの情報を利用（複製、改変、配布、公衆送信等を含みます。）することはできません。」 | via oracle-ego / ChatGPT browsing, 2026-10-25; no revision date printed | store site **UNKNOWN** (policy scopes itself to `www.imhds.co.jp`, not `mistore.jp`); the group clause, if it governed, would be corroboration only |

Notes:

- 京王 and サブナード URLs are the only archived copies read; both live hosts were unreadable (maintenance page, HTTP 502), matching the GAPs already recorded in #415.
- The 伊勢丹 result does **not** settle that store. A group-company policy that names its own domain is not the store site's terms, and no mistore.jp policy page was read.
- **Follow-up for the director:** OD-34 §2 lists LUMINE, NewoMan, LUMINE EST, atré, ISP, Tobu Hope Center, Tobu Department Store, Tokyo Metro and Metro Properties as facts-only, while these four clauses are of the same private-use-only shape and are classed corroboration-only under the #502 ruling. The two readings should be reconciled in one line of OD-34 rather than per store.

## 6. Import-ready closures (proposal only — nothing is changed here)

For a later data PR. Each row is a printed fact with its source; none is applied to `pois.json` or `graph.json` by this document.

| Fact | Printed text | Source · date | Where it would go | Blocker |
|---|---|---|---|---|
| 京王新線・都営新宿線 新宿駅 2番出口 closed | 「ミヤコ新宿ビル解体工事に伴い、京王新線・都営新宿線新宿駅２番出口を閉鎖いたします。閉鎖日：２０２４年３月３０日（土）初電より」 | 東京都交通局 + 京王電鉄, notice dated 2024-01-29 ([Wayback 2026-08-26](https://web.archive.org/web/20260826203356id_/https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html)) | closure note on the **S-01** side of the shared station | the POI it belongs to is unset: the closure cannot be attached to `poi:exit:2` by number (checklist stop 9 rule) |
| Exits 1 and 2 still printed 閉鎖中 | exit list text | Toei station page, read 2026-10-24 (WP4); the Wayback 2026-09-04 snapshot does not carry the list (JavaScript) | same | same |
| E-27 lift entrance = A1 マインズタワー口, 1F～B3F | 「A1地上出入口(マインズタワー口)～改札口」 | Toei EV inspection CSV, 2026-10 edition | `accessRoute` / lift attribute | attributes only under the #508 ruling; it is a span between an entrance and a gate, so it is **not** a match to `poi:toei-exit:a1` (recorded in #508 §4) |
| E-27 has a ground lift and a platform lift, 1ルート確保 | 「地上行エレベーター」「ホーム階行エレベーター」「1ルート確保（エレベーター等）: ○」 | Toei 障害者設備一覧, read 2026-10-25 | station-level accessibility attribute | no station-level Toei POI exists to hold it (#508 §4) |
| Marunouchi gates = 東改札 + 西改札, and no third gate is printed | 「東改札」「西改札」 | Metro accessibility (Wayback 2026-02-16); TMG signage table 2016 (printed p.14) | hold `poi:tokyometro-gate:3`/`:4`; do **not** import them as new gates | printed identity of the two POI pairs is unproven, so a merge is a data-lane decision on each POI's own evidence, not an import from this document; S03 wording 東口改札口/西口改札口 is printed nowhere |

## 7. Fetch log

All GETs with curl's default User-Agent, ≥0.6 s apart, 2026-10-25 UTC. `id_` = raw original bytes from Wayback. Two `oracle-ego` runs are listed separately (they are ChatGPT browsing, not curl).

| Time (UTC) | Status · bytes | URL | Outcome |
|---|---|---|---|
| 08:23:00 | 200 · 6,848 | `web.archive.org/cdx/…kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | CDX list |
| 08:23:05 | 200 · 1,539 | `web.archive.org/cdx/…tokyometro.jp/station/shinjuku/accessibility/index.html` | CDX list |
| 08:23:08 | 200 · 3,704 | `web.archive.org/cdx/…tokyometro.jp/station/shinjuku/index.html` | CDX list |
| 08:23:17 | 200 · 15,255 | `web.archive.org/web/20261008072439id_/…/tokyometro.jp/station/shinjuku/index.html` | exit table is JS-loaded; only 「改定日：2019年7月5日」 static |
| 08:23:19 | 200 · 81,032 | `web.archive.org/web/20260216060552id_/…/tokyometro.jp/station/shinjuku/accessibility/index.html` | **東改札 / 西改札 quotes** |
| 08:23:21 | 200 · 18,710 | `web.archive.org/web/20260904120052id_/…/kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | equipment counts, 定期券販売 hours, 管理駅 note |
| 08:23:54 | 200 · 10,010 | `web.archive.org/cdx/…mistore.jp/store/shinjuku*` | CDX list |
| 08:24:24 | 503 · 11,832 | `web.archive.org/cdx/…imhds.co.jp*` | Internet Archive 503; not retried |
| 08:24:36 | 000 | `takashimaya.co.jp` | timeout (HTTP/2 stream error, then `--http1.1` timeout) → Wayback |
| 08:24:37 | 200 · 1,939 | `keionet.com` | メンテナンス中 page → confirms the #415 GAP |
| 08:24:38 | 000 | `subnade.co.jp` | connection refused → Wayback |
| 08:24:41 | 000 | `mistore.jp` | timeout → oracle-ego |
| 08:25:38 | 200 · 3,345 | `web.archive.org/cdx/…keionet.com/*` | CDX list |
| 08:26:06 | 000 | `web.archive.org/cdx/…takashimaya.co.jp/*` (domain wildcard) | 60 s timeout; retried narrowly at 08:40 |
| 08:27:07 | 000 | `web.archive.org/cdx/…mistore.jp/*` (domain wildcard) | 60 s timeout; retried narrowly at 08:36 |
| 08:28:15 | 200 · 288 | `web.archive.org/cdx/…keionet.com/info/sitepolicy/` | CDX list |
| 08:28:22 | 503 · 11,832 | `web.archive.org/cdx/…subnade.co.jp/*` | 503; retried at 08:33 |
| 08:28:30 | 200 · 21,937 | `web.archive.org/web/20260713184647id_/…keionet.com/circle/company/sitepolicy.html` | older Keio policy, same substance |
| 08:29:10 | 200 · 1,283 | `web.archive.org/cdx/…keionet.com/info/shinjuku/*` | CDX list |
| 08:29:13 | 200 · 281 | `web.archive.org/cdx/…keionet.com/corp/company/policy*` | CDX list |
| 08:29:22 | 200 | `web.archive.org/cdx/…keionet.com/info/shinjuku/` | CDX list |
| 08:29:29 | 200 | `web.archive.org/cdx/…keionet.com/info/shinjuku/floor/` | CDX list |
| 08:29:36 | 200 | `web.archive.org/web/20261014182140id_/…keionet.com/info/shinjuku/` | floor labels |
| 08:30:16 | 200 · 1,939 | `keionet.com/info/sitepolicy/` | maintenance page |
| 08:30:19 | 200 · 87 | `web.archive.org/cdx/…keionet.com/info/shinjuku/event*` | CDX list |
| 08:31:10 | 200 · 13,812 | `web.archive.org/web/20260226170412id_/…keionet.com/info/sitepolicy/` | **京王 terms clause** |
| 08:33:03 | 200 · 2,670 | `web.archive.org/cdx/…subnade.co.jp/*` | CDX list |
| 08:33:23 | 200 · 2,150 | `web.archive.org/cdx/…subnade.co.jp/*` (second form) | CDX list |
| 08:33:31 | 200 · 240 | `web.archive.org/cdx/…subnade.co.jp/policy/` | CDX list |
| 08:33:32 | 200 · 248 | `web.archive.org/cdx/…subnade.co.jp/` | CDX list |
| 08:33:39 | 200 · 37,194 | `web.archive.org/web/20261012202224id_/…subnade.co.jp/policy/` | 営業時間 ショップ 10:30–21:00 / レストラン 11:00–22:00 |
| 08:33:47 | 200 · 80,022 | `web.archive.org/web/20261012202003id_/…subnade.co.jp/` | top page |
| 08:33:56 | 200 · 240 | `web.archive.org/cdx/…subnade.co.jp/legal/` | CDX list |
| 08:34:02 | 200 · 28,485 | `web.archive.org/web/20261012202212id_/…subnade.co.jp/legal/` | **サブナード clause** |
| 08:36:49 | 200 · 5,568 | `web.archive.org/cdx/…mistore.jp/store/shinjuku/*` | CDX list; no store policy page archived |
| 08:37:07 | 200 · 1,522,313 | `toshiseibi.metro.tokyo.lg.jp/…/pdf_kiban_shinjuku_terminal_pdf_shinjuku_terminal_1_33` | **TMG signage table (text layer)** |
| 08:37:08 | 200 · 67,176 | `city.shinjuku.lg.jp/kusei/toshikei01_002159_00001.html` | 4 ward map PDFs, updated R7.11 |
| 08:37:10 | 200 · 68,909 | `ecomo-rakuraku.jp/ja/station/新宿/` | **A1 lift text** (corroboration only) |
| 08:40:45 | 200 · 114 | `web.archive.org/cdx/…takashimaya.co.jp/shinjuku/` | CDX list |
| 08:40:46 | 200 · 1,824 | `web.archive.org/cdx/…mistore.jp/store/shinjuku.html` | CDX list |
| 08:40:56 | 200 · 11,348 | `web.archive.org/web/20261014182152id_/…takashimaya.co.jp/shinjuku/` | store top page |
| 08:41:06 | 200 · 527 | `web.archive.org/cdx/…takashimaya.co.jp/aboutinfo/` | CDX list |
| 08:41:08 | 200 · 72 | `web.archive.org/cdx/…takashimaya.co.jp/shinjuku/floor/` | CDX list |
| 08:41:54 | 200 · 1,882 | `web.archive.org/cdx/…takashimaya.co.jp/about/ab_policy.html` | CDX list |
| 08:42:02 | 200 · 17,081 | `web.archive.org/web/20250214092722id_/…takashimaya.co.jp/aboutinfo/` | **高島屋 clause** |
| 08:42:55 | 200 · 3,880 | `web.archive.org/web/20261010084013id_/…takashimaya.co.jp/shinjuku/floor/` | JS shell; floors via oracle-ego |
| 08:42:56 | 200 · 144 | `web.archive.org/cdx/…keionet.com/info/shinjuku/floor/` | CDX list |
| 08:42:58 | 200 · 100 | `web.archive.org/cdx/…subnade.co.jp/floorguide/` | CDX list |
| 08:43:08 | 200 · 31,126 | `web.archive.org/web/20261014182140id_/…keionet.com/info/shinjuku/floor/` | **B1・MB・1–8F・屋上** |
| 08:43:11 | 200 · 117,641 | `web.archive.org/web/20261014182146id_/…subnade.co.jp/floorguide/` | image map + PDF; text carries only B2 (駐車場) |
| 08:43:22 | 200 · 146 | `web.archive.org/cdx/…sub_i_2024012911347_h.html` | CDX list |
| 08:43:29 | 200 · 17,158 | `web.archive.org/web/20260826203356id_/…sub_i_2024012911347_h.html` | **exit 2 closure notice (2024-01-29)** |
| 08:52 | 200 · 2,762,327 | `city.shinjuku.lg.jp/content/000423322.pdf` | エレベーター・階段マップ R7.11; **no text layer** (`pdftotext` → 2 bytes) → image only |
| 08:57 | 200 · 10,503 | `ecomo-rakuraku.jp/ja/info/rule.html` | **らくらくおでかけネット terms** (2 GETs, same URL, duplicate by mistake) |
| 09:07 | 200 · 212 | `kotsu.metro.tokyo.jp/subway/kanren/congestion/forecast/pdf/station07/20200805.pdf` | 212-byte challenge (same Incapsula response as the station page) → **GAP**, PDF unread; its diagram floor letters stay unverified (§4) |

Local reads with no HTTP request: the four Toei CSV rows used in §3 (from the acquisition store recorded in PR #508), and `pdftotext` on the TMG PDF.

Not in the log: the live Toei station page `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html`, tried earlier in the pass, answered a 212-byte Incapsula challenge and is one of the 58 requests; the Wayback snapshot 2026-09-04 above replaced it.

`oracle-ego` runs: `20261025-172753-92939-sjk-online-1` (station sources; confirmed the TMG PDF, the Toei closure notice, らくらくおでかけネット and the Metro accessibility page, and found no text for escalator direction or passage hours) and `20261025-173937-7107-sjk-stores-1` (the four store policy pages and floor guides; the 伊勢丹 scope limitation is its finding).

## 8. Open items this pass did not settle

1. Metro M08 gate identity (WP10) — the names and the count of two are printed; the identity of the WP4 POIs with the S03 pair is not, so nothing is merged or imported on this document's authority (item 28).
2. E27 gate naming — two printed names against three POIs (the 2016 metropolitan table puts 「JR 新宿駅方面改札」 under E-01); the 2020 Toei congestion PDF adds the same two headings second-hand via the oracle run, with no station affiliation stated and no readable copy in this pass (item 29).
3. The Oedo platform's floor and the route's floor sequence — no printed source read; the Toei congestion PDF could not be fetched (§4, item 30).
4. Passages and concourse hours for the whole walk stay `hours: null`: nothing printed states them, and the three time blocks that do exist (ticket office, exit hours, first/last train) are the known traps (items 4, 10, 12).
5. 伊勢丹新宿店 — the store site's own terms page was never read; only the group policy was, and it does not cover `mistore.jp` (item 32).
6. 丸井 新宿 — no source and no terms read (item 35).
7. 新宿サブナード — the floor range is image-only and the live site returns 502 (item 34).
8. 京王百貨店 — the live site is still a maintenance page; the terms and floors come from Wayback only (item 31).
