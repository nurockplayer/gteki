# Station identity boards (#342 Q1b/Q3)

Local CPU implementation receipt, 2026-10-24. No web, browser, GPU or external LLM review in this follow-up.

## Recognition proxy

The previous receipt used unused station-scene heading suggestions and a first-person eye; its all-spawn framing/readability conclusion is withdrawn. The proxy now replays the real third-person camera against the shipped scene collision world, with no board movement, rotation, name resizing or camera recentering.

### Actual spawn rule

- `station.json.spawnNodeIds` supplies six origin chips in order: c_mid, c_e2, n_h, sp_e, w_c, sw_h. Selecting a chip changes the route origin; it does not place the camera. `walkFromNode` (including the test hook and station-transfer arrival) calls `walkFrom` without a heading, so every node starts at compass 0°, yaw 0 radians. The route Walk button also omits a heading. Guide mode instead uses the first route tangent and has no single heading per spawn.
- `scene.ts` supplies `spawnPoints` with suggested headings 100°, 100°, 95°, 92°, 340°, 110° respectively. Explorer does not read `spawnPoints`. `build_identity.py` uses these authored directions for placement checks only; they are not opening-view evidence. No generation or placement change was made in this follow-up.
- Spec 13 first spawns facing north, then explicitly turns to its +0: the rounded compass bearing along the first verified incident edge in graph order (otherwise the first edge), orienting geometry from the node and choosing the first vertex at least 2 m away, otherwise the last. Its +90/+180/+270 are further turns. A separate +0 table below matches that setup; it is not the default spawn heading.
- Sources: [Explorer spawn and camera](../../../apps/web/src/explorer/explorer.ts), [follow camera constants](../../../apps/web/src/explorer/followCamera.ts), [UI origin and Walk actions](../../../apps/web/src/ui/app.ts), [spec 13](../../../tests/e2e/specs/13-ikebukuro-vantage-shots.spec.ts), [station suggestions](../scene/scene.ts), [CPU replay](../pipeline/identity_camera.ts).

Fresh defaults: third person, pitch -0.12 rad (-6.875°); head = ray-snapped floor +1.62 m. The pivot moves 0.42 m right (side collision reduces this to max(0, hit distance -0.25)). With view direction d, back = normalize(-d + [0,0.14,0]), desired camera = pivot + back × 3.45 m, and look-at = pivot + d × 5 m - [0,0.45,0]. Boom collision uses the actual floor/collider ray targets, 0.30 m clearance, minimum 0.55 m; a squeeze below 1.60 m tries up to five raises in 10° steps. The vertical FOV is 50°, or 60° when squeezed below 1.60 m/on a slope (release hysteresis 1.90 m). The B1 scene has ordinary ceiling colliders; its street context camera-only blockers are inactive underground. Signs and column dressing do not stop the boom. Stationary fresh-spawn/settled poses are measured here; transition smoothing is 10/s and FOV easing has a 0.25 s time constant. Entering from overview can transiently inherit its camera/FOV, and later spawns retain user pitch, zoom and first-person selection.

Aspect = Explorer host clientWidth/clientHeight: phone 390/844 = 0.462085, desktop 1280/720 = 1.777778. Near/far = 0.05/2000 m. There is no phone-specific lens change. Phone PASS requires all eight name-box corners inside all six frustum planes, the name face toward the camera, no overlap with the approximate avatar rectangle (x = 130–260, y = 562.67–844 CSS px: central lower third), JP ≥18 and EN ≥12 CSS px. Cap height remains a conservative 0.7 em estimate, projected at each line's left anchor. Each row evaluates that spawn's assigned identity board; another distant visible board is not substituted. Offscreen/back-facing sizes are mathematical projections, not visible glyphs; caps are unavailable when the name box crosses the camera depth bounds. Distance is camera to board centre, in 3D. PASS covers these framing/size criteria only, not structural visibility, camera-cut fading, font ink or perceived readability.

