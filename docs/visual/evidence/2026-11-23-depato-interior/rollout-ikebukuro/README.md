# Ikebukuro interior rollout

2026-11-23 JST. Journey row: none (Owner request 2026-11-22).

Behind `?station=ikebukuro&next=1`, 東武百貨店 池袋店 and 池袋パルコ share the accepted 西武 kit, with B2/B1/1F and tenant names from `stations/ikebukuro/data/depato-floors.json`. Store-name search targets the lowest food/sweets floor, B2. The usable station-side entrances are B1: enter from `c_w` / `n_h`, descend to B2, use the paired escalators through B1 to 1F, then leave at the street door. The capture records every collision-walk leg.

Only the nearest store can allocate detail; the previous store unloads first, including 西武. Flag-off keeps the original bundle and scene hook. No palette, exposure, light, shell-wall finish or counter finish was retuned. The entrance assembly only rotates to match the new footprint's doorway direction. Existing kit items on #1534 remain for the kit owner.

## Source and placement assumptions

The PLATEAU LOD1 bottom-face boundaries come from the committed context GLB and its feature-table receipt. Phase-1 PR #1512 at `8302307a4c454f11ff131f19ccff191066ce2096` supplies the building identities and shared-wing splits; it is still open. No phase-1 rendering code or unaccepted skyline asset is imported. PARCO uses the north wing (`z <= -65`); Tobu uses the west building north of `z=70`, with an authored station-side internal partition at `x=-65`, as the pilot uses internal partitions. Interior circulation/tenant placements are illustrative, not surveyed plans.

Known B1 station-approach elevations anchor each store. Store floor heights are not known: the requested 4.5 m interval supplies B2 and 1F. Circulation positions are instance data so the shared escalators and aisles fit the actual nonrectangular footprints. Portals cut the original shells only in the footprint and doorway volumes.

## Skips

| Store | Reason |
| --- | --- |
| esola-ikebukuro | No usable doorway in current walkable coverage. The POI has no entrance tie; the nearest public B1 approach `sw_h` leaves an unmodelled underground gap to the footprint. |
| lumine-ikebukuro | `g_jr_s` is explicitly a station tie, not a verified store doorway. Connecting the phase-1 south wing requires an unmodelled underground corridor beyond current walkable coverage. |
| sunshine-city-alpa | Outside committed station/context building and walkable street coverage. Phase-1 #1512 is open and identifies a combined skyline, without a store entrance mapping. |
| sunshine-city-world-import-mart | Same missing building-to-store entrance mapping and walkable street coverage. |
| sunshine-city-60 | Same missing building-to-store entrance mapping and walkable street coverage. |

## Capture

`job-run --id depato-ikb-rollout-capture-1 --artifact docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/receipt.json -- tachi-run --heavy --host --est 15m -- nice -n 15 node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs`

Capture has not run yet. It writes desktop 1440×900 and phone 390×844 frames for each included store: entrance outside, first interior, B2 aisle, escalator, street door inside/outside, and matching flag-off views at both entrances. `receipt.json` records the runtime commit, route/search results, collision walks, loaded interior count and shader failures. Flag-off street views match the evidence pose only because the preview street nodes are absent from the default graph.

Test: none (scene; CI root-test, golden cameras and journey jobs are the check). CI and capture results will be appended after the detached jobs return. The PR is ready for the lead/review gate; art-director acceptance remains pending (resume instruction, 2026-11-23 JST).

The diff exceeds 300 lines because it includes the two source footprint polygons and reproducible desktop/phone capture scripts.

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy. Tenant names are factual text; fronts have no logos, wordmarks, brand colours or product photos.

## Round 1 result — 2026-11-23 JST

`tachi-run --heavy --host --est 15m -- nice -n 15 node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs` → exit 1: `ERR_MODULE_NOT_FOUND` for this worktree's missing Vite dependency. No frames or receipt were produced. Next capture installs the pinned dependencies with `pnpm install --frozen-lockfile` inside the heavy job.

`rtk gh pr checks 1541 --watch` → Passed: 3; Failed: 13. Root typecheck reported TS2352 for JSON arrays cast as `DepatoInput`; build jobs rejected the undeclared `data/depato-rollout.json`. The resume narrows the casts to coordinate tuples and declares the data file with existing source IDs. Results remain pending for round 2.

## Round 2 result and correction — 2026-11-23 JST

Capture installed pinned dependencies, then exited 1 before scene load: `Error: spawnSync rtk ENOENT` inside Ego's Node runtime, which does not inherit the shell environment. The launcher now resolves HEAD through `rtk git` on the host and embeds it into the browser script. No frames or receipt were produced.

CI summary: Passed: 15; Failed: 1. Root tests: 2 files failed, 306 passed, 1 skipped; 4 tests failed, 4061 passed, 8 skipped. The four failures require matching source/generated dataFiles declarations and adding the two rollout source IDs to the stairwell provenance union. This correction synchronizes those declarations and includes the rollout file in the existing manifest test.

Round 3 command: `tachi-run --heavy --host --est 15m -- sh -c 'pnpm vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1 && node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs'`. Results pending detached handoff. No full suite or CI watch is run by this resume.
