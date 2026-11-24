# Shinjuku department-store R8 captures — 2026-11-22 JST

2026-11-22 JST: [R9 replaces the four contrast-failure views and their off pairs](../r9/README.md). This R8 table preserves the original measurements.

Captured from `2e7bbed4c1cd4e087f9c4ced0662529d7995c1a9`, 2026-11-22 19:42–19:43 JST. All 88 images were inspected: eleven stores × desktop/phone × walk/look × next/off. PR #1511 stays draft. This is a complete capture set, with the contrast failures below retained for the lead.

All 44 next frames show the whole sign; their `accepted` field means only that the pose has the whole panel in frame, at least eight glyph pixels, and more than 95% unoccluded panel coverage. It is not a contrast or overall visual-acceptance verdict. All 44 off frames omit the landmark layer and reuse the corresponding next camera; contrast, cap height, facade/sky and sign/reference are N/A when that layer is absent. Some unflagged views expose only the existing ground/sky; no claim is made that the baseline supplies equivalent store masses.

All cameras are at 1.6 m eye height. Walk pitch is 8.51–11.64 degrees, with sign distance 25.42–30.44 m. Keio now has a public-pavement walk pose at 30.44 m and 9.74 degrees in both viewports, so no Keio walk-distance exception is needed. Pavement is the rendered surface-ground outside building footprints; a road pose additionally lies inside a source road footprint. These capture poses do not add navigation routes or certify surveyed public access.

## Requested facade correction

Only Isetan Main and Odakyu facade materials were reduced, in the landmark layer, by a 0.5 multiplier on their linear albedo. Their look facade/sky luminance ratios are now:

| Store look | Desktop | Phone | Limit |
|---|---:|---:|---:|
| Isetan Main | 0.550 | 0.564 | ≤0.8 |
| Odakyu | 0.704 | 0.766 | ≤0.8 |

## Exceptions and measured failures

Look-distance exceptions (also used for their matching off frames): desktop Lumine 2, 15.86 m, capture-only road; phone Lumine 2, 20.65 m, capture-only road; phone Takashimaya, 10.64 m, rendered pavement. These are the nearest qualifying checked poses after the standard 75/100/125 m pavement look samples failed. The search samples distance in 5 m steps and view angle in 15-degree steps; it is not a continuous nearest-point proof. No walk-distance exception remains in the final set.

Four next frames remain below the shared 3:1 letter-contrast target: desktop Odakyu walk 2.88:1, desktop Keio walk 1.74:1, phone Keio walk 1.73:1, and desktop Lumine 2 look 2.83:1. Keio is visibly washed out in both walk views. These are reported failures, not a claim of visual acceptance. No sign positions, graph edges, global fog or exposure changed in R8.

## Measurement method

Read displayed framebuffer RGB, linearize to luminance, then render independent identification textures to select Japanese glyph cores and band pixels. Contrast is `(mean glyph Y + 0.05) / (mean band Y + 0.05)`. An independent flat magenta panel mask measures full-panel visibility and mean sign luminance; mipmapped text-edge colors do not determine visibility. Cap height is the Japanese glyph-mask vertical pixel extent, including perspective, at device scale 1. The source coordinates, projected corners, coverage and draw proofs are in [frames.json](frames.json). Each next view submits facade/street/sign once for its store building.

Facade/sky uses the means of the visible target facade and sky. N/A means no visible sky or no landmark layer. Sign/reference compares the mean sign luminance with an isolated rendered Exit 1 sign at the same distance and lighting; that reference does not appear in these frames. Reference ratios are telemetry, not proof of a shared-frame wayfinding hierarchy.

## Per-frame measurements

Every linked image was inspected. Flag-off rows preserve the same pitch and sign-center distance as their paired next frame; the distance is to the absent landmark sign location. “Exception” marks both the next capture and its matching off pose.

### Desktop — next — 2026-11-22 JST

