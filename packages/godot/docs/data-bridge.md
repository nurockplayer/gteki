# Godot data bridge (G-3: search + guided route)

Godot implements no search ranking and no routing. It reads JSON produced by the TypeScript packages for
`stations/ikebukuro` and `stations/shinjuku`. All commands run from the repo root with `pnpm tsx`.

## Search

Decision: **(a) precomputed index**, plus **(b) a ground-truth CLI** as the oracle and fallback.

- The index side needs no port: every name and alias is normalised in TypeScript (`normalizeJa`) and exported as
  `keys[].norm`.
- The query side must be normalised in GDScript. `normalizeJa` is five small steps (below), so it is portable, with one
  caveat: Godot has no NFKC, so the port folds the common compatibility characters itself (full-width ASCII,
  half-width katakana with dakuten/handakuten). Exotic compatibility characters (circled digits, ㈱, ...) are not covered;
  `search-query.ts` is the answer for anything the port cannot reproduce.
- Ranking: the exact/prefix/suffix/contains tiers (100/80/70/60, +5 when routable) are simple to mirror.
  The TS index also has subsequence and multi-token matching (scores <= 40); those exist only in `search-query.ts`.

```
pnpm tsx packages/godot/src/export-search.ts stations/ikebukuro out/ikebukuro.search.json
pnpm tsx packages/godot/src/search-query.ts stations/ikebukuro "35番出口" --limit 5
```

### `normalizeJa` (id `gteki.search.normalizeJa/1`)

1. NFKC normalise. 2. lower-case.
3. Katakana U+30A1..U+30F6 become hiragana (code point minus 0x60).
4. Delete whitespace, every Unicode punctuation (`\p{P}`), U+2212, U+301C, U+FF5E, `~`, `<`, `>`, and the long-vowel mark U+30FC.

Golden vectors: `packages/godot/src/search-goldens.json`.
`normalize[]` is `{input, normalized}`; `queries.<station>[]` is `{query, normalized, top:[{poiId, score}]}`, the top hits
of the TS index on the real data. `data-bridge.test.ts` fails if either drifts from `@gteki/search`, so a Godot test can
read the file and compare.

### `gteki.search/0.1` (export-search.ts)

```
{ contract, stationId, stationNames, synthetic, normalization:{id,steps[]}, scoring:{exact,prefix,suffix,contains,routableBonus,note},
  floors:[{ id, displayNames[], sourceLabels[], renderElevationM, elevationKnown }],
  entries:[{ poiId, category, floorId|null, names:{ja,en,"zh-Hant"} (null when absent),
             routable, nodeIds[], paid: true|false|null,
             position: { source:"connector_node"|"display_position", nodeId|null, renderer:[x,y,z], zKnown } | null,
             approximate: { uncertaintyM, navigationUse:"NOT_FOR_ROUTING", floor:"UNVERIFIED" } | null,
             keys:[{ lang, text, norm }], evidence:{ sourceIds[], method, checkedDate, note|null }, notes[] }] }
```

Truth rules: `routable` is true only when the data lists connector nodes (search-only POIs stay selectable but must
not be routed to). `paid: null` is unknown. `zKnown: false` means the height is symbolic. No verified/confirmed flag is
exported: `evidence` is passed through as the data states it. `renderer` is Godot/Y-up (`enuToRenderer`).
`approximate` carries only the ± radius and the two fixed markers for an approximate, search-display-only point
(#463): it has no coordinates, and `position` stays null for such a POI.

### `gteki.search.result/0.1` (search-query.ts)

`{ contract, stationId, query, normalized, hits:[{ poiId, score, matched, routable, nodeIds[] }] }`. Exit 0 with
`hits: []` when nothing matches; exit 2 on bad arguments.

## Route

```
pnpm tsx packages/cli/src/route.ts stations/ikebukuro g_jr_c2 x35                       # node ids
pnpm tsx packages/cli/src/route.ts stations/ikebukuro jr-central-gate-2 exit-35 --from-poi --goal-poi
pnpm tsx packages/cli/src/route.ts stations/shinjuku poi:platform:oedo poi:exit:1 --from-poi --goal-poi
```

Options as before (`--step-free --unpaid-only --strict-hours --today YYYY-MM-DD`) plus `--from-poi` (origin is a POI id)
and `--goal-poi` (the single goal is a POI id). POI endpoints resolve to connector nodes through
`routeBetween` in `@gteki/navigation`, the same function the web explorer uses; a POI without connectors fails with
`unknown_start` / `unknown_goal`.

Output `gteki.route/0.1`: `{ contract, stationId, result, path[], polyline[], instructions:{ja[],en[]} }`.

- `path[]`: `{ nodeId, enu, renderer:[x,y,z], heightSymbolic }` per route node.
- `polyline[]`: edge-geometry points `{ x, y, z, zKnown, stepIndex, floorId, renderer:[x,y,z] }`; `stepIndex` is -1 for the
  start point; `zKnown: false` points must be drawn as symbolic heights (all of Shinjuku).
- `instructions.<lang>[]`: `{ kind, text, stepIndexes, distanceM, vertical, toFloorId, ... }`, `kind` from `start` to `arrive`.
- Exit codes: 0 route found; 1 no route (`result.ok:false`, empty `path`/`polyline`, empty instructions, draw nothing);
  2 bad arguments or invalid station files (nothing on stdout).
- Shinjuku routes carry an `hours` unknown (no operating hours in the data): show it, and do not present the route as
  time-verified.

Tests: `packages/godot/src/data-bridge.test.ts` and `packages/cli/src/real-stations.test.ts`.
