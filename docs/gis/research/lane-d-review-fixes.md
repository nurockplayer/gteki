# Lane D reviewer fix passes

Current second-pass `tool_input_sha256`: `f596d193bb926e14064cba90c9b6f27a480eafdba61e612f7f87b7bdc3df8228`. See the second-pass sections below for current results and the complete file list.

## First fix pass (historical)

First-pass `tool_input_sha256`: `02596f248227c4c6f140f2bc8797d6d574e018f86ca2001a24c36359bc44015e`. The sections below record that pass; the second fix pass is recorded at the end of this document.

All three P2 findings are fixed. This pass added 57 regression/control cases: the unit suite increased from 96 to 153 passing tests. The six real-data tests also passed, with none skipped. All requested commands exited 0. No commit or push was made. `docs/gis/HANDOFF.md` is byte-identical to the starting worktree.

## Fixes

1. **Prototype-name codes:** codebook field, label and rank-mapping lookups use own properties. Label entries must have an own string/null label; rank mappings must be nonempty arrays of valid rank letters. `constructor`, `__proto__` and `toString` remain undefined codes and not-checkable rank components. Method and weekday labels also exclude inherited entries.

2. **Unavailable identifiers:** R1 joins exclude missing, null, blank, boolean, container, non-finite and unsafe integer identifiers. Both nodes and links expose `unavailable_ids: {csv, geojson}`; unavailable IDs do not enter duplicate or unmatched-ID counts. Valid literal identifiers, including explicit text `undefined` and `null`, remain available.

3. **Numeric input:** a shared decimal parser accepts finite numbers or explicitly validated signed decimal strings (including decimal exponent notation). Booleans, arrays, objects, blanks, null/missing values, hexadecimal strings and non-finite values are skipped/non-comparable. R1 numeric attributes never fall back to text equality; row and per-field non-comparable counters are explicit. Node coordinate equality uses the same parser on both sides.

## Additional audited instances

- `attributes.ts`: replaced broad string conversion in code/rank decoding and literal distributions; hardened floor numeric counts, endpoint-floor identifier joins, route-structure selection and in/out labels. Invalid containers cannot become real codes or endpoint keys.
- `coverage.ts`: acquired-coverage lookup excludes inherited composite keys. Catalog city/mesh values and containment floor/in_out/route-structure labels require literal scalars; container route codes cannot enter rt_struct 5/7 counts.
- `mesh.ts`: mesh-code validation first requires a string, preventing implicit regular-expression coercion of arrays/objects. Remaining numeric conversions follow the mesh grammar; formatting conversions use computed integers.
- `r1.ts`: shared-field reads and ID/coordinate maps use own properties and validated scalar identifiers; numeric coordinate equality is guarded in addition to attribute equality.
- `overlap.ts`: removed unnecessary `String(key)` from the fixed acquired-layer map and retained tuple types. Its keys are fixed literals; this was cleanup, not another data-derived vulnerability.
- New parts of `network.ts`: inspected the Lane D additions; no further unsafe data-derived lookup or `Number()`/`String()` coercion was found. This fix pass did not edit `network.ts`.
- Remaining `Number()` in the numeric-floor decoder follows its explicit decimal grammar. The helper converts only validated decimal strings or finite numbers. No unguarded codebook/mapping lookup on source codes remains.

## Exact test names

Parameterized placeholders below are Vitest test-definition names.

| Test file (under `tools/gis/test/`) | Test name | Cases |
| --- | --- | ---: |
| `attributes.test.ts` | `treats prototype-name code %s as undefined in decoding and not-checkable in every rank component` | 3 |
| `attributes.test.ts` | `rejects malformed own codebook labels and rank mappings` | 1 |
| `attributes.test.ts` | `does not inherit labels for method or weekday digits` | 1 |
| `attributes.test.ts` | `keeps nonnumeric floor %j unknown and container codes undefined` | 6 |
| `attributes.test.ts` | `excludes invalid endpoint identifiers from literal floor joins` | 1 |
| `geodesic.test.ts` | `skips non-decimal distance: $name` | 13 |
| `geodesic.test.ts` | `accepts finite decimal distance %j` | 4 |
| `r1.test.ts` | `excludes missing, null and blank %s identifiers and counts each side` | 2 |
| `r1.test.ts` | `excludes container, boolean and non-finite %s identifiers` | 2 |
| `r1.test.ts` | `counts non-comparable numeric attributes and coordinates: $name` | 13 |
| `r1.test.ts` | `accepts decimal strings without equating invalid nonnumeric attributes or inherited fields` | 1 |
| `coverage.test.ts` | `ignores inherited acquired-coverage entries` | 1 |
| `coverage.test.ts` | `rejects nonliteral catalog and mesh codes %j` | 8 |
| `coverage.test.ts` | `does not coerce container route structures or floor labels into containment evidence` | 1 |

The prototype cases cover all three names in decoding under both specification versions and in all three rank components. Missing/null/blank identifier checks cover both nodes and links. The distance and R1 numeric tables each test false, true, an empty array, a numeric array, an object, an empty string, whitespace, null, missing, hexadecimal, NaN, infinity and decimal overflow. R1 runs each bad value on both sides and on either side of a valid zero.

## Commands and receipts

Commands ran in the requested order. For the final offline sequence, a temporary pnpm wrapper supplied `--config.offline=true` and a writable temporary `--store-dir`; it invokes the installed pnpm 12.11.2. Drivers also received `GTEKI_GIS_OFFLINE=1`. The wrapper and cache are outside the worktree. This switch is documented in `tools/gis/README.md`.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `pnpm --dir tools/gis typecheck` | 0 | Standalone and repeated by validation |
| `pnpm --dir tools/gis test` | 0 | 153 tests, 16 files |
| `pnpm --dir tools/gis exec tsx src/real-run.ts` | 0 | 17/17 CLI steps, all exit 0; [archived offline real-run receipt](../history/runs/real-run-2026-10-20T15-40-26-371Z.json) |
| `pnpm --dir tools/gis exec tsx src/validate.ts` | 0 | 5/5 commands, all exit 0; [archived offline validation receipt](../history/runs/validation-2026-10-20T15-42-55-650Z.json) |
| `pnpm --dir tools/gis exec tsx src/summarize.ts` | 0 | 19 acquisitions, 2 inventories, 4 conversions, 4 networks |

