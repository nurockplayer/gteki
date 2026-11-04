# #826 Shinjuku: four missing navmesh paths — diagnosis

2026-11-05 JST. Bake data: `.qa/826/diag/shinjuku/audit.json` (job `826-diag`, orb-test #487, exit 0,
bake 30.4 s, 05:05–05:10 JST), which reproduces main exactly (`python3 .qa/826/compare.py diag shinjuku`
→ SHRINK-ONLY PASS, all counters equal): fallback 4, unvalidatedJoins 56, fallbackWallHits 6,
failedRoutePairs 2, routablePairs 238; `links.failed` = 3× `unsafe_snap` (4b7d9463, 6113a228,
7628a98a) + 2× `snap_failed` (the elevators); `snapRejections {floor:3,wall:0}` = the 3 unsafe_snap.

## 1. e:82c9a2c2cd704a348fbeb423d07cb125 — walk, toei-nwd-m0_5
- forward+reverse: `no_path`, both endpoints snapped, `connectivity: disconnected`,
  `sampledWallCrossSectionM` 2.42, one gap: 3.82–4.30 m of a 5.02 m edge (reverse: 0.72–1.19),
  length 0.48 m, left 1.40 / right 1.40, clearance 2.80, `floorMissing: false`,
  `class: "other"`, `colliderKinds: ["wall"]`.
- Reading: the landing strip is 2.8 m wide (layout `linkStrips` halfWidth 1.4) and a **wall spans
  its full width** near the middle; the 0.48 m gap is that wall. The layout's own `walls`/`runWalls`
  do not cross the line (`.qa/826/layout-probe.ts`), so the wall comes from the **live scene** —
  candidate: a stairwell rail emitted by `cutStairwells` (`apps/web/src/explorer/stairwellCut.ts:404-413`,
  rails are added to the navmesh `walls` at `well.upperY`). Pending `qaEdgeProbe.wallCrossings`
  (job `826-probe`) to name it exactly.
- Source support: not yet established. A rail across the walk line is correct geometry if the walk
  must go around the well; it is a bug only if the rail closes the run's own mouth.

## 2. e:6ac033af77914fe5a9786676088b952c — walk, toei-nwd-m0_5
- forward+reverse: `no_path`, both endpoints snapped, `connectivity: disconnected`,
  `sampledWallCrossSectionM` 4.07, **`gaps: []`**.
- Reading: no scene-side obstruction (no wall, no missing floor, wide cross-section) yet Detour has
  no path → the navmesh is missing or split along a clean line. Candidates: clearance below
  `walkableHeight` 1.7 m over part of the line, a strip cut into islands, or an eroded neck.
  Pending `qaEdgeProbe.navAlong` (0.25 m polygon presence) and `.headroom` (job `826-probe`).

## 3. e:65edd7ca50844b609d4dcb25bd296936 — elevator, toei-nwd-1 (1.30 m)
- `snap_failed` / `link_unattached`; endpoint snaps absent (`fromSnapped`/`toSnapped` false).
- `snap_failed` in `verticalLinkCandidates` (`packages/godot/src/navmesh-links.ts:92-105`) is emitted
  only when `snap()` finds no polygon within ±1.5 m horizontally and ±0.6 m in height. It is **not**
  a `validateLinkSnap` rejection (that would be `unsafe_snap`; the three of those are other edges).
- Layout: `n:5b824a37…` (1F, z=0) sits in the elevator shaft void — the lift cut removes the slab,
  so there is no floor at the node itself. Whether a floor exists within the 1.5 m box decides the
  fix; pending `qaEdgeProbe.fromEnd/toEnd` (job `826-probe`).
- Candidate root cause: the snap runs on the **initial** bake, before `linkPadGeometry` pads exist,
  so an endpoint inside a shaft void can never snap. Adding `--snap-fallback` would be a fallback
  (forbidden); the honest repair needs source geometry (a landing floor at the shaft mouth).

## 4. e:ed7e56a8e6234197be06280fcb24aecc — elevator, m1 ↔ toei-nwd-1 (7.81 m)
- Same shape as #3: `snap_failed`, `link_unattached`, both endpoint snaps absent; `n:cbaeded02c…`
  (B1, z=-7.8) is the partner node in the same shaft void, so both need the `826-probe` boxes.

## Next
`.qa/826/probe-navmesh.sh` (job `826-probe`, started 2026-11-05 05:13 JST) dumps `qaEdgeProbe`:
endpoint snaps + 1.5/3 m boxes, island grid, 0.25 m navmesh presence, wall crossings, clearance.
Anything not source-backed is Blocked with the data location above; audit classification is untouched.
