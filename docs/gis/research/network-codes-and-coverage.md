# Walking-network codes and PLATEAU coverage

This is file evidence for the GIS research lane. All candidates remain UNVERIFIED, candidate graphs `routable:false`, and GLBs NOT_FOR_ROUTING. Decoding means a literal label lookup under a named specification; it does not establish current conditions, accessibility or a route. Raw attributes are preserved verbatim.

## Acquired evidence

| Source ID | Bytes | SHA-256 |
| --- | ---: | --- |
| hokonavi-ikebukuro-walk-node-csv | 279843 | `2477e6f27d8be30b3e57ee6849a36b5d8c9f56e1d2ff34956fe5934b71f4920a` |
| hokonavi-ikebukuro-walk-link-csv | 370498 | `a0f8376556bc7c920be10c27181d8a4219745b55ec2bea6938d28dfeadde80d2` |
| hokonavi-ikebukuro-walk-node-geojson | 926326 | `4960a88bd2a6a32e14c0b980ac9328148eb63091398d17823b48a19b80824b33` |
| hokonavi-ikebukuro-walk-link-geojson | 1723897 | `f6b84c9c6d05559f04b4a4796b9286f6bfd1bdb4aea0b112666b3d7585b3eab6` |
| mlit-walk-network-spec-2018-03 | 2440666 | `9825cf98bb8c069f9717dd8215d54c61e89d66090e266502c7221219136fb974` |
| mlit-walk-network-spec-2024-07 | 2174437 | `963f2f85791b9ff1199c0980a4e99f39c98ec26fc376de6dc9f343d10522c0a4` |
| mlit-walk-network-spec-2024-07-diff | 306273 | `1a0b007099ba03467b564b9daf74bc198efdbbecc874ae1a0eed36e450326773` |
| plateau-catalog-ubld-mesh-533945 | 2540 | `ab284eeac06d0844c0216c0f14951d0c9b8e70c89d2048708fab3264187e7b9e` |
| plateau-13104-ubld-53394536 | 43830765 | `013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977` |
| plateau-13116-ubld-53394576 | 35427963 | `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09` |

The acquisition JSON records contain exact official/resolved URLs, HTTP metadata and external-store paths. The six additions bring the manifest to 19 entries; the original 13 manifest entries are unchanged. The same acquire command also captures the following bounded supporting documents, nested under the parent acquisition record:

- hokonavi-ikebukuro-walk-node-geojson / ckan-metadata: 5618 bytes, SHA-256 `82c7ecca22de1c08b8c0ad4b0c1c362af032f80d745c74d5c9a06b4b8f5ff039`, https://ckan.hokonavi.go.jp/api/3/action/package_show?id=nwd_ikebukuro.
- mlit-walk-network-spec-2018-03 / site-terms: 10457 bytes, SHA-256 `8d73d659e9fa5f64a24499428e8a8599b160a954cb5ffb2aacac898ab19f200b`, https://www.mlit.go.jp/link.html.
- mlit-walk-network-spec-2018-03 / spec-landing: 8781 bytes, SHA-256 `6db0d9b2ef922856549d2459323efe534b838cc73be6f01826f656e0fee42838`, https://www.mlit.go.jp/sogoseisaku/soukou/sogoseisaku_soukou_tk_000056.html.

## Specification and rights evidence

