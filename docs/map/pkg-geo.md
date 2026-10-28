---
area: pkg-geo
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-geo: geodetic and station-local coordinate helpers

## What it does
Converts between WGS84 latitude, longitude and height, and each station's local east-north-up (ENU) frame in metres, then into the renderer frame used by three.js and Godot. The renderer frame is `(x, z, -y)` of ENU: the station's north becomes minus z. Small and pure, with no station data of its own.

## Main files and functions
- `packages/geo/src/index.ts:33-39` — `geodeticToEcef()`.
- `packages/geo/src/index.ts:41` — `ecefToGeodetic()` (inverse of the above).
- `packages/geo/src/index.ts:55-88` — `EnuFrame` class: `toEnu()` (line 70) and `toGeodetic()` (line 82) around one origin.
- `packages/geo/src/index.ts:91-93` — `enuToThree()`: returns `[x, z, -y]`.
- `packages/geo/src/index.ts:111-135` — `StationFrame`: the station-level wrapper. `toLocal()` gives ENU with `z` as height above the origin height; `toGeodetic()` inverts it.
- `packages/geo/src/index.ts:138-139` — `enuToRenderer` and `rendererToEnu` (aliases of `enuToThree` and `threeToEnu`).
- `packages/geo/src/index.ts:142-147` — `ENU_TO_RENDERER_MATRIX`: the same mapping as a column-major matrix.

## Data flow
- Station import tools (`stations/shinjuku/tools/import-e27.ts`, `analyze-e27.ts`, `import-surface.ts`) build an `EnuFrame` from a station origin to convert survey coordinates into station-local metres.
- Routes: `packages/cli/src/route.ts` converts route polylines with `enuToRenderer` for the Godot JSON (see [[pkg-cli]]).
- Web: `apps/web/src/explorer/explorer.ts` maps ENU to the three.js scene.
- Godot: `packages/godot/src/export-reference.ts` (the test oracle for renderer coordinates) and `packages/godot/src/export-search.ts` import this package by relative path.
- Ikebukuro: `stations/ikebukuro/pipeline/walker_replay.ts` and several test files in `stations/ikebukuro/scene` import `enuToRenderer` and `StationFrame`.
- Declared as a dependency (no import found) by `packages/scene-api/package.json` and `packages/godot/package.json`.

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). The package's test is `packages/geo/src/geo.test.ts`.
- One area locally: `pnpm vitest run packages/geo/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.

## Pitfalls
- `z` is height above the origin's height, not an ellipsoid height. `StationFrame.toGeodetic` solves for the tangent-plane offset that keeps the origin height, in at most six iterations.
- Mapping ENU to renderer flips north to minus z. Do not write a second mapping; use `enuToRenderer` or `ENU_TO_RENDERER_MATRIX`.
- Some import scripts use an origin with `h: 0` (`import-e27.ts`). Their heights are then relative to zero, not to ground.
- Godot's tests compare against this mapping through the TypeScript reference; if they disagree, check `export-reference.ts` first.

## Related PRs and issues
- No PR is titled for geo. The package came with the shared core (commit 76f880a8, "adopt Shinjuku-lane gteki.station/0.1 draft as shared-core baseline") and the later contract additions (commit abe21f55).
