# Shinjuku evidence-gap packet

This packet is generated from the current inventory and network report files. Missing reports and fields are UNKNOWN.

## What the source files report
- CityGML source: plateau-13104-ubld-53394536.
- floors: PRESENT. Count in file: 1911. Example gml:id values: bdry_d7c5c46c-bdec-4e4d-a08e-f919a6683b02, bdry_a43a8c2f-f699-43d4-beea-48f6631b79ec, bdry_185dd85a-f91e-49e8-85a9-5ccbf7c9bcce (1911 IDs in the full external inventory; this report shows a sample).
- doors: PRESENT. Count in file: 1364. Example gml:id values: door_f87caf7a-2b2a-4d37-88dc-5caf0cb475f7, door_2ec9106b-1988-46eb-aefc-ae0cfbf31c7d, door_1e1d3134-c015-4aae-aa81-136704c5b86a (1364 IDs in the full external inventory; this report shows a sample).
- windows: PRESENT. Count in file: 62. Example gml:id values: window_0086ea03-dc85-4422-ad6f-bd21bf6cb766, window_be43c409-b9c4-4411-8d22-95af374d109e, window_c96839f8-8f0d-4bf2-bc42-b4cf466be883 (62 IDs in the full external inventory; this report shows a sample).
- door_representation: UNKNOWN. Count in file: null. Example gml:id values: door_f87caf7a-2b2a-4d37-88dc-5caf0cb475f7, door_2ec9106b-1988-46eb-aefc-ae0cfbf31c7d, door_1e1d3134-c015-4aae-aa81-136704c5b86a (1364 IDs in the full external inventory; this report shows a sample).
- stairs: UNKNOWN. Count in file: null.
- escalators: UNKNOWN. Count in file: null.
- elevators: UNKNOWN. Count in file: null.
- ramps: UNKNOWN. Count in file: null.
- stairs_or_ramps_category: ABSENT_IN_FILE. Count in file: 0.
- ticket_gates_paid_area_boundary: UNKNOWN. Count in file: null.
- connectivity_topology: ABSENT_IN_FILE. Count in file: 0. Evidence: No namespace-qualified GML mathematical topology elements were observed in this file.
- mathematical_topology: ABSENT_IN_FILE. Count in file: 0. Evidence: No namespace-qualified GML mathematical topology elements were observed.
- navigable_connectivity: UNKNOWN. Count in file: null. Evidence: Mathematical topology element presence alone does not establish navigable edges or route connectivity; no route edges are inferred.
- floor_labels: UNKNOWN. Count in file: null. Evidence: No explicit floor form or dedicated floor-label source field was observed; generic words such as 階段室 or 地下通路 do not establish a floor label.
- installations: PRESENT. Count in file: 1. Example gml:id values: inst_2ea32648-adeb-445b-aea8-ec77a8ea3527.
- link.geojson: 263 features; CRS {"type":"name","properties":{"name":"EPSG:6668"}}; bbox [139.6983427967416,35.686837840826456,139.6996342263177,35.68901888089276].
- node.geojson: 233 features; CRS {"type":"name","properties":{"name":"EPSG:6668"}}; bbox [139.69834279674163,35.68683784082645,139.69963422631773,35.68901888089276].
- Combined source layers: 496 features; literal floor labels ["-0.5","-1","-2","-2.5","-3","-4.5","-6","0","1"].
- Combined network source topology: 1 weak components, 0 dangling references, 0 endpoint mismatches above 0.5 m.

## Spatial bbox comparison
- BBox overlap only. It does not establish that features coincide, share a floor, or connect; it is not routing evidence.
- plateau-13104-ubld-53394536: source CRS http://www.opengis.net/def/crs/EPSG/0/6697, axis order latitude,longitude, bbox [35.69069941674934,139.69803124047718,35.69501377379006,139.7036188035924].
- hokonavi-oedo-shinjuku-network-geojson:link.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.6983427967416,35.686837840826456,139.6996342263177,35.68901888089276].
- hokonavi-oedo-shinjuku-network-geojson:node.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69834279674163,35.68683784082645,139.69963422631773,35.68901888089276].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.6987369826077,35.686869448079385,139.69941646785284,35.68890725467192].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69872148686855,35.686820677189594,139.69942685661496,35.68890888471321].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69872148686855,35.68682067718957,139.69942685661493,35.68890888471321].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69856485886677,35.68686011508616,139.6994982570718,35.68892650608127].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69833684397,35.68682066265168,139.69956007354568,35.689036892457274].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69833684397,35.686820662651655,139.69956007354565,35.689036892457274].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69838152473724,35.68703479231027,139.69957489954618,35.688561766073896].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.6983307610462,35.6870196435793,139.6996556695029,35.68859084464786].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.6983307610462,35.68701964357926,139.69965566950293,35.68859084464783].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69840018115497,35.68764323174838,139.69932328880526,35.68880846669198].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69832963316264,35.68763141279198,139.69933683874092,35.688864827641275].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69832963316264,35.687631412791966,139.69933683874092,35.68886482764128].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69882940237966,35.6889324897203,139.6989314341892,35.688948306820954].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69880743410081,35.68889432393904,139.69894806200864,35.68903059209285].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69880743410081,35.68889432393905,139.69894806200864,35.68903059209284].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Facility.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.69890206856337,35.687641973395884,139.69932331972637,35.6888971587508].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Floor.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.698864976564,35.6876263511075,139.69938490951193,35.689030734734104].
- hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Space.geojson: source CRS EPSG:6668, axis order longitude,latitude, bbox [139.698864976564,35.68762635110749,139.69938490951193,35.68903073473409].
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-network-geojson:link.geojson: DISJOINT; projected bbox-boundary separation approximation 186.44262525628636 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-network-geojson:node.geojson: DISJOINT; projected bbox-boundary separation approximation 186.4426252562791 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 198.82670250489048 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 198.64586110924006 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 198.64586110924733 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 196.69090492264158 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 184.4443807673451 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 184.44438076735264 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 237.15601733837474 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 233.92997097011244 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 233.9299709734545 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 209.7864730376919 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 203.53365692298723 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 203.5336569218264 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 194.27228247483097 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 185.14336080955164 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 185.1433608102574 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Facility.geojson: DISJOINT; projected bbox-boundary separation approximation 199.94676774950128 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Floor.geojson: DISJOINT; projected bbox-boundary separation approximation 185.12753409180044 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Space.geojson: DISJOINT; projected bbox-boundary separation approximation 185.1275340932107 m.
- Complete computed layer-pair table: ../overlap/shinjuku.json. Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.

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
- The only acquired PLATEAU underground file does not spatially cover the acquired Hokonavi indoor network: every compared source-layer bbox is disjoint. HOLD for any geometry/graph pairing. Bbox evidence does not establish feature connectivity.
- All normalized network and geometry records remain UNVERIFIED; no output from this lane establishes a passenger route.
