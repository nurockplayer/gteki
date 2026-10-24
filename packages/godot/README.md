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
  solid door/window panels, the `portals` GLB mesh and walk-bridge strips stay in the file as hidden originals while
  their collision comes from the exported tiles (the walk bridges are walkable tiles with `gteki_source_role`
  `walk_bridges`). The `portal_beyond` mesh split out of `portals` is drawn, as on the web, and is the collider across
  the openings (`stations/ikebukuro/scene/scene.ts:312` hides the original). A multi-material mesh with only some
  materials visible keeps its drawn groups on the original and moves the invisible groups to a hidden sibling
  (`<name>_hidden_materials`), so neither the drawn geometry nor its collision triangles are lost. Drawn meshes whose
  source role says walkable/collider but that the
  scene replaces with its own collision (Ikebukuro's GLB floor vs. its tiles) are exported as `visual`, original role in
  `gteki_source_role`, so nothing collides twice. Material names, base colours and both UV sets (TEXCOORD_1) are kept.
- `scene.json` (`gteki.godot-scene/0.1`): `stationId`, `sourceCommit` (+ `sourceDirty`), `walls` and `spawnPoints` in
  ENU exactly as returned, `environment`, `counts` per role, `lightmap` (only when the scene has a baked one: the URI
  it loaded, channel, colour space, `lightMapIntensity` and the flagged mesh/surface counts — see G-4a), a `reference`
  block (TypeScript-computed renderer-frame values the Godot tests compare against; an oracle, not scene truth), and
  `warnings`. The counts describe what the GLB can carry: a mesh with no drawable geometry (an empty `BufferGeometry`,
  such as Shinjuku's viewer probe) is skipped by three's exporter, so it is left out of every count and named in a
  warning instead of inflating the sidecar past the file.

The browser-only parts are **shims, listed in `warnings`**: a no-op 2D canvas (blank textures; `measureText` is an
em-width estimate, so sign sizes can differ), stubbed PMREM (no reflections), `loadTexture` returning blank textures
(the lightmap is a blank placeholder in the snapshot itself; G-4a re-loads the real file on the Godot side), no audio.
All material textures are omitted, so snapshots are **untextured and unlit**: this is geometry, roles and colours, not
the #94 look (G-4 re-materials). The one exception is the baked lightmap, whose material state is recorded in the
sidecar and re-applied on the Godot side (G-4a, below). `update()` runs once at `(0, 0)`; `InstancedMesh` (escalator
steps, platform-door leaves) is baked into static merged meshes at that pose (Godot 4.7 cannot import
`EXT_mesh_gpu_instancing`), and the Ikebukuro crowd (`ambient_crowd`) is dropped. The only added dependency is
`three` (same version as the stations, so the station modules share the exporter's instance); no canvas library.

```sh
bash packages/godot/run-scenes.sh                 # export both stations, then the headless Godot snapshot tests
bash packages/godot/run-scenes.sh shinjuku        # one station
godot --path packages/godot res://hq/hq.tscn -- --station=ikebukuro [--lightmap=on|off]   # HQ skeleton (windowed; Tab cycles stations)
godot --headless --path packages/godot res://hq/hq.tscn -- --station=shinjuku --check
```

Godot side: `addons/gteki/gteki_scene.gd` loads a snapshot with `gteki_assets.gd` (so role normalisation is the same
code), adds trimesh bodies for walkable meshes on `GROUND_LAYER` (value 4, backface collision on) next to the
asset loader's collider bodies (layer 1) and camera blockers (layer 2, hidden), hides collision-only proxies, builds
one thin box per wall segment between `zMin` and `zMax` (ENU `(x, y, z)` to Godot `(x, z, -y)`), and exposes spawn
points and the environment. A hidden mesh hides as a whole (`visible = false`) unless it carries drawn children: then
the children stay and the mesh's own surfaces get a fully transparent, unshaded, shadow-free override material, because
`layers = 0` only keeps the node out of every camera. `hq/hq.gd` is a skeleton that picks a station and places a camera at its first spawn;
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
- Per-mesh geometry only: no textures, lights, crowd, animation or audio (see the sidecar `warnings`). The baked
  lightmap is the one lighting term carried across (G-4a); everything else is lit by the HQ skeleton light.

## Baked lightmap (G-4a of #164)

The Ikebukuro scene bakes its lighting (`stations/ikebukuro/pipeline/blender_bake_lighting.py`) into a WebP that the
web explorer samples on TEXCOORD_1. three keeps it on the material (`MeshStandardMaterial.lightMap`), which neither
glTF nor the Godot importer carries, so the exporter records what `buildScene` actually did instead of guessing from a
role or a name: every material slot whose material has a `lightMap` gets its surface index in
`userData.gteki_lightmap_surfaces` (glTF extras), and the sidecar's `lightmap` block records the texture URI, the
channel (1 = TEXCOORD_1 → Godot UV2), the colour space, `flipY` and `lightMapIntensity`. The exporter throws rather
than pick one when a scene carries two textures, two intensities, or a texture whose source URI was not recorded.

`addons/gteki/gteki_lightmap.gd` loads that WebP from the station's own `gteki/` folder (the snapshot has no
textures), and replaces the flagged surfaces with a `ShaderMaterial` that samples UV2 and mirrors three's
`lights_fragment_maps` path: the bake's stated decode `(byte/255)^2.2`, times `lightMapIntensity / PI` (three adds
`texel × lightMapIntensity` to the irradiance and the physical BRDF applies `RECIPROCAL_PI`), times
`albedo × (1 − metalness)`, added as EMISSION. The albedo uniform is declared `source_color` because the importer
stores `StandardMaterial3D.albedo_color` in sRGB (glTF `baseColorFactor` is linear and Godot encodes it); without the
hint every lightmapped surface, and the emission it scales, would be too bright. The net factor is `(byte/255)^2.2 × scale × LIGHTMAP_GAIN`; scale and
gain stay in `scene.ts`, the sidecar only carries their product. `hq.gd` takes `--lightmap=on|off` (default on).
The avatar draws on its own render layer (`gteki_walker.gd` `AVATAR_LAYER`, Godot layer 2); while the bake is applied
`gteki_hq_lights.gd` masks the client's key + fill lights to that layer, so station meshes stay unlit by any added
light (as the web, whose `lighting: "scene"` adds no scene lights and lights only its own avatar with a per-material
environment map) and the avatar stays clearly shaded rather than a black silhouette. With `--lightmap=off` or a
station without a bake (Shinjuku) the same lights reach every layer and light the unlit snapshot. Shinjuku has no
lightmap block, so the flag changes nothing there. Not mirrored:
three's dielectric multi-scattering energy compensation (a few percent) and the envMap specular (no reflections in
the snapshot); the light rig will be settled in the G-4 look pass.

