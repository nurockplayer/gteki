# DR merchant source inventory — Ikebukuro, then Shinjuku

- Tracking: #211 (parent #209). Requested by gteki-1b. Research by a gpt-6-luna worker (web search and page reads only), reviewed and corrected by the data-research lead (rights classes, scope notes, section 6).

Checked 2026-10-24. This is a public-source research sample, not a current-store or navigation approval. Names are plain factual labels only. No logo, photo, map artwork, layout, or copied descriptive copy is reused.

## 1 Summary

Official public merchant lists exist for Tokyo Metro Ikebukuro, Echika/Metro shops, Tobu Hope Center, ISP, Seibu Ikebukuro, and Toei Shinjuku. Official commercial-facility directories add useful area/floor labels. Shinjuku's S10 open-data records are reusable with conditions for factual fields, while Toei merchant-page text is facts-only reference under OD-01. Names and floors remain candidate attributes; none is a route endpoint or GIS placement.

## 2 Source inventory

### Ikebukuro

| source_id | Title / publisher | URL | Scope | Location precision | Update date | Licence/class (terms URL) | Text facts vs logo/photo/interior | Read status |
|---|---|---|---|---|---|---|---|---|
| DR-MR-01 | 施設・店舗 / Tokyo Metro | https://www.tokyometro.jp/station/ikebukuro/shop/index.html | Tokyo Metro Ikebukuro station shops; the page also names Echika and nearby facilities | Area/floor or name-only; some entries specify placement, including exit vicinity | Not stated | FACTS_ONLY_REFERENCE (https://www.tokyometro.jp/terms/index.html; Tokyo Metro is facts-only reference per `source-register.md`; OD-01 A covers Toei, not Metro) | Text facts: facts-only, no copied prose. Logos/photos/interior: not cleared | PAGE_READ (search-result page text) |
| DR-MR-02 | Echika Ikebukuro / Metro Properties | https://www.metropro-sc.jp/echika-ikebukuro/ | Echika commercial facility, separate from Metro's general station shops | Facility/area and store directory precision | Not stated | UNKNOWN (all-rights-reserved; https://www.metropro-sc.jp/terms/) | Text facts: UNKNOWN for product use; research reference only. Logos/photos/interior: not cleared | SEARCH_SUMMARY_ONLY |
| DR-MR-03 | 東武ホープセンター / shop directory and access / Tobu Hope Center | https://tobuhopecenter.jp/ ; https://tobuhopecenter.jp/info/access/ | West-side underground commercial facility; South, Center, North zones | Zone; exact shop position not established by text checked | Page has 2026 news; directory undated | UNKNOWN for directory reuse (terms linked from site; not assessed); simple facility connection facts covered by OD-18 only | Text facts: directory terms unknown; OD-18 permits simple access facts with URL/date and UNVERIFIED if single-source. Logos/photos/interior: not cleared | PAGE_READ (official home/access summaries) |
| DR-MR-04 | フロアガイド / 池袋ショッピングパーク (ISP) | https://www.web-isp.co.jp/floorguide/ | ISP, east-side underground shopping center; South Hall, Brick Street, North Hall | Area and floor label (B1 implied by underground facility; no entrance assignment) | Not stated; current page read 2026-10-24 | FACTS_ONLY_REFERENCE, UNVERIFIED, POI attributes/descriptions only under OD-23 (https://www.web-isp.co.jp/terms/) | Text facts: no copied text; facts-only. Logos/photos/interior: not cleared | PAGE_READ |
| DR-MR-05 | フロアガイド / 西武池袋本店 / Sogo & Seibu | https://www.sogo-seibu.jp/ikebukuro/floor-guide?floor=B2 | Seibu department store, separate commercial building; floors B2–8F | Exact building floor; not a station passage location | Current directory; date not stated | UNKNOWN (https://www.sogo-seibu.jp/sitepolicy/ not assessed). Sogo & Seibu is a department-store company, not Seibu Railway, so OD-25 does not apply | Text facts: reference only. Logos/photos/interior: not cleared | PAGE_READ (search summary) |
| DR-MR-06 | 池袋駅 / Tobu Railway station page and in-station map | https://www.tobu.co.jp/railway/guide/station/info/7105/ ; https://www.tobu.co.jp/railway/guide/station/insidemap/7105/ | Tobu station operator area; gate names/maps | Map only; gate names excluded from candidate data | Not stated | FACTS_ONLY_REFERENCE; Tobu terms §§7–8 prohibit commercial use (https://www.tobu.co.jp/sitepolicy/); OD-01 B | Text facts: no candidate facts used. Map/layout/images: not reused | SEARCH_SUMMARY_ONLY (existing context record; map excluded) |
| DR-MR-07 | 池袋駅 / JR East | https://www.jreast.co.jp/estation/stations/108.html | JR East station and shops | Not assessed here | Not stated | RESTRICTED; no use under OD-02 (https://www.jreast.co.jp/site/rules.html) | No text facts used. Photos/maps not reused | SEARCH_SUMMARY_ONLY (scope exclusion only) |