| Frame | ja cap px | Contrast | Pitch up ° | Distance m | Facade/sky | Sign/reference | Pose | Inspection |
|---|---:|---:|---:|---:|---:|---:|---|---|
| [desktop-isetan-honkan-walk-next.png](desktop-isetan-honkan-walk-next.png) | 81 | 5.37:1 | 11.64 | 25.52 | N/A | 0.357 | public pavement | Whole sign |
| [desktop-isetan-honkan-look-next.png](desktop-isetan-honkan-look-next.png) | 26 | 5.77:1 | 1.36 | 75.18 | 0.550 | 0.361 | public pavement | Whole sign |
| [desktop-isetan-mens-walk-next.png](desktop-isetan-mens-walk-next.png) | 209 | 4.48:1 | 11.64 | 25.52 | 0.892 | 0.405 | public pavement | Whole sign |
| [desktop-isetan-mens-look-next.png](desktop-isetan-mens-look-next.png) | 26 | 6.29:1 | 1.36 | 75.18 | 0.488 | 0.281 | public pavement | Whole sign |
| [desktop-odakyudept-walk-next.png](desktop-odakyudept-walk-next.png) | 81 | 2.88:1 **FAIL** | 11.64 | 25.52 | N/A | 0.627 | public pavement | Whole sign |
| [desktop-odakyudept-look-next.png](desktop-odakyudept-look-next.png) | 28 | 3.04:1 | 1.36 | 75.18 | 0.704 | 0.619 | public pavement | Whole sign |
| [desktop-keio-walk-next.png](desktop-keio-walk-next.png) | 105 | 1.74:1 **FAIL** | 9.74 | 30.44 | 0.590 | 0.815 | public pavement | Whole sign |
| [desktop-keio-look-next.png](desktop-keio-look-next.png) | 29 | 5.63:1 | 1.36 | 75.18 | 0.624 | 0.381 | public pavement | Whole sign |
| [desktop-takashimaya-walk-next.png](desktop-takashimaya-walk-next.png) | 79 | 5.57:1 | 11.64 | 25.52 | N/A | 0.386 | public pavement | Whole sign |
| [desktop-takashimaya-look-next.png](desktop-takashimaya-look-next.png) | 20 | 5.97:1 | 1.36 | 75.18 | 0.759 | 0.420 | public pavement | Whole sign |
| [desktop-marui-honkan-walk-next.png](desktop-marui-honkan-walk-next.png) | 70 | 6.03:1 | 10.96 | 25.46 | 0.521 | 0.251 | public pavement | Whole sign |
| [desktop-marui-honkan-look-next.png](desktop-marui-honkan-look-next.png) | 25 | 6.29:1 | 1.24 | 75.16 | 0.598 | 0.266 | public pavement | Whole sign |
| [desktop-marui-annex-walk-next.png](desktop-marui-annex-walk-next.png) | 78 | 4.42:1 | 11.64 | 25.52 | N/A | 0.339 | public pavement | Whole sign |
| [desktop-marui-annex-look-next.png](desktop-marui-annex-look-next.png) | 25 | 5.32:1 | 1.36 | 75.18 | 0.739 | 0.301 | public pavement | Whole sign |
| [desktop-lumine1-walk-next.png](desktop-lumine1-walk-next.png) | 52 | 5.83:1 | 8.51 | 30.33 | 0.507 | 0.235 | public pavement | Whole sign |
| [desktop-lumine1-look-next.png](desktop-lumine1-look-next.png) | 15 | 6.39:1 | 1.10 | 75.13 | 0.611 | 0.236 | public pavement | Whole sign |
| [desktop-lumine2-walk-next.png](desktop-lumine2-walk-next.png) | 82 | 3.40:1 | 10.43 | 25.42 | 0.599 | 0.410 | public pavement | Whole sign |
| [desktop-lumine2-look-next.png](desktop-lumine2-look-next.png) | 125 | 2.83:1 **FAIL** | 6.75 | 15.86 | N/A | 0.532 | **EXCEPTION**; capture-only road | Whole sign |
| [desktop-lumineest-walk-next.png](desktop-lumineest-walk-next.png) | 156 | 3.81:1 | 11.64 | 25.52 | 0.800 | 0.417 | public pavement | Whole sign |
| [desktop-lumineest-look-next.png](desktop-lumineest-look-next.png) | 24 | 5.95:1 | 1.36 | 75.18 | 0.504 | 0.249 | public pavement | Whole sign |
| [desktop-newoman-walk-next.png](desktop-newoman-walk-next.png) | 84 | 5.48:1 | 11.64 | 25.52 | 0.453 | 0.270 | public pavement | Whole sign |
| [desktop-newoman-look-next.png](desktop-newoman-look-next.png) | 25 | 5.92:1 | 1.36 | 75.18 | 0.360 | 0.274 | public pavement | Whole sign |

