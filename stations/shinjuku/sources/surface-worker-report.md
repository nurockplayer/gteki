# W2 street surface — round 2 handoff, 2026-10-21

Local candidate on `claude/shinjuku-s2-w2-street`, based on `6e03c64b29633ee12b8c61c2199be71b3eb5a935`. No push, PR, merge, other worktree or main changes. The lead's server on 5282 was used throughout and left running. This report supersedes the round-1 unverified-render report.

## Changes

- `tools/import-surface.ts`, `scene/surface-data.ts`, `sources/surface-manifest.json`, `data/surface.json`, `test/surface-import.test.ts`: import four official PLATEAU 2025 tran tiles and preserve building usage/storey attributes. The existing `fetch-surface.sh` already verifies every manifest input, including the new roads; no script/dependency change was needed. Result: 529 building parts, 231 road polygons, 187,539 bytes.
- `scene/surface.ts`, new `scene/surface-materials.ts` and `scene/surface-street.ts`: road-shaped asphalt, paving/kerbs, sparse generic markings, five facade families, shopfront bands, parapets/equipment, instanced trees and lights, planters, guard rails/bollards, a procedural cloudy sky/sun, surface-local directional shading/reflections/haze, and compact signs without game instructions. Cut paving around asphalt to prevent distant depth fighting. Own GPU resources, including instance buffers, are disposed.
- `scene/surface-layout.ts`, `test/surface.test.ts`: camera visibility, top-opening occlusion, canopy side/end-wall collision, narrow supports, road/marking opening clearance, tree clearance, and disposal checks. Existing walk pads and routing JSON remain unchanged.
- Minimal `scene/build.ts` hook: surface update/setViewer delegation and removal of only the legacy floating street ceiling-light triangles. A single line in `app/src/main.ts` supplies the current camera in ENU after camera movement.
- `tools/vantages.json`: exit 2's camera moved out of geometry; exit 1's front view adjusted to the shallow pad; new eye-height `exit-1-city` and `exit-4-city` views. Original twelve QA poses remain unchanged.

## Source and rights

Official dataset: https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025

Official tran catalog API: https://api.plateauview.mlit.go.jp/datacatalog/citygml/13104?types=tran

Meshes 53394525, 53394526, 53394535 and 53394536. Dataset-specific metadata records `Licensed under CC BY 4.0`; it covers building and road layers. Exact asset URLs, hashes, byte lengths and acquisition times are in `surface-manifest.json`. Four new raw tran files total 102,983,646 bytes and remain outside the repository under `~/Developer/gteki-raw/shinjuku/plateau-bldg/`. The JSON attribution now mentions road simplification and procedural sidewalks/markings. The lead still owns adding this attribution to the app footer/coverage dialog. No third-party artwork, textures, fonts, photos, models, operator graphics or new dependencies were added.

## Verification

- `pnpm install --frozen-lockfile`: passed.
- Root `pnpm typecheck`: passed, zero errors.
- Root `pnpm test`: **309 passed, 25 files** (301 before round 2; 288 station baseline).
- `pnpm --filter @gteki/station-shinjuku build`: passed.
- `pnpm --filter @gteki/station-shinjuku import:surface --check`: byte-identical against hashed raw inputs.
- Static surface: **18 meshes, 58,564 triangles including all instances**. Facade detail uses mipmapped textures rather than individual window geometry.
- Final full default service run: 1280×720, high quality, requested crowd 24. All 19 PNGs were opened and inspected. Every exit view has voidFraction <=0.03. Exit 2's former all-grey camera is clear, fascia text is visible, asphalt no longer flickers, and floating old exit-4 ceiling strips are gone.
- Additional 390×844 / low-quality / crowd-0 captures of exit-1-arrive, exit-2-canopy-back and exit-4-city were opened. All have voidFraction 0. These are viewport checks, not physical-phone or touch-input testing.
- The service logs one HTTP 404, also present before the changes; no shader or page exceptions occurred in the completed runs. One early capture was invalidated by a simultaneous live source reload and was rerun. One root test attempt raced a filtered pnpm install and lacked the native rolldown binding; reinstalling with the frozen lockfile and running validation sequentially passed. No workaround/dependency/lockfile edit was retained.

