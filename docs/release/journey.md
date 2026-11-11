# Release journey: first open → the Oedo platform

The acceptance table for the first production release (v1.0) of the Shinjuku slice, and the working method that goes with it. Owner goal (2026-11-12): a person who opens GTEki should feel they are in the station straight away.

This table is what "done" is measured against until v1.0. [acceptance.md](../acceptance.md) (G0–G4) stays the station contract and still applies; its rows are too coarse for a single PR to move, so day-to-day work is steered by the rows below. The look is decided in [direction.md](../visual/direction.md) and judged against [the hero targets](../visual/targets).

## Why this table exists

Baseline play of production (`gteki.pages.dev`, main 8b111c1f, 2026-11-12 08:27–08:37 JST, desktop 1476×996 and phone 390×844, real GPU):

- Opening the site lands on Ikebukuro: a search form over a small model on a grey field, 24 MB and about 11 s to settle. Reaching the slice takes four actions (station, from, to, start). ![first open](evidence/2026-11-12/ikebukuro-desktop-first-open-10s.jpg)
- The guided walk exit 1 → platform lasts about 160 s. About 35 s of it reads as a station (B1 concourse, gate, B3). At 6 s the camera sits inside a slab, at 14 s black stair wedges hide the cat, and both escalator rides (about 75 s together) show splayed, torn ceilings from a camera that fights the shaft. The arrival is covered by a paragraph of data notes. ![0–24 s](evidence/2026-11-12/shinjuku-walk-001-024s.jpg) ![36–84 s](evidence/2026-11-12/shinjuku-walk-036-084s.jpg) ![88–119 s](evidence/2026-11-12/shinjuku-walk-088-119s.jpg) ![128–158 s](evidence/2026-11-12/shinjuku-walk-128-158s.jpg)
- Phone: the same form on opening; in the guided walk the overlay covers 35% of the view and NPC legs hide the cat. ![phone, first open](evidence/2026-11-12/ikebukuro-phone-first-open.jpg) ![phone, walk](evidence/2026-11-12/shinjuku-phone-walk.jpg)

None of this was a failing check. The golden cameras look from fixed nodes with the UI hidden, the walk scan measures floor hits only, and no row covered what a visitor sees first. The checks sampled something other than what the player sees.

## The table

Rows are in playhead order: the time a first-time visitor reaches them. "Script" rows are judged by the journey spec in CI (not built yet: until it runs in CI, a script row is judged by hand from a play of production like the baseline above, and stays FAIL or "not judged" unless that play shows it passing); "person" rows by the art director on the journey reel, and finally by the Owner on the walk video. Times are for the guided walk at its default pace.

| # | When | What the player gets | Judged by | 2026-11-12 |
|---|---|---|---|---|
| J1 | 0–2 s | A designed first frame (title and progress), never a bare form on black | script: screenshot at 1 s | FAIL (desktop) |
| J2 | ≤ 5 s desktop, ≤ 8 s phone | Without any input: in the station as the cat, at the exit 1 mouth, stairs ahead (hero H1). Download to that frame ≤ 6 MB | script: mode, pose, time, bytes | FAIL |
| J3 | first frame | The world owns the frame: overlay ≤ 20% desktop, ≤ 30% phone, one primary action | script: DOM overlay grid | FAIL |
| J4 | first tap | One tap starts the walk and the sound | script: one click → guide mode, audio running | FAIL (4 actions) |
| J5 | whole walk | No void, no black holes, the camera never inside geometry | script: every 2.5 m with the guide camera | FAIL (6 s, 14 s) |
| J6 | whole walk | The cat is always in view | script: avatar visible in ≥ 95% of samples | FAIL |
| J7 | escalators | The ride reads as a ride: camera on the escalator axis (D2), ceiling intact | person on the reel; script: axis angle | FAIL |
| J8 | whole walk | Guidance stays quiet (D1): overlay ≤ 20% / 30%, no debug text, small markers | script: overlay and visible strings | FAIL |
| J9 | arrival | Arrival is a moment: platform and name sign in view, data notes one tap away | script: overlay at arrival; person | FAIL |
| J10 | whole walk | It looks like a Tokyo subway: hero frames H1–H4 accepted against the targets | art director, then Owner | not judged |
| J11 | whole walk | It sounds like one: ambience that changes with depth, escalator, distant train | script: audio state; person | not judged |
| J12 | whole walk | It holds frame rate: ≥ 50 fps desktop (M2), ≥ 30 fps on a mid-range phone | GPU measurement | not measured |
| J13 | always | Truth kept: "approximate, not surveyed" visible, data scope one tap away, nothing invented (D3) | person: truth review | PASS |
| J14 | always | Release hygiene: no console errors, a message when WebGL is unavailable, credits, ja and en | script | not judged |

Pass count 2026-11-12: **1 / 14**.

## Release

- Main deploys to production on every merge, so a change that alters what a first-time visitor sees ships behind a URL flag until its row is accepted, then becomes the default in the PR that flips the row.
- Release candidate: J1–J14 PASS at one SHA on desktop and phone. Evidence: the CI journey reel for the script rows, a GPU reel for J7, J10 and J12.
- v1.0: the Owner watches the candidate's walk on a phone and approves (acceptance.md G4). Tag `v1.0.0`. Breadth (other routes, Ikebukuro) resumes after that, each new route with its own copy of this table.

## Method

1. **Playhead first.** Work the earliest failing row. A defect at second 3 outranks one at second 70: every visitor sees second 3. Breakage (token-rules 24) keeps its priority and is ordered the same way.
2. **The reel is the evidence.** The journey spec (to be added as `tests/e2e/specs/30-journey.spec.ts` with its own CI job) plays the real guided walk with the real follow camera and the real UI, on desktop and phone, and writes frames, contact sheets and per-sample numbers. Still cameras stay as the technical gate; they are not evidence that the walk is good. Evidence images go in `docs/release/evidence/<date>/`, one station per file, named `ikebukuro-*` or `shinjuku-*` (the prefix selects the rights annotation in `REUSE.toml`).
3. **Every PR names its row** (`Row: J5`), or says none. A PR that changes what the player sees carries the reel sheets for its row, before and after.
4. **Verify in CI.** e2e and visual specs run in GitHub Actions (7–9 min) on the draft PR. The Mac's GPU lock is for the art director's renders. Local runs are for unit specs.
5. **Lead decides, Codex builds.** The project lead reads the reel, decides the change and writes the brief; Codex implements; the art director owns the look and accepts visual PRs on the reel. A hard problem goes diagnose (read-only) → decide → implement.
6. **Re-score daily.** The table's last column is rewritten from the newest reel on main. The lead's handoff starts with the pass count.
