# Real-data run summary

Generated from acquisition, inventory, conversion and network JSON; no counts are manually maintained. All results are UNVERIFIED and NOT_FOR_ROUTING.

Tool-input SHA-256: `b879ca0ffd4f7ca550dcef970fae32148f45c98ca58539a745afab187b23e48e` (src, source manifest, frames, synthetic tests/fixtures, package/lock/workspace/TypeScript configuration; sorted relative names plus exact bytes).

## Acquisitions

| Source | Bytes | SHA-256 | Size check |
| --- | ---: | --- | --- |
| hokonavi-ikebukuro-walk-link-csv | 370498 | a0f8376556bc7c920be10c27181d8a4219745b55ec2bea6938d28dfeadde80d2 | MATCH |
| hokonavi-ikebukuro-walk-node-csv | 279843 | 2477e6f27d8be30b3e57ee6849a36b5d8c9f56e1d2ff34956fe5934b71f4920a | MATCH |
| hokonavi-oedo-shinjuku-network-geojson | 42909 | f3d9c3224e042ba2919730136ddbd88c411fac0af58875085007f5ceaae497ff | NOT_SPECIFIED |
| hokonavi-oedo-shinjuku-stationmap-geojson | 74513 | 43a297c028a4ffca3d3bdb3fb1da486e97291a276eadca56801c3b00fa4a9090 | NOT_SPECIFIED |
| plateau-13104-codelists | 806577 | f2c8921ff22f82aae279b61e380565e78927f74cc068ceb8586ee7887a9baec4 | NOT_SPECIFIED |
| plateau-13104-metadata | 26786 | ff758d4ca7ed806dce908138669d086624b590bb7095b712b7eb9d0eb06d77da | NOT_SPECIFIED |
| plateau-13104-schemas | 27952 | 28ca5c63686afac1487b84dd77a8778e24ec0af680cc71cd39bb3cb1beacb0a2 | NOT_SPECIFIED |
| plateau-13104-ubld-53394536 | 43830765 | 013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977 | MATCH |
| plateau-13116-codelists | 805989 | 183a3f554d816837f92c865124fa3cd2605e1c8f6ca7c58318b0241e718c5600 | NOT_SPECIFIED |
| plateau-13116-metadata | 21755 | 9c75c7135d5b1693db5474c0756eeb5632496d9d1fbcfd8ca7882c4cbea7d624 | NOT_SPECIFIED |
| plateau-13116-schemas | 27934 | e1d3011989038e21fb07ffc5bc4bc5fc08b1506e8092ef5222b246a205354bde | NOT_SPECIFIED |
| plateau-13116-ubld-53394576 | 35427963 | 38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09 | MATCH |
| plateau-catalog-ubld-13116-13104 | 2540 | 7e5abc031afa5ab9f4e0da1df9b7e3413d642c7cbdeb6de6f909b4a23a9737ad | NOT_SPECIFIED |

## CityGML inventories

| Source | Objects | Polygons | Rings / holes | Vertices | Degenerate / unclosed |
| --- | ---: | ---: | ---: | ---: | ---: |
| plateau-13104-ubld-53394536 | 30358 | 79363 | 79431 / 68 | 423769 | 0 / 0 |
| plateau-13116-ubld-53394576 | 32 | 98173 | 98207 / 34 | 398708 | 0 / 0 |

## Conversion readback

| Run | Polygons | Triangles | Nodes | Bbox error m | Time ms | Peak RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-24600ef17c9f5380d23f | 6 | 12 | 1 | 0.00000452290078101214 | 10850 | 892190720 |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-35099c33dd7d558fcc24 | 6 | 12 | 1 | 0.00000452290078101214 | 12332 | 320389120 |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-5cb5450b75ccf5ed33bf | 65013 | 148950 | 30358 | 0.0000054997890401864424 | 16522 | 1703395328 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-3c889435d6d252b4ba95 | 58761 | 64811 | 32 | 0.000003925928467651829 | 28762 | 423854080 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-3df3ae28a1ddd16dc88d | 50 | 50 | 6 | 0.0000046096065489109606 | 28209 | 287539200 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-9538f27c86a575ddeca7 | 184 | 184 | 6 | 0.0000046096065489109606 | 25576 | 228163584 |

## Network observations

### hokonavi-ikebukuro-walk-node-csv+hokonavi-ikebukuro-walk-link-csv

Counts: {"nodes":1887,"links":2196}. Duplicate nodes/links: 0 / 0; dangling references: 0; self-loops: 0; weak components: 1.
Endpoint comparisons: UNKNOWN_CRS_FOR_CSV; mismatches: UNKNOWN. Coverage: {"checked_links":0,"skipped_links":2196,"total_links":2196,"complete":false}.
Literal source floor labels: ["-0.5","-1.0","0.0","0.5","1.0"].
CSV in_out: {"blank_count":0,"distinct_count":1,"distinct_values":{"1":1887}}; elevation: {"blank_count":1887,"distinct_count":0}.