`tests/run_scene_tests.gd` checks that the texture decodes at the size the bake metadata declares, that the sidecar's
mesh and surface counts equal the applied ones, that each flagged surface keeps UV2 and carries the shader material,
that `lightMapIntensity / (scale × PI)` equals the scene's `LIGHTMAP_GAIN` (0.09), that 36 sampled texel channels
decode within 1e-3 of `(byte/255)^2.2 × scale × gain`, that the shader declares `albedo_color : source_color` and its
uniform equals the source material's own `albedo_color`, and that `--lightmap=off` applies nothing.
`tests/run_walk_tests.gd` checks the light masks on the helper: the avatar meshes sit on `AVATAR_LAYER`, with the bake
applied at least one light reaches that layer and no light's cull mask includes the station's layer, and with it off
every light does. The real wiring is asserted by the client itself: `run-scenes.sh` runs
`hq.tscn --station=<id> --check` for each station, where `hq.gd` `check_lighting` compares every light's
`light_cull_mask` with `gteki_hq_lights.cull_mask(lightmap_applied)`, requires every drawing station mesh to be on
`WORLD_LAYER`, and requires a light on `AVATAR_LAYER` whenever a bake is applied. Layer 2 is reserved for the avatar.

## HQ look profile (G-4b of #164)

`addons/gteki/gteki_look.gd` has two profiles, picked with `--look=` on `hq.tscn`. **`baseline` is the default** and is
today's look: no `WorldEnvironment`, no material changes. **`hq`** is the style-bible look and stays opt-in until the lead
approves it visually.

