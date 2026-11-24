# Completed r6 captures, inspected r7 — 2026-11-22 JST

PR #1512 stays draft. All 60 frames are complete: seven stores × walk/look × desktop/phone × next/off, plus four Sunshine east-exit frames. The capture job `depato-ikebukuro-capture-r6d` exited 0; its final line is `Captured 60 frames; timestamps labelled UTC in frames.json`. Captures were recorded 2026-11-22 07:48–07:50 JST from scene/capture commit `397710f304f30ccf551a76f0f8b912cb9430beef`.

I inspected every complete frame in 16 labelled contact sheets (long side ≤1600 px), and inspected sign crops. Every next frame shows the store facade and the full sign without viewport clipping or foreground occlusion. Off frames show the corresponding base context with the landmark layer absent; the Sunshine feature-77 landmark is absent in off frames. No camera replacement was needed after the successful capture job.

All 60 poses are **capture-only pose (outside walk coverage)**. They use public-road/pavement samples at eye height 1.6 m and do not establish navigable routes. `walk` is the pavement-view filename, not a gameplay traversal. The walker remains at x38 during capture. Desktop is 1440×900; phone is 390×844. Morning lighting and hidden shell/labels are used. Each next/off pair has the same eye, target and FOV. Sunshine east-exit is the nearest clear sampled road point, **20.50 m from x35**, rather than the obstructed exact exit position.

## Measured limits for the art director

These are completed evidence frames, not visual acceptance. Phone pavement Japanese cap heights are Seibu 11.98 px, Tobu 8.82 px and Sunshine 12.18 px, below 14 px. Lumine look sign/wayfinding luminance is 0.905 desktop and 0.907 phone, above 0.85. Letter/background contrast is measured as rendered, including fog and obliquity; the minimum is 1.177 on phone Lumine look. Facade ≥20% darker than surrounding context/sky was not measured by this recipe. No sign/material changes were made in this continuation.

The fallback wayfinding reference is the actual Shinjuku exit-1-nearest sign face rendered alone at the store-sign distance with a magnifying calibration FOV. All next frames use this fallback, not an in-frame wayfinding comparison. Per-frame pixels, camera parameters, road/source IDs, projected sign corners, render callbacks and ISO UTC timestamps are in [frames.json](frames.json). Callbacks count render submissions and do not independently prove visibility. Off has cap 0 and no lettering/luminance values because the landmark sign is absent.

## Per-frame measurements and required pose labels

Cap height is in CSS px; contrast is rendered letter/background ratio; luminance ratio is sign mean/reference mean. Facade/sign counts are render callbacks for that store. All next rows were visually inspected as store + full sign visible. All off rows were inspected as landmark absent.

### Desktop

