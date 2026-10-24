# G-5 handoff: deliberate simplifications, gaps and how to continue (#164)

This is the G-5 written handoff for the Godot HQ client (issue [#164](https://github.com/nurockplayer/gteki/issues/164)).
It records what was deliberately simplified, what is still open, and what a successor needs to run. Every statement
cites a file on `origin/main` (by section) or an issue/PR (`#NNN`); figures are quoted from whichever source measured
them. Where something is unmeasured or unknown, the text says so.

- Client documentation and commands: [../README.md](../README.md). This document assumes its G-1 to G-5 sections.
- Evidence tables: [evidence/g5-ikebukuro.md](evidence/g5-ikebukuro.md),
  [evidence/g5-shinjuku.md](evidence/g5-shinjuku.md), [evidence/g5-performance.md](evidence/g5-performance.md).
- Data bridge contract: [data-bridge.md](data-bridge.md).

Sources are `main` as of 2026-10-24. This document and the README handoff section ship together in their own
documentation PR.

## 1. Scope and status

| Milestone | Status | Key PRs | What exists |
| --- | --- | --- | --- |
| G-1 Scene snapshot + load | merged | #184, #253, #396 | Headless `buildScene` export to GLB + sidecar for both stations; Godot loads roles, walls, spawn points and the environment; headless count/role/frame tests. |
| G-2 Walk + follow camera | merged | #228 | Web-rule `CharacterBody3D` walker and `followCamera`/`placeCamera` port; headless walk and camera replays. |
| G-3 Search + route + guided walk | merged | #169, #241 | HUD search/route/step list, route ribbon and guided walk through the TypeScript CLIs; lift rides read from the route's own `elevator` step. |
| G-4 High-quality look | partial | #251, #254, #355, #370, #390, #403, #405, #412 | The G-4a baked Ikebukuro lightmap (#251), opt-in `hq` profile (AgX Environment, material table), showcase side-by-side and luminance/tuning tooling, four round-1 look gaps closed. Interior brightness (#401) is open and the kit AO is not in yet (#393 waits for #352). |
| G-5 Evidence + performance | partial | #283, #289, #290, #291, #306 | Evidence walks for both stations (including lift rides, #290) and the first windowed performance table. This document is the milestone's remaining item and ships in its own PR. |

G-4 and G-5 are called partial rather than done: the look profile is still opt-in and the #401 sweep has not run
(see [In flight](#4-in-flight)). No open PR is described as merged anywhere in this document.

## 2. Deliberate simplifications

### 2.1 Snapshot and export

| Simplification | Why | Source |
| --- | --- | --- |
| The 2D canvas is a no-op: procedural textures and sign faces are blank, and `measureText` is an em-width estimate, so signs can be sized differently from the browser. | No canvas library is used and Node has no 2D context. | `packages/godot/src/headless-dom.ts` header and `approximateTextWidth`; README "Station scene snapshots (G-1)". |
| PMREM is stubbed (empty environment), `loadTexture` and GLB images return blank placeholders, and there is no audio (`ctx.audio` undefined). | All of these need a browser or a GPU. | `packages/godot/src/headless-dom.ts`; the shim/dropped warnings in `packages/godot/src/export-scene.ts`. |
| Every material texture is stripped; the snapshot keeps base colours, material names and both UV sets only. It is **untextured and unlit**: geometry, roles and colours, not the #94 look. | The look is rebuilt in Godot (G-4), not carried in the snapshot. | `packages/godot/src/export-scene.ts` (`stripTextures`); README G-1. |
| The baked Ikebukuro lightmap is the one texture carried across, as sidecar metadata plus a Godot shader. | It is scene lighting the snapshot would otherwise lose. | README "Baked lightmap (G-4a)"; `packages/godot/src/scene-roles.ts` `tagLightmaps`. |
| `InstancedMesh` objects (escalator steps, platform-door leaves) are baked into static merged meshes at the `update(0, 0)` pose; per-instance colours and per-frame animation are not exported. | Godot 4.7 cannot import `EXT_mesh_gpu_instancing`. | `packages/godot/src/export-scene.ts`; `packages/godot/src/scene-roles.ts` `bakeInstancedMeshes`. |
| Dynamic/skinned objects (the Ikebukuro `ambient_crowd`) are dropped, and `update()` runs once at `(0, 0)`, so the snapshot is the t=0 pose. | Animated content has no static meaning for a snapshot. | `packages/godot/src/export-scene.ts`; `packages/godot/src/scene-roles.ts` `dropDynamicObjects`. |
| Godot owns no station truth. Geometry, walls, spawn points and the environment come from TypeScript; the GLB's roles are only the web walker's collision truth. | The web client must stay the single source of truth. | README intro and G-1; `packages/godot/src/export-scene.ts` header. |
| Collision-only proxies are hidden; drawn meshes the scene replaces with its own collision are exported as `visual` with `gteki_source_role`; a partly visible multi-material mesh splits its hidden groups into a `<name>_hidden_materials` sibling. | So nothing collides twice and no drawn geometry or collision triangle is lost. | README G-1; `packages/godot/src/scene-roles.ts` header; #253. |
| Unnamed source materials (Shinjuku's walk proxies, street level, luminaire strip) appear as positional `material_<n>` names and are listed as unmapped. The loader never applies the look table to them. | They cannot be keyed reliably on a name. | README G-4b; #370. |

### 2.2 Lighting and look

| Simplification | Why | Source |
| --- | --- | --- |
| Two profiles: `baseline` is the default (no `WorldEnvironment`, no material changes); `hq` is opt-in. | `hq` awaits the lead's visual approval. | README "HQ look profile (G-4b)". |
| Blender area lights are approximated by spots in the showcase comparison: a disk becomes one 75° spot, a linear LED becomes a row of spots 1.5 m apart, each row splits the hint's power, every spot points down, and Blender's fixed warm colour is used while `colour_temp_k` is ignored. | Godot spots cannot reproduce area lights. | `packages/godot/tools/showcase_compare.gd` `APPROXIMATION`, `hint_light_specs`; README "Showcase side-by-side". |
| Watt→energy is the fit `0.02` (1 m of LED gets energy 1.1), explicitly "not a physical match". | Godot's non-physical energy has no Blender-watt equivalence. | `tools/showcase_compare.gd` `APPROXIMATION.watts_to_energy` and its header comment. |
| Sun energy is `3.0 × 1/π`. | Godot multiplies non-physical sun energy by π and divides diffuse by π. | `APPROXIMATION.sun_blender_energy`, `sun_energy_factor`. |
| A uniform sky shader (one colour, no gradient or sun disk) and, in interior layouts, one `UPDATE_ONCE` room probe that is deliberately **not** `interior`, its box being the visible bounds grown by the 1 m blend distance. | Metals need something to reflect; an interior probe drops the sky and would reflect black. | `APPROXIMATION.sky_shader`, probe entries and header comment; README "Showcase side-by-side". |
| AgX contrast `1.5` instead of the 1.25 default. | It was meant to approach Blender's Medium High Contrast — a look the references do not actually use; see [Known gaps](#3-known-gaps). | `APPROXIMATION.agx_contrast`; `packages/godot/README.md` showcase section. |
| No GI by default: the comparison tool starts at `gi=none`; the HQ client keeps SDFGI off and `--gi=sdfgi` turns it on for a review slot only. | GI is a GPU cost and the right setting is unsettled (#401). | `tools/showcase_compare.gd` `TUNE_*`; README G-4b. |
| `project.godot` stays `gl_compatibility`; Forward+ comes from the command line. Godot therefore ignores SSAO and SDFGI in the project's own runs (SDFGI prints a warning). | The project setting stays `gl_compatibility`; Forward+ is chosen on the command line. | README G-4b and "Capture and performance". |
| Station ambient: a station whose bake is applied gets **no ambient**; unbaked Shinjuku gets the style-bible studio grey at a 0.25 fill. | The bake is Ikebukuro's light; the web's Shinjuku hemisphere + `RoomEnvironment` 0.55 is a scene light Godot does not mirror. | README G-4b. |
| The lightmap becomes an EMISSION term `(byte/255)^2.2 × scale × gain` times `albedo × (1 − metalness)`, with the albedo uniform declared `source_color`; `LIGHTMAP_GAIN` is 0.09. Not mirrored: three's dielectric multi-scattering energy compensation and the envMap specular. | Neither glTF nor the Godot importer carries three's lightmap state, so it is re-derived explicitly. | README G-4a; `packages/godot/addons/gteki/gteki_lightmap.gd`. |
| The material table sets only albedo (sRGB), roughness and metal; it never touches emission, transparency or textures. Ikebukuro is listed as entirely unmapped because its lightmap shader owns its surfaces. | The table must not overwrite lighting or alpha decisions it does not own. | README G-4b. |
| Two mappings are provisional, not E27 facts: `mat.wall` (OD-30 grey, R10 #234) and `mat.nosing` (a style-bible safety yellow; R10 found no source). `mat.accent` is GTEki's own Oedo magenta per OD-29, marked `local`. | The evidence does not support more. | README G-4b; #222, #234. |

The one recorded SDFGI performance run (`docs/evidence/g5-performance.md`, "shinjuku — look hq, GI sdfgi")
rendered with `forward_plus`, not the project's `gl_compatibility`; the runbook records that `gl_compatibility`
ignores SDFGI (README "GPU slot runbook", step 5).

### 2.3 Walk and camera

| Simplification | Why | Source |
| --- | --- | --- |
| The walker is a port of the web's rules (radius 0.3, 0.2..1.7 m wall band, step-up 0.45 / step-down 0.9, 1.45 / 3.4 m/s, body test), not Godot's slide physics. | "Walkable" must mean the same on both clients. | README "Third-person walk and follow camera (G-2)". |
| Ground trimeshes are always double-sided, while the web honours each material's `side`. | This is deliberately more permissive than the web. | README G-2. |
| Sidecar `walls` are applied analytically, so Shinjuku's 92 inverted-band segments block by the band rule and get no physics box. | Boxes would block differently from the web walker. | README G-1 traps and G-2. |
| Not ported: `avatarMotion` (the avatar only turns toward travel), sign see-through fading (`cameraCut`), first-person, touch joystick, `stepGuide`. | Outside the three milestones' scope. | README G-2 limits. |
| "Guided walk" is the client's own follower: 3.4 m/s along the polyline, no collisions, and any movement key returns to free walking. | It is not the web's `stepGuide`; it is a presentation aid. | README "Search, route and guided walk (G-3)". |
| The avatar is a neutral capsule with a nose box — no asset, no mascot. | The mascot is a different lane. | README G-2. |
| Spawn `z` is the graph node's elevation; tests confirm ground within 1 m, not that standing there is legal. | The station data does not state spawn legality. | README G-1 traps. |
| Camera and walker feel on a real display is unchecked. | No feel test exists; only headless replays and captures. | README G-2 limits. |

### 2.4 Search and route

| Simplification | Why | Source |
| --- | --- | --- |
| Godot ranks and routes nothing: `gteki_bridge.gd` runs `search-query.ts` and `route.ts` through `OS.execute` (blocking, 1–3 s per call, needs `pnpm install`); a failure shows its error and draws nothing. | The TypeScript router is the only routing truth. | README G-3. |
| `normalizeJa` is not ported, so query matches are not highlighted. | Presentation-only; the search itself is the TypeScript one. | README G-3. |
| Display names, floor labels and categories come from the exported `gteki.search/0.1` index. | Godot must not invent display data. | README G-3. |
| The route ribbon sits 6 cm above the floor; `zKnown: false` segments are a second orange dashed surface and the HUD says the heights are symbolic (all Shinjuku data is). | Symbolic heights must stay visibly symbolic. | README G-3. |
| Hours are printed as `UNKNOWN` and route facts (`evidenceCheckedDate`, `stale`, `unknowns`, ...) exactly as the JSON gives them. | No freshness inference in Godot. | README G-3. |
| The start is always the user's choice (a result, or the spawn nearest the avatar); the client never claims to know where you are. | Position truth is not available. | README G-3. |
| Lift rides exist only where the route itself states an `elevator` step; a vertical jump no step calls a lift is neither walkable nor rideable. | Geometry is not evidence of a ride. | README G-3 and G-5a; #290 (G-5a follow-up). |

### 2.5 Evidence and performance

| Simplification | Why | Source |
| --- | --- | --- |
| Evidence walks are headless physics with no rendering, so they say nothing about how the station looks. | They test routes and collision, not the look. | `packages/godot/docs/evidence/g5-ikebukuro.md`, `g5-shinjuku.md` headers. |
| Length is compared in the router's own basis — plan for symbolic heights, 3D otherwise — with tolerance `max(0.5 m, 0.05 m × polyline vertices)`. | The router itself measures those two ways. | README "Evidence walks (G-5a)"; `packages/navigation/src/router.ts`. |
| Floor-band crossings are an independent observation of the walker's damped height and may exceed the route's floor changes when a stair spans floors. | `floorChanges` counts graph transitions, not rendered bands. | README G-5a. |
| Perf uses the wall-clock frame interval, so vsync, presenter and compositor are included: it shows the client kept up at about the display interval, not the available headroom. `Performance.TIME_PROCESS` is recorded once per pose and never percentiled. | That is what the engine and OS actually do; process time is not a per-frame figure. | `docs/evidence/g5-performance.md` intro; README "Capture and performance". |
| Capture is windowed only and hard-bounded at 10 minutes; a pose that cannot be taken is listed in `pose_problems` instead of being filled in. | Captures need a display and the slot is bounded. | README capture section. |
| All figures come from one machine: Apple M2 Pro, macOS 27.0.0, `forward_plus` via Metal, 1600×900. | That is the only machine in the GPU slot so far. | `docs/evidence/g5-performance.md` slot record. |

## 3. Known gaps

| Gap | Evidence | Tracking |
| --- | --- | --- |
| The interior is too dark: concourse luminance ratio Godot/Blender 0.66 whole and 0.53 at the floor (top 0.73, middle 0.67); the studio shot is close at 1.11. | Measured by the `showcase_compare` luminance block; table in #401. `docs/assets/style.md` §7 records the references as EEVEE with ray tracing and 64-sample GI, so they have bounce light; #401 records that Godot has no GI by default and that the interior ReflectionProbe's ambient is disabled. | [#401](https://github.com/nurockplayer/gteki/issues/401); causes named there: no GI, the probe's ambient disabled, AgX contrast, uncalibrated light energy. |
| Residual specular/geometric aliasing on stair treads and the distant floor. | #401 finding 2; #164 comment 2026-10-24 (round 2: anisotropic mip filtering reduced it, some remains). The amount is **unmeasured** — no metric exists. | #401; candidates TAA, FSR2 or MSAA (#401), not implemented. |
| The `agx_contrast = 1.5` premise is contradicted by the style bible: `packages/godot/README.md` and `tools/showcase_compare.gd` describe it as approximating Medium High Contrast, but `docs/assets/style.md` §7 records that Blender 5.2.2 has no such look and the references are **plain AgX**. | `docs/assets/style.md` §7; `tools/showcase_compare.gd` `APPROXIMATION` comment; README showcase section. | #401 (sweep). |
| Light energy is uncalibrated: the watt→energy fit and the sun mapping have not been measured against Blender. | #164 comment 2026-10-24 ("the watt-to-energy fit is uncalibrated"); `APPROXIMATION` is labelled an approximation. | #401 (sweep). |
| Shinjuku has no baked lightmap, so it has no scene light source of its own in `hq`; its ambient is a fixed studio grey at a 0.25 fill. | README G-4a ("Shinjuku has no lightmap block, so the flag changes nothing there") and G-4b. | None found; visual acceptance is part of #164. |
| The `hq` look profile is not approved and stays opt-in; `baseline` remains the default. | README G-4b ("stays opt-in until the lead approves it visually"). | #164. |
| Ikebukuro is entirely unmapped in the look table because its lightmap shader owns its surfaces; the decision belongs to the lead. | README G-4b. | None found. |
| The capture pose `inverted_wall1` has no walkable ground at its pick point (-48.54282, 1.1, -144.3577), so it is listed as failed. | `docs/evidence/g5-performance.md` "Failed poses" in three runs. | None found. |
| W2 (Ikebukuro) and S4 (Shinjuku) have no `stairs` step, so no mid-stair pose exists for them; S4's lift landing is captured instead. | `docs/evidence/g5-performance.md` "Poses not taken". | None found. |
| Shinjuku S1's "all-yellow treads" come from the viewing angle (looking down the 0.075 m nosings), not from the material mapping; narrowing the nosing to about 3 cm is a follow-up after #156. | #164 comment 2026-10-23 (visual check with sjk-visual-13, after #306). | Follow-up after #156; no separate issue found. |
| README traps: Shinjuku's 92 inverted wall bands have no boxes (the walker applies the band rule), Ikebukuro has no `walls` at all (656 collider tiles), Shinjuku has no collider/camera-blocker/sign roles (walls only), and a spawn point is not proven legal to stand on. | README G-1 "Known gaps and traps". | None found. |
| GLB features beyond the tested subset are untested: Draco/meshopt/compressed-texture extensions, complex materials, animation, and performance. | README intro. | None found. |
| Frame time has only been measured on one machine, and headroom is unmeasured: the interval includes vsync, so the run shows the client kept up at that rate, not how much headroom it has. | #164 comment 2026-10-23; `docs/evidence/g5-performance.md` (one machine). | None found. |

## 4. In flight

| Item | Status | What is left |
| --- | --- | --- |
| [#393](https://github.com/nurockplayer/gteki/pull/393) kit AO atlases in the HQ snapshot | open PR; reviewed | Waits for [#352](https://github.com/nurockplayer/gteki/pull/352) (draft, kit catalog batches A+B). CPU end-to-end passes with #394 (open draft, batch C); the AO has not been seen in a GPU render (#164 comment 2026-10-24). |
| [#401](https://github.com/nurockplayer/gteki/issues/401) interior brightness/contrast and aliasing | open issue; tooling merged (#403, #405, #406, #412) | A GPU sweep is queued for the Monday 2026-10-26 morning slot (weekdays 03:00–15:00 JST). Target: Godot/Blender ratio 0.9–1.1 per region on both shots; record every choice in `APPROXIMATION`. Aliasing: compare TAA and FSR2 in the same slot. |
| [#352](https://github.com/nurockplayer/gteki/pull/352) Ikebukuro kit catalog, batches A+B | open draft | GPU checks: escalator orientation, seating on the PLATEAU geometry, draw-call and frame-time cost. The PR planned these for the Saturday 2026-10-24 slot; no result is recorded. |

## 5. How to run and hand-off checklist

Host rules: GPU work runs on weekdays **03:00–15:00 JST only**, in the lead's slot (#164 comment 2026-10-24);
local tests are a single process under `lockf -k /tmp/gteki-local-test.lock ...` (the README's test commands);
Forward+ comes from `--rendering-method forward_plus` on the command line while `project.godot` stays
`gl_compatibility` (README). Two further rules are the Owner's host policy, **not recorded in this repo**: gate a
local run on `memory_pressure` showing ~20% free, and never `pkill`/`killall` by name.

| Task | Command | Reference |
| --- | --- | --- |
| Snapshots + headless gate for both stations | `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-scenes.sh` | README [G-1](../README.md#station-scene-snapshots-g-1-of-164) |
| Walker replay | `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-walk.sh` | README [G-2](../README.md#third-person-walk-and-follow-camera-g-2-of-164) |
| Search/route/HUD goldens | `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-guide.sh` | README [G-3](../README.md#search-route-and-guided-walk-g-3-of-164) |
| Evidence walks | `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-evidence.sh [shinjuku]` | README [G-5a](../README.md#evidence-walks-g-5a-of-164) |
| Capture (needs a display) | `godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- --station=<id> --capture=<dir> [--look=baseline\|hq] [--perf=<s>]` | README [capture](../README.md#capture-and-performance-g-4-prep--g-5b-of-164) |
| Five-run perf set + table (~22 min) | README "GPU slot runbook (G-5b)", steps 0–6 | README [runbook](../README.md#gpu-slot-runbook-g-5b) |
| Showcase side-by-side and sweep | `godot --rendering-method forward_plus --script res://tools/showcase_compare.gd ...`; `tools/showcase_sweep.sh` | README [G-4](../README.md#showcase-side-by-side-g-4) |
| Client self-check, headless | `godot --headless --path packages/godot res://hq/hq.tscn -- --station=<id> --check [--look=hq]` | README G-1/G-4b |

Hand-off checklist:

1. Read the README G-1 to G-5 sections in order; each one states its own limits and traps.
2. Keep `bash packages/godot/run-proof.sh` and `pnpm check` green before touching the client.
3. Re-export the snapshots before any capture — the GLBs are gitignored. Commit only the generated
   `docs/evidence/*.md` tables, never `packages/godot/.cache/**`.
4. Do not switch `project.godot` to Forward+; the renderer is a command-line choice.
5. A headless display is not a failure: `--capture` and `--perf` exit 0 with a message and write nothing.
6. A capture that exits non-zero still wrote its `report.json`; read `pose_problems` before rerunning.
7. When you add or remove a simplification, add or edit the row here with its source. When you measure a gap,
   replace "unmeasured" with the figure and the slot it came from.
8. Open PRs stay in [In flight](#4-in-flight) until merged; do not move them into the status table early.
