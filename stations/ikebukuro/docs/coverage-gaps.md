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
| `gap-west-stairs` | West Exit area | PLATEAU models only the lower flights of Exits 9 and 13 and of two unlabelled stairwells (to TP ~30.0 m; street ~33 m); Exits 14, 16 and 19 (西口（中央）) have no stair in the survey | a survey source for the upper flights (or a later PLATEAU release); on-site check of which stairwell is which exit | routing to those exits |
| `gap-freshness` | whole slice | geometry is a 2023 survey; later construction unknown | dated walk-through comparing columns, exits and openings with the GLB | lifts the stale flag for slice 1 |

## Next slices (geometry already present, desk work first)

1. ~~**South Passage (east)**: exits 38, 39, 40, 41~~ (done, slice 2). ~~West half, JR South Gate,
   Exit 4~~ (done, slice 5); the Yurakucho gates wait on `gap-south-west`.
2. ~~**North-east**: exits 22, 26, 28, 32, 33~~ (done, slice 3). Exits 23–25 and 29–31 wait on
   `gap-ne-north`.
3. **West**: ~~Central Passage west, West Exit hall, exits 10, 11, 15, 17, 18~~ (done, slice 4).
   ~~Passage south to the West Exit (South) hall~~ (done, slice 5). Exits 5–7 wait on
   `gap-west-corridor-exits`; 9, 13, 14, 16 and 19 on `gap-west-stairs`.
4. **Street level**: exit stair tops are modelled as daylight portals. A street-level GLB (PLATEAU
   bldg/tran LOD1–2 around the station) is needed before exits can be walked out of.

## Survey checklist (one visit covers all five gaps for slice 1)

- Walk JR Central Gate 2 → Exit 35, Exit 43 and Exit 39 (via the South Passage); at each exit stair foot, photograph the posted
  hours (facts only) and note any lift or escalator.
- At the Marunouchi and Tobu gate lines, count columns from the nearest exit stair to each gate
  line and note which side each gate faces.
- Note any shop, wall or opening that differs from the GLB (screenshots from the preview at
  `?spawn=<node>` make side-by-side comparison easy).
- Record date and time on every note; the date goes into `retrievedAt` / `datasetDate`.
