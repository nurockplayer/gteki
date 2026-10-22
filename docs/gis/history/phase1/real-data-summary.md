# Real-data run summary

Generated from acquisition, inventory, conversion and network JSON; no counts are manually maintained. All results are UNVERIFIED and NOT_FOR_ROUTING.

Tool-input SHA-256: `3b6f085efcc168fac3ad688e5108393625cc94176fe963ce278a0d7ea3594745` (src, source manifest, frames, synthetic tests/fixtures, package/lock/workspace/TypeScript configuration; sorted relative names plus exact bytes).

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
| plateau-13104-ubld-53394536 | 30358 | 65013 | 65081 / 68 | 343921 | 0 / 0 |
| plateau-13116-ubld-53394576 | 32 | 58761 | 58795 / 34 | 241060 | 0 / 0 |

## Conversion readback

| Run | Polygons | Triangles | Nodes | Bbox error m | Time ms | Peak RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-1b025a90ae21ab09 | 6 | 12 | 1 | 0.00000452290078101214 | 6436 | 346030080 |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-b9f1954bd40df5b6 | 65013 | 148950 | 30358 | 0.0000054997890401864424 | 19063 | 1100627968 |
| plateau-13104-ubld-53394536-013e81b5-shinjuku-plateau-ubld-v0-eba97abb1c84b8f3 | 6 | 12 | 1 | 0.00000452290078101214 | 5641 | 741933056 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-109e241011a0a4ab | 184 | 184 | 6 | 0.0000046096065489109606 | 4793 | 261406720 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-5d0392ea7bb289ac | 10 | 2046 | 1 | 0.000003925928467651829 | 17113 | 214728704 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-5d2638fcd4e0ff93 | 58761 | 64811 | 32 | 0.000003925928467651829 | 6120 | 269762560 |
| plateau-13116-ubld-53394576-38f17964-ikebukuro-plateau-ubld-v0-b9663c719c89bc0c | 50 | 50 | 6 | 0.0000046096065489109606 | 4334 | 250265600 |

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
Literal source floor labels: ["value_sha256:c86b35ff294bed1ceee8cda02b57630479fce5c3c93557efd786105e43245d3c","value_sha256:541f4bbc612294c0f7951e58215a8f4002090729f30dfd429c255ec12d7d079b","value_sha256:c0836dff4714db1e120615df114e789a33e801b9706330dc44c5f16827a0ba46","value_sha256:2f2d864b68d26ac9634202a415e0f7ee274b100914327fce73298a5e14f7954f","value_sha256:27a651ea63fba300793d9bcf3a39e29e0328550778395490c73fee1c3dde9512","value_sha256:317a1a345f26128a5ebe72df6725f57f6f4aa1f3f462358dff1d503ce48a0db8"].
CSV in_out: null; elevation: null.

## Open questions

Both stations require current-world checks of paid/unpaid boundaries, operator access, floor/elevation mapping, connectors and source currency. Geometry and source links have not been joined. See generated per-station gap packets.