| View | Spawn | Heading ° | Yaw rad | Ground TP m | Camera ENU [x,y,z] | Height above ground m | Shoulder m | Boom m | Raise ° | Look pitch ° | FOV ° |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| opening | c_mid | 0 | 0.0000 | 27.910 | [-24.580, 66.662, 30.403] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| opening | c_e2 | 0 | 0.0000 | 28.490 | [60.420, 30.662, 30.983] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| opening | n_h | 0 | 0.0000 | 28.450 | [66.420, 111.636, 30.696] | 2.246 | 0.420 | 1.501 | 10.0 | -14.824 | 60 |
| opening | sp_e | 0 | 0.0000 | 27.580 | [10.420, -66.338, 30.073] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| opening | w_c | 0 | 0.0000 | 27.910 | [-106.580, 118.662, 30.403] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| opening | sw_h | 0 | 0.0000 | 27.580 | [-114.580, -33.338, 30.073] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | c_mid | 295 | -5.1487 | 27.910 | [-21.798, 68.970, 30.403] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | c_e2 | 293 | -5.1138 | 28.490 | [63.236, 33.082, 30.983] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | n_h | 203 | -3.5430 | 28.450 | [66.918, 116.236, 30.943] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | sp_e | 291 | -5.0789 | 27.580 | [13.267, -63.804, 30.073] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | w_c | 144 | -2.5133 | 27.910 | [-109.302, 124.453, 30.403] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |
| spec13+0 | sw_h | 115 | -2.0071 | 27.580 | [-118.202, -28.970, 30.073] | 2.493 | 0.420 | 3.450 | 0.0 | -13.033 | 50 |

### Actual opening view (north)

| Spawn | Heading ° | First edge | Board | Distance m | JP px | EN px | Fully in frame | Avatar overlap | Result / reason |
| --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| c_mid | 0 | c_w__c_mid | identity-c_mid | 3.64 | 22.8 | 17.6 | no | no | FAIL: not in frame |
| c_e2 | 0 | c_n__c_e2 | identity-c_e2 | 3.70 | 27.4 | 21.5 | no | no | FAIL: not in frame |
| n_h | 0 | c_n__n_h | identity-n_h | 1.54 | 18.4 | 14.0 | no | no | FAIL: not in frame, back face |
| sp_e | 0 | sp_j__sp_e | identity-sp_e | 4.04 | 24.4 | 19.0 | no | no | FAIL: not in frame |
| w_c | 0 | c_w__w_c | identity-w_c | 6.52 | 26.8 | 18.5 | no | no | FAIL: cut by screen edge |
| sw_h | 0 | sp_m__sw_h | identity-sw_h | 3.25 | 40.3 | 32.9 | no | no | FAIL: not in frame |

### Spec 13 first-edge +0 view

| Spawn | Heading ° | First edge | Board | Distance m | JP px | EN px | Fully in frame | Avatar overlap | Result / reason |
| --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| c_mid | 295 | c_w__c_mid | identity-c_mid | 1.13 | 62.6 | 47.0 | no | no | FAIL: cut by screen edge, back face |
| c_e2 | 293 | c_n__c_e2 | identity-c_e2 | 0.18 | 266.0 | 231.3 | no | yes | FAIL: cut by screen edge, avatar silhouette overlap, back face |
| n_h | 203 | c_n__n_h | identity-n_h | 3.38 | 12.6 | 8.6 | no | no | FAIL: not in frame, JP <18 px, EN <12 px |
| sp_e | 291 | sp_j__sp_e | identity-sp_e | 0.43 | 246.9 | 215.4 | no | no | FAIL: cut by screen edge, back face |
| w_c | 144 | c_w__w_c | identity-w_c | 1.33 | — | — | no | no | FAIL: behind camera or outside depth range |
| sw_h | 115 | sp_m__sw_h | identity-sw_h | 6.17 | 19.5 | 13.9 | yes | no | PASS |

All failed actual opening views above remain for Explorer #342 Q5 to resolve by spawn-direction decisions. The boards retain their committed geometry and station-name text sizes. The lead reports that only w_c at spec-13 +270 has a large readable board, with c_mid cut at +0 and transfer rows unreadable on phone; those GPU observations are supplied evidence, not rerun here. Open comparison: the assigned identity-sw_h at spec-13 +0 (115°) narrowly passes the CPU size/framing criteria at 19.5/13.9 px, whereas the supplied GPU observation calls it small/far. Reconcile the exact board ID, camera receipt and perceived ink in the lead's authorised visual run; this proxy does not override that observation.

### Desktop projection (1280×720)