Validation executed frozen installation with `--offline`, typecheck, the 153 unit tests, all 6 real tests, and offline acquisition verification. Every real-run and validation command receipt has the final fingerprint. A separate local digest recomputation matched that fingerprint.

The two offline receipt filenames above were verified against their `started_at` timestamps and offline command arguments. They are immutable historical evidence. A subsequent normal online run on 2026-10-20 (real-run started 15:47:52.772Z; validation started 15:50:37.546Z) replaced the stable receipts; this second fix pass regenerates the [current real-run](../real-run.json) and [current validation](../validation.json) in normal online mode again. The current receipts are not evidence of the earlier offline run.

## Real-data comparison with the starting uncommitted reports

All original attribute-decoding output, distance statistics, equality fields, containment output, mesh coverage and acquisition SHA/byte records are unchanged. Only the new comparison counters and method text are added to equality reports; both sides have zero unavailable IDs and zero non-comparable rows.

| Metric | Before and after |
| --- | --- |
| R1 equal shared node rows | 1,887 / 1,887; zero differing |
| R1 equal shared link rows | 2,196 / 2,196; zero differing |
| R1 equal node coordinates | 1,887 / 1,887 |
| Distance comparable / skipped | 2,196 / 0 |
| Distance within 0.05 m / above | 2,166 / 30; `NO_VERDICT` |
| Absolute distance residual median (m) | 0.02574802525526909 |
| Absolute distance residual p95 (m) | 0.047573583817347664 |
| Absolute distance residual p99 (m) | 0.05044424382009076 |
| Absolute distance residual max (m) | 0.0545957414443663 |
| R1 rank consistent / inconsistent / not-checkable | 2,196 / 0 / 0; 37 ambiguous-width links |
| S01 rank consistent / inconsistent / not-checkable | 262 / 1 / 0 |
| R1 nodes inside PLATEAU bbox | 176 / 1,887; all nodes comparable |
| rt_struct 5 links intersecting bbox | 0 / 8; all comparable |
| rt_struct 7 links intersecting bbox | 45 / 83; all comparable |

Full unchanged containment distribution:

```json
{
  "status": "BBOX_EVIDENCE_ONLY",
  "metric_status": "CONDITIONAL_ON_INFERRED_CRS",
  "bbox_lon_lat": [
    139.70938689983566,
    35.728049254734366,
    139.7133659340391,
    35.731371787356984
  ],
  "nodes_inside": 176,
  "total_nodes": 1887,
  "comparable_nodes": 1887,
  "skipped_nodes": 0,
  "nodes_inside_by_literal_floor_and_in_out": [
    {
      "floor": "0",
      "in_out": "1",
      "count": 174
    },
    {
      "floor": "0.5",
      "in_out": "1",
      "count": 2
    }
  ],
  "links_rt_struct_5_7": [
    {
      "rt_struct": "5",
      "total_links": 8,
      "comparable_links": 8,
      "intersecting_bbox": 0,
      "skipped_links": 0
    },
    {
      "rt_struct": "7",
      "total_links": 83,
      "comparable_links": 83,
      "intersecting_bbox": 45,
      "skipped_links": 0
    }
  ],
  "note": "Conditional on R1 inferred EPSG:6668. Node containment and supplied polyline intersection with the PLATEAU geometry bbox only. No feature correspondence, floor match or route is established."
}
```

All 23 original `UNKNOWN`, `UNVERIFIED` and `NOT_FOR_ROUTING` values in the summary remain unchanged. Applicable specification versions remain UNKNOWN; inferred CRS and conditional metric limitations remain in place. Nothing becomes verified or routable.

## Constraint exception

The first standalone typecheck unexpectedly triggered pnpm automatic installation and reported 56 packages downloaded. That violated the no-external-services constraint and was disclosed during the pass. Subsequent commands forced pnpm offline; real sources were checked only from the existing store. The automatically created root `.pnpm-store/` was moved to `/tmp`; no such directory remains in the worktree. No online data acquisition, commit, push, or external review service was used.

## Files changed by this pass

This list compares file bytes with the starting uncommitted worktree, rather than attributing earlier Lane D changes to this pass. Generated conversion receipts moved into history retain their prior contents; new conversion IDs include the new tool fingerprint. External binary outputs and local `node_modules` are not source changes.

- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-csv.json` — updated
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-geojson.json` — updated
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-csv.json` — updated
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json` — updated
- `docs/gis/acquisitions/hokonavi-oedo-shinjuku-network-geojson.json` — updated
- `docs/gis/acquisitions/hokonavi-oedo-shinjuku-stationmap-geojson.json` — updated
- `docs/gis/acquisitions/mlit-walk-network-spec-2018-03.json` — updated
- `docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json` — updated
- `docs/gis/acquisitions/mlit-walk-network-spec-2024-07.json` — updated
- `docs/gis/acquisitions/plateau-13104-codelists.json` — updated
- `docs/gis/acquisitions/plateau-13104-metadata.json` — updated
- `docs/gis/acquisitions/plateau-13104-schemas.json` — updated
- `docs/gis/acquisitions/plateau-13104-ubld-53394536.json` — updated
- `docs/gis/acquisitions/plateau-13116-codelists.json` — updated
- `docs/gis/acquisitions/plateau-13116-metadata.json` — updated
- `docs/gis/acquisitions/plateau-13116-schemas.json` — updated
- `docs/gis/acquisitions/plateau-13116-ubld-53394576.json` — updated
- `docs/gis/acquisitions/plateau-catalog-ubld-13116-13104.json` — updated
- `docs/gis/acquisitions/plateau-catalog-ubld-mesh-533945.json` — updated
- `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-2125f206d7914e675c8c.json` — removed (archived below)
- `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-84eb1f64a0f355fc474d.json` — removed (archived below)
- `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-d69d72d0c7fb9609fc81.json` — added
- `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-ff70bfed63d779f87388.json` — added
- `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-68cd1126e66fcf3f6598.json` — removed (archived below)
- `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-8a2cc9d1aeb20a713c1b.json` — removed (archived below)
- `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-d552032affcbe9cdb1ba.json` — added
- `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-f656130196a773d62765.json` — added
- `docs/gis/gaps/ikebukuro.json` — updated
- `docs/gis/history/conversions/tool-def73d7d9ae3c00f/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-2125f206d7914e675c8c.json` — updated
- `docs/gis/history/conversions/tool-def73d7d9ae3c00f/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-84eb1f64a0f355fc474d.json` — updated
- `docs/gis/history/conversions/tool-def73d7d9ae3c00f/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-68cd1126e66fcf3f6598.json` — updated
- `docs/gis/history/conversions/tool-def73d7d9ae3c00f/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-8a2cc9d1aeb20a713c1b.json` — updated
- `docs/gis/history/runs/real-run-2026-10-20T15-25-50-465Z.json` — added
- `docs/gis/history/runs/validation-2026-10-20T15-28-40-765Z.json` — added
- `docs/gis/networks/hokonavi-ikebukuro-walk-node-csv.json` — updated
- `docs/gis/networks/hokonavi-ikebukuro-walk-node-geojson.json` — updated
- `docs/gis/networks/hokonavi-oedo-shinjuku-network-geojson.json` — updated
- `docs/gis/networks/hokonavi-oedo-shinjuku-stationmap-geojson.json` — updated
- `docs/gis/overlap/ikebukuro.json` — updated
- `docs/gis/overlap/shinjuku.json` — updated
- `docs/gis/real-data-summary.json` — updated
- `docs/gis/real-data-summary.md` — updated
- `docs/gis/real-run.json` — updated
- `docs/gis/research/lane-d-review-fixes.md` — added
- `docs/gis/validation.json` — updated
- `tools/gis/README.md` — updated
- `tools/gis/src/attributes.ts` — updated
- `tools/gis/src/coverage.ts` — updated
- `tools/gis/src/geodesic.ts` — updated
- `tools/gis/src/mesh.ts` — updated
- `tools/gis/src/overlap.ts` — updated
- `tools/gis/src/r1.ts` — updated
- `tools/gis/src/real-run.ts` — updated
- `tools/gis/src/validate.ts` — updated
- `tools/gis/src/values.ts` — added
- `tools/gis/test/attributes.test.ts` — updated
- `tools/gis/test/coverage.test.ts` — updated
- `tools/gis/test/geodesic.test.ts` — updated
- `tools/gis/test/r1.test.ts` — added


## Second fix pass

The second fresh review raised two P2 findings: component-specific mobility-trace rank thresholds, and offline evidence that pointed to subsequently replaced stable receipts. Both are repaired in this pass. No commit, push or external review service was used. Normal online source acquisition and pnpm dependency installation were allowed for the requested pipeline. Pnpm's temporary root cache was moved to `/tmp`, and subsequent commands used `pnpm_config_store_dir=/tmp/gteki-lane-d-pass2-pnpm-store`; no root cache remains.

### Encoded rules and page evidence

The third pass below supersedes this pass's trace-width S/A interpretation; the fourth pass supersedes its trace slope/step S interpretation. The original second-pass results are retained as historical evidence.

The acquired 2024 PDF was reread at printed pp20–22 (PDF pages 22–24), with the actual red-underlined table 3.3 inspected visually. The full code-to-letter table is in [network-codes-and-coverage.md](network-codes-and-coverage.md), backed by the exact sets and page citations in `tools/gis/codebooks/mlit-walk-network-2024-07.json`.

- §3.3.2 2), p20: survey uses every interval bound; mobility trace uses the underlined readings. Table 3.3 p21: trace slope A/B/C mean ≤5/8/18%; trace step A/B/C mean ≤2/5/10 cm. Zero fits these upper-threshold readings. The second pass incorrectly accepted the black, non-underlined slope/step S cells for trace; the fourth pass below makes those readings `not_checkable` while preserving survey S. The second pass treated width S/A as retaining their printed intervals; that unsupported trace interpretation is superseded by the third pass below. The p21 footnote makes width code 1 survey Z or trace C. Figure 3.3 p22 explicitly permits a 2 cm step to be B.
- The acquired table underlines slope Z (>18%) and step Z (>10 cm), so those trace readings remain checkable. Width Z has no trace reading and X has no numeric trace reading in any component: these trace letters are `not_checkable`, never inferred. Observed code 99 and unsupported codes are also `not_checkable` for trace.
- §3.3.2 3), p22: `r_method` digits are read independently in width, slope, step order. Missing, blank or other digits use the component/code union of the two method sets. Accepted membership is `method_unknown`; observations outside that union are `inconsistent`. Invalid rank/code evidence remains `not_checkable`.
- All judgements are report-only. Each component and the link totals expose native `link_id` lists for `inconsistent` and `not_checkable`, capped at 100 per list with truncation and unavailable-ID counts. Link-level precedence is `not_checkable`, `inconsistent`, `method_unknown`, `consistent`; partial component evidence stays visible.
- Offline evidence now links the two verified immutable archived receipts above. Subsequent online runs produced the stable current receipts; those current paths are not used as offline evidence.

