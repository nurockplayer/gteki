# Shinjuku exterior finish — 2026-11-24 JST

Package C, Refs #1528, stacked on #1511. The change remains behind `?next=1`.

The preview uses visible procedural floor joints at 4.5 m and piers at 7 m, with a per-floor spandrel on the glazed facade. Closed street glazing follows the actual LOD2 wall spans, with bronze mullions of 0.18 m depth and warm light at emissive intensity 0.5. Regular glazing bays target 3 m; short wall spans use one terminal bay. Isetan Men's, Odakyu, Marui Annex and Lumine Est use the shared dark bronze swatch. All plain name bands use the unlit atlas to retain text contrast; the English name is “Isetan Men's”.

## Capture

Replay all 44 original R8 next poses and their 44 matching off poses, at desktop 1440×900 and phone 390×844. The existing close road-view exceptions are retained. Each row in `frames.json` records its source SHA, viewport, camera, image hash, rendered contrast, facade/sky ratio, draw calls and texture dimensions. Off rows also record the R8 golden hash and exact PNG equality. An absent visible sky is reported as N/A.

`job-run --id depato-shinjuku-finish-r10 --artifact docs/visual/shinjuku-department-stores-2026-11-22/r10 -- tachi-run --heavy --host --est 15m -- nice -n 15 node tools/qa/depato-capture.mjs`

2026-11-24 05:42 JST: capture job exited 0, from source `52884b96e01ac9c3eabe2a0b314d0fa490d8d46c`. All 88 images and the receipt are committed with this report. Last result: `2026-11-24 JST: completed all 44 original next frames and their matching off pairs`.

All 44 next frames meet the numerical contrast, sky-separation and phone-budget limits: minimum contrast 6.8326:1, maximum visible facade/sky 0.7310, at most 3 draws per store and textures at most 512×512. Art acceptance of the facade rhythm and glazing remains with the art director; no default flip is included.

The off golden comparison is **28/44 exact matches**. The other 16 have 1–583 changed pixels per image, maximum channel delta 9/255. Fourteen of those images differ only on a single horizontal row (desktop y=63 or phone y=45); desktop Keio walk also differs at three pixels outside that row, and desktop Lumine 1 walk differs at one pixel by one channel value. The receipt preserves each image hash, golden hash, difference count, bounding box and maximum channel delta without a tolerance or exclusion mask. This is not an exact 44/44 golden PASS; the lead must assess the residual differences.

No browser task space or Vite server was retained after capture.

## Tests

`tachi-run -- pnpm exec vitest run stations/shinjuku/test/data-files.test.ts stations/shinjuku/test/surface.test.ts --maxWorkers=1`

2026-11-24 03:52 JST: exit 0; `Test Files 2 passed (2)`, `Tests 36 passed (36)`; last result line `tachi-run: end 2026-11-24 03:52 JST`.

## Assumptions

The evidence diff exceeds 300 lines because it includes 88 PNGs and their per-frame receipt. The final evidence commit changes only documentation and images; its rendered scene is the recorded source SHA. The original road-pose exceptions remain.

## Follow-ups

Art-director acceptance of the committed frames, lead assessment of the 16 nonidentical off goldens, and final-head CI.

## Per-frame measurements — 2026-11-24 JST