## Latest full before/after report

Each cell is **voidFraction / calls / tris**. Before is the lead's round-1 capture preserved at `.qa/round1-6e03c64/`; after is the final `.qa/shots/report.json`. Exit 1/2 canopy cameras were adjusted, so their rows compare the reviewed views, not identical poses. Commuter positions/counts and train timing vary between captures; raw full-scene triangle deltas are not isolated surface cost.

| Vantage | Before 6e03c64 | Latest |
| --- | ---: | ---: |
| b1-gate-1 | 0.005 / 951 / 679,960 | 0.005 / 906 / 346,429 |
| b1-gate-1-reverse | 0.000 / 490 / 631,459 | 0.000 / 439 / 297,856 |
| b1-concourse | 0.106 / 232 / 477,534 | 0.166 / 181 / 143,931 |
| exit-1-street | 0.000 / 1,401 / 937,162 | 0.000 / 1,434 / 778,855 |
| exit-1-arrive | 0.000 / 149 / 331,954 | 0.001 / 149 / 226,606 |
| exit-2-street | 0.000 / 1,466 / 1,231,489 | 0.000 / 1,463 / 1,073,284 |
| b2-stairs | 0.258 / 343 / 525,541 | 0.538 / 292 / 191,938 |
| b3-hall | 0.016 / 472 / 545,863 | 0.016 / 421 / 212,260 |
| b45-escalators | 0.111 / 290 / 514,846 | 0.333 / 239 / 181,243 |
| b6-platform-train | 0.000 / 373 / 555,991 | 0.000 / 367 / 261,472 |
| b6-platform-empty | 0.003 / 523 / 672,118 | 0.006 / 568 / 393,691 |
| elevator-b1 | 0.314 / 974 / 577,441 | 0.492 / 923 / 243,838 |
| exit-1-canopy-back | 0.000 / 1,123 / 833,710 | 0.000 / 218 / 312,301 |
| exit-2-canopy-back | 0.000 / 364 / 519,046 | 0.000 / 953 / 741,571 |
| exit-3-canopy-back | 0.000 / 808 / 894,378 | 0.000 / 805 / 731,931 |
| exit-4-canopy-back | 0.005 / 802 / 894,048 | 0.013 / 799 / 731,601 |
| exit-street-oblique | 0.000 / 846 / 533,731 | 0.000 / 846 / 375,706 |
| exit-1-city | new vantage | 0.000 / 1,286 / 746,599 |
| exit-4-city | new vantage | 0.000 / 133 / 272,326 |

## Isolated GPU cost

Two high-quality runs with `--crowd 0`, same poses, temporarily forced the surface off/on. The forced-off edit was restored before the final default run and is not committed. Evidence: `.qa/control-surface-on/report.json`, `.qa/control-surface-off/report.json`, and `.qa/surface-cost.json`.

**All nine underground views: 0 extra calls and 0 extra triangles. Street views: 35–54 extra calls, below the 60-call limit.** The paired runs preceded only the final removal of legacy floating street-ceiling triangles; the measured surface geometry/materials/visibility did not change. Final default shots include that cleanup. Thus the controlled measurement isolates the blocking regression; the uncontrolled default scene still has actor/ train variation relative to the original 399914d report and cannot support a blanket ±5% total-scene claim.