### Regression tests

All tests below are in `tools/gis/test/attributes.test.ts`. The existing width/method test was updated for the four states, and the malformed-own-mapping control now addresses the survey mapping explicitly.

| New test name / parameterized title | Cases |
| --- | ---: |
| `applies independent survey versus trace rules for $field` | 3 |
| `checks the p22 ABB example with method $r_method as $state` | 10 |
| `reads partial and mixed method digits independently in width, slope, step order` | 1 |
| `keeps unknown-method observations outside the survey/trace union inconsistent` | 1 |
| `does not guess undefined trace width Z or X readings, but retains underlined slope/step Z` | 1 |
| `includes zero and nested upper thresholds for trace slope and step without extending width intervals` | 1 |
| `caps native link IDs at 100 with explicit truncation for %s components` | 2 |
| `counts unavailable native IDs without inventing IDs and preserves partial component evidence` | 1 |

Twenty new cases raise the unit suite from 153 to 173 tests in 16 files.

### Second-pass generated rank results

Generated directly from the three current [network JSON reports](../networks/) for `tool_input_sha256=f596d193bb926e14064cba90c9b6f27a480eafdba61e612f7f87b7bdc3df8228`. Counts and IDs below are read from `attribute_decoding.rank_cross_check_2024` without manual number overrides.

| Dataset | Scope | consistent | inconsistent | not_checkable | method_unknown |
| --- | --- | ---: | ---: | ---: | ---: |
| R1 CSV | link triplets | 0 | 0 | 0 | 2196 |
| R1 CSV | width | 0 | 0 | 0 | 2196 |
| R1 CSV | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 CSV | lev_diff | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | link triplets | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | width | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | lev_diff | 0 | 0 | 0 | 2196 |
| E27 network | link triplets | 262 | 1 | 0 | 0 |
| E27 network | width | 263 | 0 | 0 | 0 |
| E27 network | vtcl_slope | 262 | 1 | 0 | 0 |
| E27 network | lev_diff | 263 | 0 | 0 | 0 |

