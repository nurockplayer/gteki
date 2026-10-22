# Municipal and R9 evidence: verdicts and decisions (2026-10-22)

Lane D evidence. Everything here is evidence-only with publish gate HOLD: nothing is converted, placed or shipped, and no verdict below is a rights decision by the Owner. The numbers come from the generated `docs/gis/research/2026-10-22-municipal-evidence-profile.md` (made by `gis csv-profile` from the hashed bytes in the private store). This note holds counts, column names, CRS names, bbox numbers and hashes only; no row value, name, address or code.

Basis: `docs/gis/research/2026-10-22-related-layers-reassessment.md` sections 4.5, 4.6, 5 and 7, and `docs/research/gaps/DR-new-3d-indoor-sources.md` (R9). Unknown stays unknown.

## 1. What was registered and acquired

16 new sources in `tools/gis/sources/sources.yaml` (source count 57 to 73), acquired with `gis acquire`; one record each under `docs/gis/acquisitions/`. For the municipal and Tokyo-catalogue sources the data file is the main download and three documents are hashed supporting documents: the CKAN `package_show` snapshot, the portal terms page `https://portal.data.metro.tokyo.lg.jp/terms/` and the CC BY 4.0 deed. For the Hokonavi packages the `package_show` is the main download and the resource files are hashed supporting documents.

| Item | Source ids |
| --- | --- |
| A, landmark option (c) | `tokyo-muni-shinjuku-public-facilities-csv`, `tokyo-muni-shinjuku-tourism-csv`, `tokyo-muni-shinjuku-cultural-properties-csv`, `tokyo-muni-toshima-tourism-csv`, `tokyo-muni-toshima-cultural-properties-csv`, `tokyo-muni-toshima-public-facilities-csv` |
| B, shelters | `tokyo-muni-shinjuku-shelter-csv`, `tokyo-muni-toshima-shelter-csv` |
| C, emergency transport roads | `tokyo-emergency-route-zip` |
| D, Shinjuku park list | `tokyo-muni-shinjuku-park-csv` |
| E, R9 | `hokonavi-oedo-shinjuku-nishiguchi-package` (E01), `hokonavi-oedo-tochomae-package` (E28), `tokyo-nishi-shinjuku-walk-zip`, `tokyo-toei-station-info-csv`, `hokonavi-shibuya-sendagaya-shinjuku-package`, `geospatial-0401-package` |

Findings that apply to every item:

- The portal terms page is not a closure notice today: 44,403 bytes, SHA-256 `74e591bc0092beaed0921015d3b2b0b9bf90c70e67508b036155f6e5400cd67a`. It states that works on the catalogue site are licensed CC BY 4.0 except those carrying a 「注」 note or an individually applied rule. Whether any of these datasets carries such a note is not visible in the dataset snapshots (they hold none), so the snapshot matches the dataset-level CC BY statement and nothing contradicts it.
- Every Tokyo-catalogue dataset has `license_id: CC-BY-4.0` and a null resource licence field in its `package_show` snapshot.
- The sizes printed in CKAN are stale or rounded (multiples of 1,024 for the ward CSVs; the emergency-route ZIP is 454,256 bytes on the wire against 1,147,904 in CKAN). The manifest therefore pins the delivered size, not the CKAN size.
- The three Shinjuku ward files are UTF-16LE with a BOM, comma-delimited. The Toshima files are Shift_JIS. The Shinjuku park file is UTF-8. The Toshima shelter file named `.csv` is an OOXML workbook (xlsx), not a CSV.

## 2. Verdicts

Rule (reassessment note 7.5 item 5, 4.5, 4.6): `CLEAN_CANDIDATE` needs dataset-level CC BY 4.0 in the snapshot (and the terms), lat/lon columns or vector members, a stated CRS or a passing bbox sanity check with the CRS recorded as UNKNOWN, and a window count above 0. Windows: Ikebukuro is the context-config window (250 m origin disc plus 120 m exit discs); Shinjuku has no window spec (its context config is BLOCKED), so it is the 250 m origin disc only. "Within 1,000 m" is context.