| View | Spawn | JP px | EN px | Fully in frame | Avatar overlap |
| --- | --- | ---: | ---: | --- | --- |
| opening | c_mid | 19.5 | 15.0 | yes | no |
| opening | c_e2 | 23.4 | 18.3 | no | no |
| opening | n_h | 15.7 | 12.0 | yes | no |
| opening | sp_e | 20.8 | 16.2 | no | no |
| opening | w_c | 22.9 | 15.8 | yes | no |
| opening | sw_h | 34.4 | 28.0 | no | no |
| spec13+0 | c_mid | 53.4 | 40.1 | yes | no |
| spec13+0 | c_e2 | 227.0 | 197.3 | no | yes |
| spec13+0 | n_h | 10.7 | 7.3 | yes | no |
| spec13+0 | sp_e | 210.6 | 183.8 | no | no |
| spec13+0 | w_c | — | — | no | no |
| spec13+0 | sw_h | 16.7 | 11.8 | yes | no |

## Separate equipment placement-eye proxy

These equipment counts retain the original authored heading / first-person-eye calculation. They are not the real opening camera and do not contribute to recognition PASS.

| Spawn | Other equipment centres visible | Equipment result |
| --- | ---: | --- |
| c_mid | 10 | proxy met (equipment) |
| c_e2 | 1 | proxy not met (equipment) |
| n_h | 0 | proxy not met (equipment) |
| sp_e | 2 | proxy met (equipment) |
| w_c | 6 | proxy met (equipment) |
| sw_h | 7 | proxy met (equipment) |

Equipment counts exclude the identity boards themselves. This conservative report counts only existing scene LED housings and wayfinding panels using frustum and structural/panel ray occlusion; it does not enumerate every gate, stair mouth, kit piece or column. Round 2 removes all three authored utility fittings and their atlas swatch (42 fewer triangles, unchanged batches). No props are added to meet the equipment proxy. Counts below two are explicitly proxy not met (equipment); only c_mid, w_c and sw_h retain a >=2 regression assertion. Centre visibility remains a CPU proxy, not a perceived-size or lighting judgment.

| Spawn | Existing visible equipment centres |
| --- | --- |
| c_mid | sign-c_g2-c_mid__c_g2-r, sign-c_g2-c_g2__c_c, led:14738, led:14918, led:14930, led:15110, led:15290, led:15470, led:15662, led:15842 |
| c_e2 | led:26810 |
| n_h | None |
| sp_e | sign-s38_w-s38_w__s38_j, led:26618 |
| w_c | led:2282, led:2294, led:2582, led:2594, led:2606, led:2858 |
| sw_h | led:8078, led:8090, led:8318, led:8594, led:9014, led:9506, led:9518 |

## Boards

| ID | Anchor | Kind | Mount | Verification of text facts |
| --- | --- | --- | --- | --- |
| identity-c_mid | c_mid | station-name | ceiling | VERIFIED |
| identity-c_e2 | c_e2 | station-name | ceiling | VERIFIED |
| identity-n_h | n_h | station-name | wall | VERIFIED |
| identity-sp_e | sp_e | station-name | ceiling | VERIFIED |
| identity-w_c | w_c | station-name | ceiling | VERIFIED |
| identity-sw_h | sw_h | station-name | ceiling | VERIFIED |
| identity-c_e1 | c_e1 | station-name | ceiling | VERIFIED |
| identity-c_n | c_n | station-name | ceiling | VERIFIED |
| identity-sp_m | sp_m | station-name | ceiling | VERIFIED |
| meeting-ikefukuro | n_c__n_e | meeting-point | ceiling | APPROXIMATE |

Six station-name boards are anchored to the spawn nodes; this does not imply they are visible on opening. Additional main-passage junctions are c_e1, c_n and sp_m, each with verified degree ≥3. Positions remain in identity.json so approximate meeting-point text, identity metadata and transfer information stay separate from generated directional routing signs. All panel positions are GTEki-authored, not surveyed sign locations. Ceiling-mounted housings retain at least 2 m clearance; the near North Passage wall uses a wall panel. Existing sign text and route data are unchanged.

## Atlas and asset delta

CPU canvas width estimates use the existing CJK/Latin estimator. Memory is RGBA8 plus a full mip chain (4/3), in MiB; browser glyph widths may differ.

