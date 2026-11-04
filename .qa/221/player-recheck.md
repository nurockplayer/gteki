# #221 player-view re-check (origin/main `adf36b9f`)

Read-only QA, 2026-11-05 JST. No product code, geometry or data changed.

## 1. Player view: 16 first-person views at eye height, real GPU

`orb-test --heavy --host` ticket #486, 2026-11-05 05:47–05:52 JST, built from `adf36b9f`; Playwright
desktop-chromium + Brave, spec `tests/e2e/specs/22-221-player-view.spec.ts`, runner `.qa/221/player-view/run.sh`.
Camera at `pos + EYE` (`explorer.placeCamera`), heading closed on `camera().yaw` (heading = −yaw): **16/16 hit the
requested heading** (`shots/views.json`: `headingOk` true, pitch −6.9°). Images 640 px JPEG, 40,692–60,095 B.

| # | floor | node | hdg | reported | verdict | why (from the frame) |
| --- | --- | --- | ---: | --- | --- | --- |
| 00 | m6 | 34dc769b | 353 | yes | CLEAN | long open stair flight: steps, walls and soffit close the frame |
| 01 | m6 | 34dc769b | 83 | control | CLEAN | stair mouth and side wall with handrails; ceiling join closed |
| 02 | m6 | 34dc769b | 173 | control | CLEAN | concourse corridor recedes into a closed end wall with signage |
| 03 | m6 | 34dc769b | 263 | control | UNCERTAIN | one beige plane fills the left half <1 m away; wall vs stray slab indistinguishable at 640 px |
| 04 | m1 | 399c24bf | 150 | yes | CLEAN | street-level exit: buildings, wall and paving align; the sky is open air, not a ceiling hole |
| 05 | m1 | 399c24bf | 240 | yes | CLEAN | passage under two light strips; walls, hoarding and floor close it |
| 06 | m1 | 399c24bf | 330 | yes | UNCERTAIN | flat panels <1 m, thin seams only; no depth cue to rule out a misplaced panel |
| 07 | m2_5 | 3d154fc2 | 71 | yes | CLEAN | stair underside and handrail beam against a panel wall; closed |
| 08 | m2_5 | 3d154fc2 | 341 | yes | CLEAN | landing under two light strips; ceiling/wall/floor joins meet |
| 09 | m3 | e26f39c2 | 83 | yes | CLEAN | escalator flank, glass panels and handrails continuous |
| 10 | m3 | e26f39c2 | 263 | yes | UNCERTAIN | flat panels <1 m with thin seams; as 06, but no void pixel |
| 11 | m3 | e26f39c2 | 353 | yes | CLEAN | platform corridor with tactile strip, closed at both sightline ends |
| 12 | m1 | fb5671d1 | 68 | yes | CLEAN | escalator run from the foot; steps and balustrades continuous |
| 13 | m1 | fb5671d1 | 158 | yes | CLEAN | panel wall close up (seams, magenta band); no opening |
| 14 | m1 | fb5671d1 | 248 | yes | CLEAN | wall, floor and equipment box meet; corner closed |
| 15 | m1 | fb5671d1 | 338 | yes | CLEAN | stair flank with magenta handrail band; surfaces continuous |

**VISIBLE BREAKUP 0 · CLEAN 13 · UNCERTAIN 3** (03, 06, 10). No view shows sky, void, a see-through floor or stair
inside the station: every pixel is covered by a surface. The 3 UNCERTAIN share one cause — one large plane fills
the frame closer than 1 m, where 640 px cannot separate the stairwell's own wall from a misplaced slab.

## 2. Walking impact on E27 (navmesh audit outputs, `navmesh-{clip-baseline,fallback,suspect,gate-reset}.json`, 2026-11-04 23:28 JST, #808)

| measure | value | reading |
| --- | ---: | --- |
| offFloor / navmeshWallHits / connectorWallHits | 0 / 0 / 0 | no walker leaves the floor or clips a wall |
| fallbackWallHits | 6 | 2 each on three fallback edges (below) |
| routable pairs / failed | 238 / 2 | two route pairs still unroutable |
| unvalidated joins / suspect polyline edges | 56 / 0 | joins not yet validated (not a walker symptom) |

Fallback edges: `e:65edd7ca…` and `e:ed7e56a8…` (elevator, `snap_failed`, m1↔toei-nwd-1), `e:6ac033af…`
(3.6 m, `disconnected`, m0_5), `e:82c9a2c2…` (5 m, `other`, m0_5). None of the 16 view nodes' incident edges is a
fallback edge and every one audits 0 offFloor / 0 wall hits: nothing at the reported stair ends clips or floats.

## 3. Remaining escapes: 21,944 − the excluded crossings

`fix2-crossings.json` holds 34 rows but only **28 distinct (sample, direction) rays** (six cross two mouths), so 34 is
subtracted on distinct pairs. Buckets use `LOOK_PITCH` (`identityFraming.ts:16`, min −1.1 rad, **max 0.5 rad = +28.6°**):
a first-person camera cannot look higher (`buckets.py`); `void` = nothing within 25 m, `street` = geometry above ground.

| bucket | rays | void | street | flights |
| --- | ---: | ---: | ---: | ---: |
| (a) reachable: eye on a walkable flight, direction faceable | **15,610** | 5,757 | 9,853 | 35 |
| (b) same eye, above the +28.6° ceiling (no player can look there) | 6,306 | 3,069 | 3,237 | 8 |

Bucket (a), top flights (rays, void/street): `e:0564105d…` stairs m0_5→0 6,201 (1,595/4,606), `e:b503c7d9…` stairs
m0_5→0 2,866 (1,120/1,746), `e:4bee1c5e…` escalator m1→0 2,315 (732/1,583), `e:c3fe6342…` stairs m1→0 1,994
(785/1,209), `e:636c6fc9…` stairs m0_5 1,064 (355/709). 14,440 of the 15,610 come from those five street-mouth
flights (eye ≥ −4 m, all reaching floor `0`); their `street` rays are the open exit stairs the 2026-11-03 report
already called "not a missing floor". The enclosed residue is **786 rays on seven deep escalator flights** (m1↔m3,
m3↔m6), all `void`, within ±15° of the up-slope direction at +20…30° elevation, spread along the run (d/L ≈ 0,
0.25, 0.5, 1.0), not clustered at one mouth.

## 4. Root cause for the 786 deep-escalator rays — PENDING

No crossing in `fix2-crossings.json` lies on these seven flights, so this is not the head-band mouth case. Open:
a real gap in the escalator shell, or culling in the audit draw set (the scan rebuilds its opaque BVH from the
app's draw-nothing viewer probe with a camera at the eye but a fixed default orientation).
`.qa/221/player-view/gap-probe.ts` re-casts the 786 rays against the scene as built and through the viewer probe,
then cone-probes the still-missing ones for the nearest mesh/material; `job-run 221-gap2` was queued at
2026-11-05 05:50 JST and was still waiting for a light orb-test slot at the end of this session.

## Status

- Walking on E27: **no impact** (section 2). Player view: **VISIBLE BREAKUP 0 / CLEAN 13 / UNCERTAIN 3** (section 1).
- Escapes: bucket (a) **15,610**, bucket (b) 6,306 (section 3); deep-flight root cause **open** (`221-gap2`).
- #221 cannot be closed on this evidence: root cause open, and 3 views stay UNCERTAIN.
