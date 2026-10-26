---
area: e2e
owner: gteki-fa
updated: 2026-10-26 JST
---
# Browser e2e harness (tests/e2e)

## What it does
Standalone Lane F Playwright harness (@gteki/e2e, @playwright/test 1.64.1). It is not a workspace member and has its own pnpm-lock.yaml. It drives a GTEki checkout named by GTEKI_ROOT (serving built apps/web with `vite preview` on GTEKI_PORT, default 5270) or a running server named by GTEKI_BASE_URL. One worker, no retries. Chromium projects use Brave on the dev Mac (GTEKI_BROWSER overrides; never Chrome). CI=1 selects software WebGL (SwiftShader) and a 960x600 desktop screen. Specs assert DOM and HUD state, and measurement specs are observation only.

## Main files and functions
- `tests/e2e/playwright.config.ts:11-13` — port, baseURL and GTEKI_ROOT from the environment.
- `tests/e2e/playwright.config.ts:35-50` — defineConfig: testDir specs, workers 1, timeout 240 s, artifacts under artifacts/.
- `tests/e2e/playwright.config.ts:52-58` — webServer: vite preview of GTEKI_ROOT apps/web (skipped when GTEKI_BASE_URL is set).
- `tests/e2e/playwright.config.ts:60-89` — projects: desktop-chromium, phone-webkit, phone-chromium, phone-iphone15-chromium.
- `tests/e2e/lib/gteki.ts:76-86` — openStation(): opens a station URL and waits for the phase.
- `tests/e2e/lib/gteki.ts:66-73` — watch(): collects console, page errors and failed requests.
- `tests/e2e/lib/gteki.ts:99-117` — hooks: window test hooks used by specs.
- `tests/e2e/lib/gteki.ts:222-230` — stationData(): reads a station's JSON from GTEKI_ROOT for comparison.
- `tests/e2e/lib/gteki.ts:308-335` — routeWaypoints(): turns route steps into waypoints.
- `tests/e2e/lib/cues.ts:89-111` — cuesAlong(): sign, junction and fence cues along a route; `tests/e2e/lib/cues.ts:73-79` loadFences().
- `tests/e2e/lib/camera.ts:272-297` — toSample(); `tests/e2e/lib/camera.ts:357-378` summarise(); `tests/e2e/lib/camera.ts:428-448` analyseFovEase(): follow-camera metrics.
- `tests/e2e/lib/footSlide.ts:47-80` — stancePhases(); `tests/e2e/lib/footSlide.ts:108-120` summarize(): foot-slide metrics.
- `tests/e2e/lib/overview.ts:21-41` — labelBoxes(); `tests/e2e/lib/overview.ts:44` overlapPairs(): label overlap checks.
- `tests/e2e/fixtures/scenarios.json` — per-station routing scenarios (id, from, to, expect ok/fail/record, walk).
- `tests/e2e/specs/__goldens__/02-navigation.spec.ts/` — route goldens (ikebukuro-routes.json, shinjuku-routes.json).

## Data flow
- Config reads GTEKI_ROOT → serves the built apps/web → specs open each station through lib/gteki.ts openStation → the explorer reports state through hooks and the probe script → specs compare it with stationData (station JSON on disk) and the goldens.
- Output: artifacts/results.json (JSON reporter), artifacts/html (HTML report, local only), artifacts/evidence and artifacts/test-results (per-test JSON, screenshots). CI uploads only results.json, evidence JSON and test-results on failure.

## Tests CI runs
.github/workflows/e2e-smoke.yml, job e2e-smoke (ubuntu, Node 24, 20 min timeout). Triggers: pull_request with no path filter, and workflow_dispatch. Not a required check. Steps in order:
- At the repo root: `pnpm install --frozen-lockfile`, then `pnpm build`.
- In tests/e2e: `pnpm install --ignore-workspace --frozen-lockfile`, then `pnpm exec playwright install --with-deps chromium`.
- In tests/e2e with GTEKI_ROOT set to the workspace and GTEKI_GUIDE_FLOW_ONLY=1: `pnpm exec playwright test specs/01-smoke.spec.ts specs/03-guided-walkthrough.spec.ts --project=desktop-chromium --trace=off` (10 min cap).
- On failure only: upload artifacts for 7 days.
Local runs of the full suite need a real GPU for 05 and the visual specs. Run them through orb-test (`orb-test --heavy --host -- <command>` for GPU work).