| Frame | Contrast | Facade/sky | Draws | Off changed pixels |
|---|---:|---:|---:|---:|
| [desktop-isetan-honkan-walk-next.png](desktop-isetan-honkan-walk-next.png) | 6.885:1 | N/A | 3 | N/A |
| [desktop-isetan-honkan-look-next.png](desktop-isetan-honkan-look-next.png) | 7.016:1 | 0.5296 | 3 | N/A |
| [desktop-isetan-mens-walk-next.png](desktop-isetan-mens-walk-next.png) | 6.975:1 | 0.3709 | 3 | N/A |
| [desktop-isetan-mens-look-next.png](desktop-isetan-mens-look-next.png) | 6.951:1 | 0.1185 | 3 | N/A |
| [desktop-odakyudept-walk-next.png](desktop-odakyudept-walk-next.png) | 6.833:1 | N/A | 3 | N/A |
| [desktop-odakyudept-look-next.png](desktop-odakyudept-look-next.png) | 6.969:1 | 0.3096 | 3 | N/A |
| [desktop-keio-walk-next.png](desktop-keio-walk-next.png) | 7.009:1 | 0.5767 | 3 | N/A |
| [desktop-keio-look-next.png](desktop-keio-look-next.png) | 7.003:1 | 0.6009 | 3 | N/A |
| [desktop-takashimaya-walk-next.png](desktop-takashimaya-walk-next.png) | 7.003:1 | N/A | 3 | N/A |
| [desktop-takashimaya-look-next.png](desktop-takashimaya-look-next.png) | 6.974:1 | 0.7310 | 3 | N/A |
| [desktop-marui-honkan-walk-next.png](desktop-marui-honkan-walk-next.png) | 6.910:1 | 0.5010 | 3 | N/A |
| [desktop-marui-honkan-look-next.png](desktop-marui-honkan-look-next.png) | 7.028:1 | 0.5709 | 3 | N/A |
| [desktop-marui-annex-walk-next.png](desktop-marui-annex-walk-next.png) | 6.884:1 | N/A | 3 | N/A |
| [desktop-marui-annex-look-next.png](desktop-marui-annex-look-next.png) | 6.970:1 | 0.2385 | 3 | N/A |
| [desktop-lumine1-walk-next.png](desktop-lumine1-walk-next.png) | 7.021:1 | 0.4935 | 3 | N/A |
| [desktop-lumine1-look-next.png](desktop-lumine1-look-next.png) | 7.006:1 | 0.5924 | 3 | N/A |
| [desktop-lumine2-walk-next.png](desktop-lumine2-walk-next.png) | 7.017:1 | 0.5658 | 3 | N/A |
| [desktop-lumine2-look-next.png](desktop-lumine2-look-next.png) | 6.971:1 | N/A | 3 | N/A |
| [desktop-lumineest-walk-next.png](desktop-lumineest-walk-next.png) | 7.029:1 | 0.2775 | 3 | N/A |
| [desktop-lumineest-look-next.png](desktop-lumineest-look-next.png) | 7.021:1 | 0.1194 | 3 | N/A |
| [desktop-newoman-walk-next.png](desktop-newoman-walk-next.png) | 6.937:1 | 0.4058 | 3 | N/A |
| [desktop-newoman-look-next.png](desktop-newoman-look-next.png) | 7.010:1 | 0.2953 | 3 | N/A |
| [desktop-isetan-honkan-walk-off.png](desktop-isetan-honkan-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-isetan-honkan-look-off.png](desktop-isetan-honkan-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-isetan-mens-walk-off.png](desktop-isetan-mens-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-isetan-mens-look-off.png](desktop-isetan-mens-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-odakyudept-walk-off.png](desktop-odakyudept-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-odakyudept-look-off.png](desktop-odakyudept-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-keio-walk-off.png](desktop-keio-walk-off.png) | N/A | N/A | 0 | 583 |
| [desktop-keio-look-off.png](desktop-keio-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-takashimaya-walk-off.png](desktop-takashimaya-walk-off.png) | N/A | N/A | 0 | 580 |
| [desktop-takashimaya-look-off.png](desktop-takashimaya-look-off.png) | N/A | N/A | 0 | 580 |
| [desktop-marui-honkan-walk-off.png](desktop-marui-honkan-walk-off.png) | N/A | N/A | 0 | 580 |
| [desktop-marui-honkan-look-off.png](desktop-marui-honkan-look-off.png) | N/A | N/A | 0 | 580 |
| [desktop-marui-annex-walk-off.png](desktop-marui-annex-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-marui-annex-look-off.png](desktop-marui-annex-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-lumine1-walk-off.png](desktop-lumine1-walk-off.png) | N/A | N/A | 0 | 1 |
| [desktop-lumine1-look-off.png](desktop-lumine1-look-off.png) | N/A | N/A | 0 | 0 |
| [desktop-lumine2-walk-off.png](desktop-lumine2-walk-off.png) | N/A | N/A | 0 | 580 |
| [desktop-lumine2-look-off.png](desktop-lumine2-look-off.png) | N/A | N/A | 0 | 579 |
| [desktop-lumineest-walk-off.png](desktop-lumineest-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-lumineest-look-off.png](desktop-lumineest-look-off.png) | N/A | N/A | 0 | 580 |
| [desktop-newoman-walk-off.png](desktop-newoman-walk-off.png) | N/A | N/A | 0 | 0 |
| [desktop-newoman-look-off.png](desktop-newoman-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-isetan-honkan-walk-next.png](phone-isetan-honkan-walk-next.png) | 7.001:1 | 0.5185 | 3 | N/A |
| [phone-isetan-honkan-look-next.png](phone-isetan-honkan-look-next.png) | 7.016:1 | 0.5436 | 3 | N/A |
| [phone-isetan-mens-walk-next.png](phone-isetan-mens-walk-next.png) | 6.985:1 | 0.4034 | 3 | N/A |
| [phone-isetan-mens-look-next.png](phone-isetan-mens-look-next.png) | 6.942:1 | 0.1137 | 3 | N/A |
| [phone-odakyudept-walk-next.png](phone-odakyudept-walk-next.png) | 6.974:1 | 0.4293 | 3 | N/A |
| [phone-odakyudept-look-next.png](phone-odakyudept-look-next.png) | 6.973:1 | 0.3515 | 3 | N/A |
| [phone-keio-walk-next.png](phone-keio-walk-next.png) | 6.995:1 | 0.6666 | 3 | N/A |
| [phone-keio-look-next.png](phone-keio-look-next.png) | 6.978:1 | 0.6089 | 3 | N/A |
| [phone-takashimaya-walk-next.png](phone-takashimaya-walk-next.png) | 7.009:1 | N/A | 3 | N/A |
| [phone-takashimaya-look-next.png](phone-takashimaya-look-next.png) | 6.992:1 | N/A | 3 | N/A |
| [phone-marui-honkan-walk-next.png](phone-marui-honkan-walk-next.png) | 7.020:1 | 0.5068 | 3 | N/A |
| [phone-marui-honkan-look-next.png](phone-marui-honkan-look-next.png) | 7.019:1 | 0.5135 | 3 | N/A |
| [phone-marui-annex-walk-next.png](phone-marui-annex-walk-next.png) | 6.956:1 | 0.4138 | 3 | N/A |
| [phone-marui-annex-look-next.png](phone-marui-annex-look-next.png) | 6.970:1 | N/A | 3 | N/A |
| [phone-lumine1-walk-next.png](phone-lumine1-walk-next.png) | 7.030:1 | N/A | 3 | N/A |
| [phone-lumine1-look-next.png](phone-lumine1-look-next.png) | 7.013:1 | 0.5489 | 3 | N/A |
| [phone-lumine2-walk-next.png](phone-lumine2-walk-next.png) | 7.014:1 | 0.6024 | 3 | N/A |
| [phone-lumine2-look-next.png](phone-lumine2-look-next.png) | 7.023:1 | N/A | 3 | N/A |
| [phone-lumineest-walk-next.png](phone-lumineest-walk-next.png) | 7.025:1 | 0.4329 | 3 | N/A |
| [phone-lumineest-look-next.png](phone-lumineest-look-next.png) | 7.021:1 | 0.1324 | 3 | N/A |
| [phone-newoman-walk-next.png](phone-newoman-walk-next.png) | 6.990:1 | 0.3910 | 3 | N/A |
| [phone-newoman-look-next.png](phone-newoman-look-next.png) | 7.008:1 | N/A | 3 | N/A |
| [phone-isetan-honkan-walk-off.png](phone-isetan-honkan-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-isetan-honkan-look-off.png](phone-isetan-honkan-look-off.png) | N/A | N/A | 0 | 140 |
| [phone-isetan-mens-walk-off.png](phone-isetan-mens-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-isetan-mens-look-off.png](phone-isetan-mens-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-odakyudept-walk-off.png](phone-odakyudept-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-odakyudept-look-off.png](phone-odakyudept-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-keio-walk-off.png](phone-keio-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-keio-look-off.png](phone-keio-look-off.png) | N/A | N/A | 0 | 140 |
| [phone-takashimaya-walk-off.png](phone-takashimaya-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-takashimaya-look-off.png](phone-takashimaya-look-off.png) | N/A | N/A | 0 | 140 |
| [phone-marui-honkan-walk-off.png](phone-marui-honkan-walk-off.png) | N/A | N/A | 0 | 140 |
| [phone-marui-honkan-look-off.png](phone-marui-honkan-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-marui-annex-walk-off.png](phone-marui-annex-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-marui-annex-look-off.png](phone-marui-annex-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-lumine1-walk-off.png](phone-lumine1-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-lumine1-look-off.png](phone-lumine1-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-lumine2-walk-off.png](phone-lumine2-walk-off.png) | N/A | N/A | 0 | 140 |
| [phone-lumine2-look-off.png](phone-lumine2-look-off.png) | N/A | N/A | 0 | 0 |
| [phone-lumineest-walk-off.png](phone-lumineest-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-lumineest-look-off.png](phone-lumineest-look-off.png) | N/A | N/A | 0 | 140 |
| [phone-newoman-walk-off.png](phone-newoman-walk-off.png) | N/A | N/A | 0 | 0 |
| [phone-newoman-look-off.png](phone-newoman-look-off.png) | N/A | N/A | 0 | 140 |
