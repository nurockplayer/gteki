# #826 Shinjuku: four missing navmesh paths — diagnosis

2026-11-05 JST. Data: `.qa/826/diag/shinjuku/audit.json` (job `826-diag`, orb-test #487, 05:05–05:10 JST)
and `.qa/826/probe/shinjuku/audit.json` (job `826-probe2`, orb-test #491, 05:36–05:47 JST, `qaEdgeProbe`).
Both reproduce main exactly: fallback 4, unvalidatedJoins 56, fallbackWallHits 6, failedRoutePairs 2,
routablePairs 238; `links.failed` = 3× `unsafe_snap` + 2× `snap_failed` (the elevators);
`snapRejections {floor:3,wall:0}` = exactly the three `unsafe_snap` edges.

**Verdict: neither group is a source-backed repair for this task. Both are Blocked below, no source change.**

## Walk edges: one stairwell rail crosses each landing strip
- `e:82c9a2c2…` (m0_5, 5.02 m): both ends snap (dy 0.014 / 0.059, dxz 0); navmesh present at all 22
  samples along the authored line (dy +0.014…+0.067); island of A reaches 11/25 points of a ±2 m grid,
  B is unreachable (`disconnected`). Headroom 4.63–5.08 m, so clearance is not the cause.
- `e:6ac033af…` (m0_5, 3.57 m): both ends snap (0.035 / 0.082); navmesh at all 16 samples; island of A
  12/25, B unreachable. Headroom 3.20 m everywhere.
- Exactly one wall crosses each walk line; both are the same shape, perpendicular to the walk, 0.49 m
  long (this is the 0.478 m `colliderKinds:["wall"]` gap the audit reports):
  - 82c9a2c2: (-47.70,145.22)→(-47.25,145.40), z −1.899…−0.720 (landing −1.68)
  - 6ac033af: (-48.63,145.97)→(-48.17,146.15), z −6.458…−5.280 (landing −6.24)
- Source: `apps/web/src/explorer/stairwellCut.ts:404-413` — `wellRails` output is emitted as both a rail
  mesh and a navmesh wall. `wellRails` suppresses rails only inside stair pieces and the well's own
  landings (`:120-126`); the *planned flat walk across the landing* (the layout's link strip) is not in
  that set, so the cut cannot know a route crosses there.
- Reading: the rail splits each landing into two navmesh islands and is a real barrier for the walker,
  so the authored route across the well mouth conflicts with the source geometry. Removing the rail is
  forbidden (it guards a real drop); teaching the cut about planned flat walks is a design change in
  `liveScene.ts` plumbing plus a crossing rule, not a source-backed patch.

## Elevator edges: the 1F exit 3/4/5 cluster has no navmesh at all
- Both fail on the same 1F node `n:5b824a37…` (-3.84, 0, 3.22): `snap: null` **and**
  `findClosestPoint` returns nothing even with a ±3 m box (`.qaEdgeProbe[2..3]`).
- `e:ed7e56a8…`: its B1 node `n:cbaeded0…` snaps normally (dy 0.034, dxz 0.191) — only the 1F end fails.
- `e:65edd7ca…`: both ends (`n:5b824a37…`, `n:e6feaa2c…`) are null in the ±3 m box.
- The adjacent walk edge `e:e65b70241dc5462c893ee0aacc3b935f` from `n:e6feaa2c…` also fails
  `snap_failed`; it is a dead-end stub, so it never enters the fallback list.
- The audit queries the **final** bake (link pads included), so this is not link admission and not the
  initial-bake/`linkPad` ordering: the 1F floor of that exit cluster is simply not in the mesh.
  Layout cover at 1F: elevator node `[]` (shaft void), exit node only the link strip
  `link:e:e65b7024…:1:clear0`.
- Repairing it needs the plan's 1F floor at that cluster, not a snap change — a separate geometry task.

## Blocked (data locations)
1. Rails vs planned walks: `stairwellCut.ts:81-127` (`wellRails`) and the `cutStairwells` call in
   `liveScene.ts`; evidence `.qa/826/probe/shinjuku/audit.json` → `qaEdgeProbe[0..1].wallCrossings`.
2. Missing 1F exit floor: `stations/shinjuku/data/plan.json` (1F levels/spaces around x ≈ −3,
   north ≈ 3.2–3.6) and `stations/shinjuku/scene/layout.ts` (`linkStrips`, `liftCuts`); evidence
   `.qa/826/probe/shinjuku/audit.json` → `qaEdgeProbe[2..3].fromEnd/toEnd`, and the diag
   `qaEntries` for `e:e65b70241dc5462c893ee0aacc3b935f`.
No audit classification or tolerance was changed; no fallback was added; no PR was opened.
