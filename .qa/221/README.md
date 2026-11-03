# Shinjuku scene ray audits (#221 / PR #748)

These source scripts are deliberately tracked in the task's scratch directory;
generated JSON, archives and logs remain ignored. Run only through `orb-test`.

`escape/scan.ts` samples 45 public stair/escalator flights, every 0.5 m at the
centre and both lateral offsets, with 160 directions (788,160 rays). Before
casting at each eye, `viewer.ts` invokes the app's draw-nothing viewer probe and
scene update. Its actual visible draw set invalidates the merged opaque BVH.
Older scenes without that probe retain their original visibility. No LOD
visibility is forced. `escape/compare.py HEAD_LABEL BASE_LABEL` compares identical
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