| Tier | Round-0 shared pages = final shared pages | Separate identity texture | Round-0 MiB | Final shared MiB | Identity MiB | Final total MiB | Delta MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| low | 4096×2048 + 4096×512 | 968×279 | 53.33 | 53.33 | 1.374 | 54.707 | 1.374 |
| high | 4096×4096 + 4096×4096 | 1920×658 | 170.67 | 170.67 | 6.426 | 177.092 | 6.426 |

Round 3 replaced the Round 2 low-tier 53.33 → 64.00 MiB (+10.67 MiB) allocation. Direction/place faces retain exactly the round-0 page sizes. All ten identity boards share one tightly cropped, non-power-of-two canvas with mipmaps (WebGL2), one material and one merged face batch. The canvas contains three shelf-packed artworks: compact station name at 160 px/m low, wide station name at 280 px/m low, and meeting point at 140 px/m low; desktop doubles each density. Identical content reuses the same UV rectangle.

Low tier now omits both transfer rows and crops the unused lower band of each station-name artwork to 72% height, expanded if actual name ink plus one texel needs more. The crop keeps the original texel density and offsets the face upward by half the removed physical height, so every name keeps its size and position. High tier retains both transfer rows and its full artwork; the meeting marker is unchanged. CPU dimensions use fallback em boxes; browser ink can expand the low crop and its texture allocation.

Each artwork is painted in physical coordinates at 3.4×0.54 m, then uniformly fitted inside each board width and height; solid margins fill the remaining panel area with quads in the same batch. Compact main names retain scale 1.12 and the upward shift; wide names retain 0.8. Low crop changes only the artwork quad extent/offset, not any board housing or metadata name-region coordinates. There is no horizontal fillText compression.

Panels: 119 existing → 129 total. Identity proxies: 10, with no mesh, draw call, walkable or collider. Rendering now has one housing batch, one face batch per shared page, and one identity face batch: four draw calls on either tier, one more than round 0 / Round 2. Solid margins add 20 triangles versus Round 2. The new texture, material and geometry are disposed with the rest of the signs; regression tests observe disposal. The shared phone pages are exactly 4096×2048 + 4096×512. Shipped asset count remains 19; declared scene data files remain 8.

## High-tier transfer-row cap height

Transfer facts remain unchanged in identity.json. Only high tier paints JR / Metro rows, using 0.13 em of the original artwork height and uniform width fitting. Values below are conservative 0.7 em cap estimates, not measured ink. No phone transfer readability claim is made; low tier paints neither row.

| Board | JR cap cm | Metro cap cm |
| --- | ---: | ---: |
| identity-c_mid | 1.73 | 1.73 |
| identity-c_e2 | 1.73 | 1.73 |
| identity-n_h | 0.87 | 0.87 |
| identity-sp_e | 1.73 | 1.73 |
| identity-w_c | 4.91 | 4.91 |
| identity-sw_h | 2.60 | 2.60 |
| identity-c_e1 | 1.46 | 1.46 |
| identity-c_n | 1.73 | 1.73 |
| identity-sp_m | 4.66 | 4.67 |

## Name-region boxes

Local metres, front normal +Z; z bounds are 0.039–0.043 m around the face at 0.042 m. Runtime boxes come from actual canvas text ink metrics (em-box fallback on the CPU stub), transformed by exactly the same uniform scale as the artwork. The union encloses Japanese, kana and English and excludes transfer rows. Tests compare geometry aspect and painted bounds at both tiers. The following CPU boxes use the deterministic CJK/Latin estimator; browser font ink may differ.

| Board | Min [x,y,z] | Max [x,y,z] |
| --- | --- | --- |
| identity-c_mid | [-0.3505, -0.0391, 0.0390] | [0.3505, 0.0900, 0.0430] |
| identity-c_e2 | [-0.3505, -0.0391, 0.0390] | [0.3505, 0.0900, 0.0430] |
| identity-n_h | [-0.1753, -0.0196, 0.0390] | [0.1753, 0.0450, 0.0430] |
| identity-sp_e | [-0.3505, -0.0391, 0.0390] | [0.3505, 0.0900, 0.0430] |
| identity-w_c | [-0.7094, -0.0907, 0.0390] | [0.7094, 0.1706, 0.0430] |
| identity-sw_h | [-0.5258, -0.0587, 0.0390] | [0.5258, 0.1351, 0.0430] |
| identity-c_e1 | [-0.2950, -0.0329, 0.0390] | [0.2950, 0.0758, 0.0430] |
| identity-c_n | [-0.3505, -0.0391, 0.0390] | [0.3505, 0.0900, 0.0430] |
| identity-sp_m | [-0.6739, -0.0862, 0.0390] | [0.6739, 0.1621, 0.0430] |
| meeting-ikefukuro | [-1.5640, 0.0837, 0.0390] | [0.7048, 0.2187, 0.0430] |