With `hq`, the client builds one `WorldEnvironment` and re-configures it for each station load from that station's own
sidecar (`environment`), never from hard-coded values:

- Tonemap AgX (the style references' tonemap, `docs/assets/style.md` §7) with `tonemap_exposure` from
  `environment.exposure` (Shinjuku 0.92, Ikebukuro 1.0; three's own value).
- SSAO on, glow off (§7's contact AO is what makes the equipment read; the references have no bloom).
- Fog: three's `fog { color, near, far }` is linear in distance, so it maps to Godot depth fog with
  `fog_mode = FOG_MODE_DEPTH`, `fog_depth_begin = near`, `fog_depth_end = far`, `fog_depth_curve = 1.0`, and the
  sidecar's sRGB colour as is (`fog_light_color` takes sRGB and Godot linearises it — converting here as well would
  apply the transform twice, leaving the fog almost black). Ikebukuro has fog (25..180 m), Shinjuku does not.
- Ambient: a station whose bake is applied gets **no ambient** (`AMBIENT_SOURCE_DISABLED`), because the bake is its
  light. An unbaked station (Shinjuku) gets `AMBIENT_SOURCE_COLOR` at §7's studio world grey
  `(0.55, 0.58, 0.62)` linear, encoded once to sRGB (`linear_to_srgb()`, because Environment colours are sRGB), and
  scaled to a 0.25 fill so the client's key + fill stay dominant. The web's Shinjuku rule
  (hemisphere + RoomEnvironment 0.55, §8) is a scene light; Godot gets this ambient plus the same key + fill lights.
- SDFGI is off; `--gi=sdfgi` turns it on for the GPU review slot. SSAO and SDFGI only render on Forward+/Mobile this
  project runs `gl_compatibility`, where Godot ignores both (it prints a warning for SDFGI); they are set for the visual
  pass, not for the headless gate.

`looks/materials.json` maps snapshot material names to style-bible materials. Each mapping carries a `from` block with
the snapshot evidence (colour, metal, roughness, surface count, roles, optionally the sample mesh names) and a one-line
`evidence` note, because the snapshot loses the scene's own material names (three's exporter names unnamed materials
`material_<n>`). Those names are positional, so the loader re-checks every mapping before applying it: a mapping is
applied only while its material still has the recorded sRGB albedo exactly, metal and roughness within 0.01, and every
recorded sample mesh still carries it. A mapping that no longer matches is skipped with a warning instead of repainting
whatever took the name (#254/#257), and `run_look_tests.gd` fails on it. A station's
`unmapped` array lists every material the table leaves alone and why; anything ambiguous stays there rather than being
guessed. Shinjuku has 13 mapped materials (floors, walls, ceiling, tactile paving, stair nosings, gate bodies/caps,
steel plates, light housings, the Oedo accent band, handrails); Ikebukuro is listed as entirely unmapped because its lightmap
shader owns its surfaces and that decision belongs to the lead. The table sets only albedo (sRGB, written to
`albedo_color` exactly as the glTF importer writes it), roughness and metal; it never touches emission, transparency or
textures, and it only ever overrides surfaces whose material it names.

Two mappings are **provisional, not E27 facts**: `material_2` (wall field → `steel_painted_light`, a grey painted steel
per OD-30 via R10 #234) and `material_37` (stair nosings → `vertical_safety_yellow`, a representative style-bible finish;
R10 found no source). `material_11` maps to `oedo_accent`, a style marked `local: true` with a `note`: GTEki's chosen
Oedo magenta per OD-29 (#222), not the operator's official colour. The optional `local`, `note` and `provisional` fields
are documentation; the loader ignores them, and the source's faint emission survives because the override duplicates the
snapshot material.

`tests/run_look_tests.gd` (run by `run-scenes.sh`) checks the profile selection and its errors, the Environment against
each station's sidecar (AgX, exposure, SSAO, glow off, SDFGI on/off, depth fog near/far/curve/colour, the ambient rule),
that every mapped name exists in the snapshot, that mapped albedo/roughness/metal equal the table, and that unmapped
surfaces keep the snapshot material and take no override. `hq.gd --check --look=hq` prints the same profile summary the client renders.

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

## Capture and performance (G-4 prep / G-5b of #164)

Windowed only. `project.godot` stays `gl_compatibility`; Forward+ comes from the command line.

```
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- --station=<id> --capture=<outDir> \
  [--look=baseline|hq] [--gi=off|sdfgi] [--perf=<seconds>] [--poses=<file>]
```

Per pose it places the walker, settles the follow camera for 45 physics frames, waits 3 rendered frames, saves a 1600x900
PNG and writes its camera transform, FOV and `RenderingServer` counts into `<outDir>/report.json` (`gteki.capture/0.1`),
together with the run's station, look, GI, renderer, driver, adapter, window size, machine, and any pose it could not
take (`pose_problems`). `renderer` is the method the run actually rendered with
(`RenderingServer.get_current_rendering_method()`), because `project.godot` says `gl_compatibility` while the runbook
asks for Forward+ on the command line; the project setting is recorded apart as `project_renderer` and never labelled
as the measured renderer. Default poses: each spawn point x 4 yaws; Ikebukuro adds the `g_jr_c2` -> `x35` route every 15 m
(needs `.cache/routes/ikebukuro.route.json`, written by `run-walk.sh` or by the router command in the runbook below; a
missing route file is recorded in `pose_problems` and makes the run exit non-zero, with the other poses still captured,
rather than quietly shortening the list) and the #227 stall area; Shinjuku adds 3 poses at inverted-band walls. Then the **G-5 evidence poses**: for every route the
evidence walk covers (`addons/gteki/gteki_evidence.gd`; `run-capture.sh` fails if that list and the walk's own plan
ever disagree) its start,
its mid-stair point and its goal — the route comes from the real router through the bridge, the mid-stair point is the
middle of the route's own `stairs` step that has walkable ground, and a route the router refuses, or a route with no
stairs step, is stated in `pose_problems` instead of being filled in — plus each lift's landing, where the walker's own
ride rules put the feet (Shinjuku S4's is the one shaft in the goldens). `--poses` takes a JSON array of
`{name, position:[x,y,z], yaw_deg, pitch?, distance?}` (Godot frame). Hard 10-minute bound, which also counts the perf
window about to start.

`--perf=<seconds>` measures every settled pose: 60 rendered warm-up frames first (shader compilation, first-use uploads),
then rendered frames until the window has passed. No warm-up frame is in any series. Per measured frame it records the
real interval between rendered frames (vsync, presenter and compositor included) and
`RenderingServer.get_frame_setup_time_cpu()` (the CPU time the renderer spent setting up that frame), reporting
p50/p95/max of each (nearest rank), the frame's draw calls, primitives and video memory, and the run's window size,
renderer, driver and
`RenderingServer.get_video_adapter_name()`. `Performance.TIME_PROCESS` is not sampled as a series: the engine refreshes
it about once a second with the largest process time seen in that second, so it is recorded once per pose as
`process_interval_max_ms` and the report keeps it out of every percentile. `--perf` needs `--capture=<dir>`, because the
figures go into that report.
**On a headless display `--capture` says "capture needs a display" and exits 0 after loading the station, and `--perf`
says "perf needs a display" and exits 0 before anything is loaded; neither writes a report or a perf figure.** An
argument that makes no sense (`--perf=0`, `--perf=soon`, `--perf` without `--capture`) exits 2.

`tests/run_capture_tests.gd` (run by `run-capture.sh`) checks the argument rules, the percentiles, that a missing route
file fails the run instead of shortening it, that the capture's
route list is exactly the evidence walk's routable routes, that every route has its start and goal (and its mid-stair
point where it has a `stairs` step, standing on a stairs step inside that step's own span), that S4's lift landing is
captured within the ride's reach on the exit's level, that every pose stands on ground the real walker accepts, and the
report generator on fixture reports — which must name the machine, print the measured values, say "No frames were
sampled" for a run captured without `--perf`, and write nothing for a file that is not a capture report. It asks the
real router for the routes, so it needs `pnpm install`; nothing in it renders.

```sh
lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-capture.sh
```

## GPU slot runbook (G-5b)

The captures are the one part that needs a display and a GPU, so they run in the lead's GPU slot, on the machine whose
figures go into `docs/evidence/g5-performance.md`. In order, from the workspace root:

```sh
# 0. the snapshots the client loads, and the route file the Ikebukuro G-4 poses sample (skip if already fresh)
pnpm tsx packages/godot/src/export-scene.ts ikebukuro packages/godot/.cache/scenes/ikebukuro
pnpm tsx packages/godot/src/export-scene.ts shinjuku packages/godot/.cache/scenes/shinjuku
mkdir -p packages/godot/.cache/routes
pnpm tsx packages/cli/src/route.ts stations/ikebukuro g_jr_c2 x35 > packages/godot/.cache/routes/ikebukuro.route.json

# 1. Ikebukuro, baseline look (53 poses, ~6 min)
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- \
  --station=ikebukuro --look=baseline --capture=.cache/g5/ikebukuro-baseline --perf=5

# 2. Ikebukuro, hq look (~6 min)
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- \
  --station=ikebukuro --look=hq --capture=.cache/g5/ikebukuro-hq --perf=5

# 3. Shinjuku, baseline look (27 poses, ~3 min)
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- \
  --station=shinjuku --look=baseline --capture=.cache/g5/shinjuku-baseline --perf=5

# 4. Shinjuku, hq look (~3 min)
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- \
  --station=shinjuku --look=hq --capture=.cache/g5/shinjuku-hq --perf=5

# 5. Shinjuku, hq look with SDFGI (~3 min; gl_compatibility warns that it ignores SDFGI, which is itself the finding)
godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- \
  --station=shinjuku --look=hq --gi=sdfgi --capture=.cache/g5/shinjuku-hq-sdfgi --perf=5

# 6. the table, from every report.json the runs wrote (absolute paths: Godot resolves relative ones against --path)
godot --headless --path packages/godot --script res://tests/perf_report.gd -- \
  "$PWD/packages/godot/docs/evidence/g5-performance.md" "$PWD"/packages/godot/.cache/g5/*/report.json
```

Each capture command has its own 10-minute bound (`hq_capture.gd` `TIMEOUT_MS`) and stops before starting a pose the
bound could not hold. At `--perf=5` and 60 rendered frames a second the five runs take about 22 minutes; at half that
frame rate each pose spends twice as long in its 60-frame warm-up and the whole set takes about 25. A capture that exits
non-zero still wrote its `report.json`: the reason is in its `pose_problems` (a missing route file, a pose with no
walkable ground, the timeout), and the table below lists it. The captures write only
under `packages/godot/.cache/g5/` (gitignored): each run's `report.json` and its PNGs. The generated
`docs/evidence/g5-performance.md` is the one file to commit; every line of it is a report's own, labelled with the
machine and the GPU slot it was measured in.

## Showcase side-by-side (G-4)

From the workspace root in the lead's GPU slot, render the Lane E GLBs through their own cameras. All file arguments
are absolute; set `CONCOURSE_GLB` and `VERTICAL_GLB` to the absolute paths of the read-only exports:

```sh
godot --path packages/godot --rendering-method forward_plus --script res://tools/showcase_compare.gd -- \
  "$CONCOURSE_GLB" "$PWD/packages/godot/.cache/showcase/" --camera=gates_closed \
  "--ref=gates_closed=$PWD/docs/assets/img/concourse_gates_closed.jpg"
godot --path packages/godot --rendering-method forward_plus --script res://tools/showcase_compare.gd -- \
  "$VERTICAL_GLB" "$PWD/packages/godot/.cache/showcase/" --camera=hero \
  "--ref=hero=$PWD/docs/assets/img/vertical_hero.jpg"
```

Each run writes a 1600×900 Godot PNG, a 3200×900 `_side.png` (Blender reference left, Godot right), and a layout-specific
`_report.json` under `packages/godot/.cache/showcase/` (gitignored). Omit `--camera` to render all imported cameras.
The Godot lighting is an approximation of Blender's hint area lights: wide downward spots replace disks and short
rows of spots replace long LEDs, sharing each hint's power. Both use Blender's fixed warm colour and ignore
`colour_temp_k`. The watt-to-energy factor, cone, range, row spacing and studio sun mapping are documented in
`tools/showcase_compare.gd` and recorded in the report; AgX and SSAO do not imply identical Blender shading. A headless
invocation prints `showcase_compare needs a display`, exits zero and writes nothing.
The argument rules, the sun mapping, the hint-to-spot split and the metadata contract are checked headless by
`godot --headless --path packages/godot --script res://tests/run_showcase_tests.gd` (no GLB or GPU needed).

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
- A route that states a lift can be ridden (#287): guided walking walks up to the shaft and waits there — `Guide.advance`
  never carries the avatar past a shaft the route has not ridden — and, while standing on that route's `elevator` step
  (or, for the last 1.0 m of the approach that ends at it, the same step through `Guide.step_at`), the HUD offers
  `E: ride the lift` (or the gamepad's A). Taking it fades out for 0.3 s, puts the feet down through
  `gteki_walker.gd`'s own rules (`ride_to`: `accept_ground`, the exit's level, forward along the route inside a ±30°
  cone and at most 1.0 m, body fits and a clear body-height line — on S4, 0.75 m forward of the exit vertex, which sits
  over the opening), snaps the follow camera to the landing while the screen is black, fades back in and resumes guided
  walking from the landing, never from the vertex over the shaft. If nothing qualifies the ride is refused, the HUD
  says so and the avatar stays at the shaft. The yaw is kept, free walking is never offered a lift, and no other step or
  key can start one: the ride is read from the route's own steps, never guessed from the geometry. The HUD asks
  `Guide.ride_near`, the same predicate the evidence walk checks.

Tests: `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-guide.sh` (golden searches on both stations, Ikebukuro
`jr-central-gate-2` to `exit-35` ribbon, Shinjuku `poi:platform:oedo` to `poi:exit:1` symbolic, the S4 lift ride and its
negatives, the landing rules against a synthetic floor — behind the shaft, off the exit's level, across a wall, into a
wall, nothing at all — negative route, guided walk, HUD state, the HUD ride flow and a refused ride). The evidence run
additionally drives the client's HUD with the real walker on the real S4 snapshot: wait at the shaft, E, the camera on
the landing while black, then guided ticks that must keep the feet on accepted ground.

## Evidence walks (G-5a of #164)

```sh
lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-evidence.sh              # Ikebukuro -> docs/evidence/g5-ikebukuro.md
lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-evidence.sh shinjuku     # Shinjuku  -> docs/evidence/g5-shinjuku.md
```

`tests/run_evidence_tests.gd` holds one plan per station (`PLANS`): the golden it replays, the table it writes and the
golden scenarios it covers. Ikebukuro walks four guided routes (W1 Central Gate 2 to Exit 35, W3 Central Gate 1 to Exit
22, W4 South Gate to Exit 18, I7 Exit 26 to Exit 10) plus a flat control (W2, West Exit B1 to Exit 4); Shinjuku replays
all nine scenarios of its golden. For each scenario it asks the real bridge for the route and compares distance, time,
node count, floor changes and the ordered step list with the web's golden
(`tests/e2e/specs/__goldens__/02-navigation.spec.ts/<station>-routes.json`) exactly. A scenario the golden refuses must
be refused by the router, with the golden's own reason (and the scenario's `profile` toggles passed as `--step-free`,
`--unpaid-only`, `--strict-hours`); a refused route has no polyline and is not walked. A scenario the golden routes is
walked along the polyline with `gteki_walker.gd`, recording walked length against the route's, stops, body-block
episodes, the floor bands the walker's own height trace crosses, the rides it took, the arrival distance and the time
at 1.45 m/s. The table carries the commit and Godot versions; it is committed with the change it describes.

Two comparisons follow the router's own definitions rather than one fixed notion:
- **Length**: the router measures an edge in 3D when its heights are known and in plan when they are symbolic
  (`geometryLength(geometry, symbolicZ)` in `packages/navigation/src/router.ts`), so the walk compares its flat figure
  for a symbolic route (all of Shinjuku's are) and its 3D figure otherwise (Ikebukuro's). The table shows both and its
  **Length basis** column names the figure that was compared, route by route.
- **Floors**: `floorChanges` counts graph floor transitions, while the walker's height trace counts rendered floor bands.
  A stair edge can span floors the route has no node on, so the walker crosses rendered bands the stair passes through
  that the route never visits. The walk must start on the route's first floor, reach every floor the route names in
  order and end on its goal floor, and every band crossed in between must lie strictly between the two route floors
  being travelled between and move toward the second — a band outside that range, a reversal or an ending elsewhere
  fails. The table shows the walker's crossings beside the route's count.
- **Rides**: a route that states a lift is walked, and the ride is read from the route itself (#287). Inside an
  `elevator` step, a consecutive polyline pair that moves under 0.5 m horizontally while changing height by more than
  1.0 m is the shaft (`RIDE_MAX_FLAT` / `RIDE_MIN_DROP` in `gteki_guide.gd`); the same vertical span under `walk` or
  `stairs` is never a ride. The walk states that explicitly before it starts: a vertical jump no step calls a lift is
  neither walkable nor rideable, so a route with one fails as a route the walk cannot take rather than as the stall it
  would cause. Shinjuku S4's one shaft is 0.473 m wide with a 7.8 m drop — inside the gate with a visible margin. The
  walk takes it through the same `Guide.take_ride()` the HQ client's E prompt uses, and only once the walker has
  actually stalled at the shaft's edge (the ground ends at the opening), so the approach gap is the measured unwalkable
  ground, not the 1.0 m offer distance. A shaft's exit vertex is over the opening (the car's floor is the hole), so the
  feet are set down on the first ground forward along the route's own continuation — within 1.0 m of the vertex, inside
  a ±30° cone of the direction to the next point, straight ahead first, on the exit's level, with the body fitting and
  a clear body-height line (on S4 that is 0.75 m out); nothing qualifying refuses the ride and fails, so no landing is
  ever behind the shaft or across a wall. The table's **Rides** column shows the count, each shaft's width and drop and
  the total height, **Approach** and **Landing** the two measured stretches, and **Excluded** the ridden span plus
  both, held to the ride span plus 1.0 m approach and 1.0 m landing per ride. All of it is excluded from the walked
  length, and a route that states a ride the walk did not take fails.

The walk follows the polyline itself: it turns toward the next vertex only once it is within 0.05 m of the current one,
so by construction it never cuts a corner the line does not cut. A larger reach cut a corner at a sharp vertex and the
chord put the body into a wall corner; that was the walk, not the station (#284), and with the vertex reach the
Ikebukuro routes walk with no stop and no body block. Any block, anywhere, fails the test and is reported with the
collider that refused the step, the walker's feet where it stood and the clearance to the surface's plane. A stall with
no refused step reports where the ground ends instead, because a step can also be refused for having no ground to land
on (a lift opening).

The table is written only by a run in which every check passed; a failing run prints the table it would have written
instead and leaves the committed one untouched.
