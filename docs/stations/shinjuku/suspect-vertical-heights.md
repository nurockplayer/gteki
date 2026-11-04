# Suspect vertical display heights (#789)

Source inspection: 2026-11-04 JST. Only the public E27 acquisition pinned by
`stations/shinjuku/sources/manifest.json` is used. Heights below are symbolic ENU
display metres, not measured elevations; source floor IDs, XY coordinates and graph connectivity
are preserved.

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
`pnpm --filter ./stations/shinjuku bake:surface`,
`pnpm --filter @gteki/station-shinjuku kit:catalog` and the stairwell/navmesh bakes.
Refresh the existing fare cache with
`pnpm exec tsx stations/shinjuku/test/helpers/generate-restricted-fences.ts`:
its input key includes render heights. The fresh derivation has 768 fences
(previously 773) and the same 30 conflict records. This is the same fresh
geometry used by the canonical gate before the cache was refreshed.
Refresh the existing scene fixture with
`pnpm exec tsx stations/shinjuku/test/helpers/scene-digest-fixture.ts`.
All eight approximation flags are removed; the steep/flat truth rule remains.
Measured elevations still require field evidence, just as for the existing
symbolic floor model.

The derived kit catalog now contains 39 entries (26 stair, 12 escalator, one
gate), covering 29 stair runs and 21 of 22 escalators. Only `27d3ed49` remains
outside the catalog's angle range. The shipped GLB still fits the same 19
escalators; `4bee1c5e` and `c7fa5f74` keep the existing procedural finishes until
the asset lane builds their revised catalog entries. No GLB is changed here.

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
The merged main `9e90ac2c` still reports `suspectEdges`, not a literal
`suspectPolyline` field (#783 remained open during reconciliation). The
captured runtime audit reports `suspectEdges: []`, and the bake has no suspect
candidates, so no route can use a suspect polyline.
The regenerated fallback and clip-baseline files are byte-identical; paths and
suspect files changed.

Public bundle SHA-256: `61225ea3e89fe4732368f38c4023f7bce58bde7c3d390671980719695a05ec16`.
Mesh SHA-256: `570353bce0911f285f175ca32e17782188012a5ad039f8dcec7248a64dabd009`.

After the roof and portal corrections, the final heavy run completed at
2026-11-04 12:18 JST after merging main `9e90ac2c`. Both stairwell tiers were rebaked and passed
`pnpm bake:stairwells:check`: 308 meshes, 68 cut meshes and 18,697 cut triangles,
with maximum attribute error `0.0000152587890625`. The canonical public gate
and attachment/baseline comparison then passed on that same geometry.

## Bounded review — 2026-11-04 JST

The requested `oracle-ego` review (GPT-6, high effort) found no demonstrated
code blocker. It accepted the signed source interpretation, six-node corridor
propagation, isolated-end direction handling, affine clearance offsets and
eight attached bake links. It explicitly left merge readiness conditional on
reconciling the broader test failures and committing generated expectations.
Optional source-shape assertions and an affine-specific regression test remain
follow-ups; this change adds neither a new validation mechanism nor new assets.

## Height-dependent roof correction — 2026-11-04 JST

The related tests exposed a real consequence of the raised exit-4 landing:
`5ce3f318` is source-roofed and now lies at −1.60 m inside the street-opening
band, but the surface roof builder previously considered sloping flights only.
Include the source-roofed walk links between flight endpoints, using their source
width and derived node elevations. Join adjoining roof footprints into one
glazing sheet so overlapping overhangs do not add a second translucent face.
The existing surface-roof height and camera-cap construction are reused.
The roof query excludes hanging linear lights: a luminaire is not a roof.

The raised corridor also exposed a generated 2.45 m portal header at the
lower mouth of `c690df6c`. The original camera replay hit that header at
three uphill samples. Flat passages at intermediate elevations now use the
existing 3.2 m landing clearance when carving generated walls, matching the
adjacent landing roof. Source walls and the camera solver are unchanged. The
original five camera tests pass; at the default pitch the lower flight has
minimum camera distance 2.33 m uphill and 3.45 m downhill (the comfort
threshold remains 1.6 m), with maximum head share 0.16 and 0.11 respectively.

## Main merge — 2026-11-04 JST

Merged main `9e90ac2c` without rebasing. The only textual conflict was the
measured `MAIN_BASELINE` in `kit-swap.test.ts`; it was regenerated from the
combined scene rather than selecting either old digest. Main's runtime and
rendering changes are retained. The importer, surface bake, kit catalog, fare
cache, scene fixture, existing scene expectations, stairwell recipes, navmesh
outputs and map symbols were regenerated with their generators.

The merged public bake emitted and attached all eight repaired links, with
zero bake suspects and zero audit-used suspects. The shrink-only comparison
against main's saved baseline passed with no new fallback edges, detours or
per-edge clips; all public totals in the table above remain unchanged.
