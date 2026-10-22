# 新宿駅 Shinjuku — Lane B station record

**Status: candidate, NOT ACCEPTED.** Owner approval is required before merge or release. This record makes no real-world navigation guarantee.

**Scope of this slice:** the Toei Oedo Line Shinjuku station (**E27**), using the extent of the published MLIT/Toei open dataset. The slice covers nine NWD levels, from street level (GL/1F) down to the B6 platform. JR, Keio, Odakyu, Toei Shinjuku Line, Tokyo Metro and Shinjuku-nishiguchi (E01) are **not** in this slice; see the Coverage section.

## How to run

```bash
pnpm install
pnpm --filter @gteki/station-shinjuku dev        # lane explorer → http://localhost:5174
pnpm --filter @gteki/web dev                      # shared explorer (Lane C) → pick 新宿駅
pnpm --filter @gteki/station-shinjuku import:e27 --check   # data reproducibility (needs raw inputs)
pnpm --filter @gteki/station-shinjuku import:surface --check   # street context (needs PLATEAU raw inputs)
```

Visual QA (needs Brave, or the browser named by `GTEKI_BROWSER`; the lane dev server on :5274, the shared explorer on :5290; ffmpeg for video):

```bash
pnpm --filter @gteki/station-shinjuku shoot           # fixed vantages → .qa/shots (PNG + calls/tris/voidFraction)
pnpm --filter @gteki/station-shinjuku record          # guided walkthrough MP4 on a virtual clock → .qa/video
pnpm --filter @gteki/station-shinjuku explorer-walk   # guided routes in the shared explorer, per-frame void
```

`shoot` also takes `--vantages file.json` (ad-hoc or generated views, e.g. every node × edge heading), `--route from,to`, `--w/--h` (phone: 390×844 `--q low`) and `--timings 1`.

To get the raw inputs, run `stations/shinjuku/tools/fetch-sources.sh`. It downloads into `~/Developer/gteki-raw/shinjuku` (override with `GTEKI_RAW_SHINJUKU`) and verifies every file against the sha256 values in `stations/shinjuku/sources/manifest.json`. Nothing raw is committed.

## Layout

| Path | What |
| --- | --- |
| `stations/shinjuku/gteki/{station,graph,pois}.json` | Shared contract `gteki.station/0.1` files (Lane C parser). These are the routing truth. |
| `stations/shinjuku/gteki/scene.ts` | `@gteki/scene-api` hook: the same scene inside the shared explorer. Invisible walk proxies plus ENU walls. |
| `stations/shinjuku/data/plan.json` | Render-only plan: GSI space polygons and facilities, plus symbolic node heights. Not used for routing. |
| `stations/shinjuku/scene/` | Renderer-neutral layout (`layout.ts`, analytic WalkWorld collision), the Three.js builder (`build.ts`) and the street context (`surface.ts`, `surface-layout.ts`). |
| `stations/shinjuku/data/surface.json` | Street context derived from PLATEAU 2025 新宿区 (buildings + roads around the E27 exits). Render-only. |
| `stations/shinjuku/app/` | The lane's own L2-target explorer: third-person walk, guide, narration, audio, crowd, minimap, phone UI. |
| `stations/shinjuku/app/src/characters/` | Original procedural characters (one skinned mesh each, LOD, shared batched draw). |
| `stations/shinjuku/tools/` | Importers (`import-e27.ts`, `import-surface.ts`), fetch/verify scripts, and QA tools (`shoot.ts`, `record.ts`, `explorer-walk.ts`, `vantages.json`). |

## G0 — provenance and rights: **published under the Owner's override** at the #16 merge ([#16](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757), Owner comment 2026-10-21T10:31:49Z). Not a PASS on rights evidence. Open: `gap:reuse-after-publication`, the ほこナビDP inquiry about reuse after 2027-03-12.

- **Sources.** Both are from ほこナビDP (MLIT), dataset `2d8ff84b-…`, last modified 2026-09-17, link maint_date 2025-09-19:
  - 歩行空間ネットワークデータ, which gives the graph.
  - 構内地図データ, which gives spaces, fare areas and facilities.
