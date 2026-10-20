# Ikebukuro — coverage gaps and field-survey brief

Machine-readable twin: `coverage.gaps` in `data/graph.src.json` → `gteki/station.json`.
Every item below is currently **null / unroutable** in the data. Nothing here may be filled by
assumption; each needs the evidence named in the "close with" column. Field visits follow the
repo's photo rules (public areas only, no faces, no staff-only zones, operator signage photographed
for facts only and never published).

| Gap id | Where | Missing fact | Close with | Unblocks |
|---|---|---|---|---|
| `gap-hours` | all B1 passages and exit stairs | opening hours | official hours statement per exit, or dated on-site photo of the posted hours | `hours:"require_known"` routing profile; night-time warnings |
| `gap-metro-tobu-gates` | Central Passage west/centre | which PLATEAU openings are the Marunouchi west/central/east gates and the Tobu central gates 1/2 (two floor-level openings near the projected Marunouchi gates look like stairwells) | on-site check of gate lines against column positions (columns are in the GLB, so a column count per bay is enough) | routing to 5 gate POIs that are search-only today |
| `gap-step-free` | east hall → east corridor (TP 27.8 → 26.9 m) and every exit | lifts/escalators/ramps: EF_80 transport geometry exists, but type, served levels and hours are unknown | Tokyo Metro / Toshima accessibility pages (facts only) + on-site confirmation | `stepFree` profile (currently fails safely with `no_path`) |
| `gap-exit-41` | South-east | Exit 41 stair is on a corridor outside slice 1 | author the South Passage slice (geometry is already in PLATEAU) | exit-41 POI routing |
| `gap-freshness` | whole slice | geometry is a 2023 survey; later construction unknown | dated walk-through comparing columns, exits and openings with the GLB | lifts the stale flag for slice 1 |

## Next slices (geometry already present, desk work first)

1. **South Passage**: exits 38, 39/40, 41; links to the Central Passage's south side.
2. **North-east**: Cherry Road / ISP side, exits 26, 28, 32, 33.
3. **West**: Tobu side, Hope Center, west exits.
4. **Street level**: exit stair tops are modelled as daylight portals. A street-level GLB (PLATEAU
   bldg/tran LOD1–2 around the station) is needed before exits can be walked out of.

## Survey checklist (one visit covers all five gaps for slice 1)

- Walk JR Central Gate 2 → Exit 35 and Exit 43; at each exit stair foot, photograph the posted
  hours (facts only) and note any lift or escalator.
- At the Marunouchi and Tobu gate lines, count columns from the nearest exit stair to each gate
  line and note which side each gate faces.
- Note any shop, wall or opening that differs from the GLB (screenshots from the preview at
  `?spawn=<node>` make side-by-side comparison easy).
- Record date and time on every note; the date goes into `retrievedAt` / `datasetDate`.
