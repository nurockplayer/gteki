# W1 enclosure round 4 handoff

Base: integrated stage `5eca85c`; branch `claude/shinjuku-s2-w1-enclosure`.

## Changes and checks

- `scene/layout.ts`: roof the previously skipped near-street intermediate landings; finish shaft walls and flat transition shoulders at the street slab underside (-0.18 m). Run clearance cuts remain in every new roof.
- `scene/surface-layout.ts`: retain the existing canopy/sky context when the follow camera is in the widened stair-shaft shoulder. Lift halls retain their existing visibility exclusions. No canopy geometry or street routing changed.
- Add a pitched structural invert 0.3 m below the lowest flight datum across each widened shaft. It closes the view through the railing beside the actual run. It is a structural underside, not a walkable proxy; intersecting graph paths retain their clearance cuts.
- Split wall cuts at affine height crossings before applying endpoint min/max. This preserves the flat wall until the pitched opening reaches it, fixing the long overcut triangular gaps at B3/B6 junctions.
- Three new enclosure regression tests cover near-street landing roofs, escalator side slots, and the pitched-wall cut. The surface visibility test also covers both north-exit shoulders. The lead's scene-hook cap test is unchanged.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, station TypeScript check, `pnpm test`, and `pnpm --filter @gteki/station-shinjuku import:e27 --check` passed. Full suite: **443 tests, 37 files**. The importer produced byte-identical outputs; routing JSON, plan, heights, and navigation counts were not changed.
- No app/core edits, dependencies, third-party assets, or operator graphics added.

## Whole-station sweep

640x360, low quality, crowd 0, requested HUD 0, same 456 poses as the lead's baseline.

| voidFraction | Before | After |
| --- | ---: | ---: |
| <= 0.03 | 419 | 432 |
| > 0.03 through 0.10 | 28 | 19 |
| > 0.10 | 9 | 5 |

Peak calls: **166 -> 166**; peak triangles: **202,026 -> 202,931**. Mean near-black share: 0.01044 -> 0.00804. No harness errors.

Artifacts, relative to the worktree root:

- Before: `.qa/sweep-lead/report.json`, corresponding PNGs, `worst16.jpg`.
- After: `.qa/round4-sweep-after/report.json`, all 456 PNGs, `remaining24.jpg`.
- Pose input: `.qa/round4-sweep.json` (generated from `tools/node-vantages.ts`).
- Camera reconstruction: `.qa/round4-final-camera-diagnosis.json`; analytic enclosure rays: `.qa/round4-final-ray-diagnosis.json`.

The sweep generator emits **degrees** while the lane teleport hook takes **radians**. This run deliberately preserves the lead's raw poses for comparison; the generator was not modified. Consequently this is a 456-pose coverage comparison, not proof that every shot faces its labelled incident-edge direction. The requested HUD 0 also leaves HTML HUD elements in the PNGs; `voidFraction` reads the WebGL framebuffer and excludes those elements.

## Class A

| View | Before void | After void |
| --- | ---: | ---: |
| e0268b18-174 | 0.203 | 0.000 |
| e0268b18-354 | 0.163 | 0.001 |
| ddbb3771-354 | 0.113 | 0.000 |
| 5324674e-337 | 0.112 | 0.091 |

The north exit's roof/shoulder gaps are closed. `5324674e-337` retains a camera-placement problem: the reconstructed boom crosses a 1.754 m structural wall band omitted by the lane's >1.9 m wall filter, and now also crosses the structural underside of the upper shaft. The head-height probe is enclosed (0.008 near-black share).

## Remaining views above 0.03

The lane camera excludes all `layout.soffits` from its camera surfaces and excludes all `runWalls`. Body/walker tests remain green. Camera-band crossings below are geometric evidence of foreground/clipping risk; the intentional choice to ignore railings remains the camera owner's decision.

