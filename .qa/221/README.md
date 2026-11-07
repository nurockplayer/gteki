# Shinjuku scene ray audits (#221 / PR #748)

These source scripts are deliberately tracked in the task's scratch directory;
generated JSON, archives and logs remain ignored. Run only through `orb-test`.

`escape/scan.ts` samples 45 public stair/escalator flights, every 0.5 m at the
centre and both lateral offsets, with 160 directions (788,160 rays). Before
casting at each eye, `viewer.ts` invokes the app's draw-nothing viewer probe and
scene update. Its actual visible draw set invalidates the merged opaque BVH.
Older scenes without that probe retain their original visibility. No LOD
visibility is forced. A ray with no hit inside the 25 m range is recast to a 250 m
horizon: an underground hit there is a range miss (`range-misses.json`), and only
rays that climb above the street or hit nothing count as real escapes
(`escapes.json`). Each real escape also records where it reaches the street plane
(plan x y at y = 0), its elevation angle, whether a hit above the street came
first, whether it hit nothing at all, whether the eye was below the street, its
class and whether a shell-gap crossing passed over drawn street floor
(`throughFloor`).

The openings are the footprints the scene actually cuts: the band
`cutStairwells` removes from every stair/escalator run (the run section 0.25–2.4 m
below street and its width) and every street-level connector polygon `buildLayout`
drops entirely because a run descends through it (a voided entrance plaza). Both
get a 0.3 m boundary margin and are written to `street-openings.json`
(`kind: band | rings`). `classifyEscape` splits real escapes by crossing point:
`streetOpening` when the crossing lies inside any opening, `shellGap` otherwise
or when the ray never climbs. Only escapes cast from an eye below the street are
classified; an eye at or above the street sees ordinary surface geometry, so
those escapes go in a separate `aboveStreetEye` bucket and do not count toward a
flight's class. A flight is `streetOpening` when at least 90% of its underground
escapes leave inside an opening (`OPENING_SHARE` in `scan.ts`); fewer is
`shellGap`, and no underground escape at all is `unknown` with a stated reason.
`summary.json` carries the underground `streetOpening`/`shellGap` totals split by
`throughFloor`/`openAir`/`neverClimbs`, the above-street-eye total, and each
flight's class, share, shell-gap samples, lateral split (left/centre/right) and
leak azimuths. `GTEKI_ESCAPE_FLIGHTS=<prefixes>` limits a run to matching
flights; unset scans every flight.
`escape/compare.py HEAD_LABEL BASE_LABEL` compares identical
sample/direction pairs and writes new escape records. `diagnose.ts --live` casts
the original 16 first-person views after the same camera update.

The queued runner extracts pinned baseline/head source archives only inside the
disposable `/w` container. Outputs go under this directory. Prepare the archives
from `2cc6f264` and the pushed head using `git archive` over `stations/shinjuku`,
`apps/web/src/explorer`, `packages/godot/src`, `packages/navigation/src`,
`packages/geo/src`, and `packages/scene-api/src`. Then queue separately:

```sh
orb-test --heavy --memory 3g --cpus 2 --out .qa/221 -- sh .qa/221/escape/run-queued.sh escape
orb-test --heavy --memory 3g --cpus 2 --out .qa/221 -- sh .qa/221/escape/run-queued.sh views
```

2026-11-03 15:06 JST: the previous 188-ray difference was frozen kit LOD, not a
compaction loss. A focused camera-aware recast hit rendered geometry for all
188; the complete camera-aware comparison remains a separate queued check.
