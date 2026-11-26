# Shinjuku Keio and S01 scene plan

2026-11-26 JST

`evidence/keio.json` covers five tracks and seven passenger faces across four physical decks. Both operators use the B5 island. Keio manages the joint station. The inventory includes the eight S03 gate POIs, the JR transfer and the Maynds Tower approach named in the Toei guide. When the first scene slice places thresholds, add the runtime lane JSON alongside this plan and declare it with its sources in the station manifest.

| Platform face | Sourced facts | Representative preview |
| --- | --- | --- |
| 1 | Track 1, Keio Line, B2F | Shared boarding deck with face 2, deck dimensions and gate approaches |
| 2 | Track 2, Keio Line, B2F, boarding face | Shared boarding deck with face 1, deck dimensions and gate approaches |
| 2 alighting | Track 2, Keio Line, B2F, alighting-only face | Shared alighting deck, deck dimensions and egress |
| 3 alighting | Track 3, Keio Line, B2F, alighting-only face | Shared alighting deck, deck dimensions and egress |
| 3 | Track 3, Keio Line, B2F, boarding face | Separate boarding deck, deck dimensions and stair approaches |
| 4 | Track 4, B5F shared island, Keio New Line towards Sasazuka and through service from the Toei Shinjuku Line | Island dimensions and device placement |
| 5 | Track 5, B5F shared island, normally Toei Shinjuku Line towards Motoyawata with some Keio New Line departures | Island dimensions and device placement |

The S03 points in `areaHint` are historical search context with uncertainty in metres. Use the station ENU frame for future preview placement, with x east, y north and z up. B1 uses the existing E27 concourse render elevation. B2 and B4 reuse its render heights as a modelling convention and B5 has a representative height above B7. Widths and lengths are draft deck dimensions. Populate gate threshold positions and platform centerlines when building each scene slice and fit them against reachable public concourse, using independently drawn geometry.

## Scene runs

Each run has a 50-minute limit and writes the `keio*` lane files. The scaffold owner wires public concourse and shared fare joins outside the E27 bake.

| Run | Work and acceptance |
| --- | --- |
| SJ-K1, ≤45 min | Place the first B1 approach and paid threshold at Keio West. Fit the Keio gate pockets to the existing concourse. Check that public-to-paid traversal crosses the gate and that both public and paid landings are walkable. |
| SJ-K2a, ≤45 min | Build the B2 boarding deck for tracks 1 and 2, their two track faces and the West/Department Store access. Walk a public-to-platform route and its return for each face. |
| SJ-K2b, ≤45 min | Add track 3 boarding, the alighting deck for tracks 2 and 3, and the Lumine approach. Add Hiroba and Rinji as egress-only crossings. Check that those exits can be reached from paid space and reject inbound traversal. |
| SJ-K3a, ≤50 min | Build both B5 faces as one island and fit the New Line Gate approach, including the B4 landing and lift. Label both lines, keep track 4/5 signs distinct and walk each side of the island from the same gate. |
| SJ-K3b, ≤45 min | Add Shintoshin access and the representative paid stair between New Line Gate and track 3. Check the other S03 New Line Gate identity before placing another threshold. Verify approach directions and the linked routes on desktop and phone. |
| SJ-K3c, ≤45 min | With the integration owner, tie the Maynds approach to the existing E27 gate and B4 transfer once identified, and reconcile the JR transfer with its one JR-side gate. Check a single fare transition at each applicable threshold and both S01 destinations from Maynds. |

Use the Oedo B7 platform-edge and fare-fence behavior as the scene reference. Connect representative routes only in `?next=1`. Lazy-load geometry on approach, target ≤30 draws per visible floor and ≤60,000 added triangles per slice, and use the 1,500 ms cold phone load budget. For each slice, check floor openings, collisions, forward and return routes, signage and phone counts. Flag-off acceptance is zero golden-camera changes and baseline route parity.

## Assumptions

- The numbered platform records represent passenger faces, so the alighting deck has two records sharing its physical deck ID. The JSON uses a single lane and the joint KO01/S01 label.
- The connector list is a minimal preview graph. A platform-to-platform walk links faces on a single deck. The B1 links model paid circulation and the main-line device assignments remain representative.
- Model Hiroba and Rinji as outward crossings. The JR passage crosses between paid fare areas. Maynds uses the existing E27 route after its gate tie, with the B4 connection represented in the S01 data.

## Follow-ups

- Verify the second S03 New Line Gate identity, the exact Maynds POI and floor, current construction detours and openings, the B1 paid-circulation ties and main-line lift, escalator and stair landings. Use the field receipt or lawful geometry for exact placement.
- The S05 Keio diagrams corroborate the facts. Their reuse status is UNKNOWN. The JRTT and Tokyo urban-development reports supply public factual references under the terms recorded in the JSON, with no numbered repo ruling for those two documents.