## Specs (23 files in specs/; 01 and 03 run in CI)
- 01-smoke — each station opens at phone width, renders its scene and states its limits; switching stations drops the previous state. (CI)
- 02-navigation — route regression through the real explorer for both stations, checked against the goldens.
- 03-guided-walkthrough — guided walk through the "fast" tier per scenario; in CI only the UI flow, arrival is not checked. (CI)
- 04-free-walk — collision-honest free walk along a route, versus the rail-based guide.
- 05-performance — observed frame and performance numbers on this host, not a pass/fail budget; GPU only.
- 06-repros — regression tests for reported Lane F defects (e.g. Ikebukuro Exit 18 U-stair walkable both ways).
- 07-lane-apps — each station lane's own client (Shinjuku lane app, Ikebukuro lane preview), served by tools/qa/run-candidate.sh.
- 08-step-probe — re-walks each routed step alone to confirm a "blocked" free-walk result by eye.
- 09-label-fade — POI label fade probe over the CSS2D label layer.
- 10-ikebukuro-context-budget — draw-call and triangle budget for the Ikebukuro street-context layer (#110), phone tier.
- 10-look-compare — look-gap tracker against the Lane E Blender reference renders (#94).
- 11-ikebukuro-repeater-signs — screenshots and atlas-size probe of the five repeater signs (#108, #180).
- 11-overview — overview of the slice: framing, label clarity and decluttering on long guided walks.
- 12-wayfinding-cues — wayfinding cues (signs, junctions, fences) along guided legs, sampled.
- 13-follow-camera — follow-camera acceptance (#49, #70, #94, #136 lens trial).
- 13-ikebukuro-vantage-shots — vantage shots of gates, rails and street exits (#94, #181).
- 14-rail-ride — #240 JR Saikyo ride demo, Ikebukuro to Shinjuku and back, from the Ride train button.
- 15-credit-bar — the persistent credit line (#187) at 375 px in English and Japanese.
- 16-webkit-gpu-repro — minimal repro for the WebKit GPU-process spike, idle 20 s, phone-webkit.
- 17-shinjuku-sign-read — Shinjuku hanging-sign readability on the phone tier after the atlas was halved (#276, #279).
- 18-reduced-motion-lens — follow lens changes in one frame under prefers-reduced-motion (#136).
- 19-avatar-baseline — #339 F0 avatar baseline: foot slide, captures and frame time.
- 20-recognition — #342 Q5 recognition-proxy captures (OCR, proxy table).

## Pitfalls
- SwiftShader numbers are invalid for performance or visuals; CI checks flow only.
- The e2e-smoke check runs on every PR and is non-required for now (#91). Making it required needs the path-filter reasoning in the workflow comment.
- Specs 01 and 03 skip screenshots in CI (#76, #118, #246).
- Goldens (02) must be regenerated whenever route wording changes (#262, #258).
- webServer serves the root build: run `pnpm build` first, or the preview is stale. reuseExistingServer is false.
- Trace is on locally: long guided walks fill the disk (QA disk headroom is 1–4 GB). Specs 11-overview and 12 set trace off.
- Harness is not a workspace member: install with --ignore-workspace.

## Related PRs and issues
- #20 Lane F reproducible browser QA harness (origin of the suite).
- #91 non-required e2e-smoke job (01 + 03, SwiftShader).
- #76, #118, #246 CI flow-only and no screenshots in CI; #266 frame-rate independent 03 check.
- #61 Shinjuku E27 stage 2 QA fixes; #111 no_path refusal with relax (#4).
- #126 repeater signs; #180 wayfinding cues every ~30 m on B1 (#108).
- #141 acceptance harness for #94, #61, #109/#108, #49/#136.
- #320 QA tooling gaps; #340 F0 avatar baseline; #343 Q5 recognition proxy; #380 F0/Q5 follow-ups.
- #346 station identity loading card and overview (#342 Q4).
- Commits 85306867 and 6bcd1a84 regenerated the 02 goldens (no PR number in the log).
