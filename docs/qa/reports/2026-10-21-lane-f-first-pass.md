# Lane F independent QA — first pass (2026-10-21)

**Reviewer:** Lane F ([#12](https://github.com/nurockplayer/gteki/issues/12)), Claude Opus 5.5, read-only towards product code. This report feeds [#6](https://github.com/nurockplayer/gteki/issues/6). **It does not accept anything.** All verdicts below are evidence for the Owner's decision. Passing automated checks is not counted as L2 acceptance anywhere in this report.

## 0. Update: pass 2 (2026-10-21, candidate `b511263`)

Sections 1–10 are the first pass and are kept as written. This section supersedes their verdicts where it says so.

**Run:**
- **Candidate:** `b5112635`, which is #61 head `2784dea` (Shinjuku stage 2) plus core #56 `e6636ef` (camera blockers) on main `c2b5a9b`. 0 dirty files.
- **Build:** frozen lockfile, root typecheck pass, unit 708/708.
- **Harness:** `5e0f4fb` (#67). Brave 155 for both Chromium projects, Playwright 1.64.1, workers 1, traces off.
- **Result:** 56 passed, 1 skipped (opt-in `08`), 25.8 min. Step probes S1 (23 steps) and S2 (31 steps): worst miss 0.74 m, worst |dz| 0.35 m.
- **Host:** an OrbStack test-box replay (2.5 GB / 2 CPU cap) ran alongside, under the memory gate (42–57 % free, 0 swapouts).
- **Baseline:** main `c2b5a9b` with harness `b978bcd`, before #67: 44 passed, 6 failed. Two failures were intended narration changes, now re-baselined; three were a toast-matcher bug after #21, now fixed; one was B8.

| Item | Pass-2 verdict | Evidence (`b511263`) |
|---|---|---|
| B1 guide camera above slabs | **PASS** | exit1→platform frames are interior views under lit ceilings |
| B2 black voids on descents | **PASS** | Near-black per frame: desktop max 0.061 (main 0.686), phones max 0.003. No clipped white |
| B3 north switchback | **PASS** | S1 probe |
| B4 overview draw calls | **PASS** (improved) | 279 desktop / 127 phone (main 913 / 314) |
| B7 second walkable surface | **PASS** | No S2 probe step ends more than 0.35 m off its display height |
| B8 B3 containment | **PASS** | The end point lies 15.4 m from the network, inside unrestricted GSI space B021 (z −23.74). The end frame shows a drawn wall. `04` now accepts a mapped space as an alternative to network distance |
| C1 labels above UI | **PASS** (#30 on main) | Phone search passes on both phone projects |
| C3 camera (Shinjuku) | **GAP** P2 | On the exit:2 street stair the camera presses against the avatar (`platform-exit2-10`) |
| C6 route line x-ray | **GAP** P2 | Unchanged |
| C8 toast over HUD pill | **GAP** P3, tracked as [#66](https://github.com/nurockplayer/gteki/issues/66) | Every arrival frame |
| Label fade (`09`, new) | **PASS** (spot-checked) | FADED anchors sit behind signs and walls; one ambiguous at the far colonnade. After the #67 Codex review, `09` separates selected endpoints faded for being off-floor (8 of the 20 fades on a Shinjuku desktop rerun) and draws the anchor at the rect centre, the true CSS2D anchor. The red occlusion fades still sit behind drawn geometry |
| Exit-top daylight | **PASS** | Only at the exit:2 and exit:4 street tops |
| Perf | **PASS / watch** | 60 fps desktop and Pixel 7. iPhone 15 emulation, Shinjuku walk: 40.2 fps (main 59.4) with the replay running; to be rerun on an idle host |

**Summary of pass 2:**
- **Shinjuku (`b511263`):** G1 **PASS** for the tested slice. G3 moves from FAIL to **GAP** (C3 residual, C6). It is the first Shinjuku candidate whose guided walks read as an enclosed, lit station on emulation.
- **Ikebukuro on main:** after Lane G (#54), walls, columns and ceilings read bright. Near-black max is 0.047 on main.
- **Exit 35 stairs, one transient frame:** in the full run, `ikebukuro-walk-jrc2-exit35-07` showed the camera above the stair cover (near-black 0.202). It did not recur in a rerun and two dense sweeps (about 266 frames each), nor on main. `sceneInfo()` reports 0 camera blockers on Ikebukuro, so it is not attributed to #56.
- **Still open:** no physical phone, no Astra review this pass, and the Owner holds G0/G4.

## 1. What was tested (exact code)

Both candidates were built with [`tools/qa/run-candidate.sh`](../../../tools/qa/run-candidate.sh) as local, unpushed integration worktrees. Neither is a merge of any PR on GitHub.

| | Baseline run | Latest-heads run |
|---|---|---|
| Candidate SHA (local) | `39ae3fb` | `a5a555c` |
| Shared core #15 | `d2508b8` (via #16) | `fb0ca14` (via #16) |
| Shinjuku #16 | `3926ada` | `563d83c` |
| Ikebukuro #14 | `6e361d6` | `08d4668` |
| Local commits | `.gitignore` union; `pnpm-lock.yaml` importer for `stations/ikebukuro` (missing in #14) | `.gitignore` union only |
| Lockfile | frozen (after the local fix) | **out-of-date** at the committed heads: the first latest-heads run (17:13 UTC) failed `--frozen-lockfile` and installed non-frozen. The desktop rerun (17:20 UTC, `QA_REUSE=1`) therefore ran on a candidate whose `pnpm-lock.yaml` had been locally repaired (31 added lines, the `stations/ikebukuro` importer; `candidateDirtyFiles: 1`) |
| Typecheck / vitest / build | pass / 289 pass / ok | pass / 308 pass / ok |
| Harness | `829ff51` (+ reruns on `d1ce594`) | `2d104d3` (repro `9d6a444`, probe `fd1f5b1`) |
| Stage 2 (Shinjuku only) | | `2101993` `claude/shinjuku-e27-l2-stage2` (contains #16 `563d83c`, #15 `fb0ca14`): frozen lockfile, typecheck/vitest pass |
| Run date (UTC) | 2026-10-20 16:47 | 2026-10-20 17:13 (aborted: disk full), desktop rerun 17:20, phone after it |

Host: MacBook Pro M2 Pro, 16 GB, macOS 27.0, Node 26.10.0, pnpm 12.11.2, Playwright 1.64.1 (Chromium 1248, WebKit 2370). The probe recorded the WebGL renderer as `ANGLE Metal Renderer: Apple M2 Pro` in every desktop performance window, so these are real-GPU measurements, not SwiftShader.

Note on the baseline manifest: it was written by harness `829ff51`, which recorded the *current remote* SHA of each ref rather than what the worktree contained (the PRs moved during the run). The SHAs in the table above come from `git log` in the candidate. `d1ce594` fixed this: each ref is now recorded with a contained / NOT-contained check.

After the latest-heads run started, #14 moved to `dae892a`. Its three new commits touch only `stations/ikebukuro/pipeline/build_signage.py` and `scene/signage.json`, so the collision and route findings below still apply to it. Signage was not re-reviewed at `dae892a`.

## 2. Inputs: real vs simulated

| Area | How it was driven |
|---|---|
| Search, route card, Start guide, HUD speed, view toggle | Real browser clicks and typing |
| Guided walk | Real-time playback at ×4, with a frame captured every 3 s (desktop) or 4 s (phone) and a `.webm` recording of each test |
| Free walk | Real mouse-look drags plus `W` through the explorer's own 60 Hz `simulate()` step, using the same `stepWalk` collision code as the keyboard |
| Lifts | Not walkable in the explorer. The autopilot jumps to the far node and logs `lift-ride-simulated` |
| Phone | Playwright emulation (iPhone 15 on WebKit, Pixel 7 on Chromium, both with touch). **No physical device was used.** Physical-device checks remain a GAP |
| Sound | Not assessed: headless capture has no audio review |

## 3. Verdict matrix (G0–G4)

Scope: the bounded slices each lane ships today, opened in the **shared explorer** (`apps/web`), which is the product entry point. Lane clients are secondary evidence (§4.4).

| Gate | Shared core (#15 `fb0ca14`) | Ikebukuro (#14 `08d4668`) | Shinjuku (#16 `563d83c`; stage 2 `2101993` noted) |
|---|---|---|---|
| **G0** Sources / rights | — (no station data) | **GAP**: PLATEAU CC BY 4.0 attribution and derivation are recorded; Lane F has not yet audited every shipped GLB/texture against the manifest | **HOLD**: PDL 1.0 attribution is present, but reuse after 2027-03-12 is unresolved (Owner decision) |
| **G1** Geometry / collision | **FAIL**: the third-person camera clips pillars, because its ray ignores the 2D `walls`. Guided travel in Shinjuku views from above the slabs | **PASS** for collision and traversal of the tested slice: 6/6 verified routes walked under collision with no block, no recovery and no off-surface height, and the wall probe keeps the walker contained from every spawn (inside the scene bounds and at most 12.3 m from a walkable edge on its level; 30 s runs of 0.8–18.7 m). Camera clipping is counted under the shared core. The Exit 18 barrier was **FAIL at `6e361d6`, fixed at `08d4668`** (repro) | **FAIL** at `563d83c`: walking the north switchback's lower flight along its network line stops 4.49 m short against a railing (B3). Also at (−52.3, 145.7) the walker stands 1.2 m above a flat m1 edge (B7). A 30 s run north from the B6 platform rides up to B3 and ends 15.4 m from any B3 edge; containment there is unconfirmed (B8). S2 and S3 walk uninterrupted. S1 completes only with one autopilot recovery at the upper flight, on both SHAs; that flight walks straight from its own node. S4 includes 3 simulated lift rides. At stage 2 the lower flight probes clean (G1 not re-judged until B7 and the S1 approach are resolved) |
| **G2** Routing | **PASS** for routing semantics: goldens are stable across both runs, all fail-closed cases are correct, the deep link restores the route. Real-world access conditions are not field-verified; the in-app banner says so | **PASS** (7 routes + 5 negative cases). One narration check is open (I1 "stairs down … stairs up") | **PASS** for routing semantics (4 routes + 5 refusals, incl. the paid boundary and step-free). Narration is fragmented (21 lines for 193 m) |
| **G3** Quality (L2) | **FAIL**: labels paint over the UI and take taps on phone; the HUD speed display is false; the camera clips | **FAIL**: blown-out exits and destinations (A3) are a demonstrated L2 defect. Otherwise the station reads as a station: enclosed passages, columns, exit-number signage | **FAIL**: during guided B1 travel the camera sits inside or above slabs (still true at stage 2 in the shared explorer); voids are exposed along the escalators |
| **G4** Delivery | **GAP**: no CI job runs the browser suite (GPU host needed); phone is emulation only. **HOLD**: Owner approval | **FAIL**: `pnpm install --frozen-lockfile` fails, because `pnpm-lock.yaml` lacks the `stations/ikebukuro` importer (still at `08d4668`) | **GAP**: the frozen install passes at stage 2; stage 2 is not yet in #16 |

Other areas:
- **Godot:** **GAP**. Not exercised by Lane F. The candidate has no Godot client in the test path, and #17's kit was not run.
- **Physical phones:** **GAP**. Only emulation was run (§4.5).

## 4. Findings

Severity: **P0** blocks a user task. **P1** fails the gate. **P2** is an L2 quality gap. **P3** is polish or testability. All coordinates are station-local ENU metres.

### 4.1 Shared explorer — Lane C (#15)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| C1 | **P0** (phone) / P1 | **POI labels stack above the whole UI and take pointer events.** Three.js `CSS2DRenderer` sets `style.zIndex = zMax - i` on every label (`three@0.186.1 CSS2DRenderer.js:334`). `.viewport` creates no stacking context, so labels outrank `.topbar` (`z-index: 5`), `.panel` and the HUD. On iPhone 15 emulation, Playwright's actionability hit test found the "Exit 15" label topmost at the centre of `#gteki-to`, so the destination field could not be clicked. A touch at that point hit-tests the same way, but no physical touch was delivered. Suggested fix: `.viewport { isolation: isolate; }` (or `z-index: 0`), plus hiding labels occluded by walls. | `phone-webkit` 01-smoke: 16 of 28 visible labels painted on top of the UI. 02 search: `locator.click` timed out, "poi-label … intercepts pointer events". Desktop guided walks: labels on top of UI in 7/9, 5/9, 1/10 and 3/13 frames. Labels show through walls in first person (`repro-ikebukuro-exit18-blocked-1p.png`) |
| C2 | P1 | **The HUD shows "Speed ×1" while playback runs at ×4.** The label resets whenever the active instruction changes; playback speed does not. | Every guided frame at `fb0ca14` (contact sheets) |
| C3 | P1 | **The third-person camera clips geometry.** The ray tests colliders and walkable surfaces but not the 2D `walls`, so pillars fill the frame in Ikebukuro. In Shinjuku, guided B1 travel views from above the ceiling slab. It still does so at stage 2 `2101993`, so the station's slab proxies do not reach the guide camera. | `shinjuku-walk-exit1-platform-0[0-2,5,6].png` at `563d83c` and `2101993`; Astra visual review |
| C4 | P2 | **The avatar is a white emissive capsule that blows out** under Ikebukuro's warm lighting (up to 16.8% of the frame clipped white). It has no readable silhouette. | `ikebukuro-walk-jrc2-exit35-04.png` |
| C5 | P2 | **The overview opens on a near-black frame:** 84–86% of pixels near black, mean luminance 6–7/255, on both stations at every SHA tested. It does not orient the user. | `*-smoke.json` image stats |
| C6 | P2 | **The route line renders through ceilings and slabs** (x-ray), so it reads as a thin line over grey planes rather than a path. | Shinjuku B1 frames |
| C7 | P2 | **Narration is fragmented.** One switchback becomes "stairs down to GL–B1 landing / straight ~2 m / take the stairs / straight ~1 m / stairs down to B1". Shinjuku S1 has 21 lines for 193 m; S2 has 28. Elevator lines repeat. | `shinjuku-search-ui.json`, `*-navigation.json` |
| C8 | P3 | Arrival toast overlaps the HUD instruction pill. | Final frame of each guided walk |
| C9 | P3 | Search "中央改札" ranks a search-only gate above routable gates. | Search UI test |
| C10 | P3 | Refusal cards are generic: "Verified passages alone don't…" is the same text for the strict-hours and step-free refusals. | IN2/IN3/SN1–3 `uiCard` |
| C11 | P3 | `sceneInfo()` has no scene-kind field, so QA cannot positively tell a station scene from the L0 fallback (it currently relies on a toast). | Astra harness P1-2 |
| — | info | The first-guide-frame hitch (230–250 ms at `d2508b8`) **does not reproduce at `fb0ca14`**: guide frame max is 16.8 ms. | `*-perf.json` |
| — | **retracted** | Earlier "no arrival feedback on Shinjuku" was a Lane F harness artifact: sampling every 3 s missed a 2.5 s toast. With continuous observation the toast is shown on every run from `39ae3fb` on. | `shinjuku-walk-*.json` `arrived: true` |

### 4.2 Ikebukuro — Lane A (#14)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | ~~P1~~ fixed | **Exit 18 switchback stair (`w_n__x18`): an invisible barrier at x ≈ −100.5 stopped the walker from B1** at `6e361d6`. **Fixed at `08d4668`** (likely `5b15ca9`, "bridge hairline floor cracks"): the repro now reaches the stair foot from B1 and descends the top flight to the landing, and free walk I4 climbs the whole switchback with no block (upward only; the full descent is not yet covered). | `06-repros` fails at `39ae3fb` (`upStoppedAt.x = −100.53`) and passes at `a5a555c`. `5b15ca9` is a hypothesis, not isolated. An earlier claim that the descent was also blocked came from a wrong-heading repro and is withdrawn |
| A2 | P1 | **`pnpm-lock.yaml` has no `stations/ikebukuro` importer**, so a frozen install fails (G4). | First latest-heads run at `a5a555c` (17:13 UTC): `--frozen-lockfile` failed and the non-frozen install added the 31-line importer. The baseline needed local commit `39ae3fb` for the same reason |
| A3 | P1 | **Highlights blow out** at exits and corridor ends, with warm haze over the West Exit hall: up to 16.8% of a frame is clipped white, and the destination stair is unreadable on arrival. | `ikebukuro-walk-jrc2-exit35-0[4-8].png`, Astra visual review |
| A4 | P2 | Long passages are visually repetitive: identical panels, columns and lights. Distinguishing cues should come only from documented references. | Astra visual review, `ikebukuro-walk-westb1-exit4` |
| A5 | P3 | I1 narration says "Take the stairs down", then "Take the stairs up to street level", with `floorChanges: 1`. Please confirm the dip is real. | `ikebukuro-search-ui.json` |
| — | info | Load: 6.6 MB transfer in 15 requests; 70–85 draw calls; 60 fps on the M2 Pro. The preview app's named vantages render cleanly. | `ikebukuro-perf.json`, `ikebukuro-preview-*.png` |

### 4.3 Shinjuku — Lane B (#16, stage 2 branch)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | P1 | **Guided B1 travel in the shared explorer views from above the slabs** (see C3). It is unchanged at stage 2 `2101993`: the camera looks at the top of the B1 ceiling slab with the avatar's base poking through. Lane B's DoubleSide walk proxies may help walk mode, but they do not reach the guide camera. | `shinjuku-walk-exit1-platform-02.png` at both SHAs |
| B2 | P1 | **Escalator and stair descents expose black voids and floating fragments** along the travelled path (up to 63% of a frame near black). | `shinjuku-walk-exit1-platform-03.png`, `-07.png` |
| B3 | P2 | **North switchback route line vs stair mesh (fixed at stage 2).** At `563d83c`, walking the lower flight `e:03bd24ff…` from the landing node (−58.55, 198.24, z −3.03) toward (−58.2, 194.72, z −4) stops 4.49 m short at (−57.34, 199.12) against the railing between the two flights. The cause is unresolved: the scene builder derives stair runs from the graph endpoints, so the obstruction is more likely the landing or railing geometry than a misplaced flight. At stage 2 all 23 S1 steps reach their ends. The upper flight `e:cebac08…` walks straight on both SHAs; the free-walk "block" there is an approach-angle autopilot artifact. | `08-step-probe` JSON + `shinjuku-probe-step04.png` |
| B7 | P2 | **Overlapping walkable surface at (−52.3, 145.7) on m1.** On the flat `walk` edge `e:c536dec7…` (display z −4), the step probe ends 0.16 m from the edge end but standing at z −2.79. A second walkable surface 1.2 m above the floor can be stepped onto. It was found on the S2 route. The free walk reached the same waypoint from another angle within height tolerance. | `08-step-probe` S2 JSON, step 19 |
| B8 | P2 | **Unconfirmed containment on B3.** Running north (W + Shift, 30 s) from the platform spawn `n:e31954cb…` rides up to B3 at (−30.2, 152.7, z −19.93). The walker continues north along x −30.2 and stops at (−21.4, 182.3), 15.4 m from the nearest B3 network edge, with only B1 edges overhead. Nothing in the frames shows a wall bounding that floor. Please confirm whether this B3 floor is real, unmapped concourse or a slab extent that needs a wall. | `shinjuku-wall-probe.json` from `04-free-walk`, after the containment check was added in response to the Codex review on #20. A per-second trace of the run confirms the path |
| B4 | P2 | 942 draw calls in the overview (Ikebukuro: 70). 60 fps on the M2 Pro, but this is the first cost to watch on phones. | `shinjuku-perf.json` |
| B5 | info | Exits 3 and 4 had duplicate display names at `563d83c`; Lane B reports this fixed in `15ac5d8`. The route goldens did not change at stage 2. | |
| B6 | info | Step-free Exit 1 → platform returns `no_path`. This is correct: Exit 1 is stairs-only. | S5 |

### 4.4 Lane clients (secondary evidence, not credited to the product)

- **Shinjuku lane app** (`stations/shinjuku/app`): an articulated commuter avatar, an enclosed corridor, a minimap and Japanese narration. It is visibly closer to L2 than the same station in the shared explorer.
- **Ikebukuro preview:** clean named vantages with moderate exposure (mean luminance 106–138; clipped white 0.05–1.29%).
- **Conclusion:** the quality gap between lane clients and the product is in the shared explorer's camera, lighting and labels, not in the station data.

### 4.5 Phone (emulation)

Playwright device emulation on this Mac. **Not a physical phone**: touch, viewport and user agent are emulated, but GPU and CPU are the M2 Pro's. Both runs use candidate `a5a555c` with harness `fd1f5b1`. Results: 10 passed, 10 failed.

| | iPhone 15 profile (WebKit, 393×659) | Pixel 7 profile (Chromium, 412×839) |
|---|---|---|
| Ikebukuro: open, banner, coverage | labels on top of the UI: 16 of 28 visible | labels on top of the UI: 8 of 25 visible |
| Ikebukuro: search → route → guided walk | **cannot be completed**. The "Exit 15" label covers `#gteki-to`, and result rows are covered too | **cannot be completed** (same defect) |
| Shinjuku: open, banner, coverage | labels on top of the UI: 3 of 16 | 1 of 16 |
| Shinjuku: search → route → guided walk | completed, arrival toast shown | completed, arrival toast shown |
| Quality tier chosen by the app | `low` | `low` |
| Overview mean luminance | 24–25/255 (desktop `high`: 6–7) | 22–23/255 |
| Frame time (Mac GPU, not phone hardware) | Ikebukuro: guide max **641 ms**. Both stations: 0–4 frames over 50 ms per window. Shinjuku: 345 draw calls in the overview | 60 fps; worst frame 49.9 ms |

All 10 failures are C1: labels painted over the UI (4), and clicks intercepted by a label (6). Evidence: [`phone-webkit-ikebukuro-labels-over-search.jpg`](2026-10-21-evidence/phone-webkit-ikebukuro-labels-over-search.jpg). On phone width the Ikebukuro panel is unusable until C1 is fixed. Shinjuku has fewer POIs, so it gets through.

## 5. Navigation correctness (G2 evidence)

| Station | Route | Length | Floors | Fare line | Free walk (latest) |
|---|---|---|---|---|---|
| Ikebukuro | I1 JR Central Gate 2 → Exit 35 | 196.7 m | 1 | no | complete |
| | I2 West Exit B1 → Exit 4 | 186.8 m | 0 | no | complete |
| | I3 JR Central Gate 1 → Exit 22 | 187.4 m | 1 | no | complete |
| | I4 JR South Gate → Exit 18 | 287.7 m | 1 | no | complete (was blocked at `6e361d6`) |
| | I5 Central Passage → Exit 40 | 373.4 m | 1 | no | complete |
| | I6 Exit 13 → Exit 43 | 343.3 m | 1 | no | complete |
| | I7 Exit 26 → Exit 10 | 420.6 m | 2 | no | not walked |
| Shinjuku | S1 Exit 1 → Oedo platform | 193.4 m | 4 | yes | completed with 1 recovery at the upper flight (both SHAs); that flight walks straight from its own node |
| | S2 Oedo platform → Exit 2 | 263.2 m | 4 | yes | uninterrupted at stage 2. At `563d83c`, 1 recovery whose step walks straight on its own (probe); see B7 |
| | S3 Exit 5 → toilets (B3) | 172.6 m | 1 | yes | complete |
| | S4 Exit 3 → Exit 6 | 13.1 m | 1 | no | complete; the 3 lift rides are simulated jumps |

Fail-closed cases, all correct:
- `unknown_goal` for a search-only exit (IN1);
- `unknown_start` for a search-only gate (IN5);
- `no_path` under strict hours (IN2, SN3), step-free (IN3, S5) and unpaid-only into the paid area (SN1, SN2);
- `start_equals_goal` (IN4, SN4).

Each refusal shows a card. The step-free and unpaid-only profiles never used stairs or escalators or crossed the fare line on any route they returned. The deep link `?from=…&to=…` restores the same route after reload on both stations. The route goldens (ordered edge IDs and directions, length, floors, narration) were identical on `39ae3fb` and `a5a555c`.

## 6. Performance (observed, no thresholds)

Real GPU (ANGLE Metal, Apple M2 Pro), Chromium headless, 1440×900. Windows of 6 s (overview), 10 s (guide) and 6 s (walk with W held).

| Station @ SHA | Load | Transfer | Overview fps / max ms / draws | Guide fps / max ms / draws | Walk fps / draws | JS heap |
|---|---|---|---|---|---|---|
| Ikebukuro @ `a5a555c` | 906 ms | 6.6 MB / 15 req | 60 / 16.8 / 70 | 60 / 16.8 / 80–85 | 60 / 76 | 28 MB |
| Shinjuku @ `a5a555c` | 705 ms | 0.36 MB / 7 req | 60 / 16.8 / 942 | 60 / 16.8 / 771–832 | 60 / 125 | 38 MB |
| Shinjuku @ `2101993` | 2188 ms | 0.42 MB | 60 / 16.8 / 933 | 60 / 16.8 / 759–823 | 60 / 122 | 82 MB |
| Ikebukuro @ `39ae3fb` | 889 ms | 6.6 MB | 60 / 16.8 / 66 | 59.8 / **50.1** / 76 | 60 / 72 | — |

On desktop, no frame over 50 ms at the latest heads. Stage 2 roughly doubles Shinjuku's JS heap and triples its load time; the likely cause is the skinned commuters and street context, which Lane B should confirm. Phone emulation numbers are in §4.5. They come from the same Mac GPU and do **not** represent phone hardware. The 641 ms guide frame on WebKit (Ikebukuro) is the one long frame worth a look: desktop Chromium does not show it.

## 7. Independent model review (Astra)

Three reviews were run with `codex exec -m gpt-6-astra -c model_reasoning_effort=high --sandbox read-only`. The Codex CLI session header recorded `model: gpt-6-astra`, `reasoning effort: high`, `provider: openai`. In its answers the model identified itself only as "GPT-6 (Codex)" and could not see its own effort setting. Provenance therefore rests on the CLI header, not on the model's self-report. In the third review (this report, below) the same CLI header recorded `gpt-6-astra` / `high`, but the model called itself "GPT-6.1 Sol". Lane F records both and cannot resolve the discrepancy from inside the session.

- **Harness review** (read-only source review). It raised 3 P1, 7 P2 and 1 P3 issues, all fixed in `d1ce594`:
  - P1: a wrong-server risk; the L0 fallback could pass the smoke test; Shinjuku's null-z heights went unchecked.
  - P2: autopilot artifacts; inexact waypoints; an incomplete manifest; an exit code that ignored prerequisite failures; arrival sampled too slowly; a wall probe with no movement control; goldens that did not pin route shape.
  - P3: performance validity was implicit.
- **Visual review** of the baseline contact sheets (guided walks, overviews, lane apps) gave these shared-explorer L2 verdicts:
  - **Ikebukuro: GAP.** Bloom washes out exits, the avatar and the destination. The camera is blocked by pillars and slabs. Long passages look the same. Transition instructions have no visible referent.
  - **Shinjuku: FAIL.** The camera penetrates slabs for most of the guided B1 travel. Stairs and escalators expose voids. There is no arrival feedback.

- **Report review** (read-only, of this document against the evidence files). It raised 9 issues, all applied:
  - verdicts that said GAP for demonstrated defects (now FAIL);
  - "walkable" overclaims where recoveries or lift jumps occurred;
  - an unsupported root cause for B3;
  - lockfile provenance of the rerun;
  - an unreported height discrepancy (now B7);
  - wrong G2 counts;
  - the unfinished phone section, and "tap" overstating `click()`;
  - partial coverage behind "both ways" for A1;
  - preview stats.

Astra reviewed stills, not the videos. Lane F (Opus) watched the recordings. The verdicts in §3 are Lane F's own; for Shinjuku they agree with Astra's (FAIL). For Ikebukuro, Lane F rates G3 **FAIL** where Astra said GAP: the vocabulary reserves FAIL for a demonstrated defect, and blown-out destinations (A3) plus labels over the UI (C1) are demonstrated. One input Astra was given ("no arrival feedback on Shinjuku") was later retracted (§4.1). Shinjuku's G3 FAIL stands on slab penetration and exposed voids alone.

## 8. Deliberate simplifications (acceptable as L2-bounded) vs defects

- **Acceptable:**
  - modular wall panels;
  - simplified commuter figures;
  - restrained textures and sparse retail;
  - schematic escalators;
  - a bounded B1 or platform segment, with honest coverage dialogs;
  - lifts that are not ridden (if they are labelled as such).
- **Not acceptable for L2:**
  - an invisible barrier on a verified route;
  - a camera inside slabs during ordinary guided travel;
  - exposed voids along the walked path;
  - labels painted over the UI;
  - false HUD state;
  - missing arrival feedback;
  - blown-out destinations.

## 9. Reproduce

```bash
cd tests/e2e && pnpm install --ignore-workspace && cd ../..
tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" origin/claude/gteki-shinjuku-station-on-core origin/feat/ikebukuro-g0-slice -- --project=desktop-chromium
```

The Exit 18 defect has its own minimal repro, independent of the autopilot: `tests/e2e/specs/06-repros.spec.ts`. Raw artifacts (29 `.webm` recordings per desktop run, frames and JSON) are about 0.3 GB per desktop run (traces are off for free walks since `2d104d3`) and are not committed. The curated contact sheets and frames in [`2026-10-21-evidence/`](2026-10-21-evidence/) are committed (1.3 MB).

## 10. Rights note for committed evidence images

Images in `2026-10-21-evidence/` are screenshots of derived scenes:

- **Ikebukuro:** Contains PLATEAU data (MLIT), CC BY 4.0, modified by the GTEki Ikebukuro lane; captured by Lane F.
- **Shinjuku:** 「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成 (PDL 1.0). The station's G0 HOLD on post-2027-03-12 reuse also applies to these captures.
