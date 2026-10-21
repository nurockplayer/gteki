# 池袋駅 Ikebukuro — station lane

Real, searchable, navigable Ikebukuro Station for GTEki. Five slices are routable on a verified
graph and walkable in a lit, signed, populated 3D scene:

- **Slice 1**: the public B1 Central Passage from the JR Central Gates east to Exits
  27/34/35/36/37/42/43.
- **Slice 2**: the passage along the JR east side down to the South Passage's east end, Exit 38
  (東口（南）), and the south-east corridor to Exits 41, 40 and 39.
- **Slice 3**: the passage along the JR east side north to the North Passage and Exit 22
  (東口（北）), then down to the passage between the Ikebukuro Shopping Park blocks and Exits 26,
  28, 32 and 33.
- **Slice 4**: the Central Passage west past the Marunouchi and Tobu gates into the West Exit (西口)
  underground hall, and its passages to Exits 10, 11, 15, 17 and 18, plus the foot of Exit 13.
- **Slice 5**: the South Passage west past the JR South Gate (南改札) to the West Exit (South) (西口（南）)
  hall and Exit 4, and the passage north from there to the West Exit hall. The Exit 4 stairs are
  outside the PLATEAU survey, so routes end at their foot (see "Deliberate simplifications").

Area names printed on the official map (北通路, 南通路, 東口（地下）, 西口（地下）, 西口（南）（地下）) are
searchable POIs at the matching hall or passage node, so search and the explorer's start chips use
them.

**Status: NOT YET ACCEPTED.** Desk-verified, not field-verified. Opening hours are unknown. This
is not a whole-station model (see [coverage gaps](docs/coverage-gaps.md)).

## Run it

```sh
pnpm install                      # in stations/ikebukuro
pnpm dev                          # station preview harness: http://localhost:5173
pnpm typecheck
```

- **Preview harness** ([preview/main.ts](preview/main.ts)): third-person walk.
  - Controls: WASD/arrows, Shift to run, mouse drag or wheel for the camera, left-half touch joystick.
  - URL params: `?spawn=<nodeId>` (`c_mid`, `c_e2`, `sp_e`, `n_h`, `w_c`, `sw_h`), `?q=mobile` (low quality, 2k lightmap,
    no post FX).
- **Shared explorer** (core lane, `apps/web`): discovers `gteki/` automatically. Search, route,
  guided walk and free walk run there.
- **Street-context budget probe** (draws/tris underground vs street, one run per tier; real GPU, not in CI): after `pnpm build`, in `tests/e2e` run `GTEKI_BUDGET=1 GTEKI_ROOT=<repo> pnpm exec playwright test specs/10-ikebukuro-context-budget.spec.ts --project=phone-chromium` (low) or `--project=desktop-chromium` (high); results land in `<repo>/.qa/ikebukuro-context-budget/`.
- **Capture tooling** (dev only): `gt.capture(name)` and `gt.walkCapture(...)` write frames to
  `build/captures/`.

## Layout

| Path | What | Truth or presentation |
|---|---|---|
| `data/graph.src.json` | Hand-authored nodes, edges, POIs, access facts, sources and coverage | truth (source) |
| `gteki/station.json`, `graph.json`, `pois.json` | `gteki.station/0.1` bundle built by `pipeline/build_station.py` | truth (built) |
| `gteki/scene.ts` → `scene/*.ts` | `gteki.scene/0.1` scene: materials, signs, crowd, lighting | presentation |
| `gteki/assets/` | One manifest asset: `ikebukuro_b1.glb`, role `visual`: generic loaders take collision from its per-mesh `gteki_role` tags (wall/barriers/transport), so door and portal panels on verified routes stay passable. Its `files` hold the runtime variant `ikebukuro_b1_lit.glb` (+ UV1, fixtures) and the 4k/2k lightmap WebPs, so generic loaders never load both GLBs. `scene.ts` loads the lit variant | presentation |
| `scene/signage.json`, `scene/crowd_lanes.json` | Derived from the verified graph and the PLATEAU walkable grid | presentation |
| `scene/walk_bridges.json` | Invisible walking strips over hairline cracks between PLATEAU floor polygons | presentation |
| `scene/access_fences.json` | Walker-blocking fences with a 「通行可否 未確認」/"Access unverified" marker where surveyed floor of unknown access would shortcut the routable areas | presentation |
| `pipeline/` | Reproducible data and asset build (stdlib Python + Blender; one Node walker check) | — |
| `docs/` | G0 source audit, coverage gaps, evidence | — |

## Reproduce

