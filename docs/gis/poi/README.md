# POI source inspection

`inspectPoi(sourceId)` creates a source inventory from an already acquired file. Its JSON report includes source and tool-input SHA-256 lineage, source manifest rights observations, station IDs, and observations marked `UNVERIFIED` with `routable: false`.

CSV decoding uses fatal UTF-8 first and Shift_JIS as fallback. The report preserves raw headers, duplicate-header notices, blank counts, and bounded literal value distributions for every column, including header-only files. Coordinate columns are accepted only for the two listed Toei source IDs and only under the literal names configured in `tools/gis/src/poi.ts`. Numeric-looking values in other columns are never treated as coordinates.

GeoJSON ZIP members use the bounded shared ZIP reader. The report records member inventories, feature and geometry counts, geometry-derived bounds, literal property keys and bounded distributions, attribution fields, and literal CRS declarations. Missing CRS remains `null`; the report states the RFC 7946 longitude/latitude assumption for standard GeoJSON coordinates without reprojecting them. Custom Path coordinates are inventoried without treating command data as positions. At most 100 point observations are persisted per source; total counts remain in the report. Candidate line edges require explicit literal line and endpoint IDs on a LineString and remain unverified and non-routable.

PDF references require `pdftotext` on `PATH` or an executable path in `GTEKI_GIS_PDFTOTEXT`. The report records page numbers and excerpts of at most 15 Japanese or whitespace-delimited words for matching field, code, and data-date references. A specification PDF is included as source lineage when its acquisition is available.

The report is an input inventory, not a rights determination, current-world POI verification, station match, route, or coverage claim. Source attribution and rights text are observations only.
