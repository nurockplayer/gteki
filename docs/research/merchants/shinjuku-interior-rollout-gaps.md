# Shinjuku department-store interior entrance gaps

2026-11-25 JST. Journey row: none (Owner request 2026-11-22).

Rechecked `origin/main` at `cb0ef7c1` after [phase 1 #1511](https://github.com/nurockplayer/gteki/pull/1511) merged. Its PLATEAU data maps all 11 stores to 10 building parts. Every corresponding Shinjuku POI still has an empty `connectorNodeIds` array and a null `displayPosition`. The phase 1 search fallback takes the player to a modeled station exit and displays the unverified-entrance warning. It provides no walkable connection from the exit to a store doorway. The named accesses below come from the phase 1 access research.

The distances are straight-line plan distances from the search destination's exit node to the closest point on the exterior footprint boundary. The distances describe the remaining gap and do not measure a walking route.

| Skipped store | Search destination | Gap to footprint | Missing entrance |
| --- | --- | ---: | --- |
| `isetan-shinjuku-main` | `poi:exit:1` | 542.7 m | Metro Promenade B5 food-floor connection has no positioned node in this scene. |
| `isetan-shinjuku-mens` | `poi:exit:1` | 635.4 m | The B1 link to the main building is outside the modeled graph, and the storefront has no positioned street door. |
| `odakyu-shinjuku` | `poi:exit:1` | 373.3 m | HALC's West Exit concourse connection has no node in the modeled graph. |
| `shinjuku-marui-main` | `poi:exit:1` | 619.6 m | Shinjuku-sanchome A1 and the adjacent B1 entrance are outside the modeled graph. |
| `shinjuku-marui-annex` | `poi:exit:1` | 635.0 m | The street approach from Shinjuku-sanchome C4 has no modeled path to a positioned street door. |
| `lumine-1-shinjuku` | `poi:exit:1` | 31.5 m | The Keio Lumine gate is unmodeled, and the access source does not locate a building-specific entrance. |
| `newoman-shinjuku` | `poi:exit:3` | 130.5 m | The JR Miraina Tower, Koshu Kaido and New South gates and E10 have no modeled tie to a store door. |
| `lumine-est-shinjuku` | `poi:exit:1` | 290.5 m | The JR central east and east gates have no modeled approach to a positioned store door. |
| `lumine-2-shinjuku` | `poi:exit:1` | 124.2 m | The Keio Lumine gate is unmodeled, and the access source does not locate a building-specific entrance. |
| `keio-shinjuku` | `poi:exit:1` | 31.5 m | The Keio department-store gate has no modeled entrance connection. |
| `takashimaya-shinjuku` | `poi:exit:4` | 232.1 m | The direct Shinjuku-sanchome B1 entrance has no modeled connection. |

This table is the pre-rollout audit. The Owner's 2026-11-24 JST street-approach rule allows a source-backed preview door fitted to the PLATEAU footprint and a walk at street grade from the listed exit. `stations/shinjuku/data/depato-rollout.json` records the separate Keio and Lumine 1 doors and interior extents on their shared building part. Both approaches start at Exit 1.
