# r11 affected captures — 2026-11-22 JST

PR #1512 remains draft. Ten affected next frames replace their r10 counterparts; the other 50 captures remain current. Camera poses, sign anchors and physical dimensions are unchanged apart from floating-point FOV rounding below 0.000000000001°. Capture job `depato-ikebukuro-capture-r11b` exited 0, 2026-11-22 19:42:57–19:43:49 JST. Product commit: `9226d962`.

Sunshine east-exit stippling was depth-buffer interference between the sign and its facade. Polygon depth bias removes it on desktop and phone without moving the sign. Lumine walk passes 3:1. Sunshine walk still **fails** at 2.289 / 2.327: **not ready for art-director acceptance**.

Changes affect preview landmark sign materials only: depth bias, anisotropic filtering, single application of texture alpha, and distinct shader cache variants. Global fog and exposure are unchanged. Emission remains within the existing 0.6–0.8 range. Bounded comparisons of coverage, emission, background emission and tone mapping did not establish a passing Sunshine walk material; the diagnostic variants are not committed.

All ten frames were visually inspected in a contact sheet. Sunshine east-exit crops were compared against r10: stippling is removed. Sunshine walk remains too small to read at native size: **2.6–2.8 px cap height at the approved 65.86 m horizontal-distance exception**. Actual eye-to-sign distance also includes the tower height. No sign was enlarged or moved to compensate.

## Affected measurements — 2026-11-22 JST

The r10 pixel-sampling method is unchanged. Raw poses, metrics and UTC capture timestamps: [frames.json](frames.json).

| Frame | Ja cap px | Letter contrast | ≥3:1 |
|---|---:|---:|---|
| [desktop-lumine-walk-next.png](desktop-lumine-walk-next.png) | 7.75 | 3.260 | PASS |
| [desktop-lumine-look-next.png](desktop-lumine-look-next.png) | 25.17 | 6.240 | PASS |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) | 2.77 | 2.289 | FAIL |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 27.74 | 8.708 | PASS |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | 24.85 | 7.567 | PASS |
| [phone-lumine-walk-next.png](phone-lumine-walk-next.png) | 7.26 | 3.173 | PASS |
| [phone-lumine-look-next.png](phone-lumine-look-next.png) | 19.36 | 5.320 | PASS |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) | 2.59 | 2.327 | FAIL |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 17.67 | 7.420 | PASS |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | 19.12 | 6.701 | PASS |

## Tests — 2026-11-22 JST

None requested. Capture command:

`nice -n 15 job-run --id depato-ikebukuro-capture-r11b --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r11 -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-capture-r11 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r11.mjs'`

Result: exit 0; log tail empty; ten frames saved. CI is checked separately on the pushed evidence head.

## Assumptions — 2026-11-22 JST

The diff exceeds 300 lines because it preserves ten PNGs and raw per-frame measurements. No route, station geometry, sign location or physical size changed.

## Follow-ups — 2026-11-22 JST

Keep the PR draft until Sunshine walk meets the required 3:1 bar and the lead accepts the evidence.

## Blocked — 2026-11-22 JST

Sunshine walk still fails the required contrast bar. Anisotropic filtering and bounded comparisons of coverage, emission and tone mapping did not reach 3:1 at both retained poses. The lead must route a different material solution before art-director acceptance; this report does not waive the bar.
