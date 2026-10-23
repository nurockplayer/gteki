# B1 guided legs: wayfinding cue audit (#108)

Method: the two Lane F golden legs (`tests/e2e/specs/__goldens__/02-navigation.spec.ts/ikebukuro-routes.json`,
`I2` = `westb1-exit4`, `I1` = `jrc2-exit35`) are rebuilt from `gteki/graph.json` as polylines. Along each, a cue
counts if it is within 12 m of the path (signs: also face-on, either face) and lies in the 30 m window. Cue
kinds checked: signs (`scene/signage.json`), access-unverified fence marks (`scene/access_fences.json`),
junction nodes (degree 3 or more), ticket-gate POIs, stair flights (graph `mode: stairs`), exit end nodes. The
surveyed escalator geometry (EF_80) and PLATEAU openings (Door / Window, 4 in the whole survey) do not come within
8 m of either leg, so they provide no cue. Positions below are metres along the leg from its start.

Rights and truth: every cue below is a graph edge or node, a POI, or a documented access fact
(`data/graph.src.json` `accessFacts`, from the reference-only Toshima guide and Tokyo Metro yard map, facts only).
No shops, ads, operator graphics or column numbers were added; none are documented.

## Leg `westb1-exit4` (West Exit B1 to Exit 4, 186.7 m)

Edges: `w_c__w_cj` 0-20 m, `sw_h__w_cj` 20-172 m (152 m, walked in reverse), `sw_h__x4f` 172-187 m.

| Window (m) | Before #126 (main) | #126 head (repeaters) | This PR (adds place boards) |
| --- | --- | --- | --- |
| 0-30 | end signs at 0, 4, 13, 20, 24; fence marks; junctions `w_c`, `w_cj` | same | same |
| 30-60 | none (143 m with no sign from 24 to 167) | repeater 48 | place board 36, repeater 48, place board 60 |
| 60-90 | none | repeater 72 | place board 60, repeater 72, place board 84 |
| 90-120 | none (fence mark 106 only) | repeater 96, 120; fence 106, 120 | board 84, repeater 96, board 108, repeater 120 |
| 120-150 | none (fence marks 120-151) | repeater 120, 144; fences | board 132, repeater 144, board 156 |
| 150-187 | end signs 167, 172, 176; junction `sw_h`; fences; stair end | same | board 156 added |

New cue kind: blue **place boards** (`sign-place-sw_h__w_cj-1..6`) halfway between each pair of neighbouring signs on
the 152 m passage. Direction signs (charcoal, yellow exit badges) and place boards (blue, area name large) now
alternate about every 12 m; no stretch of 30 m shows only one kind. Content: the nearest hall each way, from the
POIs `west-exit-b1` (西口（地下）) and `west-exit-south-b1` (西口（南）（地下）), the area names printed on the
reference map, with graph walking distances rounded to 5 m. The access fact `af-west-corridor` is cited.
Passages (中央通路, 北通路, 南通路) are not named: their connector is an arbitrary junction inside the passage, so a
distance to it would misstate where it begins.

## Leg `jrc2-exit35` (JR Central Gate 2 to Exit 35, 197.6 m)

Edges: `g_jr_c2__c_g2` 0-7, `c_g2__c_c` 7-28, `c_c__c_e1` 28-61, `c_e1__c_n` 61-79, `c_n__c_e2` 79-96,
`c_e2__e_27j` 96-116, `e_27j__e_hall` 116-130, stairs `e_hall__e_low` 130-167 and `e_low__x35` 167-198.

| Window (m) | Cues |
| --- | --- |
| 0-30 | JR Central Gate 2 (ticket gate POI), junction `c_g2`, signs at 5, 7, 11, 23 |
| 30-60 | signs 31, 57 (end signs of the 33 m edge `c_c__c_e1`) |
| 60-100 | junctions `c_e1` 61, `c_n` 79, `c_e2` 96; signs 65, 75, 83, 92, 96, 100 |
| 100-130 | signs 100, 106, 118, 127; junctions `e_27j` 116, `e_hall` 130; start of the 37 m stair flight |
| 130-170 | stair flight; signs 135 and 163, 173; junction `e_low` 167 |
| 170-198 | stair flight to Exit 35; sign 173; the exit stair top (daylight portal) at 198 |

No window is empty and no gap between readable signs exceeds 28 m (the 135 to 163 m stretch is inside a stair
flight, itself a distinct cue). This leg needed no new cue.

## What the tests pin

`scene/signage.test.ts`: per-30 m window coverage on both legs computed from graph and signage; at most 14 m
between readable signs on the 152 m passage; direction signs and place boards alternate there; every added sign cites
`graph:`, `poi:` and `fact:` source ids that exist in the repo; distances equal the graph walk less the sign's
position within 5 m; the low-tier sign atlas stays one 4096 x 2048 page with at least three spare rows.

## Not covered (needs the director or a field visit)

- The last 25 m of the JR leg and the last 15 m of the West leg are a stair flight and a hall, with a sign at their
  start; the stair top / stair foot are the cues. Mid-flight signs were not added.
- Column or bay numbers, shop names and operator signage are not documented, so none are shown.
- Whether the real passage carries signs at these spots is not known; positions and spacing are design.
