# Ikebukuro — coverage gaps and field-survey brief

Machine-readable twin: `coverage.gaps` in `data/graph.src.json` → `gteki/station.json`.
Every item below is currently **null / unroutable** in the data. Nothing here may be filled by
assumption; each needs the evidence named in the "close with" column. Field visits follow the
repo's photo rules (public areas only, no faces, no staff-only zones, operator signage photographed
for facts only and never published).

| Gap id | Where | Missing fact | Close with | Unblocks |
|---|---|---|---|---|
| `gap-hours` | all B1 passages and exit stairs | opening hours | official hours statement per exit, or dated on-site photo of the posted hours | `hours:"require_known"` routing profile; night-time warnings |
| `gap-metro-tobu-gates` | Central Passage west/centre | which PLATEAU openings are the Marunouchi west/central/east gates and the Tobu central gates 1/2 (two floor-level openings near the projected Marunouchi gates look like stairwells) | on-site check of gate lines against column positions (columns are in the GLB, so a column count per bay is enough) | routing to 5 gate POIs that are search-only today |
| `gap-step-free` | east hall → east corridor (TP 27.8 → 26.9 m) and every exit | lifts/escalators/ramps: EF_80 transport geometry exists, but type, served levels and hours are unknown | Tokyo Metro / Toshima accessibility pages (facts only) + on-site confirmation | `stepFree` profile (currently fails safely with `no_path`) |
| `gap-south-west` | South Passage, south side between the JR South Gate and the West Exit (South) hall | which PLATEAU features are the Yurakucho Line South Passage East and West Gates (the map's gate machines sit inside surveyed floor with no gate-line opening) | on-site check of both gate lines against column positions | routing to those two gates |
| `gap-west-corridor-exits` | passage north from the West Exit (South) hall; Hope Center block | Exits 5, 6a, 6b, 7: stairs outside the survey and feet not matchable one-to-one to PLATEAU openings (Exit 5: two candidates 6 and 13 m from the map position; 6b: nearest 11 m and raised; 6a/7 inside the unsurveyed Hope Center block) | on-site note of where each stair leaves the passage, counted against columns | routing to those exits |
| `gap-tobu-jr-link` | passage along the west side of the JR block, South Passage ↔ Central Passage (west) | whether it is public or a JR–Tobu transfer concourse (gate machines along its JR side; Tobu Central Gate 1 at its north end) | on-site check of both ends for gate lines and signage | a second west–east link |
| `gap-ne-north` | North-east, north of the shopping-park passage | which stair is Exit 24 and which is 25 (the official map shows two; PLATEAU has one stair top); Exits 23, 29, 30, 31 lie outside the surveyed geometry | on-site check of the 24/25 stairs; a survey source for the passage further north | routing to those exits |
| `gap-west-stairs` | West Exit area | PLATEAU models only the lower flights of Exit 9 and of two stairwells near (-181, 126) and (-165, 113) (to TP ~30 m; street ~33 m). Exit 9's flight is ~9 m from its map position; the (-181, 126) flight sits beside the wide stair to the Fukutoshin Line West Passage, and the (-165, 113) flight runs into the Hope Center block towards Exit 7's map position, so neither is matched. Exit 8's stairs are ~12 m beyond the surveyed floor at the passage's west end. Exits 14, 16 and 19 (西口（中央）) have no stair in the survey. (Exit 13's lower flight matches its map position within ~3 m and is routed to its foot.) | a survey source for the upper flights and the passage west to Exit 8 (or a later PLATEAU release); on-site check of which stairwell is which exit | routing to Exits 7, 8, 9 and the upper flight of 13 |
| `gap-freshness` | whole slice | geometry is a 2023 survey; later construction unknown | dated walk-through comparing columns, exits and openings with the GLB | lifts the stale flag for slice 1 |

## Per-POI evidence: the 20 search-only POIs (audit 2026-10-22)

Question asked of each: can it be routed truthfully from the documented evidence now? An edge is
`verified` only with PLATEAU geometry (sampled on the surveyed floor, no wall crossing) **and** an
`accessFacts` entry from a documented source; a stair-foot route additionally needs the stair or
wall opening to be matched to the exit (Exit 13: the only flight within ~3 m of the map position;
stair-top exits: one-to-one by order, 1-9 m).

Method and limits of this audit:

- Geometry checked against `build/ubld_enu.json` (source sha256 `38f17964...901ac09`, equal to the
  `plateau-ubld-13116` entry in `station.json`), using the build's own surface and wall queries.
- The Toshima 2022 guide and the Tokyo Metro 2026-03 yard map are REFERENCE_ONLY and are not
  stored in the repo, so no map position was re-read. Map-position facts below are the ones already
  recorded in `graph.src.json`, this file and `field-checklist.md`; none was added.
- Result: **all 20 stay search-only. No node, edge, accessFact or coverage text changed.** For every
  one the missing piece is the identification (which opening or stair is which gate or exit), which
  no document in the repo supplies. Geometry alone cannot supply it, and inventing it is not allowed.
- The two Yurakucho South Passage gates (`gap-south-west`) had no POI at the time of this audit, so
  they are not among the 20. 南通路西改札 has since been added as a 21st search-only POI
  (`metro-y-south-west-gate`, 2026-10-22): Tokyo Metro's accessibility page (facts only) states a
  lift and escalator connection 南通路西改札～４番出入口（エソラ） outside the fare gates, but the gate
  cannot be placed and the passage to Exit 4 is not modelled, so there is no node and no edge. The
  gates stay a gap for the same reason (the map's gate machines sit inside surveyed floor with
  no gate-line opening). `gap-tobu-jr-link` is a passage, not a POI; it touches only Tobu Central Gate 1.

PLATEAU stair flights that no exit claims (West Exit area; all three end at a vertical closure about
3 m below street level, TP ~30.0 m, so none can be an `exit` node, only a `stair_end` foot). Their
feet are reachable on surveyed B1 floor from the hall (A* detour 1.02-1.45, no wall crossing), so the
geometry test would pass; what is missing is the exit number:

| Flight | Foot to top (ENU, TP) | Notes |
|---|---|---|
| F1 | (-177.8, 124.6) to (-180.8, 126.3), 27.9 to 30.0 m | beside the wide stair to the Fukutoshin Line West Passage; no map exit recorded |
| F2 | (-165.8, 140.8) via a short 0.5 m lower flight to (-168.7, 145.6), to 30.0 m | the Exit 9 candidate: ~9 m from the map position (see Exit 9) |
| F3 | (-166.1, 114.2) to (-163.0, 112.7), 27.9 to 30.0 m | runs into the Hope Center block towards Exit 7's map position; not matched |

| POI id | Names | Gap | What the sources say | What PLATEAU has | Verdict | R1 verdict (PR #177) |
|---|---|---|---|---|---|---|
| `metro-m-central-west-gate` | 丸ノ内線 中央通路西改札 / Marunouchi Line Central Passage West Gate | `gap-metro-tobu-gates` | `af-central-passage-west`: the Central Passage passes the Marunouchi and Tobu central gates. Toshima guide lists the gate; no position, side or order is recorded (POI evidence: "exact opening not yet identified"). | 22 vertical openings (Closure/Window/Door, 2-7 m wide, no gate semantics) within 12 m of the c_w to w_c route, only 3 within 6 m; two floor-level openings look like stairwells. G0: PLATEAU has no ticket gates. | STAY: no fact says which opening is the gate line | Stays search-only. Only a lift from the platform end to this gate, inside the fare zone; the passage side names a direction (西口方面), not a node. FC: A1, A3 |
| `metro-m-central-gate` | 丸ノ内線 中央通路中央改札 / ... Central Gate | `gap-metro-tobu-gates` | as above | as above | STAY, same reason | Stays search-only. Name appears only on the ward guide; Metro's own pages do not list it. FC: A1 |
| `metro-m-central-east-gate` | 丸ノ内線 中央通路東改札 / ... East Gate | `gap-metro-tobu-gates` | as above | as above | STAY, same reason | Candidate, not wireable yet: Metro's accessibility page names both ends (gate to Exit 34 by lift, to Exit 35 by escalator), but Metro's exit list puts the ground lift on 35. Waits on FC-IK-02 (and A1) |
| `tobu-central-gate-1` | 東武東上線 中央1改札 / Tobu Tojo Line Central Gate 1 | `gap-metro-tobu-gates`, `gap-tobu-jr-link` | as above; the guide puts it at the north end of the JR-Tobu link passage, which is itself unresolved (public or transfer concourse). | the link passage is surveyed floor outside every routable area (fenced); no opening matched | STAY | Stays search-only. Names and side as drawn only. FC: A2, F3 |
| `tobu-central-gate-2` | 東武東上線 中央2改札 / ... Central Gate 2 | `gap-metro-tobu-gates` | as above | as above | STAY | Stays search-only. FC: A2 |
| `exit-5` | 5番出口 / Exit 5 | `gap-west-corridor-exits` | exit exists (both maps). No fact ties it to an opening. | stairs outside the survey. West corridor (sw_h to w_cj, 152 m) has 24 vertical openings wider than 2 m within 9 m, 17 of them along its northern 60 m; recorded: two candidates 6 and 13 m from the map position | STAY: two candidates, no way to choose (a foot route would guess) | Stays search-only. Metro-listed with nearby buildings; no stated endpoint. FC: D1 |
| `exit-6a` | 6a番出口 / Exit 6a | `gap-west-corridor-exits` | exit exists | inside the unsurveyed Hope Center block; no stair or opening | STAY | Stays search-only. FC: D1 |
| `exit-6b` | 6b番出口 / Exit 6b | `gap-west-corridor-exits` | exit exists | nearest opening 11 m from the map position and raised | STAY | Stays search-only. FC: D1 |
| `exit-7` | 7番出口 / Exit 7 | `gap-west-corridor-exits`, `gap-west-stairs` | exit exists; `af-west-passages`: passages lead west towards Exits 7-13 | inside the unsurveyed Hope Center block; flight F3 runs towards its map position but is not matched | STAY | Stays search-only. FC: D1, B6 |
| `exit-8` | 8番出口 / Exit 8 | `gap-west-stairs` | exit exists | stairs ~12 m beyond the surveyed floor at the passage's west end (no surveyed floor or tread lies west of x = -182.1); no closure or stair | STAY: nothing surveyed to route to | Stays search-only. FC: C1 |
| `exit-9` | 9番出口 / Exit 9 | `gap-west-stairs` | `af-exit-13`: Exit 13 lies between the hall and the stairs of Exits 9 and 10. The order fits F2 (x -166, west of Exits 13 at -139 and 10 at -155), but that is a consistency check, not a match. | only F2 (lower flight) is a candidate, ~9 m from the map position, three times the 3 m that justified Exit 13; F1 and F3 are also unclaimed | STAY (closest call): a foot route would assert an unproven match. Flips to FOOT with a map-position re-measurement within ~3 m or the on-site answer to checklist B2 | Stays search-only. Metro's list (rev. 2026-03) names only nearby landmarks; the 10, 9, 8 order is a consistency check, not a measurement. FC: B2 (add a sign photo at the stair head) |
| `exit-14` | 14番出口 / Exit 14 | `gap-west-stairs` | exit exists | no stair in the survey; no stair-top closure near the hall other than Exits 10, 11, 15, 17, 18 | STAY | Stays search-only. Not in Metro's list. FC: B3 |
| `exit-16` | 16番出口 / Exit 16 | `gap-west-stairs` | exit exists | as Exit 14 | STAY | Stays search-only. Not in Metro's list. FC: B3 |
| `exit-19` | 19番出口 西口（中央） / Exit 19 West Exit (Central) | `gap-west-stairs` | exit exists | as Exit 14 | STAY | Stays search-only. Not in Metro's list or accessibility page. FC: B4, I1 (plain on-site check of the passage west of Tobu 中央1 toward the West Exit stairs and Exit 19: lift, levels, hours, exit number on signs) |
| `exit-23` | 23番出口 / Exit 23 | `gap-ne-north` | exit exists | outside the surveyed geometry | STAY | Stays search-only. FC: G2 |
| `exit-24` | 24番出口 / Exit 24 | `gap-ne-north` | the official map shows two stairs for 24 and 25 | one stair (foot (110.2, 111.6) to top (112.6, 122.6), TP 26.2 to 32.3 m, closure at 32.3 m); which number it is, is unknown | STAY: routing it as 24 or 25 is a coin flip; routing both to one stair is invented | Stays search-only. FC: G1 |
| `exit-25` | 25番出口 / Exit 25 | `gap-ne-north` | as Exit 24 | as Exit 24 | STAY | Stays search-only. FC: G1 |
| `exit-29` | 29番出口 / Exit 29 | `gap-ne-north` | exit exists | outside the surveyed geometry | STAY | Stays search-only. FC: G2 |
| `exit-30` | 30番出口 / Exit 30 | `gap-ne-north` | exit exists | outside the surveyed geometry | STAY | Stays search-only. FC: G2, FC-IK-03 (one stairway or two) |
| `exit-31` | 31番出口 / Exit 31 | `gap-ne-north` | exit exists | outside the surveyed geometry | STAY | Stays search-only. FC: G2, FC-IK-03 |

**R1 column (data-research PR #177, `docs/research/gaps/DR-IK-station-facts.md`, 2026-10-22).** The last column
records PR #177's per-POI verdict. Its bottom line: no public source read closes the blocker above for any of the 20, so
all 20 stay search-only. One is a candidate, not wireable yet: `metro-m-central-east-gate` (Metro's accessibility page
names both ends, but Metro's exit list puts the ground lift on exit 35 rather than 34; field item FC-IK-02). For
`metro-m-central-west-gate` only a lift inside the fare zone is stated. Exit 9 stays a field check (B2): Metro's list
(revised 2026-03) names only nearby landmarks. New field items FC-IK-01 to 03 and the freshness checks from PR #174 are in
[field-checklist.md](field-checklist.md) section I. Metro facts are `FACTS_ONLY_REFERENCE` (#26). JR East facts are barred
(Owner decision OD-02, [#165 comment](https://github.com/nurockplayer/gteki/issues/165#issuecomment-6335071234)) and Tobu station-map gate names are not used (OD-01 B, same comment); neither was used here, and no JR East-derived lead is in the field checklist. **No node, edge,
accessFact, POI or coverage text changed.** Not one of the 20: the Yurakucho 南通路西改札 to Exit 4 pair is stated with
both endpoints, but the west gate had no POI when #177 was written (`gap-south-west`). PR #185 adds it as a 21st
search-only POI (`metro-y-south-west-gate`, no node, no edge); the on-site check is field-checklist I8.

Cheapest unlocks, in order: checklist B2 (Exit 9, one stair, geometry already passes), A1 to A3
(the five gates, one visit), D1 and G1.

Surveyed floor outside the routable areas, including every area above, has no verified access:
the scene fences the outline of the routable areas with panels marked 「通行可否 未確認」/"Access
unverified" (`scene/access_fences.json`, built by `pipeline/build_access.py`, checked by
`scene/access.test.ts`). Once an area becomes routable, the next build moves the fence to its new
outline.

## Next slices (geometry already present, desk work first)

1. ~~**South Passage (east)**: exits 38, 39, 40, 41~~ (done, slice 2). ~~West half, JR South Gate,
   Exit 4~~ (done, slice 5); the Yurakucho gates wait on `gap-south-west`.
2. ~~**North-east**: exits 22, 26, 28, 32, 33~~ (done, slice 3). Exits 23–25 and 29–31 wait on
   `gap-ne-north`.
3. **West**: ~~Central Passage west, West Exit hall, exits 10, 11, 15, 17, 18~~ (done, slice 4).
   ~~Passage south to the West Exit (South) hall~~ (done, slice 5). Exits 5–7 wait on
   `gap-west-corridor-exits`; ~~13 (stair foot)~~ (done, slice 5.1); 8, 9, 14, 16 and 19 on `gap-west-stairs`.
4. **Passage west from slice 3** (x ≈ 61) to the West Exit area: geometry present, graph and
   access not yet authored; fenced off until then.
5. **Street level**: exit stair tops are modelled as daylight portals. A street-level GLB (PLATEAU
   bldg/tran LOD1–2 around the station) is needed before exits can be walked out of.

## Survey checklist

The walking-order checklist for one visit is [field-checklist.md](field-checklist.md) (stops A–G,
21 checks, about 60–90 minutes). Record date and time on every note; the date goes into
`retrievedAt` / `datasetDate`.