| Dataset | Component | inconsistent native link IDs | not_checkable native link IDs | Truncated (inconsistent / not_checkable) | Unavailable IDs (inconsistent / not_checkable) |
| --- | --- | --- | --- | --- | --- |
| R1 CSV | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | vtcl_slope | `["b80b3f4aef474ac2aa25c6680b26177a"]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |

R1 results retain method uncertainty; they do not assert survey/trace provenance. The E27 slope mismatch remains an observation and is not corrected. Applicable specification versions remain UNKNOWN and every candidate remains UNVERIFIED and not routable.

### Second-pass commands and final checks

Commands ran in the requested order, with `GTEKI_GIS_OFFLINE` unset and the pnpm store explicitly under `/tmp`. The real runner acquired sources online. Validation used normal frozen installation and retained its built-in final offline hash check; that last subcommand does not make the validation driver an offline run.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `pnpm --dir tools/gis typecheck` | 0 | Standalone, then repeated by validation |
| `pnpm --dir tools/gis test` | 0 | 173 passing unit tests in 16 files; repeated by validation |
| `pnpm --dir tools/gis exec tsx src/real-run.ts` | 0 | [Current receipt](../real-run.json), 17/17 subcommands exit 0; online acquisition |
| `pnpm --dir tools/gis exec tsx src/validate.ts` | 0 | [Current receipt](../validation.json), 5/5 subcommands exit 0; 173 unit tests and 6 real tests, none skipped |
| `pnpm --dir tools/gis exec tsx src/summarize.ts` | 0 | [Current summary](../real-data-summary.json), 19 acquisitions, 2 inventories, 4 conversions, 4 networks |

Final `tool_input_sha256`: `f596d193bb926e14064cba90c9b6f27a480eafdba61e612f7f87b7bdc3df8228`. An independent Python recomputation over the fingerprinted paths and exact bytes matched the real-run, validation, network and summary receipts. Every real-run and validation subcommand records this same fingerprint. The earlier offline receipts and `docs/gis/HANDOFF.md` match their starting SHA-256 hashes byte for byte. Package, lockfile and workspace configuration are unchanged. UNKNOWN stays UNKNOWN, raw attributes remain preserved, and no verification or routability promotion was introduced.

### Files changed by the second pass

52 file paths differ from the starting uncommitted worktree: three tool/codebook/test files, two research documents and 47 generated or archived report paths (including the four conversion receipts moved out of the current directory). Installed dependencies and external-store binaries/logs are excluded.

| Path | Change |
| --- | --- |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2018-03.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07.json` | updated |
| `docs/gis/acquisitions/plateau-13104-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13104-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13104-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13104-ubld-53394536.json` | updated |
| `docs/gis/acquisitions/plateau-13116-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13116-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13116-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13116-ubld-53394576.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-13116-13104.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-mesh-533945.json` | updated |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-4d9cdfc4dc9c7e0e806a.json` | added |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-9503aadfbf5f55976330.json` | added |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-d69d72d0c7fb9609fc81.json` | removed |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-ff70bfed63d779f87388.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-41c6742aff2c45fe888f.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-d552032affcbe9cdb1ba.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-e3e62fb6e4a6f338fcaf.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-f656130196a773d62765.json` | removed |
| `docs/gis/gaps/ikebukuro.json` | updated |
| `docs/gis/gaps/ikebukuro.md` | updated |
| `docs/gis/gaps/shinjuku.json` | updated |
| `docs/gis/gaps/shinjuku.md` | updated |
| `docs/gis/history/conversions/tool-02596f248227c4c6/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-d69d72d0c7fb9609fc81.json` | updated |
| `docs/gis/history/conversions/tool-02596f248227c4c6/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-ff70bfed63d779f87388.json` | updated |
| `docs/gis/history/conversions/tool-02596f248227c4c6/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-d552032affcbe9cdb1ba.json` | updated |
| `docs/gis/history/conversions/tool-02596f248227c4c6/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-f656130196a773d62765.json` | updated |
| `docs/gis/history/runs/real-run-2026-10-20T15-47-52-772Z.json` | added |
| `docs/gis/history/runs/validation-2026-10-20T15-50-37-546Z.json` | added |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/overlap/ikebukuro.json` | updated |
| `docs/gis/overlap/shinjuku.json` | updated |
| `docs/gis/real-data-summary.json` | updated |
| `docs/gis/real-data-summary.md` | updated |
| `docs/gis/real-run.json` | updated |
| `docs/gis/research/lane-d-review-fixes.md` | updated |
| `docs/gis/research/network-codes-and-coverage.md` | updated |
| `docs/gis/validation.json` | updated |
| `tools/gis/codebooks/mlit-walk-network-2024-07.json` | updated |
| `tools/gis/src/attributes.ts` | updated |
| `tools/gis/test/attributes.test.ts` | updated |


## Third fix pass

The third fresh review raised two P2 findings: GeoJSON pair candidate provenance followed classification rather than acquisition origin, and the trace-width S/A mappings lacked explicit red-underlined support. This pass repairs both. Changes are restricted to `tools/gis/**` and `docs/gis/**`; `docs/gis/HANDOFF.md` is unchanged. No commit, push or external review service was used. Online acquisition is limited to the existing real pipeline's source requests.

### Acquisition origin, independent of candidate classification

`inspectGeoJsonPair` attaches source ID, SHA-256 and actual member name to each feature before combining the two files. A private symbol keeps this internal acquisition metadata separate from source GeoJSON fields. `inspectGeoJsonFeatures` reads that origin for every candidate, including `candidate_kind:"unknown"`; the classification-based provenance rewrite is removed. Production member names come from the acquisition records' stored filenames (`node.geojson` and `link.geojson`). The regression includes conflicting node/link identifiers in both files and features classified as the other role, preserves raw properties, and checks unknown native IDs and UNVERIFIED/non-routable status.

The CSV pair path already assigns node/link acquisition IDs and hashes directly from its two input arrays, before any row identifier could affect provenance. It has no equivalent classification-based rewrite. A regression with conflicting role identifiers in both files checks those separate origins and keeps absent endpoints UNKNOWN. No CSV provenance production logic was changed.

### Conservative trace-width rules

Printed p21 (PDF page 23) of the acquired 2024 specification was rendered locally and inspected visually. Table 3.3 red-underlines only width C; width S/A are not red-underlined. The instruction on printed p20 to read only red-underlined trace parts therefore provides no explicit trace S/A reading. The codebook now maps trace width only for observed code 1 -> C; all other width codes and width S/A/Z/X readings are `not_checkable`. Its trace reading note records this reason and the printed-page evidence (pp20-21).

A missing/blank/other method digit uses only supported readings. Width codes 2/3/4/99 retain their survey A/S/S/X reading; accepted membership still counts as `method_unknown`. Width code 1 retains the supported survey Z / trace C union. The generic rank evaluator already implements this union from the codebook, so no evaluator change was needed. The third-pass width tests used ASS/SSS as trace triplets; the fourth pass replaces their slope/step S with supported A readings (AAA/SAA), keeping the width assertion independent. The fourth pass also supersedes the third pass's acceptance of trace slope/step S; the historical counts below describe the third-pass run.

### Third-pass regression tests

| Test name / parameterized title | Cases | Change |
| --- | ---: | --- |
| `retains originating GeoJSON acquisition for ambiguous and cross-classified features from both files` | 1 | new |
| `retains originating CSV acquisition for conflicting role identifiers in both files` | 1 | new |
| `checks trace width code %s only when code 1 has the supported C reading` | 7 | new; five rank letters per case |
| `uses only supported width readings in the unknown-method union for code $width` | 5 | new; five rank letters per case |
| `applies independent survey versus trace rules for $field` | 3 | updated to isolate the component's method digit |
| `checks the p22 ABB slope/step readings with method $r_method as $state` | 10 | updated; trace width is not-checkable while slope/step remain independently judged |
| `does not guess undefined trace width Z or X readings, but retains underlined slope/step Z` | 1 | updated to use supported trace width C |
| `includes zero and nested upper thresholds for trace slope and step with supported width C` | 1 | updated to use supported trace width C |

The first two tests are in `tools/gis/test/network.test.ts`; the remaining tests are in `tools/gis/test/attributes.test.ts`. Fourteen added cases raise the unit suite from 173 to 187 tests in 16 files.


### Third-pass real-data comparison

Generated directly from the three current [network JSON reports](../networks/) for `tool_input_sha256=56bfce82f2443d37c787deb909b51cc51447ce24d5b1d1be96e18a8fd08028fa`. Counts and IDs below are read from `attribute_decoding.rank_cross_check_2024` without manual number overrides.

| Dataset | Scope | consistent | inconsistent | not_checkable | method_unknown |
| --- | --- | ---: | ---: | ---: | ---: |
| R1 CSV | link triplets | 0 | 0 | 0 | 2196 |
| R1 CSV | width | 0 | 0 | 0 | 2196 |
| R1 CSV | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 CSV | lev_diff | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | link triplets | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | width | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | lev_diff | 0 | 0 | 0 | 2196 |
| E27 network | link triplets | 262 | 1 | 0 | 0 |
| E27 network | width | 263 | 0 | 0 | 0 |
| E27 network | vtcl_slope | 262 | 1 | 0 | 0 |
| E27 network | lev_diff | 263 | 0 | 0 | 0 |

| Dataset | Component | inconsistent native link IDs | not_checkable native link IDs | Truncated (inconsistent / not_checkable) | Unavailable IDs (inconsistent / not_checkable) |
| --- | --- | --- | --- | --- | --- |
| R1 CSV | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | vtcl_slope | `["b80b3f4aef474ac2aa25c6680b26177a"]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |

R1 results retain method uncertainty; they do not assert survey/trace provenance. The E27 slope mismatch remains an observation and is not corrected. Applicable specification versions remain UNKNOWN and every candidate remains UNVERIFIED and not routable.

Compared byte-derived data with the starting uncommitted reports: every link/component rank count and native ID list is unchanged (only the explanatory rank note changes). R1 CSV and GeoJSON each retain 2,196 method-unknown triplets; E27 retains 262 consistent / 1 inconsistent triplet, with the same native slope mismatch ID. Source raw attributes, normalized values, geometry, candidate classifications, source IDs and source SHA-256 values are unchanged in every candidate graph. Record counts are unchanged; there are no ambiguous real R1 features, so this fixture-driven repair does not move any real records between origins.

| Candidate graph | Nodes | Edges | Other features | Changed source ID / SHA-256 assignments | Corrected member assignments |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1 CSV | 1887 | 2196 | 0 | 0 | 0 |
| R1 GeoJSON | 1887 | 2196 | 0 | 0 | 4083 |
| E27 network | 233 | 263 | 0 | 0 | 0 |

The 4,083 R1 GeoJSON candidates previously carried the generic member `R1 node+link GeoJSON pair`; they now carry their actual member name: `node.geojson` for 1,887 originating node-file features and `link.geojson` for 2,196 originating link-file features. This corrects member provenance without changing acquisition-origin counts. All candidates remain UNVERIFIED/non-routable, and applicable-spec UNKNOWN values remain unchanged.

### Third-pass commands and final checks

The five requested commands ran in order with `GTEKI_GIS_OFFLINE` unset. The real runner acquired all 19 sources online. Validation ran frozen installation normally and then its built-in final offline hash check; that final subcommand does not make the validation driver an offline run. `pnpm_config_store_dir` was set to `/tmp/gteki-lane-d-pass3-pnpm-store`.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `pnpm --dir tools/gis typecheck` | 0 | TypeScript check passed |
| `pnpm --dir tools/gis test` | 0 | 187 passing unit tests in 16 files; no skipped tests |
| `pnpm --dir tools/gis exec tsx src/real-run.ts` | 0 | [Current real-run receipt](../real-run.json), all 17 subcommands exit 0; online acquisitions |
| `pnpm --dir tools/gis exec tsx src/validate.ts` | 0 | [Current validation receipt](../validation.json), all 5 subcommands exit 0; 187 unit tests and 6 real-source tests, none skipped |
| `pnpm --dir tools/gis exec tsx src/summarize.ts` | 0 | [Current summary](../real-data-summary.json): 19 acquisitions, 2 inventories, 4 conversions, 4 networks |

Final `tool_input_sha256`: `56bfce82f2443d37c787deb909b51cc51447ce24d5b1d1be96e18a8fd08028fa`. An independent Python recomputation over the sorted fingerprinted paths and exact bytes matches real-run, validation, network and summary receipts; all 17 real-run and 5 validation subcommands carry the same hash. Source acquisition SHA-256 values and byte counts are unchanged from the starting snapshot. The package, lockfile, workspace and TypeScript configurations are byte-for-byte unchanged. `git diff --check` passes.

`docs/gis/HANDOFF.md` retains SHA-256 `e17a454791462d34315d0c64b5504a573d154115ca38283af257150bebd44efd`. Every previously existing archived run receipt, including the earlier immutable offline receipts, is unchanged. The pipeline archived the four starting current conversion receipts byte-for-byte under `history/conversions/tool-f596d193bb926e14/`; those conversion archive paths already existed and were refreshed by the existing archiver. UNKNOWN values and all candidate verification/routability states are unchanged. No commit or push was made, and no external review service was invoked.

### Files changed by the third pass

53 file paths differ from the starting uncommitted worktree: four tool/codebook/test files, two research documents, and 47 generated or archived report paths (including four removed current conversion receipts, now archived). The list compares exact starting and final bytes, so earlier Lane D work is not attributed to this pass. Generated external-store candidates, binaries/logs, temporary verification files and installed dependencies are excluded.

| Path | Change |
| --- | --- |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2018-03.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07.json` | updated |
| `docs/gis/acquisitions/plateau-13104-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13104-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13104-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13104-ubld-53394536.json` | updated |
| `docs/gis/acquisitions/plateau-13116-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13116-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13116-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13116-ubld-53394576.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-13116-13104.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-mesh-533945.json` | updated |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-1f958a2026baf836b280.json` | added |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-4d9cdfc4dc9c7e0e806a.json` | removed |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-9503aadfbf5f55976330.json` | removed |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-db30a7196d6c7a5ad143.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-30d0e1162f96b71537d1.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-41c6742aff2c45fe888f.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-5f7f8a98e20a16efa43d.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-e3e62fb6e4a6f338fcaf.json` | removed |
| `docs/gis/gaps/ikebukuro.json` | updated |
| `docs/gis/gaps/ikebukuro.md` | updated |
| `docs/gis/gaps/shinjuku.json` | updated |
| `docs/gis/gaps/shinjuku.md` | updated |
| `docs/gis/history/conversions/tool-f596d193bb926e14/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-4d9cdfc4dc9c7e0e806a.json` | updated |
| `docs/gis/history/conversions/tool-f596d193bb926e14/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-9503aadfbf5f55976330.json` | updated |
| `docs/gis/history/conversions/tool-f596d193bb926e14/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-41c6742aff2c45fe888f.json` | updated |
| `docs/gis/history/conversions/tool-f596d193bb926e14/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-e3e62fb6e4a6f338fcaf.json` | updated |
| `docs/gis/history/runs/real-run-2026-10-20T16-09-15-308Z.json` | added |
| `docs/gis/history/runs/validation-2026-10-20T16-12-25-484Z.json` | added |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/overlap/ikebukuro.json` | updated |
| `docs/gis/overlap/shinjuku.json` | updated |
| `docs/gis/real-data-summary.json` | updated |
| `docs/gis/real-data-summary.md` | updated |
| `docs/gis/real-run.json` | updated |
| `docs/gis/research/lane-d-review-fixes.md` | updated |
| `docs/gis/research/network-codes-and-coverage.md` | updated |
| `docs/gis/validation.json` | updated |
| `tools/gis/codebooks/mlit-walk-network-2024-07.json` | updated |
| `tools/gis/src/network.ts` | updated |
| `tools/gis/test/attributes.test.ts` | updated |
| `tools/gis/test/network.test.ts` | updated |


## Fourth fix pass

The fourth review found that trace slope/step code 1 still accepted S despite the red-underlined-only rule. The [acquired 2024 specification](../acquisitions/mlit-walk-network-spec-2024-07.json), SHA-256 `963f2f85791b9ff1199c0980a4e99f39c98ec26fc376de6dc9f343d10522c0a4`, was reread locally: §3.3.2 2) printed p20 restricts trace readings to red-underlined parts, and the rendered table 3.3 on printed p21 (PDF page 23) prints slope S (0%) and step S (0 cm) in black without red underlining. Both readings are therefore unsupported for trace.

### Supported readings and regression coverage

Trace slope/step code 1 now allows only A/B/C; S joins X in each component's `not_checkable_letters`. The codebook's trace reading note records the reason and pp20–21 evidence. Survey mappings, including exact-zero S, are unchanged. Missing/blank/other method digits use the existing evaluator's union of supported codebook sets: slope/step code 1 keeps survey S plus trace A/B/C, and no other code accepts S. No evaluator change was needed.

The requested `{width:1, vtcl_slope:1, lev_diff:1, rank:"CSS", r_method:"222"}` now reports width `consistent`, slope and step `not_checkable`, and the link `not_checkable`. Tests also isolate the mixed method digits 221/212/211, preserve native IDs and input values, and retain unknown-method uncertainty.

Grep covered the GIS codebook, evaluator, tests, README and research documents for trace readings and S/CSS endorsements. Every remaining accepted trace letter was compared with the actual red-underlined cells: width accepts only C; slope/step accept A/B/C upper thresholds and Z bounds. Width S/A/Z/X, slope/step S/X, and width B's dash supply no trace acceptance. No other unsupported accepted trace reading was found. The research table and prose now distinguish unsupported trace S from supported survey S; earlier pass descriptions explicitly mark the superseded interpretation. Width-only regression fixtures use valid trace slope/step AA instead of SS.

| Test name / parameterized title | Cases | Change |
| --- | ---: | --- |
| `checks CSS zero readings independently with method $r_method as $state` | 9 | new; trace, survey and unknown component methods |
| `retains survey S for exact-zero slope and step` | 1 | new; two survey triplets |
| `keeps the non-underlined trace S not-checkable for every $field code` | 2 | new; all defined codes plus unsupported-code controls |
| `accepts unknown-method S only from the supported zero survey reading for $field` | 2 | new; all defined codes across four absent/other method forms |
| `includes zero and nested upper thresholds for trace slope and step with supported width C` | 1 | updated; only CAA/CBB/CCC are accepted for zero trace values |
| `checks trace width code %s only when code 1 has the supported C reading` | 7 | updated; independent supported slope/step AA fixtures |

Fourteen added cases raise the unit suite from 187 to 201 passing tests in 16 files. Standalone typecheck and unit tests both exited 0.

### Fourth-pass real-data comparison

Generated directly from the three current [network JSON reports](../networks/) for `tool_input_sha256=9605494ca38c261d1e49019529eba707bf3feafe0e96adc4bf831a85fda0ae15`. Counts and IDs below are read from `attribute_decoding.rank_cross_check_2024` without manual number overrides.

| Dataset | Scope | consistent | inconsistent | not_checkable | method_unknown |
| --- | --- | ---: | ---: | ---: | ---: |
| R1 CSV | link triplets | 0 | 0 | 0 | 2196 |
| R1 CSV | width | 0 | 0 | 0 | 2196 |
| R1 CSV | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 CSV | lev_diff | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | link triplets | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | width | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | vtcl_slope | 0 | 0 | 0 | 2196 |
| R1 GeoJSON | lev_diff | 0 | 0 | 0 | 2196 |
| E27 network | link triplets | 262 | 1 | 0 | 0 |
| E27 network | width | 263 | 0 | 0 | 0 |
| E27 network | vtcl_slope | 262 | 1 | 0 | 0 |
| E27 network | lev_diff | 263 | 0 | 0 | 0 |

| Dataset | Component | inconsistent native link IDs | not_checkable native link IDs | Truncated (inconsistent / not_checkable) | Unavailable IDs (inconsistent / not_checkable) |
| --- | --- | --- | --- | --- | --- |
| R1 CSV | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 CSV | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | vtcl_slope | `[]` | `[]` | 0 / 0 | 0 / 0 |
| R1 GeoJSON | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | width | `[]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | vtcl_slope | `["b80b3f4aef474ac2aa25c6680b26177a"]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |

R1 results retain method uncertainty; they do not assert survey/trace provenance. The E27 slope mismatch remains an observation and is not corrected. Applicable specification versions remain UNKNOWN and every candidate remains UNVERIFIED and not routable.

Compared with the starting uncommitted reports, all 1,541 data numeric values in the real-data summary are unchanged. The complete summary is also equal after removing the tool fingerprint, explanatory rank notes, conversion run IDs, elapsed times and peak RSS, and aligning conversions by source/filter. Every network link/component rank count and native ID list is unchanged. All 19 online acquisitions retain the same source SHA-256 and byte count. Run timings and memory measurements were refreshed; no data metric changed. Applicable-spec UNKNOWN, UNVERIFIED and non-routable states are preserved.

### Fourth-pass commands and final checks

The five requested commands ran in order with `GTEKI_GIS_OFFLINE` unset. Online source requests were limited to the existing real pipeline. Pnpm reused `/tmp/gteki-lane-d-pass3-pnpm-store` via `pnpm_config_store_dir`; no external review service was used. Validation used normal frozen installation and its built-in final offline hash check, which does not make the validation driver an offline run.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `pnpm --dir tools/gis typecheck` | 0 | Standalone TypeScript check; also passed in validation |
| `pnpm --dir tools/gis test` | 0 | 201 passing tests in 16 files, none skipped; repeated by validation |
| `pnpm --dir tools/gis exec tsx src/real-run.ts` | 0 | [Real-run receipt](../real-run.json), 17/17 subcommands exit 0; 19 online acquisitions |
| `pnpm --dir tools/gis exec tsx src/validate.ts` | 0 | [Validation receipt](../validation.json), 5/5 subcommands exit 0; 201 unit tests and 6 real-data tests in one file, none skipped |
| `pnpm --dir tools/gis exec tsx src/summarize.ts` | 0 | [Summary](../real-data-summary.json): 19 acquisitions, 2 inventories, 4 conversions, 4 networks |

Final `tool_input_sha256`: `9605494ca38c261d1e49019529eba707bf3feafe0e96adc4bf831a85fda0ae15`. An independent Python recomputation over the sorted fingerprinted paths and exact bytes matches real-run, validation, network and summary receipts; all 17 real-run and 5 validation subcommands carry that hash. Package, lockfile, workspace and TypeScript configuration files are byte-for-byte unchanged.

`docs/gis/HANDOFF.md` retains SHA-256 `e17a454791462d34315d0c64b5504a573d154115ca38283af257150bebd44efd`. Earlier archived run receipts, including offline evidence, are unchanged. The four previous current conversion receipts were moved to their fingerprint history directory with their starting bytes intact. Git HEAD and every status entry outside the authorized GIS paths are unchanged. No commit or push was made.

### Files changed by the fourth pass

52 paths differ from the starting uncommitted worktree: five authored files (codebook, attribute tests, README and two research documents) and 47 generated or archived report paths, including four conversion paths removed from the current directory. Installed dependencies and external-store binaries/logs are excluded.

| Path | Change |
| --- | --- |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/acquisitions/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2018-03.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json` | updated |
| `docs/gis/acquisitions/mlit-walk-network-spec-2024-07.json` | updated |
| `docs/gis/acquisitions/plateau-13104-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13104-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13104-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13104-ubld-53394536.json` | updated |
| `docs/gis/acquisitions/plateau-13116-codelists.json` | updated |
| `docs/gis/acquisitions/plateau-13116-metadata.json` | updated |
| `docs/gis/acquisitions/plateau-13116-schemas.json` | updated |
| `docs/gis/acquisitions/plateau-13116-ubld-53394576.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-13116-13104.json` | updated |
| `docs/gis/acquisitions/plateau-catalog-ubld-mesh-533945.json` | updated |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-1f958a2026baf836b280.json` | removed |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-c3a66e05d19eddca7391.json` | added |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-c41dfb6ed905d2237956.json` | added |
| `docs/gis/conversions/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-db30a7196d6c7a5ad143.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-1c97c64d92eaafc80145.json` | added |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-30d0e1162f96b71537d1.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-5f7f8a98e20a16efa43d.json` | removed |
| `docs/gis/conversions/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-aba3f90ae468713ffe2f.json` | added |
| `docs/gis/gaps/ikebukuro.json` | updated |
| `docs/gis/gaps/ikebukuro.md` | updated |
| `docs/gis/gaps/shinjuku.json` | updated |
| `docs/gis/gaps/shinjuku.md` | updated |
| `docs/gis/history/conversions/tool-56bfce82f2443d37/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-1f958a2026baf836b280.json` | updated |
| `docs/gis/history/conversions/tool-56bfce82f2443d37/plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-db30a7196d6c7a5ad143.json` | updated |
| `docs/gis/history/conversions/tool-56bfce82f2443d37/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-30d0e1162f96b71537d1.json` | updated |
| `docs/gis/history/conversions/tool-56bfce82f2443d37/plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-5f7f8a98e20a16efa43d.json` | updated |
| `docs/gis/history/runs/real-run-2026-10-20T16-34-55-317Z.json` | added |
| `docs/gis/history/runs/validation-2026-10-20T16-40-29-234Z.json` | added |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-csv.json` | updated |
| `docs/gis/networks/hokonavi-ikebukuro-walk-node-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-network-geojson.json` | updated |
| `docs/gis/networks/hokonavi-oedo-shinjuku-stationmap-geojson.json` | updated |
| `docs/gis/overlap/ikebukuro.json` | updated |
| `docs/gis/overlap/shinjuku.json` | updated |
| `docs/gis/real-data-summary.json` | updated |
| `docs/gis/real-data-summary.md` | updated |
| `docs/gis/real-run.json` | updated |
| `docs/gis/research/lane-d-review-fixes.md` | updated |
| `docs/gis/research/network-codes-and-coverage.md` | updated |
| `docs/gis/validation.json` | updated |
| `tools/gis/README.md` | updated |
| `tools/gis/codebooks/mlit-walk-network-2024-07.json` | updated |
| `tools/gis/test/attributes.test.ts` | updated |
