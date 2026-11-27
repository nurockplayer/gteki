# Shinjuku M08 preview scene plan

2026-11-26 JST

Tracks 1 and 2 are opposite boarding edges of one B2F island. Both B1F gate groups reach both edges. The source supports the East paid stairs, lift and up-only escalator at the Ikebukuro end and the West paid stairs at the Ogikubo end. Street lifts and the B11 escalator are on the public side.

`metro-m08.json` uses one public and one paid endpoint per gate group. Its connectors express reachability to both boarding edges through the same equipment at each end. In the scene, use one shared B2 landing per end and walk links to each edge. Before adding positions, wire those landings and the up-only escalator direction into navigation. The representative model uses a single 120 m deck with two 4 m boarding sides. Use the existing B1 render height of −7.8 m as the preview datum and start the island at −12 m. These heights describe preview geometry. Choose the centerlines and gate coordinates against the station frame when the public seam is placed. Keep S03 search POI matches as candidates until field item 31 supplies a tie.

| Run | Platforms | Build | Time budget |
| --- | --- | --- | --- |
| SJ-M2 | Public approach only | Coordinate with `rail-scaffold-shinjuku` on the seam from the existing public concourse to the two B1 gates. Build the M08 public approaches and separate fare crossings in lane-owned files. Use original preview geometry with the west gate toward Ogikubo and the east gate toward Ikebukuro. | 40 min |
| SJ-M3 | 1, Ogikubo side | Build the shared B2 island, both stairs, the East lift and the up-only escalator. Add track 1, tactile, screen doors, collision and bilingual wayfinding using the E27 platform edge as the implementation reference. Walk from both gates to track 1 and back, including an East step-free route. | 50 min |
| SJ-M4 | 2, Ikebukuro side | Add track 2 and its boarding edge, barrier and signs on the same deck. Walk from both gates to both edges and back on desktop and phone. Check that unpaid routing rejects each boarding edge and that the escalator routes from B2 to B1 only. | 45 min |

Load M08 geometry on approach under `?next=1`. The integration lane owns the shared scene, graph and sign wiring. Keep the baseline routes and golden cameras identical and use the existing E27 route as the baseline comparator. Measure the phone frame at the gate-to-platform transition against ≤30 draws per visible floor and ≤60,000 added triangles per slice. Check the 1,500 ms phone load budget with M08 off the initial station path. Running trains come after this programme's walking acceptance.
