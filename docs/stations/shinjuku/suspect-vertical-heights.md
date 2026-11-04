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

Latest-main reference: `a0ff47f9` (including #783).

| Public metric | Main | Candidate audit |
| --- | ---: | ---: |
| Suspect vertical edges | 8 | 0 |
| `suspectPolyline.routes` | 58 | 0 |
| `suspectPolyline.edges` | 6 | 0 |
| Fallback edges | 4 | 4 |
| Unvalidated joins | 48 | **56** |
| Connector / fallback / navmesh wall hits | 0 / 6 / 0 | 0 / 6 / 0 |
| Off-floor / invalid joins | 0 / 0 | 0 / 0 |
| Routable / failed route pairs | 238 / 2 | 238 / 2 |

No per-edge clip baseline increased; no new fallback edges or detours appeared.
The runtime audit's literal `suspectPolyline` field reports zero routes and
zero edges; `suspectEdges` is empty. However, the strict no-rise gate fails
because 56 incomplete routes exceed main's limit of 48. See the route-cohort
evidence below. The main baseline limits are retained, rather than silently
accepting the higher count. The generator's complete measured snapshot is
recorded by this qualification; its proposed higher limit is not committed.

The latest heavy run completed at 2026-11-04 14:34 JST on the combined main
`a0ff47f9` and height-repair source. Both stairwell tiers were rebaked and passed
`pnpm bake:stairwells:check`: 308 meshes, 68 cut meshes and 18,697 cut triangles,
with maximum attribute error `0.0000152587890625`. The canonical generator
completed; the strict comparison then failed only on
`total.unvalidatedJoins (48 → 56)`. All eight repaired links were emitted and
attached. No acceptance threshold or route classification was changed.

Public bundle SHA-256: `61225ea3e89fe4732368f38c4023f7bce58bde7c3d390671980719695a05ec16`.
Mesh SHA-256: `570353bce0911f285f175ca32e17782188012a5ad039f8dcec7248a64dabd009`.

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

## Main merges — 2026-11-04 JST

Merged main `9e90ac2c`, `9cbbfb29`, then `a0ff47f9`, without rebasing. The first
textual conflict was the measured `MAIN_BASELINE` in `kit-swap.test.ts` during the first
merge; it was regenerated from the combined scene. The second merge had no
textual conflicts and retains #783's snap-to-snap paths and route outcome
classification. Main advanced again while the heavy gate was queued; the
latest merge's scene-fixture, kit-digest and identity-draw conflicts were
regenerated from the combined scene, preserving #812's shared low-tier step
mesh and separate high-tier meshes. Main's runtime and rendering changes are retained. The importer,
surface bake, kit catalog, fare cache, scene fixture, existing scene expectations,
stairwell recipes, navmesh outputs and map symbols use their normal generators.
Generated JSON was not hand-merged.

Merged-head CI identified four test expectations that the earlier container
setup timeouts had not exercised. The B6 fence geometry is byte-equivalent
except its generated ordinal changes from 628 to 623 after five fences are
removed; the replay still uses the same endpoint. The repeated kit wall count
is 14,906, matching the measured baseline. Both drawn-roof queries exclude
hanging linear lights. The merged high-quality texture report measures
107.503 MiB signage and 186.503 MiB total; texture-density settings are retained.

### Newly exposed incomplete routes

Main #783 skips suspect-bearing routes before counting incomplete routes.
Main's committed baseline therefore counts 48 incomplete routes and 58 suspect
routes. Once the repaired stairs cease to be suspect, eight of those 58 routes
reach the missing-path check and remain incomplete. Actual public graph routing
has identical directed edge sequences on main and the candidate for every POI
pair. Replaying the same deduplicated route cohorts identifies the existing 48
incomplete routes plus these eight newly exposed routes:

| Directed route pairs | Existing missing paths | Audit reason |
| --- | --- | --- |
| Exit 2 → 4, 2 → 5, 4 → 2, 5 → 2 | `82c9a2c2`, `6ac033af` | `no_path`, disconnected walk edges |
| Exit 3 → 4, 3 → 5, 4 → 3, 5 → 3 | `65edd7ca`, `ed7e56a8` | `snap_failed`, unattached elevator links |

All four edges already occur in main's fallback list, and main's committed
navmesh paths contain neither direction for any of them. No new failing edge or
changed graph route is involved. The other 50 formerly suspect routes become
fully audited. This explains the count; it does not satisfy the strict
shrink-only acceptance rule. The audit classification and acceptance checks
are unchanged. Fixing these four unrelated paths needs its own source-backed
geometry work or an explicit acceptance ruling; this change supplies neither
an invented snap nor a baseline-reset exception.

A technical `oracle-ego` diagnosis confirmed the classification mechanism and
that a 48 → 56 increase cannot be offset against the suspect count's decrease.
The route identities and unchanged directed sequences above were established
by local public-data diagnostics after that diagnosis, rather than inferred
from the difference of eight alone.

The final low-tier scene measures 125 meshes, 16,239,546 geometry bytes and
1,605 step instances in the shared mesh. The high-tier geometry-lifetime
measurement remains 146 meshes and 16,286,922 bytes. Identity draw checks use
the measured 125/146 split; physics lists remain 442 walkables, two colliders,
three camera blockers and 14,906 walls. The high-tier lifetime oracle retains
its independent high-tier measurement rather than adopting the low-tier digest.
