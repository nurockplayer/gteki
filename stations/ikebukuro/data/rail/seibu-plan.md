# Seibu Ikebukuro scene slices

2026-11-26 JST. Use [seibu.json](seibu.json) for the three fare boundaries, the seven numbered faces, the unnumbered Limited Express platform, and paid circulation. Build original representative geometry around the approved public seams. The dataset leaves the bank positions and platform centerlines open. Its elevations and dimensions are preview values. Put the two faces of each island on one slab, using the width once, and put each track between its two numbered faces where it serves two. Continue the platform 7 rail to the Limited Express stopping face as a representative terminal assumption.

## Runs

| Run | Budget | Platforms | Work and exit check |
| --- | ---: | --- | --- |
| 1 | 45 min | None | Pick the preview connections to the existing public concourse and street, place all three fare banks, and lay out the paid B1F and 1F concourses. Field evidence can replace the representative seams. Keep the street approach to 西武南口 outside the fare zone and leave stair 36 at its existing B1 foot until an upper tie is established. Walk each public approach across its own bank. |
| 2 | 45 min | 1 | Add the side platform, its track edge, the paid stair and lift from B1F, and the link from the South Gate. Replay from each gate, including the lift route from B1F and a return across the fare boundary. |
| 3 | 45 min | 2 and 3 | Add their shared island with the stair and escalator from the paid B1F concourse. Reuse the track serving 1 for the platform 2 edge. Add the other track edge for 3. Replay both faces from each gate. |
| 4 | 45 min | 4 and 5 | Add their shared island and its own stair and escalator. Reuse the track serving 3 for the platform 4 edge. Add the other track edge for 5. Replay both faces from each gate. |
| 5 | 45 min | 6 and 7 | Add their shared island and its stair and escalator. Reuse the track serving 5 for the platform 6 edge. Build the 7 rail to leave room for its terminal extension. Replay both faces from each gate. |
| 6 | 40 min | Limited Express | Add the unnumbered paid platform and its 1F approach, continuing the rail serving 7. Sign for Laview services and replay from all three gates. Keep boarding and ticket operations for their own run. |

## Integration and acceptance

- Keep Seibu data and scene work under lane-owned `seibu*` paths. Hand the public-seam and preview entry wiring to `rail-scaffold-ikebukuro`. The approach must cross a fare bank before the paid path starts. `exit-37` and `exit-38` remain public exits. Use the South Gate POI `seibu-minami-guchi` as the identity tie.
- Load the Seibu geometry lazily on approach under `?next=1`. Measure on desktop and phone with both floors visible during transitions. Keep each visible floor at ≤30 draws, each slice at ≤60,000 added triangles, and the cold Ikebukuro phone load within 1,500 ms.
- For each added face, replay walking and the return route from the existing public concourse through each bank. Check physical fare fences, step and lift landings, track-edge collision, and signs. Show 1, 4 and 6 as alighting-only, 2, 3, 5 and 7 as general departures, and the unnumbered face as Limited Express. Check flag-off golden-camera and route parity at integration.
