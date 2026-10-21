# POI / rights fix pass, round 4

Scope: `tools/gis/**` and `docs/gis/**`. Every candidate stays UNVERIFIED / `routable:false`; every publish gate stays HOLD. Unknown stays UNKNOWN.

## 1. Resolution pointer is authoritative over a final-URL match (P1)

- Cause: `matchAcquiredResource()` accepted a unique `resolved_url` match without consulting the hashed `resolution_evidence` pointer. A resolver that chose `/result/resources/0/url`, followed by a redirect to resource 1's URL, was attributed resource 1's licence.
- Fix (`tools/gis/src/rights.ts`, `matchAcquiredResource`): when a pointer exists its source id, snapshot SHA-256 and `/result/resources/<n>/url` must equal the matched resource, otherwise rights generation throws ("conflicts with hashed resolution pointer") before any file is written. No pointer keeps the earlier behaviour.
- Tests: `test/rights.test.ts` "treats the hashed resolution pointer as authoritative over a conflicting final-URL match".

## 2. Metadata XML rights keep their scope (P1)

- Cause: `embeddedMetadataRights()` kept only the leaf element name, so a grant under `metadataConstraints` (constraints on the metadata record) was reported as a statement "for the described dataset".
- Fix (`rights.ts`, `classifyMetadataRightsScope`, `embeddedMetadataRights`, `generateRights`): every finding carries the namespace-qualified (Clark) ancestor `path` and a `scope`. Only `MD_Metadata/identificationInfo/*Identification/resourceConstraints/...` with one consistent namespace is `DATASET_RESOURCE_CONSTRAINTS`; `MD_Metadata/metadataConstraints/...` is `METADATA_RECORD_ONLY` (preserved as evidence, never a dataset licence, never counted against a dataset statement); anything else, mixed namespaces, or a chain containing both constraint kinds is `UNKNOWN`. Evidence `location` is now `ZIP:<member>:<ancestor path>`.
- Tests: `test/rights.test.ts` "records only explicit metadata XML rights...", "preserves ancestor scope...", the two affirmative/ambiguous `it.each` groups; `test/rights-generation.test.ts` "never promotes a metadataConstraints grant to a dataset licence (metadata|both)".
- Real evidence (sources `plateau-13104-metadata`, `plateau-13116-metadata`, store paths in `docs/gis/acquisitions/*.json`): all seven `Licensed under CC BY 4.0` statements (13104: `fld`, `htd`, `lsld`, `op`; 13116: `fld`, `lsld`, `op`) sit at
  `{http://zgate.gsi.go.jp/ch/jmp/}MD_Metadata/identificationInfo/MD_DataIdentification/resourceConstraints/MD_Constraints/useLimitation`
  (all in the default JMP namespace `http://zgate.gsi.go.jp/ch/jmp/`). That is dataset-scoped (`DATASET_RESOURCE_CONSTRAINTS`). No `metadataConstraints` element exists in either ZIP, so the earlier FILE_EMBEDDED CC BY 4.0 result is unchanged; only its evidence location and scope text became more precise. This is still a statement about the described metadata dataset, not clearance of the ZIPs or sibling resources.

## 3. Malformed coordinate nesting is never a complete bbox (P2)

- Cause: `visitCoordinates()` accepted any nesting and any array whose first two members were numbers, so `LineString coordinates [139.7,35.7,[140,36]]` produced `[139.7,35.7,139.7,35.7]` and `COMPUTED_GEOGRAPHIC`.
- Fix (`tools/gis/src/poi.ts`): nesting depth is validated per geometry type (Point 0, LineString/MultiPoint 1, Polygon/MultiLineString 2, MultiPolygon 3 levels above a position); a position is an array of at least two finite numbers and nothing else. Any malformed geometry sets `bbox: null`, `raw_coordinates_bbox: null`, `bbox_status: INCOMPLETE_MALFORMED_GEOMETRY` and `bbox_counts.malformed_geometries`. `pointCoordinates()` also rejects non-numeric members. `overlap.ts` (`isIncompleteBboxStatus`) and `coverage.ts` treat every `INCOMPLETE_*` status as UNKNOWN, never DISJOINT/OVERLAP/KNOWN.
- Tests: `test/poi.test.ts` "never reports a complete bbox for malformed coordinate nesting: ..." (9 shapes), "accepts exactly-nested valid coordinates for every supported geometry type", updated depth test; `test/overlap.test.ts` "propagates a malformed-coordinate POI through overlap and coverage as UNKNOWN, never DISJOINT".