| Source | Verdict | Reason (counts) | Decision |
| --- | --- | --- | --- |
| `tokyo-muni-toshima-public-facilities-csv` | `CLEAN_CANDIDATE` | Shift_JIS, 538 rows, lat/lon columns, no CRS column (CRS UNKNOWN), bbox sanity passes (1 row outside the Tokyo sanity box), 5 rows in the Ikebukuro window (2 in the origin disc), 0 in Shinjuku | HOLD; an Ikebukuro landmark layer is possible from this file |
| `tokyo-muni-toshima-tourism-csv` | `CLEAN_CANDIDATE` | Shift_JIS, 5 rows, lat/lon columns, no CRS column (UNKNOWN), 2 rows in the Ikebukuro window | HOLD; adds at most 2 points |
| `tokyo-muni-toshima-cultural-properties-csv` | `NOT_CLEAN` | 409 rows; the column labelled latitude holds longitude-range values and the longitude column holds latitude-range values (header labels swapped); 0 rows in either window, as labelled or swapped | HOLD; no window coverage |
| `tokyo-muni-shinjuku-public-facilities-csv` | `NOT_CLEAN` | UTF-16LE, 267 rows, lat/lon columns, no CRS column; 3 rows outside the Tokyo sanity box; 0 rows in the Shinjuku origin disc (11 within 1,000 m) | HOLD; no coverage inside the 250 m disc. A wider Shinjuku window is a director call |
| `tokyo-muni-shinjuku-tourism-csv` | `NOT_CLEAN` | UTF-16LE, 6 rows; the file has two CRS columns (name and code) but every row is blank, so no CRS is declared; 0 rows in the window (1 within 1,000 m) | HOLD |
| `tokyo-muni-shinjuku-cultural-properties-csv` | `NOT_CLEAN` | UTF-16LE, 233 rows, lat/lon columns, no CRS; 0 rows in the window | HOLD |
| `tokyo-muni-shinjuku-park-csv` | `NOT_CLEAN` | UTF-8, 178 rows, lat/lon columns, no CRS; 0 rows in either window (6 within 1,000 m of the Shinjuku origin) | HOLD; no park inside the Shinjuku origin disc |
| `tokyo-muni-shinjuku-shelter-csv` | `NOT_CLEAN` | UTF-16LE, 10 rows; lat/lon columns exist but every coordinate cell is blank | HOLD; B1 not met |
| `tokyo-muni-toshima-shelter-csv` | `NOT_CLEAN` | OOXML workbook, 40 rows; lat/lon columns exist but every coordinate cell is blank | HOLD; B1 not met. Ikebukuro shelters stay out |
| `tokyo-emergency-route-zip` | `CLEAN_CANDIDATE` | ZIP holds vector data: one polyline shapefile (2,255 records; two attribute fields, a road class and a road order; no name field) with `.prj` `JGD_2011_Japan_Zone_9`, plus ArcGIS metadata and index files; 3 records touch the Ikebukuro window and 1 the Shinjuku window; the metadata XML has no third-party or base-map notice wording | HOLD; vector and CRS conditions of decision 2 are met by the file contents. The remaining conditions are the field check (kept fields: geometry plus `kind: emergency_route_line`) and the director's go |
| `tokyo-nishi-shinjuku-walk-zip` | `NOT_CLEAN` | ZIP holds no vector files: two CSV tables (a link table without coordinates and a node table with lon/lat, 1,249 rows, 107 inside the Shinjuku origin disc, 1,237 within 1,000 m) | HOLD; not vector data |
| `tokyo-toei-station-info-csv` | `NOT_CLEAN` | Shift_JIS, 108 rows, 13 columns, no lat/lon columns | HOLD; station facts only |
| Hokonavi E01 and E28 package resources, `nwd_shibuya_sendagaya_shinjuku` link and node CSV | `UNKNOWN` | Dataset licence label `pdl-jp-1.0`, outside the CC BY 4.0 rule; resource licence null; see section 3 | HOLD |

Hokonavi resource facts (profile note has the per-member detail): E01 holds GeoJSON and shapefile members with a declared EPSG:6668 or a `GCS_JGD_2011` projection file, a network CSV pair and a station-map set; its 225 network nodes sit within 1,000 m of the Shinjuku origin (none inside the 250 m disc); no E01 station-map feature touches either window. E28 is the adjacent station, not Shinjuku. `nwd_shibuya_sendagaya_shinjuku` holds a 7,921-row link table without coordinates and a 7,155-row node table with lon/lat, 247 nodes inside the Shinjuku origin disc, 2,631 within 1,000 m, none in Ikebukuro.

