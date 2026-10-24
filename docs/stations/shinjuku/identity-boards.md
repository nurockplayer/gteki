# Shinjuku identity boards — #342 Q1a

Status: **CPU recognition proxy only**, 2026-10-24. GPU capture / 3-of-5-second visibility, POI-chip avoidance (Q2), and recognition by viewers remain pending. This is an original GTEki design, not operator signage.

## Content and provenance

The plate reads 新宿, しんじゅく, Shinjuku, and plain `E27  都営大江戸線`. The restrained magenta mark uses `OEDO_MAGENTA`: **GTEki-defined, not official** (OD-29). The line name always accompanies the colour. No operator badge, station-code ring, logo, image or sign artwork is used; the canvas is drawn procedurally.

The existing station record (`stations/shinjuku/gteki/station.json`) records operator `toei`, station code `E27`, and the Japanese/English station and line names. The platform alias and names are traced in [search-expected.md](search-expected.md). The existing non-JR source for the Shinjuku / Toei Oedo Line identity is [MLIT ほこナビ's station dataset](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45), dataset date **2026-09-17**, acquired **2026-10-20T10:45:52Z**, recorded in the station source records and `stations/shinjuku/sources/manifest.json`.

**Names on the plate.**

- 「新宿」 appears in the MLIT ほこナビ record title 「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」 (`metadata_modified` 2026-09-17) and in OSM node 2389826024 (`name:ja=新宿`).
- 「Shinjuku」 is OSM `name:en` / `name:ja_rm` on that node.
- The short line name 「都営大江戸線」 on the plate is the form used by OSM route relation 3355612 v112 (`name=都営大江戸線 : 光が丘→都庁前`). The MLIT title gives the full form 「都営地下鉄大江戸線」.
- 「しんじゅく」 is the standard kana reading of 新宿. It is the station record's existing `ja-Hrkt` search alias (`poi:platform:oedo`, see [search-expected.md](search-expected.md)) and agrees with the romanisation `Shinjuku` above.

**E27 as the station number.** The MLIT record does **not** carry the station number: a search of the acquired `dataset.json`, both GeoJSON archives and the PDF text found no `E27` (2026-10-24). In this repo, `E27` names the slice and the station record; it is not evidence. Per the director's #342 ruling 2 (a Toei code, so the non-JR condition is met), the number is read back from **OpenStreetMap**: stop_area relation [7929876](https://www.openstreetmap.org/relation/7929876), version 28 (last edited 2025-08-24T09:32:57Z), `name=新宿 (都営地下鉄大江戸線)`, `public_transport=stop_area`, `network=都営地下鉄`, **`ref=E27`**. It was retrieved from `https://api.openstreetmap.org/api/0.6/node/2389826024/relations.json` on 2026-10-23T15:49Z (2026-10-24 JST). Node 2389826024 is the `railway=station` 新宿 / Shinjuku, operator 東京都交通局. Only the plain name and `ref` tags quoted on this page are used; no geometry or other OSM data. Map data © OpenStreetMap contributors, ODbL 1.0 (<https://www.openstreetmap.org/copyright>). Toei's own station list, <https://www.kotsu.metro.tokyo.jp/eng/subway_stations/> (a plain fact under OD-01 A), is the corroboration: read in a browser (ego-lite) on 2026-10-24T12:36+09:00, its Oedo Line list reads **「E27 Shinjuku」** (between E26 Yoyogi and E28 Tochomae). Scripted fetches get a bot-protection page, so the check was done in a browser. The E27 dataset's licence remains unconfirmed under the existing Owner #16 override; this work does not change that disposition.

No font is bundled. `IDENTITY_FONT_STACK` in `scene/textures.ts` is the single Q0 switch point/TODO and reuses the existing Hiragino Sans / Noto Sans JP / Yu Gothic / sans-serif stack.

## Placement and Explorer contract

`scene/spawn.ts` extracts the lane app's existing normal spawn calculation without changing it: first gate connector, four metres back from the gate display position if ground exists, facing that display position. Both the app and the identity builder call it. The spawn board starts 0.9 m ahead of that player position and faces the approach. Each ticket-gate POI selects the nearest same-height `layout.gates` line; its unpaid connector determines the front direction. Boards have a second outward face with unmirrored text for paid-side reading.

Anchors come entirely from bundle POIs/nodes and the layout. Casing top is `min(floor + 3.0, level.ceilingZ - 0.12) + 0.02`; the plate is 1.72 × 0.86 m. A deterministic, bounded search of small along/lateral offsets avoids wall and roof intersections, including the narrow normal-spawn approach. On this bundle, the four spawn/gate boards preserve at least 2.1 m headroom and 0.08 m roof clearance. Hangers terminate at the ceiling. Positions are original visual placement, not surveyed sign locations; no routing or collision geometry is added.

The spawn/gate board groups are `identity:spawn` and `identity:gate:<poiId>`, exposed separately as `BuiltStation.identityBoards`; `BuiltStation.signs` contains wayfinding groups only. Each front and its `:back` child expose `userData.gteki_identity` with local front `[0,0,1]` and a local `name` box enclosing the complete Japanese/kana/English block. Transform these using `matrixWorld`. The name region excludes the footer. Every tagged group sets `userData.generated = "GTEki station identity board (original design; not operator signage)"`. Actual faces are batched in `identity-faces` with sign role; metadata groups deliberately remain independently addressable. Faces, cases and rods bake the board's local matrix because the merged meshes share its parent; back metadata world matrices are current when the builder returns. See the additive [core contract](../../core/contract.md).

## Platform placement — director / lead ruling, 2026-10-24

There is **one board near the platform access point, hung across the platform at its transverse centre; a GTEki placement, not surveyed**. The anchor is `poi:platform:oedo`'s connector (chip 2) on B6, not a surveyed sign location. The slab's longest vertex pair defines the track direction; the board plane is perpendicular to it, with its front toward the access point and a readable back toward the far end. This follows the director's one-board placement ruling and the lead's corrected orientation ruling.

CPU tests qualify the placement with a bounded search of 8–18 m from the connector's long-axis projection in 0.5 m steps toward the slab midpoint, then away. They accept the first candidate with clear opaque-geometry sightline to the name-box centre, facing dot ≥0.5, 4–20 m viewing distance, wall/roof clearance, ≥2.3 m casing headroom and ≥0.12 m ceiling clearance. The conservative casing rectangle must be wholly inside the platform slab (including holes); tests also check casing and hangers against static and instanced visible geometry, including glass screen-door parts and ceiling fixtures. The first qualifying position is 8 m away from the midpoint; all 21 candidates toward it fail.

Runtime derives only this data-relative `PLATFORM_IDENTITY_SLOT` from the connector and slab axes, then checks its sightline, facing/distance, wall/roof clearance, footprint and headroom. It does not run the ordered search or hardware intersection scans. Missing placement data or a failed check warns once and skips the platform board, so this display-only placement cannot abort the station build.

The extra group is `identity:platform:poi:platform:oedo`, with the same identity contract, original artwork, shared texture, two merged meshes and near-camera fade. Its front and readable back carry `userData.placement = "GTEki wayfinding placement; not surveyed, not a replica of the on-site sign"`; spawn/gate faces also describe their GTEki placement. This display-only placement is not route or position evidence. It changes no POI, graph, search or station data. Adding the board costs **zero additional draw calls or texture bytes**, 64 triangles and 5,632 geometry bytes in either tier; the earlier cost table below records the original spawn/gate addition.

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

All ten identity faces share one dedicated texture, `GTEki Shinjuku identity (original design)`. A dedicated reusable image is cheaper than enlarging a 3120-pixel-wide atlas shelf by the identity image's height; storing repeated identity faces in the existing atlas would cost more again. Existing wayfinding atlas content, UVs, face counts and pages remain unchanged: high `3120×3872`, `3120×2000`; low `1560×1936`, `1560×1000`.

| Tier | Identity texture | GPU bytes delta (RGBA8 + 4/3 mip estimate) | Total texture bytes before → after | Static mesh/material submissions before → after |
| --- | --- | ---: | ---: | ---: |
| low | 512×256 | 699,050.67 (0.667 MiB) | 125,440,341.33 → 126,139,392 | 138 → 139 |
| high | 1024×512 | 2,796,202.67 (2.667 MiB) | 198,722,901.33 → 201,519,104 | 138 → 139 |

Memory is measured with `test/helpers/texture-memory.ts`, counting shared objects once. The one added face batch contributes 16 triangles; four cases add 48 triangles to the existing case batch, and eight six-sided hangers add 192 triangles to the existing rod batch. **+1 potential draw call** in both tiers, subject to view culling; no GPU draw-call benchmark was run. `sign-batches.test.ts` checks every group in the wayfinding-only `BuiltStation.signs` array against the original atlas counts, with no identity filter.

The scene digest is regenerated by `test/helpers/scene-digest-fixture.ts`; only visual/semantic sign entries change. Collision, walkable, camera-blocker, walls, spawn, station-layout and fare-protection fields remain byte-identical to the prior fixture. Exact digest changes and commands/results are in the worker report.

To prevent giant text/casing at camera crossings, both identity-owned meshes (faces and merged cases/rods) use an opaque 4×4 screen-door discard, with depth writes retained, in either viewer without app changes.
`IDENTITY_FADE_NEAR = 1.6 m` hides every fragment up close; `IDENTITY_FADE_FAR = 3.0 m` restores full coverage using smoothstep of fragment view-space distance. Normal-spawn name boxes stay beyond FAR in every proxy viewport.
The hardware mesh preserves case/rod colours and metalness with vertex attributes: +1 potential draw call over Q1a in either tier, zero triangle/texture-byte delta; the earlier table describes the pre-fade Q1a addition.
