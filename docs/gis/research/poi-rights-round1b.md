# Lane D POI-rights round 1b

Tool-input SHA-256: `8c96756d9a2979fb509e3978842f1dcd079be13cc90693d17eaa5f7f85fe394c`. Base HEAD `31c8d5e`; changes are uncommitted. Every candidate is UNVERIFIED / routable:false and every publish gate is HOLD.

## Task 1: S03 matching and atomic generation

The acquired `tokyo-shinjuku-facilities-package` holds the pre-redirect URLs. Its three resource URLs match acquisition `expected_url`, while `resolved_url` records the redirected downloads. The matcher accepts that exact URL only with matching package source ID, SHA-256 and `/result/resources/<index>/url` acquisition evidence. It counts unique resource entries across both exact URL fields, rejects genuine ambiguity and never matches by basename or display name. Each rights record says which field matched.

All records, register, research content and real-run invalidation are prepared before output staging. Research and vintage validation failures write nothing. The bundle writer stages all bytes before promotion and restores prior files/removes new files on promotion failure. Simultaneous multi-file visibility and process/host-crash recovery are not guaranteed.

Regression tests: `matches the exact pre-redirect S03 URL using its hashed acquisition pointer`; `rejects unverified pre-redirect matches and genuine ambiguity without filename inference`; `writes nothing when research preparation fails after all rights records are computed`; `fails closed when the derived acquisition hash or archive URL drifts from the vintage report`; transaction tests `leaves every existing output unchanged on a staging error`, `rolls back previously promoted outputs on a later promotion error`, and `removes newly created outputs during rollback`.

## Task 2: Astra safeguards

The interrupted HEAD already enforced strong ETags, range identity, bbox truncation and geographic coordinate guards. They were retained and checked. One remaining consumer defect was fixed: `overlapHolds` now treats UNKNOWN among any layer pair, including POI pairs, as an UNKNOWN gap decision rather than deriving an all-disjoint packet from network pairs. Summary consumers preserve POI `bbox_status` and overlap pair relations; the current real-run receipt is invalidated and final summaries await the lead.

Tests: `rejects a weak ETag before using ZIP range bytes`; `rejects a missing ETag before using ZIP range bytes`; `rejects non-206 responses, wrong Content-Range identity, and changed validators`; `lists ZIP member metadata and fetches a selected member with size and CRC checks` asserts `validator_type: STRONG_ETAG`; `propagates an inspected limit-truncated POI through overlap and coverage as UNKNOWN` reaches exactly 1,000,000 visits and asserts null bbox, INCOMPLETE_LIMIT_REACHED, UNKNOWN pair and null coverage; `keeps coordinate-limit-truncated POI evidence non-comparable in gap decisions`; `retains projected EPSG:6677 and S03 local coordinates without treating them as lon/lat`; `accepts only exact recognized geographic CRS identifiers`; `keeps recognized geographic CRS coordinates raw when either axis is outside its valid range`.

## Task 3: PLATEAU scopes

All eight 2025 ubld/metadata/codelists/schemas downloads have different exact asset-folder URLs from the CityGML ZIP URLs in the acquired 13104/13116 package snapshots. No package inheritance was assigned to them. Each record retains its source URL, parent package hash, and the absent-match reason. Municipality/year/filename are insufficient. Both acquired 2023 members match their exact archive resource pointer and record `PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE`. Resource licences remain UNKNOWN.

The acquired 13104 metadata ZIP has four literal `useLimitation` statements and 13116 has three, each `Licensed under CC BY 4.0`. `file_embedded_licence` records CC BY 4.0 for the described datasets. It does not change the package/resource licence or clear the ZIP/siblings. Tests: `inherits a 2025 package declaration only for an exact acquired asset folder (true/false)`; `matches a catalog file only under the exact acquired package asset folder`; `records only explicit metadata XML rights and leaves absent rights unknown`; vintage exact/absent URL tests.

## Task 4: E27 package acquisition