Tools: Homebrew `blender` (5.2 LTS), `webp`, `imagemagick`, `godot` (optional); pnpm.

```sh
bash pipeline/fetch_sources.sh    # PLATEAU GML + metadata (sha256-checked) into data-cache/
pnpm build:data                   # GML -> ENU JSON -> GLB -> verified graph -> signage -> walk bridges -> access fences
pnpm bake:lighting                # 4096 Cycles lightmap (Metal GPU ~5 min; DEVICE=CPU works) -> WebP
pnpm check:access                 # outline has no fence gap; walker flood never leaves routable floor
pnpm check:godot                  # headless Godot: loader colliders + every verified edge traversable (see below)
```

`build_station.py` exits non-zero if any edge fails geometry validation or if a POI points at a
missing node. An edge is `verified` only when **both** of these hold:

- every 0.5 m sample lies on surveyed floor or stair treads, with no wall crossing at body
  height (geometry evidence);
- the edge cites an official access fact (access evidence).

## Godot proof path (collider check, issue #35)

`pnpm check:godot` (`pipeline/godot_colliders.sh`, needs Godot 4.7; `GODOT_BIN` overrides
`/opt/homebrew/bin/godot`) loads this station through the addon's own `gteki_station.gd` /
`gteki_assets.gd` (the same classes `packages/godot/tests/run_tests.gd` uses), then lists every collider the
loader created and casts the walker body along every verified edge (about 0.25 m steps: horizontal rays at
0.2/0.6/1.0/1.4/1.7 m above the floor, plus a radius 0.3 m, 0.2-1.7 m capsule overlap). It runs in under a
second. `pnpm check:godot --control` forces the old asset role `visual+collision` and must be detected (it
reproduces `w_n__x18` at ENU (-100.5, 152.5) blocked by `doors`), which shows the check can see the bug.

- **Colliders in Godot (role `visual`):** exactly three trimesh bodies, one per merged mesh: `wall`,
  `barriers`, `transport`. `doors`, `portals`, `windows`, `ceiling` and `floor_elements` get none;
  `floor` and `stairs_ramps` are tagged walkable but also get no physics body (the addon has no floor
  collider). Door/portal/window colliders: 0.
- **Verified routes:** all 63 verified edges (7140 samples) are clear of rays; 0 blocked. The stricter
  capsule overlaps `barriers` / `transport` (stair and escalator rails) at 35 samples on `e_low__x35`,
  `ne_e__x33` and `w_c__w_n` (ENU (-112.8, 130.8)): the centerline is clear, but a 0.3 m radius body would graze
  those rails. This is not a door problem.
- **Access fences are web-only:** `scene/access_fences.json` is built by `scene/scene.ts` and is not in
  the GLB or the manifest, so Godot free walk is NOT access-fenced; it can reach surveyed floor the web scene
  fences off as "access unverified".
- **Door semantics:** with role `visual`, doors are simply non-colliding everywhere in Godot. Verified exit
  routes pass, but so do shopfront doors and windows, which the web scene makes solid (`solidDoors`, leaving
  open only panels that verified-route segments cross), and so do `portals`, which the web blocks as
  `portal_beyond`. Godot free walk can therefore walk into unmodelled rooms and out through openings. That is
  fine for the proof path and matches the verified-route contract. If Godot free walk must match the web, the
  loader needs route-aware door/portal semantics: either a generic data-driven rule (`doors`/`windows`/`portals`
  stay solid except near verified-edge segments), or the station ships pre-split solid door and `portal_beyond`
  meshes tagged `wall`. Recommendation: not now; keep role `visual` and use `pnpm check:godot` as the
  regression gate.

## Sources and rights

| Source | Use | Rights |
|---|---|---|
| PLATEAU CityGML ubld 53394576 (Toshima, LOD4.1, 2023 survey) | all geometry, assets and walkable grid | CC BY 4.0. Credit "PLATEAU (MLIT)", modified |
| Toshima underground guide map (2022) | facts only: which opening is which exit or gate | reference-only, `usage: facts-only` |
| Tokyo Metro Ikebukuro yard map (2026-03) | facts only: exit numbers, gate names | reference-only, `usage: facts-only` |

- No operator maps, logos, photos or typefaces are in the repo.
- Signs use GTEki's own style: charcoal panels and yellow exit badges.
- Every texture is procedural, generated at runtime.
- Light fixtures, crowd and haze are GTEki art direction, declared in each asset's `derivation`.

## Acceptance record (quality contract G0–G4)

