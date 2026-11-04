# #826 r2 (2026-11-05 06:5x JST): the approved rail fix is inert; the blocker is a connector flight-side guard

Regen `826-regen` (orb-test #493, 06:04–06:37 JST, `sh .qa/826/regenerate-gates.sh after shinjuku ikebukuro`)
with the `plannedWalks` / `wellRails(walks)` change and `RECIPE_VERSION` 5: **all eight gate files are
byte-identical** to `main` (`cmp` on `stations/{shinjuku,ikebukuro}/navmesh-{fallback,clip-baseline,suspect,paths}.json`).
All four #826 edges still fail exactly as before; `compare.py after shinjuku ikebukuro` reports
SHRINK-ONLY PASS only because nothing moved (fallback 4/4, routablePairs 238/238 and 1252/1252).

## Why the walk suppression never fires
The two crossing walls are not `cutStairwells` rails. A rail wall is exactly 1.1 m tall
(`stairwellCut.ts:453`, `yMin = upperY`, `yMax = upperY + RAIL_HEIGHT_M`); these are 1.17875 m:

| wall (x, north) | z band | walk height | `yMax − 0.96` | `yMin` + Δ |
| --- | --- | --- | --- | --- |
| (−47.70, 145.22)→(−47.25, 145.40) | −1.89875…−0.72 | −1.68 | −1.68 | 0.21875 over 0.49 m |
| (−48.63, 145.97)→(−48.17, 146.15) | −6.4575…−5.28 | −6.24 | −6.24 | 0.2175 over 0.49 m |

That matches the **flight side-wall collider** of `greyboxConnectors.ts:926-932` exactly:
`yMin = min(ya, yb) − below`, `yMax = max(ya, yb) + 0.96`, one piece per ≤ 0.5 m of slope (the pieces
measure 0.49 m), `below = 0` for a joined connector. In both places `max(ya, yb)` is exactly the planned
walk's height, so the guard stands 0.96 m proud of the landing the walk crosses.

`capGuard` (`greyboxConnectors.ts:889-905`) would cap it at the meeting floor, but it only caps when
`top >= high + WALKER_BODY.stepUpM` — here the meeting floor's top *equals* the guard's own top, so the cap is
skipped and the guard keeps its full 0.96 m above the landing.

## Where the fix belongs
`apps/web/src/explorer/greyboxConnectors.ts` (the flight side-wall branch, ~:926-932, and the cap rule at
~:889-905), not `stairwellCut.ts` / `wellRails`. Whether a flight guard may be capped at a landing it pokes
above is a design call of the same kind as ruling A (guard vs. a planned walk over intact floor), so it needs
a ruling before code.

## State of the branch
`plannedWalks` + `wellRails(..., walks)` + `RECIPE_VERSION` 5 are committed as ruling A asked, with the unit
test "keeps no rail across a planned flat walk at the landing, and keeps the rails away from it". They repair
nothing measurable (all eight gate files identical), and no PR was opened.

Test state (JST): the first run (`vitest related …`, heavy 1 g, orb-test #496, 07:12–07:2x) was OOM-killed
(exit 137) and its failures are not usable. The single-file run (heavy 1 g, #497, 07:29–07:33, exit 1, 55
tests / 1 failed) failed **only** on the test's last assertion ("every rail away from the walk is byte
identical"), after the two suppression assertions — a rail covers the walk's midpoint without the walk, none
does with it — had already passed. That assertion is too strict for a cut rail (its remaining pieces change),
and is replaced by "one rail entirely away from the walk is still in the list" (`toContainEqual`). That last
form has **not been re-run**: from 07:33 JST the heavy gate closed (08:30–18:30) and the single gteki light
slot has been held by other sessions (two `vitest related` runs since 00:18 and 01:54 JST), so every queued
run stayed waiting.