## Guided-route rhythm proxy

The checker walks the committed I1/I2 guided polylines using 3D segment lengths. Cues are readable-facing sign anchors within 4 m laterally, verified junctions of degree ≥3, gates/exits and stair/escalator mouths; start/end bound the route. This measures cue-anchor gaps, not continuous visual recognition or non-interchangeable 3-second frames. Existing signs already meet 30 m, so no new passage-name board is needed.

| Route | Before maximum gap m | After maximum gap m |
| --- | ---: | ---: |
| westb1-exit4 | 13.93 | 13.93 |
| jrc2-exit35 | 26.69 | 26.69 |

### westb1-exit4, before (186.71 m polyline)

| Interval m | Gap m | From cue → To cue |
| --- | ---: | --- |
| 0.00–4.00 | 4.00 | node:w_c, start → sign-w_c-w_c__w_cj |
| 4.00–13.27 | 9.27 | sign-w_c-w_c__w_cj → sign-w_cj-w_c__w_cj-r |
| 13.27–20.27 | 7.00 | sign-w_cj-w_c__w_cj-r → node:w_cj |
| 20.27–24.27 | 4.00 | node:w_cj → sign-w_cj-sw_h__w_cj-r |
| 24.27–36.20 | 11.93 | sign-w_cj-sw_h__w_cj-r → sign-place-sw_h__w_cj-6 |
| 36.20–48.13 | 11.93 | sign-place-sw_h__w_cj-6 → sign-rep-sw_h__w_cj-5 |
| 48.13–62.06 | 13.93 | sign-rep-sw_h__w_cj-5 → sign-place-sw_h__w_cj-5 |
| 62.06–71.98 | 9.93 | sign-place-sw_h__w_cj-5 → sign-rep-sw_h__w_cj-4 |
| 71.98–83.91 | 11.93 | sign-rep-sw_h__w_cj-4 → sign-place-sw_h__w_cj-4 |
| 83.91–95.84 | 11.93 | sign-place-sw_h__w_cj-4 → sign-rep-sw_h__w_cj-3 |
| 95.84–107.77 | 11.93 | sign-rep-sw_h__w_cj-3 → sign-place-sw_h__w_cj-3 |
| 107.77–119.70 | 11.93 | sign-place-sw_h__w_cj-3 → sign-rep-sw_h__w_cj-2 |
| 119.70–131.63 | 11.93 | sign-rep-sw_h__w_cj-2 → sign-place-sw_h__w_cj-2 |
| 131.63–143.57 | 11.93 | sign-place-sw_h__w_cj-2 → sign-rep-sw_h__w_cj-1 |
| 143.57–155.49 | 11.93 | sign-rep-sw_h__w_cj-1 → sign-place-sw_h__w_cj-1 |
| 155.49–167.42 | 11.93 | sign-place-sw_h__w_cj-1 → sign-sw_h-sw_h__w_cj |
| 167.42–172.42 | 5.00 | sign-sw_h-sw_h__w_cj → node:sw_h |
| 172.42–176.42 | 4.00 | node:sw_h → sign-sw_h-sw_h__x4f |
| 176.42–186.71 | 10.29 | sign-sw_h-sw_h__x4f → end, node:x4f |

### jrc2-exit35, before (199.14 m polyline)

