# Shinjuku operator facilities: public-source GAP

Written 2026-11-03 05:01 JST. Scope: 小田急線, 京王線, 京王新線 and JR lifts, escalators and multifunction toilets. **0 POIs imported.** This is the brief's docs-only outcome; no station data, graph, floor, position or connector changes.

## Result

S03 prints facility kinds and levels, but the inspected facility records do not print an operator, ticket-gate side or nearest gate. The MLIT ほこナビ inputs already used for `poi:elevator:*` cover E27 and supply no target-operator facility attribution. Operator pages provide additional information, but are corroboration only under the lead's OD-34 decision. No individual target-operator facility was found with a usable-source identity tie; generic S03 devices must not be attributed by their proximity to a named gate.

| Operator | Imported lifts | Imported escalators | Imported toilets | Public result |
|---|---:|---:|---:|---|
| 小田急線 | 0 | 0 | 0 | facilities GAP (operator pages only) |
| 京王線 | 0 | 0 | 0 | facilities GAP (operator pages only) |
| 京王新線 | 0 | 0 | 0 | facilities GAP (operator pages only) |
| JR (all four matrix line groups) | 0 | 0 | 0 | facilities GAP (operator pages only); operator page fetch blocked |

## Usable sources inspected first

### S03 — `tokyo-s03-zip`

