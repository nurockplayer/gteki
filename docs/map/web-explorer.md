---
area: web-explorer
owner: gteki-fa
updated: 2026-10-29 JST
---
# Web explorer (3D station view)

## What it does
The 3D station explorer in the web app. One `Explorer` class (a single file, `apps/web/src/explorer/explorer.ts`, about 2300 lines) owns a three.js renderer, a CSS2D label layer, and three camera modes: overview (orbit), walk (follow camera on the avatar), and guide (paced walk along a route). It loads one station at a time: the station's scene module if it has one, otherwise the L0 graph view built from the routing data. Route ribbons, POI chips, identity boards and the minimap all hang off this one object.
Most helpers in the folder are small pure modules with their own tests (camera math, label declutter, occlusion, guide pacing), so the class mostly wires them together.

## Main files and functions
- `apps/web/src/explorer/greybox.ts` — detects unmodelled edge runs, builds merged runtime passage meshes and portal openings, and splits walls at openings.
- `apps/web/src/explorer/greyboxConnectors.ts` — builds runtime vertical connectors, batches their geometry and checks the shared triangle budget.
- `apps/web/src/explorer/greyboxScene.ts` — station-only collision and elevator probes, and runtime greybox legend proximity.
- `apps/web/src/explorer/routeGroundQa.ts` — route ground and vertical connector sampling for the QA hook.
- `apps/web/src/main.ts:1-8` — entry: imports the CSS and constructs `App` on the `#app` element, prints a load failure into the page.
- `apps/web/src/explorer/explorer.ts:50-54` — types ExplorerMode, ExplorerPose, ExplorerOptions.
- `apps/web/src/explorer/explorer.ts:183-2254` — class Explorer (the whole runtime).
- `apps/web/src/explorer/explorer.ts:372-405` — constructor: WebGLRenderer, quality tier from pointer and screen size, OrbitControls, Input, avatar, ResizeObserver, animation loop.
- `apps/web/src/explorer/explorer.ts:822-946` — loadStation(): builds the graph view, fenced LoadingManager for assets, SceneContext, calls buildStationScene, then wires walkable/colliders/camera blockers, sign cut, identity boards, shadows, baked AO, composer, frameAll.
- `apps/web/src/explorer/explorer.ts:948-956` — buildStationScene(): calls the station's buildScene, falls back to the graph view on failure.
- `apps/web/src/explorer/explorer.ts:958-1001` — clearStation(): tears down the previous station's scene.
- `apps/web/src/explorer/explorer.ts:1174-1193` — setMode(): overview / walk / guide switch.
- `apps/web/src/explorer/explorer.ts:1243-1264` — walkFrom(), walkFromNode(): spawn the avatar at a point or node.
- `apps/web/src/explorer/explorer.ts:1287-1313` — showRoute(): route ribbon, chevron texture, occluded line style.
- `apps/web/src/explorer/explorer.ts:1335-1346` — clearRoute().
- `apps/web/src/explorer/explorer.ts:1349-1375` — showPois(): POI chips; each POI is placed at its connector node or its displayPosition.
- `apps/web/src/explorer/explorer.ts:1089-1093` — setMinimap(): hands the minimap element in for overlay sizing.
- `apps/web/src/explorer/explorer.ts:1016-1024` — frameAll(); `1152-1172` fitOverview() keeps the overview in the free area left by the panel, credit line and phone sheet.
- `apps/web/src/explorer/explorer.ts:1703-1718` — startGuide(): begins the paced walk along a polyline with stop points.
- `apps/web/src/explorer/explorer.ts:1725-1737` — seekGuide(); `1749-1751` setGuideTier(); `1763-1767` stopGuide().
- `apps/web/src/explorer/explorer.ts:1770-1776` — focusPoints(): frames a polyline.
- `apps/web/src/explorer/explorer.ts:1463-1507` — updateLabels(): per-frame POI label state (shown, faded, hidden, occluded).
- `apps/web/src/explorer/explorer.ts:1510-1556` — updateIdentityLabels(): identity boards' name chips.
- `apps/web/src/explorer/explorer.ts:1564-1608` — updateDeclutter(); `1616-1694` labelOccluded().
- `apps/web/src/explorer/explorer.ts:485-520` — identity(): projects identity boards for the app's identity card.
- `apps/web/src/explorer/explorer.ts:588-592` — getPose(): the pose the minimap reads each frame.
- `apps/web/src/explorer/explorer.ts:1816-1875` — walkPath(): QA hook, drives the avatar through points.
- `apps/web/src/explorer/explorer.ts:1882-1895` — signClearance(): QA hook, nearest sign by box distance.
- `apps/web/src/explorer/explorer.ts:445-459` — sceneInfo(): QA read-out of counts, camera, lighting, shadows.
- `apps/web/src/explorer/explorer.ts:1929-1961` — step(): per-frame update (route pulse, scene update, mode step, camera, cuts, avatar, shadows).
- `apps/web/src/explorer/explorer.ts:1963-1991` — stepWalk(); `1993-2024` stepGuide().
- `apps/web/src/explorer/explorer.ts:2094-2171` — placeCamera(): follow camera placement, boom and slope.
- `apps/web/src/explorer/explorer.ts:2229-2254` — dispose().
- `apps/web/src/explorer/stationCaches.ts:17-41` — StationCaches: keeps a station's caches when the same station reopens, releases them when leaving.
- `apps/web/src/explorer/streetBackdrop.ts:173-310` — StreetBackdrop: outdoor street context for ground-floor stations.
- `apps/web/src/explorer/guideStops.ts:5-26` — guideStops() and advanceGuide(): stop and progress logic for the guide.
- `apps/web/src/explorer/followCamera.ts:163-171` — followPose(); the camera maths lives in this file.
- `apps/web/src/explorer/raycast.ts:60-69` — explorerTargets(): which meshes are ground, collider, sky, camera and blockers.
- `apps/web/src/explorer/raycast.ts:89-103` — castCamera(), the camera occlusion ray.
- `apps/web/src/explorer/labelDeclutter.ts:56-82` — declutter(): chip placement.
- `apps/web/src/explorer/identityBoards.ts:48-52` — collectIdentityBoards(): finds identity boards in a station scene.
- `apps/web/src/explorer/walker.ts:22-53` — resolveWalls(); `72-86` samplePolyline().