### Shinjuku

| source_id | Title / publisher | URL | Scope | Location precision | Update date | Licence/class (terms URL) | Text facts vs logo/photo/interior | Read status |
|---|---|---|---|---|---|---|---|---|
| DR-MR-08 | 新宿線 大江戸線 新宿駅 — 店舗・コインロッカー・ATM等設置一覧 / Tokyo Metropolitan Bureau of Transportation | https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html | Toei Shinjuku Line S01 and Oedo Line E27 merchant/facility list; operator-specific station area | Floor, paid/unpaid concourse, exit vicinity, and lettered placement labels | Not stated | FACTS_ONLY_REFERENCE under OD-01 A; site terms https://www.kotsu.metro.tokyo.jp/terms/ | Plain text facts only. Photos/icons/layout not reused | PAGE_READ |
| DR-MR-09 | 駅構内のお店 (S10) / Tokyo Metropolitan Bureau of Transportation; Tokyo Open Data Catalog | https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t000018d0000000039 | Shinjuku and Shinjuku-nishiguchi dataset resources; store facts, no coordinates or explicit floor field | `設置場所` text only; no coordinate field; not a navigable position | Dataset metadata date not stated; local rights evidence already recorded | REUSABLE_WITH_CONDITIONS for scoped factual CSV fields, CC BY 4.0, attribution and change notice required; source/terms https://creativecommons.org/licenses/by/4.0/legalcode.ja and https://portal.data.metro.tokyo.lg.jp/terms/. Rights status from context/tokyo-s10-catalog.json; not reassessed | Factual fields: reusable with conditions. Logos, photos, linked content, marks: excluded | PAGE_READ (catalog/search page); CSV field values not used in this sample |
| DR-MR-10 | 新宿サブナード / Shinjuku Subnade | https://www.subnade.co.jp/ | East-side underground commercial facility; distinct from station operators | Directory/zone/floor labels where shown by official directory | Not stated | UNKNOWN pending terms review (https://www.subnade.co.jp/terms/ if available; no terms clause verified) | Text facts: research reference only. Logos/photos/interior: not cleared | SEARCH_SUMMARY_ONLY |
| DR-MR-11 | 新宿サブナード店 / Starbucks Japan | https://store.starbucks.co.jp/detail-798/ | Named store inside Shinjuku Subnade | Facility/address only; no concourse/floor detail | Not stated | UNKNOWN for reuse of directory data (https://www.starbucks.co.jp/terms/); page is a corroborating public locator | Text facts: reference only. Logos/photos/interior: not cleared | PAGE_READ (search result) |
| DR-MR-12 | 新宿サブナード / Shinjuku Tourism Association | https://www.kanko-shinjuku.jp/spot/c001-c002-c004/article_557.html | Commercial facility overview; access by JR, Metro and Seibu listed, without assigning operator ownership of its shops | Facility-level only | Not stated | UNKNOWN for reuse; https://www.kanko-shinjuku.jp/terms/ not confirmed | Text facts: reference only. Images not reused | PAGE_READ (search result) |
| DR-MR-13 | 新宿サブナード店 / ORIHICA | https://www.orihica.com/shop/store/1154 | Named store inside Shinjuku Subnade | Facility unit/area number and address; no entrance | Not stated | UNKNOWN for this use; terms URL not established | Text facts: reference only. Logos/photos/interior: not cleared | PAGE_READ (search summary) |
| DR-MR-14 | 新宿サブナード店 / DAISO | https://www.daiso-sangyo.co.jp/shop/detail/008703 | Named store inside Shinjuku Subnade | Facility/address only | Not stated | UNKNOWN for this use; terms URL not established | Text facts: reference only. Logos/photos/interior: not cleared | PAGE_READ (search summary) |
| DR-MR-15 | 新宿駅 (M08) / Tokyo Metro | https://www.tokyometro.jp/station/shinjuku/index.html | Tokyo Metro Shinjuku station area | Station information; no merchant directory used here | Not stated | FACTS_ONLY_REFERENCE (https://www.tokyometro.jp/terms/index.html) | No facts/images reused for candidates | SEARCH_SUMMARY_ONLY |
| DR-MR-16 | 京王モール / Keio Mall | https://www.keio-mall.jp/ | Underground commercial facility by Shinjuku South Exit | Directory may provide area/floor; page unavailable in earlier research | Not stated | UNKNOWN; site terms not verified | No text facts or imagery reused | SEARCH_SUMMARY_ONLY (prior context: site returned 503) |
| DR-MR-17 | 小田急エース / Odakyu Ace | https://www.odakyu-ace.jp/ | Underground commercial facility; area around Shinjuku west side | Directory/floor; details not verified | Not stated | UNKNOWN; terms URL not found/verified | No text facts or imagery reused | SEARCH_SUMMARY_ONLY |

