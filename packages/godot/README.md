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

The route adapter constructs path data; it does not create visible route geometry.
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

Runtime APIs: [GLTFDocument](https://docs.godotengine.org/en/latest/classes/class_gltfdocument.html)
and [Godot glTF scene export](https://docs.godotengine.org/en/latest/tutorials/assets_pipeline/exporting_3d_scenes.html).
