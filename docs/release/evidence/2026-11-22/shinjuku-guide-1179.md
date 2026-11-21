# #1179 — Journey row: J8

Captured 2026-11-22 05:11 JST.

## Summary

Not reproducible on main `b99e7f0b2454fd6c9698ddab38f9a7083af9f8cd`.
The local checkout, GitHub main API and production `/version.txt` agreed on that SHA.
No application code changed; the lead can close #1179.

The quiet HUD shows a short label and an information button. Tapping the card
reveals the complete instruction, including the junction direction reported in #1179.
All 64 expanded cards matched the source instruction exactly, fit without scrolling
or ellipsis, and stayed inside the 390×844 viewport. This includes the arrival data notes.

| Mode-language | Full text matches source | Text fits | Max walking overlay | Max including arrival details | Per-step evidence |
| --- | --- | --- | --- | --- | --- |
| default-en | 16/16 | 16/16 | 10.68% | 22.92% | [shinjuku-guide-1179-default-en.json](shinjuku-guide-1179-default-en.json) |
| default-ja | 16/16 | 16/16 | 11.72% | 22.92% | [shinjuku-guide-1179-default-ja.json](shinjuku-guide-1179-default-ja.json) |
| next-en | 16/16 | 16/16 | 10.94% | 23.18% | [shinjuku-guide-1179-next-en.json](shinjuku-guide-1179-next-en.json) |
| next-ja | 16/16 | 16/16 | 11.72% | 22.92% | [shinjuku-guide-1179-next-ja.json](shinjuku-guide-1179-next-ja.json) |

## Method / Tests

`Test: none (UI; CI journey and e2e jobs are the check)`; no test suite run and no CI requested for this evidence-only result.

Browser commands: `ego-browser nodejs < /tmp/guide-card-1179-check.cjs`,
`ego-browser nodejs < /tmp/guide-card-1179-next-en.cjs`,
`ego-browser nodejs < /tmp/guide-card-1179-default-ja.cjs`, and
`ego-browser nodejs < /tmp/guide-card-1179-next-ja.cjs`; all exited 0.
Result: 64/64 full-text matches, 64/64 cards fit, maximum overlay 23.18% (limit 30%).

Opened the production cold-open page with `lang=en` / `lang=ja`,
`qaTimeBand=morning`, and with / without `next=1`. Applied Chromium mobile and
touch emulation at 390×844, started the actual exit 1 → B7 platform walk using
its primary button, paused it, and advanced through every instruction with the
existing PageDown guide control. Each card was expanded via its visible information
button. Collected source text via `__gteki.instructions()`, collapsed and expanded
rendered text, client/scroll dimensions and viewport/card bounds. The overlay
calculation is the existing reel's 24×16 elementFromPoint sampling algorithm from
`tests/e2e/specs/30-journey.spec.ts`. Frames use the real scene and HUD.

## Phone frames

- [Reported junction direction, English step 5](shinjuku-guide-1179-default-en-step-5.jpg)
- [Longest walking direction, English step 13](shinjuku-guide-1179-default-en-step-13.jpg)
- [Japanese step 13](shinjuku-guide-1179-default-ja-step-13.jpg)
- [English arrival with full details open](shinjuku-guide-1179-default-en-step-16.jpg)

## Assumptions

- The existing tap-to-expand card satisfies the issue's “readable some other way” acceptance.
- Index 0 is the route's “Start” marker; the walk begins at displayed instruction 1. Evidence covers all displayed instructions 1–16, including arrival.
- This checks each instruction using the existing guide jump control; it is not a continuous journey reel or a physical phone run.

## Follow-ups

Lead: close #1179 using this evidence. No fix PR required by the not-reproducible branch of the brief.

## Blocked

none
