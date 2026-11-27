# Shinjuku Odakyu scene plan

2026-11-26 JST · SJ-O1 handoff

The preview covers nine passenger faces across five terminating tracks. On 1F, 2/3 and 4/5 are opposite faces of their respective islands, while 6 is the remaining alighting face. On B1F, 8/9 are opposite faces of the central island, with 7 and 10 as the outer alighting faces. Physical track sharing is a separate relationship. Use one track for each `track` ID in the JSON, so 3/4, 5/6, 7/8 and 9/10 each face the same rail bed.

The 1F preview strips follow the broad positions of the numbered S03 sections. The B1F strips use the two-track arrangement and a representative footprint. Each strip approximates the area by a numbered face. Where two faces form an island, build one continuous walk surface between their outer edges. Read S03 gate context by `poiId` from `stations/shinjuku/sources/s03-approx-positions.json`. Align the representative threshold and both ready-to-walk landings to the scene before connecting to the corresponding POI. The 1F, B1F and 2F heights are symbolic until the integration lane ties them to the scene.

| Run | Time cap | Preview slice and acceptance |
|---|---:|---|
| SJ-O2 | 45 min | West Ground public approach, fare threshold, paid 1F head concourse and the 4/5 island. Build static rail beds t2/t3, their edge treatments and 4/5 signs. Walk from the existing public concourse through the gate to both faces and back. |
| SJ-O3 | 45 min | Finish 1F with 2/3 and 6. Add t1, reuse t2/t3, and sign the Romancecar and alighting faces. Walk from West Ground to each face and back. |
| SJ-O4 | 50 min | West Underground threshold, paid B1F concourse and the 8/9 island with t4/t5. Connect the paid concourses by a representative stair. Walk from West Underground to 8/9 and from West Ground via the paid stairs, then reverse both paths. |
| SJ-O5 | 40 min | Add 7/10 outside the B1F tracks and the Central Underground JR transfer threshold. Walk from West Underground to both alighting faces and back. Verify the JR-side landing admits a paid transfer when the JR approach is integrated. |
| SJ-O6 | 50 min | South public gate and South JR transfer threshold on 2F. Build representative paid stairs, escalator and lift legs from the South concourse to the platform levels. Walk from South through the gate to each floor and back. Exercise the JR approach once the JR lane supplies its paid tie. |

Use the Oedo B7 `buildPlatformEdge`, fare-fence and identity behavior as references. Apply sourced platform doors to 4, 5, 8 and 9. Keep rail beds outside the walk surfaces. Treat terminal rail barriers, face widths and every connector landing as preview geometry. The paid-side navigation graph should follow the actual built walks and landings. Stairs connect the paid hubs in both directions. Give the preview escalator its own direction, and keep the lift route separate from claims about real-world step-free access to individual faces.

The Shinjuku integration lane owns the existing public concourse approaches, preview wiring, any POI or graph mutation and the E27 acceptance goldens. A JR transfer stays a paid-to-paid boundary with a separate JR landing. Public approaches enter only from the three public gates. Confirm each approach reaches its named gate, crosses the fare boundary once and reaches its intended face without crossing a track. Use the corresponding public gate on the return route. The preview uses `?next=1` with near-approach loading. Check flag-off golden-camera parity and baseline routes against Oedo B7. Measure each slice on phone within 30 draws per visible floor, 60,000 added triangles per slice and the 1,500 ms initial-load budget.

The station integration lane can replace representative values when it has current opening and landing evidence. Field checks should record the gate opening ties, each vertical device's served floors and direction, the JR-side approaches and the walking side of the alighting faces. S03 data credit and the change notice travel with the source record in `odakyu.json`.
