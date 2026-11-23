# Interior kit items 1–7 — #1534

2026-11-23 JST. Runtime `fa6b37cd86eb01ccffa6cf00747746d5202382e0`; capture started 2026-11-23T11:29:38.215Z (UTC). Later commits add evidence only. All changes remain behind `?station=ikebukuro&next=1`. Journey row: none (preview only). Art-director judgment is required; PR #1539 remains draft.

## Per-item result

| Item | Result | Evidence, before on left / after on right |
| --- | --- | --- |
| 1. Light and value | fixed | [Desktop aisle](compare-desktop-food-hall-aisle.jpg), [phone aisle](compare-phone-food-hall-aisle.jpg), [counter](compare-desktop-counter.jpg), [1F](compare-desktop-wide-1F.jpg). Separate floor/counter/wall/ceiling values, warm showcase strips, visible baked floor pools, no scene lights. |
| 2. Ceiling | fixed | [Desktop arrival](compare-desktop-arrival-1F.jpg), [phone arrival](compare-phone-arrival-1F.jpg). Shallow bays, aisle cove and hanging floor sign. |
| 3. Escalator and well | fixed | [Desktop boarding](compare-desktop-escalator-boarding.jpg), [phone boarding](compare-phone-escalator-boarding.jpg), [1F well](desktop-well-from-1F.png). Dark treads, yellow edges, black handrails, glass/steel sides, warm soffit/truss finish, directories at both landings. |
| 4. Small dark pieces | partly | [Desktop far end](compare-desktop-far-end-B1.jpg), [phone far end](compare-phone-far-end-B1.jpg), [entrance slits](compare-desktop-entrance-inside.jpg). Escalator truss/rail intersections at the B1 ceiling and the far wall/counter ends have fog-free finishes. Desktop boxes contain no pixels with max channel ≤16; phone box retains 10 dark pixels on the escalator. |
| 5. Arrival camera | fixed | [Desktop arrival](desktop-arrival-1F.png), [phone arrival](phone-arrival-1F.png). Camera above 32.200001 m floor: desktop +0.056712 m, phone +0.193992 m. Upper well cover affects camera rays only. |
| 6. Street door / one header | partly | [Desktop inside](compare-desktop-street-door-inside.jpg), [phone inside](compare-phone-street-door-inside.jpg), [desktop outside](compare-desktop-street-door-outside.jpg), [B1 header](compare-desktop-entrance-before.jpg). One bronze lintel/reveal design; opaque backdrop removed; entrance apron cut derives from the generated entrance. Phone shows street context, but desktop inside remains black. |
| 7. Whole-body people | fixed | [1F well](desktop-well-from-1F.png), [phone well](phone-well-from-1F.png). Eight whole-body station-kit people per floor on narrow counter-side paths, at least 7.6 m from the main aisle axis; entrance cross-aisles remain clear. Figures are small/partly occluded at these original poses. |

“Fixed” describes the implementation and captured behavior, not AD acceptance. Items 4 and 6 remain open before the default flip. Item 8 belongs to the art director and was not measured here.

## Value measurements

Mean linear-sRGB luminance Y, 0–1; actual rendered PNG samples. Same boxes before and after; exact boxes and counts are in [receipt.json](receipt.json). [Counter sample boxes](values-counter.jpg), [wall sample box](values-street-door-inside.jpg). These are surface samples across the specified poses, not a uniform lighting calibration.

| Surface | Before | After |
| --- | ---: | ---: |
| floor | 0.2147 | 0.0736 |
| counter | 0.2438 | 0.0346 |
| back wall | 0.3251 | 0.2540 |
| ceiling | 0.3309 | 0.3564 |
| showcase strip | 0.2794 | 0.4800 |

The new floor → counter step is 0.0390 Y; floor → wall 0.1804 Y; wall → ceiling 0.1024 Y. Showcase strip rises to 0.4800 Y. Board/wayfinding projected-face average luminance ratio: desktop **0.4811**, phone **0.5637**, both below **0.85**. Ratios include the face text, using the committed driver's polygons.

## Item 4 pixel boxes

