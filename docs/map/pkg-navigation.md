---
area: pkg-navigation
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-navigation: routing graph, pathfinding and guidance

## What it does
Pure TypeScript with no I/O. It takes a `StationBundle` that already passed `parseStationFiles` (see [[pkg-schema]]) and builds a `Router` over its nodes and edges with `createRouter`. `Router.route()` is a multi-source label-setting search: plain Dijkstra when hours do not matter, and a time-dependent Pareto search with an A*-guided pass and admissible lower bounds when opening hours are given. The result is a `RouteResult` or `RouteFailure` carrying unknowns, source ids and freshness facts. `present.ts` turns a route into a polyline and ja/en instructions. `explain.ts` re-runs a failed route with each option relaxed to name the cause of a `no_path`.
Fail-closed rules: an edge is usable only if `verification` is `verified` (or `synthetic` on a synthetic station). Access flags count only when the edge has `accessEvidence`. Hours that are `null` are routable but reported as UNKNOWN unless the profile says `require_known`.

## Main files and functions
- `packages/navigation/src/index.ts:15-39` — `RouteProfile`: fare policy, stepFree, avoidModes, extraClosedEdgeIds, hours, at, timeZone, today, staleAfterDays.
- `packages/navigation/src/index.ts:62-107` — `RouteResult`: nodeIds, steps (`RouteStep`), totalLengthM, estimatedSeconds, unknowns, source and freshness facts.
- `packages/navigation/src/index.ts:117-121` — `RouteFailure`: reason (`no_path`, `search_limit`, `unknown_start`, `unknown_goal`, `start_equals_goal`) and message.
- `packages/navigation/src/index.ts:123-134` — `Router` interface: `route()` and `isTraversable()`.
- `packages/navigation/src/router.ts:187-204` — `WAIT_COST_PER_SECOND`, `WORK_BUDGET` (2,000,000 units; past it the answer is `search_limit`, never `no_path`), `GUIDE_BUDGET`, `PRUNE_SLACK`.
- `packages/navigation/src/router.ts:238-240` — `createRouter()`: the public entry point.
- `packages/navigation/src/router.ts:250-717` — `buildRouter()`: adjacency (edges whose endpoints do not measure are dropped), `allowed()`, `openThroughout()`, `lowerBounds()`, `route()`.
- `packages/navigation/src/router.ts:131-149` — `measureEdge()`: edge length from its geometry or node-to-node.
- `packages/navigation/src/router.ts:286-297` — `allowed()`: verification, closures, avoidModes, stepFree, fare, unknown hours.
- `packages/navigation/src/router.ts:314-334` — `openThroughout()`: known hours must hold for the whole traversal; the clock horizon is UNKNOWN.
- `packages/navigation/src/router.ts:373-393` — `openings()`: weekly opening windows of an edge.
- `packages/navigation/src/router.ts:405-423` — `lowerBounds()`: backward cost bound used for pruning.
- `packages/navigation/src/router.ts:577-715` — `route()`: the search itself.
- `packages/navigation/src/poi.ts:16-27` — `routeBetween()`: POI-level entry point; applies the fare rule to the POIs and is what the apps call.
- `packages/navigation/src/explain.ts:143-163` — `explainNoPathWith()`; `packages/navigation/src/explain.ts:182-190` — `explainNoPathBetween()`, which names the refusing option.
- `packages/navigation/src/present.ts:32-66` — `routePolyline()`: per-step edge geometry with `zKnown`.
- `packages/navigation/src/present.ts:672-841` — `describeRoute()`: the `Instruction[]` (kinds, waits, lifts, junction hints) in ja or en.
- `packages/navigation/src/present.ts:532-584` — `foldShortLegs()`: merges very short legs into their neighbours.
- `packages/navigation/src/present.ts:72-81` — `instructionPoints()`: polyline points one instruction covers.
- `packages/navigation/src/fixtures.ts` — `createSyntheticBundle()` and friends, used as test fixtures by other packages.

