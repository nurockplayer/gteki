# Ikebukuro Tobu Tojo Line scene plan

2026-11-26 JST · [Lane data](tobu.json) · Public non-commercial preview

Each run owns the Tobu files under `stations/ikebukuro/{data,scene}/rail/`. The Ikebukuro integration lane owns the loader, shared station scene and graph hookups, and any changes to existing ceilings or fences. The steps below use independently drawn preview geometry in the station's east/north/up frame. Platform dimensions and heights are representative. A width in the data covers one numbered boarding face. Join 1/2 and 3/4 into two decks and keep 5 as a side deck. Use three stub tracks, with 2/3 and 4/5 facing the same track. All five faces are on 1F.

| Run | Platforms | Work and acceptance | Budget |
| --- | --- | --- | --- |
| IK-T2 | 1, 2 | Start at the existing Central Gate 2 public approach on `c_w__c_mid`. Fit a representative opening at the public seam with the integration owner, add a fare crossing, B1 paid landing, stairs and the 1/2 deck. Walk from the concourse to each face and back on desktop and phone. Check for gate and track bypasses. | 50 min |
| IK-T3 | 3, 4 | Extend the paid B1 stairs to the 3/4 deck and add the 1F terminal head and South Gate's level approach. Exercise South Gate to 1–4 and Central Gate 2 to 3–4 in both directions. Verify 2 and 3 share a track across the two decks. | 50 min |
| IK-T4 | 5 | Add the side deck on track 4/5, ordinary alighting circulation and the B1 and 1F TJ Liner checkpoints. Walk to the paid platform and verify that each depicted boarding approach passes a seat check. Keep train operations and timetable logic outside the slice. | 50 min |
| IK-T5 | 1–5 | Add Central Gate 1 and North Gate, and the lifts from the Central Gate 1 paid area to the three decks. Walk from each public gate to each face and back. Verify the lift endpoints and preserve the distinction between a paid connector and a step-free street route. | 50 min |

The JR transfer gate is a paid-to-paid crossing. Its Tobu-side adjacency can be represented from the lane data. Keep the existing fence in place until a field receipt or independent source identifies the opening and JR paid landing. Route the crossing in its own integration run of up to 50 minutes once those controls are known. Use field item [#533](https://github.com/nurockplayer/gteki/issues/533) for the physical gate and escalator evidence.

For each run, put scene and route contributions behind `?next=1` and load them lazily near the relevant gate approach or floor. Reuse the floor and platform-edge treatment with sparse instanced details. Check the live phone frame on both sides of transitions for ≤30 added draws per visible floor and ≤60,000 added triangles per slice. Measure the cold Ikebukuro phone load against the 1,500 ms e2e budget. Check reverse routes, correct signs, physical fare crossings, unchanged flag-off routes, and zero changed golden cameras with the integration and acceptance owners.