Existing local archive read 2026-11-02T19:58:42Z (UTC); attributes inspected 2026-11-02T19:59:03Z (UTC). Provider acquisition: [record](../../gis/acquisitions/tokyo-s03-zip.json), 2026-10-21T00:13:55.368Z (UTC). URL: https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/zip_kiban_shinjuku_terminal_pdf_shisetsu_root . 2,317,035 bytes; SHA-256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31` (recomputed, matches record). CC BY 4.0 factual-field use per the brief; no new rights decision.

- Inspected all eleven `geojson-level-geom-*.geojson` members, `com-entity.geojson` and `v5_nav.json`; did not use the held graph for routing or publish geometry.
- Level-geometry `properties.facility`: 103 `elevator`, 284 `escalator`, 45 `bathroom`, 6 `universalaccesstoilet` records. These are **geometry records, not distinct physical machine/toilet counts**; multiple levels or directions may describe one device.
- Facility attributes found: `display_name`, `facility`, `to`, `from`, `openinghour`, `gender`, `disabledaccess`, `type`. Names are generic device names. None of these 438 records prints JR, Odakyu, Keio, 小田急, 京王 or a ticket-gate name. Level membership supports a printed S03 level, but does not itself support operator attribution or a tie to the bundle's Toei floors.
- `universalaccesstoilet` occurs four times on B1F, once on B2F and once on B3F; its `type` values describe disabled access, changing stations or ostomate facilities, without an operator/gate tie.
- `com-entity.geojson` has two facility-named entities: 駐車場用エレベーター and ７階段周辺トイレ (English name identifies a Universal Access Toilet). Their `properties.geometry` / `int_address` references identify source shapes, but neither entity prints one of the target operators or a gate. Do not relabel the parking lift as a railway lift or infer JR from the stair number.
- All 2,506 nav nodes have only `id`, `l`, `mx`, `my`; `l[].lid` / `gid` join to levels and shapes. All 2,653 nav links have `n1`, `id`, `d`, `n2`, `dm`, with `dz` on 246 links. Neither nodes nor links carries an operator, gate or paid-side field. A matching `facility` at link ends supports device kind, not the requested operator identity.
- This agrees with the [existing reason-code desk pass](s03-reason-codes-desk-2026-10-26.md) and [locating note](s03-dz-locate-2026-10-26.md): their nearest named contexts are spatial comparisons, not printed operator assignments. The S03 routing HOLD stays unchanged.

### MLIT ほこナビ — `mlit-hokonavi-e27-nwd`, `mlit-hokonavi-e27-stationmap`

Existing local archives and map attributes inspected 2026-11-02T19:59:03Z–19:59:59Z (UTC). Provider acquisition recorded 2026-10-20T10:45:52Z (UTC) in [the existing manifest](../../../stations/shinjuku/sources/manifest.json). Both archive hashes recomputed and matched:

| Input | Bytes | SHA-256 |
|---|---:|---|
| `nwd_oedo_shinjuku_geojson.zip` | 42,909 | `f3d9c3224e042ba2919730136ddbd88c411fac0af58875085007f5ceaae497ff` |
| `stationmap_oedo_shinjuku_geojson.zip` | 74,513 | `43a297c028a4ffca3d3bdb3fb1da486e97291a276eadca56801c3b00fa4a9090` |

Dataset URL: https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45 . The existing manifest records exact download URLs. This is the E27 resource already authorized by the brief, not a newly acquired JR indoor dataset.

Inspected all six levels' `Facility`, `Floor` and `Space` properties and the existing NWD node/link field definitions. `Facility` has seven F012 lift points; existing POIs group these as three E27 lifts. No inspected map property names JR, 小田急 or 京王. The NWD fields describe geometry/accessibility rather than named target-operator facilities. The E27 facilities are not copied into another operator's namespace.

## Operator corroboration receipts (plain curl, default User-Agent)

`curl -s --max-time 45 -L`; no custom headers, browser, login or raw files committed. Read times below are UTC. PDF text was extracted locally; no map coordinates or symbol positions were transcribed.

| Resource | URL | UTC read time | HTTP | Bytes | SHA-256 |
|---|---|---|---:|---:|---|
| odakyu | https://www.odakyu.jp/station/shinjuku/ | 2026-11-02T19:59:17.097535Z (UTC) | 200 | 74,386 | `a9b7b9d6049fa11ff1cb5d3cd0c51c0a2488dc9382e3f671931a2d17c82a4e41` |
| keio | https://www.keio.co.jp/train/station/ko01_shinjuku/ | 2026-11-02T19:59:19.141113Z (UTC) | 200 | 110,853 | `8fa755303d6fdb4e7324a6bc1cfdfb043f00f6f376b715182ad22dece8d325bd` |
| jr | https://www.jreast.co.jp/estation/stations/866.html | 2026-11-02T19:59:19.427929Z (UTC) | 403 | 410 | `0723052081767338549141a8099828683e6b49741773e40ae3dc7dbc92d63c68` |
| keio-map | https://www.keio.co.jp/train/station/station_map/pdf/ko01_shinjuku.pdf | 2026-11-02T20:00:08.447103Z (UTC) | 200 | 185,432 | `d0f5be491fcfe9d8ac0afa108e13ead84df5b437e797c178bff876a56cabf6df` |
| keio-new-map | https://www.keio.co.jp/train/station/station_map/pdf/ko01_newline_shinjuku.pdf | 2026-11-02T20:00:08.602324Z (UTC) | 200 | 172,915 | `16ff1aa4510dbb63a7e41a35946317376f3d9fe52cbe23a7bd857e5fe6d0c928` |

## Skipped

| Operator / candidate | What the operator source prints | Why skipped |
|---|---|---|
| 小田急 lift by 南口改札口 | Station page says lifts can be used between the south gate, ground platforms and underground platforms. | No usable-source record uniquely ties that printed connection to a target-operator device. |
| 小田急 escalators and accessible toilets | Page/map legends list escalators, wheelchair-accessible cubicles and ostomate facilities; station equipment lists accessible toilets. | Legend and service presence are not an individual facility inventory backed by a usable source. |
| 京王線 lifts, escalators, accessible toilets | Station page marks lift/escalator and wheelchair/ostomate toilet availability. Linked 京王線 map has B1F/B2F and gate labels, plus device legends; map date 2025年3月末現在. | Operator-only map labels cannot provide public facility identity, floor or side. No physical counts inferred from legends. |
| 京王新線 lifts, escalators, accessible toilets | Separate map has B1F/B4F/B5F, 京王新線口 / 新都心口, device legends, and partial escalator closure/update-work notices; map date 2026年3月末現在. | No usable-source identity tie. Availability and construction status are not imported. |
| JR lifts, escalators, multifunction toilets | Requested station page returned HTTP 403; no facility facts read from that response. | Block recorded once, no alternate transport or retry. S03 generic devices alone do not establish JR ownership. |

Each candidate above is covered by its operator URL and UTC receipt in the preceding table; none creates a station source record, because there is no new cited POI.

## Assumptions and re-entry

- The brief requires a usable source to support the **same identifiable facility in the named operator area**, not just the existence of generic devices somewhere in Shinjuku. Nearest-gate geometry and operator-only diagrams do not establish that tie.
- Printed S03 levels are not mapped onto the bundle's Toei `floorId`s. No positions are guessed.
- The requested six matrix cells (four JR rows, 小田急線, 京王線) carry the GAP; 京王新線 is covered here and the existing 京王線 shared-gate row. No other matrix cells are changed.
- Re-entry: a usable source printing an operator/gate/facility tie, or an authorized field receipt establishing it. No new data source acquisition or rights decision is proposed.
