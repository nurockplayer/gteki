# GTEki GIS data factory

An isolated TypeScript/ESM package for acquiring, inspecting and converting the bounded sources in Issue #10. Requires Node 26 and pnpm. All implementation and reports stay under `tools/gis/` and `docs/gis/`; the station and shared-core packages are not inputs or outputs of this lane.

Every normalized object is **UNVERIFIED**. Candidate graphs have `routable: false`; GLBs have `navigation_use: NOT_FOR_ROUTING` and `geometry_status: UNVERIFIED_RAW_CONVERSION`. File inspection, codelist labels and successful conversion do not establish public access, current conditions, floor alignment, accessibility or a passenger route. Source-native floor labels remain separate, and missing heights are never derived from a floor name.

## Install and checks

```sh
pnpm --dir tools/gis install
pnpm --dir tools/gis install --frozen-lockfile  # use in CI
pnpm --dir tools/gis typecheck
pnpm --dir tools/gis test
pnpm --dir tools/gis test:real
```

Run package commands sequentially. Concurrent pnpm 12 invocations were observed relinking the same `node_modules` during validation; the serial validation driver avoids that contention:

```sh
pnpm --dir tools/gis exec tsx src/validate.ts
```

It records frozen install, typecheck, synthetic tests, optional real tests and offline verification in `docs/gis/validation.json`, with full logs in the store. Offline verification preserves original HTTP acquisition timestamps and writes a separate latest offline-check receipt.

The package has its own `pnpm-workspace.yaml`, `package.json` and lockfile. No root package files are needed. There are no project lifecycle install scripts; the sole permitted dependency build is esbuild, used by tsx/Vitest. Exact versions are pinned. Runtime libraries are saxes (streaming XML with DTD rejection), yauzl (bounded ZIP reads), proj4 (explicit horizontal projection), earcut (polygons and holes), gltf-transform/core (GLB writing/readback), csv-parse (CSV syntax) and yaml (auditable source manifest). Node built-ins handle HTTP, hashes, CLI arguments, encoding and files. No Python dependencies or external archive executables are used. Optional real codebook tests require Poppler's `pdftotext` on `PATH` (or its path in `GTEKI_GIS_PDFTOTEXT`), invoked locally with `-raw`; no PDF content is fetched by the tests.

Default geometry/network tests use hand-written, clearly marked SYNTHETIC fixtures. The separate GSI control fixture records the two official calculator responses supplied by the lead; tests never fetch them. The optional real suite verifies every stored acquisition against its recorded SHA-256, checks each transcribed label against normalized PDF text, checks deterministic inventory bytes twice, and writes a bounded conversion to the external store. Without the complete source store, that suite is explicitly skipped.

## Store and source records

`GTEKI_GIS_STORE` selects the external store; the default is `~/.gteki/gis-store`. In restricted worktrees, the verification commands can use `export npm_config_store_dir="${GTEKI_GIS_STORE:-$HOME/.gteki/gis-store}/pnpm-store"` to keep pnpm's cache in the external store. This was used for this lane's final verification; package pins and lockfiles are unchanged.

```text
<store>/raw/<sha256>/<filename>          exact downloaded bytes, including catalog JSON
<store>/tmp/                           transient streaming downloads
<store>/out/*.glb                       real-data geometry
<store>/out/*.provenance.json           complete geometry provenance
<store>/out/*.candidate-graph.json      unverified source graph candidates
<store>/out/*inventory-detail.json      every semantic gml:id and its full metadata
<store>/out/run-logs/                   actual CLI stdout/stderr by run
```

Acquisition records contain store-relative paths. A store hash is rechecked before inspection or conversion. The git commit field identifies the checkout base; this implementation is deliberately left uncommitted for the lead, so that commit alone is not a snapshot of the new tool. Current run and validation receipts record a digest of source code, manifest, codebooks, frames, tests/fixtures and package configuration. Conversion identity includes frame contents, filters, semantic dictionary inputs and tool identity; dictionary archive/member hashes are retained in inventories and sidecars. A different dictionary, tool or frame preserves a distinct conversion path.

