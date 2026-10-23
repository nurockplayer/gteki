# Station identity boards (#342 Q1b/Q3)

Local implementation receipt, 2026-10-24. No commit or push. No web, browser, GPU or external LLM review.

## Recognition proxy

The requested CPU proxy uses the spawn eye at 1.62 m, the actual scene spawn headings, the Explorer first-person 60° vertical lens, default pitch -0.12, phone 390×844 and desktop 1280×720 CSS px. Cap height is conservatively estimated at 0.7 em, not measured glyph ink. Phone name bounds are inside the frustum; full panel sightlines include structural geometry, column sleeves and existing sign panels, with light fittings excluded as requested. Default third-person uses a 50° lens and collision-adjusted 3.45 m boom; that camera and perceived readability require rendered acceptance.

| Spawn | Phone JP / EN px | Desktop JP / EN px | Phone JP texels / CSS px | Other equipment centres visible | Equipment result |
| --- | ---: | ---: | ---: | ---: | --- |
| c_mid | 28.3 / 20.2 | 24.1 / 17.2 | 1.34 | 10 | proxy met (equipment) |
| c_e2 | 21.0 / 15.0 | 17.9 / 12.8 | 1.80 | 1 | proxy not met (equipment) |
| n_h | 30.0 / 22.7 | 25.6 / 19.4 | 1.26 | 0 | proxy not met (equipment) |
| sp_e | 21.0 / 15.1 | 17.9 / 12.9 | 1.80 | 2 | proxy met (equipment) |
| w_c | 42.9 / 30.5 | 36.6 / 26.0 | 1.11 | 6 | proxy met (equipment) |
| sw_h | 35.9 / 25.6 | 30.6 / 21.8 | 1.05 | 7 | proxy met (equipment) |

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

Six station-name boards cover all spawn nodes. Additional main-passage junctions are c_e1, c_n and sp_m, each with verified degree ≥3. Positions remain in identity.json so approximate meeting-point text, identity metadata and transfer information stay separate from generated directional routing signs. All panel positions are GTEki-authored, not surveyed sign locations. Ceiling-mounted housings retain at least 2 m clearance; the near North Passage wall uses a wall panel. Existing sign text and route data are unchanged.

## Atlas and asset delta

CPU canvas width estimates use the existing CJK/Latin estimator. Memory is RGBA8 plus a full mip chain (4/3), in MiB; browser glyph widths may differ.

| Tier | Round-0 shared pages = final shared pages | Separate identity texture | Round-0 MiB | Final shared MiB | Identity MiB | Final total MiB | Delta MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| low | 4096×2048 + 4096×512 | 968×345 | 53.33 | 53.33 | 1.699 | 55.032 | 1.699 |
| high | 4096×4096 + 4096×4096 | 1920×658 | 170.67 | 170.67 | 6.426 | 177.092 | 6.426 |

Round 3 replaces the Round 2 low-tier 53.33 → 64.00 MiB (+10.67 MiB) allocation. Direction/place faces return to exactly the round-0 page sizes. All ten identity boards share one tightly cropped, non-power-of-two canvas with mipmaps (WebGL2), one material and one merged face batch. The canvas contains three shelf-packed artworks: compact station name at 160 px/m low, wide station name at 280 px/m low, and meeting point at 140 px/m low; desktop doubles each density. Identical content reuses the same UV rectangle. The nearby wide panel uses a 0.8 name scale to retain phone frustum clearance.

Each artwork is painted in physical coordinates at its own 3.4×0.54 aspect, then uniformly fitted inside each board width and height; solid margins fill the remaining panel area with quads in the same batch. There is no 0.42 m shelf-height stretch or horizontal fillText compression. Compact main names use a 1.12 scale and a small upward shift, preserving junction recognition and the transfer-row clearance; wide main names use 0.8. This reuse avoids allocating ten nearly identical canvases. Main-name cap height remains geometric; the texel ratios above use the actual tier canvas height and the correct artwork for each spawn.

Panels: 119 existing → 129 total. Identity proxies: 10, with no mesh, draw call, walkable or collider. Rendering now has one housing batch, one face batch per shared page, and one identity face batch: four draw calls on either tier, one more than round 0 / Round 2. Solid margins add 20 triangles versus Round 2. The new texture, material and geometry are disposed with the rest of the signs; regression tests observe disposal. The shared phone pages are exactly 4096×2048 + 4096×512. Shipped asset count remains 19; declared scene data files remain 8.

## Transfer-row cap height

Both exact transfer strings are unchanged, split into JR / Metro rows. The rows use 0.13 em of artwork height, the available vertical band below the name with interline and edge clearance, and shrink uniformly only if measured width requires it. Values below are conservative 0.7 em cap estimates, not measured ink. Two complete rows impose a width limit: the narrow panels cannot provide 3 cm transfer caps. These rows are secondary transfer information; no distance-readability claim is made.

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
| identity-sp_m | 4.67 | 4.67 |

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
- All transfer references are plain type, with no official rings, badges, logos or line colours. Every station-name panel uses two secondary rows (JR, then Metro); the name-region box excludes both. FONT is unchanged.
- Each board uses textVerification for its text facts; placement is always GTEki-authored, not a surveyed sign location. The meeting location remains APPROXIMATE.
- Tests and station typecheck pass using the shared lock and single-worker commands. No rendered five-second recognition claim, third-person collision/raising check, chip-overlap check or 3-second frame acceptance is made. The shared docs/core/contract.md edit is reverted; signs.ts has a structurally matching local IdentityBoardTag pending Explorer PR #347.
- After Q0 integration, the lead must run the authorised font subset update if CI reports missing glyphs, replace the local type once #347 lands, and perform visual/phone acceptance. The equipment failures above remain open acceptance limitations; no added props mask them.
