# Shinjuku exterior finish — 2026-11-24 JST

Package C, Refs #1528, stacked on #1511. The change remains behind `?next=1`.

The preview uses visible procedural floor joints at 4.5 m and piers at 7 m, with a per-floor spandrel on the glazed facade. Closed street glazing follows the actual LOD2 wall spans, with bronze mullions of 0.18 m depth and warm light at emissive intensity 0.5. Regular glazing bays target 3 m; short wall spans use one terminal bay. Isetan Men's, Odakyu, Marui Annex and Lumine Est use the shared dark bronze swatch. All plain name bands use the unlit atlas to retain text contrast; the English name is “Isetan Men's”.

## Capture

Replay all 44 original R8 next poses and their 44 matching off poses, at desktop 1440×900 and phone 390×844. The existing close road-view exceptions are retained. Each row in `frames.json` records its source SHA, viewport, camera, image hash, rendered contrast, facade/sky ratio, draw calls and texture dimensions. Off rows also record the R8 golden hash and exact PNG equality. An absent visible sky is reported as N/A.

`job-run --id depato-shinjuku-finish-r10 --artifact docs/visual/shinjuku-department-stores-2026-11-22/r10 -- tachi-run --heavy --host --est 15m -- nice -n 15 node tools/qa/depato-capture.mjs`

2026-11-24 JST: capture pending the detached GPU job. Measurements and committed frames will be reported on resume. Art acceptance and default flip remain with the lead/art director.

## Tests

`tachi-run -- pnpm exec vitest run stations/shinjuku/test/data-files.test.ts stations/shinjuku/test/surface.test.ts --maxWorkers=1`

2026-11-24 03:52 JST: exit 0; `Test Files 2 passed (2)`, `Tests 36 passed (36)`; last result line `tachi-run: end 2026-11-24 03:52 JST`.
