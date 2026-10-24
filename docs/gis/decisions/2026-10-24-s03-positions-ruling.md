# Ruling: S03 approximate gate and transfer positions (WP8)

- **Date:** 2026-10-24
- **Decided by:** gteki-1b (GIS lead), under Owner Q2/Q3 and the R-1/R-2 publish-gate rulings of the same day.
- **Applies to:** `gis s03-positions`, the private positions file it writes under `~/.gteki/gis-store/out/s03/` and the public receipt `docs/gis/s03/positions-<digest>.json`.
- **Implementation:** `tools/gis/src/s03-positions.ts`; contract in `docs/gis/s03/positions-import-contract.md`.

## Ruling

Each S03 ticket gate and transfer gets one **approximate representative point**: the area-weighted centroid of all parts of its S03 feature geometry, or the closest point of the largest part's boundary when that centroid falls outside every part. The point carries the label `approximate (±max(5 m, polygon radius))`, `navigation_use: NOT_FOR_ROUTING`, `gteki_role: context` and floor `UNVERIFIED`. It is search display only; it is never routing, never a connector and never evidence of navigability.

Platforms keep their names only. No other S03 geometry ships. Names stay `CONDITIONAL` (search only); the gate and transfer points are `CONDITIONAL` alongside them; everything else in the lane stays `HOLD`.

## The excluded gate

The ruling expects 26 candidates (23 gates, 3 transfers), but WP7 (`2026-10-24` topology rulings) excludes one gate feature whole: `poi:keio-gate:1`, `SOURCE_DEFECT_HOLE_OUTSIDE_SHELL`. The lead ruled, in writing, that this POI **stays name-only**: no coordinates, no geometry repair, no substitute position. The private positions file lists it with its reason code; the public receipt carries only the count and the reason code, with no id.

The expected outcome is therefore fail-closed at **25 pointed, 1 unpointed, 19 platforms**. Any other outcome stops the run.

## Not a rights change

This record is not a rights PASS and does not widen the publish gate, which stays `CONDITIONAL` with licence fields UNKNOWN. It records what may be derived and how it must be labelled; it does not establish that the source is licensed for redistribution.
