# GIS review fix dispositions

## Phase 2 (historical baseline)

Implementation and execution evidence for the lead's Codex REQUEST_CHANGES review. The lead owns the next independent review and acceptance. This document is not a new review verdict. No Phase 2 code or data was submitted to ChatGPT, a browser review, Oracle or Ego-lite.

| Finding | Implementation disposition | Hand-written synthetic regression |
| --- | --- | --- |
| 1 / P1: enclosing-object metadata leakage | FIXED. Semantic scopes exist independently of IDs. Direct object properties stay on their object; polygon names do not become Room names. Anonymous objects retain null source identity with a separate processing key. Immediate anonymous parent identity also remains null. Nested official URO property subtrees retain their raw values. | `citygml.test.ts`: `isolates anonymous semantic ownership and geometry names from identified parents`; `keeps blank IDs and an immediate anonymous parent unknown instead of borrowing an ancestor ID`. `geometry.test.ts`: `P1-1 exports an unidentified installation with null native identity without relabeling its Room`. |
| 2 / P2: signed surfaces and references | FIXED. Two SAX passes index same-document targets, distinguish definitions from geometry uses, compose surface signs, populate referenced Room bounds and report unsupported targets. Selected boundary/opening geometry keeps its own orientation; duplicate solid uses remain in provenance without drawing a second shell. | `geometry.test.ts`: `P2-2 preserves boundary winding separately from a reversed Room solid reference through GLB readback`. `citygml.test.ts`: `composes nested OrientableSurface signs and rejects unsupported signs`; ownership fixture includes missing polygon and solid targets. |
| 3 / P2: default/unrelated namespaces | FIXED. Namespace-aware SAX uses exact official module URI plus local type. Qualified spelling is provenance. Default building namespace converts; unrelated domains and the wrong official CityGML module are excluded. | `geometry.test.ts`: `P2-3 converts equivalent default namespaces and excludes namespace lookalikes`; CityGML ownership fixture also includes an official vegetation-module Room lookalike. |
| 4 / P2: graph export membership | FIXED. Inspection classification is carried into candidate export. A null-geometry source node stays a node and its geometry stays UNKNOWN. | `network.test.ts`: `preserves null-geometry node membership in candidate graph export`. |
| 5 / P2: native link IDs | FIXED. Shared native-identifier resolution drives topology, duplicates and normalized records, including `linkID`. Generic ID fallback does not change a LineString into a node. | `network.test.ts`: `uses linkID consistently for duplicate detection, topology completeness, and normalized export`; generic-ID LineString regression. |
| 6 / P2: dictionary/tool input identity | FIXED. Inventories and sidecars retain dictionary archive and member SHA-256 values. Conversion identity includes the dictionary semantic digest, acquisition/member provenance, complete frame/filters and tool-input SHA. Full inventory detail is content-addressed so earlier detail pointers are retained. | `geometry.test.ts`: `P2-6 retains separate artifacts and dictionary member provenance when semantic inputs change`; it writes/reads both GLBs and sidecars, checks changed labels, preserves the first bytes and checks tool identity changes the run path. |
| 7 / P2: CSV category distributions | FIXED. Category selection includes all supported literal mapping headers, including `rt_struct` and `lev_diff`, with values/frequencies retained. | `network.test.ts`: `reports categorical distributions for supported literal MLIT headers rt_struct and lev_diff`. |
| 8 / P3: blank bbox coordinates | FIXED. CLI rejects blank tokens before numeric conversion. Both conversion entry points require exactly four finite numeric coordinates and valid min/max order. | `filters.test.ts`: three `P3-8` cases cover blank CLI tokens, malformed values and direct conversion calls before source I/O. |
| 9 / P3: prototype-named categories | FIXED. Category frequencies use Map and serialize source-controlled keys as ordinary own properties. | `network.test.ts`: `counts prototype-named source categories as ordinary data values`, including JSON roundtrip for `constructor` and `__proto__`. |

