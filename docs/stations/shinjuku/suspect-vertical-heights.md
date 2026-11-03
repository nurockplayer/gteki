# Suspect vertical display heights (#789)

Source inspection: 2026-11-04 JST. Only the public E27 acquisition pinned by
`stations/shinjuku/sources/manifest.json` is used. Heights below are symbolic ENU
display metres, not measured elevations; source floors, coordinates and routing
remain unchanged.

All eight links have `lev_diff=5`, `vtcl_slope=7`, `H_F=0`, and both endpoint
nodes have `H_F=0`. The pinned 2024 NWD specification (PDF page 15, link attribute
table, items 12–13) defines
`vtcl_slope=7` as an uphill slope greater than 18%, and `lev_diff=5` as a step
greater than 10 cm. These are categories, not metre values. The signed slope
and source distances support symbolic rises for the three isolated ends too.
`H_F=0` supplies no distinct endpoint elevation. `route_type=5/6` is interpreted using the existing E27 CAD category
rule (stairs/escalator respectively).
This slope convention agrees with all 32 cross-floor source stairs/escalators:
25 ascending links use code 7, and seven descending links use code 8. The other
19 links have equal source floor labels, including seven of the eight repaired here.

The southern corridor's six nodes (`51435d91`, `ad4ba030`, `3e48483e`,
`f4135189`, `b1f35094`, `296c36e0`) all say NWD floor −1, but are separated from
the main B1 corridor by the `bdcdf922`/`dcbc1a25` stair chain and parallel
`c7fa5f74` escalator. They also connect to the floor-0 street through
`c690df6c` + `c3fe6342`, whose source distances are 3.2 + 3.2 m, and the flat
`5ce3f318` landing. The existing symbolic stair ratio (0.5) derives a local
corridor datum: street height − (3.2 + 3.2) × 0.5 = −3.20 m. Propagation uses
only connected `walk` links with `lev_diff=1` and `vtcl_slope=1`.

| Edge prefix | Cause and source evidence | Before from → to (m) | Repaired from → to (m) |
| --- | --- | --- | --- |
| `c690df6c` | Lower exit flight: source distance 3.2 m; B1 corridor was anchored to the main B1 datum, forcing half of 7.80 m into each short flight. | −7.80 → −3.90 | −3.20 → −1.60 |
| `c3fe6342` | Upper exit flight: source distance 3.2 m, end node `3af66366` floor 0; the flat `5ce3f318` landing shares the preceding flight's height. | −3.90 → 0 | −1.60 → 0 |
| `dcbc1a25` | Both ends labelled −1; distance 4.2 m. The adjacent flat `3582c9d0` landing joins this to `bdcdf922`; distribute the 4.60 m main-B1-to-corridor rise by 4.9:4.2 flight lengths. | −7.80 → −7.80 | −5.32 → −3.20 |
| `bdcdf922` | Both ends labelled −1; distance 4.9 m. `2a43a1d7` joins the from end to main-B1 node `b092e4d6`; `3582c9d0` is the shared landing. | −7.80 → −7.80 | −7.80 → −5.32 |
| `c7fa5f74` | Both ends labelled −1; distance 10.6 m. Flat `62b88b91` joins main B1, while flat `ed10f517` joins the distinct southern corridor; equal floor labels had erased the rise. | −7.80 → −7.80 | −7.80 → −3.20 |
| `c2c4ebb3` | Distance 2.4 m, both ends −1; `c1b5ce9a` anchors the from end to B1, but to node `71a6a392` has degree 1. Slope code 7 supplies the uphill direction; distance × 0.5 supplies the symbolic rise. | −7.80 → −7.80 | −7.80 → −6.60 |
| `45ebdab4` | Distance 2.7 m, both ends −1; `c4779190` anchors the from end to B1, but to node `032cf295` has degree 1. Slope code 7 supplies the uphill direction; distance × 0.5 supplies the symbolic rise. | −7.80 → −7.80 | −7.80 → −6.45 |
| `4038cecf` | Distance 2.7 m, both ends −1; `7287af1d` anchors the from end to B1, but to node `6dff9add` has degree 1. Slope code 7 supplies the uphill direction; distance × 0.5 supplies the symbolic rise. | −7.80 → −7.80 | −7.80 → −6.45 |

The clearance solver includes the constant offset introduced by the source-run
datum when evaluating its affine height constraints. Global floor elevations
remain unchanged. The corridor's other street escalator, `4bee1c5e`, also picks
up the corrected endpoint (−3.20 → 0); its source floor-0 endpoint is unchanged.

Regenerate with `pnpm --filter @gteki/station-shinjuku import:e27`, then
`pnpm --filter ./stations/shinjuku bake:surface` and the stairwell/navmesh bakes.
All eight approximation flags are removed; the steep/flat truth rule remains.
Measured elevations still require field evidence, just as for the existing
symbolic floor model.

## Navmesh qualification — 2026-11-04 JST

The canonical public `navmesh-fallback.ts --station shinjuku --with-greybox`
run used 0.10 m cells, 0.30 m radius, 0.40 m climb and 256-cell tiles.
All eight repaired edges were emitted and attached at both ends. Bake user IDs:
`4038cecf=16`, `45ebdab4=20`, `bdcdf922=45`, `c2c4ebb3=47`, `c3fe6342=48`,
`c690df6c=49`, `c7fa5f74=52`, `dcbc1a25=57`.

| Public metric | Before | After |
| --- | ---: | ---: |
| Suspect vertical edges | 8 | 0 |
| Route-used suspect edges (#789 before count) | 6 | 0 |
| Fallback edges | 4 | 4 |
| Unvalidated joins | 56 | 56 |
| Connector / fallback / navmesh wall hits | 0 / 6 / 0 | 0 / 6 / 0 |
| Off-floor / invalid joins | 0 / 0 | 0 / 0 |
| Routable / failed route pairs | 238 / 2 | 238 / 2 |

No per-edge clip baseline increased; no new fallback edges or detours appeared.
PR #783 is still open at qualification, so this base has `suspectEdges`, not the
new `suspectPolyline` field. With no bake suspects, its route-used subset is empty.
The regenerated fallback and clip-baseline files are byte-identical; paths and
suspect files changed.

Public bundle SHA-256: `61225ea3e89fe4732368f38c4023f7bce58bde7c3d390671980719695a05ec16`.
Mesh SHA-256: `d0bd5911f41504b376c052ae0fa65130faf29cd102da9bbd74f307e03605b826`.
