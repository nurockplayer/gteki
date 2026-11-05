# #221 player-view re-check (origin/main `adf36b9f`)

Read-only QA, 2026-11-05 JST. No product code, geometry or data changed.

## 1. Player view: 16 first-person views at eye height, real GPU

`orb-test --heavy --host` ticket #486, 2026-11-05 05:47–05:52 JST, built `adf36b9f`; Playwright desktop-chromium +
Brave, spec `tests/e2e/specs/22-221-player-view.spec.ts`, runner `.qa/221/player-view/run.sh`. Camera at `pos + EYE`
(`explorer.placeCamera`), heading closed on `camera().yaw`: **16/16 hit the requested heading** (`shots/views.json`).

| # | floor | node | hdg | reported | verdict | why (from the frame) |
| --- | --- | --- | ---: | --- | --- | --- |
| 00 | m6 | 34dc769b | 353 | yes | CLEAN | long open stair flight: steps, walls and soffit close the frame |
| 01 | m6 | 34dc769b | 83 | control | CLEAN | stair mouth and side wall with handrails; ceiling join closed |
| 02 | m6 | 34dc769b | 173 | control | CLEAN | concourse corridor recedes into a closed end wall with signage |
| 03 | m6 | 34dc769b | 263 | control | CLEAN | native reshoot (below): stairwell balustrade, steps, wall — closed |
| 04 | m1 | 399c24bf | 150 | yes | CLEAN | street-level exit: buildings, wall, paving; sky is open air |
| 05 | m1 | 399c24bf | 240 | yes | CLEAN | passage under two light strips; walls, hoarding and floor close it |
| 06 | m1 | 399c24bf | 330 | yes | CLEAN | native reshoot: wall corner and soffit seam, no opening |
| 07 | m2_5 | 3d154fc2 | 71 | yes | CLEAN | stair underside and handrail beam against a panel wall; closed |
| 08 | m2_5 | 3d154fc2 | 341 | yes | CLEAN | landing under two light strips; ceiling/wall/floor joins meet |
| 09 | m3 | e26f39c2 | 83 | yes | CLEAN | escalator flank, glass panels and handrails continuous |
| 10 | m3 | e26f39c2 | 263 | yes | CLEAN | native reshoot: escalator balustrade and steps, surfaces continuous |
| 11 | m3 | e26f39c2 | 353 | yes | CLEAN | platform corridor with tactile strip, closed at both ends |
| 12 | m1 | fb5671d1 | 68 | yes | CLEAN | escalator run from the foot; steps and balustrades continuous |
| 13 | m1 | fb5671d1 | 158 | yes | CLEAN | panel wall close up (seams, magenta band); no opening |
| 14 | m1 | fb5671d1 | 248 | yes | CLEAN | wall, floor and equipment box meet; corner closed |
| 15 | m1 | fb5671d1 | 338 | yes | CLEAN | stair flank with magenta handrail band; surfaces continuous |

**VISIBLE BREAKUP 0 · CLEAN 16 · UNCERTAIN 0.** No view shows sky, void, a see-through floor or stair inside the
station: every pixel is covered. The 3 views the 640 px pass left UNCERTAIN (03, 06, 10) were re-shot at native
1440×900 (`22-221-player-reshoot.spec.ts`); 2 m back is not walkable there — walker stopped at 0.51 / 0.72 / 0.51 m.

## 2. Walking impact on E27 (navmesh audit outputs, `navmesh-{clip-baseline,fallback,suspect,gate-reset}.json`, 2026-11-04 23:28 JST, #808)

| measure | value | reading |
| --- | ---: | --- |
| offFloor / navmeshWallHits / connectorWallHits | 0 / 0 / 0 | no walker leaves the floor or clips a wall |
| fallbackWallHits | 6 | 2 each on three fallback edges (below) |
| routable pairs / failed | 238 / 2 | two route pairs still unroutable |
| unvalidated joins / suspect polyline edges | 56 / 0 | joins not yet validated (not a walker symptom) |

Fallback edges: `e:65edd7ca…`, `e:ed7e56a8…` (elevator, `snap_failed`, m1↔toei-nwd-1), `e:6ac033af…` (3.6 m),
`e:82c9a2c2…` (5 m, both m0_5). None of the 16 view nodes' incident edges is a fallback edge and every one audits
0 offFloor / 0 wall hits: nothing at the reported stair ends clips or floats.

## 3. Remaining escapes: 21,944 − the excluded crossings

`fix2-crossings.json` holds 34 rows but only **28 distinct (sample, direction) rays** (six cross two mouths), so 34 is
subtracted on distinct pairs. Buckets use `LOOK_PITCH` (`identityFraming.ts:16`, min −1.1 rad, **max 0.5 rad = +28.6°**):
a first-person camera cannot look higher (`buckets.py`); `void` = nothing within 25 m, `street` = geometry above ground.

| bucket | rays | void | street | flights |
| --- | ---: | ---: | ---: | ---: |
| (a) reachable: eye on a walkable flight, direction faceable | **15,610** | 5,757 | 9,853 | 35 |
| (b) same eye, above the +28.6° ceiling (no player can look there) | 6,306 | 3,069 | 3,237 | 8 |

Top flights (rays, void/street): `e:0564105d…` stairs m0_5→0 6,201 (1,595/4,606), `e:b503c7d9…` stairs m0_5→0
2,866 (1,120/1,746), `e:4bee1c5e…` escalator m1→0 2,315 (732/1,583), `e:c3fe6342…` stairs m1→0 1,994 (785/1,209).
14,440 of (a) come from five street-mouth flights (eye ≥ −4 m, all reaching floor 0): the open exit stairs, already
called "not a missing floor". Residue: **786 rays on seven deep escalator flights** (m1↔m3, m3↔m6), all `void`,
within ±15° of the up-slope at +20…30°, spread along the run (d/L ≈ 0, 0.25, 0.5, 1.0).

## 4. Root cause for the 786 deep-escalator rays — PENDING

No crossing in `fix2-crossings.json` lies on these flights, so this is not the head-band mouth case. Open: a real gap
in the shell, or culling in the audit draw set (its opaque BVH is rebuilt from the app's draw-nothing viewer probe at
the eye but a fixed default orientation). `gap-probe.ts` compares both for the 786 rays; `221-gap3` still queued.

## 5. Quality patrol #837 escalator-area reports (visual, numeric pending)

Patrol shots are 1024 px, so only gross artefacts are decidable. **28** (`453ea111` 6 m): a grey checkerboard patch on
the wall above the walker — real coplanar z-fighting, **reproduced**. **26, 27, 29** (same wall, 10/6 m): no patch in
those frames. **38, 40** ceiling polygons: angular but continuous. **22, 32, 36** gaps: every pixel covered. **17, 19,
22, 23** pink stripe: band unbroken. Those four groups **not reproduced**; mesh names for 28 from `defect-probe.ts`.

## Status

- Walking on E27: **no impact** (section 2). Player view: **VISIBLE BREAKUP 0 / CLEAN 16** (section 1). Escapes:
  bucket (a) **15,610**, (b) 6,306 (section 3); deep-flight root cause open (`221-gap3`), so #221 stays open.