| Interval m | Gap m | From cue → To cue |
| --- | ---: | --- |
| 0.00–4.85 | 4.85 | node:g_jr_c2, start → sign-c_g2-g_jr_c2__c_g2-r |
| 4.85–7.00 | 2.15 | sign-c_g2-g_jr_c2__c_g2-r → node:c_g2 |
| 7.00–11.00 | 4.00 | node:c_g2 → sign-c_g2-c_g2__c_c |
| 11.00–23.26 | 12.26 | sign-c_g2-c_g2__c_c → sign-c_c-c_g2__c_c-r |
| 23.26–30.76 | 7.50 | sign-c_c-c_g2__c_c-r → sign-c_c-c_c__c_e1 |
| 30.76–57.45 | 26.69 | sign-c_c-c_c__c_e1 → sign-c_e1-c_c__c_e1-r |
| 57.45–61.45 | 4.00 | sign-c_e1-c_c__c_e1-r → node:c_e1 |
| 61.45–65.45 | 4.00 | node:c_e1 → sign-c_e1-c_e1__c_n |
| 65.45–75.29 | 9.84 | sign-c_e1-c_e1__c_n → sign-c_n-c_e1__c_n-r |
| 75.29–79.29 | 4.00 | sign-c_n-c_e1__c_n-r → node:c_n |
| 79.29–83.29 | 4.00 | node:c_n → sign-c_n-c_n__c_e2 |
| 83.29–91.74 | 8.44 | sign-c_n-c_n__c_e2 → sign-c_e2-c_n__c_e2-r |
| 91.74–95.74 | 4.00 | sign-c_e2-c_n__c_e2-r → node:c_e2, sign-c_e2-c_e2__x36f |
| 95.74–99.74 | 4.00 | node:c_e2, sign-c_e2-c_e2__x36f → sign-c_e2-c_e2__e_27j |
| 99.74–106.61 | 6.88 | sign-c_e2-c_e2__e_27j → sign-e_27j-c_e2__e_27j-r |
| 106.61–115.62 | 9.00 | sign-e_27j-c_e2__e_27j-r → node:e_27j |
| 115.62–118.12 | 2.50 | node:e_27j → sign-e_27j-e_27j__e_hall |
| 118.12–126.74 | 8.62 | sign-e_27j-e_27j__e_hall → sign-e_hall-e_27j__e_hall-r |
| 126.74–129.74 | 3.00 | sign-e_hall-e_27j__e_hall-r → node:e_hall |
| 129.74–134.74 | 5.00 | node:e_hall → sign-e_hall-e_hall__e_hall_stair_top |
| 134.74–145.04 | 10.30 | sign-e_hall-e_hall__e_hall_stair_top → sign-e_hall_stair_top-e_hall__e_hall_stair_top-r |
| 145.04–153.04 | 8.00 | sign-e_hall_stair_top-e_hall__e_hall_stair_top-r → node:e_hall_stair_top |
| 153.04–154.49 | 1.45 | node:e_hall_stair_top → sign-e_hall_stair_top-e_hall_stair_top__e_hall_stair_foot |
| 154.49–155.06 | 0.57 | sign-e_hall_stair_top-e_hall_stair_top__e_hall_stair_foot → sign-e_hall_stair_foot-e_hall_stair_top__e_hall_stair_foot-r |
| 155.06–156.52 | 1.46 | sign-e_hall_stair_foot-e_hall_stair_top__e_hall_stair_foot-r → node:e_hall_stair_foot |
| 156.52–161.52 | 5.00 | node:e_hall_stair_foot → sign-e_hall_stair_foot-e_hall_stair_foot__e_low |
| 161.52–163.13 | 1.61 | sign-e_hall_stair_foot-e_hall_stair_foot__e_low → sign-e_low-e_hall_stair_foot__e_low-r |
| 163.13–167.13 | 4.00 | sign-e_low-e_hall_stair_foot__e_low-r → node:e_low |
| 167.13–173.13 | 6.00 | node:e_low → sign-e_low-e_low__x35 |
| 173.13–199.14 | 26.01 | sign-e_low-e_low__x35 → end, node:x35 |

### westb1-exit4, after (186.71 m polyline)