| Gate | Verdict | Evidence / remaining |
|---|---|---|
| **G0** evidence / rights | **PASS (desk)**, **HOLD (field)** | [G0 audit](docs/G0-source-audit.md); rights chain above. Owner decision 2026-10-21: facts and works are separated, so facts from the reference-only maps may be published; JR East maps were traced and not used. Field visit pending ([survey brief](docs/coverage-gaps.md)). |
| **G1** geometry | **PASS** for slices 1–5 | Real-scale PLATEAU geometry, identity transform, z = TP height. Walker stays on floor, climbs Exit 35 stairs (TP 27.0 → 30.1 m), is blocked by walls and by openings into unmodelled space. No verified edge crosses a wall or opening at 1 m. Slice 2 follows the surveyed level changes: South Passage TP 27.6 → 29.1 m (up) → 25.9 m (down), with exit stairs to TP 32.2–32.6 m. Slice 3: North Passage TP 28.5 m, down to TP 26.2 m between the shopping-park blocks, U-shaped Exit 28 stair via a TP 29.0 m landing. Slice 4: West Exit hall TP 27.9 m, exit stairs to TP 33.15 m; Exit 18 is a three-flight stair (landings TP 29.1 and 30.5 m) whose top flight passes over the bottom one. Sloped wall faces (stair side walls) are split into ≤0.5 m pieces with their own height band, so a flight passing under another is not falsely blocked. Slice 5: South Passage west and West Exit (South) hall TP 27.6 m, rising to TP 27.9 m along the passage north. Godot 4.7 headless import keeps roles and UV2 (`pipeline/godot_probe.gd`). Playability sweep: the preview walker, steered only by keyboard input, walks every verified edge in both directions (126/126 pass). Hairline cracks between adjacent PLATEAU floor polygons, which had stalled it on the Exit 18 stair landing, are bridged by invisible walking strips (`pipeline/build_walkfix.py`). |
| **G2** routing | **PASS (desk)** | 63/63 edges verified, 1744 m. Shared-core `parseStationFiles` returns ok; the only warnings are 20 deliberately search-only POIs (5 Metro/Tobu gates and 15 exit numbers on the official maps that are not yet routable, so a search for them says so instead of finding nothing). From JR Central Gate 2: Exit 35 = 199 m, Exit 38 = 242 m, Exit 41 = 291 m, Exit 40 = 369 m, Exit 39 = 425 m, Exit 22 = 173 m, Exit 26 = 223 m, Exit 28 = 244 m, Exit 33 = 269 m, Exit 32 = 278 m, Exit 17 = 166 m, Exit 15 = 169 m, Exit 18 = 176 m, Exit 10 = 211 m, Exit 11 = 212 m, JR South Gate = 234 m, Exit 4 (stair foot) = 287 m, Exit 13 (stair foot) = 159 m. Junction nodes sit at real decision points (e.g. just outside each JR gate), so narration reads "Go straight ~7 m / Turn left…" ([explorer](docs/evidence/explorer-route-jrc2-exit35.jpg)). Negative case: the step-free profile fails safely (`no_path`). |
| **G3** quality (L2) | **GAP**: candidate, not yet claimed | See "G3 detail" below. |
| **G4** delivery | **PASS (Owner, 2026-10-21)** | Public release cleared ("ship directly") once the rights check, deployment isolation, Codex review and integration regression pass. The UI states that the data is desk-verified, not field-verified, and that hours are unknown. |

### G3 detail

Done so far:

- Baked GI lighting.
- Procedural materials.
- Data-driven double-sided signage. Back faces group destinations by the turn taken at the
  junction (← / ↑ / →). Each sign is centred in the passage and trimmed to the clear width
  measured from PLATEAU walls at sign height.
- Ambient crowd.
- Procedural ambience (`scene/ambience.ts`), playing in the shared explorer through the host
  `ctx.audio` hook (verified against core `b0d14ac`: `__gteki.audio()` available and running,
  HUD mute works).
- Exit daylight.
- A recorded 121 s walk, landmark (JR Central Gate 2) → Exit 35 ([video](docs/evidence/walk-jr-central-gate2-to-exit35.mp4)).
- A recorded 117 s walk along the routed polyline, West Exit (B1) → Exit 4 stair foot (187 m, slices 4–5)
  ([video](docs/evidence/walk-west-exit-to-exit4.mp4)).
- An independent Astra High critique, addressed in `ca399cb`.

Remaining before claiming L2:

- A real phone test (only emulated so far).
- A side-by-side reference review on site.
- An avatar pass in the explorer (core lane).

