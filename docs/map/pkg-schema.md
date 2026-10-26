---
area: pkg-schema
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-schema: station and POI data schema, parsing and validation

## What it does
The data contract for stations. gteki.station/0.1 is the schema version string (`SCHEMA_VERSION`, `packages/schema/src/index.ts:20`). Each station ships `station.json`, `graph.json` and `pois.json`, plus optional `tenants.json` (gteki.tenants/0.1). `parseStationFiles` runs a structural check (every tri-state field must be explicit), composes the files into one `StationBundle`, and then runs the truth rules in `validateBundle`. Any error means `ok: false` and no bundle, so bad data never reaches the router (fail closed).

## Main files and functions
- `packages/schema/src/index.ts:20` — `SCHEMA_VERSION`; `packages/schema/src/index.ts:23` — `Tri` (boolean or null, "UNKNOWN" is explicit).
- `packages/schema/src/index.ts:34-79` — `Source`: dataset date, validity, rights status (`RightsStatus`, line 32).
- `packages/schema/src/index.ts:119-132` — `Station`; `packages/schema/src/index.ts:136-156` — `Floor`.
- `packages/schema/src/index.ts:188-198` — `Node` (`NodeKind`, line 171).
- `packages/schema/src/index.ts:217-246` — `Edge`: mode, direction, paid, crossesFareBoundary, wheelchair, steps, hours, closed, verification, evidence.
- `packages/schema/src/index.ts:308-332` — `Poi`: names, aliases, connectorNodeIds (empty means not routable), displayPosition (never a routing target), approximatePosition, hours.
- `packages/schema/src/index.ts:364-370` — `Coverage`; `packages/schema/src/index.ts:375-401` — `Asset`.
- `packages/schema/src/index.ts:429-448` — `StationBundle`: the in-memory form every consumer receives.
- `packages/schema/src/index.ts:488-506` — `Tenant`, the store-brand directory entry.
- `packages/schema/src/parse.ts:317-334` — `parseStationFiles()`: the entry point all apps and tools use.
- `packages/schema/src/parse.ts:182-286` — `checkShape()`: structural check, on the `ShapeChecker` class (line 70).
- `packages/schema/src/parse.ts:289-307` — `composeBundle()`.
- `packages/schema/src/validate.ts:103-477` — `validateBundle()`: error and warning issues with a code, message and ref.
- `packages/schema/src/validate.ts:32` — `isCanonicalAssetPath()`; `packages/schema/src/validate.ts:480-486` — `dataFileFactsOnlySources()`.
- `packages/schema/src/hours.ts:13-20` — `parseHm()`; `packages/schema/src/hours.ts:26-48` — `isOpenAt()` (true, false or null).

## Data flow
- Station folder (`stations/shinjuku/gteki/station.json`, `graph.json`, `pois.json`, `tenants.json`) → `parseStationFiles` → `StationBundle`.
- Consumers: [[pkg-navigation]] (`createRouter`), [[pkg-search]] (`createSearchIndex`), [[pkg-scene-api]] (station scene types), the web app (`apps/web/src/registry.ts:79` and `:95`, `apps/web/stations-plugin.ts:116` and `:331`), station tools (`stations/shinjuku/tools/import-tenants.ts`, `stations/ikebukuro/pipeline/audit_assets.ts`), [[pkg-cli]] (`packages/cli/src/route.ts`), and Godot (`packages/godot/src/load-bundle.ts`, `packages/godot/src/export-reference.ts`).
- Imported by (non-test code): `apps/web/src` (about 30 files, including `apps/web/src/ui/app.ts`, `apps/web/src/explorer/explorer.ts`, `apps/web/src/merchant`), `packages/navigation/src`, `packages/search/src/search.ts`, `packages/cli/src/route.ts`, `packages/godot/src`, `stations/shinjuku/app`, `stations/shinjuku/tools`, `stations/shinjuku/data`, `stations/shinjuku/scene`, `stations/shinjuku/test`, `stations/ikebukuro/pipeline`, `stations/ikebukuro/preview`, `stations/ikebukuro/scene`.

## Tests CI runs
- `pnpm typecheck` then `pnpm vitest run --maxWorkers=2` (root-test, the full set). Schema tests are the *.test.ts files in `packages/schema/src`; `contract.test.ts` is the largest.
- One area locally: `pnpm vitest run packages/schema/src`, but run the full command above through `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.

## Pitfalls
- A missing tri-state field is an error, not an implicit null or false. Stations must state UNKNOWN explicitly.
- `displayPosition` and `Tenant` entries are never routing targets. Only `connectorNodeIds` make a POI routable.
- Data-file paths that point into gteki/ are rejected case-insensitively (commit 7770f4a9). Data files citing only facts-only sources are reported by `dataFileFactsOnlySources`.
- Hours readings dated after today are refused and hidden (commit 6625fb80).
- The schema is a shared contract: changing a field means station leads are consulted first.

## Related PRs and issues
- #477 printed shop hours and building-level rows (OD-32).
- #464 `Poi.approximatePosition` for search display only (#463).
- #456 tenant evidence accepts a reusable data source (#441).
- #419 optional store brand directory (`tenants.json`), with the fail-closed null check.
- #265 localized coverage gap text and area labels (#259).
- #256 authored marker for GTEki-written data files.
- #191 `PUBLISHED_UNDER_OWNER_OVERRIDE` rights value (#130).
