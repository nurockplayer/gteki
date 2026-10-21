# Lane D POI-rights fix pass, round 3

Base HEAD: `df75b560913ed833daeaf18b03d1cb638baf7ecb`. Changes remain uncommitted for the lead.

Tool-input SHA-256: `75edaa1d42f71d2574f24a8f8c0a1be1e6c2f9f6afa2ee52982a3c39156c5401`.

All candidates remain **UNVERIFIED / routable:false**, and every publish gate remains **HOLD**. Unknown rights, CRS, elevations and connectivity remain unknown.

## Findings and regression tests

| Finding | Fix | Regression tests |
| --- | --- | --- |
| P1: redirect targets could share ETag/length | Pin the first valid final response URL alongside strong ETag and total length. Validate every response before retaining payloads/range metadata. Store `final_url` on archive/member/range reports and both receipt types; offline verification checks URL agreement. | `rejects a changed redirect target with the same ETag and length before retaining bytes`; `pins the final URL through %s responses`; `rejects missing or malformed final URL %s before retaining bytes` in `vintage-boundaries.test.ts` |
| P2: stale inspections could be attributed to current acquisitions | Overlap validates all three consumed POI reports and the vintage report with the existing freshness helpers before comparisons/output. Gap packets validate all six POI reports and the vintage report. Overlap carries transitive POI/vintage acquisition inputs, including the required S03 specification. Gap packets also validate both persisted overlap reports before any output and preserve verified acquisition lineage. Coverage functions do not load report files. | `rejects stale POI acquisition %s before writing`; `rejects stale vintage package before writing`; `rejects stale POI specification lineage before writing`; `accepts validated current reports`, each for overlap and gap packet, in `report-consumers.test.ts`; follow-up cases: `rejects a stale second-station overlap %s before any gap output`, `retains validated acquisition lineage in gap documents` |
| P2: linked CRS masquerading as named CRS | Require own `type: name`, valid named properties and a recognized geographic identifier before declaring geographic coordinates. Linked, malformed, unknown-type and contradictory inherited declarations withhold geographic bbox and observation lon/lat. Preserve the literal declaration. Overlap carries producer CRS status for both member and report-level layers; UNKNOWN/MIXED/unsupported/missing statuses cannot become KNOWN from residual CRS names. | `withholds geographic fields for linked or malformed CRS: %j`; `withholds geographic fields for conflicting root and geometry CRS declarations` in `poi.test.ts`; `does not promote a residual POI CRS name with %s status to KNOWN` in `report-consumers.test.ts` |
| P2: partial vintage receipt promotion | Prepare directory/member receipts and both archives, inspect all selected CityGML, verify stored evidence and build JSON/Markdown before promotion. Promote receipts, report and real-run invalidation through the existing rollback helper. Raw content-addressed evidence remains outside Git. Distinct member origins that collide on a legacy hash-based receipt identity abort the entire preparation; neither origin overwrites the other. | `leaves all active receipts and reports unchanged on CityGML inspection failure`; `leaves all active receipts and reports unchanged when the second archive fails`; `restores the complete active bundle after a %s failure`; `publishes both validated archives with final URLs in all receipts and reports` in `vintage-transaction.test.ts`; `rejects colliding content identities from distinct archive resources before promotion` |

The initial focused pre-fix run reported **28 failures / 29 passes** across four files. It included one positive gap-packet fixture failure; that optional-overlap fixture was corrected. The original defect cases failed before their source fixes. Independent review identified three further boundary cases; the added regressions produced **7 failures / 17 passes** before repair, and all are green in the final suite. See [follow-up pre-fix output](../history/reviews/poi-rights-round3-followup-regressions-before.txt). See [pre-fix output](../history/reviews/poi-rights-round3-regressions-before.txt).

## Validation and saved evidence

- `pnpm --dir tools/gis install --frozen-lockfile`: PASS; dependencies and both lockfiles unchanged.
- `pnpm --dir tools/gis typecheck`: PASS.
- Required single-worker unit command: **26 files, 331 passed, 0 failed**. See [unit result](../history/reviews/poi-rights-round3-unit.txt).
- `gis acquire --all`: **34/34 PASS**; raw acquisitions remain in `~/.gteki/gis-store`.
- `gis inspect-vintages`: **2 archives, 2 inspected members**, bounded ranges only; stored evidence and URL/receipt agreement PASS.
- All six `gis inspect-poi` commands: PASS.
- `gis rights`: **36 records, all HOLD**.
- `gis overlap`: both station reports regenerated from validated inspections; current acquisition hashes and S03 specification lineage verified on readback.
- `gis gap-packet`: both station packets regenerated from validated inspections.
- Saved readback: [machine-readable evidence](poi-rights-round3-evidence.json). Every current POI/vintage/rights/overlap/gap fingerprint matches the value above; vintage member receipt sets match current members; all tested UNVERIFIED/routable:false/HOLD boundaries are preserved.

Host validation used Node `v24.15.0`, while the package declares Node `>=26 <27`. Validation on the declared Node 26 runtime remains for the lead; no runtime or dependencies were installed/upgraded for that purpose.

## Independent review

Oracle bundle delivered through the [ego-browser skill](/Users/tachikoma/.agents/skills/ego-browser/SKILL.md) to a fresh [review conversation](https://chatgpt.com/c/6ad89800-ff48-83e8-94cf-224e4b2baba9). The initial review requested additional consumer/provenance boundary fixes; those were reproduced and repaired. Final review of the revised source bundle returned **PASS for all four scoped findings**, with no additional changes requested. Oracle did not execute the validations. Snapshots: [initial review](../history/reviews/poi-rights-round3-oracle-initial.txt), [final review](../history/reviews/poi-rights-round3-oracle-final.txt). The review TaskSpace was finished with no retained agent pages.

Identical-byte members from distinct archive resources now fail closed because the existing receipt source ID identifies content only. A future provenance-identity change would be required to accept that ambiguous bundle; the two live selected members have distinct hashes.

## Deferred by instruction

No commit, real-run.ts, test:real, citygml-to-glb or GLB conversion was run. The existing real-run receipt remains invalidated; this pass does not qualify conversions, a full real-run or release. No process was killed. Rollback covers ordinary I/O failures; simultaneous multi-file visibility and host/process-crash recovery are not claimed. Edits are confined to `tools/gis/**` and `docs/gis/**`; pre-existing untracked `.pnpm-store/` and `.serena/` are retained.
