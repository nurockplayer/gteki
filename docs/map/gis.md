---
area: gis
owner: gteki-fa
updated: 2026-10-26 JST
---
# GIS data factory (tools/gis)

## What it does
Isolated TypeScript/ESM package with its own pnpm workspace (Node 26). It acquires bounded public sources, inspects them, and converts them into private outputs: station-frame GLBs, candidate graphs, and public receipts under docs/gis. Every normalized object is UNVERIFIED; candidate graphs are `routable: false`. Nothing it produces reaches stations/** today: the app reads only the station JSON (station.json, graph.json, pois.json under stations/<id>/gteki), which GIS reads read-only and hashes. Entry point is `pnpm gis` (tools/gis/src/cli.ts). The private store is outside the repo (env GTEKI_GIS_STORE, default under the home directory).

## Main files and functions
- `tools/gis/src/cli.ts:44-139` — command switch; S03 cases at 102-115 (s03-nav-graph, route at 106-110, publish at 111-115).
- `tools/gis/src/common.ts:78-80` — getStoreRoot(): private store location.
- `tools/gis/src/common.ts:146-168` — getStoredSource(): returns a stored file only after its sha256 matches the acquisition record.
- `tools/gis/src/acquire.ts:38-56` — loadSources(): reads the manifest (tools/gis/sources/sources.yaml).
- `tools/gis/src/acquire.ts:67-134` — downloadUrl(): streaming download into the store, raw/<sha256>/<filename>.
- `tools/gis/src/acquire.ts:270-331` — acquireSources(): entry for the acquire command.
- `tools/gis/src/rights.ts:19-52` — evaluateRights(): CLEARED_WITH_CONDITIONS / RESTRICTED / UNKNOWN per source.
- `tools/gis/src/citygml.ts:201-475` — scanCityGml(): CityGML inventory (bldg, tran).
- `tools/gis/src/convert.ts:38-133` — convertCityGmlFile(): CityGML to GLB in the store.
- `tools/gis/src/station-enu.ts:63-74` — stationEnuProjector(): horizontal ENU projection; `tools/gis/src/station-enu.ts:137-185` createStationEnuFrame() writes frames.
- `tools/gis/src/context-window.ts:148-166` — buildContextWindow(): union of discs around the station origin and exit nodes of stations/<id>/gteki/graph.json.
- `tools/gis/src/context.ts:242-475` — buildContextGlb(); `tools/gis/src/context.ts:561-632` contextGlb(): context-glb entry.
- `tools/gis/src/context-overlay.ts:168-231` — selectLayer(); `tools/gis/src/context-overlay.ts:270-333` writeOverlayGlb(): 2D railway/border overlays.
- `tools/gis/src/literals.ts:323-347` — checkLiterals(): guards against leaking source values into committed docs.
- `tools/gis/src/s03-transform.ts:551-597` — checkInternal(): Check A/B of the S03 drawing transform.
- `tools/gis/src/s03-transform.ts:767-788` — mutualNearest(): E27 to S03 floor-compatible matching; `tools/gis/src/s03-transform.ts:811-919` s03TransformCheck() is the entry.
- `tools/gis/src/s03-paths.ts:106-170` — buildPaths(); `tools/gis/src/s03-paths.ts:223-280` s03Paths(): path segments, CRS UNKNOWN.
- `tools/gis/src/s03-positions.ts:90-142` — joinS03Pois(); `tools/gis/src/s03-positions.ts:242-263` representativePoint(); `tools/gis/src/s03-positions.ts:360-437` s03Positions().
- `tools/gis/src/s03-nav-graph.ts:178-262` — buildNavGraph(): held walk graph from v5_nav nodes and links, with a reason code on each edge.
- `tools/gis/src/s03-nav-graph.ts:96-105` — writeHeldDocument(): writes only under the store's out/s03 and refuses paths that escape the store.
- `tools/gis/src/s03-nav-graph.ts:359-420` — s03NavGraph(): entry; private document plus public receipt.
- `tools/gis/src/s03-nav-graph-route.ts:81-88` — loadHeldGraph(); `tools/gis/src/s03-nav-graph-route.ts:121-147` shortestPath(); `tools/gis/src/s03-nav-graph-route.ts:241-276` s03NavGraphRoute(): held diagnostic routing, `--held-diagnostic` only.
- `tools/gis/src/s03-private-seam.ts:14-114` — buildPrivateSeam() / s03PrivateSeam(): PRIVATE-tier additions and E27 stitches; writes only to the private repo via --out, refuses output under this git repo, and emits no public receipt.
- `tools/gis/src/s03-nav-graph-publish.ts:14-26` — publishBlockers(): lists every blocker (reason-code counts, floor tie not VERIFIED, missing or malformed HOLD sign-off, sign-off for another run).
- `tools/gis/src/s03-nav-graph-publish.ts:33-41` — s03NavGraphPublish(): refuses without `--publish`, then always throws. Even with every gate clear it says the station-graph merge (S03 to E27 seam) is not built.

## Data flow
- Sources: tools/gis/sources/sources.yaml (manifest, about 89 sources) and tools/gis/sources/context/<station>.json (window configs) → acquire → store raw bytes → scan/convert → store out/ (GLB, provenance, candidate graph, inventory). Shared inputs: tools/gis/frames/*.json (ENU frames), tools/gis/codebooks/*.json (walk-network and POI-literal allowlist).
- S03 chain: tokyo-s03-zip (ZIP, sha-checked) → readNavGraphMembers (s03-nav-graph.ts:78; Path GeoJSON members excluded) → buildNavGraph → private held document under out/s03 + public receipt in docs/gis/s03. Route: loadHeldGraph → s03NavGraphRoute → private route document + receipt in docs/gis/s03.
- Publish: s03NavGraphPublish → loadHeldGraph → publishBlockers, with readSignoff (docs/gis/s03/hold-signoff.json, currently absent) → throws. Nothing writes stations/**; the only output the app would use is stations/shinjuku/gteki/graph.json and related files, read through the package exports in stations/shinjuku/package.json. The E27 base data is built by stations/shinjuku/tools/import-e27.ts, not by GIS.
- Station reads: station-enu, context-window, osm-coverage and s03-* read stations/<id>/gteki/station.json and graph.json. A mismatched origin or z fails the run.

## Tests CI runs
From tools/gis (gis-test.yml, Node 26; PRs with no path filter, push to main on tools/gis/**):
- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`
Local equivalent through the host rule: `orb-test --heavy -- sh -c "cd tools/gis && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test"`.
Not in CI: `pnpm test:real` (GTEKI_GIS_REAL=1, reads the multi-GB external store, single worker). Run commands one at a time; concurrent pnpm invocations relinked node_modules.

## Pitfalls
- The S03 publish gate always refuses (#557). A malformed sign-off file or a null `reason_codes` throws instead of being listed as a blocker; it still fails closed (oracle review P1s, follow-up noted in the PR).
- The sign-off needs a role slug, a +09:00 timestamp, an https record URL and the same run id. The file does not exist yet.
- Path GeoJSON members are never read: their frame is UNKNOWN, and passing them through the affine pair would transform them twice.
- S03 CRS is UNKNOWN and floor labels are UNVERIFIED. compatibleFloors() treats E27 ordinal 0 as matching S03 ordinal 1.
- tools/gis/test/context.test.ts is about 120 KB: use grep -n and sed -n ranges, not a full read.
- Real-data runs write to the external store; never commit store contents. Receipts in docs/gis hold hashes and counts only (literal guard).
- Ikebukuro street z 32.5 and Shinjuku z 0 are re-read from station.json on every run.

## Related PRs and issues
- #557 S03 publish gate (refuses on any reason code, unsigned HOLD or unverified floor tie).
- #553 S03 floor order from level id and printed z.
- #548 S03 nav graph Check A per node.
- #550 S03 nav graph reason codes (CRS, device, one-way, self-loop); #547 S03 v5_nav CRS verified.
- #546 and #544 S03 reason-code desk pass and gap table.
- #543 held S03 route behind --held-diagnostic (PR B); #542 held walk graph from v5_nav (PR A).
- #510 s03-paths segment transform (WP7); #505 S03 CRS evidence and path handoff.
- #463 approximate S03 gate and transfer positions (WP8).
- #430 S03 drawing-transform evidence check (WP7); #171 Shinjuku POI next gaps.
- #59 CI for tools/gis; #45 bounded vitest workers and real-store gating.
- #18 Lane D PLATEAU/Hokonavi ingestion and GLB factory; #34 rights evidence S10, S03, related layers.
- #147 non-POI source literals; #508 Toei CSV rights and POI mapping; #392 Shinjuku landmarks; #328 KSJ N02 railway overlay.
- Docs: docs/gis/README.md, docs/gis/HANDOFF.md, docs/gis/s03/paths-import-contract.md, docs/gis/s03/positions-import-contract.md, docs/gis/decisions/2026-10-24-s03-positions-ruling.md, docs/gis/rights/README.md.