| Frame | Facade/sign | Ja cap px | Contrast | Sign/reference luminance | Pose label |
|---|---:|---:|---:|---:|---|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | 2/2 | 24.33 | 8.260 | 0.125 | capture-only pose (outside walk coverage) |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 2/2 | 25.17 | 2.085 | 0.472 | capture-only pose (outside walk coverage) |
| [desktop-tobu-walk-next.png](desktop-tobu-walk-next.png) | 2/2 | 24.71 | 6.149 | 0.174 | capture-only pose (outside walk coverage) |
| [desktop-tobu-look-next.png](desktop-tobu-look-next.png) | 2/2 | 25.12 | 2.101 | 0.524 | capture-only pose (outside walk coverage) |
| [desktop-lumine-walk-next.png](desktop-lumine-walk-next.png) | 2/2 | 25.04 | 1.783 | 0.629 | capture-only pose (outside walk coverage) |
| [desktop-lumine-look-next.png](desktop-lumine-look-next.png) | 2/2 | 25.17 | 1.201 | 0.905 | capture-only pose (outside walk coverage) |
| [desktop-esola-walk-next.png](desktop-esola-walk-next.png) | 2/2 | 24.43 | 6.579 | 0.234 | capture-only pose (outside walk coverage) |
| [desktop-esola-look-next.png](desktop-esola-look-next.png) | 2/2 | 25.16 | 2.140 | 0.537 | capture-only pose (outside walk coverage) |
| [desktop-parco-walk-next.png](desktop-parco-walk-next.png) | 2/2 | 23.35 | 1.810 | 0.508 | capture-only pose (outside walk coverage) |
| [desktop-parco-look-next.png](desktop-parco-look-next.png) | 2/2 | 23.41 | 1.444 | 0.798 | capture-only pose (outside walk coverage) |
| [desktop-pparco-walk-next.png](desktop-pparco-walk-next.png) | 2/2 | 23.39 | 2.767 | 0.412 | capture-only pose (outside walk coverage) |
| [desktop-pparco-look-next.png](desktop-pparco-look-next.png) | 2/2 | 23.40 | 2.500 | 0.452 | capture-only pose (outside walk coverage) |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) | 2/2 | 24.22 | 4.155 | 0.246 | capture-only pose (outside walk coverage) |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 2/2 | 24.23 | 5.047 | 0.222 | capture-only pose (outside walk coverage) |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | 2/2 | 24.34 | 7.086 | 0.166 | capture-only pose (outside walk coverage) |
| [desktop-seibu-walk-off.png](desktop-seibu-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-seibu-look-off.png](desktop-seibu-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-walk-off.png](desktop-tobu-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-look-off.png](desktop-tobu-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-walk-off.png](desktop-lumine-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-look-off.png](desktop-lumine-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-walk-off.png](desktop-esola-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-look-off.png](desktop-esola-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-parco-walk-off.png](desktop-parco-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-parco-look-off.png](desktop-parco-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-pparco-walk-off.png](desktop-pparco-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-pparco-look-off.png](desktop-pparco-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-walk-off.png](desktop-sunshine-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-look-off.png](desktop-sunshine-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-east-exit-off.png](desktop-sunshine-east-exit-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |

### Phone

| Frame | Facade/sign | Ja cap px | Contrast | Sign/reference luminance | Pose label |
|---|---:|---:|---:|---:|---|
| [phone-seibu-walk-next.png](phone-seibu-walk-next.png) | 2/2 | 11.98 | 6.638 | 0.137 | capture-only pose (outside walk coverage) |
| [phone-seibu-look-next.png](phone-seibu-look-next.png) | 2/2 | 19.36 | 2.005 | 0.473 | capture-only pose (outside walk coverage) |
| [phone-tobu-walk-next.png](phone-tobu-walk-next.png) | 2/2 | 8.82 | 4.755 | 0.192 | capture-only pose (outside walk coverage) |
| [phone-tobu-look-next.png](phone-tobu-look-next.png) | 2/2 | 19.32 | 2.046 | 0.527 | capture-only pose (outside walk coverage) |
| [phone-lumine-walk-next.png](phone-lumine-walk-next.png) | 2/2 | 19.26 | 1.703 | 0.631 | capture-only pose (outside walk coverage) |
| [phone-lumine-look-next.png](phone-lumine-look-next.png) | 2/2 | 19.36 | 1.177 | 0.907 | capture-only pose (outside walk coverage) |
| [phone-esola-walk-next.png](phone-esola-walk-next.png) | 2/2 | 17.48 | 5.650 | 0.243 | capture-only pose (outside walk coverage) |
| [phone-esola-look-next.png](phone-esola-look-next.png) | 2/2 | 19.36 | 2.031 | 0.542 | capture-only pose (outside walk coverage) |
| [phone-parco-walk-next.png](phone-parco-walk-next.png) | 2/2 | 17.96 | 1.668 | 0.512 | capture-only pose (outside walk coverage) |
| [phone-parco-look-next.png](phone-parco-look-next.png) | 2/2 | 18.00 | 1.422 | 0.799 | capture-only pose (outside walk coverage) |
| [phone-pparco-walk-next.png](phone-pparco-walk-next.png) | 2/2 | 17.99 | 2.646 | 0.414 | capture-only pose (outside walk coverage) |
| [phone-pparco-look-next.png](phone-pparco-look-next.png) | 2/2 | 18.00 | 2.401 | 0.455 | capture-only pose (outside walk coverage) |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) | 2/2 | 12.18 | 3.462 | 0.259 | capture-only pose (outside walk coverage) |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 2/2 | 15.43 | 4.404 | 0.228 | capture-only pose (outside walk coverage) |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | 2/2 | 18.72 | 6.345 | 0.168 | capture-only pose (outside walk coverage) |
| [phone-seibu-walk-off.png](phone-seibu-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-seibu-look-off.png](phone-seibu-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-tobu-walk-off.png](phone-tobu-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-tobu-look-off.png](phone-tobu-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-lumine-walk-off.png](phone-lumine-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-lumine-look-off.png](phone-lumine-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-esola-walk-off.png](phone-esola-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-esola-look-off.png](phone-esola-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-parco-walk-off.png](phone-parco-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-parco-look-off.png](phone-parco-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-pparco-walk-off.png](phone-pparco-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-pparco-look-off.png](phone-pparco-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-walk-off.png](phone-sunshine-walk-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-look-off.png](phone-sunshine-look-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-east-exit-off.png](phone-sunshine-east-exit-off.png) | 0/0 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |

