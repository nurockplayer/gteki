# AD follow-up A / B — PR #1539

2026-11-23 JST. **Last successful capture: `0e585ec`, not the final branch head.** All 26 original poses were recaptured at desktop 1440×900 / phone 390×844, DPR 1. Later entry-light and counter-body adjustments could not be captured because CDP touch emulation timed out on both profiles. Keep the PR draft; B's final acceptance remains open. All product changes are under the existing `?station=ikebukuro&next=1` preview.

## A — desktop opening

The desktop high-detail street context finishes asynchronously after the station and catalog. The pilot previously awaited only the catalog, so its opening could render before the context was attached. The preview's existing `settled()` wait now includes context preparation. The visibility gate also uses the supplied camera independently of the old station-floor render probe (that floor can be undrawn after the preview cuts), reading fog from the host scene rather than the desktop depth pass.

Both profiles now report visible street context at the inside-door pose. Within the exact projected opening polygon, desktop max-channel ≤16 falls from **71.1896% to 0.1004%**, and clipping (any channel 255) remains **0%**. Phone remains **0.1255% / 0%**. A passes the requested <1% dark / <2% clipping limits with actual street geometry.

- [Desktop A before / after](compare-desktop-street-door-inside.jpg)
- [Phone A before / after](compare-phone-street-door-inside.jpg)

## B — warm palette and baked light

Stone floor albedo is `#D6CFC2`, counter/island bodies cream `#E6DDCD`; bronze remains trim. Back walls and ceiling bays are warm. Ceiling members reach the perimeter and intersecting grid members instead of ending at downlight positions. Showcases have an illuminated internal back and shelf. The floor's baked pools use a light map, with a spatial entry-light transition. A normal-buffer alpha mask excludes only these matte preview floors from the existing screen-space reflection pass while preserving their AO normals; station floors keep their reflection behavior.

The last successful capture has these mean linear-sRGB Y samples, using the previous README's exact boxes:

| Surface | Before `6efc91c1` | Captured `0e585ec` |
| --- | ---: | ---: |
| ceiling | 0.3564 | 0.3868 |
| floor | 0.0736 | 0.2943 |
| back wall | 0.2540 | 0.1912 |
| bronze header trim | — | 0.0173 |
| counter body | 0.0346 | 0.3835 |
| showcase strip | 0.4800 | 0.4801 |

Ceiling → floor → wall → trim steps are **0.0925 / 0.1031 / 0.1739 Y**. Warm dark pixels use `Y < 0.12` and `R > G > B`; desktop aisle **36.57% → 0.42%**, desktop 1F **26.07% → 0.14%**. The receipt also gives the stricter count of all dark pixels, including the cool app UI and cat.

**Still required:** the captured interior/concourse entrance mean is **1.471×**, above 1.1–1.3×, and its cream bodies are brighter than its floor. The final code dims the counter illumination and entry spill, and applies the same entry light to the warm ceiling bays. Those final adjustments are **not captured**. Their lighting gains have separate shader cache keys. B must not be called accepted from these images.

Entrance sample boxes: interior `[420,452,880,745]`, existing concourse ceiling/fixtures `[1020,140,1420,300]`; coordinates are `[left,top,right,bottom)`. The exterior generated store wall is not used as a concourse reference. See [receipt.json](receipt.json) for the original surface boxes, projected opening polygons, profile/camera records and all pixel statistics.

- [Desktop aisle B before / after](compare-desktop-food-hall-aisle.jpg), [phone](compare-phone-food-hall-aisle.jpg)
- [Desktop counter B before / after](compare-desktop-counter.jpg), [phone](compare-phone-counter.jpg)
- [Desktop 1F B before / after](compare-desktop-wide-1F.jpg), [phone](compare-phone-wide-1F.jpg)
- [Desktop entrance B before / after](compare-desktop-entrance-before.jpg), [phone](compare-phone-entrance-before.jpg)

## Tests and blocker

2026-11-23 JST: `tachi-run -- pnpm vitest run apps/web/src/explorer/postfx.test.ts` → **27 passed (27)**. This covers lazy floor-normal twins, main-material restoration and unload removal; post-processing code has not changed since that pass.

`nice -n 15 node /tmp/depato-1534-capture.mjs` at `0e585ec` → exit **0**, 26 frames, failures `[]`, zero shader errors, both search queries and both routes/collision walks pass. Capture timestamps in the receipt are UTC (`Z`).

The next replay at `36e71bb` exited **1** before any frame: `CdpRequestTimeoutError: CDP request timed out: Emulation.setTouchEmulationEnabled`, once on desktop and once on phone. This browser path stopped after the repeated infrastructure error, as instructed. The lead must restore the browser transport and recapture the final head; no final-head visual PASS is claimed. The owned Vite server closed; task space 13 remains available for recovery. The existing missing `stations/ikebukuro/navmesh-paths.json` warning remains; no baked-guide certification is claimed.

## All 26 original poses

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

Items 2, 3, 4, 5, 7, the item-6 header and phone street retain their accepted geometry. Palette and ceiling continuity changes above are the requested B scope. AD reacceptance and item 8 remain with the art director; the default flip and other stores stay held.

Credits: GTEki contributors; 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成. Cat: guillaume bolis, CC BY 4.0, modified by GTEki contributors; see NOTICE. Composite screenshots follow REUSE.toml: CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy.