The checked-in manifest has exactly 34 bounded sources: the original 19 entries remain unchanged, with 15 additions for S10 shops, S03 facilities/specification/reference/landing, six Tokyo/G空間/Hokonavi CKAN snapshots, two PLATEAU 2025 related ZIPs and PLATEAU site policy. Catalog-dependent resources resolve against freshly acquired JSON and record the snapshot hash and exact resource pointer. Raw files stay in the private external store. Expected sizes are actual previously acquired byte counts where known; catalog-declared sizes remain separate evidence. Redirected final URLs are recorded. Downloads are sequential with two retries, a global 128 MiB cap and smaller per-source caps for new inputs; size mismatch fails acquisition. Offline acquisition performs no HTTP requests. Whole city archives are never acquired. The separate vintage command reads bounded HTTP ranges only.

The ignore file is a safety net, not a destination: never put downloaded bytes, real GLBs or raw archives anywhere in the repository. Only manual synthetic XML/CSV/GeoJSON fixtures belong in tests.

## Commands

```sh
pnpm --dir tools/gis gis sources
pnpm --dir tools/gis gis acquire --all
pnpm --dir tools/gis gis acquire plateau-13116-ubld-53394576
pnpm --dir tools/gis gis acquire --all --offline
pnpm --dir tools/gis gis inspect-citygml plateau-13116-ubld-53394576
pnpm --dir tools/gis gis inspect-citygml plateau-13104-ubld-53394536
pnpm --dir tools/gis gis frame-from-envelope plateau-13116-ubld-53394576 ikebukuro-plateau-ubld-v0
pnpm --dir tools/gis gis crs-roundtrip ikebukuro-plateau-ubld-v0
pnpm --dir tools/gis gis citygml-to-glb plateau-13116-ubld-53394576 --frame ikebukuro-plateau-ubld-v0 --max-polygons 50
pnpm --dir tools/gis gis citygml-to-glb plateau-13116-ubld-53394576 --frame ikebukuro-plateau-ubld-v0 --bbox-local=-20,-20,20,20
pnpm --dir tools/gis gis citygml-to-glb plateau-13116-ubld-53394576 --frame ikebukuro-plateau-ubld-v0 --ids SOURCE_ROOM_ID
pnpm --dir tools/gis gis inspect-network hokonavi-ikebukuro-walk-node-csv
pnpm --dir tools/gis gis inspect-network hokonavi-ikebukuro-walk-node-geojson
pnpm --dir tools/gis gis inspect-network hokonavi-oedo-shinjuku-network-geojson
pnpm --dir tools/gis gis inspect-network hokonavi-oedo-shinjuku-stationmap-geojson
pnpm --dir tools/gis gis overlap
pnpm --dir tools/gis gis gap-packet
```

`--ids` selects literal semantic IDs and their XML descendants, including source doors and surfaces. It does not create relationships from group membership, proximity, names or a shared floor label. `--bbox-local` requires four nonblank finite coordinates and selects whole polygons whose EN bounds intersect the rectangle; it does not clip or invent boundary geometry. The conversion API also checks the exact array length. `--max-polygons` caps selected polygons considered in source order and records excluded counts. There is no collision-proxy generator, snapping, floor-height inference or source-to-source graph join.

CityGML XML is streamed without a DOM. DTDs and external entities are rejected. ZIP members are read in-process; absolute paths, parent segments, encrypted entries, symlinks and excessive expanded sizes are rejected. Element classification uses namespace URI and local name; qualified spelling is retained as provenance. Anonymous semantic objects retain their own boundary and unknown source identity, so their metadata cannot migrate into a parent. Polygon metadata cannot become room metadata. Namespace/schema strings are recorded, never fetched or executed. Function labels come only from the actual matching codeSpace file; unresolved codes have a null label. A single declared CityModel envelope CRS is used explicitly for coordinates that omit a local CRS, and that interpretation is recorded; conflicting, unsupported or missing coordinate context fails.

A category such as “stairs and ramps” is reported as that combined source category, with individual facility types still UNKNOWN. Likewise, `bldg:Door` counts describe source semantic objects, not a count of physical doors; individual versus aggregate physical representation remains UNKNOWN unless separately evidenced.

CSV decoding first validates UTF-8, then Shift_JIS; the selected encoding is recorded. Mapping uses literal supported headers and preserves all raw attributes. GeoJSON with no `crs` reports the RFC 7946 longitude/latitude default as an assumption. Topology statistics use only source link endpoints. Coordinate gaps, duplicate IDs and absent geometry prevent conclusive endpoint comparisons; they do not trigger repairs. Station-map files produce layer inventories only.