| Vantage | Extra calls | Extra triangles |
| --- | ---: | ---: |
| b1-gate-1 | 0 | 0 |
| b1-gate-1-reverse | 0 | 0 |
| b1-concourse | 0 | 0 |
| exit-1-street | 54 | 175,692 |
| exit-1-arrive | 35 | 117,118 |
| exit-2-street | 51 | 175,578 |
| b2-stairs | 0 | 0 |
| b3-hall | 0 | 0 |
| b45-escalators | 0 | 0 |
| b6-platform-train | 0 | 0 |
| b6-platform-empty | 0 | 0 |
| elevator-b1 | 0 | 0 |
| exit-1-canopy-back | 51 | 175,578 |
| exit-2-canopy-back | 54 | 175,692 |
| exit-3-canopy-back | 54 | 175,692 |
| exit-4-canopy-back | 54 | 175,692 |
| exit-street-oblique | 51 | 175,578 |
| exit-1-city | 54 | 175,692 |
| exit-4-city | 54 | 175,692 |

## Deliberate simplifications (retained and added)

1. Building and road bases are flattened to symbolic z=0; source orthometric building ground heights remain recorded. No datum registration to symbolic station floors is asserted. LOD1 outlines are simplified/quantised; roofs remain flat masses.
2. The source gives road outlines, not a verified carriageway/sidewalk/lane arrangement. A 1.6 m inside margin becomes generic paving; asphalt is depressed 0.06 m, with procedural kerbs. Road construction geometry uses a 1 mm grid for stable polygon operations. Sparse lane dashes/crosswalks are generic decorations, not traffic facts or route guidance.
3. Five original facade styles are selected using height, usage-code grouping and stable variation. Office-like floor rhythm is clamped to 3.5–4 m using storey data when present. Windows, subdued lit rooms, retail bands, colours, reflections, parapets and equipment boxes are invented visual context with no real business names or equipment-count claims. Texture mipmaps reduce distant detail; no detailed source facade/roof reconstruction is claimed.
4. Four original aluminium/glass entrance canopies: roughly 2.95 m clear frame height, 0.08 m supports, side glazing/kick plates, solid back panels clipped away from graph paths, and 0.60 m fascia with 2.70 m clearance. Front overhang is 0.15 m to fit shallow landings. Signs use only the requested station/line/E27 facts and existing app exit names, with no logo or invented official exit numbers.
5. Guard rails bound the existing pads; canopy barriers use the exact same clipped segments in rendering and WalkWorld. Source masses are trimmed clear of those pads and graph corridors. Generic elevator openings remain as previously documented. No outdoor walk area or routing edge was added.
6. Trees, planters, street lights, guard rails and bollards are procedurally placed outside the walk pads. Their locations, species and counts are invented. Short tactile strips are decorative and retained only where their entire width fits on existing pad ground; they do not establish an accessible route.
7. Fixed late-afternoon sky/sun/clouds, surface-only analytic directional shading/environment reflection, and distance haze are original visual fill. No actual weather or time-of-day fact, surveyed lighting, dynamic shadows or global Three light change is implied.
8. Below-grade visibility is approximated using the top openings plus a 0.8 m approach margin. This prevents a B1 follow camera slightly above -2 m from drawing the city behind opaque ceilings. Deep underground rendering adds no surface geometry.

## Known limits / lead handoff

- Existing interior voids, indoor wall/camera collisions, commuter clustering and underground scene quality belong to the other lanes. Culling restores their existing rendering; it does not repair those gaps.
- Exit 1's source pad is too shallow for a distant frontal canopy shot; the close fascia view crops part of the sign. The model's fascia is 0.60 m high and the walk area was not enlarged to improve the screenshot.
- Free-camera captures retain the last player's floor label/elevator prompt (often B1), even while the camera is at street level. Narrow-view HUD panels/minimap obscure much of the scene. App UI remains lead/Lane C-owned.
- No manual route walkthrough, physical-phone interaction/performance, field survey or independent Oracle/Ego-lite L2 acceptance review was performed. The lead owns integration and final visual acceptance.
- No new dependency, push, PR, merge, server start or server shutdown was performed. Port 5282 remains the lead's service.
