---
area: pkg-cli
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-cli: route command and fixture export

## What it does
Two command-line scripts on top of [[pkg-navigation]], [[pkg-schema]] and [[pkg-geo]]. `route.ts` loads one station folder, runs the router once and prints gteki.route/0.1 JSON to stdout: the route result, the rendered path, the renderer-frame polyline and ja/en instructions. `export-fixture.ts` writes the synthetic demo station (from navigation's fixtures) into a folder, for the Godot proof and tests. Nothing else imports this package; the Godot client calls the route script as a subprocess.

## Main files and functions
- `packages/cli/src/route.ts:20-22` — `usage()`: the one-line usage text.
- `packages/cli/src/route.ts:30-57` — `parseArgs()`: positional station dir, from, comma-separated goals, and the flags.
- `packages/cli/src/route.ts:59-91` — `loadStation()`: reads gteki/station.json, gteki/graph.json and gteki/pois.json, then parses them with `parseStationFiles`.
- `packages/cli/src/route.ts:100-114` — `renderPath()`: the path as a list of nodes.
- `packages/cli/src/route.ts:117-131` — `routeByPoi()`: resolves `--from-poi` and `--goal-poi` before routing.
- `packages/cli/src/route.ts:133-147` — `argumentShapeError()`: checks the POI argument shape against the flags (commit 9222a526).
- `packages/cli/src/route.ts:149-173` — `runRoute()`: the whole run; exit 0 found, 1 no route (JSON still printed, empty path), 2 bad input.
- `packages/cli/src/export-fixture.ts:7-37` — `exportFixture()`: writes the synthetic station under gteki/.

## Data flow
- Command line → `parseArgs` → `loadStation` (schema `parseStationFiles`) → `createRouter` / `routeBetween` → `renderPath`, `routePolyline` and `describeRoute` (navigation) → stdout JSON.
- Polyline points get `renderer` coordinates through `enuToRenderer` from [[pkg-geo]].
- Godot: `packages/godot/addons/gteki/gteki_bridge.gd` (`route`, lines 83-104) runs the script with `pnpm tsx packages/cli/src/route.ts` through `OS.execute` and parses the JSON. `packages/godot/run-proof.sh`, `packages/godot/run-walk.sh` and `packages/godot/tests/run_evidence_tests.gd` use it too. See [[pkg-godot]].
- No @gteki/cli import anywhere in the repo. Tests are `packages/cli/src/cli.test.ts` and `packages/cli/src/real-stations.test.ts` (the latter starts a child process per run).

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). Root vitest picks up the *.test.ts files in `packages/cli/src`.
- One area locally: `pnpm vitest run packages/cli/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.
- The package's own `test` script is `vitest run`. Use the root command for CI parity.

## Pitfalls
- There is no `--at` flag. The CLI never sets a departure time, so time-dependent hours are not checked by it. `--today` sets only the freshness reference, not a departure time.
- `--goal-poi` takes exactly one POI id; comma-separated goals need node ids.
- The default profile is `ticketed` with step-free off, same as `DEFAULT_PROFILE`.
- The Godot bridge depends on this JSON shape (`contract`, `result`, `path`, `polyline`, `instructions`). Renaming a key breaks the client silently.
- Exit 1 still prints a full JSON document. Do not treat a non-zero exit as "no output".

## Related PRs and issues
- #364 share `routeBetween`'s fare rule with the route CLI; check the POI argument shape (#199).
- #517 CLI coverage of Shinjuku search-only line POIs (#411).
- #169 G-3 search and route data bridge for real stations (Godot calls this script).
