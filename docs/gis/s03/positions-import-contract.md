# S03 approximate position import contract (WP8)

`gis s03-positions` writes one private document to `~/.gteki/gis-store/out/s03/positions-<digest>.json` and one public receipt to `docs/gis/s03/positions-<digest>.json`. Only the private document carries coordinates. The receipt carries counts, reason codes and distributions only: no coordinate, no name, no source id.

## Provenance of the position

Each S03 ticket gate and transfer gets one representative point: the area-weighted centroid of all parts of its S03 feature geometry in the horizontal station frame, or the closest boundary point of the largest part when that centroid falls outside every part (`method` records which). The point is labelled `approximate (±max(5 m, polygon radius))` with `uncertainty_m = max(5 m, radius to the farthest vertex)`, rounded up to 0.1 m. It is `NOT_FOR_ROUTING`, `gteki_role: context`, and its floor ordinal is `UNVERIFIED` (an asserted label-to-ordinal map, not a surveyed floor or elevation). The datum is `UNKNOWN` and not asserted; the spec's "absent crs means WGS84" statement is used for projection only.

`positions[]` fields: `poi_id`, `s03_entity_id`, `category`, `level_id`, `level_label`, `floor_ordinal`, `lon`, `lat`, `east_m`, `north_m`, `radius_m`, `uncertainty_m`, `method`, `part_count`, `vertex_count`.

`s03_entity_id` is the numeric feature id of the source `geojson-level-geom-<label>.geojson` member, **not** a `com-entity` id. It is joined to the shipped POIs through `docs/research/lines/shinjuku-line-pois.json`, read-only; `stations/**` is untouched.

## What stays out

- **Platforms:** listed (`platforms_skipped`) with `poi_id`, `s03_entity_id` and category only. No point, no floor. Names stay name-only.
- **One gate stays name-only:** `poi:keio-gate:1` is unpointed because WP7 excludes its feature whole (`SOURCE_DEFECT_HOLE_OUTSIDE_SHELL`). No coordinates and no geometry repair. It is listed in the private `unpointed[]`; the public receipt shows only the count and the reason code.
- **Everything else from S03** (other geometry, connectors, routes) remains unshipped.

Any importer must keep these points out of routing, connectors and any navigability claim. They are search-display context only.

## Credit

出典：東京都都市整備局「新宿駅周辺の施設情報等」

The NOTICE 4.7 change notice applies: GTEki derived approximate representative points from the source geometry (area-weighted centroids, with the fallbacks recorded above) and added 「未確認・経路なし」-style annotations. This is not a rights PASS; the publish gate stays `CONDITIONAL` with the licence fields UNKNOWN.
