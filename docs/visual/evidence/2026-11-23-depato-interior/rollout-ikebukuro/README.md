# Ikebukuro interior rollout

## Package E correction — 2026-11-24 JST

Tobu's rollout adapter selects the first 40 tenant names per floor (40/40/37 on B2/B1/1F) for the shared 1024px atlas; the full source directory is unchanged. PARCO counter placements reserve the existing `n_h__n_c` segment bounds with 0.5m walker clearance. Both visual counters and persistent colliders use the filtered placements. The shared interior kit is unchanged; Tobu's B1 tie remains skipped and its barrier remains.

The final capture replaces every previous frame, including desktop Tobu, and records `sourceHead` on each frame. It repeats the 32 rollout frames plus two Tobu barrier frames and eight Seibu frames at desktop 1440×900 and phone 390×844. The north-passage proof walks `n_h` to `n_c` with PARCO detail loaded, then repeats with the real streaming focus held at Seibu to keep PARCO detail unloaded while retaining its persistent colliders. Each proof records actual load state before and after walking. `capture.mjs` measures full-frame max-RGB ≤16 pixels in both rollout stores' `street-door-inside` frames and rejects values over 0.1%. Matching flag-off poses remain included. The successful result below supersedes the partial runs; older results refer only to their recorded source heads.

### Final Package E capture — 2026-11-24 05:52 JST

Job `depato-e1541-capture-3` exited 0, `failures=[]`. All 42 frames use source `99287559dd66b1f087e44232e16869d8b951bd7d` and are committed with `receipt.json`. Every Tobu, PARCO and Seibu walk leg completed. On both devices the north passage completed in 136 steps with detail loaded before/after, and 123 steps with detail unloaded before/after (streaming focus held at Seibu; persistent colliders retained). All frames record zero shader errors. Matching flag-off views were recaptured; the flag-off bundle, scene hook and route code remain unchanged. No pixel-identical golden comparison was run.

Full-frame street-door-inside black pixels (max RGB ≤16): Tobu desktop **0.010185%**, PARCO desktop **0.008256%**, both phone frames **0%**; all below 0.1%. Command: `job-run --id depato-e1541-capture-3 --artifact docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/receipt.json -- tachi-run --heavy --host --est 15m -- sh -c 'pnpm install --frozen-lockfile && nice -n 15 node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs'`. The two requested specs passed 35/35 at `7a6495dc`; subsequent changes affect the capture driver, documentation and evidence only. Final evidence-head CI is scheduled separately. AD acceptance remains with the lead/art director; #1541 stays draft.

2026-11-24 05:38 JST: job `depato-e1541-capture-1` exited 1. At source `7a6495dc3f793fef296b3a2e0e3f23b5475a66db`, `tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1` passed: `Test Files 2 passed (2)`; `Tests 35 passed (35)`. After the GPU gate opened, capture failed before browser startup: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tachikoma/Developer/gteki-wt/depato-rollout-ikebukuro/apps/web/node_modules/vite/dist/node/index.js'`. This worktree has no local Vite or pngjs dependency links. No new frames or receipt were produced. Retry once with `pnpm install --frozen-lockfile` inside the heavy host job before running the same capture; the passed specs are not rerun for this dependency provisioning correction.

2026-11-24 05:46 JST: job `depato-e1541-capture-2` installed the frozen dependencies successfully, then exited 1 on the north-passage capture's initial load-state assertion. Source `8a71bdc4c69ff0d3013fc68cd2f8edf404ba9cb2` produced 28 receipt-listed frames: all 18 Tobu frames, all eight Seibu frames and the two PARCO flag-off frames. Tobu and Seibu recorded every walk leg `done=true`. The north-passage walk completed on both devices (`done=true`, 136 steps), but PARCO detail changed from unloaded to loaded during the walk (`before=false`, `after=true`), so the driver stopped before the remaining PARCO poses and unloaded pass. These partial frames and receipt are committed; PARCO image files absent from this receipt retain their older sources. The capture correction explicitly applies the entrance avatar focus and updates the scene before recording the initial load state. Full recapture and black-pixel measurement remain pending. The existing navmesh-paths fetch warning also appeared.

2026-11-23 JST. Journey row: none (Owner request 2026-11-22).

Behind `?station=ikebukuro&next=1`, 東武百貨店 池袋店 and 池袋パルコ share the accepted 西武 kit, with B2/B1/1F and tenant names from `stations/ikebukuro/data/depato-floors.json`. Store-name search targets the lowest food/sweets floor, B2. PARCO enters from B1 at `n_h`. Tobu enters from its 1F street door and reaches B2 by the internal escalators; the generated B1 `c_w` tie is skipped because it crosses the station unverified-access barrier and no alternative verified doorway exists in the committed data. Tobu no longer advertises a route from the station network. The capture records every collision-walk leg.

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

