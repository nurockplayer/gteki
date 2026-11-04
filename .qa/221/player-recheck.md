# #221 player-view re-check (origin/main `adf36b9f`)

Read-only QA, 2026-11-05 JST. No product code, geometry or data changed.

## 1. Player view — NOT CAPTURED IN THIS RUN

The 16 first-person views (13 reported headings + 3 controls) are wired but the GPU pass never started:
`orb-test --heavy --host` was queued as **#486 at 2026-11-05 04:11 JST**, behind a running heavy job (#484) and
#485, with the heavy gate closed until 05:00 JST. No VISIBLE BREAKUP / CLEAN / UNCERTAIN call is made here —
there is no fresh evidence for it, and the prior table is not current-main evidence.

Wiring: `tests/e2e/specs/22-221-player-view.spec.ts` (skipped unless `GTEKI_221_PLAYER_VIEW=1`; opens Shinjuku,
high tier, clicks the HUD first-person toggle so the camera sits at `pos + EYE` in `explorer.placeCamera`, walks to
each node with `hooks.walkFromNode`, closes the heading loop on `camera().yaw` (`heading = -yaw`), screenshots).
Runner: `.qa/221/player-view/run.sh` (build + `pnpm --dir tests/e2e` + Playwright desktop-chromium).

## 2. Walking impact on E27 (existing navmesh audit outputs, current main)

Sources: `stations/shinjuku/navmesh-clip-baseline.json`, `navmesh-fallback.json`, `navmesh-suspect.json`
(last written 2026-11-04 23:28 JST, #808), plus `navmesh-gate-reset.json`.

| measure | value | reading |
| --- | ---: | --- |
| offFloor | 0 | no walker leaves the floor anywhere on E27 |
| navmeshWallHits | 0 | no walker clips a wall on a navmesh path |
| connectorWallHits | 0 | greybox connector polylines hit nothing |
| fallbackWallHits | 6 | 2 each on three fallback edges (below) |
| routable pairs / failed | 238 / 2 | two route pairs still unroutable |
| unvalidated joins | 56 | joins not yet validated (not a walker symptom) |
| suspect polyline edges | 0 | — |

Fallback edges (walker uses built fallback geometry, no snapped guide): `e:65edd7ca…` and `e:ed7e56a8…`
(elevator, `snap_failed`, m1↔toei-nwd-1), `e:6ac033af…` (3.6 m walk, `disconnected`, m0_5) and `e:82c9a2c2…`
(5 m walk, `other`, m0_5). **None of the 16 view nodes' incident edges is a fallback edge**, and every one of
them audits 0 offFloor / 0 wall hits. So nothing at the reported stair ends floats, clips or falls on main.

## 3. Remaining escapes: 21,944 − the excluded crossings

`fix2-crossings.json` has 34 rows but only **28 distinct (sample, direction) rays** (six rays cross two mouths).
Buckets use `LOOK_PITCH` (`apps/web/src/explorer/identityFraming.ts:16`, min −1.1 rad, **max 0.5 rad = +28.6°**):
a first-person camera cannot look higher than that, so any escape ray above it is not a player view.
Script: `.qa/221/player-view/buckets.py`.

| bucket | rays | void | street | flights |
| --- | ---: | ---: | ---: | ---: |
| (a) faceable, eye on a walkable flight | 15,610 | 5,757 | 9,853 | 35 |
| (b) same eye, above the +28.6° pitch ceiling | 6,306 | 3,069 | 3,237 | 8 |

`void` = nothing within 25 m (the ray leaves the built station); `street` = reaches geometry above the ground
plane (an opening at street level). Bucket (a), top flights:

| flight | mode | ray | void | street | eye z (m) | floors |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `e:0564105d…` | stairs | 6,201 | 1,595 | 4,606 | −1.7…0 | m0_5→0 |
| `e:b503c7d9…` | stairs | 2,866 | 1,120 | 1,746 | −3.2…0 | m0_5→0 |
| `e:4bee1c5e…` | escalator | 2,315 | 732 | 1,583 | −3.3…0 | m1→0 |
| `e:c3fe6342…` | stairs | 1,994 | 785 | 1,209 | −2.7…0 | m1→0 |
| `e:636c6fc9…` | stairs | 1,064 | 355 | 709 | −4.0…−1.7 | m0_5 |
| `e:2768d162…` | escalator | 171 | 171 | 0 | −42.9…−23.7 | m3↔m6 |
| `e:fc787100…` | escalator | 154 | 154 | 0 | −42.9…−23.7 | m3↔m6 |
| `e:abdb4369…` | escalator | 122 | 122 | 0 | −23.7…−7.8 | m1↔m3 |
| `e:d1463e42…` | escalator | 97 | 97 | 0 | −42.9…−24.7 | m3↔m6 |
| `e:06a78a8f…` | escalator | 90 | 90 | 0 | −42.9…−33.4 | m3↔m6 |

14,440 of bucket (a)'s 15,610 rays are those five street-mouth flights (eye ≥ −4 m, all reaching floor `0`); their
`street` rays are the open exit stairs the 2026-11-03 report already called "not a missing floor". The enclosed-
station residue in bucket (a) is **786 rays on seven deep escalator flights** (m1↔m3 and m3↔m6), all `void`, all
pointing within ±15° of the up-slope direction at +20…30° elevation, spread over the whole run (d/L ≈ 0, 0.25,
0.5, 1.0) rather than clustering at one mouth.

## 4. Root cause for bucket (a) — NOT ESTABLISHED IN THIS RUN

The deep-flight rays are the only bucket (a) escapes that are neither head-band crossings nor street openings, and
they are the root-cause target. One candidate is already ruled out by construction and one is open:

- Ruled out: the seven flights carry no crossing at a cap plane in `fix2-crossings.json`, so this is not the
  head-band mouth case.
- Open: whether the rays leave the station through a real gap in the escalator shell, or are culled out of the
  audit's draw set (the scan rebuilds the opaque BVH from the app's draw-nothing viewer probe with a camera at the
  eye but a fixed default orientation, so a surface outside that frustum is absent from the ray targets).
  `.qa/221/player-view/gap-probe.ts` re-casts exactly these 786 rays twice — once against the scene as built and
  once through the app's viewer probe — and cone-probes the still-missing ones for the nearest mesh/material.
  That run was queued as `job-run 221-gap-probe` at 2026-11-05 04:14 JST and had not started by the end of this
  session. Until it reports, no mesh or gap is named here.

## Status

- Walking on E27: **no impact** (section 2).
- Player view: **not measured** (section 1, heavy job #486 queued).
- Escapes: **classified** (section 3); bucket (a) root cause **open** (`job-run 221-gap-probe`).
- #221 cannot be closed on this evidence.
