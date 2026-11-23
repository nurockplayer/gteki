# Shared department-store kit, #1534

2026-11-24 JST. Candidate remains behind `?station=ikebukuro&next=1`.

The kit separates light stone floors, cream counter bodies and darker tenant walls; world-aligned baked downlight pools repeat on the 4.4 m fixture grid. Directories have a separate enlarged bilingual row per floor and floor-standing supports. Steel soffit panels replace the tan underside and isolated light rectangles; charcoal handrails have linear Y 0.029. Well reveals fill the space between the lower ceiling and upper floor, hiding the upper ribbon behind the slab.

Run the original 26 follow-camera poses, desktop 1440×900 and phone 390×844:

```sh
job-run --id depato-kit-1534-capture -- tachi-run --heavy --host --est 15m -- sh -c 'nice -n 15 pnpm install --frozen-lockfile && nice -n 15 node docs/visual/evidence/2026-11-24-depato-kit-1534/capture.mjs'
```

The capture writes the PNGs here and `receipt.json`, binding every frame to its source SHA. Each frame records conservative visible kit triangle and mesh-draw totals, including geometry outside the camera frustum. Phone food displays use six simple pieces per counter to meet the geometry budget. The replay preserves the original collision walks, searches, routes and matching flag-off poses. No GPU frame-rate result or AD acceptance is claimed by this capture; the AD measures the committed twelve-leg walk and judges the rendered luminance and directory readability.

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy.