| Interval m | Gap m | From cue → To cue |
| --- | ---: | --- |
| 0.00–4.00 | 4.00 | node:w_c, start → sign-w_c-w_c__w_cj |
| 4.00–13.27 | 9.27 | sign-w_c-w_c__w_cj → sign-w_cj-w_c__w_cj-r |
| 13.27–20.27 | 7.00 | sign-w_cj-w_c__w_cj-r → node:w_cj |
| 20.27–24.27 | 4.00 | node:w_cj → sign-w_cj-sw_h__w_cj-r |
| 24.27–36.20 | 11.93 | sign-w_cj-sw_h__w_cj-r → sign-place-sw_h__w_cj-6 |
| 36.20–48.13 | 11.93 | sign-place-sw_h__w_cj-6 → sign-rep-sw_h__w_cj-5 |
| 48.13–62.06 | 13.93 | sign-rep-sw_h__w_cj-5 → sign-place-sw_h__w_cj-5 |
| 62.06–71.98 | 9.93 | sign-place-sw_h__w_cj-5 → sign-rep-sw_h__w_cj-4 |
| 71.98–83.91 | 11.93 | sign-rep-sw_h__w_cj-4 → sign-place-sw_h__w_cj-4 |
| 83.91–95.84 | 11.93 | sign-place-sw_h__w_cj-4 → sign-rep-sw_h__w_cj-3 |
| 95.84–107.77 | 11.93 | sign-rep-sw_h__w_cj-3 → sign-place-sw_h__w_cj-3 |
| 107.77–119.70 | 11.93 | sign-place-sw_h__w_cj-3 → sign-rep-sw_h__w_cj-2 |
| 119.70–131.63 | 11.93 | sign-rep-sw_h__w_cj-2 → sign-place-sw_h__w_cj-2 |
| 131.63–143.57 | 11.93 | sign-place-sw_h__w_cj-2 → sign-rep-sw_h__w_cj-1 |
| 143.57–155.49 | 11.93 | sign-rep-sw_h__w_cj-1 → sign-place-sw_h__w_cj-1 |
| 155.49–167.42 | 11.93 | sign-place-sw_h__w_cj-1 → sign-sw_h-sw_h__w_cj |
| 167.42–172.42 | 5.00 | sign-sw_h-sw_h__w_cj → node:sw_h |
| 172.42–176.42 | 4.00 | node:sw_h → sign-sw_h-sw_h__x4f |
| 176.42–186.71 | 10.29 | sign-sw_h-sw_h__x4f → end, node:x4f |

### jrc2-exit35, after (199.14 m polyline)