- **Licence basis.** Published under the Owner's override at #16 ([#16](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757)). The licence basis for the two E27 resources is **unconfirmed**: the Owner decided that PDL 1.0 is not treated as covering them ([#39](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917), Q11 = No). The provider inquiry is open. Each source keeps its 「…」（国土交通省）を加工して作成 credit line. The public `apps/web` build shows the E27 credit in the Coverage dialog and in the 出典 line of each route card; every source record carries `modified: true`. The lane app in `stations/shinjuku/app` also has a footer credit, but it is a development tool, not a release surface.
- **Data-use policy (Owner decision, option A, 2026-10-20).** Three statuses are tracked separately, and none is inferred from another:

  | Status | What we know | Where it lives |
  | --- | --- | --- |
  | Publication period (公開提供期限) | The dataset page says it is a limited publication for 公共交通オープンデータチャレンジ2026, **until 2027-03-12**. | Source `notes`, coverage gap `gap:reuse-after-publication` |
  | Reuse licence (再利用授權) | **Unconfirmed.** The two E27 resources ship under the Owner's #16 override; PDL 1.0 is not treated as covering them (#39, Q11 = No). Reuse of the derived Web 3D data after 2027-03-12, commercial reuse included, is **unconfirmed**; an inquiry to MLIT ほこナビDP窓口 is pending. | Source `license` (an "unconfirmed" label linking the dataset page), `rights` (`REUSABLE_WITH_CONDITIONS`, the value the schema requires for data that ships; not a licence claim, although the public Coverage dialog currently prints that raw value until [#130](https://github.com/nurockplayer/gteki/issues/130) (Lane C: an override rights value, or stop printing the raw enum) lets the E27 sources switch), this record |
  | Navigation freshness (導航資料時效) | Dataset 2026-09-17; link maint_date 2025-09-19. | Source `datasetDate`. The router's `staleAfterDays` flags stale routes. `validUntil` stays `null`, so the publication period never marks routes stale. |

  Sources, SHA-256 hashes, licence and acquisition evidence are kept. Development and acceptance continue. **Any public release relying on rights that are not yet confirmed stays HOLD** (Owner policy, 2026-10-20). For E27, the Owner overrode this at the #16 merge ([#16](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757)); reuse after 2027-03-12 is still open (`gap:reuse-after-publication`).
- **Street context: PLATEAU 2025 新宿区, stage 2.** Licence recorded as the catalogue's PLATEAU Site Policy 「３．著作権について」; the `Licensed under CC BY 4.0` clause in the data metadata is kept as unconfirmed evidence only and is not shown in the app (#161). Credit shown as the Owner's Q10 Option A string 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成（建物の基部を地表面の高さにそろえて表示）」. Buildings (bldg) and roads (tran) of meshes 53394525/26/35/36 are converted to a render-only street around the exits (`sources/surface-manifest.json` with sha256; `import:surface --check` reproduces `data/surface.json`). It is cited as source `plateau-13104-shinjuku-ku-2025` (`REUSABLE_WITH_CONDITIONS`, `modified: true`) and credited in the Coverage dialog (and the lane app footer). It never feeds routing.
- **Evaluated and not used:**
  - PLATEAU ubld 53394536 does not overlap E27.
  - The S10 store CSV (東京都交通局「駅構内のお店」, CC BY 4.0; not part of E27) has no coordinates.
  - The Toei website served a bot-check (CAPTCHA). It was **not** bypassed, so exit numbers remain a gap.
  - OSM entrances (ODbL) are a cross-check only. Nothing from OSM ships.
- **Verified against the data itself** (documented in the importer header):
  - `route_type` 5/6 are swapped relative to the 2024 spec text. Mode is therefore taken from the containing GSI space category (B021 stairs / B023 escalator).
  - Fare area comes from the GSI `toll` attribute (spatial join, then propagation). It is validated so that the only paid↔free transitions are links next to published ticket-gate points (F106). Result: 0 anomalies.
- **Importer output:** 233 nodes, 263 edges, 16 POIs and 9 floors (with ja/en display names). There are 5 gate links in 3 gate clusters. Each of the 6 exits is matched to a GSI F108 point **on an equivalent floor** (an in/out node within 6 m preferred); an exit with no same-floor match would stay unroutable. Shared validator result: 0 errors and 2 warnings, both walk edges across landing levels that come straight from the source.
- **Facility labels follow the GSI code list.** F003 is 「トイレ（男女共用）」 (unisex). No multipurpose/accessible capability is claimed for it.

## G1 — geometry and collision: **PASS (bounded)** · GAP (heights)

