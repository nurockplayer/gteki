# 新宿駅 Shinjuku — Lane B station record

**Status: candidate, NOT ACCEPTED.** Owner approval is required before merge or release. This record makes no real-world navigation guarantee.

**Scope of this slice:** the Toei Oedo Line Shinjuku station (**E27**), using the extent of the published MLIT/Toei open dataset. The slice covers nine NWD levels, from street level (GL/1F) down to the B6 platform. JR, Keio, Odakyu, Toei Shinjuku Line, Tokyo Metro and Shinjuku-nishiguchi (E01) are **not** in this slice; see the Coverage section.

## How to run

```bash
pnpm install
pnpm --filter @gteki/station-shinjuku dev        # lane explorer → http://localhost:5174
pnpm --filter @gteki/web dev                      # shared explorer (Lane C) → pick 新宿駅
pnpm --filter @gteki/station-shinjuku import:e27 --check   # data reproducibility (needs raw inputs)
```

To get the raw inputs, run `stations/shinjuku/tools/fetch-sources.sh`. It downloads into `~/Developer/gteki-raw/shinjuku` (override with `GTEKI_RAW_SHINJUKU`) and verifies every file against the sha256 values in `stations/shinjuku/sources/manifest.json`. Nothing raw is committed.

## Layout

| Path | What |
| --- | --- |
| `stations/shinjuku/gteki/{station,graph,pois}.json` | Shared contract `gteki.station/0.1` files (Lane C parser). These are the routing truth. |
| `stations/shinjuku/gteki/scene.ts` | `@gteki/scene-api` hook: the same scene inside the shared explorer. Invisible walk proxies plus ENU walls. |
| `stations/shinjuku/data/plan.json` | Render-only plan: GSI space polygons and facilities, plus symbolic node heights. Not used for routing. |
| `stations/shinjuku/scene/` | Renderer-neutral layout (`layout.ts`, analytic WalkWorld collision) and the Three.js builder (`build.ts`). |
| `stations/shinjuku/app/` | The lane's own L2-target explorer: third-person walk, guide, narration, audio, crowd, minimap, phone UI. |
| `stations/shinjuku/tools/` | Importer (`import-e27.ts`), raw loader, analysis, and the fetch/verify script. |

## G0 — provenance and rights: **PASS (E27 extent)** · GAP (rest of Shinjuku)

- **Sources.** Both are from ほこナビDP (MLIT), dataset `2d8ff84b-…`, last modified 2026-09-17, link maint_date 2025-09-19:
  - 歩行空間ネットワークデータ, which gives the graph.
  - 構内地図データ, which gives spaces, fare areas and facilities.
- **Licence.** Both are under 公共データ利用規約 1.0 (PDL 1.0), so modification and redistribution are allowed with attribution. GTEki shows the attribution in the app footer, the coverage dialog and every source record (`modified: true`).
- **Expiry risk.** The dataset is a *limited publication* for 公共交通オープンデータチャレンジ2026, valid **until 2027-03-12**. This is recorded as `validUntil`. Before that date the Owner must decide whether the derived data may remain public. HOLD on any release planned after it.
- **Evaluated and not used:**
  - PLATEAU ubld 53394536 does not overlap E27.
  - The S10 store CSV has no coordinates.
  - The Toei website served a bot-check (CAPTCHA). It was **not** bypassed, so exit numbers remain a gap.
  - OSM entrances (ODbL) are a cross-check only. Nothing from OSM ships.
- **Verified against the data itself** (documented in the importer header):
  - `route_type` 5/6 are swapped relative to the 2024 spec text. Mode is therefore taken from the containing GSI space category (B021 stairs / B023 escalator).
  - Fare area comes from the GSI `toll` attribute (spatial join, then propagation). It is validated so that the only paid↔free transitions are links next to published ticket-gate points (F106). Result: 0 anomalies.
- **Importer output:** 233 nodes, 263 edges, 16 POIs and 9 floors. There are 5 gate links in 3 gate clusters, and 6 exits matched to F108 points within 6 m. Shared validator result: 0 errors and 2 warnings, both walk edges across landing levels that come straight from the source.

## G1 — geometry and collision: **PASS (bounded)** · GAP (heights)

- **Geometry.** Floors, walls, rooms, voids and railings come from GSI CAD space polygons. Stairs and escalators are placed along their source links. Collision is analytic (slab polygons, run ramps, wall segments with height bands, 0.45 m step-up). Tests check that every graph node has ground under it and that walk edges are walkable.
- **Heights are symbolic.** The source publishes no z. Level heights come from a least-squares fit of run lengths (30° escalators, stair rise ratio 0.5). Every floor has `elevationM: null`, and every node has `position.z: null` plus a display-only `renderZ`. The HUD says 「推定 … m · est.」.
- **Platform.** The B6 edges follow the real curved platform outline (a polyline per edge, smoothed from the trackside walls).

## G2 — routing: **PASS (E27 graph)** · GAP (facts not in the source)

- **Routing engine.** One shared router (Lane C core) serves both the lane app and the shared explorer. Fare profiles (`ticketed` / unpaid-only) and step-free are supported. Hours default to `warn_unknown`, and every route shows 「営業時間 未確認 · Hours unverified」. The strict `require_known` profile fails closed (tested).
- **Checked in-browser:** platform → exit 1 is 194 m with 4 floor changes in the shared explorer, using guided auto-walk and free walk.
- **Unknown, never asserted:**
  - opening hours;
  - which platform side serves which direction;
  - time-of-day escalator reversals;
  - official exit numbers;
  - current closures, e.g. OSM notes exit 2 closed since 2024-03-30, which is outside E27 data.

## G3 — gameplay and L2 visual: **GAP (in progress)**

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

## G4 — delivery: **HOLD**

Reproducibility is in place: `pnpm typecheck`, `pnpm test`, and `import:e27 --check`, which reproduces byte-identical files from hashed inputs. A fresh read-only Codex review was run, and its findings are tracked in the PR. Still open: an exact-SHA QA pass by Lane F, the Owner decision on PDL expiry, and Owner merge approval.

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

## Deliberate simplifications (not reproductions)

- **Shared defaults.** Ceiling heights, wall thickness, materials and light fixtures are generic.
- **Ticket gates.** The machine count fills each published gate line; the real number of machines is not in the data.
- **Platform screen doors.** A generic 5.6 m module; door positions do not match real car doors.
- **The train.** A generic small-profile 8-car set, not a model of the 12-000/12-600 series. The dwell cycle is decorative, not a timetable.
- **Signs.** GTEki's own design and pictograms. No operator sign graphics are copied.
- **Commuters.** Invented ambient agents walking real graph routes. They are not crowd or occupancy data.
- **Heights.** Symbolic (see G1). Visual stair and escalator pitch follows the symbolic level heights.

## Godot path

The station data is engine-neutral: the contract JSON plus `plan.json` in ENU, mapped to the renderer frame as `(x, z, -y)`. The scene builder is Three.js-specific. A Godot client can rebuild the same layout from `scene/layout.ts` semantics, or consume GLBs exported later through Lane E. No Godot client is claimed yet.