### hokonavi-oedo-shinjuku-network-geojson

Counts: {"features":496,"layers":2}. Duplicate nodes/links: 0 / 0; dangling references: 0; self-loops: 0; weak components: 1.
Endpoint comparisons: CHECKED_IN_METRES; mismatches: 0. Coverage: {"checked_links":263,"skipped_links":0,"total_links":263,"complete":true}.
Literal source floor labels: ["-0.5","-1","-2","-2.5","-3","-4.5","-6","0","1"].
CSV in_out: null; elevation: null.

### hokonavi-oedo-shinjuku-stationmap-geojson

Counts: {"features":465,"layers":18}. Duplicate nodes/links: UNKNOWN / UNKNOWN; dangling references: UNKNOWN; self-loops: UNKNOWN; weak components: UNKNOWN.
Endpoint comparisons: UNKNOWN; mismatches: UNKNOWN. Coverage: null.
Literal source floor labels: ["1階","地下1階","地下2階","地下3階","地下5階","地下6階"].
CSV in_out: null; elevation: null.

## Changes from Phase 1

| Source | Inventory polygon uses before → after | Full polygons before → after | Full triangles before → after |
| --- | ---: | ---: | ---: |
| plateau-13104-ubld-53394536 | 65013 → 79363 | 65013 → 65013 | 148950 → 148950 |
| plateau-13116-ubld-53394576 | 58761 → 98173 | 58761 → 58761 | 64811 → 64811 |

plateau-13104-ubld-53394536 geometry-reference accounting: {"total":14350,"resolved":14350,"unresolved":0,"unsupported_external":0,"signed_reverse":0,"by_context":{"solid":14350}}.
plateau-13116-ubld-53394576 geometry-reference accounting: {"total":39412,"resolved":39412,"unresolved":0,"unsupported_external":0,"signed_reverse":23954,"by_context":{"solid":39412}}.

## Source bbox overlap

BBox evidence only; no feature correspondence or connection is established. See the complete per-layer tables under overlap/.

### ikebukuro

2 source layers; 1 computed pairs. Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.
- plateau-13116-ubld-53394576 / hokonavi-ikebukuro-walk-csv-pair: UNKNOWN; minimum projected separation UNKNOWN m.

### shinjuku

21 source layers; 210 computed pairs. Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-network-geojson:link.geojson: DISJOINT; minimum projected separation 186.44262525628636 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-network-geojson:node.geojson: DISJOINT; minimum projected separation 186.4426252562791 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Facility.geojson: DISJOINT; minimum projected separation 198.82670250489048 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Floor.geojson: DISJOINT; minimum projected separation 198.64586110924006 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_1_Space.geojson: DISJOINT; minimum projected separation 198.64586110924733 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Facility.geojson: DISJOINT; minimum projected separation 196.69090492264158 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Floor.geojson: DISJOINT; minimum projected separation 184.4443807673451 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B1_Space.geojson: DISJOINT; minimum projected separation 184.44438076735264 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Facility.geojson: DISJOINT; minimum projected separation 237.15601733837474 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Floor.geojson: DISJOINT; minimum projected separation 233.92997097011244 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B2_Space.geojson: DISJOINT; minimum projected separation 233.9299709734545 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Facility.geojson: DISJOINT; minimum projected separation 209.7864730376919 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Floor.geojson: DISJOINT; minimum projected separation 203.53365692298723 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B3_Space.geojson: DISJOINT; minimum projected separation 203.5336569218264 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Facility.geojson: DISJOINT; minimum projected separation 194.27228247483097 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Floor.geojson: DISJOINT; minimum projected separation 185.14336080955164 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B5_Space.geojson: DISJOINT; minimum projected separation 185.1433608102574 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Facility.geojson: DISJOINT; minimum projected separation 199.94676774950128 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Floor.geojson: DISJOINT; minimum projected separation 185.12753409180044 m.
- plateau-13104-ubld-53394536 / hokonavi-oedo-shinjuku-stationmap-geojson:Shinjuku_B6_Space.geojson: DISJOINT; minimum projected separation 185.1275340932107 m.

## Independent GSI controls

- ikebukuro-plateau-ubld-v0: maximum absolute E/N control error 0.000048494905058760196 m (required ≤ 0.0005 m).
- shinjuku-plateau-ubld-v0: maximum absolute E/N control error 0.000048494905058760196 m (required ≤ 0.0005 m).

## Open questions

Both stations require current-world checks of paid/unpaid boundaries, operator access, floor/elevation mapping, connectors and source currency. Geometry and source links have not been joined. See generated per-station gap packets.
