# Ikebukuro evidence-gap packet

This packet is generated from the current inventory and network report files. Missing reports and fields are UNKNOWN.

## What the source files report
- CityGML source: plateau-13116-ubld-53394576.
- floors: PRESENT. Count in file: 3. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_FloorSurface, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room2_FloorSurface, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room3_FloorSurface.
- doors: PRESENT. Count in file: 3. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_Door, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room2_Door, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room3_Door.
- windows: PRESENT. Count in file: 1. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_Window.
- door_representation: UNKNOWN. Count in file: null. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_Door, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room2_Door, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room3_Door.
- stairs: UNKNOWN. Count in file: null.
- escalators: UNKNOWN. Count in file: null.
- elevators: UNKNOWN. Count in file: null.
- ramps: UNKNOWN. Count in file: null.
- stairs_or_ramps_category: PRESENT. Count in file: 2. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_IntInstallation_EF_35, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room3_IntInstallation_EF_35.
- ticket_gates_paid_area_boundary: UNKNOWN. Count in file: null.
- connectivity_topology: ABSENT_IN_FILE. Count in file: 0.
- floor_labels: PRESENT. Count in file: 1. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332a.
- installations: PRESENT. Count in file: 7. Example gml:id values: ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_IntInstallation_EF_25, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_IntInstallation_EF_80, ubld_6115731d-c05d-42eb-89c2-4fcc1b7a332e_room1_IntInstallation_EF_25 (7 IDs in the full external inventory; this report shows a sample).
- The source files contain 1887 node rows and 2196 link rows.
- Duplicate node IDs: 0; duplicate link IDs: 0.
- Dangling link references: 0; weak components: 1.

## Spatial bbox comparison
- BBox overlap only. It does not establish that features coincide, share a floor, or connect; it is not routing evidence.
- plateau-13116-ubld-53394576: source CRS http://www.opengis.net/def/crs/EPSG/0/6697, axis order latitude,longitude, bbox [35.728049254734366,139.70938689983566,35.731371787356984,139.7133659340391].
- hokonavi-ikebukuro-walk-csv-pair: source CRS UNKNOWN, axis order unknown, bbox [139.69533618,35.724141027,139.722924068,35.733731143].
- plateau-13116-ubld-53394576 / hokonavi-ikebukuro-walk-csv-pair: UNKNOWN; projected bbox-boundary separation approximation UNKNOWN m.
- Complete computed layer-pair table: ../overlap/ikebukuro.json. Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.

## UNKNOWN and survey questions
- What are the operator-specific floor names and their surveyed elevations? Obtain a source or field survey; labels alone do not establish height.
- Where do paid-area boundaries, ticket gates, and permitted transfers lie in the current station configuration?
- Which doors, stairs, elevators, escalators, and ramps are currently open and accessible to passengers?
- Do source geometries and network links match current conditions, and what survey date and tolerance support that claim?
- Which operators and station areas are in scope? Keep each operator layer separate until an authorized mapping is evidenced.

## HOLD items
- Paid/unpaid boundary is not evidenced as present in the available PLATEAU underground-building file; HOLD for routing across fare boundaries.
- Explicit connectivity is not established by the available CityGML inventory; HOLD for route generation.
- Floor-to-elevation mapping remains UNKNOWN even when literal floor labels are present; do not derive elevation from labels.
- The PLATEAU/network bbox relationship is UNKNOWN because source CRS or bbox evidence is incomplete; HOLD for any geometry/graph pairing.
- All normalized network and geometry records remain UNVERIFIED; no output from this lane establishes a passenger route.
