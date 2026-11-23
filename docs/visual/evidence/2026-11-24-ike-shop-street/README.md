# Ikebukuro B1 east shop street — 2026-11-24 JST

J10 / #209. Stacked on #1503 (`cx/ike-shop-visits`), with current main merged first. The latest 2026-11-24 JST follow-up requires a ready PR; art-director acceptance remains pending.

## Qualified segments — K = 2

Coordinates are ENU metres, elevation is TP height. Inventory input is the merged station GLB (SHA recorded in inventory.json). `wall:N` identifies triangle N in the `wall` mesh's indexed primitive, with contiguous coplanar triangle spans grouped into one source segment. Coincident faces count once. The inventory covers the B1 east café/book/bakery cluster (x=30–110, y=55–128), not the whole station.

Retained #1496's 3.6 m source-segment minimum, 1.8 m endpoint margins, 5 m clearance from stair/escalator endpoints and gates, and 8 m same-floor walk envelope. Candidate centres were sampled at 0.25 m spacing. The 2.8 × 1.6 m viewing strip and walk-to-stand samples have a same-floor PLATEAU slab; the approach is clear of walls/fare fences. Stairwell boundaries and occupied fronts are excluded. The strip is standing/viewing space; the shop itself is only the kit's 0.15 m closed front.

| Source segment | B1 source endpoints (x,y) | Length | Front centre (x,y,z) | Stand (x,y,z) | Walk / view | Authored shop |
|---|---|---:|---|---|---|---|
| wall:2668 | (51.850,78.305) → (53.698,82.602) | 4.678 m | (52.759,80.418,28.389) | (51.289,81.050,28.389) | `c_n__n_h`; faces NW, seen walking south from the book shop toward the café | ひとくち和菓子 模擬店 — sweets / sweet ornament |
| wall:2681 | (65.354,108.909) → (67.070,112.897) | 4.342 m | (66.164,110.792,28.447) | (64.695,111.424,28.447) | `c_n__n_h`, near `n_h`; faces NW on the return from the bakery | こつこつ文具 模擬店 — stationery / tiny pencil |

`wall:2682` is the coincident/overlapping face of 2681, not another shop. `wall:2307/2308` and `wall:2315` bound the stairwell enclosure beside the `n_c__x22` stairs and are rejected, even where a point outside the enclosure has a clear approach. `wall:11661/11663/11665`, 2330/2336/2348/2354 are the same stair complex's upper/inside boundaries or lack a clear same-floor approach. 501/507 and 829/850 are the northeast stairwell and mouth. 2548 is occupied/occluded by the pharmacy/café cluster; 2591 and 2756–2760 overlap existing fronts or are non-coplanar sliver extents, not independent free storefronts. 2604/2605/2611/3606 are remote/occluded behind the café-side walls. The remaining unused east opening rows are narrow/curved fragments or overlap existing shopfronts. They are not grouped across corners or counted as businesses.

## Truth and appearance

Both names and art are invented; no new real name, brand/logo, source claim, POI, search entry, route edge or connector is added. Authored fronts stay separate from surveyed openings in `shop_placements.json`. Walk/fare geometry is unchanged. The existing kit supplies shut doors, flat lit merchandise cards, signs and spill; no interior passage is added. Warm muted brown accents replace neither line colour nor wayfinding. Existing unlit kit materials stay at brightness 1.0, below wayfinding 1.5. The fascia text includes 模擬店; the prompt uses the existing explicit simulated-shop disclaimer in JA/EN. Each visit has its own JA/EN reaction text, reward and small merchandise reaction mesh.

## Capture and phone cost

Completed 2026-11-24 01:35 JST at runtime commit `77a4bc7442d7ddfe9190bef5a5342ed4d9bfb3aa` ([capture.json](capture.json)). The #1503 scratch capture script was removed after its evidence commit; this capture adapts its recorded headless Brave/Metal, fixed-60-Hz stepping and desktop 960×600 / phone 412×839 method using the same runtime hooks. Every approach uses the normal collision-aware walker. First sight and approach are on the existing walk; stand, reaction and reward are captured separately. Twenty JPEGs and the receipt are committed here, following #1503's committed-image precedent.