## 4. Vintage generation requires a current network inspection (P2)

- Cause: `inspectVintages()` compared only the network report's `source_sha256` with the acquisition before using its bbox/CRS.
- Fix: new `tools/gis/src/network-evidence.ts` (`assertNetworkInspectionCurrent`, no import cycle with poi/vintage) checks `source_id`, acquisition SHA-256, current `tool_input_sha256`, and complete non-duplicate `input_sources` lineage (each hash current, own acquisition present). `vintage.ts` calls it for both E27 reports before any range request or evidence write.
- Tests: `test/vintage-acquisition.test.ts` "fails closed before fetching or writing when the network inspection has ..." (stale fingerprint, different source identity, missing lineage, stale lineage hash, lineage without own acquisition); transaction fixtures updated to current reports.

## 5. ZIP member names without the UTF-8 flag (lead finding)

- Cause: yauzl decodes unflagged names as CP437, so the S03 members read `ÉVÅhëwÄⁿò╙é╠...`, which is CP932 for 新宿駅周辺の施設情報及び施設から目的地への移動ルート情報.
- Fix: new `tools/gis/src/zip-names.ts` (`describeZipName`, built-in `TextDecoder('shift_jis',{fatal:true})`, no new dependency). `readZip` entries and the vintage central-directory members now carry `name_bytes_hex` (raw identity), `name_utf8_flag`, `name_encoding_status`, `name_cp437`, `name_utf8` and `name_cp932_candidate`. Statuses: `DECLARED_UTF8`, `DECLARED_UNICODE_PATH_EXTRA`, `ASCII_ONLY`, `CANDIDATE_CP932_UNDECLARED` (flag absent, valid CP932 without replacement or control characters), `UNDECLARED_UNRESOLVED`. `name`/`file` remain the specification decoding, so member lookups, parsing and hashes are stable. POI reports record `filename_encoding.status_counts`; the markdown member table and research packet label the candidate ("name bytes undeclared; CP932 candidate: ..."). No alias is adopted.
- Real result: all 25 S03 members are `CANDIDATE_CP932_UNDECLARED`; the PLATEAU related ZIPs are `ASCII_ONLY`.
- Tests: `test/zip.test.ts` (candidate with raw bytes and stable re-read, UTF-8 flag, undecodable bytes, ASCII).

## Regeneration

`pnpm install --frozen-lockfile`, `typecheck`, the single-worker unit suite (see Round 5 for the current count), `gis acquire --all`, `inspect-network` (4 sources), `inspect-poi` (6 sources), `inspect-vintages`, `rights`, `overlap`, `gap-packet`. `docs/gis/real-run.json` was invalidated by the report-writing commands; the lead reruns real-run and the container conversions.

## Follow-up: network reports consumed by overlap and gap packets

- `gis overlap` (`tools/gis/src/overlap.ts`) and `gis gap-packet` (`tools/gis/src/gaps.ts`) now call `assertNetworkInspectionCurrent` for every network report they read directly, before any comparison or write. The helper (`network-evidence.ts`) understands node+link pair reports (`linkSourceId`: combined `node+link` identity, combined acquisition hash, link acquisition in the lineage).
- Tests: `test/report-consumers.test.ts` "rejects stale network report ... with an unchanged acquisition SHA before writing" (old fingerprint, stale lineage hash, different identity, changed link acquisition in the pair hash) and "rejects a stale station-map network report before overlap writes", each for overlap and gap packet; `test/zip.test.ts` DECLARED_UNICODE_PATH_EXTRA (matching 0x7075 CRC) and the ignored-on-CRC-mismatch case.

