# Ikebukuro Tokyo Metro scene plan

2026-11-26 JST

Each JSON records two numbered faces of one island. The seven physical gates each have a B1 public endpoint keyed by the existing search POI and a separate paid endpoint. Each gate edge crosses the fare boundary once. From the paid endpoint, the stairs and listed devices lead to the shared island and its two platform faces. The shared nodes stand for areas where later geometry can place distinct landings. An escalator with `direction: "up"` runs only from its lower endpoint to its upper endpoint. The other listed escalator connections have up and down service.

| Line | Sourced platform fields | Representative preview fields |
|---|---|---|
| M25 | No. 1 / track 1 and No. 2 / track 2, both B2 and both listed for Ogikubo-direction departures. | One 8 m × 120 m island. B2 render z is 22.9 m. |
| Y09 | No. 3 / track 3 towards Shin-kiba and No. 4 / track 4 towards Wakoshi, both B2. | One 8 m × 210 m island. B2 render z is 22.9 m. |
| F09 | No. 5 / track 5 towards Shibuya and No. 6 / track 6 towards Wakoshi, both B4. The east-gate lift route changes lifts at the B2 paid mezzanine. | One 8 m × 210 m island. B2 mezzanine render z is 22.9 m and B4 render z is 12.9 m. |

Widths describe the whole island and lengths are preview sizing allowances for six-car M25 and up to ten-car Y09/F09 trains. The 27.9 m B1 datum comes from the existing public scene. Gate positions and platform centerlines are unset for all three lines. Design the deck outlines and thresholds in station ENU against the existing B1 scene. Use the facts for the order, levels and served ends. The source diagrams provide names, device types and connectivity.

## Scene runs

| Run | Time cap | Deliverable |
|---|---:|---|
| M25 | 45 min | Build both B2 faces (1/2) and the paid stairs from the three Central Passage gates, in west–central–east order. Place the west lift near the terminus end and the east up escalator near the Ogikubo end. Use a station-integrator handoff for the B1 public approaches. |
| Y09 | 45 min | Build both B2 faces (3/4) below the South Passage and attach both B1 gates. Place the west lift at the Wakoshi end and west escalators around the center/Wakoshi end. Place the east escalators around the center/Shin-kiba end, with the extra Shin-kiba-end escalator going up. Treat Exit 4 as public-side context until its physical tie is established. |
| F09 public approach | 35 min | Give the Ikebukuro integration owner the B1 seam for the westward Echika/C-series approach from the existing public concourse. Establish a preview passage to both F09 gate fronts and label the representative join. Confirm the seam before attaching below-grade geometry. |
| F09 east | 45 min | Build both B4 faces (5/6) and the paid route from West Passage East Gate via the B2 mezzanine. Place separate B1–B2 and B2–B4 lifts and the stair/escalator routes. |
| F09 west | 30 min | Attach West Passage West Gate to the existing 5/6 island with stairs and a center/Wakoshi-end escalator. Walk both routes and their returns to the public B1 approach. |

Put each line's meshes and route contributions in its own `scene/rail/metro-<code>*` files. The Ikebukuro integration lane owns the shared scene, graph, signage and public seam. Use the E27 platform edge, fare fence and identity builders as references for gate controls, doors and signs. Activate geometry only under `?next=1` and load it lazily on approach. Keep the existing flag-off routes and golden cameras at zero changes.

For each slice, replay the paid walk from the public concourse through each attached gate to both faces and back. Check fare boundaries, platform-door protection, directional signs, device directions and floor changes on desktop and phone. Measure ≤30 draws per visible floor and ≤60,000 added triangles per slice. Check the 1,500 ms phone station-load budget with distant rail geometry off the initial path.

The published paid M25–F09 passage and the documented public fare-transfer option both belong in the transfer follow-up. Verify their openings and fare controls independently. Keep the M25 Exit 34/35 lift conflict and F09 public lift landings on the field list. Tokyo Metro's current map JPEG returned HTTP 403 with default curl. The Tokyo Metro joint release diagram and operator equipment listings supply the factual references used here.