## Camera poses

Renderer coordinates `(x, elevation, z)` in metres. Eyes and targets are shared by desktop, phone, next and off; FOV is vertical degrees. The target is the sign anchor listed below. Distance is eye-to-sign slant distance; the look selection uses 60–150 m horizontal offsets (Sunshine 100.83 m horizontal, with a much higher sign). Sunshine road samples come from acquired source `plateau-13116-tran-53394577`, SHA256 `052919a57424e9a6d33edc1bbaad8e2bdea91dac33ebaeb62c032769e0b52cb2`, outside the shipped road window; no new road geometry is added.

| Store/view | Eye (m) | Target (m) | Desktop/phone FOV ° | Slant distance m |
|---|---|---|---:|---:|
| seibu/walk | (62.730, 33.846, 83.843) | (52.681, 59.151, 83.112) | 47.19 / 79.50 | 27.24 |
| seibu/look | (87.917, 33.646, 11.290) | (52.681, 59.151, 83.112) | 40.09 / 47.96 | 83.97 |
| tobu/walk | (-119.508, 34.599, -147.563) | (-107.753, 81.000, -143.324) | 19.74 / 49.12 | 48.05 |
| tobu/look | (-187.375, 34.470, -151.089) | (-107.753, 81.000, -143.324) | 33.44 / 40.22 | 92.55 |
| lumine/walk | (-237.276, 32.214, 124.979) | (-188.285, 109.500, 91.911) | 22.71 / 27.51 | 97.30 |
| lumine/look | (-186.305, 34.255, -28.072) | (-188.285, 109.500, 91.911) | 21.78 / 26.40 | 141.64 |
| esola/walk | (-180.728, 34.180, 6.137) | (-172.897, 61.500, -3.413) | 47.67 / 60.15 | 29.98 |
| esola/look | (-216.147, 33.404, 63.888) | (-172.897, 61.500, -3.413) | 39.38 / 47.14 | 84.79 |
| parco/walk | (101.339, 34.089, -238.804) | (89.229, 68.419, -156.361) | 36.52 / 43.82 | 90.12 |
| parco/look | (-0.990, 33.890, -235.485) | (89.229, 68.419, -156.361) | 27.80 / 33.58 | 124.87 |
| pparco/walk | (16.139, 34.230, -251.520) | (90.661, 50.749, -244.367) | 44.55 / 53.07 | 76.67 |
| pparco/look | (11.153, 34.113, -253.225) | (90.661, 50.749, -244.367) | 42.15 / 50.32 | 81.71 |
| sunshine/walk | (498.413, 40.982, 14.714) | (578.585, 268.000, 21.982) | 7.66 / 14.22 | 240.87 |
| sunshine/look | (478.001, 32.058, 29.086) | (578.585, 268.000, 21.982) | 8.45 / 12.42 | 256.59 |
| sunshine/east-exit | (148.182, 32.840, 1.156) | (578.585, 268.000, 21.982) | 9.86 / 12.01 | 490.90 |

