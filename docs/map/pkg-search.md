---
area: pkg-search
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-search: station, POI and store-brand search

## What it does
Name and alias search over one station's POIs, built once per bundle with `createSearchIndex`. Matching is Japanese-aware: NFKC, case folding, katakana to hiragana, long-vowel and punctuation folding, romaji aliases from the bundle, exit-number folding (号 and 號 to 番 before 出口), and dropping the station's own name from the front of a query. Store brands listed in a tenant directory (`tenants.json`) are extra texts on their store POI and rank below a direct match. Each hit says whether the POI is routable (`routable`, false for search-only POIs without a verified connector).

## Main files and functions
- `packages/search/src/search.ts:5-9` — `normalizeJa()`: the fold used for queries and the Godot goldens. Leave it unchanged.
- `packages/search/src/search.ts:16-18` — `searchKey()`: `normalizeJa` plus exit-number folding.
- `packages/search/src/search.ts:103-123` — `stripStation()`: drops the station-name prefix from a query.
- `packages/search/src/search.ts:126-150` — `fuzzyScore()`: subsequence fuzz (skipped for queries under 4 characters).
- `packages/search/src/search.ts:160-176` — `scoreText()`: scores one candidate text against a query form.
- `packages/search/src/search.ts:196-200` — `tenantMatch()`: turns a `Tenant` into a `TenantMatch`.
- `packages/search/src/search.ts:217-291` — `createSearchIndex()`: builds the index and returns the `search()` method.
- `packages/search/src/index.ts:25-36` — `SearchHit`: poi, score, matched, routable, optional tenant and moreTenants.
- `packages/search/src/index.ts:38-46` — `SearchOptions`: limit, categories, floorIds, lang.
- `packages/search/src/index.ts:47-49` — `SearchIndex` interface.

## Data flow
- Bundle POIs and tenants (from `parseStationFiles`, see [[pkg-schema]]) → `createSearchIndex` → `search(query, opts)` → `SearchHit[]`.
- The web app builds the index at `apps/web/src/ui/app.ts:326` and shows hits in the search combobox. A chosen hit's `poi.connectorNodeIds` become route endpoints for [[pkg-navigation]] `routeBetween`. A hit with `routable: false` cannot be a route endpoint.
- Godot: `packages/godot/src/search-query.ts` (`runSearch`, line 11) and `packages/godot/src/export-search.ts` (`buildSearchExport`, line 52) use this package's `createSearchIndex` and `normalizeJa`. The GDScript HUD reads the exported index and does not port `normalizeJa`.
- Imported by (non-test code first): `apps/web/src/ui/app.ts`, `apps/web/src/ui/tenantDisplay.ts`, `stations/shinjuku/app/src/main.ts`, `stations/shinjuku/app/src/search-card.ts`, `packages/godot/src/search-query.ts`, `packages/godot/src/export-search.ts` (relative import). Tests: `apps/web/src/search-stations.test.ts`, `apps/web/src/ui/app.brand-search.test.ts`, `apps/web/src/ui/app.merchant.test.ts`, `apps/web/src/ui/app.notes.test.ts`, `stations/shinjuku/test/search-truth.test.ts`, `stations/shinjuku/test/tenant-search.test.ts`, `stations/ikebukuro/scene/search.test.ts`, `stations/ikebukuro/scene/tenants.test.ts`, `stations/ikebukuro/scene/routing.test.ts` (relative import), `packages/godot/src/data-bridge.test.ts` (relative import).

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). Search tests are the *.test.ts files in `packages/search/src`.
- One area locally: `pnpm vitest run packages/search/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.

## Pitfalls
- Tenant hits are never routing targets. The store POI is the target, and its `connectorNodeIds` decide routability.
- A search-only POI (no connector) still appears as a hit with `routable: false`. Do not hide it. Routing refuses it as origin or goal.
- The index is built from the bundle once; a changed `tenants.json` needs a rebuild of the bundle.
- `normalizeJa` is mirrored by Godot goldens. Changing it changes Godot results too.
- `Poi.approximatePosition` (schema) is for display in search only, never a route target.

## Related PRs and issues
- #201 Ikebukuro search aliases for gates and exits, with golden search test.
- #288 core table test for real Shinjuku POIs.
- #416 show search-only POI notes in results and the no-route card.
- #419 and #425 tenant search for department stores (store brand directory).
- #424 and #509 Shinjuku search-only line POIs; #517 CLI coverage of them.
- #463 and fe025090 export approximate positions; label unverified floors.
- #528 end-to-end department-store brand search test.