Additional requirements:

- **A:** `gsi-bl2xy-controls.json` records the two official responses supplied by the lead, exact URLs, date and axis mapping. Offline tests and CRS reports compare each E/N coordinate with the 0.0005 m tolerance. The former independent-control limitation is replaced with measured control evidence.
- **B:** `overlap` computes normalized geographic bbox relations and EPSG:6677 sampled-boundary distances. It preserves unknown CRS instead of assuming the CSV datum. Gap HOLD items are computed from these JSON reports. Synthetic overlap/segment-distance and gap-HOLD tests cover this behavior. Distances are explicitly numerical boundary approximations, not feature distances.
- **C:** Door object counts remain distinct from physical opening counts. Individual versus per-room aggregate representation stays UNKNOWN when literal source evidence does not decide it.
- **D:** Earlier receipts/reports are under `history/`; the report index links one current real-run receipt and one current validation receipt. `review.json` is sanitized and explicitly superseded by the lead review. Oracle bundles were deleted from `tools/gis/out/`.
- **E:** Use the current `validation.json`, `real-run.json` and generated summary for actual exit codes, test counts and before/after real-data numbers. Historical failures remain history. All current evidence is bound to the tool-input digest recorded there.

The earlier GeoJSON mapping-table presentation omission is also repaired: member and combined archive inventories now persist `mapped_fields`, covered by a synthetic regression. All normalized records remain UNVERIFIED and candidate graphs remain non-routable. Unsupported geometry references are reported, not guessed or fetched.

## Generated execution readback

Candidate tool-input SHA-256: `b879ca0ffd4f7ca550dcef970fae32148f45c98ca58539a745afab187b23e48e`.

62 default tests and 3 real tests passed. All 5 required validation commands, all 16 ordered real-run CLI invocations and the summary command exited 0. All 13 acquisition hashes are unchanged from Phase 1. All 3 referenced Rooms now have polygons and bounds.

| Source | Inventory polygon uses before → after | Full GLB polygons before → after | Full GLB triangles before → after |
| --- | ---: | ---: | ---: |
| plateau-13104-ubld-53394536 | 65013 → 79363 | 65013 → 65013 | 148950 → 148950 |
| plateau-13116-ubld-53394576 | 58761 → 98173 | 58761 → 58761 | 64811 → 64811 |

Full export preserves boundary/opening geometry and records signed solid usage separately; coincident selected solid uses are not drawn twice. See per-object sidecars for orientation and disposition.

Maximum independent GSI coordinate error: 0.000048494905058760196 m (required ≤ 0.0005 m).

ikebukuro: 2 layers, 1 bbox pairs. UNKNOWN, metric separation UNKNOWN.
shinjuku: 21 layers, 210 bbox pairs. hokonavi-oedo-shinjuku-network-geojson:link.geojson: DISJOINT, 186.44262525628636 m approximate boundary separation; hokonavi-oedo-shinjuku-network-geojson:node.geojson: DISJOINT, 186.4426252562791 m approximate boundary separation.

Implementation is ready for the lead’s review. All geometry/network verification states remain UNVERIFIED.

Temporary scope deviation: Intermediate direct Vitest checks created only root node_modules/.vitest-cache and .vite caches. Removed those self-generated caches; no root node_modules remains. Required validation used pnpm --dir tools/gis commands.

## Phase 3

The second fresh lead Codex review confirmed the original nine cases closed and requested fixes for the five cases below. The implementation remains uncommitted; the lead owns the next independent review. No external review service is used in this pass. Phase 2 reports and receipts are retained under `history/phase2/`.