- **Geometry.** Floors, walls, rooms, voids and railings come from GSI CAD space polygons. Stairs and escalators are placed along their source links. Collision is analytic (slab polygons, run ramps, wall segments with height bands, 0.45 m step-up).
- **One cut geometry everywhere.** Stairwells are cut out of the floor polygons where a stair runs 0.25–2.4 m below. Walls are opened only locally, where a verified link passes. Rendering, the lane's collision and the shared explorer's walk proxies all use the same cut floors and walls, so a visible wall always blocks.
- **Headless play test (main G1 evidence).** Tests require:
  - ground under every non-elevator node (0 misses);
  - all 263 edges walkable, ending at the destination's height (0 failures);
  - a guided walker that arrives on **every routable POI pair**, under both the ticketed and step-free profiles, at the destination height (±0.35 m).
- **Checked in-browser** in the lane app, with railings, gates and platform doors in collision: B1 gate area → exit 2 over the stacked switchback, and platform → exit 1.
- **Heights are symbolic.** The source publishes no z. Level heights come from a least-squares fit of run lengths (30° escalators, stair rise ratio 0.5). Every floor has `elevationM: null`, and every node has `position.z: null` plus a display-only `renderZ`. The HUD says 「推定 … m · est.」.
- **Overhead clearance (stage 2).** The fit is now constrained so that no stair/escalator run passes less than 2.3 m (2.1 m head room + slab) above any graph edge in plan, generically, with no id list. This moved the symbolic stack down: B0.5 −6.19 m, B1 −7.80 m, B2 −16.20 m … B6 −42.87 m (was B1 −4 m, where the NW switchback hung 1.2 m above the B1 walkway). `test/clearance.test.ts` samples every edge every 0.25 m against runs, pads, link strips, street pads and slabs; `test/mapped-space.test.ts` keeps mapped non-network floor (e.g. the B3 corner at (−21.4, 182.3), GSI space B021) enclosed.
- **Stacked switchbacks.** The source puts every landing of a multi-flight stair on one floor. For display only, the importer spreads the rise over the flight chain by flight length (`plan.heightModel.landingSpread`), so flights do not render flat or overlap each other. Floor ids and routing are unchanged. Narration still says 「階段を進む」 without a direction for these flights, because the source gives none.
- **Platform.** The B6 edges follow the real curved platform outline (a polyline per edge, smoothed from the trackside walls).

## G2 — routing: **PASS (E27 graph)** · GAP (facts not in the source)

- **Routing engine.** One shared router (Lane C core) serves both the lane app and the shared explorer. Fare profiles (`ticketed` / unpaid-only) and step-free are supported. Hours default to `warn_unknown`, and every route shows 「営業時間 未確認 · Hours unverified」. The strict `require_known` profile fails closed (tested).
- **Shared explorer (Lane C, core 3d867a4):** platform → exit 1 is ok, 194 m, 4 floor changes, `crossesFareBoundary: true`, unknowns = [hours]. This was verified by Lane C read-only on Shinjuku's contract files.
- **"Here" routing in the lane app** attaches the player only to a node that is:
  - in line of sight,
  - within 15 m,
  - at the same height (±0.6 m),
  - on the same fare side.
  - reachable by sweeping the walker's 0.3 m body through the real collision (props included) every 0.1 m over continuous ground, ending at the node's height.

  Otherwise the app asks the user to pick a start point. A known fare side requires affirmative same-side evidence on the node (gate links excluded).
- **Unknown, never asserted:**
  - opening hours;
  - which platform side serves which direction;
  - time-of-day escalator reversals;
  - official exit numbers;
  - current closures, e.g. OSM notes exit 2 closed since 2024-03-30, which is outside E27 data.

## G3 — gameplay and L2 visual: **GAP (stage 2 in review)**