GeoJSON features share an explicit node/link/unknown classification between inspection and export. Unsupported or conflicting evidence stays in `other_features`; a polygon or unidentified null geometry does not become an edge. Literal floor labels use explicit forms or dedicated source fields; generic descriptions such as 階段室 and 地下通路 remain UNKNOWN. Namespace-qualified GML mathematical topology is observed separately from renderable objects and never establishes navigable connectivity.

`overlap` reads the current CityGML envelope and Hokonavi layer inventories. It retains each source bbox/CRS, validates geographic ranges in the declared axis order, compares the horizontal JGD2011 geographic rectangles for intersection/disjointness, and projects bbox boundaries to EPSG:6677 to estimate their minimum separation. Invalid coordinates or non-finite projection results stay UNKNOWN; axes are never guessed. Each edge is sampled into 32 line segments; the reported metric distance is a numerical bbox-boundary approximation, not a feature distance. Projected axis-aligned envelopes are included as context. R1 alone uses spec-based EPSG:6668 inference, and its layers and pair metrics carry `CONDITIONAL_ON_INFERRED_CRS`. Other CSV sources retain UNKNOWN CRS. Bbox overlap never establishes shared floors, matching features or connectivity. The gap packets incorporate computed coverage HOLD items.

## Coordinates and geometry

Source EPSG:6697 is serialized latitude, longitude, orthometric TP height. The tool rejects a different CRS, a missing third ordinate or latitude/longitude outside Japan. EPSG:6677 is defined explicitly as Japan Plane Rectangular CS IX, GRS80, latitude of origin 36°, longitude of origin 139°50′, scale 0.9999, false East/North zero. Local coordinates subtract the explicit rounded projected envelope-centre origin. This is an arbitrary processing origin, **not a surveyed station reference point**. Heights remain orthometric; no geoid/ellipsoid conversion occurs. glTF maps East/Up/−North to x/y/z, in metres, right-handed and Y-up.

CRS tests cover the parameter origin, inverse roundtrips and two independent GSI JGD2011 zone IX numerical controls supplied by the lead (retrieved 2026-10-20). The [Ikebukuro control](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.729710&longitude=139.711376) and [Shinjuku control](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.692857&longitude=139.700825) are recorded in `test/fixtures/gsi-bl2xy-controls.json`; GSI publicX is Northing and publicY is Easting. Tests require each axis within 0.0005 m without network calls. These projection controls do not validate station alignment or source currency.

Two streaming SAX passes collect referenced polygon targets and then inspect definitions and uses. Surface orientation signs compose; unsupported or missing targets are reported. Inventory `polygon_count` counts inline definitions plus resolved uses, while `polygon_definition_count` counts definitions once. Per-object records separate inline definitions, resolved uses and unique definition IDs. Room selection counts unique definitions in its source subtree.

Conversion projects each polygon onto its Newell plane, triangulates holes, retains original 3D vertices with the source-use orientation, and counts skipped degenerate/invalid polygons. Boundary/opening representations keep their own orientation. When a selected boundary/opening already represents a polygon, its duplicate Room solid reference is retained in provenance instead of drawing a second coincident shell; a solid use without a selected boundary is converted with its own sign. Per-object sidecars record the use, context, orientation and disposition. Each retained semantic object has native identity and provenance in node extras; an unidentified object has a processing key and null native identity with UNKNOWN status. Meshes use neutral untextured surface-class materials. The resulting GLB is read back to compare semantic node and triangle counts and local bounds within 1 mm. This is a serialization/conversion check, not a visual, collision or navigation acceptance test.

## Reproduce the complete real run

Run these commands sequentially (the validation driver runs frozen installation, typecheck, default tests, real tests and offline acquisition verification in that order):

```sh
pnpm --dir tools/gis install --frozen-lockfile
pnpm --dir tools/gis typecheck
pnpm --dir tools/gis test
pnpm --dir tools/gis gis acquire --all
pnpm --dir tools/gis exec tsx src/real-run.ts
pnpm --dir tools/gis exec tsx src/validate.ts
pnpm --dir tools/gis exec tsx src/summarize.ts
```

