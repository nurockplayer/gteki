# #308 fitting exclusion follow-up

Spec 11 steers yaw toward each sign from the edge at 6 or 10 m. It does not switch to first person: the follow camera trails the 1.62 m eye, with 3.45 m boom, 0.42 m shoulder, pitch -0.12 and lift 0.14. The bake previously checked only eye volumes. The existing continuous 6–10 m eye envelope, whole 1.2 × 0.15 × 0.04 m fitting box, and 0.041 m face offset were already correct.

The fix adds continuous nominal follow volumes in pieces of at most 0.25 m. A curvature bound keeps each entire camera path inside its volume without independently sweeping eye and boom offsets. The broad follow envelope remains for structural audits.

Forecast: **156 excluded versus 47** (109 additional); **2460 retained** from 2,616 original candidates.

Baseline: commit `78bfb9c8`, 2,569 shipped fittings. The old eye exclusion finds zero remaining blockers. Every new fitting/face pair has an intersection witness at an individual nominal camera pose (endpoints first, then 0.025 m steps). This is a CPU forecast, conditional on the same source and bake grid.

Source GLB SHA-256: `aef077a6928855a98c4ae2e26be2856f79716e1e016503fe3413b14331cdfba8`.

Lit GLB SHA-256: `59d62bcd164cb54ae9a1b39090af2089eb111e8bce5bfadb5b4dd42c60c4d664`.

## Target-face computation

For camera C and fitting centre F, the distance to the sign-centre segment C→S is `|F − (C + clamp(dot(F−C,S−C)/|S−C|², 0, 1) × (S−C))|`. A second ray through F (or a box vertex) reaches the modeled face at coordinates (u,z) below; that ray has distance **0 m** to the fitting. Face bounds use committed maxWidthM and 0.42 × scale height.

| Sign / face | Stand-off m | Eye ENU m | Camera ENU m | Fitting | Centre-ray distance m | Blocking-ray face (u,z) m |
|---|---:|---|---|---:|---:|---|
| sign-place-sw_h__w_cj-4 / back | 6 | -125.476880, 62.375284, 29.530000 | -125.515132, 65.739077, 30.403117 | 274 | 0.133258 | 0.281341, -0.129049 |
| sign-place-sw_h__w_cj-4 / back | 10 | -125.582570, 66.373887, 29.530000 | -125.808158, 69.730325, 30.403117 | 259 | 1.928734 | -2.480087, -0.135020 |
| sign-place-sw_h__w_cj-4 / back | 10 | -125.582570, 66.373887, 29.530000 | -125.808158, 69.730325, 30.403117 | 274 | 0.352908 | 0.579267, -0.091670 |
| sign-rep-sw_h__w_cj-4 / front | 6 | -125.474998, 62.304107, 29.530000 | -124.242948, 59.173833, 30.403117 | 274 | 0.636325 | -2.335303, -0.199767 |
| sign-rep-sw_h__w_cj-4 / front | 10 | -125.369308, 58.305504, 29.530000 | -124.416835, 55.079150, 30.403117 | 274 | 0.068744 | 0.081507, -0.110229 |

Fitting 259 centre: `(-127.930185, 62.525448, 30.346001)`; fitting 274 centre: `(-125.674904, 61.704594, 30.346001)`. Fitting 274 blocks both reported faces; 259 blocks place-4 back only. The observed floor is 27.909999847 m versus graph 27.91 m; eye Z is 29.53 m, nominal camera Z 30.403117410 m.

Spec 11 and the CPU model both use ±0.041 × scale m for the faces. Loaded kit frames recess the runtime face to ±0.027 m; this small discrepancy cannot explain the missed strips several metres away. The model keeps the existing maxWidthM bound; actual painted widths, camera collision response, and both rendered tiers still require the lead’s GPU check. Place-6 back/col_015 remains out of scope.

## Newly excluded fittings by sign/face

Ids are zero-based boxes in the baseline `light_fixtures` mesh: box N is triangles 12N through 12N+11. A fitting can block several faces; count unique ids for the 109 additions. The JSON output also lists every centre and individual-pose witness.

