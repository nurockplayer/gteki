# Ikebukuro line POI import contract (WP2 Metro, WP3 Seibu: first batch)

- **Tracking:** lines-lead Phase 1, packages WP2 and WP3 ([`lines-inventory.md`](lines-inventory.md), PR #408). Facts-only rules: Tokyo Metro under #26 ([comment](https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404)), Seibu under OD-25 (`docs/research/owner-decisions-pending.md`).
- **Writer:** **ikb-route-15** only. It merges these entries into `stations/ikebukuro/gteki/station.json` and `data/graph.src.json` → `pois.json`. lines-lead does not edit `stations/`.
- **Data:** [`ikebukuro-line-pois.json`](ikebukuro-line-pois.json): 3 sources (each in the station `Source` shape: `attribution` and `decision {url, date}`; the Metro station page was read but no POI cites it, so it is not registered), 42 POIs, 10 `factsForExisting` entries for POIs already in the station, and `notFound` / `conflicts` lists.
- **Schema:** unchanged (`Poi` / `Source`, `gteki.station/0.1`). `operatorId` and `evidence.locator` are provenance fields for the writer review. They are not `Poi` fields.
- **Read:** 2026-10-24, about 17:57 JST, in ego-lite (read-only; the Metro pages are JS-rendered and refuse plain requests). Every name was checked to appear on its page. No other page text is copied: evidence is a `locator` (page and section, in our own words), and notes and facts are in our own words (GIS rights review P1).

## 1. This batch

| Operator | ticket_gate | elevator | escalator | exit | other |
| --- | --- | --- | --- | --- | --- |
| Tokyo Metro | 3: 副都心線 西通路東改札, 副都心線 西通路西改札, 有楽町線 南通路東改札 | 7 (by end pair; 改札内 / 改札外 as printed) | 14 (by end pair; the page gives no inside/outside split) | 15: 1a, 1b, 2a, 2b, 3, C1, C1b, C2, C3, C4, C6, C7, C8, C9, C10 | 0 |
| Seibu | 2: 西武池袋線 1F改札口, B1F改札口 | 0 | 0 | 0 | 1: 西武南口 |

Lift and escalator names are the line, the kind and the end-pair label as printed (e.g. `metro-m-lift-2`). `metro-y-lift-2` (南通路西改札～４番出入口（エソラ）) repeats a fact the station already records on `metro-y-south-west-gate`. It is kept because it is a separate lift POI.

## 2. Review changes made by lines-lead

- **Exits:** ids follow the station pattern `exit-<code>`, and names follow the existing exit POIs (「1a番出口」 / "Exit 1a"). The code as printed (`1a`, `C1` …) is a `ja` alias. 1a, 1b, 2a and C4 carry the page's `*` mark, which the legend explains as limited opening hours. No hours are given, so the notes say so. 1a and C4 were closed in the 2022 Toshima guide. The 2026-03 Metro list includes them again, and their current status stays UNKNOWN.
- **Seibu gates:** the page names the 1F and B1F gates only in an AED-location notice. They are prefixed 「西武池袋線」 for search, and the printed form is an alias. No other Seibu gate name is printed in text.
- **西武南口:** category `other`, not `exit`. The page lists it under facility hours and does not say whether it is an exit or a gate.
- **Hours:** printed only for two Fukutoshin escalators (始発～24：00, 始発～24：15) and 西武南口 (7:00～22:30). They are in `notes` with a read-on-2026-10-24, page-undated, may-have-changed caveat.
- **Source:** the print page's `datasetDate` is `2026-03` (its printed revision date). `tokyometro-ikebukuro-accessibility-2026-10` already exists in `station.json` (retrieved 2026-10-22). Keep its id and update `retrievedAt` and `notes`.

## 3. Field mapping

Same as the merchant contract ([`../merchants/ikebukuro-import-contract.md`](../merchants/ikebukuro-import-contract.md) §2): `floorId: null`, `displayPosition: null`, `connectorNodeIds: []`, `paid: null`, `evidence.method` `facts-only … UNVERIFIED, SEARCH_ONLY`, notes in ja and en with "search only, no route; current status unknown". Append the POIs at the end of the `pois` array.

## 4. `factsForExisting` (no new POI)

These are 10 facts for `metro-m-central-west-gate`, `metro-m-central-east-gate`, `metro-y-south-west-gate`, `exit-4`, `exit-34`, `exit-35`, `exit-39` and `exit-40`. Examples: the inside-gate lift ending at the central west gate; the street-level lift mark on exits 4 and 35 in the print exit list; the `*` time-limit mark on exits 39 and 40. They may go into those POIs' notes or evidence. **None changes routing.** The 34/35 lift disagreement (FC-IK-02) still stands: the accessibility page puts the lift on 34, and the print list marks the ground lift on 35.

## 5. Not found (stays UNKNOWN)

Metro platform numbers (the pages print only 「ホーム（…寄り）」 end points); Seibu platform numbers; Seibu lift and escalator positions (images only); other Seibu gate names; Metro escalator inside/outside split; Metro outage schedules (not transcribed). No platform POI is created for either operator.

## 6. Reject rules

As in the merchant contract §4, plus: no Tobu station-map gate name (OD-01 B), no JR East page fact (OD-02), and no route or connector authored from a lift end pair.

## 7. Rights review record

GIS Lane D reviewed the first head of #414 on 2026-10-24 (by message; it cannot post on the PR):

- **Found in order:** names, end pairs and facts under the facts-only class (Tokyo Metro #26, Seibu OD-25); REUSE 4l as a two-path exact list resolving to `LicenseRef-facts-only-no-licence`.
- **P1:** `evidence.quote` (42) and `factsForExisting[].quote` (10) committed verbatim page fragments, which the facts-only class and the Seibu terms do not allow. **Fixed:** every `quote` is removed; evidence is a `locator` in our own words; notes and facts that quoted page sentences are reworded. Names and end-pair labels as printed remain (facts).
- **P2:** NOTICE 4.9 did not credit 西武鉄道. **Fixed:** source list and credit line added; the "short verbatim quotes" wording is replaced.
