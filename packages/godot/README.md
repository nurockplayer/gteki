# Godot 4.7 compatibility proof

This small headless project consumes the same `gteki.station/0.1` files as the
TypeScript packages and constructs a `Path3D`/`Curve3D` from a `gteki.route/0.1`
route computed by the existing TypeScript router. Godot contains no routing
implementation. All fixture data is synthetic and cannot be used for real station
directions.

From the workspace root, with its pinned pnpm dependencies installed:

```sh
pnpm check
bash packages/godot/run-proof.sh
```

The script also works from another working directory. It defaults to
`/opt/homebrew/bin/godot` (tested with **4.7.2**); set `GODOT_BIN` to use another
executable. It creates temporary station JSON, router output, and a coordinate
reference, runs Godot, and removes those temporary files. Godot exports its tiny
generated GLB to `user://generated-proof-<process-id>.glb`, then removes it. On macOS,
`user://` is under `~/Library/Application Support/gteki-godot-proof/`; Godot needs
write access there. No third-party asset or binary fixture is committed.

The proof checks:

- Station node, floor, and POI counts survive JSON loading.
- Every node maps ENU to Godot as `(x, z, -y)`, using the actual TypeScript
  `enuToRenderer` as the reference. The TypeScript route only visits three of
  the fixture's eight nodes, so a separate **test-only** coordinate reference
  covers disconnected nodes. Route points are also checked directly against
  the renderer coordinates in the route JSON.
- Display heights use `position.z ?? renderZ ?? floor.renderElevationM`, keep
  unknown ENU heights null, and flag those heights as symbolic. Separate samples
  exercise nonzero north/up coordinates, both fallback levels, and known zero.
- The route becomes a `Path3D` with a `Curve3D`; its point count and 20 m length
  agree with the TypeScript result within `1e-3` for the known-height fixture.
- Godot builds meshes named `floor`, `wall`, `metadata_only`, and `barriers`,
  exports a GLB with `extras.gteki_role`, and loads it twice through the manifest
  asset loader. This checks name and extras roles, column-major basis/translation,
  default identity transforms, root parenting, and wall/barrier triangle colliders.
  It reports asset, walkable, and collider counts. `floor` and `stairs_ramps` are
  tagged walkable; `wall` and `barriers` are tagged colliders. These tags never
  establish pedestrian connectivity.

For an additional uncompressed GLB smoke test:

```sh
bash packages/godot/run-proof.sh /absolute/path/to/model.glb
```

The station loader also loads every GLB in `station.json.assets`, relative to its
`gteki/` directory, using `GLTFDocument`/`GLTFState` at runtime. Asset transforms
already map to renderer space; no additional ENU conversion is applied to them.

The individual commands are:

```sh
pnpm tsx packages/cli/src/export-fixture.ts /tmp/gteki-proof
pnpm tsx packages/cli/src/route.ts /tmp/gteki-proof start goal > /tmp/gteki-proof/route.json
pnpm tsx packages/godot/src/export-reference.ts /tmp/gteki-proof /tmp/gteki-proof/reference.json
/opt/homebrew/bin/godot --headless --path packages/godot --script res://tests/run_tests.gd \
  -- /tmp/gteki-proof /tmp/gteki-proof/route.json /tmp/gteki-proof/reference.json
```

The route CLI takes a comma-separated set of goal IDs and supports
`--step-free`, `--unpaid-only`, `--strict-hours`, and `--today YYYY-MM-DD`.
The date sets the router's freshness reference, not a departure time. Malformed
station inputs print parser issues to stderr and exit 2 without route JSON.
Unsuccessful routing still prints the result with an empty path and exits 1.
Godot prints a PASS/FAIL summary and exits 0/1.

