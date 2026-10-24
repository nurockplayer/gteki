# GTEki — Source Register, Provenance & Rights

Last checked: 2026-10-22.

Status: **Inspected and hashed; none accepted as station topology, a route, or publication approval.** 55 sources are registered in `tools/gis/sources/sources.yaml` and acquired on main (receipts in `docs/gis/acquisitions/`). Both PLATEAU `ubld` files, the Hokonavi R1 and E27 files, S03, S10, both PLATEAU `related` ZIPs and the `bldg`/`tran` meshes were downloaded, hashed and inspected. Normalized records stay `UNVERIFIED`, GLBs `NOT_FOR_ROUTING` and candidate graphs `routable: false` ([HANDOFF](../gis/HANDOFF.md)). Do not infer station-level LOD4 coverage from the existence of a city-level package.

Superseded 2026-10-22: the earlier banner read "Research inventory only; no source below has yet been independently validated for these station interiors in this repository."

Per-station status matrix (one row per category, with bytes, hashes, rights, import state and gaps): [`docs/gis/research/m0-01-coverage-gaps.md`](../gis/research/m0-01-coverage-gaps.md). This register links to it and does not restate it. Per-source rights records: [`docs/gis/rights/`](../gis/rights/README.md). Machine-readable source list: [`tools/gis/sources/sources.yaml`](../../tools/gis/sources/sources.yaml).

## Candidate entry points (not import approval)

| Source | Entry point | Research tasks | Status (2026-10-22) |
| --- | --- | --- | --- |
| PLATEAU (MLIT) | https://www.mlit.go.jp/plateau/ | Locate exact Ikebukuro/Shinjuku files, years, underground/LOD4 footprints, licenses | PARTIAL. The live data-catalog API (`api.plateauview.mlit.go.jp`) resolves the files; `ubld`, `bldg`, `tran` and `related` files are acquired and hashed (`tools/gis/sources/sources.yaml`, `plateau-*`). Matrix rows IK-01 to IK-03, SJ-01 to SJ-03. |
| G-spatial Information Center | https://www.geospatial.jp/ | Find download links and dataset metadata | UNVERIFIED. The CKAN catalog pages returned 403 in the dossier (`GTEki_Public_Data_Research_2026-10-20.md`, Ikebukuro and Shinjuku PLATEAU entries); the official API and metadata were readable instead. |
| JR East | https://www.jreast.co.jp/ | Official station maps and permitted re-use scope | RESTRICTED for reproduction. Map images returned HTTP 403 and were never read (`docs/gis/decisions/owner-rights-questions.md`, "DECIDED" table). Facts only by Owner decision 2026-10-21 (#26). |
| Tokyo Metro | https://www.tokyometro.jp/ | Station/floor diagrams and accessibility | RESTRICTED for reproduction. Reference only; facts only (`stations/ikebukuro/gteki/station.json`, source `tokyometro-ikebukuro-yardmap-2026-03`, `REFERENCE_ONLY`). |
| Tobu / Seibu / Odakyu / Keio / Toei | Official operator sites to locate | Operator-specific paths, facilities, restrictions | RESTRICTED for reproduction. Reference only; facts only. The Toei Oedo E27 data is a separate MLIT Hokonavi source (matrix SJ-05, SJ-09). |
| OpenStreetMap | https://www.openstreetmap.org/ | Existing entrances/POIs and ODbL obligations | Cross-check only. ODbL, not shipped (`stations/shinjuku/sources/manifest.json`, `osm/entrances.json`); no acquisition receipt on main. |

Superseded 2026-10-22: every row above was `UNVERIFIED` on 2026-10-20.

## Per-source record schema

```yaml
source_id: ""            # DR-... for desk-research records; GIS ids live in sources.yaml
title: ""
station_ids: []
operator: ""
official_url: ""
download_url: ""
license_url: ""
license_name: ""
commercial_use: unknown
modification_allowed: unknown
redistribution_allowed: unknown
attribution_required: unknown
dataset_release_date: null
last_checked_date: null
file_format: ""
coordinate_reference_system: ""
spatial_coverage: ""
floor_coverage: ""
navigation_topology_present: unknown
import_tested: false     # boolean
acquired_bytes: null     # from the acquisition receipt
sha256: ""               # from the acquisition receipt
acquisition_receipt: ""  # docs/gis/acquisitions/<id>.json
rights_record: ""        # docs/gis/rights/<id>.json
owner_decision: ""       # decision file or issue comment (Q1-Q12, #26, #16)
import_status: not_imported  # imported | context_only | not_imported
evidence_pointer: ""
research_status: UNVERIFIED  # enum: VERIFIED | PARTIAL | UNVERIFIED | RESTRICTED
notes: ""
```