## Data flow
- Runtime greybox: `Explorer.loadStation()` probes the original station ground and colliders, builds passages and piecewise vertical connectors from traversable graph edges, then adds their ground and walls to walker and camera targets. Guide polyline points carry the edge ID for elevator car tracking; walk mode calls and boards cars after a stationary wait, with visible closed landing doors blocking empty shafts and hidden doors where cars are present. Tagged scene lifts suppress generated elevators; untagged shaft overlaps are counted and marked approximate. Portal openings split scene wall segments and filter collider hits.
- Station data: `apps/web/src/registry.ts` `listStations()` (line 50) reads the Vite virtual module `virtual:gteki-stations` (built by `apps/web/stations-plugin.ts` from the `stations/` folders). `GTEKI_PRIVATE_OVERLAY` can replace contract JSON for matching public station names while scene code and assets stay public; the module exports `privateBuild`, surfaced by `PRIVATE_BUILD` and the UI badge. Each entry's `load()` returns a LoadedStation: the parsed bundle from the schema package, optional `scene` module, `sceneImportError`, and `assetUrls`. The synthetic demo entry is added at the end and has no scene.
- `apps/web/src/ui/app.ts` `openStation()` (283-353) creates the router (`createRouter`) and the search index, then calls `Explorer.loadStation`. The explorer never parses station files itself.
- Route: `app.ts` `computeRoute()` (775-801) calls `routeBetween`, then `Explorer.showRoute` and `minimap.setRoute`. In overview it also calls `focusPoints`.
- Guide: `app.ts` `startGuide()` calls `Explorer.startGuide`; progress and stops come back through the `ExplorerEvents` callbacks (`onMode`, `onGuideProgress`, `onGuideStop`, `onPoiClick`) wired in `app.ts` `start()` (131-161).
- Output to the page: label and identity state go to the DOM through CSS2DRenderer. The minimap reads `getPose()` each frame. QA tests read `window.__gteki` hooks set up by `app.ts` `exposeTestHooks()` (1439-1478), which call `walkFromNode`, `walkPath` and `signClearance`.