## Authorized sign moves

Existing data does not identify real main-sign faces. The selected anchors use the largest sampled street-facing existing source walls with full-sign public-road sightlines. Building geometry, graph edges, sign construction and size are unchanged. Renderer coordinates, metres.

| Store | Old → rendered anchor | Why |
|---|---|---|
| seibu | (53.871, 62.000, 52.691) → (52.681, 59.151, 83.112) | Largest sampled street-facing source wall with full-sign public-road sightline; former anchor occluded. |
| lumine | (-137.195, 72.000, 74.600) → (-188.285, 109.500, 91.911) | Largest sampled street-facing source wall with full-sign public-road sightline; former anchor occluded. |
| esola | (-146.172, 74.000, 1.166) → (-172.897, 61.500, -3.413) | Largest sampled street-facing source wall with full-sign public-road sightline; former anchor occluded. |
| parco | (80.055, 65.000, -130.334) → (89.229, 68.419, -156.361) | Largest sampled street-facing source wall with full-sign public-road sightline; former anchor occluded. |
| pparco | (88.841, 70.000, -211.559) → (90.661, 50.749, -244.367) | Largest sampled street-facing source wall with full-sign public-road sightline; former anchor occluded. |

[r5 wall evidence](https://github.com/nurockplayer/gteki/blob/cx/depato-ikebukuro/docs/visual/ikebukuro-landmarks-2026-11-22/r5-moves.json) · [P’PARCO wall evidence](https://github.com/nurockplayer/gteki/blob/cx/depato-ikebukuro/docs/visual/ikebukuro-landmarks-2026-11-22/r6-moves.json) · [Sunshine road evidence](https://github.com/nurockplayer/gteki/blob/cx/depato-ikebukuro/docs/visual/ikebukuro-landmarks-2026-11-22/r6-sunshine-road-pose.json)

## Sources, route scope and rights

Seven PLATEAU-backed exteriors remain behind `?next=1`: Seibu, Tobu, Lumine, Esola, PARCO, P’PARCO and Sunshine City. Routes are provisional and terminate at nearest modeled station exits. No station-side doors or graph edges were added; door frames are waived for phase 1. Existing PLATEAU source 76/77 geometry and TP heights are retained; no facade photos, logos or copied map geometry are used. 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成。

[Source mapping, official access references and historical captures](https://github.com/nurockplayer/gteki/blob/cx/depato-ikebukuro/docs/visual/ikebukuro-landmarks-2026-11-22/README.md). Earlier r4/r5 failed capture sets remain historical, superseded by this complete r6 set.

## Tests

`Test: none`, as instructed. Capture command:

`job-run --id depato-ikebukuro-capture-r6d --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r6 -- sh -c 'ego-browser nodejs < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r4.mjs'` — exit 0. Last result: `Captured 60 frames; timestamps labelled UTC in frames.json` (2026-11-22 07:50 JST).

CI7 command after committing/pushing this evidence: `job-run --id ikebukuro-pr1512-ci7 -- rtk gh pr checks 1512 --watch --interval 30`. Result pending; earlier CI success is not claimed for this documentation commit.

## Assumptions

All sampled road poses require the approved capture-only label. The diff exceeds 300 lines because it preserves the 60-frame raw camera/pixel measurement JSON and the completed PNG set; this continuation changes no product code.

## Follow-ups

CI7 result and lead/art-director judgment of the reported visual limits. PR stays draft.

## Blocked

None.
