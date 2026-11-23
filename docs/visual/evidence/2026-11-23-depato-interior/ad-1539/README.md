# AD follow-up A/B and threshold correction — PR #1539

2026-11-23 JST. All 26 frames bind to runtime head `40c78db8`; later evidence-only commits do not change that code. PR stays draft behind `?station=ikebukuro&next=1`. **AD acceptance remains open:** the entrance ratio is **2.192×**, above 1.1–1.5×. A and the B palette remain accepted; this follow-up only removes the entry dimming and restores shell-wall values.

## Follow-up 4 — measurements and remaining limits

Every Y below is mean linear-sRGB luminance. Sample boxes and exact before/after data are in [receipt.json](receipt.json), under `adFollowup4`. Before is rejected runtime `105dcadf` unless marked original (`6efc91c1`).

### 1 — station-facing portal wall

| Profile | Rejected Y | Original Y | New Y |
| --- | ---: | ---: | ---: |
| desktop | 0.032259 | 0.264899 | 0.264929 |
| phone | 0.044167 | 0.314401 | 0.321322 |

The concourse-facing front wall, including the upper wall visible above the B1 portal, uses its original `#9daaa7`. Interior faces use the warm tan below. The desktop wall sample is within Y 0.21–0.28 and matches the original; phone sampling differs by 0.0069 Y from its original.

**Warm-dark limit is not certified.** The preceding receipt definition (`Y < 0.12` and `R > G > B`, full frame including UI) gives desktop **64.5333% → 22.7542%** and phone **39.8034% → 9.4978%**. The same definition gives **23.3720% / 13.0146%** on the original `6efc91c1` frames, differing from the AD comment's 10.6% / 11.7%. No mask or threshold was changed to obtain a pass. Desktop remains above the requested 12% under this broader definition; the lead/AD must reconcile the pixel mask.

[Portal desktop before/after](compare-f4-desktop-entrance-before.jpg), [phone](compare-f4-phone-entrance-before.jpg). [Concourse context desktop](compare-f4-desktop-entrance-context.jpg), [phone](compare-f4-phone-entrance-context.jpg).

### 2 — entrance-inside ceiling and floor

| Profile / surface | Rejected entry Y | New entry Y | Mid-aisle Y | Entry / aisle |
| --- | ---: | ---: | ---: | ---: |
| desktop ceiling | 0.168021 | 0.500379 | 0.551302 | 0.9076× |
| desktop floor | 0.055751 | 0.266878 | 0.278973 | 0.9566× |
| phone ceiling | 0.171963 | 0.497433 | 0.511100 | 0.9733× |
| phone floor | 0.089744 | 0.363142 | 0.375545 | 0.9670× |

All four surface comparisons are within 15%. The spatial entry multiplier is removed; the accepted mid-aisle palette, matte floor and counter gain remain. No new light or replacement dimming gradient was added.

[Entrance-inside desktop before/after](compare-f4-desktop-entrance-inside.jpg), [phone](compare-f4-phone-entrance-inside.jpg).

### 3 — shell walls

All interior shell-wall vertices use the same light warm tan `#9e8c72`, without a spatial multiplier. Screen Y still varies with existing post-processing and occlusion.

| Shell-wall sample | Rejected Y | New Y |
| --- | ---: | ---: |
| desktop-well-from-1F | 0.035121 | 0.248052 |
| desktop-street-door-outside | 0.234257 | 0.234257 |
| desktop-street-door-inside | 0.181854 | 0.181854 |

[1F well desktop before/after](compare-f4-desktop-well-from-1F.jpg), [phone](compare-f4-phone-well-from-1F.jpg).

### Entrance ratio — outside target

Unchanged entrance boxes: interior `[420,452,880,745]`, existing concourse ceiling/fixtures `[1020,140,1420,300]`, coordinates `[left,top,right,bottom)`. Interior Y **0.432183** / concourse Y **0.197178** = **2.191842×**, above the widened **1.1–1.5×** range. Both boxes have 0% clipped pixels. Removing the entry dimming resolved the entrance-surface deficit, but does not meet this ratio with the same measurement boxes. Further illumination changes would affect the already accepted B values; a lead/AD decision is required.

## Accepted A and B palette evidence

A remains visible on both viewports. Within the projected street opening: desktop **0.1162%** near-black and **0%** clipping; phone **0.1255% / 0%**. The original A/B comparison links below use `6efc91c1` before / `40c78db8` after.

[A desktop](compare-desktop-street-door-inside.jpg), [phone](compare-phone-street-door-inside.jpg). B: [desktop aisle](compare-desktop-food-hall-aisle.jpg), [phone aisle](compare-phone-food-hall-aisle.jpg), [desktop counter](compare-desktop-counter.jpg), [phone counter](compare-phone-counter.jpg), [desktop 1F](compare-desktop-wide-1F.jpg), [phone 1F](compare-phone-wide-1F.jpg).

## Capture result

2026-11-23 JST: `tachi-run --heavy --host --est 30m -- nice -n 15 node /tmp/depato-1534-capture.mjs` → exit **0**, job `depato-1539-recap-3`; 26 frames, failures `[]`, zero shader errors; both search queries, routes and collision walks passed. Job ran 2026-11-23 21:36:53–21:38:02 JST. Receipt timestamps are UTC (`Z`). No specs were requested or run; CI runs on the PR.

The existing missing `stations/ikebukuro/navmesh-paths.json` warning remains; no baked-guide or foreground GPU certification is claimed. The owned Vite server closed and browser task space 17 was finished. The OrbStack cleanup note says the VM was unreachable and was not a capture-command failure.

## All 26 poses

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

Default flip, other stores, item-1 leftovers and AD-owned item 8 remain held. Geometry and accepted wayfinding remain unchanged. Evidence and the detailed receipt account for the diff exceeding 300 lines.

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy.
