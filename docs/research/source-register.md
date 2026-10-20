# GTEki — Source Register, Provenance & Rights

Status: **Research inventory only; no source below has yet been independently validated for these station interiors in this repository.** Do not infer station-level LOD4 coverage from the existence of a city-level package.

## Candidate entry points (not import approval)

| Source | Entry point | Research tasks | Status |
| --- | --- | --- | --- |
| PLATEAU (MLIT) | https://www.mlit.go.jp/plateau/ | Locate exact Ikebukuro/Shinjuku files, years, underground/LOD4 footprints, licenses | UNVERIFIED |
| G-spatial Information Center | https://www.geospatial.jp/ | Find download links and dataset metadata | UNVERIFIED |
| JR East | https://www.jreast.co.jp/ | Official station maps and permitted re-use scope | UNVERIFIED |
| Tokyo Metro | https://www.tokyometro.jp/ | Station/floor diagrams and accessibility | UNVERIFIED |
| Tobu / Seibu / Odakyu / Keio / Toei | Official operator sites to locate | Operator-specific paths, facilities, restrictions | UNVERIFIED |
| OpenStreetMap | https://www.openstreetmap.org/ | Existing entrances/POIs and ODbL obligations | UNVERIFIED |

## Per-source record schema

```yaml
source_id: ""
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
import_tested: false
evidence_pointer: ""
research_status: UNVERIFIED
notes: ""
```

## Separate decision axes

- Availability: DISCOVERED / DOWNLOAD_CONFIRMED / FILE_INSPECTED.
- Rights: UNVERIFIED / REUSABLE_WITH_CONDITIONS / REFERENCE_ONLY / RESTRICTED.
- Fitness: VISUAL_ONLY / GEOMETRY_ONLY / NAVIGATION_VERIFIED / NOT_USABLE.
- Freshness: source date, on-site verification date, construction-change risk.

Mark licensing per **actual dataset and file**, not just generic portal terms. A publicly visible plan, aerial photo, street view or brand graphic is **not** automatically licensed for copying into commercial/public 3D content.

For open imagery, track author/license/attribution. For OSM-derived databases, assess ODbL share-alike and attribution requirements before publication. Follow station/operator photography rules and protect bystanders' privacy.

## Raw data storage

Do not put unverified-source meshes, station-plan scans, videos or large CityGML archives in this public GitHub repo. Keep them in an access-controlled external object store with checksums and a reproducible acquisition manifest; commit only content that has passed reuse review.

## Field-survey task trigger

Open a station-specific evidence-gap Issue with exact zone, floor, landmark, missing fact, permitted photo/mapping method, required measurements, observation date and confidence. AI-generated geometry must remain clearly synthetic until checked.

## Research exit criterion

Deliver source-by-source official page, real download file or explicit absence, footprint, floor, date, rights, transform feasibility, and safe usage classification. Never equate 'a model exists' with 'a usable station navigation graph exists'.