## Round 5

1. **Unrecognized namespaces (P2).** `classifyMetadataRightsScope` (`tools/gis/src/rights.ts`) now requires one consistent namespace that is in `SUPPORTED_METADATA_NAMESPACES` (`http://zgate.gsi.go.jp/ch/jmp/`, `http://www.isotc211.org/2005/gmd`); otherwise the statement is preserved with scope UNKNOWN (including under `metadataConstraints`). Tests: `rights.test.ts` "requires a recognized metadata namespace...", `rights-generation.test.ts` "does not promote an affirmative statement to FILE_EMBEDDED with an unrecognized XML namespace".
2. **Textless restrictions (P2).** `embeddedMetadataRights` also emits findings of `kind` CODED (`codeList`/`codeListValue`) and LINKED (`href`) for any element in or below a rights/`*Constraints` element; their value is null, so a present coded/linked constraint makes embedded rights UNKNOWN (evidence location suffix `#CODED` / `#LINKED`). Tests: `rights.test.ts` "preserves coded and linked constraints...", `rights-generation.test.ts` "...with a coded restriction beside the affirmative text".
   - Real XML re-check (`plateau-13104-metadata`: fld, htd, lsld, op; `plateau-13116-metadata`: fld, lsld, op): the only constraint-related elements are `MD_Metadata/identificationInfo/MD_DataIdentification/resourceConstraints/MD_Constraints/useLimitation` (the CC BY 4.0 text) and its empty containers `resourceConstraints` and `MD_Constraints`. There is no `useConstraints`, `accessConstraints`, `otherConstraints`, `MD_RestrictionCode`, `metadataConstraints`, `codeListValue` or `href` in any of the seven files, so the FILE_EMBEDDED CC BY 4.0 result is unchanged.
3. **Ikebukuro package attribution (P2).** All four R1 records take the supporting CKAN package licence only when exactly one resource URL equals the source's acquired `resolved_url`; the hashed pointer `supporting_documents/ckan-metadata:/result/resources/<n>/url` is recorded per source (real: node-csv 2, link-csv 0, node-geojson 3, link-geojson 1). No match or duplicate matches leave licence and publication notes UNKNOWN with a caveat. Tests: `rights-generation.test.ts` "Ikebukuro package attribution requires exact resource membership" (3).
4. **Rights freshness (P2).** New `tools/gis/src/rights-evidence.ts` (`assertRightsReportCurrent`, `rightsEvidenceItems`) checks tool fingerprint, acquisition SHA and every evidence/declaration/publication-note hash against the current acquisition or its recorded supporting documents. `gaps.ts` calls it for every manifest rights report before any output; `summarize.ts` reports stale evidence as a problem. Tests: `report-consumers.test.ts` "rejects rights evidence with ... although the acquired file hash is unchanged" (3).
5. **Property cap (P2).** `inspectPoiGeoJson` always scans recognized literal fields (station/landmark/operator/line/name) regardless of position; skipped generic properties are `unobserved` (distribution `complete:false`, `unobserved_feature_count`, absent counts exclude such features) and `property_scan` records the cap. Test: `poi.test.ts` "inspects recognized literal fields beyond the 200-property cap...".
6. **POI publication (P2).** `inspectPoi` renders JSON and Markdown first and publishes both with `commitReportFiles`. Tests: new `test/poi-publication.test.ts` (publish together; staging failure and promotion failure each leave the previous JSON and Markdown untouched).

Regenerated in order: `inspect-network` x4, `inspect-poi` x6, `inspect-vintages`, `rights`, `overlap`, `gap-packet`. The unit suite is 383 tests in 27 files.
