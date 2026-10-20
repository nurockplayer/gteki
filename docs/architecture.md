# GTEki — Architecture ADR-0001

Status: Proposed implementation defaults for M0. Opus 5.5 may refine after documenting evidence and cost.

## Core separation

```text
Station source records → normalization/validation → StationGraph & POI index
                                                   ↓
                                        routing/search APIs
                                            ↙          ↘
                                 Web 3D (Three.js)   Godot importer (spike)
```

**Routing logic must never depend on the rendering engine.** 3D meshes are visual/physical approximations; the navigation graph is separately validated truth. Model-to-world transforms must be explicit and testable.

## Suggested layout

```text
apps/web/
packages/schema/
packages/navigation/
packages/search/
stations/ikebukuro/
stations/shinjuku/
tools/blender/
godot/
docs/research/
docs/HANDOFF.md
```

## Minimum contracts (fields, names provisional)

- `Station`: id, operator set, coordinate-reference system, dataset version.
- `Floor`: id, station id, elevation/reference, public/paid boundary info.
- `Node`: id, station id, floor id, 2D/3D location, semantic type, provenance.
- `Edge`: endpoints, geometry/path, distance derivation, traversal mode (walking/stairs/escalator/lift/gate), direction, entry permission, accessibility, closure interval/status, verification/confidence.
- `POI`: id, names/aliases, category, station/floor, nearest **verified** graph connector, freshness and source.
- `Evidence`: source id, URL / local asset pointer, license, date, geometry coverage, validation method.

No path can cross paid boundaries or floor levels without an explicit valid edge. Unknown/incomplete links cannot masquerade as shortest paths.

## Algorithms / testing

Start with Dijkstra or A* over the verified directed graph; distance costs in stated units. Separately filter for accessible navigation constraints and closed edges; deterministic fixture-based tests for absent path, gate boundaries, loops and floor transitions. Display provenance and a last-reviewed date for route evidence.

## Renderer & assets

- Web M0: TypeScript strict, Three.js, lightweight reusable GLB/glTF tiles, keyboard/touch input. Asset budgets and mobile FPS thresholds measured during spike before locking targets.
- Blender: reproducible import/conversion scripts; store transformation parameters and license metadata.
- Godot: small independent import/same-coordinate-system proof; no duplicate routing implementation.
- Source material license and image rights checked before incorporation; no blind scraping or redistribution of restricted maps.
- Commands: pnpm and Homebrew; no npm/npx/yarn.

## Isolation

Station folders own distinct geometry, graphs, POIs, versions and validation fixtures. Shared code changes have a single accountable owner and a reviewed interface. No modifications to Eddington or other projects.
