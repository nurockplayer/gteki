# Step 5 assembly map

Recorded 2026-11-03 19:25 JST against `1b9e2c82` (origin/main).

- `packages/godot/src/navmesh-audit.ts:211-223`: suspect edges return graph lines; vertical edges and gates call `buildConnectorPath` with connector/graph lines.
- `packages/navigation/src/navmesh-connector.ts:19`: inserts the authored line between snaps, returning to graph/connector positions.
- `packages/godot/src/navmesh-audit.ts:253-269`: off-mesh reconstruction inserts graph approach lines for link fallbacks and the authored vertical polyline between Detour link endpoints.
- `packages/godot/src/navmesh-audit.ts:367-395`: checks a straight join but concatenates the separate edge paths; the queried navmesh join is discarded.
- `packages/godot/src/navmesh-clip-baseline.ts:22-23`: `unvalidatedJoins` is the audit's whole `incompleteRoutes` count, not a literal count of joins.
- `packages/godot/src/navmesh-audit.ts:550-581`: publishes only non-vertical walk paths; no junction paths are exported.
- `packages/godot/src/navmesh-fallback.ts:96`: publishes those baked edge paths for runtime.
- `packages/navigation/src/present.ts:64-93`: runtime connector replacements win over baked paths; later edge starts are omitted, so concatenation silently draws straight joins. Missing paths fall back to graph lines.
- `apps/web/src/explorer/explorer.ts:1474-1475`: exposes only baked edges.
- `apps/web/src/ui/app.ts:1025`: passes connector and baked paths to `routePolyline`, shared by ribbon, minimap and guide.
- `packages/godot/src/navmesh-links.ts:64-83`: link snap admission also validates the discarded graph-node-to-snap approach; this can reject an otherwise valid exit-stair snap.

The design file is available at the main clone's `.claude/director/fable-645-greybox-architecture.md`. The removed m3shell worktree's regeneration script is reproduced verbatim in PR #775's body; use that container-only timeout approach here.