`research_status` is an enum, not a default. The meaning of each value is in the "Reading rules" table of [`m0-01-coverage-gaps.md`](../gis/research/m0-01-coverage-gaps.md). `VERIFIED` never means current-world accuracy or routability. For sources GIS has acquired, point to `docs/gis/rights/` and `tools/gis/sources/sources.yaml` instead of copying their fields here.

Superseded 2026-10-22: the earlier template used `research_status: UNVERIFIED` as a default with no enum, and had none of the six new fields (`acquired_bytes` to `import_status`).

## Separate decision axes

- Availability: DISCOVERED / DOWNLOAD_CONFIRMED / FILE_INSPECTED.
- Rights: UNVERIFIED / REUSABLE_WITH_CONDITIONS / REFERENCE_ONLY / RESTRICTED (mapped to the GIS vocabulary in the next section).
- Fitness: VISUAL_ONLY / GEOMETRY_ONLY / NAVIGATION_VERIFIED / NOT_USABLE.
- Freshness: source date, on-site verification date, construction-change risk.

Mark licensing per **actual dataset and file**, not just generic portal terms. A publicly visible plan, aerial photo, street view or brand graphic is **not** automatically licensed for copying into commercial/public 3D content.

For open imagery, track author/license/attribution. For OSM-derived databases, assess ODbL share-alike and attribution requirements before publication. Follow station/operator photography rules and protect bystanders' privacy.

### Rights vocabulary mapping

Three vocabularies are in use. Rows are the closest equivalents, not exact synonyms.

| This register (2026-10-20) | GIS rights records (`docs/gis/rights/*.json` `verdict`) | `station.json` `rights` (`packages/schema/src/index.ts` `RightsStatus`) |
| --- | --- | --- |
| UNVERIFIED | UNKNOWN | UNVERIFIED |
| REUSABLE_WITH_CONDITIONS | CLEARED_WITH_CONDITIONS | REUSABLE_WITH_CONDITIONS |
| REFERENCE_ONLY | no equivalent (operator maps are not acquired) | REFERENCE_ONLY, with `usage: facts-only` |
| RESTRICTED | RESTRICTED | RESTRICTED |

`tools/gis/sources/sources.yaml` adds a separate `publish_gate` (HOLD or CONDITIONAL). The GIS records also carry a claim level (RESOURCE / DATASET / SITE_POLICY / ORIGIN_DATASET); see `docs/gis/rights/README.md`.

### Owner-decision overlay

