# Ikebukuro JR preview scene plan

2026-11-26 JST

Use `jr.json` for the five fare gates, four physical islands and eight numbered platform faces. Use the existing Central 1, Central 2 and South B1 graph nodes as public approach anchors. Locate the North and Metropolitan public approaches before building those gates. Place the paid landings, track edges and platform dimensions as representative geometry in the station frame. Keep the 1F and 2F elevations representative until there is a surveyed tie to the station frame.

| Run | Platforms | Work and handoff |
| --- | --- | --- |
| 1 · up to 50 min | 5 and 6 | Build the first island and both numbered faces. Use Central 1 and Central 2 for the first public-to-paid routes and confirm a return through each gate. Coordinate with the scaffold owner to supersede the Central 2 Yamanote sample when the JR builder takes over. |
| 2 · up to 50 min | 5 and 6 | Connect South via `g_jr_s`. Model the shared Central 1 and South paid area and the island’s stair, escalator and lift routes. Verify a continuous lift route from each gate. |
| 3 · up to 50 min | 5 and 6 | Connect the North gate from the public North Passage and build its stairs. First locate the public tie-in to the existing concourse with the scaffold owner. |
| 4 · up to 50 min | 5 and 6 | Locate the public approach to the 2F Metropolitan gate, then build its paid bridge and the stair down to the island. Coordinate any shared concourse tie-in with the scaffold owner. |
| 5 · up to 50 min | 1 and 2 | Add the Saikyo and Shonan–Shinjuku faces toward Shinjuku on their shared island. Extend the established access from all five gates, including lift access from Central 1 and South. |
| 6 · up to 50 min | 3 and 4 | Add the Shonan–Shinjuku and Saikyo faces toward Akabane and Ōmiya on one island. Extend the same five gate approaches. |
| 7 · up to 50 min | 7 and 8 | Add the outer-loop Yamanote island and all five approaches. Check the complete set of public-to-paid routes and measure the combined visible-floor and load budgets. |

Build one walkable deck per island, with two signed, separately reachable platform faces and track edges. Use the Shinjuku Ōedo platform and fare boundary as references for walkable geometry, colliders and gate crossings. Give each stair, escalator and lift its own positioned landings and route edges. The register groups these links by island and marks the Central 1 and South hall as representative, so give the scene distinct waypoints for the hall, devices and platform goals. Verify that each approach crosses the fare boundary at its own gate and can return to its public concourse. Keep the North, Central 2 and Metropolitan approaches on stairs and preserve lift access to each island from Central 1 and South.

Use the scaffold’s approach-triggered lazy loading under `?next=1`. Its current trigger is 12 m from a public gate POI. Keep rail geometry off the initial station load and within 30 draws per visible floor and 60,000 added triangles per slice. Check the Ikebukuro 1,500 ms load budget and compare flag-off output for zero golden-camera or baseline-route changes. The scene runs cover walking access and static tracks. Train operation is a later step.