The runner calls the public CLI in the requested order: acquisition; both GML inspections; frame creation/roundtrips; the smallest positive-polygon Room subtree and a full conversion for each city; R1 CSV and GeoJSON pair / S01 inspections; POI/specification inspection; bounded 2023 vintage reads; rights/research generation; bbox overlap; gap packets. Each invocation records its command, exit code, elapsed time and external log pointer. Selection evidence is computed from the real feature tree. Any failed CLI invocation is recorded and stops the runner immediately; derived reports are not refreshed after failed prerequisites. Full-file memory/time evidence is emitted with each successful conversion. The current receipts are `docs/gis/real-run.json` and `docs/gis/validation.json`; superseded receipts are archived under `docs/gis/history/`.

## Rights, report size and handoff

PLATEAU GML is recorded as CC BY 4.0 on the dossier's metadata evidence; preserve attribution, license link, source/version and modification notice. The sidecar embeds the source manifest and acquisition record. Hokonavi is recorded as PDL 1.0, subject to attribution, modification notice and third-party exclusions. S01's stated availability deadline is 2027-03-12; this is a source availability date, not an invented revocation of compliant derivatives. Codelist/schema/metadata archive rights stay unknown unless evidence is separately established. No report grants public-product or redistributable-asset approval.

The brief asks for every feature in a Git inventory while also imposing a small-metadata-only Git boundary. Full feature inventories occupy tens of megabytes. To honor that boundary, the complete every-feature tree and semantic evidence IDs live in the external store. The committed inventory holds counts, namespaces, envelope, semantic summaries and a hashed detail pointer. This is the intentional report-placement deviation; no source records are discarded. The lead can audit the detailed JSON locally or regenerate it from the hashes.

See `docs/gis/README.md`, the generated summary, real-run receipts and per-station gap packets. Neither a source file's existence nor an ABSENT_IN_FILE result proves anything about an omitted or currently changed station area. Both stations remain HOLD for passenger-routing claims until the station lead obtains the missing current-world and operator evidence.

## Blender import check (optional)

`scripts/blender_import_check.py` is a headless check that a converted GLB imports into Blender with the expected local frame. It needs Blender 4.x/5.x, installed via Homebrew:

```bash
blender -b --factory-startup -P tools/gis/scripts/blender_import_check.py -- \
  "$GTEKI_GIS_STORE/out/<run_id>.glb" docs/gis/conversions/<run_id>.json /path/outside/repo/<name>
```

After glTF import, Blender is Z-up: x = East, y = North, z = Up. The script compares the imported world bbox with the recorded `bbox_local_ENU`, using a 1 mm tolerance. It writes `<name>.import-check.json` and renders top and perspective Workbench images for review. Renders inherit the PLATEAU CC BY 4.0 attribution obligation and are kept out of Git. Committed results are in `docs/gis/evidence/`.

For a cached replay, use `pnpm --config.offline=true --dir tools/gis exec tsx src/real-run.ts` (then `validate.ts` and `summarize.ts`) with `GTEKI_GIS_OFFLINE=1` in the environment. The pnpm option prevents automatic dependency downloads before the driver starts; the environment switch makes the drivers check cached acquisitions and run frozen installation offline. Missing cached inputs fail the run.

## Versioned walking-network codes and coverage

`codebooks/mlit-walk-network-{2018-03,2024-07}.json` are fingerprinted literal transcriptions, with source SHA, table and printed page per field. `attribute_decoding` reports observed code distributions, per-version undefined codes and label counts, overall compatibility and an always-UNKNOWN applicable version. Membership does not test required-column completeness or current conditions. Raw candidate attributes stay verbatim; decoding appears only in reports. The 2018 waterway code 2 has no label printed in table 3.2 (p15); its null label is explicitly MANUAL with a reason. Real tests normalize whitespace only and check all other labels against acquired PDF text. Intermediate weekday names are not supplied where only the 1–7 range is printed.

