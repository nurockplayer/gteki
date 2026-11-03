# #684 toei-nwd-m3 shell diagnosis

Measured 2026-11-03 17:19 JST, base `76df1e89` (main after the issue's `d601ce2d` snapshot). Public station inputs only.

The original premise that these are walkable-model boundary walls is not supported by the ray trace: **none of the crossing shell faces matches any `BoundaryWall` segment**. `cutStairwells` appends its edge bands into the existing `greybox-shell` at `stairwellCut.ts:417`, so the object name alone does not identify a corridor-union wall.

Renderer coordinates below are `(x, elevation, -ENU-y)`. Both walk edges lie at elevation -23.74 m. Rays followed their authored polylines at 0.3, 0.5, 1.0 and 1.7 m above that elevation.

- `e:a4ed9fc953984c52a914f0cbe73cd318`: shell face 1844 at `(-55.617882, -23.44, -159.625177)`, face 1774 at `(-55.613716, -23.44, -159.616459)`, and face 1846 at `(-54.926763, -23.44, -158.178885)`. At 1.0 m, the same plan lines hit faces 1818/1822/1835, 1748/1752/1770, and 1820/1824/1836.
- `e:f7671c07bc8d4f059fafa42d307f6873`: shell faces 2038, 1974, 2036, 1912, 1972 and 1910 at plan points `(-31.988132,-166.921685)`, `(-32.448542,-168.394165)`, `(-32.466262,-168.450839)`, `(-32.917364,-169.893552)`, `(-32.926512,-169.922810)` and `(-33.395291,-171.422058)` at 0.3 m. The same plan lines also cross shell faces at 1.0 m.

`unexpectedLink` is the audit's `unexpected_link` rejection (`navmesh-audit.ts`): snapping succeeded and Detour returned a complete corridor, but that corridor includes an off-mesh connection. Walk edges must remain walking paths; the audit rejects any vertical connector in such a corridor. It does not mean an off-mesh link was itself rejected by Detour.

## Source of each crossing (2026-11-03 17:25 JST)

No boundary-wall region pair or height-cluster key exists for these faces. The source key is the stairwell cut region (rectangle object), identified stably below by `(well.edgeId, rect index)`. Each rectangle generates bands for removed slab heights, independently of the corridor union. All five rectangles rise from -23.74 m to -7.80 m.

| Walk edge | Well / rectangle key | Example face / band level | Flight height at crossing |
|---|---|---|---|
| `e:a4ed9fc953984c52a914f0cbe73cd318` | `e:6113a2285c9143b9854ec8473455c64c:0` | 1844 / -23.35 m | -18.490 m |
| `e:a4ed9fc953984c52a914f0cbe73cd318` | `e:abdb4369e9ba4070b7a2693b71bdaae9:0` | 1774 / -23.35 m | -18.388 m |
| `e:f7671c07bc8d4f059fafa42d307f6873` | `e:fd3365c80feb4bcab0437f74db5ad68d:0` | 2038 / -23.35 m | -15.409 m |
| `e:f7671c07bc8d4f059fafa42d307f6873` | `e:2692fe08625f4a3f92d69a1380a58ccd:0` | 1974 / -23.35 m | -15.357 m |
| `e:f7671c07bc8d4f059fafa42d307f6873` | `e:e1fa653048b94a5695777d1063b34417:0` | 1912 / -23.35 m | -15.309 m |

The lower-slab branch supplied no along interval to `addBand`, so a slab cut near a flight's foot created bands along the full roughly 30 m rectangle. At these crossings the flight is several metres above the emitted bands. This is a cut-extent mismatch, not a missing corridor join or height split. The fix uses the existing `depthInterval(rect, level, WALK_CLEAR_M, HEADROOM_M)` for lower slabs, matching the primary cut's 0.30–2.10 m height window; upper-slab bands keep their existing hole-depth interval.

## Baseline Detour corridors (2026-11-03 17:25 JST)

Bake settings: cell 0.10 m, radius 0.30 m, climb 0.40 m, tile 256, greybox on. All four directed paths snap and return complete Detour corridors, but each traverses unrelated vertical links. None is acceptable for the authored walk step.

| Walk edge | Direction | Off-mesh user IDs in corridor order |
|---|---|---|
| `e:a4ed9fc953984c52a914f0cbe73cd318` | forward | 11, 33, 46, 10, 31, 45, 23 |
| `e:a4ed9fc953984c52a914f0cbe73cd318` | reverse | 23, 43, 31, 3, 10, 46 |
| `e:f7671c07bc8d4f059fafa42d307f6873` | forward | 23, 43, 31, 3, 10, 46, 35, 36, 40 |
| `e:f7671c07bc8d4f059fafa42d307f6873` | reverse | 36, 35, 33, 46, 10, 31, 45, 23, 5 |

| User ID | Vertical edge |
|---|---|
| 3 | `e:04ccf67c99224f58b45068c818ddb2aa` |
| 5 | `e:06a78a8f616c4a75a7b4eece6a295c4c` |
| 10 | `e:23febef47c1a493ebf68f649dc97da93` |
| 11 | `e:2692fe08625f4a3f92d69a1380a58ccd` |
| 23 | `e:631d1ee5a5374632aca8a266cf3506d3` |
| 31 | `e:8c9cd5f98dd34da899b75d44d2117137` |
| 33 | `e:904c66c36c1440ea8c6261ec2356bf72` |
| 35 | `e:a2dfff5edce042b8b5c5d74ccfc107b0` |
| 36 | `e:a61958a4e2e54d22ba88b7a521cc65cc` |
| 40 | `e:b1a8bca5b2ac453bb9a24d76ac5be880` |
| 43 | `e:bfeaebf7bf774b65882f3c707a701b04` |
| 45 | `e:c7ebf974059b4766b67a8135e8724a34` |
| 46 | `e:cc8b27a958dd4cbb83d68f3791db6111` |

These connections are attached and used by Detour. The refusal happens afterwards in the walk-edge audit, which discards the entire corridor on seeing its first off-mesh link. The repair removes the spurious local fences; it does not weaken that rejection.

## Validation and gate status (2026-11-03 17:58 JST)

The fix and tests are in `a419b6aa`. One self-review of the finished implementation found no concrete code failure. The interval helper already handles flat and sloping pieces; the upper-slab policy is unchanged. There are no station or edge exceptions. Oracle was not attempted, as directed.

Synthetic negative control, before the fix:

```sh
orb-test --memory 3g --cpus 1 --out .qa/m3 -- pnpm vitest run apps/web/src/explorer/stairwellCut.test.ts -t 'limits a lower slab' --maxWorkers=1
```

Result: `Tests 1 failed | 52 skipped (53)`; the ray under the higher flight hit the spurious band. On the final implementation, `stairwellCut.test.ts` passes all 53 tests.

Final related functional run:

```sh
orb-test --memory 3g --cpus 1 --out .qa/m3 -- sh -c 'pnpm vitest related --run apps/web/src/explorer/stairwellCut.ts apps/web/src/explorer/stairwellCut.test.ts --exclude packages/godot/src/navmesh-gate.test.ts --maxWorkers=1 && pnpm vitest run apps/web/src/explorer/greybox*.test.ts apps/web/src/explorer/walkableModel*.test.ts --maxWorkers=1 && pnpm typecheck'
```

Results: related `Test Files 23 passed (23)` / `Tests 275 passed (275)`; greybox/walkable `Tests 2 failed | 201 passed (203)`. The two failures are existing timing assertions in untouched greybox emission/discovery code. The `&&` chain stopped before typecheck, so the bounded timing retry and typecheck ran separately:

```sh
orb-test --memory 3g --cpus 1 --out .qa/m3 -- sh -c 'pnpm vitest run apps/web/src/explorer/greybox.test.ts apps/web/src/explorer/greyboxEmitProfile.test.ts -t "keeps floor discovery within a generous per-step bound|profiles 15 km of synthetic corridors" --maxWorkers=1; pnpm typecheck'
```

Results: `Tests 1 failed | 1 passed | 60 skipped (62)`. Floor discovery passed the retry; `greyboxEmitProfile.test.ts:23` failed again: `expected 393.5459109999997 to be less than or equal to 120`. No further retry or threshold change. Typecheck printed `$ tsc -p tsconfig.json` and exited 0. `pnpm map:gen` exited 0 and left the map unchanged.

The first, unfiltered related run ended `Tests 4 failed | 284 passed (288)`: the old L-shaped-outline assertion (corrected and now passing), an untouched drape-edges 5000 ms timeout (passed in the final run), and these subprocess failures:

- `navmesh-audit.ts failed: spawnSync pnpm ETIMEDOUT` (Ikebukuro).
- `navmesh-bake.ts failed: spawnSync pnpm ETIMEDOUT` (Shinjuku).

Those two public navmesh integration tests were not retried in light resources. A duplicate queued validation was canceled before starting a container (waiting PID 82498, exit 143); it ran no tests. The replacement excluded the public navmesh gate file, leaving the explicit heavy regeneration as the required real station proof.

### Before/after gate table

Snapshot 2026-11-03 17:58 JST. Heavy regeneration ticket #263 queued at 2026-11-03 17:26 JST, waiting for #262. It has not started. No gate files have been regenerated; neither fallback recovery nor shrink-only acceptance is established yet.

| Station | Fallback before / after | Unvalidated before / after | Detours before / after | offFloor before / after |
|---|---|---|---|---|
| ikebukuro | 1 / pending | 62 / pending | 0 / pending | 0 / pending |
| shinjuku | 6 / pending | 146 / pending | 2 / pending | 0 / pending |

The queued runner executes the exact requested CI command and retains the eight generated files under `.qa/m3/after` for comparison and copying back:

```sh
orb-test --heavy --memory 3g --cpus 2 -- sh -c 'for s in ikebukuro shinjuku; do pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$s" --with-greybox --write "stations/$s/navmesh-fallback.json" --write-baseline "stations/$s/navmesh-clip-baseline.json" --write-suspect "stations/$s/navmesh-suspect.json" --write-paths "stations/$s/navmesh-paths.json"; done'
```

Assumption: fix the stairwell band generator that contributes these shell faces, rather than changing a corridor boundary model that emitted none of them.

Follow-up: the existing 15 km emission timing limit still fails in the specified 1-CPU light container. No performance code or timing limits were changed.