## Data flow
- Station JSON (`stations/shinjuku/gteki/graph.json` or `stations/ikebukuro/gteki/graph.json`, `pois.json`, `station.json`, optional `tenants.json`) → `parseStationFiles` in `packages/schema/src/parse.ts:317-334` → `StationBundle` → `createRouter` → `routeBetween` (`packages/navigation/src/poi.ts`) → `RouteResult`.
- `RouteResult` → `routePolyline` and `describeRoute` (`present.ts`) → `apps/web/src/ui/app.ts:775-801` (`computeRoute`, calls `routeBetween` at line 787 and `explainNoPathBetween` on `no_path`) → explorer ribbon, minimap, instruction sheet.
- Guided walk pacing: `apps/web/src/explorer/guideStops.ts`, `guideSteps.ts`, `guidePace.ts` read the polyline, instructions and steps. Pace constants live in `ROUTE_PACE` (`packages/navigation/src/router.ts:10-16`) and in `guidePace.ts`, separately.
- Godot does not route. `packages/godot/addons/gteki/gteki_bridge.gd` runs `packages/cli/src/route.ts`, which prints gteki.route/0.1 JSON (result, path, polyline, instructions). See [[pkg-cli]] and [[pkg-godot]].
- Imported by (non-test code unless noted): `apps/web/src/ui/app.ts`, `apps/web/src/ui/minimap.ts`, `apps/web/src/ui/live.ts`, `apps/web/src/ui/noRouteText.ts`, `apps/web/src/ui/spawnHeading.ts`, `apps/web/src/noPath.ts`, `apps/web/src/explorer/guideStops.ts`, `apps/web/src/explorer/guideSteps.ts`, `apps/web/src/explorer/guidePace.ts`, `apps/web/src/explorer/graphView.ts`, `apps/web/src/explorer/explorer.ts`, `packages/cli/src/route.ts`, `packages/cli/src/export-fixture.ts`, `stations/shinjuku/app/src/main.ts`, `stations/shinjuku/app/src/narrate.ts`, `stations/shinjuku/app/src/crowd.ts`, `stations/shinjuku/tools/diag-walk.ts`, `stations/shinjuku/scene/build.ts`. Tests: `stations/ikebukuro/scene/routing.test.ts` and `signage.test.ts` import it by relative path, as do many `apps/web` and `stations/shinjuku` tests that use `fixtures.ts`.

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). Navigation tests are the *.test.ts files in `packages/navigation/src`.
- One area locally: `pnpm vitest run packages/navigation/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.

## Pitfalls
- An edge is silently excluded unless its `verification` is `verified`. `geometry_only` and `unverified` never route.
- Without `accessEvidence` every access flag is UNKNOWN. `stepFree` excludes stairs and escalators, and requires `wheelchair === true`.
- `hours === null` is routable by default (`warn_unknown`) and must be shown as "hours unverified". Never assert 24h without an `always` record.
- Budget overrun is `search_limit`, not `no_path`. Traversals past `MAX_CLOCK_MINUTES` (366 days) are UNKNOWN, not proof that no route exists.
- Cost is the router's time-like cost (walk 1.2 m/s, stairs 0.5, escalator 0.75, lift 45 s, plus waits), not metres.
- `route()` ignores unknown node ids; `start_equals_goal` beats any walk.
- `packages/navigation/src/fixtures.ts` is non-test code imported by tests across apps, packages and stations. Changing a fixture ripples widely.
- Routes keep a copy of the profile (`RouteResult.profile`); presentation must use that copy, not the UI's current options.

## Related PRs and issues
- #15 Lane C shared core: introduced the router, contract and web explorer.
- #21 honest arrival at stair, escalator and ramp connectors.
- #33 fold short legs, one line per lift ride.
- #77 no "straight" over a sidestep jog; name the zone in waits.
- #88 timed search prunes exactly with an admissible bound; clock horizon is UNKNOWN.
- #111 a no_path says which option refused, with one-tap relax.
- #364 share routeBetween's fare rule with the route CLI.
- #494 endpoint name evidence kept out of the path's sources.