The route JSON also carries `polyline` (edge-geometry points from `routePolyline`, each with
ENU, `renderer` coordinates and `zKnown`) and `instructions.{ja,en}` from `describeRoute`, so a
Godot client can draw the same route and read the same turn-by-turn text as the web explorer
without reimplementing presentation. The route adapter constructs path data from `path`; it does
not yet consume `polyline` or create visible route geometry.
This demonstrates contract, coordinates, route transport, and basic runtime GLB
compatibility. It does **not** claim a high-fidelity Godot client, real station
coverage, navigation mesh generation, or real-world routing verification. The
Godot loader performs adapter checks; the shared TypeScript parser remains the
full contract validator. Route points currently represent graph nodes rather
than detailed edge polylines. Arbitrary source edge lengths can differ from
straight node-to-node curve lengths even with known heights; metric equality is
asserted for this fixture only, and symbolic-height routes skip that assertion.
GLB compression extensions (including Draco, meshopt, and compressed texture
extensions), complex materials, animation, and performance are untested.

## Station scene snapshots (G-1 of #164)

Walkable HQ client work starts by loading both stations in Godot without Godot owning any station truth.
`packages/godot/src/export-scene.ts <stationId> <outDir>` runs the station's **real** `buildScene` under Node
(the station's own `gteki/scene.ts`, `quality: "high"`, real `three`) and writes, to a gitignored directory:

- `scene.glb`: the scene `root` as one binary glTF. Every mesh carries an explicit `extras.gteki_role`, taken from
  the lists `buildScene` returns (`walkable` / `colliders` / `cameraBlockers`, the only collision truth the web walker
  uses), else its own role, else `visual`. Listed meshes that are never drawn (Shinjuku's walk proxies, Ikebukuro's
  raycast tiles) also carry `gteki_collision_only`. Every mesh the source scene does not draw (invisible itself, under an invisible ancestor, or with only invisible
  materials) is flagged `gteki_hidden`, listed or not, and the loader never draws it: Ikebukuro's access-fence collider,
  solid door/window panels, portal "beyond" mesh and walk-bridge strips stay in the file as hidden originals while their
  collision comes from the exported tiles (the walk bridges are walkable tiles with `gteki_source_role` `walk_bridges`).
  Drawn meshes whose source role says walkable/collider but that the
  scene replaces with its own collision (Ikebukuro's GLB floor vs. its tiles) are exported as `visual`, original role in
  `gteki_source_role`, so nothing collides twice. Material names, base colours and both UV sets (TEXCOORD_1) are kept.
- `scene.json` (`gteki.godot-scene/0.1`): `stationId`, `sourceCommit` (+ `sourceDirty`), `walls` and `spawnPoints` in
  ENU exactly as returned, `environment`, `counts` per role, a `reference` block (TypeScript-computed renderer-frame
  values the Godot tests compare against; an oracle, not scene truth), and `warnings`.

The browser-only parts are **shims, listed in `warnings`**: a no-op 2D canvas (blank textures; `measureText` is an
em-width estimate, so sign sizes can differ), stubbed PMREM (no reflections), `loadTexture` returning blank textures
(the Ikebukuro lightmap is not decoded), no audio. All material textures are omitted, so snapshots are **untextured
and unlit**: this is geometry, roles and colours, not the #94 look (G-4 re-materials). `update()` runs once at `(0, 0)`;
`InstancedMesh` (escalator steps, platform-door leaves) is baked into static merged meshes at that pose (Godot 4.7 cannot
import `EXT_mesh_gpu_instancing`), and the Ikebukuro crowd (`ambient_crowd`) is dropped. The only added dependency is
`three` (same version as the stations, so the station modules share the exporter's instance); no canvas library.

```sh
bash packages/godot/run-scenes.sh                 # export both stations, then the headless Godot snapshot tests
bash packages/godot/run-scenes.sh shinjuku        # one station
godot --path packages/godot res://hq/hq.tscn -- --station=ikebukuro   # HQ skeleton (windowed; Tab cycles stations)
godot --headless --path packages/godot res://hq/hq.tscn -- --station=shinjuku --check
```

Godot side: `addons/gteki/gteki_scene.gd` loads a snapshot with `gteki_assets.gd` (so role normalisation is the same
code), adds trimesh bodies for walkable meshes on `GROUND_LAYER` (value 4, backface collision on) next to the
asset loader's collider bodies (layer 1) and camera blockers (layer 2, hidden), hides collision-only proxies, builds
one thin box per wall segment between `zMin` and `zMax` (ENU `(x, y, z)` to Godot `(x, z, -y)`), and exposes spawn
points and the environment. `hq/hq.gd` is a skeleton that picks a station and places a camera at its first spawn;
there is no walking, HUD or HQ renderer yet (`project.godot` still uses `gl_compatibility`).

`tests/run_scene_tests.gd` checks, for each station: role counts equal the sidecar's, at least one walkable mesh and one
collider (mesh or wall), wall and spawn coordinates against TypeScript `enuToRenderer`, the world AABB of walkable and
collider meshes against three.js, and, by physics raycast, walkable ground within 1 m below every spawn point.

Known gaps and traps for later milestones:

- Wall `zMin`/`zMax` are walker-feet bands (see `WALKER_BODY`): Shinjuku has 92 segments with `zMax < zMin` that still
  block the web walker. They get **no** box shape in Godot; the G-2 walker applies the band rule to `sidecar.walls`
  itself (below).
- Ikebukuro returns no `walls`; its collision is the 656 collider tiles (including ceilings, as on the web).
- Shinjuku has no `collider`/`camera_blocker`/sign roles of its own (walls only); signs there are unlabelled `visual`.
- Spawn `z` is the graph node's elevation; the tests confirm ground within 1 m, not that the point is legal to stand on.
- Per-mesh geometry only: no textures, lightmap, lights, crowd, animation or audio (see the sidecar `warnings`).

## Third-person walk and follow camera (G-2 of #164)

`addons/gteki/gteki_walker.gd` is a `CharacterBody3D` that moves by the **web explorer's rules, not Godot's slide
physics** (a Godot capsule would resolve walls and steps differently, and "walkable" must mean the same on both
clients). It is a port of `apps/web/src/explorer/walker.ts`, `bodyCollision.ts` and `explorer.ts` `stepWalk`; the file
header lists every mirrored function with its source lines. The physics server only answers ray tests:

- body radius 0.3, wall band 0.2..1.7 m above the feet, step-up <= 0.45 m, step-down <= 0.9 m (else the move is
  refused), walk 1.45 m/s, run 3.4 m/s, camera-relative movement;
- ground = ray from 0.5 m above the feet, 1.45 m down, against walkable (layer 4); colliders = the web's body test
  (rays at 0.5 and 1.2 m, 12 radial rays, side sweeps, slide along the blocking surface) against layer 1;
- sidecar `walls` are applied analytically as in `resolveWalls`: a wall is skipped when `zMax < feet + 0.2` or
  `zMin > feet + 1.7`. So the 92 Shinjuku segments with `zMax < zMin` are **not** empty: they block while the feet are
  within `[zMin - 1.7, zMax - 0.2]`, exactly as on the web (tests cover this). The wall boxes from G-1 moved to physics
  layer 8 (`WALL_LAYER`) and are not used by the walker or camera;
- collider trimeshes are double-sided exactly where the exported material is (the web ray-tests each material's
  `side`); ground trimeshes are always double-sided (the web honours the side; this is more permissive).

`gteki_follow_camera.gd` ports `followCamera.ts` and the camera part of `placeCamera`: over-the-shoulder pivot (0.42 m),
distance 3.4 m (wheel 1.8..9), pitch -1.1..0.5, FOV 60 (a plain `fov` property; the Owner may narrow it later), camera
rays against colliders + camera blockers + walkable (layers 1|2|4), boom lowering under camera-only blockers,
`keepBelowBlockers`, 10/s smoothing. The avatar is a neutral capsule with a nose box (no asset, no mascot).

`hq/hq.tscn`: WASD/arrows move, Shift runs, left/right-drag or right stick orbits, wheel zooms, Tab switches station,
N cycles spawn points (heading `yaw = -heading`). Spawn is on the sidecar spawn points.

```sh
lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-walk.sh       # export, then the headless walk replay
```

`tests/run_walk_tests.gd` (fixed 60 Hz steps, no rendering) checks: the step-up/step-down limits and the wall band rule
(including an inverted band) on synthetic slabs; per spawn, four headings of running stay on walkable ground; walking into
real Shinjuku wall segments never enters the 0.3 m radius and stops at it; walking into the nearest collider from each
Ikebukuro spawn never crosses a surface (an independent ray at 0.8 m); camera poses (spawn x 4 yaws x 3 pitches) never
cross a wall, floor or ceiling beyond the web's own minimum-distance floor; and the replay of the TypeScript route
Ikebukuro `g_jr_c2` to `x35` (`packages/cli/src/route.ts`, merged from the G-3 data bridge branch) reaches the goal
without being blocked.

It also replays **every verified edge** of `stations/ikebukuro/gteki/graph.json` with the selection and sampling of
`stations/ikebukuro/pipeline/godot_colliders.gd` (`check:godot`: verified edges with a polyline, sampled every 0.25 m
keeping each vertex, so edge and sample counts compare 1:1 with that script's `EDGES verified=… samples=…` line; 67 / 7,150 since #245). Per sample the snapshot must
have walkable ground; between samples, horizontal rays at 0.2/0.6/1.0/1.4/1.7 m (that script's rule) and the walker's
own body test must find no collider. A negative control makes the asset's `doors`/`windows`/`portals` meshes collide
again (what `--control` does there) and the same replay must then report blocked edges; the test prints whether
`w_n__x18` is among them. The collision world differs from `check:godot`'s: it is the TypeScript scene's own tiles
(including the access fences and solid doors the web walker collides with), not the raw GLB roles.

Limits: not the web's `avatarMotion` (the avatar just turns toward travel), no sign see-through fading (`cameraCut`),
no first-person mode, no touch joystick, no guided-walk mode (`stepGuide`), no street/sky probes. Stairs and escalators are
walked by the same step rules as on the web, nothing more. Camera and walker feel on a real display is unchecked.

Runtime APIs: [GLTFDocument](https://docs.godotengine.org/en/latest/classes/class_gltfdocument.html)
and [Godot glTF scene export](https://docs.godotengine.org/en/latest/tutorials/assets_pipeline/exporting_3d_scenes.html).

## Search, route and guided walk (G-3 of #164)

`hq.tscn` now has a HUD (left panel, built for 1600x900): search box, results with name (ja/en toggle), category, floor and a
routable marker, a start picker, a route button, step list and a guided-walk toggle. Godot ranks and routes nothing:
`addons/gteki/gteki_bridge.gd` runs `pnpm --dir <root> --silent tsx packages/godot/src/search-query.ts <stationDir> <query> --limit 8`
and `packages/cli/src/route.ts <stationDir> <from> <goal> [--from-poi] [--goal-poi]` through `OS.execute` (blocking, 1-3 s per call;
needs `pnpm install`) and parses their JSON. A bridge or router failure shows its error and draws nothing. Display names, floor
labels and categories come from the exported `gteki.search/0.1` index (`export-search.ts`, written to `.cache/search/<id>.search.json`
on first use). `normalizeJa` is not ported, so matches are not highlighted.

- Non-routable hits are listed greyed out and cannot be picked as start or goal. The start is always your choice: a result
  ("Use as start") or the spawn point nearest the avatar; the client never claims to know where you are.
- The route polyline is drawn as a ribbon 6 cm above the floor in `renderer` coordinates with an animated chevron shader.
  Segments with `zKnown: false` form a second, orange dashed surface and the HUD says the heights are symbolic (all of the
  Shinjuku data is). A failed route (`ok: false`) shows `reason: message` (for example `no_path`) and never a partial line.
- The step list follows the avatar's position along the polyline (same step rule as the web guide). The route facts
  (`evidenceCheckedDate`, `oldestSourceDate`, `stale`, `unknowns`, ...) are printed as the JSON gives them, with `hours: UNKNOWN`.
- "Guided walk" moves the avatar along the polyline at 3.4 m/s (web guide tier "run"), no collisions, with the follow camera; any
  movement key returns to free walking at that spot.

Tests: `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-guide.sh` (golden searches on both stations, Ikebukuro
`jr-central-gate-2` to `exit-35` ribbon, Shinjuku `poi:platform:oedo` to `poi:exit:1` symbolic, negative route, guided walk, HUD state).
