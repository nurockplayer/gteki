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
- connectivity_topology: ABSENT_IN_FILE. Count in file: 0.
- floor_labels: UNKNOWN. Count in file: null.
- installations: PRESENT. Count in file: 1. Example gml:id values: inst_2ea32648-adeb-445b-aea8-ec77a8ea3527.
- link.geojson: 263 features; CRS {"type":"name","properties":{"name":"EPSG:6668"}}; bbox [139.6983427967416,35.686837840826456,139.6996342263177,35.68901888089276].
- node.geojson: 233 features; CRS {"type":"name","properties":{"name":"EPSG:6668"}}; bbox [139.69834279674163,35.68683784082645,139.69963422631773,35.68901888089276].
- Combined source layers: 496 features; literal floor labels ["-0.5","-1","-2","-2.5","-3","-4.5","-6","0","1"].
- Combined network source topology: 1 weak components, 0 dangling references, 0 endpoint mismatches above 0.5 m.

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
- All normalized network and geometry records remain UNVERIFIED; no output from this lane establishes a passenger route.