### Desktop — flag off — 2026-11-22 JST

| Frame | ja cap px | Contrast | Pitch up ° | Distance m | Facade/sky | Sign/reference | Pose | Inspection |
|---|---:|---:|---:|---:|---:|---:|---|---|
| [desktop-isetan-honkan-walk-off.png](desktop-isetan-honkan-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-isetan-honkan-look-off.png](desktop-isetan-honkan-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-isetan-mens-walk-off.png](desktop-isetan-mens-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-isetan-mens-look-off.png](desktop-isetan-mens-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-odakyudept-walk-off.png](desktop-odakyudept-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-odakyudept-look-off.png](desktop-odakyudept-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-keio-walk-off.png](desktop-keio-walk-off.png) | N/A | N/A | 9.74 | 30.44 | N/A | N/A | public pavement | Layer absent |
| [desktop-keio-look-off.png](desktop-keio-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-takashimaya-walk-off.png](desktop-takashimaya-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-takashimaya-look-off.png](desktop-takashimaya-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-marui-honkan-walk-off.png](desktop-marui-honkan-walk-off.png) | N/A | N/A | 10.96 | 25.46 | N/A | N/A | public pavement | Layer absent |
| [desktop-marui-honkan-look-off.png](desktop-marui-honkan-look-off.png) | N/A | N/A | 1.24 | 75.16 | N/A | N/A | public pavement | Layer absent |
| [desktop-marui-annex-walk-off.png](desktop-marui-annex-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-marui-annex-look-off.png](desktop-marui-annex-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-lumine1-walk-off.png](desktop-lumine1-walk-off.png) | N/A | N/A | 8.51 | 30.33 | N/A | N/A | public pavement | Layer absent |
| [desktop-lumine1-look-off.png](desktop-lumine1-look-off.png) | N/A | N/A | 1.10 | 75.13 | N/A | N/A | public pavement | Layer absent |
| [desktop-lumine2-walk-off.png](desktop-lumine2-walk-off.png) | N/A | N/A | 10.43 | 25.42 | N/A | N/A | public pavement | Layer absent |
| [desktop-lumine2-look-off.png](desktop-lumine2-look-off.png) | N/A | N/A | 6.75 | 15.86 | N/A | N/A | **EXCEPTION**; capture-only road | Layer absent |
| [desktop-lumineest-walk-off.png](desktop-lumineest-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-lumineest-look-off.png](desktop-lumineest-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [desktop-newoman-walk-off.png](desktop-newoman-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [desktop-newoman-look-off.png](desktop-newoman-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |

### Phone — next — 2026-11-22 JST

| Frame | ja cap px | Contrast | Pitch up ° | Distance m | Facade/sky | Sign/reference | Pose | Inspection |
|---|---:|---:|---:|---:|---:|---:|---|---|
| [phone-isetan-honkan-walk-next.png](phone-isetan-honkan-walk-next.png) | 162 | 4.56:1 | 11.64 | 25.52 | 0.533 | 0.387 | public pavement | Whole sign |
| [phone-isetan-honkan-look-next.png](phone-isetan-honkan-look-next.png) | 25 | 5.78:1 | 1.36 | 75.18 | 0.564 | 0.368 | public pavement | Whole sign |
| [phone-isetan-mens-walk-next.png](phone-isetan-mens-walk-next.png) | 196 | 4.48:1 | 11.64 | 25.52 | 0.894 | 0.404 | public pavement | Whole sign |
| [phone-isetan-mens-look-next.png](phone-isetan-mens-look-next.png) | 25 | 6.28:1 | 1.36 | 75.18 | 0.481 | 0.284 | public pavement | Whole sign |
| [phone-odakyudept-walk-next.png](phone-odakyudept-walk-next.png) | 168 | 4.42:1 | 11.64 | 25.52 | 0.829 | 0.485 | public pavement | Whole sign |
| [phone-odakyudept-look-next.png](phone-odakyudept-look-next.png) | 26 | 3.04:1 | 1.36 | 75.18 | 0.766 | 0.624 | public pavement | Whole sign |
| [phone-keio-walk-next.png](phone-keio-walk-next.png) | 100 | 1.73:1 **FAIL** | 9.74 | 30.44 | 0.683 | 0.825 | public pavement | Whole sign |
| [phone-keio-look-next.png](phone-keio-look-next.png) | 28 | 5.62:1 | 1.36 | 75.18 | 0.631 | 0.386 | public pavement | Whole sign |
| [phone-takashimaya-walk-next.png](phone-takashimaya-walk-next.png) | 74 | 5.57:1 | 11.64 | 25.52 | N/A | 0.384 | public pavement | Whole sign |
| [phone-takashimaya-look-next.png](phone-takashimaya-look-next.png) | 59 | 4.04:1 | 5.82 | 10.64 | N/A | 0.471 | **EXCEPTION**; public pavement | Whole sign |
| [phone-marui-honkan-walk-next.png](phone-marui-honkan-walk-next.png) | 121 | 4.91:1 | 10.96 | 25.46 | 0.533 | 0.279 | public pavement | Whole sign |
| [phone-marui-honkan-look-next.png](phone-marui-honkan-look-next.png) | 23 | 6.28:1 | 1.24 | 75.16 | 0.542 | 0.268 | public pavement | Whole sign |
| [phone-marui-annex-walk-next.png](phone-marui-annex-walk-next.png) | 145 | 3.18:1 | 9.74 | 30.44 | 0.821 | 0.440 | public pavement | Whole sign |
| [phone-marui-annex-look-next.png](phone-marui-annex-look-next.png) | 24 | 5.32:1 | 1.36 | 75.18 | N/A | 0.304 | public pavement | Whole sign |
| [phone-lumine1-walk-next.png](phone-lumine1-walk-next.png) | 49 | 5.84:1 | 8.51 | 30.33 | N/A | 0.240 | public pavement | Whole sign |
| [phone-lumine1-look-next.png](phone-lumine1-look-next.png) | 14 | 6.37:1 | 1.10 | 75.13 | 0.568 | 0.239 | public pavement | Whole sign |
| [phone-lumine2-walk-next.png](phone-lumine2-walk-next.png) | 80 | 3.39:1 | 10.43 | 25.42 | 0.636 | 0.408 | public pavement | Whole sign |
| [phone-lumine2-look-next.png](phone-lumine2-look-next.png) | 165 | 4.76:1 | 5.07 | 20.65 | N/A | 0.338 | **EXCEPTION**; capture-only road | Whole sign |
| [phone-lumineest-walk-next.png](phone-lumineest-walk-next.png) | 141 | 3.81:1 | 11.64 | 25.52 | 1.025 | 0.415 | public pavement | Whole sign |
| [phone-lumineest-look-next.png](phone-lumineest-look-next.png) | 23 | 5.95:1 | 1.36 | 75.18 | 0.555 | 0.254 | public pavement | Whole sign |
| [phone-newoman-walk-next.png](phone-newoman-walk-next.png) | 130 | 5.71:1 | 11.64 | 25.52 | 0.436 | 0.264 | public pavement | Whole sign |
| [phone-newoman-look-next.png](phone-newoman-look-next.png) | 23 | 5.92:1 | 1.36 | 75.18 | N/A | 0.277 | public pavement | Whole sign |

### Phone — flag off — 2026-11-22 JST

| Frame | ja cap px | Contrast | Pitch up ° | Distance m | Facade/sky | Sign/reference | Pose | Inspection |
|---|---:|---:|---:|---:|---:|---:|---|---|
| [phone-isetan-honkan-walk-off.png](phone-isetan-honkan-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-isetan-honkan-look-off.png](phone-isetan-honkan-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-isetan-mens-walk-off.png](phone-isetan-mens-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-isetan-mens-look-off.png](phone-isetan-mens-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-odakyudept-walk-off.png](phone-odakyudept-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-odakyudept-look-off.png](phone-odakyudept-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-keio-walk-off.png](phone-keio-walk-off.png) | N/A | N/A | 9.74 | 30.44 | N/A | N/A | public pavement | Layer absent |
| [phone-keio-look-off.png](phone-keio-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-takashimaya-walk-off.png](phone-takashimaya-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-takashimaya-look-off.png](phone-takashimaya-look-off.png) | N/A | N/A | 5.82 | 10.64 | N/A | N/A | **EXCEPTION**; public pavement | Layer absent |
| [phone-marui-honkan-walk-off.png](phone-marui-honkan-walk-off.png) | N/A | N/A | 10.96 | 25.46 | N/A | N/A | public pavement | Layer absent |
| [phone-marui-honkan-look-off.png](phone-marui-honkan-look-off.png) | N/A | N/A | 1.24 | 75.16 | N/A | N/A | public pavement | Layer absent |
| [phone-marui-annex-walk-off.png](phone-marui-annex-walk-off.png) | N/A | N/A | 9.74 | 30.44 | N/A | N/A | public pavement | Layer absent |
| [phone-marui-annex-look-off.png](phone-marui-annex-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-lumine1-walk-off.png](phone-lumine1-walk-off.png) | N/A | N/A | 8.51 | 30.33 | N/A | N/A | public pavement | Layer absent |
| [phone-lumine1-look-off.png](phone-lumine1-look-off.png) | N/A | N/A | 1.10 | 75.13 | N/A | N/A | public pavement | Layer absent |
| [phone-lumine2-walk-off.png](phone-lumine2-walk-off.png) | N/A | N/A | 10.43 | 25.42 | N/A | N/A | public pavement | Layer absent |
| [phone-lumine2-look-off.png](phone-lumine2-look-off.png) | N/A | N/A | 5.07 | 20.65 | N/A | N/A | **EXCEPTION**; capture-only road | Layer absent |
| [phone-lumineest-walk-off.png](phone-lumineest-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-lumineest-look-off.png](phone-lumineest-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |
| [phone-newoman-walk-off.png](phone-newoman-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement | Layer absent |
| [phone-newoman-look-off.png](phone-newoman-look-off.png) | N/A | N/A | 1.36 | 75.18 | N/A | N/A | public pavement | Layer absent |

## Capture command and result

`job-run --id depato-shinjuku-r8-panel --artifact docs/visual/shinjuku-department-stores-2026-11-22/r8 -- nice -n 15 node tools/qa/depato-capture.mjs`

Exit 0. Last result line: `2026-11-22 JST: completed all desktop/phone next/off captures`. Capture server and browser task space were stopped after the run. No local test suite was run; the brief specifies CI as the check.

## CI

2026-11-22 JST: CI for the capture source commit was still queued/in progress at the live check. A green verdict is not asserted. The final evidence commit must be checked by the lead after its jobs finish; this worker does not wait or poll for CI.

## Assumptions

The expanded evidence diff exceeds 300 lines because it contains 88 PNGs and per-frame telemetry. R6/R7 remain historical evidence; failed intermediate R8 output was replaced by this final capture run. The three close look views are explicitly disclosed as distance exceptions.

## Follow-ups

Lead visual review of the four contrast failures and the three close look-distance exceptions. CI must finish green on the final pushed head before any readiness claim.