The 2024 rank cross-check reads each `r_method` digit independently. Field survey (digit 1) uses all table 3.3 intervals (p21): width 1→Z, 2→A, 3/4→S; slopes 1→S, 2→A, 3/4→B, 5/6→C, 7/8→Z; steps 1→S, 2→A, 3→B, 4→C, 5→Z; every 99→X. Mobility trace (digit 2) uses only red-underlined readings, as required on p20: width code 1→C; slope/step A/B/C use upper thresholds including zero, and their Z bounds remain supported. Width S/A/Z/X and slope/step S/X are `not_checkable` for trace: S's 0% / 0cm cells are black, not red-underlined on p21. Thus code-1 triplet CSS with method 222 has consistent width but not-checkable slope and step. A missing/blank/other method digit uses only supported survey/trace readings; zero slope/step retain S from survey and A/B/C from trace, with accepted membership reported as `method_unknown`. The check never repairs rank or establishes accessibility.

R1 CSV/GeoJSON comparison joins unique IDs, compares all shared fields, and compares CSV lon/lat with GeoJSON Point coordinates. Numeric representation differences are compared numerically without changing either raw value; blank and null both mean absent. CSV links contain no polyline, so geometry equality is UNKNOWN. GRS80 Vincenty length sums only supplied segments and compares literal distance with a 0.05 m rounding threshold plus 0.000001 m floating tolerance. The exact R1 data have 30 links beyond that threshold; the result is `NO_VERDICT`. Low residuals support lon/lat-degree and metre consistency under the stated assumption but cannot identify the datum. EPSG:6668 remains `INFERRED_FROM_SPEC`, citing §2.2 (2018 p5; 2024 p4); RFC 7946 is an assumption only, not evidence for JGD2011.

