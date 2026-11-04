# Oracle review

Reviewed 2026-11-03 19:54 JST with `oracle-ego`, GPT-6 / high, diff only. Exit 0. Run directory: `~/.local/state/oracle-ego/runs/20261103-194832-71285-gteki-645-s5`.

Verdict: REQUEST CHANGES. No second review requested.

## Concrete fixes

- Fare-gate edges cannot publish a generic Detour bypass. Without a dedicated attached link they now fail closed.
- Published junction endpoints are compared against the actual rounded edge endpoints. A mismatch is rejected, never filled with a straight segment.
- The existing straight-distance + 0.3 m junction-detour bound is preserved, while accepted junctions actually follow the queried navmesh path.
- A failed baked-path load in an otherwise loaded public navmesh scene exposes an empty path set, so routing reports failure. Intentional L0/private graph rendering is preserved. Added a focused regression.

## Findings not reproduced in the actual call flow

- The `verticalLinkCandidates` validator receives `(nodeId, node, snapped)`, separately for each endpoint (`navmesh-links.ts:116-117` in the base). Thus `validateLinkSnap(probe, snapped, snapped)` validates each snap's floor; it does not confuse the link's start and end. The discarded node-to-snap approach must not veto the guide. Renamed callback arguments to make this clear.
- Vertical steps select the attached link by the requested edge ID before entering the walking branch. Walking paths reject every off-mesh part. Therefore a foreign fallback link cannot reach the removed reconstruction checks. Removed the now-unreachable reconstruction branch to make this invariant explicit.

## Gate-dependent finding

Strict missing-snap failure can expose suspect/fare-gate routes that previously relied on graph geometry. Preserve truthful failure and measure both stations. Do not raise baselines or exempt failing routes to obtain shrink-only. If the existing geometry cannot support the requested contract, the lead must decide the next bounded task.

## Follow-ups

Oracle's nonblocking single-point-array validation suggestion was not added: the publisher already requires two points. Additional speculative tests and refactors were not added.
