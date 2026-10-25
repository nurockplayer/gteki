# Shinjuku route gap closure: G-09, G-08, G-03

Investigates the three source gaps named in the Shinjuku first-slice route card (card #484; its file `docs/research/routes/shinjuku-first-slice-route.md` exists only in that draft PR, so the card is cited by PR number) and records what could and could not be established. **None of the three closes.** Work done 2026-10-25; request log in §7.

**No station data was changed.** Every sentence below either confirms an existing gap row or records a negative result. Nothing here is a new source for the E27 bundle: no source id is added and no `sourceIds` array is changed.

Sources allowed for this task: 東京都交通局 (facts only), Tokyo Metro, Metro Properties. JR East, odakyu.jp and keio.co.jp were corroboration-only and were not needed. Rights classes follow OD-34 and are stated per quotation.

## 1. What was asked

| Gap | What was asked | Why it matters on the card |
| --- | --- | --- |
| **G-09** | Find the operator's official name for the B1 ticket gate behind `poi:gate:2` (大江戸線 新宿駅, north side), from Toei's station page or station map, or from Tokyo Metro / Metro Properties if they print it. Record the quote, URL and date. Match it to the E27 POI **by printed name only, never by position**; if it cannot be matched by name, say so. | The destination is a descriptor derived from position; if an operator name exists, the POI's name could rest on it instead. |
| **G-08** | Find Toei's official notice for the exit 1 / exit 2 closures: dates, scope and the exit names as printed. Say whether those names or numbers can be matched **by printed name** to any E27 `poi:exit:*`; if they cannot, record that as the finding. | The card refuses an exit-terminating route because no exit has a verified current status. |
| **G-03** | Look for printed opening hours for the Toei Shinjuku concourse or the passages on the route. First and last train times are **not** passage hours and must not be used as such. | All 14 edges carry `hours: null`; the router reports `hours` on every step. |

## 2. Verdicts

| Gap | Verdict | One line |
| --- | --- | --- |
| **G-09** | **GAP — no printed-name match exists for the B1 north-side gate.** | Toei prints gate labels only as remarks on its shared S01/E27 exit list (A1 【マインズタワー方面改札】, exits 3–5 【京王新線口】, exits 6–8 【新都心口】), attaches none of them to the 大江戸線 B1 concourse, and `poi:gate:2` prints only a positional descriptor; matching any of those labels to the POI would be a position inference. |
| **G-08** | **GAP — the notice is the 新宿線's exit 2 and cannot be matched by printed name to any E27 `poi:exit:*`.** | The notice closes 「新宿線新宿駅2番出口」 of 京王新線・都営新宿線 新宿駅 from the first train of 2024-03-30, reason ミヤコ新宿ビル demolition, no end date printed; every E27 exit POI carries "Exit number/name not in source (coverage gap)", so there is no printed number on the E27 side to match, and the shared Toei page does not attribute exit 2 to 大江戸線. The mapping stays UNKNOWN. |
| **G-03** | **GAP — no printed concourse or passage hours were found.** | The only operator hours on record are exit hours (exits 4–7 6:00–23:00, exit 8 7:00–23:00), which cover neither the B1 north gate nor the passages on the route; no first/last train time was used, so `hours: null` and the router's `hours` warnings stand. |

**Bottom line: none of the three gaps closes.** G-09 and G-08 are now checked rather than assumed: the operator does print gate-like labels and an exit number, but its text never ties any of them to the E27 side, and the E27 POIs carry no printed names or numbers to match against. G-03 has no operator page to cite at all. The card's G-03, G-08 and G-09 rows remain an accurate statement of what is and is not known.

The one thing this task changes for planning: Toei now refuses plain HTTP clients outright (§3.1), so any future re-check of these three gaps needs a browser read, and must be recorded as a browser read — the 2026-10-22 records cited below cannot be refreshed with `curl`.

## 3. Evidence

### 3.1 Reachability of the three operators' sites (2026-10-25)

**Toei (kotsu.metro.tokyo.jp): GAP.** Six requests, all refused:

- Five URLs fetched with `-A 'Mozilla/5.0'` — the 新宿 station page, `/subway/stations/json/shinjuku.json`, the closure notice HTML, the closure notice PDF and the 構内図 image `.../shinjuku/i/solid.png` — each returned the **same 212-byte interstitial** (`sha256 d02032286070b4dd9d8fbd985a7bdca8af8edf52b89ff177db3bfcb2c8a9c43d`, an `_Incapsula_Resource` shell, no `Content-Type` respected: the "PDF" and the "PNG" came back as the same HTML).
- The same notice URL fetched with curl's **default User-Agent** returned an 848-byte block page reading 「Request unsuccessful. Incapsula incident ID: 561000810075932564-186797860135703625」.

Under the brief's rule ("a 403 or challenge is a GAP"), Toei is a GAP for plain HTTP. Everything quoted from Toei in §3.2–3.4 therefore comes from the project's **browser reads of 2026-10-22** (DR-SJ-01, DR-SJ-05, DR-SJ-07, DR-SX-01), not from a re-read today. The labels are quoted as those records have them. §3.5 records one secondary browser read made by `oracle-ego` today; it is marked UNVERIFIED and is not quoted.

**Tokyo Metro: GAP.** Both the M08 新宿 station page (`https://www.tokyometro.jp/station/shinjuku/`) and its 構内図 (`https://www.tokyometro.jp/station/shinjuku/yardmap/index.html`) returned **403** (396 and 422 bytes). No Tokyo Metro text was obtained, so it says nothing about G-09 either way.

**Metro Properties: no 新宿 entry seen.** `https://www.metro-pro.jp/` — the domain recorded in OD-34 — returned 200 (12,476 bytes) with no `新宿` and no `改札` string on the top page. No deeper page was queried, so the finding is only that the operator's top page shows no 新宿 facility to look at. Two wrong-domain probes are logged in §7 so nobody repeats them: `www.metro-properties.com` resolves to an Azure host whose certificate does not match the name (TLS failure, no HTTP response), and `www.metro-properties.co.jp` does not resolve.

### 3.2 G-09 — the B1 north-side gate has no operator name in the text read

**The E27 side (repo, `stations/shinjuku/gteki/pois.json`, unchanged):** the E27 bundle carries three ticket-gate POIs, all three positional descriptors:

| POI | Printed name (ja) | Printed name (en) |
| --- | --- | --- |
| `poi:gate:1` | 改札（地下1階・北西側） | Ticket gates (B1, northwest side) |
| `poi:gate:2` | 改札（地下1階・北側） | Ticket gates (B1, north side) |
| `poi:gate:3` | 改札（地下2階・南東側） | Ticket gates (B2, southeast side) |

`poi:gate:2`'s own note reads "Position is approximate, taken from the mapped ticket gates" (ja: 「位置は地図上の改札の位置から求めた目安です。」), and its evidence method reads "toll transition links clustered (≤30 m) + GSI F106 ≤8 m; 1 gate link(s); F106 points nearest this cluster on this level: 4". There is no operator name or number anywhere in the three POIs. The operator-named gate POIs that do exist in the bundle (`poi:jreast-gate:*`, `poi:tokyometro-gate:*`, `poi:keio-gate:*`, `poi:odakyu-gate:*`) belong to other operators' stations, are search-only and are never route evidence (card G-09).

**The operator side (DR-SJ-01, DR-SX-01; page read 2026-10-22):** the Toei 新宿 page is **one page for 新宿線 S01 and 大江戸線 E27**. Its 出入口一覧 lists A1 and 1–8. The only gate-like strings it prints are remarks on those exit entries:

- A1 — 【マインズタワー方面改札】
- exits 3, 4, 5 — 【京王新線口】
- exits 6, 7, 8 — 【新都心口】
- exits 1 and 2 — 閉鎖中 (no gate label)

Two facts from the same record matter here: the 大江戸線 block of the page "lists no exits of its own", and "the page does not say which exits belong to E27 and which to S01 except through these tags". The record also notes that the page does not say which line A1's lift serves — the same page never says which line the マインズタワー方面改札 serves.

**Matching attempt, by printed name only:**

- `poi:gate:2` prints 「改札（地下1階・北側）」 / "Ticket gates (B1, north side)". None of the three operator labels appears in it. There is therefore **no printed-name match**.
- The nearest candidate is 【マインズタワー方面改札】, the only printed label that could conceivably belong to an E27 gate. It fails the test twice: the POI does not print it, and the operator text does not state that this gate serves 大江戸線 (A1's line is exactly what DR-SX-01 leaves UNKNOWN). Adopting it would require deciding that A1, its gate label and the B1 north-side gate are the same facility — a position/geometry inference, which this task forbids.
- 【京王新線口】 and 【新都心口】 are weaker candidates still: the repo already uses exactly those words as Keio gate names (`poi:keio-gate:1` 「京王新線　京王新線口」, `poi:keio-gate:2` 「京王新線　京王新線口」, `poi:keio-gate:3` 「京王新線　新都心口」), so attaching either to an E27 gate would create a naming collision. Two gates sharing a name is not impossible, so this is a reason for care, not proof; the decisive point remains that the operator never prints either label for an E27 gate.

**The one artefact not checked:** the 構内図 is an image (`.../shinjuku/i/solid.png`), recorded on 2026-10-22 as not read; today it returns the 212-byte interstitial (§3.1). So the statement this document supports is "**no operator text read prints a name for the E27 B1 north-side gate**", not "no such name exists". A gate label on the 構内図 image would still have to be tied to `poi:gate:2` by something other than position to satisfy this gap, since the POI prints no name to match it against.

**Verdict: GAP.** `poi:gate:2` keeps its descriptor; G-09 stays open. What would close it is an operator source that both prints a gate name and states which line and which concourse that gate serves, together with a POI-level source carrying the same name — position is not evidence and was not used.

### 3.3 G-08 — the closure notice is the 新宿線's, and the E27 side prints no exit numbers

**The notice (DR-SJ-05; HTML and PDF read 2026-10-22):**

- Title as printed: 「新宿線新宿駅2番出口の閉鎖について」 — URL `https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html`, PDF `.../pdf/2024/sub_i_2024012911347_h_01.pdf`.
- Date: news dated **2024-01-29**. Issuers: 京王電鉄株式会社 / 東京都交通局 (a joint announcement).
- Printed scope: **2番出口** of 京王新線・都営新宿線 新宿駅, "a jointly used station". The notice never names 大江戸線.
- Closure: **from the first train of 2024-03-30**. Reason: **ミヤコ新宿ビル demolition**. **No end date is printed.**
- What else the notice does not print: which passage or which gate exit 2 served, and any step-free statement; those exist only on a detour drawing in the PDF, which the record marks as not transcribed. Contact given is the Keio customer centre. (Keio's own copy of the notice returned 503 when the record was made.)

**The page state (DR-SJ-01, 2026-10-22):** exits **1 and 2** are tagged 閉鎖中. Exit 2 has no gate label and no hours, and no lift or escalator icon; its nearby-landmark list names JR東京総合病院, JR新宿ビル, ミヤコ新宿ビル and バスタ新宿. The record has **no reason for exit 1's closure** and no notice covering exit 1 — the only notice on file is for exit 2.

**The E27 side (repo):** all six exit POIs carry the same evidence note — "Exit number/name not in source (coverage gap); the words in the name are descriptors, not official exit numbers" — and names like 「出口（地上・北側・階段に隣接・屋根あり）」 / "Exit (street level, north side, next to stairs, roofed)". **No E27 exit POI prints an exit number or an operator exit name.**

**Matching attempt, by printed name only:**

- To match 「2番出口」 to `poi:exit:2` the only shared token is the digit in the **internal id**. The id is not a printed name, and the POI's own evidence note says the source carries no exit number. Using the id digit would be precisely the kind of inference this task excludes, so it was **not** used.
- The notice's own scope is a further obstacle: it is titled and written for the **新宿線 / 京王新線** station. The shared Toei page does not attribute exits 1–8 to a line except through the gate labels, and exit 2 has none — so even the operator's own text does not put exit 2 on the E27 side.

**Verdict: GAP, recorded as the finding.** The notice's exit names/numbers **cannot** be matched by printed name to any E27 `poi:exit:*`; the mapping stays UNKNOWN. Two consequences were already on the card and are unchanged: no exit POI may be tagged closed, and the router carries no closure state, so a route to a street exit would still be presented as usable. What would close it is two things together: an operator page or map that prints the exit numbers of the **大江戸線** station's exits, **and** a source-supported identification of which E27 `poi:exit:*` is that physical exit. An exit number merely attributed to E27 is not enough — none of the six POIs prints a number, so picking one by its id suffix would repeat exactly the inference §4(2) forbids.

### 3.4 G-03 — no printed concourse or passage hours

- The only operator hours on record are **exit** hours from the Toei 新宿 page (DR-SJ-01, 2026-10-22): exits **4, 5, 6, 7 — 6:00～23:00**; exit **8 — 7:00～23:00**; A1, 3 and the closed 1, 2 show no hours. These are street/exit hours, they are not concourse hours, and none of those exits is on the route (the route ends at the B1 gate).
- No Toei text read prints opening hours for the concourse, the B1 gate or the two passages between them. The same applies to the 大江戸線 block of the page, which prints no exits of its own (DR-SX-01).
- Tokyo Metro returned 403 and the Metro Properties top page shows no 新宿 facility (§3.1), so there was no second operator to check.
- **First/last train times were not collected for this purpose and were not used.** Even if an operator printed them, they describe train service, not when a passage is open, and the brief excludes them.
- **No inference was made** that a subway concourse is open from first train to last train; that would be a general assumption, not a printed fact.

**Verdict: GAP.** `hours` stays `null` on all 14 edges, and the router keeps reporting `hours` on every step. The card's G-03 row stands unchanged.

### 3.5 Secondary web lookup (`oracle-ego`), UNVERIFIED

Because Toei refuses plain HTTP, one `oracle-ego` lookup (ChatGPT with web browsing; run dir `~/.local/state/oracle-ego/runs/20261025-135541-42365-ds-sjk-gap-lookup`) was asked the same three questions. **Its reply is a lead, not evidence.** The first pass named the documents it read but gave no URLs, so none of it can be quoted with a URL and date as the brief requires. A follow-up asking for exact URLs did not run — the shared oracle browser space was at its page budget (§8) — so every item below stays **UNVERIFIED** until a URL exists.

What it reported, and how it touches the verdicts:

1. **構内図 labels both B1F gates simply 「改札」.** It says the Toei 構内図 (a 2025 PDF) prints only 「改札」 at both B1F gate positions, with no north/south or any other name. If confirmed this is a *negative* finding for G-09 — the operator has no distinct printed gate name at all — and changes no verdict.
2. **マインズタワー口 names an exit, not a gate.** It says a 2026-06 official elevator-inspection document writes 「A1地上出入口(マインズタワー口)～改札口」, i.e. マインズタワー口 is the ground exit's name. If confirmed it strengthens §3.2: マインズタワー方面改札 must not be moved onto `poi:gate:2`.
3. **Closure notice, agreeing with DR-SJ-05.** It reports the same title, date, reason and scope — closure 「令和6年3月30日（土）始発より」, 「ミヤコ新宿ビル解体工事に伴い」, scope 「２番出口」, no reopening date — and adds that the PDF marks 「迂回路」「閉鎖出口」「京王新線通路」 without declaring the whole passage closed. That agrees with DR-SJ-05's note that the notice states no passage closure in text.
4. **Exit 1 on the map.** It reports the 構内図 still marking 2番出口 「閉鎖中」 today, but says it could **not** confirm the same mark on 1番出口. This does not contradict DR-SJ-01: that record is the **page's 出入口一覧**, which tags both exits 1 and 2 as 閉鎖中; the 構内図 is a different artefact, and DR-SJ-01 never claimed the map shows exit 1 closed. Whether the map shows exit 1 as open is UNKNOWN.
5. **Hours: NOT FOUND, plus one trap.** It reports no concourse or passage hours, and warns that the station page's 「営業時間：11時00分〜20時00分」 belongs to the **定期券販売情報** (ticket-office) block — not concourse hours. That trap is now on record for G-03: if it is ever seen again, it must not be read as passage hours.

None of the five items changes a verdict. The lookup's value is that an independent browser read also found no gate name and no passage hours — consistent with §3.2 and §3.4 — not that it supplied a source.

## 4. What must not be done with this document

1. **Do not rename or alias `poi:gate:2`** with マインズタワー方面改札, 京王新線口 or 新都心口. None is a printed-name match (§3.2); the first would be a position inference, and the last two are already Keio gate names in the same bundle.
2. **Do not use the digits in `poi:exit:*` ids as official exit numbers.** The ids are internal, and the POIs' evidence notes say the source carries no exit number.
3. **Do not attach the closure notice to `poi:exit:1` or `poi:exit:2`, and do not mark either exit closed in the bundle.** The notice is the 新宿線's exit 2, the E27 mapping is UNKNOWN, and the router has no closure state to carry it.
4. **Do not populate `hours`** from exit hours, from facility hours, or from first/last train times.
5. **Do not treat this document as a source at all.** It adds no source id and no newly cleared text; the Toei text it quotes is already registered as DR-SJ-01, DR-SJ-05, DR-SJ-07 and DR-SX-01 (FACTS_ONLY_REFERENCE, OD-34 round 2).

## 5. Source register

**No new rows.** This worker read no operator page on 2026-10-25, so there is nothing new to register. The block pages fetched today (one 212-byte Incapsula interstitial, one 848-byte incident page, two 403 pages) are access results, not sources, and are recorded only in §7. The Toei quotations above reuse DR-SJ-01, DR-SJ-05, DR-SJ-07 and DR-SX-01 with their existing rights classes. The `oracle-ego` reply (§3.5) is not a source: it supplied no URL and is marked UNVERIFIED item by item.

## 6. Not used, and why

| Artefact | Why not |
| --- | --- |
| Toei 構内図 image (`.../shinjuku/i/solid.png`) | Never read (DR-SJ-01); today it returns the Incapsula interstitial. It is the only operator artefact that might label a gate by name, so its status is UNREAD, not "checked and empty". |
| Closure notice PDF detour drawing | Recorded as not transcribed (DR-SJ-05). It is not transcribed here, so it establishes no POI match; a drawing could in principle carry printed numbers or names, which would still need a source-supported identification of the specific POI. |
| Toei store lists (`/other/kanren/stores/shinjuku.html`, DR-SJ-03/04) | Facts only under OD-34 round 2, and they print shops, not gates; not queried today. |
| Toei site policy (`/riyo/`) | Already recorded as an Incapsula block (OD-34 round 5(d)); not retried, and no rights conclusion here depends on it. |
| S03 search-only gate POIs (JR / Metro / Keio / Odakyu gates in `pois.json`) | Another operator's gates, search-only, never route evidence (card G-09). They show the project already treats 京王新線口 and 新都心口 as Keio-side gate names — an argument against reusing those labels for E27, not a source for an E27 gate name. |
| JR East, odakyu.jp, keio.co.jp | Corroboration only under OD-34; there is no claim here to corroborate. Keio's copy of the closure notice returned 503 when DR-SJ-05 was made. |
| らくらくおでかけネット and Yahoo!乗換案内 route strings (DR-SJ-13/14) | Not operator text. They print 「マインズタワー方面改札」 inside a route string, which is a lead only and cannot be used to match or rename a POI. |
| Tokyo Metro 新宿 pages | 403 today (§3.1); nothing obtained. |

## 7. Request log

Plain `curl`, ≥0.8 s apart, **9 HTTP requests** of the 40 allowed. Times JST, 2026-10-25.

| # | Time | URL | User-Agent | Result |
| --- | --- | --- | --- | --- |
| 1 | 13:54 | `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html` | Mozilla/5.0 | 212-byte Incapsula shell (sha256 `d0203228…c43d`) |
| 2 | 13:54 | `https://www.kotsu.metro.tokyo.jp/subway/stations/json/shinjuku.json` | Mozilla/5.0 | same 212-byte shell |
| 3 | 13:54 | `https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html` | Mozilla/5.0 | same 212-byte shell |
| 4 | 13:54 | `https://www.kotsu.metro.tokyo.jp/pickup_information/news/pdf/2024/sub_i_2024012911347_h_01.pdf` | Mozilla/5.0 | same 212-byte shell (HTML, not PDF) |
| 5 | 13:54 | `https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku/i/solid.png` | Mozilla/5.0 | same 212-byte shell (HTML, not PNG) |
| 6 | 13:56 | `https://www.tokyometro.jp/station/shinjuku/` | Mozilla/5.0 | **403** (396 bytes) |
| 7 | 13:56 | `https://www.tokyometro.jp/station/shinjuku/yardmap/index.html` | Mozilla/5.0 | **403** (422 bytes) |
| 8 | 13:57 | `https://www.metro-pro.jp/` | Mozilla/5.0 | 200 (12,476 bytes); no `新宿`, no `改札` |
| 9 | 13:58 | `https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2024/sub_i_2024012911347_h.html` | curl default | 848-byte block page, 「Request unsuccessful. Incapsula incident ID: 561000810075932564-186797860135703625」 |

Non-HTTP attempts, recorded so they are not repeated:

- `https://www.metro-properties.com/` (twice) — DNS resolves to `mc-4487b244-…westeurope.cloudapp.azure.com`; TLS fails with "no alternative certificate subject name matches target host name". No HTTP request completed. **This is not the operator's domain**; OD-34 records `https://www.metro-pro.jp/`.
- `https://www.metro-properties.co.jp/` — does not resolve.

## 8. Assumptions and limits

- **All Toei statements are second-hand from 2026-10-22 browser reads** (DR-SJ-01, DR-SJ-05, DR-SX-01) quoted through those records. They were not re-read today because every Toei URL refused plain HTTP (§3.1). The records are three days old and are the only Toei text this task could stand on.
- **"No printed gate name" means "none in the text read".** The 構内図 image was never read; if it labels gates, this document does not know it.
- The 848-byte incident page and the uniform 212-byte shell are treated as a challenge/block under the brief's rule. No attempt was made to work around the block, and this worker used no browser or logged-in access; the one browser-based read of Toei pages here is the `oracle-ego` lookup in §3.5, whose report is unverified and must not be cited as a source.
- §3.5's items are ChatGPT's account of pages it opened. They are recorded because they point the same way as the primary records and name a useful trap (ticket-office hours), **not** because they are confirmed. Nothing in §2 or §4 depends on them.
- **Two `oracle-ego` submissions exited 5 at submit time** with `PageBudgetError: Page budget reached (8/8) in space "oracle-review"` — run dirs `~/.local/state/oracle-ego/runs/20261025-140643-61266-ds-sjk-gap-closure-review` and `…/20261025-140718-61715-ds-sjk-gap-urls`. Nothing was sent to ChatGPT by those submits. The budget was held by stale kept pages from earlier runs; this worker closed only its own kept page (`p46`, from the lookup in §3.5) and did not touch the others.
- **Desk check only.** Nothing here was observed in the station, and no OSM, blog or photo source was used to bridge any of the three gaps.
- **No station data, importer or test was touched.** This file is the whole change.