Several verdicts changed by Owner decision, not by new evidence. These are accepted interpretations and risks. The rights records keep their UNKNOWN or reservation text, and nothing becomes routable or verified. Source: [#39 comment 6324726321](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321), recorded in `docs/gis/decisions/2026-10-22-owner-rights-answers.md`.

| Item | Owner answer | Effect |
| --- | --- | --- |
| Q1 S10 station stores | Yes | Factual fields publish with credit and a change notice; no logos, photos or trademarks. S10 has no coordinates. |
| Q2, Q3 S03 | Yes, Yes | Neutral geometry and factual fields publish with credit. The dataset CC BY 4.0 grant is taken to control over the bureau site reservation. S03 CRS stays UNKNOWN. |
| Q4 | No | S03 promotional prose, linked content and PDF illustrations do not ship. |
| Q5 | No | PLATEAU `related` station, railway, border layers do not ship. |
| Q6 | No | PLATEAU `related` shelter, park, emergency-route layers do not ship (KSJ non-commercial). |
| Q7 | No | PLATEAU `related` landmark layer does not ship; GSI approval scope stays UNKNOWN. |
| Q8 | Accept | Catalog-API PLATEAU files are accepted as the licensed release (files self-declare CC BY 4.0). The size and identity gap against the CKAN-listed upload stays recorded. |
| Q9 | Yes | No PLATEAU textures ship. |
| Q10 | Yes (Option A, Shinjuku only) | The Shinjuku credit adds a flattened-bases notice. Wording is in the decision file. It applies to the PR#115 context, which is not merged. |
| Q11 | No | The E27 package PDL 1.0 is not taken to cover the two E27 resources. |
| Q12 | Yes | Roads risk acceptance (b) extends to Shinjuku 13104 `tran`: geometry only, no attributes, flattened to z = 0. The 13104 GSI lineage was not checked. |
| Roads risk acceptance (b) | Accepted (Ikebukuro 13116) | `tran` geometry only, no attributes; the GSI approval is read as attribute-scoped. An accepted risk, not an upgraded verdict (`docs/gis/decisions/2026-10-22-plateau-tran-geometry-risk-acceptance.md`). |
| Facts-only (#26, decision dated 2026-10-21) | Facts and works kept separate | Exit numbers, gate names and access facts may be used from operator and ward maps; no work is reproduced (`docs/gis/decisions/facts-only-credit-wording.md`; [#26 comment](https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404)). |
| #16 override for E27 (Owner, 2026-10-21) | E27 keeps shipping ([#39 comment 6325100917](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917), choice (a)) | The Shinjuku E27-derived slice ships under the [#16 override](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757). **Not a rights PASS.** Reuse after 2027-03-12 stays open. |

### Rows missing from the 2026-10-20 register

None of these were in the register. Full detail is in the matrix; this table only places each source. "Matrix" means [`m0-01-coverage-gaps.md`](../gis/research/m0-01-coverage-gaps.md). Status uses the enum above and describes the state on main.

| Source id | What | Status | Rights state | Owner decision | Evidence path |
| --- | --- | --- | --- | --- | --- |
| `tokyo-s10-shinjuku-csv`, `tokyo-s10-shinjuku-nishiguchi-csv` | S10 station stores, Toei-operated, Shinjuku and Shinjuku-nishiguchi (no coordinates; 新宿三丁目 not acquired) | PARTIAL (SJ-12) | CLEARED_WITH_CONDITIONS, dataset level, CC BY 4.0 | Q1 Yes | `docs/gis/rights/tokyo-s10-shinjuku-csv.json`, `docs/gis/poi/tokyo-s10-shinjuku-csv.json`, `docs/gis/acquisitions/` |
| `tokyo-s03-zip` | S03 Shinjuku-area facility geometry, 11 level files plus path and navigation JSON | UNVERIFIED (SJ-06, SJ-11, SJ-13): CRS UNKNOWN | Geometry and factual subset CLEARED_WITH_CONDITIONS; whole ZIP UNKNOWN | Q2 Yes, Q3 Yes, Q4 No | `docs/gis/rights/tokyo-s03-zip.json`, `docs/gis/poi/tokyo-s03-zip.json` |
| `plateau-13116-related`, `plateau-13104-related` (station, railway, border layers) | PLATEAU `related` ward-level points and lines | PARTIAL, held (IK-09, SJ-14) | CLEARED_WITH_CONDITIONS at origin (N02-2024, N03-2025); whole ZIP UNKNOWN | Q5 No | `docs/gis/rights/plateau-13116-related.json`, `docs/gis/rights/plateau-13104-related.json` |
| `plateau-*-related-landmark-asset` | PLATEAU `related` landmark | UNVERIFIED (IK-10, SJ-15) | UNKNOWN | Q7 No | same rights files |
| `plateau-*-related-{shelter,park,emergency-route}-asset` | PLATEAU `related` shelter, park, emergency route | RESTRICTED (IK-11, SJ-16) | RESTRICTED (KSJ non-commercial) | Q6 No | same rights files |
| `plateau-13116-bldg-*`, `plateau-13104-bldg-*` | PLATEAU `bldg` street context (LOD1/LOD2) | Ikebukuro PARTIAL (IK-02); Shinjuku UNVERIFIED on main (SJ-02) | CC BY 4.0, CONDITIONAL (`sources.yaml`) | Q8 Accept, Q9 Yes | `docs/gis/context/`, `docs/gis/acquisitions/plateau-13104-bldg-*.json` |
| `plateau-13116-tran-*`, `plateau-13104-tran-*` | PLATEAU `tran` roads (LOD3 used; LOD1/LOD2 flat and excluded) | Ikebukuro PARTIAL (IK-03); Shinjuku UNVERIFIED, acquired and unread (SJ-03) | CC BY 4.0, CONDITIONAL; GSI approval 令7関公第296号 scope UNKNOWN | Risk acceptance (b); Q12 Yes | `docs/gis/decisions/2026-10-22-plateau-tran-geometry-risk-acceptance.md` |
| Shinjuku 2023 vintage check | Two 2023 `ubld` archives inspected by HTTP range reads; same mesh and counts as the 2025 file. Ikebukuro earlier vintages not checked | Check record, not a source row | n/a | none | `docs/gis/vintages/shinjuku-2023.json`, `docs/gis/vintages/shinjuku-2023.md` |
| Shinjuku per-building flattening | Building bases flattened to street z = 0 for context at exits 1-4 | PR#115 only (open on 2026-10-22), not on main | Credit adds the flattened-bases notice | Q10 Yes (Option A) | PR#115 `docs/gis/context/`; `docs/gis/decisions/2026-10-22-owner-rights-answers.md` |
| `DOS:S02` (dossier id, not in `sources.yaml`) | MLIT ほこナビDP Shinjuku surroundings walking network, content 2018-10-29 | UNVERIFIED (SJ-10), not acquired | PDL 1.0 per dossier; no rights record | none | `docs/research/GTEki_Public_Data_Research_2026-10-20.md` |
| `DOS:G5` (dossier id, not in `sources.yaml`) | MLIT R2 Shinjuku indoor map, 2020-10-27 | UNVERIFIED (SJ-07), not acquired; CKAN and API returned 403 | UNKNOWN; older H29/H30 terms must not be assumed | none | `docs/research/GTEki_Public_Data_Research_2026-10-20.md` |

## Data-research lane (2026-10-22)

New desk-research source records live under `docs/research/gaps/` and use `DR-` source ids. The lane is tracked in [#165](https://github.com/nurockplayer/gteki/issues/165). A `DR-` id is a research record, not an acquisition: no bytes are downloaded and no rights are cleared by it. GIS registers and acquires sources in `tools/gis/sources/sources.yaml`; a `DR-` record becomes an acquisition only when GIS does that. Records use the schema above, keep unknowns as `UNKNOWN`, and carry no S10, S03 or `related` field values.

## Raw data storage

Do not put unverified-source meshes, station-plan scans, videos or large CityGML archives in this public GitHub repo. Keep them in an access-controlled external object store with checksums and a reproducible acquisition manifest; commit only content that has passed reuse review.

Committed GIS reports carry no source field values: only counts, hashes, field names and source ids. This is the rule from PR #128, extended to non-POI literals by PR #147; see `docs/gis/rights/README.md` and `docs/gis/rights/non-poi-literals.md`. The private store (`$GTEKI_GIS_STORE`, default `~/.gteki/gis-store`, mode 0700) is described in [HANDOFF](../gis/HANDOFF.md) "What exists".

## Field-survey task trigger

Open a station-specific evidence-gap Issue with exact zone, floor, landmark, missing fact, permitted photo/mapping method, required measurements, observation date and confidence. AI-generated geometry must remain clearly synthetic until checked.

## Research exit criterion

Deliver source-by-source official page, real download file or explicit absence, footprint, floor, date, rights, transform feasibility, and safe usage classification. Never equate 'a model exists' with 'a usable station navigation graph exists'.

## 2026-10-20 evidence update — first research pass completed

Full evidence dossier, downloadable file links, per-source rights checks, and explicit UNKNOWNs: [GTEki_Public_Data_Research_2026-10-20.md](GTEki_Public_Data_Research_2026-10-20.md).

- Ikebukuro: PLATEAU 2025 `ubld` individual CityGML listed at 35,427,963 bytes; metadata identifies 2023 Tokyo LiDAR SLAM source and CC BY 4.0. **GML contents and actual indoor station coverage have not been independently downloaded or validated.** Do not assert complete station or station-current geometry.
  - Superseded 2026-10-22: the file was downloaded (35,427,963 B, receipt `docs/gis/acquisitions/plateau-13116-ubld-53394576.json`) and read (`docs/gis/inventory/plateau-13116-ubld-53394576.md`). It holds one B1 passage: 32 features, 3 Rooms, 7.7 m vertical range. It has no gates, no paid boundary and no connectivity. The CC BY 4.0 label rests on a clause embedded in the file; coverage of this exact resource by the CKAN package is open. Owner Q8 accepted that risk. Station coverage is still not whole-station.
- Shinjuku: PLATEAU 2025 `ubld` listed at 43,830,765 bytes; same year-versus-survey caution and unresolved floor coverage.
  - Superseded 2026-10-22: floor coverage is answered. The file holds 30,358 features, 153 Rooms, no explicit floor labels, TP heights 15.32-45.49 m. It is DISJOINT from the Toei Oedo E27 layers in every bbox comparison (`docs/gis/vintages/shinjuku-2023.md`, `docs/gis/overlap/shinjuku.md`). It is not imported into the station (`stations/shinjuku/sources/manifest.json`).
- Ikebukuro walking network: 2,196 link and 1,887 node rows, dated 2019-01-28; all inspected nodes `in_out=1` (outside facility) and empty elevation. **Not a verified indoor graph.**
  - Superseded 2026-10-22: counts are now complete and hashed (`docs/gis/networks/hokonavi-ikebukuro-walk-node-csv.json`: 1,887 nodes, 2,196 links, `in_out=1` for all, elevation blank for all). No CRS is declared (EPSG:6668 is inferred), the applicable spec version is UNKNOWN, and the files are not imported. No rights record and no Owner decision exist for R1 (matrix IK-06).
- Shinjuku Oedo E27: operator-specific layered indoor network in GeoJSON/CSV/Shapefile, PDL 1.0; **partial area only**, source levels 1F/B1/B2/B3/B5/B6 must not be conflated with JR/other operators.
  - Superseded 2026-10-22: "PDL 1.0" is not the whole story. Owner Q11 = No: the package PDL 1.0 is not taken to cover the two resources (resource `license` is null). E27 ships under the Owner's #16 override, confirmed on [#39 comment 6325100917](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917); this is not a rights PASS. Publication ends 2027-03-12 and reuse after that date is open (`stations/shinjuku` `gap:reuse-after-publication`). Real counts: network 233 nodes / 263 links; station map 18 layers / 465 features (`docs/gis/networks/`). The `ubld` file is DISJOINT from E27 (see above). Both E27 files are imported into the station.
- Operator station maps: useful verification references; reproduction, tracing, redistribution or derivation into released GLB/texture/structured map **not authorized by mere public access**.
- POIs and visual materials: resource-specific licensing and accuracy checks still required. Google Maps/Street View must not feed a scraped/re-distributed reconstruction pipeline.
  - Superseded 2026-10-22: the recorded state is in "Rows missing from the 2026-10-20 register" and the Owner-decision overlay above. In short: S10 CLEARED_WITH_CONDITIONS (Q1 Yes); S03 geometry and factual subset cleared with the whole ZIP UNKNOWN (Q2, Q3 Yes, Q4 No); `related` station/railway/border cleared at origin but held (Q5 No), landmark UNKNOWN, shelter/park/emergency RESTRICTED; PLATEAU textures excluded (Q9). Imagery and photos: nothing acquired; per-file rights still required (matrix IK-12, SJ-17). Google Maps/Street View stays excluded.

Status nomenclature: a verified **metadata/license/source link** is not a verified **coverage/topology/current passenger route**. Treat these as separate fields. [`docs/gis/research/m0-01-coverage-gaps.md`](../gis/research/m0-01-coverage-gaps.md) is the per-station status matrix; this register links to it and does not restate it. No M0 route has passed current-world acceptance. The initial candidate table above was updated on 2026-10-22; consult the dossier and the matrix for source-level findings.

## Research maintenance and approval protocol (2026-10-20)

- **Canonical source:** accepted public-data research, evidence cards, source versions, usage rights, and engineering handoff live in GitHub `main`. A proposed PR is **not** yet canonical. Notion `GTEki — Research & World Bible` holds concise summaries, progress, and links only, not a competing source register.
- **Before changing research:** read current `main`, relevant Issues/PRs, source-level evidence, and the Notion summary. Compare new material with the existing 2026-10-20 dossier; do not re-import duplicate findings.
- **Research updates:** edit GitHub research documents and specific source evidence in a dedicated branch, then open a reviewable PR against `main`. Never edit `main` directly, force-update shared branches, enable auto-merge, or merge a research PR on the research steward's own authority.
- **Required evidence:** separate (1) data existence, (2) downloadable bytes or verified entry point, (3) commercial/derivative/redistribution rights, and (4) 3D-navigation suitability. Record source URL, exact resource/download URL, version and date, file type, geographic/floor extent, available accuracy evidence, attribution/terms, review date, and unanswered questions. Mark each unknown explicitly; neither nearby geometry nor an operator diagram proves traversable edges.
- **Notion synchronization:** once a PR exists, update the short Notion research status with the PR link and `PENDING REVIEW`; after authorized merge, verify the landed commit on `main` and change the Notion link/status accordingly. Avoid pasting the full dossier into Notion.
- **Engineering boundary:** pass real-data import, CRS, geometry coverage, floor alignment, indoor topology, accessibility, and other engineering validation gaps to Opus 5.5 via existing GitHub Issues/Handoff. A research PR does not approve a system architecture, commission development, release navigation claims, or prove any real passenger route.
- **Authority:** Owner controls product direction, major scope changes, public release, and merge authorization. Opus 5.5 owns engineering architecture and implementation decisions within approved scope, consulting other agents as useful. Keep unverified rights/entrances/edges in `UNKNOWN` or `HOLD`; never publish restricted source graphics, unlicensed photos, or inferred walkable passages to Web 3D.