The acquired [2018-03 specification](https://www.mlit.go.jp/common/001244374.pdf), §2.2 printed p5, and [2024-07 specification](https://www.mlit.go.jp/sogoseisaku/soukou/content/001757259.pdf), §2.2 printed p4, both prescribe geographic JGD2011. These are specification statements, not file declarations or proof that a historical dataset follows either version.

The codebooks retain per-field source ID, SHA-256, table and printed page. Link table 3.2 is on 2018 pp14–16 and 2024 pp13–15. Both versions include optional `tfc_restr` and other coded link fields; 2024 adds rank and r_method. The node tables are 2018 table 3.6 p30 and 2024 table 3.8 p33. Floor explanations are 2018 p31 and 2024 p35: 0 denotes outdoor ground, -1 denotes basement first, and intermediate values normally use 0.5 increments; 0.1 increments are also permitted, with the location-code convention requiring 0.5. These are ordinal labels, never heights or operator-floor equivalences.

The codebooks include rt_struct, route_type, direction, width, vtcl_slope, lev_diff, tfc_signal, tfc_s_type, brail_tile, elevator, roof, tfc_restr, condition, handrail, waterway, bus_stop, facility, door_type, main_user, no_serv_d, node in_out and the numeric floor rule. The 2024 book additionally contains rank letters, r_method and table 3.3 thresholds. A real test extracts each acquired PDF with Poppler `pdftotext -raw` and checks every transcribed label and rule after whitespace normalization only. No text or unit glyph is silently normalized beyond whitespace.

One entry is **MANUAL**: 2018 table 3.2 p15 `waterway=2`. The PDF literally prints a bare “2” between code 1 and code 99 without a Japanese label. Its label is null/UNKNOWN; the 2024 label is not copied backwards. No non-null label requires a MANUAL layout exemption. In `no_serv_d`, the printed range names Monday and Sunday only; the codebook does not invent labels for intermediate digits.

All three acquired PDFs were checked in their full extracted text for copyright, rights, license and reuse notices; no separate rights notice was found. The acquired [MLIT site terms](https://www.mlit.go.jp/link.html) state a PDL 1.0 basis where no separate rights statement applies. The manifest records that site-terms basis, attribution and modification notice, with conditional rights and a HOLD publish gate. This is the recorded reuse basis, not independent legal clearance of third-party material. The new catalog snapshot's rights remain UNKNOWN.

## Literal decoding and R1 representation equality

The acquired CKAN metadata for `nwd_ikebukuro` cites the 2024-07 specification while reporting last update 2019/01/28. CSV headers include rank/r_method/maint_date and node elevation. Observed slope codes 7/8 and step codes 3/5 are outside the 2018 table. Accordingly the observed coded values are incompatible with 2018-03 and compatible with 2024-07. `applicable_spec_version` remains `{value:null,status:"UNKNOWN",candidates:["2024-07"]}`. Compatibility is defined-code membership of observed nonblank values, not required-field completeness or a provenance verdict.

The 1,887 unique node IDs and 2,196 unique link IDs match between the CSV and GeoJSON pairs. Every shared attribute matches (numeric fields compared by numeric value; other text exact; null/blank both absent), and all 1,887 CSV node lon/lat coordinates equal the GeoJSON Point positions exactly. CSV-only fields and every per-field difference count are reported, including the CSV-only elevation/r_method fields. CSV links do not supply polylines, so link-geometry equality is not established.

The 2024 rank cross-check reads each `r_method` digit independently in width, longitudinal slope, step order. The [acquired 2024 specification](../acquisitions/mlit-walk-network-spec-2024-07.json), §3.3.2 2) printed p20, requires all survey bounds but only the red-underlined trace readings of table 3.3 p21. Figure 3.3 p22 explicitly allows rank B for a 2 cm step; §3.3.2 3) p22 gives the method-digit order. Observed attribute-code intervals come from table 3.2 p13. The exact allowed sets are encoded in `tools/gis/codebooks/mlit-walk-network-2024-07.json` with those page citations:

| Component | Observed code | Survey (digit 1) | Mobility trace (digit 2) |
| --- | --- | --- | --- |
| width | 1 | Z | C |
| width | 2 | A | not_checkable |
| width | 3 / 4 | S | not_checkable |
| width | 99 | X | not_checkable |
| vtcl_slope | 1 | S | A, B, C |
| vtcl_slope | 2 | A | A, B, C |
| vtcl_slope | 3 / 4 | B | B, C |
| vtcl_slope | 5 / 6 | C | C |
| vtcl_slope | 7 / 8 | Z | Z |
| vtcl_slope | 99 | X | not_checkable |
| lev_diff | 1 | S | A, B, C |
| lev_diff | 2 | A | A, B, C |
| lev_diff | 3 | B | B, C |
| lev_diff | 4 | C | C |
| lev_diff | 5 | Z | Z |
| lev_diff | 99 | X | not_checkable |

