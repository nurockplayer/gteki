# ikebukuro bbox overlap report

Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.

BBox overlap only. It does not establish that features coincide, share a floor, or connect; it is not routing evidence.

- plateau-13116-ubld-53394576 ↔ hokonavi-ikebukuro-walk-csv-pair: UNKNOWN; boundary-distance approximation UNKNOWN (32 samples per edge; UNKNOWN_CRS_OR_BBOX).