| View | Before -> after void | Finding |
| --- | ---: | --- |
| f9731c86-339 | 0.178 -> 0.178 | Camera crosses landing roof; reconstructed eye 0.929 m above roof. Head-height B2 probes: 0.001. |
| af29d468-059 | 0.176 -> 0.176 | Camera crosses landing roof; reconstructed eye 0.929 m above roof. Head-height B2 probes: 0.001. |
| 8d184e38-051 | 0.141 -> 0.141 | Camera crosses pitched shaft roof; reconstructed eye 0.338 m above it. Head-height probe: 0.007. |
| af29d468-159 | 0.116 -> 0.116 | Camera crosses landing roof; reconstructed eye 0.929 m above roof. Head-height B2 probes: 0.001. |
| e47b9456-172 | 0.112 -> 0.107 | No boom/roof or boom/wall crossing found. Tight landing framing, dark rail/skirt surfaces; small junction gap closed. See quality-path limitation below. |
| 5324674e-337 | 0.112 -> 0.091 | Boom crosses short structural wall and upper-shaft underside; see Class A. |
| aa29caed-148 | 0.063 -> 0.064 | Boom crosses omitted run railing/wall bands (1.931 m vertical span); foreground domination, not an unlined shaft. |
| 9c0318aa-073 | 0.062 -> 0.062 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| c95ebb48-038 | 0.058 -> 0.058 | Boom crosses omitted run railing/wall bands (1.857 m vertical span); foreground domination, not an unlined shaft. |
| 9c0318aa-343 | 0.053 -> 0.053 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| 20014f52-266 | 0.051 -> 0.051 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| f05b059c-174 | 0.006 -> 0.051 | Boom crosses omitted run railing/wall bands (1.931 m vertical span); foreground domination, not an unlined shaft. Newly above threshold: restored wall changes camera candidate; before eye (-18.407,115.538,-40.775), after reconstruction (-18.940,121.145,-40.808). |
| cf58cd07-068 | 0.048 -> 0.048 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| fe83851e-255 | 0.047 -> 0.046 | Boom crosses omitted run railing/wall bands (1.820 m vertical span); foreground domination, not an unlined shaft. |
| 1dda661f-254 | 0.045 -> 0.045 | No boom intersection. One of 576 enclosure rays remains open (0.17%); a full mesh ray also misses. Residual small slot; most near-black pixels in the image are cladding/sign surfaces. |
| f5a969b0-231 | 0.043 -> 0.043 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| ea71c5f7-236 | 0.040 -> 0.040 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| b159c0f7-276 | 0.039 -> 0.039 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| cc3a914a-066 | 0.038 -> 0.038 | Boom crosses omitted run railing/wall bands (1.820 m vertical span); foreground domination, not an unlined shaft. |
| 07356d14-205 | 0.037 -> 0.037 | Boom crosses omitted run railing/wall bands (1.827 m vertical span); foreground domination, not an unlined shaft. |
| 65116b8e-073 | 0.035 -> 0.035 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| 24fb06c1-205 | 0.033 -> 0.033 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| aa29caed-344 | 0.032 -> 0.032 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |
| 65116b8e-342 | 0.031 -> 0.031 | No boom intersection or open analytic enclosure ray found; near-black rail/skirt, wall dado, or sign surfaces dominate the metric. |

All 24 remaining images were inspected in `.qa/round4-sweep-after/remaining24.jpg`; the critical exit/shaft and probe PNGs were also opened individually. Enclosure-ray diagnostics are a CPU reconstruction, not a substitute for the actual rendered image or a claim that camera behavior is fixed.

**Quality-path limitation:** the exact head-height free-camera probe at e47b9456 renders all near-black on high quality (1.000), while low quality at the same eye/look is enclosed (0.028). CPU mesh rays hit walls 4.3-6.9 m away and the ceiling 3.824 m above the eye. Its cause is unconfirmed; investigate the high-quality rendering path before calling this view clean. Repro poses and PNGs: `.qa/round4-primed-probes/` (high), `.qa/round4-e47-low/` (low). No app/postprocess changes were made.

## Standard 26 views

1280x720, high quality, crowd 24, unchanged standard poses. All 26 remain <=0.03; maximum stays 0.028. Twenty-three are unchanged or lower. The three increases are b6-platform-train (+0.001), b6-platform-empty (+0.004), and characters-close-back (+0.003); these captures include moving crowds/trains, so they are not strictly identical frames. Peak calls stays 263; peak triangles 444,494 -> 442,276. `characters-platform-setup` individually increases 96 -> 106 calls; other call differences are shown below. No claim of universal per-view call reduction is made.