| Interval m | Gap m | From cue → To cue |
| --- | ---: | --- |
| 0.00–4.85 | 4.85 | node:g_jr_c2, start → sign-c_g2-g_jr_c2__c_g2-r |
| 4.85–7.00 | 2.15 | sign-c_g2-g_jr_c2__c_g2-r → node:c_g2 |
| 7.00–11.00 | 4.00 | node:c_g2 → sign-c_g2-c_g2__c_c |
| 11.00–23.26 | 12.26 | sign-c_g2-c_g2__c_c → sign-c_c-c_g2__c_c-r |
| 23.26–30.76 | 7.50 | sign-c_c-c_g2__c_c-r → sign-c_c-c_c__c_e1 |
| 30.76–57.45 | 26.69 | sign-c_c-c_c__c_e1 → sign-c_e1-c_c__c_e1-r |
| 57.45–61.45 | 4.00 | sign-c_e1-c_c__c_e1-r → node:c_e1 |
| 61.45–64.09 | 2.65 | node:c_e1 → identity-c_e1 |
| 64.09–65.45 | 1.36 | identity-c_e1 → sign-c_e1-c_e1__c_n |
| 65.45–75.29 | 9.84 | sign-c_e1-c_e1__c_n → sign-c_n-c_e1__c_n-r |
| 75.29–79.29 | 4.00 | sign-c_n-c_e1__c_n-r → node:c_n |
| 79.29–80.42 | 1.13 | node:c_n → identity-c_n |
| 80.42–83.29 | 2.87 | identity-c_n → sign-c_n-c_n__c_e2 |
| 83.29–91.74 | 8.44 | sign-c_n-c_n__c_e2 → sign-c_e2-c_n__c_e2-r |
| 91.74–95.74 | 4.00 | sign-c_e2-c_n__c_e2-r → node:c_e2, sign-c_e2-c_e2__x36f |
| 95.74–98.16 | 2.43 | node:c_e2, sign-c_e2-c_e2__x36f → identity-c_e2 |
| 98.16–99.74 | 1.57 | identity-c_e2 → sign-c_e2-c_e2__e_27j |
| 99.74–106.61 | 6.88 | sign-c_e2-c_e2__e_27j → sign-e_27j-c_e2__e_27j-r |
| 106.61–115.62 | 9.00 | sign-e_27j-c_e2__e_27j-r → node:e_27j |
| 115.62–118.12 | 2.50 | node:e_27j → sign-e_27j-e_27j__e_hall |
| 118.12–126.74 | 8.62 | sign-e_27j-e_27j__e_hall → sign-e_hall-e_27j__e_hall-r |
| 126.74–129.74 | 3.00 | sign-e_hall-e_27j__e_hall-r → node:e_hall |
| 129.74–134.74 | 5.00 | node:e_hall → sign-e_hall-e_hall__e_hall_stair_top |
| 134.74–145.04 | 10.30 | sign-e_hall-e_hall__e_hall_stair_top → sign-e_hall_stair_top-e_hall__e_hall_stair_top-r |
| 145.04–153.04 | 8.00 | sign-e_hall_stair_top-e_hall__e_hall_stair_top-r → node:e_hall_stair_top |
| 153.04–154.49 | 1.45 | node:e_hall_stair_top → sign-e_hall_stair_top-e_hall_stair_top__e_hall_stair_foot |
| 154.49–155.06 | 0.57 | sign-e_hall_stair_top-e_hall_stair_top__e_hall_stair_foot → sign-e_hall_stair_foot-e_hall_stair_top__e_hall_stair_foot-r |
| 155.06–156.52 | 1.46 | sign-e_hall_stair_foot-e_hall_stair_top__e_hall_stair_foot-r → node:e_hall_stair_foot |
| 156.52–161.52 | 5.00 | node:e_hall_stair_foot → sign-e_hall_stair_foot-e_hall_stair_foot__e_low |
| 161.52–163.13 | 1.61 | sign-e_hall_stair_foot-e_hall_stair_foot__e_low → sign-e_low-e_hall_stair_foot__e_low-r |
| 163.13–167.13 | 4.00 | sign-e_low-e_hall_stair_foot__e_low-r → node:e_low |
| 167.13–173.13 | 6.00 | node:e_low → sign-e_low-e_low__x35 |
| 173.13–199.14 | 26.01 | sign-e_low-e_low__x35 → end, node:x35 |

## Source and acceptance boundaries

- OSM attribution: © OpenStreetMap contributors, ODbL 1.0. Node 2558121915 v35; Metro relations 9240336 v13, 9240281 v12, 7967610 v17. Retrieved 2026-10-23T15:15Z. JR route relations retrieved 2026-10-24: 1972920 v130 (2026-10-08; other direction 1972960 v134), 21361895 v7 (2026-10-05), 4684034 v138 (2026-10-10). These supply plain-text 山手線 Yamanote JY13 / 埼京線 Saikyo JA12 / 湘南新宿ライン Shonan-Shinjuku JS21 facts only. The date-only JR retrieval is recorded in derivation, not an invented timestamp. Codes and line names remain transfer information, without platform or transfer-path assertions or route evidence.
- The いけふくろう marker is name/location only and APPROXIMATE. Tabi-mag and LIVE JAPAN facts were supplied by the director, retrieved 2026-10-24; time is unspecified, so retrievedAt is null and the date is recorded in notes. The local Toshima guide PDF is unavailable; no page verification or guide citation for this marker is claimed.
- High-tier transfer references are plain type, with no official rings, badges, logos or line colours; low tier omits them. The name-region box excludes transfers at both tiers. FONT and POI chips are unchanged.
- Each board uses textVerification for its text facts; placement is always GTEki-authored, not a surveyed sign location. The meeting location remains APPROXIMATE.
- Validation: locked single-worker station Vitest passes (24 files; 357 passed, 3 skipped); locked station tsc passes. The report was regenerated through the shared lock. Third-person ground, shoulder, boom collision/raise and FOV are replayed on CPU; no rendered five-second recognition, chip-overlap or 3-second frame acceptance is made. signs.ts has a structurally matching local IdentityBoardTag pending Explorer PR #347.
- After Q0 integration, the lead must run the authorised font subset update if CI reports missing glyphs, replace the local type once #347 lands, and perform visual/phone acceptance. The equipment failures above remain open acceptance limitations; no added props mask them.