For trace slope A/B/C the readings are ≤5/8/18%; for trace step A/B/C they are ≤2/5/10 cm, including zero. Slope S (0%) and step S (0 cm) are printed in black without red underlining on p21. Under p20's instruction, both S readings are therefore `not_checkable` for trace regardless of observed code; survey S still means exactly zero. Only width C is red-underlined in the width column; p20 supplies no explicit trace reading for width S or A. The p21 width footnote assigns <1 m to Z for survey and C for trace. Only observed width code 1 with rank C is checkable for trace; all other width codes and width S/A/Z/X readings are `not_checkable`. X has no numeric trace threshold in any component. Slope Z (>18%) and step Z (>10 cm) are themselves red-underlined in the acquired table and retain their bounds. All remaining accepted trace readings were checked against those underlined cells; no other non-underlined cell supplies acceptance.

A missing, blank or other method digit uses the union of supported survey and trace sets for that component/code. For width codes 2/3/4/99 only the survey reading is available; unsupported trace readings never add acceptance. Width code 1 still has survey Z and trace C. Slope/step code 1 retains S only from survey and A/B/C from trace; other slope/step codes cannot accept S. Membership is `method_unknown`, never plain `consistent`; values outside the union are `inconsistent`. Unknown/unsupported codes or malformed ranks stay `not_checkable`. For example, `{width:1, vtcl_slope:1, lev_diff:1, rank:"CSS", r_method:"222"}` has consistent width C and `not_checkable` slope/step S, giving a `not_checkable` link; without a method it is `method_unknown` because survey supports the two S readings. Link-level precedence is `not_checkable`, then `inconsistent`, then `method_unknown`, then `consistent`; component evidence remains visible even when a triplet is only partly checkable. Both the link totals and each component include source-native `link_id` lists for `inconsistent` and `not_checkable`, capped at 100 per list, with explicit truncation and unavailable-ID counts. The check reports only and never corrects source values or promotes verification, routing or applicable-spec status.

<!-- rank-results:start -->
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
| E27 network | vtcl_slope | `["value_sha256:a9b08f56f1dd49af2654254d40f9a2a3f24392feee109025bcb3796744810e74"]` | `[]` | 0 / 0 | 0 / 0 |
| E27 network | lev_diff | `[]` | `[]` | 0 / 0 | 0 / 0 |

R1 results retain method uncertainty; they do not assert survey/trace provenance. The E27 slope mismatch remains an observation and is not corrected. Applicable specification versions remain UNKNOWN and every candidate remains UNVERIFIED and not routable.
<!-- rank-results:end -->

Literal co-occurrences: all 35 nodes with nonzero numeric floor have in_out=1. Eight rt_struct=5 links have endpoint floor pairs (-0.5,-0.5):1, (-1,-1):3, (-1,0):1, (0,-1):1, (0,0):2. Eighty-three rt_struct=7 links have (0,0):81 and (0,0.5):2. These are source counts only.

## Candidate acquisition provenance

Each feature in the R1 node/link GeoJSON pair receives its originating acquisition source ID, SHA-256 and member (`node.geojson` or `link.geojson`) before the arrays are combined. Classification does not select provenance: conflicting node/link identifiers remain `unknown` with null native ID, while cross-classified features retain their actual file origin. The CSV pair already assigns source IDs and hashes from the input file arrays, independent of row identifiers; regressions cover conflicting identifiers in both CSV files too. No source values or candidate verification/routability states are changed.

## R1 CRS and distance evidence

Neither acquired R1 GeoJSON has a `crs` member. RFC 7946 §4's default longitude/latitude WGS84 interpretation is recorded as an **assumption only**, conditional on conformance; it is not evidence that the data use JGD2011. The R1 reports represent EPSG:6668 as `INFERRED_FROM_SPEC`, citing both acquired specification hashes and printed pages. This status is distinct from a file-declared CRS. Endpoint and overlap metrics relying on it carry `CONDITIONAL_ON_INFERRED_CRS`. No other source receives this inference.

The check sums horizontal Vincenty inverse distances on GRS80 over supplied polyline segments, assuming longitude,latitude degrees. No vertical distance or segment joining is invented. The GRS80 equatorial one-degree analytic value provides an independent numerical control (a × π/180 with a=6,378,137 m). Nonconvergence and invalid positions are skipped with counts.