Before/after: `.qa/round4-standard-before/`, `.qa/round4-standard-after/`; visual sheet: `.qa/round4-standard-after/contact.jpg`. The latter report also contains five extra probes; only the original 26 are compared here.

| Vantage | Void before -> after | Calls before -> after | Tris before -> after |
| --- | ---: | ---: | ---: |
| b1-gate-1 | 0.005 -> 0.004 | 112 -> 112 | 251,918 -> 253,572 |
| b1-gate-1-reverse | 0.000 -> 0.000 | 117 -> 117 | 253,730 -> 253,348 |
| b1-concourse | 0.005 -> 0.004 | 72 -> 72 | 208,104 -> 209,182 |
| exit-1-street | 0.002 -> 0.002 | 253 -> 253 | 424,856 -> 426,626 |
| exit-1-arrive | 0.001 -> 0.001 | 111 -> 111 | 330,698 -> 331,474 |
| exit-2-street | 0.002 -> 0.002 | 202 -> 192 | 444,494 -> 442,276 |
| b2-stairs | 0.008 -> 0.008 | 126 -> 126 | 249,850 -> 251,660 |
| b3-hall | 0.006 -> 0.006 | 186 -> 186 | 284,726 -> 286,188 |
| b45-escalators | 0.003 -> 0.003 | 90 -> 90 | 220,948 -> 221,624 |
| b6-platform-train | 0.001 -> 0.002 | 96 -> 96 | 245,110 -> 251,114 |
| b6-platform-empty | 0.003 -> 0.007 | 112 -> 112 | 266,706 -> 267,094 |
| elevator-b1 | 0.001 -> 0.001 | 236 -> 236 | 282,906 -> 290,388 |
| exit-1-canopy-back | 0.000 -> 0.000 | 81 -> 81 | 289,218 -> 289,994 |
| exit-2-canopy-back | 0.003 -> 0.003 | 213 -> 213 | 414,152 -> 416,098 |
| exit-3-canopy-back | 0.000 -> 0.000 | 113 -> 113 | 342,038 -> 342,616 |
| exit-4-canopy-back | 0.001 -> 0.001 | 113 -> 113 | 342,038 -> 342,616 |
| exit-street-oblique | 0.000 -> 0.000 | 261 -> 261 | 395,560 -> 397,370 |
| exit-1-city | 0.000 -> 0.000 | 263 -> 263 | 420,698 -> 405,532 |
| exit-4-city | 0.000 -> 0.000 | 95 -> 95 | 310,788 -> 311,564 |
| characters-platform-setup | 0.000 -> 0.000 | 96 -> 106 | 221,802 -> 224,506 |
| characters-close-front | 0.001 -> 0.001 | 210 -> 210 | 345,656 -> 353,734 |
| characters-close-back | 0.002 -> 0.005 | 108 -> 108 | 235,814 -> 230,234 |
| w1-b1-b3-shaft-up | 0.017 -> 0.017 | 138 -> 138 | 227,354 -> 229,164 |
| w1-b3-b6-shaft-up | 0.026 -> 0.026 | 224 -> 224 | 355,470 -> 357,376 |
| w1-b2-stair-hall-across | 0.028 -> 0.028 | 86 -> 86 | 226,538 -> 227,900 |
| w1-b45-landing-up | 0.006 -> 0.003 | 213 -> 203 | 261,334 -> 261,032 |

## Geometry cost and deliberate simplifications

Geometry-only CPU inventory (fake canvas; not a browser load-time or heap measurement):

| Stored resource | Before | After |
| --- | ---: | ---: |
| Unique geometry objects | 133 | 133 |
| Stored vertices | 298,212 | 299,622 |
| Stored triangles | 158,582 | 159,415 |
| Geometry bytes | 10,853,452 | 10,903,570 |
| Texture objects | 28 | 28 |
| Texture pixels | 36,998,400 | 36,998,400 |

Static enclosure remains merged by level/material. No new textures. New geometry adds 50,118 stored bytes and 833 stored triangles. Browser startup/heap were not remeasured.

New visual fill: finished near-street landing sleeves/shoulders and structural shaft inverts across the wider shaft envelope. These are generic procedural construction, not source-confirmed architecture. All elevations remain the existing symbolic model; no station facts or graph connections were added. Camera escape, the small residual slot at 1dda661f-254, and the e47b9456 high-quality free-view failure remain for follow-up.
