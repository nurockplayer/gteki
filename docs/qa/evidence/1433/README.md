# #1433 descent stop frames

Captured 2026-11-20 JST from candidate `6d4f8804` for PR #1471's art-director acceptance. Product code is unchanged from the passing regression.

The capture runs on the macOS host using ego-browser against `pnpm --filter @gteki/web dev --port 5273 --strictPort`. After the workspace install completed, restarting Vite resolved the stale scene-import failure: `sceneImportError: null`, loaded scene root `shinjuku-e27`. No container or fallback scene is used for these captures.

Browser frames use the shipped cat, production walker/camera/avatar updates at 60 Hz, the same exit-1 start and heading (174 degrees), and a 180-frame pause at walked frames 369 and 635. The viewport fills the image with the UI shell covered by the scene host. Desktop uses high quality; phone uses the actual coarse-pointer low quality. Numerical regression results in the PR remain those of the headless replay on `6d4f8804`.

| Frame | Viewport | Walked frame | Avatar elevation (m) | Camera height above cat (m) | Look-down |
| --- | --- | --- | --- | --- | --- |
| [Desktop stop 1](desktop-stop-1.png) | 960×600 | 369 | -3.738592 | 1.736855 | 21.032892° |
| [Desktop stop 2](desktop-stop-2.png) | 960×600 | 635 | -6.526123 | 1.663352 | 18.939785° |
| [Phone stop 1](phone-stop-1.png) | 412×839 | 369 | -3.738592 | 1.742880 | 27.309287° |
| [Phone stop 2](phone-stop-2.png) | 412×839 | 635 | -6.526123 | 1.659643 | 24.965961° |

Grounding remains tracked in #1472. The four images are evidence for the art director; acceptance remains outstanding and PR #1471 stays draft.