All 2,196 links are comparable: median absolute residual 0.025748 m, p95 0.047574 m, p99 0.050444 m, maximum 0.054596 m. Of these, 2,166 satisfy 0.05 m plus **0.000001 m** float tolerance, and 30 exceed it. The result is **NO_VERDICT**, not `CONSISTENT_WITH_LON_LAT_DEGREES`. Low residuals are observations consistent with lon/lat-degree axes and metre-scale lengths under the assumption, but the requested all-link threshold fails. Even a successful check could not distinguish JGD2011, WGS84 and Tokyo Datum. The spec-based CRS remains inferred and its metrics conditional.

## Bbox and nominal mesh coverage

The conditional R1/Ikebukuro geometry-bbox check contains 176 nodes: 174 have literal floor=0/in_out=1, and two have floor=0.5/in_out=1. No rt_struct=5 link intersects that bbox; 45 rt_struct=7 links intersect it. Segments crossing the rectangle are counted even when neither endpoint is inside; a merely overlapping link bbox is insufficient. This is bbox evidence only, with no feature correspondence.

JIS X 0410 computation uses first meshes 40′ latitude ×1° longitude, second meshes 5′×7.5′ and third meshes 30″×45″. Closed bbox boundaries include cells on either side of an exact boundary. Tests include the Tokyo Tower control (139.745433,35.658581) → 5339 / 533935 / 53393599 and the acquired PLATEAU nominal mesh 53394536: longitude [139.7000,139.7125], latitude [35.6916666667,35.7000]. The [Statistics Bureau mesh explanation](https://www.stat.go.jp/data/mesh/gaiyou.html) is a reference for the standard arithmetic; it was not fetched in this lane under the explicit source restriction. The control coordinate is a test input, not newly surveyed evidence.

Every acquired E27 network and station-map layer bbox touches third mesh **53394525**. The acquired m:533945 ubld response lists only 13104/53394536 and 13116/53394576, both catalog year 2025. No listed nominal mesh equals an E27 bbox mesh. This computes a HOLD for latest nominal coverage; it does not prove that geometry is confined to the file-name mesh.

Indeed, 53394536's computed geometry bbox is lon [139.6980312405,139.7036188036], lat [35.6906994167,35.6950137738], touching meshes 53394525/26/35/36 and extending outside nominal 53394536. Its actual bbox is nevertheless disjoint from the acquired E27 bboxes. The Ikebukuro file 53394576 also extends east outside its nominal mesh, touching 53394576/77. Actual bboxes and declared envelopes are retained separately in the generated coverage table.

The R1 node/link bboxes touch 53394565/66/67/75/76/77/85/86/87 conditionally on the inferred CRS. This includes the catalogued Ikebukuro nominal mesh; it still does not establish matching features or floors. Older PLATEAU vintages remain **UNKNOWN**: the acquired latest-response endpoint does not enumerate historical coverage. Neither station is released for geometry/network pairing or routing.

## Not established

- Which walking-network specification was actually used for R1, despite observed 2024 code compatibility.
- A file-declared or independently verified R1 datum, geodetic accuracy, or a successful all-link distance verdict.
- The per-component survey/trace method for links counted as `method_unknown`, and the missing Japanese label for 2018 waterway=2.
- Link-polyline equality with CSV, which carries no link geometry, or labels for intermediate weekday digits not printed in the spec.
- Feature correspondence between Hokonavi and PLATEAU, operator-floor equivalence, floor-to-height mapping, vertical datum interpretation or current access.
- Paid/unpaid boundaries, physical doors/connectors, accessible routes, current-world accuracy or present operational availability.
- Coverage of earlier PLATEAU vintages, or actual geometry coverage from a nominal file-name mesh alone.
- Independent catalog redistribution rights or clearance of third-party material; all applicable publish/routing HOLDs remain.

## Reproduction and outputs

Run the seven commands in `tools/gis/README.md` in order: frozen install, typecheck, tests, acquire --all, real-run, validate, summarize last. The real runner stops on a failed command and records commands, tool fingerprints and exact conversion run IDs. Source/spec hashes and the codebooks are fingerprinted tool inputs. Network and overlap reports include input hashes and tool fingerprints; summarize rejects stale inputs. The validation receipt includes real PDF-label and R1 tests. Gap packets are generated by `gis gap-packet`, never edited by hand. Raw PDFs/GeoJSON/catalog/supporting pages and candidate graphs remain in the external store.