Added bounded direct source `hokonavi-oedo-shinjuku-package` for `https://ckan.hokonavi.go.jp/api/3/action/package_show?id=station_oedo_shinjuku`. Acquired SHA-256 `d975c5953f74f9474cce262138ace6a676129025973f39c1119cfb21f6f3cd88`. Package `license_id` is literally `pdl-jp-1.0`; `license_title` is recorded separately. Exact network and stationmap URL membership is recorded at `/result/resources/1/url` and `/result/resources/3/url`. Their resource `license` values are null; resource rights remain UNKNOWN; gates HOLD. E27 no longer derives package rights from the legacy supporting-document path.

Tests: `derives both E27 licences and the actual period from the dedicated hashed package snapshot`; bounded 34-source manifest test verifies the new source URL, cap, direct resolution and HOLD.

## Task 5: validation

| Command | Result |
| --- | --- |
| `pnpm --dir tools/gis install --frozen-lockfile` | PASS; no dependencies added/upgraded; lockfile unchanged |
| `pnpm --dir tools/gis typecheck` | PASS |
| `pnpm --dir tools/gis exec vitest run --exclude test/real.test.ts --no-file-parallelism --maxWorkers=1` | 263 passing tests / 23 files, none skipped |
| `pnpm --dir tools/gis gis acquire --all` | PASS, 34/34 sequential acquisitions |
| `pnpm --dir tools/gis gis inspect-poi <source>` for all six POI sources | PASS, 6/6 |
| `pnpm --dir tools/gis gis inspect-vintages` | PASS, bounded ranges only; validators STRONG_ETAG |
| `pnpm --dir tools/gis gis rights` | PASS; 36 records; prints tool_input_sha256 |
| `pnpm --dir tools/gis gis overlap` | PASS |
| `pnpm --dir tools/gis gis gap-packet` | PASS |
| `git diff --check` | PASS |

Logs and Oracle bundle stay outside Git under `~/.gteki/gis-store/logs/lane-d-round1b/`. The independent Python digest matched every regenerated POI, rights, overlap, gap and vintage report. Raw data stays in the external store. The package lockfile and both handoff files are byte-identical to HEAD. The incidental pnpm cache was moved out of the worktree. No process was killed; no real-run, real tests, real-data GLB conversion command, commit or push occurred. The prescribed unit suite uses synthetic fixtures.

## Remaining UNKNOWNs

All 36 resource-level licences remain UNKNOWN: no exact resource declaration was established. Eleven primary licence observations remain UNKNOWN: eight 2025 PLATEAU child downloads lack exact parent URL/asset-folder membership; the two PLATEAU catalog snapshots and S03 landing page have no acquired declaration covering those resources. File-embedded rights remain UNKNOWN for all sources other than the two metadata ZIPs. Required resource credits, third-party-original permissions, individual-law applicability and proposed release clearance remain unresolved. See the [full rights register](../rights/README.md) for all 36 records.

## Independent review