## 3 Station scope notes

### Ikebukuro

- JR East, Tokyo Metro, Tobu, Seibu, and commercial facilities are separate source scopes. No JR East merchant candidates are listed (OD-02).
- Metro's station shop list includes Metro shops and identifies Echika/Echika fit placements. Treat Echika as the commercial facility named by the source, not as a general Metro concourse.
- Tobu Hope Center and ISP are commercial underground facilities and remain distinct from Tobu, Metro, and Seibu operator areas. ISP's own description calls it east-side; Hope Center is west-side.
- Seibu Ikebukuro department-store directory is building/floor-level. It does not establish that listed stores are in a station passage.
- Tobu station-map gate names are not candidate evidence (OD-01 B). Simple commercial-connection facts can be cited from Tobu department store/Hope Center/PARCO pages only with URL/date, preferably a second source, per OD-18.

### Shinjuku

- S10 is Tokyo's dataset of station shops/facilities with store facts and textual `設置場所`; it has no coordinates and no dedicated floor field. Rights are scoped to factual CSV fields, with credit and change notice. It does not define the station ownership or geometry of a directory label.
- Toei E27 is the Oedo Line's operator area. The Toei Shinjuku merchant page combines S01 and E27 text and marks some resources as associated with one line; do not read that page as JR, Metro, Keio, or whole-station coverage. S10 Shinjuku and Shinjuku-nishiguchi resources are separate.
- The whole West Exit directory is not E27 merchant coordinates. E27's source network is partial and operator-specific; the Shinjuku `ubld` buildings are disjoint from E27. Neither establishes merchant routing positions.
- Candidates sj-mr-002..004 are in Shinjuku Subnade (east side). They are Shinjuku station-area merchants, not E27 merchants; only sj-mr-001 comes from the Toei S01/E27 list.
- Shinjuku Subnade and other underground commercial facilities are their own scopes, even where they connect to or are near multiple operators. Keio Mall and Odakyu Ace need official-page refresh before using entries.

