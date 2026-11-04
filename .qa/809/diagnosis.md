# #809 part A diagnosis — Ikebukuro 64 unvalidated routes + Exit 26

Measured 2026-11-04 22:50 – 2026-11-05 02:05 JST in disposable OrbStack containers against
`origin/main` `8c7b3bef`, measurement bake (`cellSizeM 0.1, agentRadiusM 0.3, walkableClimbM 0.4,
tileSize 256, withGreybox`). Audit JSON kept in `.qa/809/{diag,after,force}/` (local, not committed).

## The 64 are not join failures

Outcome of 1056 audited directed pairs: complete 992, incomplete 64, suspect polyline 0.
`invalidJoinRoutes` is 0 and every one of the 64 fails at a step entry, not at assembly: the entry
for `ne_j__x26` has no points, `reason: snap_failed`, `connectivity: link_unattached`. Zero join-gap
records, and no other edge in `failureEdges` (`failureClasses` has one line:
`stairs | snap missing | link_unattached | snap_failed`).

The count is arithmetic: Ikebukuro has 36 POIs on 33 distinct connector-node sets, so 33 × 32 = 1056
audited directed pairs. Exit 26 (`x26`) is one node set with a single edge, so exactly 32 × 2 = 64
pairs use `ne_j__x26` — those are the 64 incomplete routes.

## Why #783's Shinjuku fix does not apply

#783 canonicalised two stored representations of one final-mesh snap at a join (a 1.907e-6 m
difference against the unchanged 1e-6 equality) and removed 8 Shinjuku routes whose only defect was
that endpoint mismatch. Ikebukuro has no join defect: `invalidJoinRoutes` is 0, and the canonicaliser
runs only after every step has points. The route never reaches assembly because the bake never
admitted the Exit 26 link.

## Layer 1 — admission rejected a segment the guide never draws

`validateLinkSnap` (`packages/godot/src/navmesh-links.ts`) tests the floor under the snapped point,
then wall hits and floor gaps along the authored-node → snap segment. That segment is not drawn: the
link path is `[snap, ...built connector interior..., snap]` (vertical branch of `edgePath`,
`packages/godot/src/navmesh-audit.ts`). Provenance confirms this check, not the query, rejected it:
`links.failed: [{edgeId: ne_j__x26, reason: unsafe_snap}]`, `snapRejections {floor: 0, wall: 1}`,
`linkAttachmentDiagnosis` all zero. Bake-only probe `.qa/809/diag/x26.json`: both endpoints snap onto the navmesh (`ne_j` (110, 26.24,
-108) → (110, 26.34, -108); `x26` (101, 32.246, -92) → (102.63, 91.55, 32.14)) and both pass the
endpoint-floor check. The wall is crossed by the authored approach, not by the drawn shape.

## Layer 2 — the drawn shape clips at the street mouth, and no path exists anyway

The drawn shape (37 built points) audits with 1 wall hit: sample 53 of 55, 0.75 m before the street
snap, at (101.92, 91.85, z 32.61) — 0.49 m above the walk line (z 32.12), unnamed collider;
`offFloor` and `noFloor` are 0. Forcing the link through admission (`.qa/809/force/`) exposes the
second, independent defect: the link attaches (`link_attached`, both ends snapped, `links.failed`
empty), yet all 64 routes still fail with `reason: no_path` — Detour cannot route across the
admitted connection. Routes stay 992/64. Admission alone cannot close this bucket, and admitting it
while the drawn shape clips a wall would grow `ne_j__x26.connectorWallHits` instead of shrinking.

## What this branch changes

`validateLinkEndpoint` (new) keeps the floor test on the snapped endpoint; `validateLinkSnap`
delegates to it, and the bake hands `verticalLinkCandidates` the endpoint check instead of the whole
authored-approach check, then admits a candidate only when the drawn shape (`connectorShape`: snapped
ends + built connector interior) audits with no wall hit, no off-floor and no missing floor.
`connectorShape` is the helper the audit already uses, so admission and classification measure the
same polyline. Gates keep their #791 directed admission and are excluded from the shape filter.
After a full regen of both stations, `.qa/809/compare.py` is SHRINK-ONLY PASS with no counter moving
in either: Ikebukuro 992/64/0, Shinjuku 132/48/58 suspect, `unvalidatedJoins` 64 and 48, every clip
field, fallback and routable count unchanged.

## r2 measurement — link shape follows the built landing

r2 self-exclusion variant (2026-11-05 02:5x JST, `.qa/809/after`, kept in `after-r1` order):
excluding the edge's own connector mesh from the wall check left Ikebukuro at 992/64 and the
fallback list unchanged, so it changed nothing measurable; the Lead ruled it out because it hides
real clipping for every vertical edge, and it is not shipped.

The shipped change keeps the built connector's end points in `connectorShape` (`[snap, built…,
snap]` instead of dropping the first and last built point), so the drawn link follows the landing
instead of cutting diagonally from the last interior point to the snap.

## Follow-ups (unfixed)

1. `ne_j__x26` layer 2: why Detour finds no path across the admitted link, and whether the
   street-mouth collider the drawn shape clips is real geometry or a body-height lintel.
2. Whether the Exit 26 snap should land on another polygon (it moves 1.7 m from the authored node);
   needs the station's geometry evidence, not a threshold change.