Oracle (GPT-5.6 Sol Medium) via Ego-lite reviewed the candidate and found a vintage acquisition ambiguity: duplicate archive filename candidates were selected with `.find()` rather than rejected. The fix requires exactly one acquired resource for each archive name before any range fetch or acquisition write, retaining the exact URL and JSON pointer. Test `rejects duplicate same-kind archive resources before fetching or writing acquisition evidence` reproduces two distinct matching URLs and asserts zero fetches/writes. Final [Oracle readback](https://chatgpt.com/c/6ad88fbd-b5dc-83ee-adb1-f652bf6d5039) on `8c96756d9a2979fb509e3978842f1dcd079be13cc90693d17eaa5f7f85fe394c`: **PASS — No blocking findings.** Both review snapshots and bundles are retained under the external log directory; the review TaskSpace was closed after capture. The first review is retained in the external log directory.

## Files changed

113 paths differ from the interrupted HEAD, including new files. The pre-existing unrelated `.serena/` remains untouched.

- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-csv.json`
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-link-geojson.json`
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-csv.json`
- `docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json`
- `docs/gis/acquisitions/hokonavi-oedo-shinjuku-network-geojson.json`
- `docs/gis/acquisitions/hokonavi-oedo-shinjuku-package.json`
- `docs/gis/acquisitions/hokonavi-oedo-shinjuku-stationmap-geojson.json`
- `docs/gis/acquisitions/mlit-walk-network-spec-2018-03.json`
- `docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json`
- `docs/gis/acquisitions/mlit-walk-network-spec-2024-07.json`
- `docs/gis/acquisitions/plateau-13104-codelists.json`
- `docs/gis/acquisitions/plateau-13104-metadata.json`
- `docs/gis/acquisitions/plateau-13104-package-2023.json`
- `docs/gis/acquisitions/plateau-13104-package-2025.json`
- `docs/gis/acquisitions/plateau-13104-related-2025.json`
- `docs/gis/acquisitions/plateau-13104-schemas.json`
- `docs/gis/acquisitions/plateau-13104-ubld-53394536.json`
- `docs/gis/acquisitions/plateau-13116-codelists.json`
- `docs/gis/acquisitions/plateau-13116-metadata.json`
- `docs/gis/acquisitions/plateau-13116-package-2025.json`
- `docs/gis/acquisitions/plateau-13116-related-2025.json`
- `docs/gis/acquisitions/plateau-13116-schemas.json`
- `docs/gis/acquisitions/plateau-13116-ubld-53394576.json`
- `docs/gis/acquisitions/plateau-catalog-ubld-13116-13104.json`
- `docs/gis/acquisitions/plateau-catalog-ubld-mesh-533945.json`
- `docs/gis/acquisitions/plateau-site-policy.json`
- `docs/gis/acquisitions/toei-stores-shinjuku-csv.json`
- `docs/gis/acquisitions/toei-stores-shinjuku-nishiguchi-csv.json`
- `docs/gis/acquisitions/tokyo-shinjuku-facilities-landing.json`
- `docs/gis/acquisitions/tokyo-shinjuku-facilities-package.json`
- `docs/gis/acquisitions/tokyo-shinjuku-facilities-reference-pdf.json`
- `docs/gis/acquisitions/tokyo-shinjuku-facilities-spec-pdf.json`
- `docs/gis/acquisitions/tokyo-shinjuku-facilities-zip.json`
- `docs/gis/acquisitions/tokyo-toei-stores-package.json`
- `docs/gis/acquisitions/vintages/vintage-directory-citygml-1-op.zip.json`
- `docs/gis/acquisitions/vintages/vintage-directory-citygml-2-op.zip.json`
- `docs/gis/acquisitions/vintages/vintage-member-25c55437cff5a95e.json`
- `docs/gis/acquisitions/vintages/vintage-member-37e91af3276c2ee8.json`
- `docs/gis/gaps/ikebukuro.json`
- `docs/gis/gaps/ikebukuro.md`
- `docs/gis/gaps/shinjuku.json`
- `docs/gis/gaps/shinjuku.md`
- `docs/gis/overlap/ikebukuro.json`
- `docs/gis/overlap/shinjuku.json`
- `docs/gis/poi/plateau-13104-related-2025.json`
- `docs/gis/poi/plateau-13104-related-2025.md`
- `docs/gis/poi/plateau-13116-related-2025.json`
- `docs/gis/poi/plateau-13116-related-2025.md`
- `docs/gis/poi/toei-stores-shinjuku-csv.json`
- `docs/gis/poi/toei-stores-shinjuku-csv.md`
- `docs/gis/poi/toei-stores-shinjuku-nishiguchi-csv.json`
- `docs/gis/poi/toei-stores-shinjuku-nishiguchi-csv.md`
- `docs/gis/poi/tokyo-shinjuku-facilities-spec-pdf.json`
- `docs/gis/poi/tokyo-shinjuku-facilities-spec-pdf.md`
- `docs/gis/poi/tokyo-shinjuku-facilities-zip.json`
- `docs/gis/poi/tokyo-shinjuku-facilities-zip.md`
- `docs/gis/real-run.json`
- `docs/gis/research/poi-rights-and-vintages.md`
- `docs/gis/research/poi-rights-round1b.md`
- `docs/gis/rights/README.md`
- `docs/gis/rights/hokonavi-ikebukuro-walk-link-csv.json`
- `docs/gis/rights/hokonavi-ikebukuro-walk-link-geojson.json`
- `docs/gis/rights/hokonavi-ikebukuro-walk-node-csv.json`
- `docs/gis/rights/hokonavi-ikebukuro-walk-node-geojson.json`
- `docs/gis/rights/hokonavi-oedo-shinjuku-network-geojson.json`
- `docs/gis/rights/hokonavi-oedo-shinjuku-package.json`
- `docs/gis/rights/hokonavi-oedo-shinjuku-stationmap-geojson.json`
- `docs/gis/rights/mlit-walk-network-spec-2018-03.json`
- `docs/gis/rights/mlit-walk-network-spec-2024-07-diff.json`
- `docs/gis/rights/mlit-walk-network-spec-2024-07.json`
- `docs/gis/rights/plateau-13104-codelists.json`
- `docs/gis/rights/plateau-13104-metadata.json`
- `docs/gis/rights/plateau-13104-package-2023.json`
- `docs/gis/rights/plateau-13104-package-2025.json`
- `docs/gis/rights/plateau-13104-related-2025.json`
- `docs/gis/rights/plateau-13104-schemas.json`
- `docs/gis/rights/plateau-13104-ubld-53394536.json`
- `docs/gis/rights/plateau-13116-codelists.json`
- `docs/gis/rights/plateau-13116-metadata.json`
- `docs/gis/rights/plateau-13116-package-2025.json`
- `docs/gis/rights/plateau-13116-related-2025.json`
- `docs/gis/rights/plateau-13116-schemas.json`
- `docs/gis/rights/plateau-13116-ubld-53394576.json`
- `docs/gis/rights/plateau-catalog-ubld-13116-13104.json`
- `docs/gis/rights/plateau-catalog-ubld-mesh-533945.json`
- `docs/gis/rights/plateau-site-policy.json`
- `docs/gis/rights/toei-stores-shinjuku-csv.json`
- `docs/gis/rights/toei-stores-shinjuku-nishiguchi-csv.json`
- `docs/gis/rights/tokyo-shinjuku-facilities-landing.json`
- `docs/gis/rights/tokyo-shinjuku-facilities-package.json`
- `docs/gis/rights/tokyo-shinjuku-facilities-reference-pdf.json`
- `docs/gis/rights/tokyo-shinjuku-facilities-spec-pdf.json`
- `docs/gis/rights/tokyo-shinjuku-facilities-zip.json`
- `docs/gis/rights/tokyo-toei-stores-package.json`
- `docs/gis/rights/vintage-member-25c55437cff5a95e.json`
- `docs/gis/rights/vintage-member-37e91af3276c2ee8.json`
- `docs/gis/vintages/shinjuku-2023.json`
- `tools/gis/README.md`
- `tools/gis/sources/sources.yaml`
- `tools/gis/src/cli.ts`
- `tools/gis/src/gaps.ts`
- `tools/gis/src/poi-research.ts`
- `tools/gis/src/report-transaction.ts`
- `tools/gis/src/rights.ts`
- `tools/gis/src/vintage.ts`
- `tools/gis/test/acquire.test.ts`
- `tools/gis/test/gaps.test.ts`
- `tools/gis/test/poi.test.ts`
- `tools/gis/test/report-transaction.test.ts`
- `tools/gis/test/rights-generation.test.ts`
- `tools/gis/test/rights.test.ts`
- `tools/gis/test/vintage-acquisition.test.ts`
- `tools/gis/test/vintage.test.ts`