## 4 Candidate sample

Checked date for every row: 2026-10-24. `current_status` is UNKNOWN throughout. Floor and area are copied only as short factual labels. Null means no evidence checked. These records are source leads only.

| stable id | station | name_ja | name_en | category | floor | area | possible_entrance | source_id + URL | source date | checked date | hours | current_status | location_confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ikb-mr-001 | Ikebukuro | Soup Stock Tokyo | Soup Stock Tokyo | restaurant | null | not stated (listed on the Tokyo Metro shop page without a facility label; corrected 2026-10-24 on re-read) | null | DR-MR-01 — https://www.tokyometro.jp/station/ikebukuro/shop/index.html | not stated | 2026-10-24 | 7:30–23:00 (source page; verify current) | UNKNOWN | SEARCH_ONLY |
| ikb-mr-002 | Ikebukuro | Patio de METRO | Patio de METRO | cafe | null | Echika Ikebukuro | null | DR-MR-01 — https://www.tokyometro.jp/station/ikebukuro/shop/index.html | not stated | 2026-10-24 | 9:00–21:30 (source page; verify current) | UNKNOWN | AREA_ONLY |
| ikb-mr-003 | Ikebukuro | Tabio | Tabio | retail | null | Echika Ikebukuro | null | DR-MR-01 — https://www.tokyometro.jp/station/ikebukuro/shop/index.html | not stated | 2026-10-24 | 10:00–21:00 (source page; verify current) | UNKNOWN | AREA_ONLY |
| ikb-mr-004 | Ikebukuro | マツモトキヨシ | Matsumoto Kiyoshi | drugstore | null | ISP South Hall | null | DR-MR-04 — https://www.web-isp.co.jp/floorguide/ | not stated | 2026-10-24 | null | UNKNOWN | AREA_ONLY |
| ikb-mr-005 | Ikebukuro | スターバックス コーヒー 南館店 | Starbucks Coffee South Hall | cafe | null | ISP South Hall | null | DR-MR-04 — https://www.web-isp.co.jp/floorguide/ | not stated | 2026-10-24 | null | UNKNOWN | AREA_ONLY |
| ikb-mr-006 | Ikebukuro | RF1 | RF1 | prepared food | B2 | Seibu Ikebukuro department store (separate building; source rights UNKNOWN) | null | DR-MR-05 — https://www.sogo-seibu.jp/ikebukuro/floor-guide?floor=B2 | not stated | 2026-10-24 | null | UNKNOWN | AREA_ONLY |
| sj-mr-001 | Shinjuku | カレーショップC＆C | null | restaurant | B1 | Toei Shinjuku station, outside-gate concourse near exit 2; line association not explicit on merchant row. Note: Toei exit 2 has been closed since 2024-03-30 (`DR-SJ-station-facts.md`), so this row's placement wording may be stale | null | DR-MR-08 — https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html | not stated | 2026-10-24 | Weekdays 07:00–22:30; weekends/holidays 08:00–21:00 (source page; verify current) | UNKNOWN | AREA_ONLY |
| sj-mr-002 | Shinjuku | スターバックス コーヒー 新宿サブナード店 | Starbucks Coffee Shinjuku Subnade | cafe | B1 | Shinjuku Subnade | null | DR-MR-11 — https://store.starbucks.co.jp/detail-798/ | not stated | 2026-10-24 | 07:00–22:00 (source page; verify current) | UNKNOWN | AREA_ONLY |
| sj-mr-003 | Shinjuku | 新宿サブナード店 | ORIHICA Shinjuku Subnade | clothing retail | B1 | Shinjuku Subnade, unit 305 | null | DR-MR-13 — https://www.orihica.com/shop/store/1154 | not stated | 2026-10-24 | Weekdays/weekends/holidays 10:30–21:00 (source page; verify current) | UNKNOWN | AREA_ONLY |
| sj-mr-004 | Shinjuku | DAISO 新宿サブナード店 | DAISO Shinjuku Subnade | variety retail | B1 | Shinjuku Subnade | null | DR-MR-14 — https://www.daiso-sangyo.co.jp/shop/detail/008703 | not stated | 2026-10-24 | 10:00–21:00 (source page; verify current) | UNKNOWN | AREA_ONLY |