| Finding | Targeted fix | Synthetic regression test names |
| --- | --- | --- |
| 1 / P2: unclassified features become edges | Shared node/link/unknown classification is retained through export. Unknown polygons, unidentified null geometry, malformed IDs and conflicting evidence stay in `other_features`; generic native IDs remain preserved without assigning graph membership. | `network.test.ts`: `exports polygon, unidentified, and conflicting GeoJSON features as unknown and excludes them from topology` |
| 2 / P2: generic text becomes floor evidence | Explicit floor forms and a narrow dedicated-label field list replace generic descriptive-word matching. Each literal value is retained; semantic presence counts objects, not multiple labels on one object. | `citygml.test.ts`: `reports floor labels only from literal floor forms or dedicated fields`; standalone `B2` and three Japanese floor-form and descriptive-word cases (synthetic inputs, not quoted here); two literal names on one object |
| 3 / P2: explicit topology falsely absent | Namespace-qualified GML mathematical topology is observed independently of renderable semantic features. Mathematical presence is separate from unsupported navigable interpretation, which remains UNKNOWN; no navigation edges are generated. | `citygml.test.ts`: `records GML mathematical topology while keeping navigable connectivity unknown` |
| 4 / P2: impossible geographic bbox accepted | Validate longitude/latitude ranges after the declared axis normalization and require finite projected coordinates. Invalid metric evidence stays UNKNOWN without swapping axes. | `overlap.test.ts`: `phase 3 finding 4 keeps impossible geographic coordinates UNKNOWN without swapping axes`; `phase 3 finding 4 refuses non-finite projected coordinates as metric evidence` |
| 5 / P3: Japanese link-ID alias omitted | GeoJSON and CSV identifier alias lists derive from the same supported definitions, including `リンクID`. | `network.test.ts`: `shares every supported node and link identifier alias across CSV and GeoJSON reports` |

Gap packets now expose literal floor-label evidence and separate mathematical topology from navigable connectivity. See the current `validation.json`, `real-run.json`, `real-data-summary.json` and `phase3-handoff.json` for execution results and comparisons with Phase 2. All output verification states remain UNVERIFIED; passenger-routing HOLDs remain in force.

### Phase 3 execution readback

Final tool-input SHA-256: `4b67d0bf4bd9d8ef9c8244416ce4f2c537e2307f6ac04bc151a1fae091f412fe`.

Frozen install, typecheck, 74 default tests, 3 real tests and offline verification all exited 0. All 16 full real-run CLI invocations and summarize exited 0. The 13 acquisition hashes are unchanged from Phase 2.

| Station | floor_labels before → after | connectivity_topology before → after | Inventory geometry totals |
| --- | --- | --- | --- |
| ikebukuro | PRESENT (1) → PRESENT (1) | ABSENT_IN_FILE (0) → ABSENT_IN_FILE (0) | unchanged |
| shinjuku | UNKNOWN → UNKNOWN | ABSENT_IN_FILE (0) → ABSENT_IN_FILE (0) | unchanged |

Both real files have zero observed GML mathematical topology elements and navigable connectivity remains UNKNOWN. Ikebukuro’s retained literal floor-label evidence is the source-native name in floor_label_observations; Shinjuku has no explicit floor-label observation. The gap packets expose this evidence and the separate topology interpretations.

ikebukuro: 2 layers / 1 pairs; pair tables unchanged, complete overlap JSON bytes unchanged from Phase 2.
shinjuku: 21 layers / 210 pairs; pair tables unchanged, complete overlap JSON bytes unchanged from Phase 2.

6 current GLBs were re-read by conversion validation; their SHA-256 values and polygon/triangle/node counts match Phase 2. Conversion paths change because tool identity is an input. Maximum current GLB bbox error: 0.0000054997890401864424 m.

hokonavi-ikebukuro-walk-node-csv: 1887 nodes, 2196 edges, 0 other features in the real acquired files.
hokonavi-oedo-shinjuku-network-geojson: 233 nodes, 263 edges, 0 other features in the real acquired files.

Current receipt and comparison details: `phase3-handoff.json`. Review state: AWAITING_LEAD_REVIEW. No commits, pushes, PRs or external review requests were made.
