# Shared department-store kit, #1534

2026-11-24 JST. Candidate remains behind `?station=ikebukuro&next=1`.

The kit separates light stone floors, cream counter bodies and darker tenant walls; world-aligned baked downlight pools repeat on the 4.4 m fixture grid. Directories have a separate enlarged bilingual row per floor and floor-standing supports. Steel soffit panels replace the tan underside and isolated light rectangles; charcoal handrails have linear Y 0.029. Well reveals fill the space between the lower ceiling and upper floor, hiding the upper ribbon behind the slab.

Run the original 26 follow-camera poses, desktop 1440×900 and phone 390×844:

```sh
job-run --id depato-kit-1534-capture -- tachi-run --heavy --host --est 15m -- sh -c 'nice -n 15 pnpm install --frozen-lockfile && nice -n 15 node docs/visual/evidence/2026-11-24-depato-kit-1534/capture.mjs'
```

The capture writes the PNGs here and `receipt.json`, binding every frame to its source SHA. Each frame records conservative visible kit triangle and mesh-draw totals, including geometry outside the camera frustum. Phone food displays use six simple pieces per counter to meet the geometry budget. The replay preserves the original collision walks, searches, routes and matching flag-off poses. No GPU frame-rate result or AD acceptance is claimed by this capture; the AD measures the committed twelve-leg walk and judges the rendered luminance and directory readability.

## Results

2026-11-24 05:54 JST: job `depato-kit-1534-acceptance` exited 0. All 26 frames in [receipt.json](receipt.json) bind individually to runtime SHA `c34777040638485178dc9adc0379084989876a4c`; this follow-up adds evidence only. The 24 additional `*-upper-guide.png` frames render the authored upper-aisle edge with the approximate guide material reported in AD comment 7106005972.

- Desktop 1440×900 and phone 390×844: 13 frames each, failures `[]`, zero shader errors; every original collision-walk leg and supplementary B1 leg completed, and searches/routes passed.
- Phone maximum: **39,868 visible kit triangles**, **17 mesh draws** including both shells and the visible escalators, **1024×1024 name atlas**. All recorded phone frames meet the requested budgets. These are conservative whole-visible-kit counts without frustum culling, rather than total station-renderer counts.
- Desktop maximum: 220,020 visible kit triangles and 17 mesh draws. The 60k triangle limit is the phone budget.
- Required test command: `tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1` → **2 files passed; 34 tests passed**, duration 5.24 s. Last log line: `tachi-run: end 2026-11-24 05:49 JST`.
- The Vite server and capture task space were closed. Existing missing `stations/ikebukuro/navmesh-paths.json` and multiple-Three.js warnings appeared; they did not fail the capture.

The [acceptance measurement tables](measurements.md) record linear-sRGB door/concourse luminance, zero clipping in both door/concourse sample regions, store-sign/wayfinding ratios, rendered handrail luminance and slab occlusion at each of the 26 poses. All pass. Every sample box, projected sign polygon and upper-guide raycast is preserved in the receipt. Reproduce with `nice -n 15 python3 docs/visual/evidence/2026-11-24-depato-kit-1534/measure.py` after capture. Approximate guide bands on department-store preview routes now respect scene depth, allowing the slab to hide the guide above; flag-off routes retain their existing material behaviour.

The PR records the final-head CI result and its base/head golden-diff artifact for flag-off verification. Foreground GPU FPS and real-device/Owner acceptance remain with the lead and art director.

| Pose | Desktop | Phone |
| --- | --- | --- |
| entrance-before | [PNG](desktop-entrance-before.png) | [PNG](phone-entrance-before.png) |
| entrance-context | [PNG](desktop-entrance-context.png) | [PNG](phone-entrance-context.png) |
| entrance-inside | [PNG](desktop-entrance-inside.png) | [PNG](phone-entrance-inside.png) |
| food-hall-aisle | [PNG](desktop-food-hall-aisle.png) | [PNG](phone-food-hall-aisle.png) |
| counter | [PNG](desktop-counter.png) | [PNG](phone-counter.png) |
| escalator-boarding | [PNG](desktop-escalator-boarding.png) | [PNG](phone-escalator-boarding.png) |
| arrival-1F | [PNG](desktop-arrival-1F.png) | [PNG](phone-arrival-1F.png) |
| wide-1F | [PNG](desktop-wide-1F.png) | [PNG](phone-wide-1F.png) |
| street-door-inside | [PNG](desktop-street-door-inside.png) | [PNG](phone-street-door-inside.png) |
| street-door-outside | [PNG](desktop-street-door-outside.png) | [PNG](phone-street-door-outside.png) |
| far-end-B1 | [PNG](desktop-far-end-B1.png) | [PNG](phone-far-end-B1.png) |
| well-from-1F | [PNG](desktop-well-from-1F.png) | [PNG](phone-well-from-1F.png) |
| flag-off | [PNG](desktop-flag-off.png) | [PNG](phone-flag-off.png) |

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy.