`overlap` also computes R1 node containment in the acquired PLATEAU geometry bbox by literal floor/in_out and intersection counts for supplied rt_struct 5/7 polylines. This is conditional bbox evidence only. JIS X 0410 codes use 40′×1° first meshes, 5′×7.5′ second meshes and 30″×45″ third meshes; tests include Tokyo Tower → 53393599 and nominal 53394536 bounds. The arithmetic follows the [Statistics Bureau regional-mesh explanation](https://www.stat.go.jp/data/mesh/gaiyou.html); this reference was not fetched in this lane under the network restriction. Closed bboxes include boundary-touching cells. Catalog coverage records latest files, nominal mesh bounds and computed geometry bboxes separately; nominal meshes never establish coverage. Older vintages remain UNKNOWN. See `docs/gis/research/network-codes-and-coverage.md` and generated gap packets for source hashes and findings.


## POI and facility rights lane

```sh
pnpm --dir tools/gis gis acquire --all
pnpm --dir tools/gis gis inspect-poi toei-stores-shinjuku-csv
pnpm --dir tools/gis gis inspect-poi toei-stores-shinjuku-nishiguchi-csv
pnpm --dir tools/gis gis inspect-poi tokyo-shinjuku-facilities-zip
pnpm --dir tools/gis gis inspect-poi tokyo-shinjuku-facilities-spec-pdf
pnpm --dir tools/gis gis inspect-poi plateau-13104-related-2025
pnpm --dir tools/gis gis inspect-poi plateau-13116-related-2025
pnpm --dir tools/gis gis inspect-vintages
pnpm --dir tools/gis gis rights
pnpm --dir tools/gis exec tsx src/real-run.ts
pnpm --dir tools/gis exec tsx src/validate.ts
pnpm --dir tools/gis exec tsx src/summarize.ts
```

The ordered real run regenerates these reports before overlap and gap packets. `summarize` refuses stale POI, rights or vintage fingerprints or acquisition lineage, failed/missing commands and invalidated receipts. Run summarize last. Report-writing CLI commands invalidate an earlier real-run receipt.

`inspect-poi` records literal CSV headers, UTF-8/Shift_JIS detection, row/blank/distribution counts, explicit coordinate headers, bounded ZIP inventories, GeoJSON geometry/property/source fields and declared CRS. Undeclared CRS stays unknown; RFC 7946 is recorded only as an assumption. S03 PDF evidence uses local `pdftotext` (or `GTEKI_GIS_PDFTOTEXT`) with page references. 新宿 S01/E27 and 新宿西口 E01 stay separate. No text locations are geocoded and no missing IDs, coordinates, heights, floor levels or connectivity are invented. Literal route candidates remain UNVERIFIED / routable:false. GeoJSON Point observations preserve raw ordinates and their declared or assumed reference system. Geographic lon/lat and bboxes require a recognized geographic CRS or an explicit RFC 7946 assumption, plus valid longitude/latitude ranges; projected and S03 path local coordinates keep geographic fields null. Reaching the coordinate-visit limit yields a null bbox with `bbox_status: INCOMPLETE_LIMIT_REACHED` and visit/position counts. Overlap and coverage treat such a bbox as incomparable, including conditional comparisons.

The vintage reader obtains 2023 v4/v3 archive URLs from the acquired G空間 package, requires a strong ETag on every response, verifies exact HTTP 206, Content-Range and the unchanged full archive length, and sends only that strong ETag in If-Range. Weak/missing/malformed ETags and Last-Modified alone fail closed before any acquisition record is written; no EOCD/central-directory re-read fallback is implemented. Each directory/member acquisition records `validator_type: STRONG_ETAG`. It parses EOCD/ZIP64 and bounded central directories, and lists nominal ubld meshes. Directory reads have a 16 MiB budget per archive; selected exact members have explicit compressed/uncompressed caps. Only members whose nominal meshes touch E27's mesh/bbox meshes are range acquired. Stored/deflate members must pass CRC32 and uncompressed-size checks and receive an uncompressed SHA-256. Every range, timestamp and validator is recorded; raw ranges and member bytes are content-addressed outside Git. The same CityGML scanner inventories selected members without borrowing 2025 dictionaries or producing GLB.

`docs/gis/rights/README.md` and structured JSON per manifest source and acquired vintage member distinguish package declarations, exact resource declarations, site terms and file observations. Only integrity-checked, hashed acquired evidence can populate a licence. Package inheritance for catalog files requires an exact acquired resource URL/asset-folder match; municipality/year or matching filenames alone establish no relationship. Metadata XML rights statements keep their described-dataset scope. The dedicated `hokonavi-oedo-shinjuku-package` CKAN snapshot supplies package licence and publication-period evidence for exact member resource URLs. Legacy licence labels remain historical inputs. Unknown stays unknown; every exact-resource publish gate defaults to HOLD, with required attribution/modification obligations, third-party-original and individual-law caveats, and explicit clearance requirements. The generated research packet is `docs/gis/research/poi-rights-and-vintages.md`.

## Lane D round 1b checks

The single-worker unit suite has **369 passing tests in 26 files** (real-source suite excluded). Run `pnpm --dir tools/gis exec vitest run --exclude test/real.test.ts --no-file-parallelism --maxWorkers=1` on the shared 16 GB host. Round 1b ran frozen installation, typecheck, all 34 acquisitions, all six POI inspections, bounded vintage inspection, rights/research generation, overlap and gap packets. The lead runs real-run, real tests, GLB conversions and final summary validation later.

Rights generation prepares every JSON record, the register, research packet and real-run invalidation before staging any output. A preparation error leaves all reports untouched; staging/promotion errors restore the old bundle. This does not provide simultaneous multi-file visibility or crash recovery if the host/process dies during promotion. S03 redirects are matched to the exact `expected_url` only with the acquired package hash and resolver JSON pointer; evidence says which field matched. E27 licences come from the new dedicated package acquisition, with exact resource URL evidence and no resource-level inheritance. PLATEAU child URLs require exact parent asset-folder membership; a shared filename or municipality/year is insufficient. In the acquired 2025 snapshots all eight ubld/metadata/codelists/schemas parent matches are absent, so their package licences stay UNKNOWN. Both metadata ZIPs contain literal CC BY 4.0 statements about the described datasets; these are recorded separately without clearing the ZIPs or sibling resources.

Round 4 fixes (`docs/gis/research/poi-rights-round4.md`): a hashed resolution pointer is authoritative over a final-URL match (conflict throws before writing); metadata XML rights keep their namespace-qualified ancestor path and only `identificationInfo/*/resourceConstraints` statements are dataset-scoped (`metadataConstraints` is METADATA_RECORD_ONLY, anything else UNKNOWN); GeoJSON coordinate nesting is validated per geometry type and malformed geometry yields `INCOMPLETE_MALFORMED_GEOMETRY` with a null bbox; vintage generation requires current network-inspection identity, tool fingerprint and lineage; ZIP member names keep raw bytes (`name_bytes_hex`) with the CP437 specification decoding and, only when the UTF-8 flag is absent and the bytes are valid CP932, a labelled `name_cp932_candidate`.