No ENTRANCE_VERIFIED rows: text mentions an exit vicinity or a facility zone, but none has been aligned with GTEki geometry. The Toei merchant page directly names an exit vicinity for one candidate, but this does not identify the store entrance or a routable coordinate.

## 5 Field-check list

For every candidate: record checked date and exact sign text in private field notes; do not photograph or reproduce logos/maps in this output.

### Does the store exist / current name

- Ikebukuro: confirm the Metro-listed Echika shops, ISP directory entries, Hope Center zone listing, and Seibu B2 listing still operate under these names; note temporary closures or replacements.
- Shinjuku: check the Toei S01/E27 merchant list against current storefront signs; confirm the Subnade Starbucks and directory entries remain open. Treat source-listed opening hours as stale until checked.
- For any S10 follow-up, compare only fields authorized by the recorded CC BY 4.0 scope and record the required attribution/change notice. Do not use a link as a licence to reuse linked content.

### Is the entrance navigable (relative to pillar / map, floor, paid area or not)

- Identify the storefront frontage relative to a named pillar/sign or a current authorized GIS base; record floor and whether it is before or after a fare gate.
- For Toei S01/E27 candidates, distinguish line/operator area and verify the page's lettered placement against physical signs without tracing the station map.
- For Echika, ISP, Hope Center and Subnade, determine which commercial-facility boundary contains the storefront and whether access crosses a fare gate. Do not infer the entrance from the facility's connection or an exit number.
- GIS lead must perform geometry alignment separately. Until then retain AREA_ONLY/SEARCH_ONLY and leave entrance, node, edge, connector, and display position unset.

## 6 Gaps and Owner questions

- Decided 2026-10-24 (director under the Owner's delegation, recorded in `owner-decisions-pending.md`):
  1. **OD-31**: commercial-facility and chain-store directories (DR-MR-02, 05, 10, 11, 13, 14) get OD-23 treatment: facts only, UNVERIFIED, POI attributes only, never route evidence; rows may be imported with source id and retrieval date.
  2. **OD-32**: hours may be shown only from first-party sources, with the source date and a "may have changed" label; null if the source date is older than 180 days or the source is an aggregator. `current_status` stays UNKNOWN. In the sample above every source date is "not stated", so the age test cannot be applied: those hours stay leads here and must be imported as null until a dated first-party source or a field check gives them a date.
- Covered by existing decisions: OD-01, OD-02, OD-18, OD-23, OD-24, OD-25 and the S10 rights record.
- Follow-up work, not new Owner questions: verify current access to Keio Mall/Odakyu Ace official directories; locate their current terms pages; register the sources through the research/GIS process if needed.
- Unknown or unassessed commercial directory terms remain UNKNOWN; this sample does not authorize reuse of directory copy, branding, imagery, maps, or layouts.

## 7 Method

Read the provided context records `README.md`, `source-register.md`, `owner-decisions-pending.md`, Ikebukuro and Shinjuku station facts, and `tokyo-s10-catalog.json`. Existing rights findings were cited without repeating rights checks. On 2026-10-24, used public web search and text page reads for official Tokyo Metro, ISP, Tobu Hope Center, Seibu, Toei, Shinjuku Subnade, Starbucks, ORIHICA, DAISO, and Tokyo Open Data Catalog pages. No browser, download, map image, photo, contact, or S10 data-row extraction was used. Search summaries are marked as such where the full source page was not read. Candidate facts are paraphrased English with Japanese proper names retained. No coordinates, routes, routing fields, or GTEki positions were assigned.
