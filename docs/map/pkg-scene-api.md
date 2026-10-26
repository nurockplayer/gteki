---
area: pkg-scene-api
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-scene-api: station scene contract for the explorer and the Godot export

## What it does
The contract between a station's scene module (the station's gteki/scene.ts, exporting `buildScene(ctx)`) and its hosts: the web explorer, the walk and replay tools, and the Godot scene export. It defines the walker body (`WALKER_BODY`, shared with the explorer's collision), walker speeds, and the `StationScene` shape: `root`, `walkable` surfaces, `colliders`, `cameraBlockers`, walls, spawn points, environment, and optional `update`, `settled` and `dispose`. Changing `WALKER_BODY` is a contract change.

## Main files and functions
- `packages/scene-api/src/index.ts:16` — `SCENE_API_VERSION` (gteki.scene/0.1).
- `packages/scene-api/src/index.ts:24-39` — `WALKER_BODY`: radius, body bottom and top, eye height, step up and down.
- `packages/scene-api/src/index.ts:31` — `WALKER_SPEED` (walk and run, metres per second).
- `packages/scene-api/src/index.ts:60-100` — `StationScene`.
- `packages/scene-api/src/index.ts:102-129` — `SceneContext`: what the host passes to `buildScene`.
- `packages/scene-api/src/index.ts:133-141` — `StationSceneModule`: `buildScene` and optional `releaseCaches`.
- `packages/scene-api/src/index.ts:167-184` — `glbPrimitivePlugin()`: GLTF loader plugin for role-tagged primitives.
- `packages/scene-api/src/index.ts:190-204` — `roleOf()`: role from an object's authored name or extras only.
- `packages/scene-api/src/index.ts:232-261` — `sceneFromGlbRoles()`: splits a GLB root into walkable, colliders and camera blockers.
- `packages/scene-api/src/index.ts:267-276` — `seeThroughMeshes()`: meshes such as signs that stay visible but do not block.

## Data flow
- Station the station's gteki/scene.ts `buildScene(ctx)` → `apps/web/src/explorer/explorer.ts:951` (`station.scene.buildScene(ctx)`) → `walkable`, `colliders` and `cameraBlockers` feed the explorer's collision (`apps/web/src/explorer/walker.ts` and `apps/web/src/explorer/explorer.ts` use `WALKER_BODY`).
- `apps/web/src/registry.ts` checks that a loaded module exports `buildScene` and keeps the scene optional: a scene import failure must not block routing.
- GLB assets: `apps/web/src/explorer/manifestScene.ts` calls `sceneFromGlbRoles`.
- Godot: `packages/godot/src/export-scene.ts` runs the real `buildScene` under Node and writes `scene.glb` with `gteki_role` extras; `packages/godot/src/scene-roles.ts` tags roles.
- Imported by (non-test first): `apps/web/src/registry.ts`, `apps/web/src/explorer/explorer.ts`, `apps/web/src/explorer/walker.ts`, `apps/web/src/explorer/identityBoards.ts`, `apps/web/src/explorer/stationCaches.ts`, `apps/web/src/explorer/manifestScene.ts`, `packages/godot/src/export-scene.ts`, `packages/godot/src/scene-roles.ts`, `stations/ikebukuro/scene` and `stations/ikebukuro/pipeline/walker_replay.ts`, `stations/ikebukuro/pipeline/identity_camera.ts`, `stations/shinjuku/gteki/scene.ts` and `stations/shinjuku/test`. Relative imports and `WALKER_BODY` users are in the same folders.

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). The package's own test is `packages/scene-api/src/roles.test.ts`.
- One area locally: `pnpm vitest run packages/scene-api/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.

## Pitfalls
- Roles come only from a glTF node's authored name and extras (commits e62e61f6 and e6636efd), on web and Godot alike. A mesh name guessed from its geometry is not a role.
- `cameraBlockers` stop only the follow camera. They never block walking and never count as ground.
- `settled()` resolves once background content is in place and never rejects. Snapshot exports await it.
- `releaseCaches` runs when the explorer leaves a station. Do not rely on it between reopens of the same station.
- `three` is a peer dependency (>= 0.170); the package's devDependency is 0.186.
- `WALKER_BODY` values are shared with replay and audit tools. Changing one changes every walk test's expectations.

## Related PRs and issues
- #352 `settled()` for deferred display assets; Ikebukuro catalog implements it.
- #278 release a station's caches when the explorer leaves it; #273 Shinjuku implements the hook.
- #182 export `WALKER_SPEED` next to `WALKER_BODY`.
- 9b2e20d3 identity boards and framing helpers (commit, no PR number).
