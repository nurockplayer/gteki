# Shinjuku identity boards — #342 Q1a

Status: **CPU recognition proxy only**, 2026-10-24. GPU capture / 3-of-5-second visibility, POI-chip avoidance (Q2), and recognition by viewers remain pending. This is an original GTEki design, not operator signage.

## Content and provenance

The plate reads 新宿, しんじゅく, Shinjuku, and plain `E27  都営大江戸線`. The restrained magenta mark uses `OEDO_MAGENTA`: **GTEki-defined, not official** (OD-29). The line name always accompanies the colour. No operator badge, station-code ring, logo, image or sign artwork is used; the canvas is drawn procedurally.

The existing station record (`stations/shinjuku/gteki/station.json`) records operator `toei`, station code `E27`, and the Japanese/English station and line names. The platform alias and names are traced in [search-expected.md](search-expected.md). The existing non-JR source for the Shinjuku / Toei Oedo Line identity is [MLIT ほこナビ's station dataset](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45), dataset date **2026-09-17**, acquired **2026-10-20T10:45:52Z**, recorded in the station source records and `stations/shinjuku/sources/manifest.json`.

**E27 as the station number: a recorded public source URL plus dated confirmation explicitly supporting that code was not found.** The existing station code is reused, but the catalogue's line/station title alone is not proof of the number. The lead must resolve this #342 ruling-2 evidence gap before treating the code as independently sourced. No new URL or fact has been fabricated; no website was contacted for research in this task. The E27 dataset's licence remains unconfirmed under the existing Owner #16 override; this work does not change that disposition.

No font is bundled. `IDENTITY_FONT_STACK` in `scene/textures.ts` is the single Q0 switch point/TODO and reuses the existing Hiragino Sans / Noto Sans JP / Yu Gothic / sans-serif stack.

## Placement and Explorer contract

`scene/spawn.ts` extracts the lane app's existing normal spawn calculation without changing it: first gate connector, four metres back from the gate display position if ground exists, facing that display position. Both the app and the identity builder call it. The spawn board starts 0.9 m ahead of that player position and faces the approach. Each ticket-gate POI selects the nearest same-height `layout.gates` line; its unpaid connector determines the front direction. Boards have a second outward face with unmirrored text for paid-side reading.

Anchors come entirely from bundle POIs/nodes and the layout. Casing top is `min(floor + 3.0, level.ceilingZ - 0.12) + 0.02`; the plate is 1.72 × 0.86 m. A deterministic, bounded search of small along/lateral offsets avoids wall and roof intersections, including the narrow normal-spawn approach. On this bundle, all four boards preserve at least 2.1 m headroom and 0.08 m roof clearance. Hangers terminate at the ceiling. Positions are original visual placement, not surveyed sign locations; no routing or collision geometry is added.

The four board groups are `identity:spawn` and `identity:gate:<poiId>`. Each front and its `:back` child expose `userData.gteki_identity` with local front `[0,0,1]` and a local `name` box enclosing the complete Japanese/kana/English block. Transform these using `matrixWorld`. The name region excludes the footer. Every tagged group sets `userData.generated = "GTEki station identity board (original design; not operator signage)"`. Actual faces are batched in `identity-faces` with sign role; metadata groups deliberately remain independently addressable. See the additive [core contract](../../core/contract.md).

## Deterministic readability proxy

`app/src/spawn-view.ts` shares the normal third-person camera constants and architecture-only collision environment with the lane app: PerspectiveCamera 62°, near 0.05, anchor 1.1 m above the player, boom 3.6 m, idle pitch −0.18 − 0.10 rad, look-ahead 1.15 m and look-rise 0.15 m. The test instantiates `Player`, calls the actual camera-boom collision function, and projects local glyph boxes. CPU rays also reach samples of both name glyph blocks with the identity face as their first opaque static-geometry hit. It also verifies that the spawn front normal faces this camera and the complete name region is inside each viewport.

The canvas draws JA at 184 px and English at 112 px on a 1024 × 512 design space. Conservative font-dependent **ink/cap-height assumptions** are 0.80 em for Japanese and 0.72 em for Latin capitals: 147.2 and 80.64 design pixels, or 0.24725 and 0.13545 m. These are explicitly assumptions about the drawn glyphs, not a measurement of a platform fallback font and not the board/line-box height. The proxy uses the minimum same-depth vertical-edge height, so box width/depth cannot inflate the result. Q0's pinned font and later GPU captures must verify actual raster legibility.

| CSS viewport | 新宿 cap/ink height | Shinjuku cap height | Complete name inside frame |
| --- | ---: | ---: | --- |
| iPhone 15 393×852 | 43.55 px | 23.05 px | yes |
| Pixel 7 412×915 | 46.77 px | 24.76 px | yes |
| Desktop 1440×900 | 46.00 px | 24.35 px | yes |
| Desktop 960×600 | 30.67 px | 16.24 px | yes |

Thresholds: Japanese ≥18 CSS px; English ≥12 CSS px. These geometry results are the same at both texture tiers; they do not measure low-tier sampling or prove GPU readability / unobscured time.

## Texture and draw cost

All eight identity faces share one dedicated texture, `GTEki Shinjuku identity (original design)`. A dedicated reusable image is cheaper than enlarging a 3120-pixel-wide atlas shelf by the identity image's height; storing repeated identity faces in the existing atlas would cost more again. Existing wayfinding atlas content, UVs, face counts and pages remain unchanged: high `3120×3872`, `3120×2000`; low `1560×1936`, `1560×1000`.

| Tier | Identity texture | GPU bytes delta (RGBA8 + 4/3 mip estimate) | Total texture bytes before → after | Static mesh/material submissions before → after |
| --- | --- | ---: | ---: | ---: |
| low | 512×256 | 699,050.67 (0.667 MiB) | 125,440,341.33 → 126,139,392 | 138 → 139 |
| high | 1024×512 | 2,796,202.67 (2.667 MiB) | 198,722,901.33 → 201,519,104 | 138 → 139 |

Memory is measured with `test/helpers/texture-memory.ts`, counting shared objects once. The one added face batch contributes 16 triangles; four cases add 48 triangles to the existing case batch, and eight six-sided hangers add 192 triangles to the existing rod batch. **+1 potential draw call** in both tiers, subject to view culling; no GPU draw-call benchmark was run. `sign-batches.test.ts` still checks the original wayfinding groups/atlases; it now explicitly filters `sign:` groups because `BuiltStation.signs` also includes identity groups.

The scene digest is regenerated by `test/helpers/scene-digest-fixture.ts`; only visual/semantic sign entries change. Collision, walkable, camera-blocker, walls, spawn, station-layout and fare-protection fields remain byte-identical to the prior fixture. Exact digest changes and commands/results are in the worker report.