Evidence stills:

- [central passage](docs/evidence/01-central-passage-east.jpg)
- [JR gate](docs/evidence/02-jr-central-gate2.jpg)
- [east hall](docs/evidence/03-east-hall.jpg)
- [Exit 35 stairs](docs/evidence/04-exit35-stairs.jpg)
- [Exit 43](docs/evidence/05-se-corridor-exit43.jpg)
- [sign back](docs/evidence/06-sign-back.jpg)
- [phone (emulated)](docs/evidence/m01-central-passage-mobile.jpg)
- Slice 2: [JR east-side passage](docs/evidence/13-jr-east-passage.jpg),
  [South Passage east](docs/evidence/07-south-passage-east.jpg),
  [Exit 38 junction](docs/evidence/08-exit38-junction.jpg),
  [Exit 41 junction](docs/evidence/09-exit41-junction.jpg),
  [south-east corridor](docs/evidence/10-se-corridor.jpg), [Exit 40](docs/evidence/11-exit40.jpg),
  [Exit 39 stairs](docs/evidence/12-exit39-stairs.jpg)
- Slice 3: [North Passage, Exit 22](docs/evidence/15-north-passage-exit22.jpg),
  [stairs down to the shopping-park passage](docs/evidence/16-stairs-to-isp.jpg),
  [shopping-park passage](docs/evidence/17-isp-passage.jpg), [Exit 28 junction](docs/evidence/18-exit28.jpg)
- Slice 4: [West Exit hall](docs/evidence/19-west-exit-hall.jpg),
  [passage north from the hall](docs/evidence/20-west-north-passage.jpg),
  [Exit 17 stairs](docs/evidence/23-exit17-stairs.jpg), [Exit 18 U-stair](docs/evidence/21-exit18-ustair.jpg),
  [passage to Exits 10/11](docs/evidence/22-exits-10-11.jpg), [Exit 13 stair foot](docs/evidence/29-exit13-foot.jpg)
- Slice 5: [South Passage west](docs/evidence/24-south-passage-west.jpg),
  [by the JR South Gate](docs/evidence/25-jr-south-gate.jpg),
  [West Exit (South) hall](docs/evidence/26-west-exit-south-hall.jpg),
  [Exit 4 stair foot](docs/evidence/27-exit4-foot.jpg), [passage north](docs/evidence/28-west-corridor.jpg)

**Measured** (harness, Apple Silicon, Chromium):
- quality "low": at most 28 draw calls and 129k triangles per frame (56 crowd agents, 100 signs; four spots × four headings in the Central, West, South-West and North areas). Signs share atlas textures and merged geometry (three draw calls for all of them; one mesh per sign had pushed this to 252). On "low" the sign atlas is one 4096 × 2048 page painted at ~160 px/m (about 45 MB of GPU texture with mipmaps, down from 134 MB at full resolution);
- shipped assets: 9.5 MB at "high", with lightmap WebP 1.1 MB (4k) or 0.5 MB (2k).

## Deliberate simplifications

- **Light fixtures** are generated on a regular 2.4 × 3.0 m grid under surveyed ceilings. They are
  not surveyed positions, and the colour (4000 K) is art direction.
- **Materials** are generic procedural finishes: tiles, enamel panels, ceiling grid, granite
  stairs. They are not the station's actual finishes.
- **Shopfronts** are anonymous glowing glazing in PLATEAU window and door openings. No shop
  names or brands.
- **Signs** use GTEki's design, placed about 4 m along each verified edge from junctions. Their
  content is computed from the verified graph. Positions are not real sign locations. Gate names
  carry a plain line-colour chip ("JR" on green), not an operator logo.
- **Crowd** is ambient decoration on verified edges, clamped to surveyed walkable lanes. It is
  not a pedestrian-flow model.
- **Openings into unmodelled space** (fare areas, shops) block movement and render as a fogged
  continuation of the opening's own floor and ceiling heights, ray-traced per pixel in the shader
  (parallax, no geometry). It shows that the space continues, not what is there.
- **Exit stairs** end in a daylight portal. There is no street-level model yet.
- **Single risers** modelled as two floor levels (e.g. a 0.19 m step between landings on the
  Exit 39 stair) are passable on stair edges only, so walk-only and step-free routing stay
  strict.
- **An exit node is the top of its surveyed stairs**, under the stairwell's street-level closure;
  `build_station.py` and `scene/access.test.ts` fail if surveyed treads rise above an exit node or
  no closure is just overhead.