## 3. R9 licence notes

- **OD-19 (E01 and E28).** No #16 override applies to E01 or E28 (the Owner's override covers the shipped E27-derived Shinjuku slice). The package label is PDL 1.0 (`pdl-jp-1.0`) and the resource licence is null, the same shape as E27. The PDL 1.0 text and the Hokonavi site terms are hashed supporting documents of both packages. Both packages state a limited release until 2027-03-12 (`availability_deadline`). Recorded, not decided: the package label is not taken as the resource licence basis.
- **OD-20 (G-spatial `0401` mirrors).** Not acquired: every mirror link answers HTTP 302 to a per-request pre-signed storage URL, which the zero-redirect runner cannot declare, and sizes are not in the metadata. A 1-byte range probe (size and ETag only, no byte stored) of the three Ikebukuro mirror files found the mirror link GeoJSON at 1,174,159 bytes and the node GeoJSON at 813,412 bytes, against 1,723,897 and 926,326 bytes for the stored R1 GeoJSON files: the mirror copies are not byte-identical to R1. No Shinjuku S02 bytes are stored, so no Shinjuku comparison exists. Consequence: the mirror is a different dataset from R1, its stated basis is the Government Standard Terms (license_id `ogl`; the "2.0" version number is from the research note and is not in the snapshot fields), and the original publisher's basis for R1 stays PDL 1.0. Both terms are attached to `geospatial-0401-package` (PDL 1.0 text, the dataset page and the dataset's terms resource page; the terms PDF itself is a 302 download and was not read). Neither upgrades the other.

## 4. Consequences for the layers

- Landmark (option (c)): Ikebukuro has two `CLEAN_CANDIDATE` lists (public facilities, 5 rows in window; tourism, 2 rows). Shinjuku has none in the 250 m origin disc; its lists reach the area only within 1,000 m. The credit pattern, the change notice and any exclusion note from the portal terms remain open.
- Shelters (4.5): neither ward file has a single coordinate, so the shelter replacements stay HOLD; Ikebukuro and Shinjuku keep no shelter layer.
- Emergency routes (4.6): vector data is present, so the layer is not held on format grounds; it is a candidate for the implementation PR.
- Parks (B3): no Shinjuku park inside the origin disc.

## 5. Not acquired

- G-spatial `0401` mirror files (Ikebukuro 2018-03, Shinjuku 2018-03 and 2020-03: ZIP, link and node GeoJSON, area PDFs): 302 to a pre-signed URL, see OD-20. The e-Gov listing `mlit_20150223_0105` (DR-NS-07) lists pointers only and was not fetched.
- The E28 check PDF (1.9 MB); the two `nwd_shibuya_sendagaya_shinjuku` GeoJSON files (9.7 MB); the area PDF of the west-Shinjuku set (1 MB image map); the 64 MB Tokyo DEM/point-cloud index (excluded by instruction).
- The Toei elevator and barrier-free datasets (DR-NS-16) were not in scope.

## 6. UNKNOWN

- Coordinate reference system of every municipal CSV (no CRS column with a value anywhere; Shinjuku tourism has empty CRS columns). The bbox sanity check passes for the Toshima public-facility and tourism lists and the Shinjuku lists, with the CRS recorded as UNKNOWN. Datum (JGD2011 or WGS84) is not distinguishable at the metre scale of these windows and is not claimed.
- Whether any dataset carries an individual 「注」 note under the portal terms that would override CC BY 4.0 (the dataset snapshots hold none).
- The exact credit wording the Tokyo portal requires for these datasets.
- Whether the Toshima files are current: the CKAN resource dates are 2022; the Shinjuku files 2023.
- Whether a Shinjuku window larger than the 250 m origin disc is wanted (11 facilities, 6 parks and 1 tourism point lie within 1,000 m).
- Byte identity of the `0401` Shinjuku files with S02 (S02 is not stored) and the content of the `0401` terms PDF.
- Floors and vertical anchors of E01 and E28 (not read; not evaluated here).