2026-11-24 JST: the previous capture passed at source `86d715dc`, evidence `7486feb1`; AD rejected it at PR #1541 comment 7106005335. This correction preserves station sign faces and barriers, drops the Tobu B1 tie, aligns the doorway assemblies to their wall normals, uses larger Tobu name-board atlas slots, and activates the existing street context at the 1F exit portals. Existing B2 counters, escalators, PARCO tenant boards/people, footprints and the five store skips are retained.

AD correction capture run 2 completed at 2026-11-24 01:38 JST; see the final result below. It records the same rollout pose names on desktop 1440×900 and phone 390×844, with Tobu's entrance poses at the usable 1F doorway. PARCO's entrance camera is seven metres back, level. Additional `B1-tie-skipped` frames show Tobu's closed B1 approach. 西武 adds `entrance-before`, `food-hall-aisle`, `escalator-boarding`, and `street-door-inside` on both devices. `receipt.json` binds frames to the source HEAD and records routes, expected Tobu station-route skip, collision walks, shader errors and street context state. Receipt timestamps use UTC (`Z`). PR #1541 stays draft for the lead/AD.

## AD correction run 1 result — 2026-11-24 JST

Source HEAD: `742ddb0b4549d82e1ae11ee71b8a3ee89aa30d19`. Job `depato-ad1541-capture-1` ran from 2026-11-24 00:48:24 to 01:17:26 JST and exited 1. The host gate requeued it three times when the Owner returned, then stopped: `tachi-run: GPU run requeued 3 times because the Owner returned; stopping`. Once Vite was stopped, the browser recorded `page.goto failed: net::ERR_CONNECTION_REFUSED` for desktop PARCO. The capture task space was closed after the returned result.

Seven new desktop Tobu frames were saved and are committed:

- `desktop-tobu-ikebukuro-entrance-outside.png` (usable 1F doorway)
- `desktop-tobu-ikebukuro-first-interior.png` (1F)
- `desktop-tobu-ikebukuro-food-hall-aisle.png`
- `desktop-tobu-ikebukuro-escalator.png`
- `desktop-tobu-ikebukuro-street-door-inside.png`
- `desktop-tobu-ikebukuro-street-door-outside.png`
- `desktop-tobu-ikebukuro-B1-tie-skipped.png`

All recorded Tobu collision-walk legs completed; all seven frames have zero shader errors. Street context is visible at the 1F doorway. Pixels with max RGB channel ≤ 16 in the desktop Tobu street-door-inside frame: **0.008179%**, below the AD's 0.1% full-frame limit. No AD verdict is claimed.

The run-1 partial receipt was superseded by the run-2 receipt, which retains the seven desktop Tobu frames and their source head.

Test command: `job-run --id depato-ad1541-capture-1 --artifact docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/receipt.json -- tachi-run --heavy --host --est 15m -- sh -c 'pnpm vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1 && nice -n 15 node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs'`.

Specs passed at 2026-11-24 01:16 JST: `Test Files 2 passed (2)`; `Tests 35 passed (35)`. No specs were rerun after the returned job. One read of PR checks found all 16 successful at source `742ddb0b`; the later evidence commit needs its own CI result.

The diff exceeds 300 lines because it includes the two source footprint polygons and reproducible desktop/phone capture scripts.

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy. Tenant names are factual text; fronts have no logos, wordmarks, brand colours or product photos.


## AD correction run 2 result — 2026-11-24 JST

`job-run --id depato-ad1541-capture-2 --artifact docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/receipt.json -- tachi-run --heavy --host --est 15m -- nice -n 15 node docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/capture.mjs` → exit 0, failures `[]`. Runtime source `f5c1092d6e79f446fbe11f2b555474ac2c53c50a`; seven preserved desktop Tobu frames use `742ddb0b4549d82e1ae11ee71b8a3ee89aa30d19`, with per-frame source heads recorded in the receipt. Only evidence and capture-script commits separate these sources. All recorded collision walks completed.

Changed frames use prefixes `desktop-` and `phone-`:

- `ikebukuro-parco-`: `entrance-outside`, `first-interior`, `food-hall-aisle`, `escalator`, `street-door-inside`, `street-door-outside`, `flag-off`, `flag-off-street`.
- `tobu-ikebukuro-`: the same eight poses plus `B1-tie-skipped`; seven desktop poses were preserved from run 1, and desktop flag-off poses were recaptured in run 2.
- `seibu-ikebukuro-`: `entrance-before`, `food-hall-aisle`, `escalator-boarding`, `street-door-inside`.

Full-frame pixels with max RGB channel ≤ 16 for `street-door-inside`: Tobu desktop 0.00818%, phone 0%; PARCO desktop 0.00710%, phone 0%. Each is below 0.1%. These measurements do not replace AD review.

The two requested specs passed at 2026-11-24 01:16 JST: `Tests 35 passed (35)`. Final-head CI will be watched after this evidence commit. The existing `navmesh-paths.json` fetch warning appeared during capture.