Coordinates are original full-resolution PNG pixels; boxes use [left, top, right, bottom), matching Pillow. Dark means max(R,G,B) ≤16. The issue's 79-pixel observation used an unspecified near-black threshold; these counts use the explicit threshold above. Some old pixels now show the added ceiling structure/directory, so counts alone do not prove every original surface was lit.

| Frame | Box | Dark pixels before → after | Mean Y before → after |
| --- | --- | ---: | ---: |
| desktop-far-end-B1 | [654, 683, 748, 713] | 31 → 0 | 0.4104 → 0.2666 |
| phone-far-end-B1 | [187, 565, 217, 603] | 0 → 10 | 0.0786 → 0.1115 |
| desktop-entrance-inside | [706, 732, 747, 739] | 6 → 0 | 0.3950 → 0.3256 |

The driver records center-ray mesh/position/normal hits in the receipt. The phone far-end box hits `retail-escalators-B1`; the entrance slits hit the B1 far shell. The desktop far-end box now intersects a new ceiling bay before the original well. The remaining phone dark area needs AD assessment with the requested black handrails retained.

## Replay and checks

`nice -n 15 node /tmp/depato-1534-capture.mjs` starts the owned Vite server, runs `nice -n 15 ego-browser nodejs < docs/visual/evidence/2026-11-23-depato-interior/walk.mjs`, and closes Vite. Final replay exit **0**; both twelve-leg walks, supplementary B1 walks, both search queries and both JR South Gate → store graph routes pass. All 26 frames have zero shader errors. The browser space was closed. No local test suites ran.

Vite reports the existing missing `stations/ikebukuro/navmesh-paths.json` dynamic import. The collision walk completed; this is not a baked-navmesh guide certification.

2026-11-23 20:25 JST: CI round 2 on `037eee9f`: `rtk gh pr checks cx/depato-interior-1534 --watch --interval 30` → **16 passed, 0 failed**, exit 0. Final candidate CI is round 3 and is being checked via `job-run`.

## All 26 poses

| Pose | Desktop | Phone |
| --- | --- | --- |
| entrance-before | [frame](desktop-entrance-before.png) | [frame](phone-entrance-before.png) |
| entrance-context | [frame](desktop-entrance-context.png) | [frame](phone-entrance-context.png) |
| entrance-inside | [frame](desktop-entrance-inside.png) | [frame](phone-entrance-inside.png) |
| food-hall-aisle | [frame](desktop-food-hall-aisle.png) | [frame](phone-food-hall-aisle.png) |
| counter | [frame](desktop-counter.png) | [frame](phone-counter.png) |
| escalator-boarding | [frame](desktop-escalator-boarding.png) | [frame](phone-escalator-boarding.png) |
| arrival-1F | [frame](desktop-arrival-1F.png) | [frame](phone-arrival-1F.png) |
| wide-1F | [frame](desktop-wide-1F.png) | [frame](phone-wide-1F.png) |
| street-door-inside | [frame](desktop-street-door-inside.png) | [frame](phone-street-door-inside.png) |
| street-door-outside | [frame](desktop-street-door-outside.png) | [frame](phone-street-door-outside.png) |
| far-end-B1 | [frame](desktop-far-end-B1.png) | [frame](phone-far-end-B1.png) |
| well-from-1F | [frame](desktop-well-from-1F.png) | [frame](phone-well-from-1F.png) |
| flag-off | [frame](desktop-flag-off.png) | [frame](phone-flag-off.png) |

The unchanged [before frames](../fixed/) are at bef84dc1. Full-resolution PNGs are untouched; comparison JPEGs are resized for side-by-side reading. Credits/license are the same as [the pilot receipt](../README.md).

## Assumptions

Use baked materials and merged ceiling/showcase detail without additional lights or postprocessing passes. Reuse the low-count station people batch. The diff exceeds 300 lines because the requested evidence contains 26 frame receipts, measurements and comparison links.

## Blocked

The desktop street opening remains black while phone shows the context. Reading the live camera and then the host fog state did not resolve it, so that path stopped after two corrections. The lead must route the remaining desktop street-context failure before item 6 can pass.
