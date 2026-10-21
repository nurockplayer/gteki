# Lane D POI-rights fix pass, round 2

Base HEAD: `0f4b3c282087f317dbcb60e24788777c596bafd0`. Changes are uncommitted for the lead.

Tool-input SHA-256: `dc579f74b291b6ee6bcef22a05db1dd08ac2b3d8469a12edbbb5f974e21b0fbf`.

All candidates remain **UNVERIFIED / routable:false** and every publish gate remains **HOLD**. This receipt does not qualify a real-run or a release.

## Fixes and regression evidence

| Finding | Result | Regression tests |
| --- | --- | --- |
| Negated or ambiguous metadata rights | Preserve each nonempty rights-field quote with null licence unless the entire statement matches a supported affirmative declaration. Negations, conditions, exceptions and standalone licence identifiers stay UNKNOWN. Generation never promotes these to FILE_EMBEDDED. | `preserves ambiguous or negated metadata as UNKNOWN evidence: %s`; `recognizes only supported complete affirmative metadata declarations: %s`; `keeps the exact metadata quote without promoting non-affirmative rights: %s` |
| Feature/geometry CRS and explicit null | Resolve root → feature → geometry → nested geometry overrides. Explicit null remains UNKNOWN. Projected/local coordinates are not interpreted as longitude/latitude; mixed effective CRSs null the layer bbox and published observation longitude/latitude. | `honors GeoJSON 2008 feature CRS and treats an explicit null CRS as unknown`; `marks mixed effective feature CRSs and withholds a layer bbox`; `resolves nested geometry CRS overrides and withholds lon/lat for mixed geographic CRS` |
| Incomplete bbox traversal | Depth, visit, malformed and unsupported geometry cutoffs mark bbox INCOMPLETE_LIMIT_REACHED and null both interpreted/raw bbox. Overlap consumers report UNKNOWN. Legitimate null Feature geometry remains allowed. | `marks depth and unsupported geometry traversal as incomplete for bbox purposes`; `treats invalid feature geometry as incomplete while allowing null geometry`; existing visit-count cutoff regression remains green |
| Stale research reports | Validate all six POI reports against expected identity, current tool fingerprint, current acquisition/input hashes, mandatory S03 specification lineage and stored artifact evidence before any bundle promotion. Vintage identity/package/input/range evidence is also checked. | `validates saved inspections inside research preparation before returning report content`; `rejects a stale CSV receipt even when its displayed tool fingerprint is current`; `checks every declared input and requires the report own-source lineage`; `rejects stale vintage package identity, fingerprint, inputs, and evidence` |
| Superseded vintage records | Archive exact bytes of obsolete hash-named rights and member acquisition records under `docs/gis/history/rights/` and `docs/gis/history/acquisitions/vintages/`, then remove active records in the same rollback-capable transaction. Existing directory-scanning consumers see current records only. | `archives superseded vintage rights and acquisitions in the same prepared bundle`; `archives and removes superseded records atomically with replacements`; `restores a removed superseded record and removes its archive on later promotion failure` |

Before implementation, the rights/transaction regressions produced 15 failures / 22 passes, POI regressions failed on CRS and traversal completeness, and the old research builder accepted a stale CSV with row_count 999. The final independent review additionally identified standalone licence identifiers; both added cases failed before the final parser change (2 failures / 19 passes). All are green in the final suite.

## Final validation and readback

- `pnpm --dir tools/gis install --frozen-lockfile`: PASS; package dependencies and lockfile unchanged.
- `pnpm --dir tools/gis typecheck`: PASS.
- `pnpm --dir tools/gis exec vitest run --exclude test/real.test.ts --no-file-parallelism --maxWorkers=1`: **24 files, 295 passed, 0 failed**. Filesystem transaction and rollback tests executed successfully. Workers ran sequentially.
- `pnpm --dir tools/gis gis acquire --all`: **34/34 passed**; online acquisition receipts updated, raw files remain in the external store.
- `gis inspect-poi`: all six current inputs regenerated: both Toei CSVs, S03 facilities ZIP/specification PDF, and both PLATEAU related-data ZIPs. CSV counts are 5 and 17; ZIP member counts are 25, 7 and 7.
- `gis inspect-vintages`: 2 archives and 2 selected members; offline `verifyVintageEvidence` readback **PASS**, no errors.
- `gis rights`: **36 records**, all HOLD; research and rights prepared and promoted together.
- Final readback checked every POI/vintage/rights fingerprint, current source/input hash, active vintage member identity, and UNVERIFIED/routable:false/HOLD boundary. Both active vintage directories contain exactly the 2 selected member IDs. No superseded records existed in this live reacquisition; regression fixtures exercise changed identities and transactional archival.
- Rights-table changes relative to HEAD: **0 of 36 rows**. The two real metadata ZIPs still contain 7 literal `Licensed under CC BY 4.0` statements (4 Shinjuku, 3 Toshima), so their scoped FILE_EMBEDDED values remain CC BY 4.0. Every exact-resource gate remains HOLD. JSON evidence now preserves each affirmative declaration separately.
- S03 readback now withholds 11 incomplete layer bboxes; no geographic or metric interpretation is claimed for those layers. All other interpreted GeoJSON coordinates without declarations remain explicitly conditional RFC 7946 assumptions.

Machine-readable final counts and statuses: [poi-rights-round2-evidence.json](poi-rights-round2-evidence.json).

## Independent review

Oracle prompt bundle was rendered with the installed Oracle CLI and delivered through Ego-lite to a separate ChatGPT review conversation. The initial static review requested the standalone-identifier repair; the follow-up reviewed the exact final rights source/tests with retained context and returned **PASS for all five scoped findings**. It did not independently execute the reported tests or regeneration.

- [Review conversation](https://chatgpt.com/c/6ad89333-ac68-83e8-bfee-0c1592d104f5)
- [Initial review snapshot](../history/reviews/poi-rights-round2-oracle-initial.txt)
- [Completed final review snapshot](../history/reviews/poi-rights-round2-oracle-final.txt)

The review TaskSpace was finished after saving the completed response. Transaction rollback covers ordinary I/O failures; process/host-crash atomicity is not claimed.

## Deferred by instruction

No commit, real-run.ts, test:real, citygml-to-glb, or GLB conversion was run. Existing real-run receipt is invalidated by the report-writing commands; summary/overlap/conversion outputs were not requalified. The lead owns those later validations. No process was killed and no retry after a killed process occurred.