| Sign | Face | Fitting ids |
|---|---|---|
| sign-c_e1-c_c__c_e1-r | back | 1589, 1625, 1626 |
| sign-c_e1-c_e1__c_n | front | 1764 |
| sign-c_e1-c_e1__c_s | front | 1719 |
| sign-c_e2-c_e2__x36f | back | 2189, 2204, 2205 |
| sign-c_mid-c_mid__c_g2 | front | 1183 |
| sign-c_mid-c_mid__g_jr_c1 | back | 1216, 1217 |
| sign-c_mid-c_mid__g_jr_c1 | front | 1183 |
| sign-c_mid-c_w__c_mid-r | front | 1183 |
| sign-c_n-c_e1__c_n-r | back | 1804, 1830 |
| sign-c_n-c_n__n_h | back | 1968 |
| sign-c_s-c_e1__c_s-r | back | 1717 |
| sign-c_s-c_e1__c_s-r | front | 1716 |
| sign-c_s-c_s__sp_j | back | 1756 |
| sign-c_s-c_s__x37 | front | 1760 |
| sign-c_w-c_w__c_mid | back | 860, 902 |
| sign-e_27j-e_27j__e_hall | front | 2255, 2262 |
| sign-e_hall-e_27j__e_hall-r | back | 2280, 2294 |
| sign-e_hall-e_27j__e_hall-r | front | 2310 |
| sign-e_hall-e_hall__e_hall_stair_top | back | 2348, 2361, 2372 |
| sign-e_hall-e_hall__e_hall_stair_top | front | 2320, 2332 |
| sign-e_hall-e_hall__se_1 | back | 2291, 2302, 2303, 2308 |
| sign-e_hall-e_hall__se_1 | front | 2309 |
| sign-e_hall_stair_foot-e_hall_stair_foot__e_low | back | 2428 |
| sign-e_hall_stair_foot-e_hall_stair_foot__e_low | front | 2411, 2412, 2418 |
| sign-e_hall_stair_top-e_hall__e_hall_stair_top-r | back | 2349, 2350, 2360 |
| sign-e_hall_stair_top-e_hall__e_hall_stair_top-r | front | 2384 |
| sign-e_low-e_hall_stair_foot__e_low-r | back | 2411, 2412, 2418 |
| sign-e_low-e_hall_stair_foot__e_low-r | front | 2428 |
| sign-e_low-e_low__x34 | back | 2442 |
| sign-e_low-e_low__x34 | front | 2435 |
| sign-e_low-e_low__x35 | back | 2464, 2467 |
| sign-n_c-n_h__n_c-r | front | 1997 |
| sign-n_e-n_e__ne_j | back | 2265 |
| sign-n_h-n_h__n_c | back | 1997 |
| sign-ne_e-ne_e__x33 | back | 2437, 2451 |
| sign-place-sw_h__w_cj-2 | front | 399, 420, 465 |
| sign-place-sw_h__w_cj-4 | back | 259, 274 |
| sign-place-sw_h__w_cj-6 | back | 166 |
| sign-rep-sw_h__w_cj-1 | back | 418 |
| sign-rep-sw_h__w_cj-4 | front | 274 |
| sign-s39_f-s39_f__x39 | front | 2565 |
| sign-s39_f-s40_j__s39_f-r | back | 2552, 2554, 2557, 2559, 2560, 2562 |
| sign-s39_f-s40_j__s39_f-r | front | 2563, 2564, 2565 |
| sign-se_1-e_hall__se_1-r | back | 2277, 2290 |
| sign-se_1-se_1__se_j | back | 2340, 2347 |
| sign-se_1-se_1__se_j | front | 2315 |
| sign-se_j-se_1__se_j-r | back | 2371, 2383 |
| sign-se_j-se_1__se_j-r | front | 2393 |
| sign-sp_j-c_s__sp_j-r | back | 1693 |
| sign-sp_j-sp_j__sp_e | front | 1689, 1733 |
| sign-sp_j-sp_j__sp_m | back | 1553, 1579 |
| sign-sp_j-sp_j__sp_m | front | 1689 |
| sign-w_c-w_c__w_cj | back | 170, 181, 206, 229 |
| sign-w_c-w_c__w_n | back | 185, 209, 210, 230 |
| sign-w_cj-sw_h__w_cj-r | back | 166, 167 |
| sign-w_cj-w_c__w_cj-r | back | 181, 205, 206, 229 |
| sign-w_cj-w_c__w_cj-r | front | 169, 170 |
| sign-w_n-w_c__w_n-r | back | 186, 187, 188, 210, 211, 212, 213 |
| sign-w_n-w_c__w_n-r | front | 189, 190, 191, 214, 215 |
| sign-w_n-w_n__x15 | front | 189, 190 |
| sign-w_n-w_n__x17 | front | 190 |
| sign-w_n-w_n__x18 | back | 193 |
| sign-w_n-w_n__x18 | front | 189, 190, 191, 192, 217 |
| sign-w_n-w_nw__w_n-r | front | 190, 216 |
| sign-w_nw-w_w__w_nw-r | back | 61 |
| sign-w_w-w_w__w_nw | back | 57, 69 |

Reproduce with:

```sh
lockf -k /tmp/gteki-local-test.lock python3 -I stations/ikebukuro/pipeline/report_probe_fittings.py --markdown
```

## Validation and handoff

The permitted locked Vitest run (`--maxWorkers=1 stations/ikebukuro`) completed with 343 passed, 3 skipped and 1 failed across 23 files. Both Python suites, including the new camera-envelope, two-face blocker and retained-fitting regressions, passed. The sole failure is the unchanged `scene/lit_provenance.test.ts:65`: its bakedFrom pin is `e0188c50…`, while the baseline bake's unchanged metadata records `aef077a6…`. The locked station TypeScript check passed.

No Blender, browser, GPU run or rebake was performed. The lead still needs to rebake and check both tiers with actual painted widths and camera collision response. Committed GLB, WebP and metadata files were not changed. The place-6 back face's structural col_015 limitation is unchanged.