- **Exits whose stairs are outside the survey** (Exit 4; for Exits 13 and 36 only the lower flight is surveyed) are routed to the foot of the stairs:
  the connector is a `stair_end` node on surveyed B1 floor at the PLATEAU wall opening the
  official map places the exit at. The climb itself is not modelled or claimed, and the opening
  renders as haze.
  The POI keeps its plain name ("Exit 4"); at a `stair_end` connector the shared narration says
  "Stairs to Exit 4 start here" (core #21).
- **Free walking stays on verified floor.** Surveyed floor outside the routable areas, such as
  the JR–Tobu passage (`gap-tobu-jr-link`), the Yurakucho gate area (`gap-south-west`) or the
  passage west from slice 3, stays visible but cannot be entered. `pipeline/build_access.py`
  fences the whole outline of the routable areas wherever surveyed floor lies within 0.6 m of
  it: invisible full-height colliders that overlap at their ends, with a 「通行可否 未確認」/
  "Access unverified" panel where floor carries on outside. It fails if a fence comes within
  0.35 m of a verified edge (except within 0.6 m of a dead end such as a ticket gate on its gate
  line). `scene/access.test.ts` (in `pnpm test`) checks two things against the lit GLB's floor.
  The outline: wherever floor lies next to it, panels holding both of the walker's collision
  rays cover it as an exact interval union, so a gap of any width fails (negative controls: a
  1 cm cut, a short panel). The walker: a lattice flood from every graph node with the
  explorer's own rules, keeping each floor level separate, never reaches floor outside the
  routable areas (negative control: no fences). `pnpm check:access` runs both, the flood at
  0.1 m. Both use their own collider build, so a third check replays the explorer's real walker
  (`stepWalk`: forward rays with the radius allowance, step limits, damped height, 0.05 m steps,
  continuous headings, wandering walks) against the colliders `scene.ts` itself assembles
  (`assembleCollision` plus the fence collider, ray-tested with the explorer's `castAll`), from public floor
  on both sides of every fence panel and around every panel endpoint
  (`scene/walker_replay.test.ts`, harness `pipeline/walker_replay.ts`; `scene/walker_replay.heavy.test.ts`
  is the dense version, `pnpm test:heavy`). Negative controls: removing the longest panel, and removing
  every fence. Fences block the walker only; the graph, routing and gridnav are unchanged.

## Street-level context (#39)

`assets/ikebukuro_context_low.glb` (8 tiled meshes, 30,418 triangles, 2.3 MB) and `_high.glb` (8 meshes, 139,525
triangles, 9.5 MB) are visual-only PLATEAU surface **buildings and roads** around the exits, built by `tools/gis`
(`gis context-glb ikebukuro --variant low|high --merge tiles:380`; commands, receipts in `docs/gis/context/` and
sha256s are on the `street-context` asset in `station.json`). Every node is `gteki_role=context`, `ctx_bldg_*` or
`ctx_road_*`, `NOT_FOR_ROUTING`: never walkable, never a collider, never a camera blocker, and `assembleCollision`
never sees them. `scene/scene.ts` loads the file for `ctx.quality` (fails soft) with a cheap daylight material that
takes the explorer's street fog, and keeps the group **out of the scene** unless the camera is at street height:
renderer y within [street - 1 m, street + 25 m] (street = 32.5 m) and the scene is fogged (`scene/context.ts`, read
from an `onBeforeRender` on the B1 floor mesh, so one frame late and no extra draw call). Underground and in overview
(camera about 301 m up, no fog) the context costs nothing and does not change the overview framing; at street level
low adds at most 8 draws and 30.4k triangles. The credit 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成
is each context source's `attribution`, which the app's coverage dialog lists. **Roads ship as geometry only** (no
`tran` attribute) under the Owner's risk acceptance that the GSI approval (令7関公第296号) covers attributes only:
`docs/gis/decisions/2026-10-22-plateau-tran-geometry-risk-acceptance.md`. If that scope turns up and does not fit, the
`--kinds bldg` build is the buildings-only fallback.

## Next

1. Field visit with the [on-site checklist](docs/field-checklist.md).
2. Yurakucho Line South Passage East/West Gates (`gap-south-west`).
3. North-east, north part: exits 23–25 and 29–31 (`gap-ne-north`).
4. West, rest: Exits 5, 6a, 6b and 7 (`gap-west-corridor-exits`); Exits 8, 9, 14, 16 and 19
   (`gap-west-stairs`); the passage between the JR and Tobu blocks (`gap-tobu-jr-link`).
5. Street level.
6. Step-free routes, once lift evidence exists.