Stage 2 (branch `claude/shinjuku-e27-l2-stage2`, to be folded into #16):

- **Enclosure:** ceilings, inclined shaft soffits, shaft walls, lift shaft linings and caps, slab undersides, elevator portals, stair details and light pools; geometry batched (peak 263 draw calls at the 26 fixed vantages, voidFraction ≤ 0.03 at all of them).
- **Street:** PLATEAU buildings with five procedural facade styles, roads/sidewalks, generic entrance canopies, street furniture and sky; hidden from underground viewpoints.
  Exit runs whose E27 link is roofed (屋根の有無 = 2; [MLIT pedestrian network spec](https://www.mlit.go.jp/common/001313706.pdf) p.5: 1 = none, 2 = roofed) and that are open to the street beyond a canopy get generic glazing (`surfaceRoofs`): exit 2's second flight and exit 4's stair. Drawn roofs above ground, street paving and kerbs are camera caps in the shared explorer, so its street probe never reads a roofed link as open sky (`test/scene-hook.test.ts`).
- **Characters:** original procedural commuters and avatar (faces, hair silhouettes, fitted bags, thumbs), one skinned draw, near/far LOD (≈2.6–3.3k / 1.1–1.3k tris); crowd setup 42 → 2.8 ms.
- **Navigation UX:** collapsible search / phone bottom sheet, route preview with overview, evidence chips, floor-change toast, arrival card, ×1/×2/×4 guide speed, escalator carry, merged narration, step-free refusal with reason and alternative, HUD-aware projected labels on phone, staged start-up with `__gteki.timings()`.
- **Fare and access containment:** free walk (lane `WalkWorld` and the explorer's walls/walkable) can cross paid ↔ free only through a verified gate aisle, and cannot stand on floor outside verified NWD/mapped GSI space. Glass fences close every such border with no length threshold; procedural elevator fill beyond mapped space is render-only. Signs state only what the source says: 立入制限区域 / Restricted area where the source space is `restricted`, 立入不可 / No entry on generic closed fill. `test/fare-boundary.test.ts` (0.25 m swept-body flood plus continuous free-space checks between barriers), `test/fare-sweep.test.ts`, `test/fare-signs.test.ts`.
  Verified edges overlapping restricted source polygons by no more than the generated conflict table values are treated as source digitisation conflicts; the restricted remainder is fenced (`test/fixtures/restricted-conflicts.json`). The corridor is each verified edge buffered by 0.32 m (0.30 m body + 0.02 m); network-strip width never subtracts. A body centre may lie inside a restricted polygon only by the local verified-edge depth plus 0.015 m inside that corridor, and by 0.015 m (fence/polygon alignment) anywhere else. `test/fare-replay*.test.ts` replays the actual lane and explorer movement rules from every public seed within 3 m of every fence end, from floor −1.75 m up to the highest body band either walker still collides with (0.95 m). The complete matrix is `pnpm test:heavy` (single worker); default `pnpm test` keeps the negative controls and restricted-boundary cases.
- **Truth tests:** `test/height-truth.test.ts` (symbolic heights only in renderZ/plan; narration identical under any display-height rescale; every HUD height labelled 推定 / est.) and `test/arrival-truth.test.ts` (exit names state their level; routes to B1 exits never claim street level).
- **Performance (production builds, headless Chrome on the dev machine, N=5 medians, `pnpm perf`; `pnpm heap` for heap composition):** lane station build 2.86 s → 1.07 s, first frame 3.3 s → 1.5 s, JS heap 72 → 43 MB; explorer ready 3.3 s → 1.55 s, warm reopen 2.66 s → 0.94 s, heap 74 → 50 MB (d3ed80d → ac034d2, interleaved runs). Layout derivation 1.56 s → 0.27 s with a pinned byte-identical layout hash (`test/layout-equivalence.test.ts`); retired merge sources are released (`test/geometry-lifetime.test.ts`).
- **Whole-station sweep:** every non-lift node facing each incident edge (`tools/node-vantages.ts`, 456 views): 0 views above 0.10 near-black, worst 0.061. The lane follow camera stops at landing/shaft soffits.
- **Shared explorer:** underground ceilings/soffits and canopy roofs are invisible camera caps (exported as `cameraBlockers` for the proposed scene-api field, and as colliders until then), the station owns its lighting there (no sun underground), and the street context follows the explorer camera. Worst near-black frame along exit 1 ↔ platform, platform → exit 2 and platform → exit 1 went from 0.60 to ≤ 0.09 (`explorer-walk`).

Implemented and observed in a real browser on desktop, plus a 375×812 phone viewport (emulated, **not** a physical phone):

- A search → route → guide/free-walk loop with ja/en turn-by-turn narration and a next-maneuver banner. Off-route triggers a re-route.
- A third-person camera with wall occlusion, run, a touch joystick and RUN.
- **Station visuals:**
  - procedural (rights-clean) tile, wall and ceiling materials, with GTAO and bloom on the high-quality setting;
  - ticket gate lines;
  - animated escalators;
  - tactile paving where the source has `brail_tile`;
  - original wayfinding signs generated from the router (labelled GTEki design, not operator signage).
- **On the B6 platform:**
  - curved platform screen doors whose leaves open while a train dwells;
  - tunnel and track;
  - a generic original 8-car train on a 110 s cycle, with the line colour as an accent only.
- **Decorative ambient commuters** (seeded and invented; labelled *not crowd data*), and synthesized WebAudio ambience.

Still needed for L2 (not claimed): an independent visual/interaction review (Lane F), a recorded landmark→destination walkthrough video, a physical phone test, avatar and NPC fidelity, lighting polish on the upper concourse levels, and performance numbers from a real device.

## G4 — delivery: **GAP** (release published by Owner override at [#16](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757); QA and rights items open)

Reproducibility is in place: `pnpm typecheck`, `pnpm test`, and `import:e27 --check`, which reproduces byte-identical files from hashed inputs (provenance uses the pinned `acquiredAt` in `sources/manifest.json`, not the local download time). Three fresh read-only Codex reviews ran: 15 findings, then 6 on the fixes, then 2 partials on those. All are fixed; the PR lists each one. Still open: an exact-SHA QA pass by Lane F; the Owner's L2 acceptance sign-off. Release: published by Owner override at [#16](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757); reuse after 2027-03-12 open.

## Coverage gaps (field work needed)

| Zone | Missing fact | Source date | Needed |
| --- | --- | --- | --- |
| Connections to JR / Keio / Odakyu / Toei S01 / Metro M08 / E01 | Verified public passages beyond the E27 boundary | — | Open network data per operator, or a permitted survey |
| All levels | Measured floor elevations | 2025-09-19 | Survey, or licensed BIM/CityGML covering E27 |
| Exits | Official exit numbers/names | — | Operator confirmation or field check |
| All links | Opening hours | — | Operator hours per exit/passage |
| Escalators | Time-of-day direction changes | 2025-09-19 | Field check at peak and off-peak |
| Platform (B6) | Which side serves 都庁前 vs 両国・六本木 | — | Field check or licensed operator data |
| Around 西口・南口 | Current closures | — | Operator notices plus a field check |
| All E27-derived data | Commercial reuse/distribution of derived data after the publication period (2027-03-12) | 2026-09-17 | Written answer from MLIT ほこナビDP窓口 |

## Deliberate simplifications (not reproductions)

- **Shared defaults.** Ceiling heights, wall thickness, materials and light fixtures are generic.
- **Ticket gates.** The machine count fills each published gate line; the real number of machines is not in the data.
- **Platform screen doors.** A generic 5.6 m module; door positions do not match real car doors.
- **The train.** A generic small-profile 8-car set, not a model of the 12-000/12-600 series. The dwell cycle is decorative, not a timetable.
- **Signs.** GTEki's own design and pictograms. No operator sign graphics are copied.
- **Commuters.** Invented ambient agents walking real graph routes. They are not crowd or occupancy data.
- **Heights.** Symbolic (see G1), clearance-constrained. Visual stair and escalator pitch follows the symbolic level heights. Where a generic 3.4 m stair width would overlap a walkway beside its foot, 3.0 m (the class-4 lower bound) is used.
- **Street context.** PLATEAU footprints/heights are real; facades, colours, canopies, signs on canopies, trees and furniture are generic. Canopies are one generic design per street exit, not the real structures.
- **Characters.** Invented appearance and clothing; procedural faces and hands; rigid hair and bags. Not crowd data.
- **Lift shafts.** Linings, caps and the headroom hood are procedural fill; the ride itself remains a symbolic transfer.
- **Fences.** Procedural 1.15 m glass/metal containment fences and their signs are safety/visual fill, not surveyed station equipment; two generic machines straddle each verified gate row.
- **Flat stair links.** Stairs/escalator links whose two ends render at the same height are shown as flat walkways.

## Godot path

The station data is engine-neutral: the contract JSON plus `plan.json` in ENU, mapped to the renderer frame as `(x, z, -y)`. The scene builder is Three.js-specific. A Godot client can rebuild the same layout from `scene/layout.ts` semantics, or consume GLBs exported later through Lane E. No Godot client is claimed yet.