## Tests CI runs
- Root test job, from `.github/workflows/root-test.yml`: `pnpm install --frozen-lockfile`, then `pnpm typecheck` and `pnpm vitest run --maxWorkers=2`. Vitest picks up `apps/web/src` tests.
- Local, one area only: `pnpm vitest run apps/web/src/explorer`. Run the full CI command first.
- Locally, through the container: `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.
- e2e-smoke (`.github/workflows/e2e-smoke.yml`, triggered on every pull request): `pnpm build`, then in `tests/e2e`: `pnpm exec playwright test specs/01-smoke.spec.ts specs/03-guided-walkthrough.spec.ts --project=desktop-chromium --trace=off`.
- QA hook tests: `apps/web/src/explorer/explorerQa.test.ts` covers the QA hooks; `apps/web/src/explorer/rayBvh.heavy.test.ts` is a heavy ray test, check whether the root vitest run includes it before relying on it.

## Pitfalls
- The greybox is built in `loadStation` from the loaded graph and scene, exists only at runtime, and must never be exported or stored as geometry.
- `explorer.ts` is one class. Change one method, not the file. Most of the 2300 lines are private state fields (lines 183-370) and never need to be read in full.
- The camera uses the previous frame's pose for scene `update` (see the comment in `step`). Do not move that call.
- Station scene failure must never hide routing data: `buildStationScene` falls back to the graph view. Keep that when editing `loadStation`.
- Assets are fenced: every station request goes through `fencedUrlResolver` in `apps/web/src/explorer/assetFence.ts`. Do not add a plain URL load.
- A load can be superseded: `loadGeneration` and `cancelPendingLoad` drop a stale load. Check the generation after every await.
- Sign cut vs. collision: a mesh that is both a sign and a camera blocker stays solid (comment in `loadStation`). `cuttableSigns` enforces it.
- Overview framing is in the free area left by the panel and the phone sheet. Changing the panel changes the framing (`setPanel`, `setSheet`).
- Walk mode and guide mode use different camera code paths (`stepWalk` vs `stepGuide`). A fix in one often needs the other.
- QA hooks (`walkPath`, `signClearance`, `sceneInfo`) are read by tests. Keep their return shapes stable.

## Related PRs and issues
- #109 — overview framing: phone overview half the viewport, skip street context; `f5da91f2`, `2bb25ef2`.
- #220 — circular minimap, player-up or north-up, current-floor walk graph (PR #422).
- #292 — follow camera after seeks, boom easing, never inside walls (PR #330).
- #307 — sun-shadow fit and caster mask hardening (PR #349).
- #94 — walker-following sun shadows (PR #119) and baked kit AO per quality tier (PR #134).
- #158 — hide POI labels occluded by signs or far away.
- #276 — load each manifest GLB once per station (PR #300); #278 release a station's caches on leave.
- #342 — identity occlusion checks only the name rect (PR #404); spawn headings.
- #352 — Ikebukuro scene update call kept in place, catalog refs cleared on dispose.
- #385 — phone route sheet sets the overview's free area (`c7c24e43`).
- #400 — POI chips kept off station-name boards and declutter where the identity nudge draws them (`e311178d`, `28537923`, PR #483).
- Guide identity held in view during the guide hold (`0f1f365a`; branch name points at #399).
- #137 — persistent data-credit line (PR #187).
- See also [[web-ui]] for the shell that drives this class, [[pkg-scene-api]] for the scene contract, [[pkg-navigation]] for routes, and [[INDEX]].