The phone baseline serves the same merged candidate with only the two authored shop/interaction registrations omitted via capture-only module responses. It retains the same camera, pose, low tier and station geometry. This isolates the new fronts' rendered draw/triangle cost without adding runtime flags. Counters are GPU rendering counts, not physical-phone FPS.

| Phone view | Draw calls before → after | Triangles before → after | Delta |
|---|---:|---:|---|
| Wagashi | 32 → 32 | 163,828 → 164,748 | 0 calls; +920 triangles |
| Stationery | 29 → 29 | 158,550 → 159,470 | 0 calls; +920 triangles |

Both desktop/phone visits reached `done` and awarded `sweet-token` or `tiny-pencil`; Japanese and English reaction/reward text passed the capture assertions. The capture closed its browser and Vite server. Vite warned that optional `navmesh-paths.json` could not load; no page errors were recorded, and the normal walker approaches completed.

| Profile / shop | First sight | Approach | Stand | Reaction | Reward |
|---|---|---|---|---|---|
| Desktop wagashi | [frame](desktop-wagashi-first-sight.jpg) | [frame](desktop-wagashi-approach.jpg) | [frame](desktop-wagashi-stand.jpg) | [frame](desktop-wagashi-reaction.jpg) | [frame](desktop-wagashi-reward.jpg) |
| Phone wagashi | [frame](phone-wagashi-first-sight.jpg) | [frame](phone-wagashi-approach.jpg) | [frame](phone-wagashi-stand.jpg) | [frame](phone-wagashi-reaction.jpg) | [frame](phone-wagashi-reward.jpg) |
| Desktop stationery | [frame](desktop-stationery-first-sight.jpg) | [frame](desktop-stationery-approach.jpg) | [frame](desktop-stationery-stand.jpg) | [frame](desktop-stationery-reaction.jpg) | [frame](desktop-stationery-reward.jpg) |
| Phone stationery | [frame](phone-stationery-first-sight.jpg) | [frame](phone-stationery-approach.jpg) | [frame](phone-stationery-stand.jpg) | [frame](phone-stationery-reaction.jpg) | [frame](phone-stationery-reward.jpg) |


## Assumptions

The brief's K<4 exception applies: two independent walls qualify, so two new categories/visits are authored. The existing books display supplies the stationery shelf card; the stationery sign, pencils, reaction and reward distinguish the shop. The latest ready-PR instruction supersedes the earlier draft requirement. The generated capture receipt exceeds 300 lines because it records camera, pose, interaction and rendering state for all 20 frames and baseline/candidate runs.

## Follow-ups

Art-director acceptance of the desktop/phone walk frames and labels. CI must pass both stations' unchanged golden cameras before the review gate.

## Validation — 2026-11-24 01:29 JST

`tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1` — `Tests 34 passed (34)`.

`tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/interactables.test.ts --maxWorkers=1` — `Tests 1 passed (1)`.

The first GPU capture exited before browser launch because the shared TypeScript package exposes no `ModuleKind.CommonJS`. The capture now reads the authored JavaScript array literal directly, without the unavailable compiler API. CI round 1 found stale Ikebukuro stairwell bakes; both artifacts were regenerated with the existing generator and committed in `77a4bc7` before the successful capture. CI must run on the pushed evidence commit; earlier checks do not validate that commit.


## Capture command — 2026-11-24 01:35 JST

`tachi-run --heavy -- node /Volumes/KIOXIA/scratch/ike-shop-street/capture.cjs`

Last command result: `Ikebukuro shop street: 20 desktop/phone frames; JA + EN reactions/rewards; phone before/after counters captured.` Detached job `ike-street-1542-local-deps` completed with exit code 0. No product source changed after this capture.
