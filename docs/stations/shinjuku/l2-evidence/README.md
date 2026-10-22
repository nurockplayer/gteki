# Shinjuku (E27) — L2 evidence pack index

**Status: index only. NOT ACCEPTED.** This page lists the acceptance evidence that exists for Shinjuku, where to find it, and the SHA it was measured on. It copies no image and no video; it only links them. It claims nothing it cannot link. The gate-by-gate reading of this evidence is in [`../l2-readiness.md`](../l2-readiness.md).

**Status: draft, open items.** Sections 1.1–1.6 (evidence that exists) and section 2 (missing) are written. Not finished:
- No entry was re-run or re-opened for this index; results are as reported on the linked issues, and the SHAs are those those comments name.
- The (B) prefix replay (E6) is running; its row has no result by design.
- Credit/image-review note for future committed stills (like Ikebukuro's) is described, not yet written as a section.
- Perf rows E16–E20 are not reconciled with each other (E20 is older and inconsistent with E16).

- **Basis.** Index written at Lane B base `e31588b` (head of draft PR [#61](https://github.com/nurockplayer/gteki/pull/61)); main `2e08516`. Issues read on 2026-10-22.
- **Reported, not re-run.** Test counts and run results below are as reported by Lane B (#61, #5) or Lane F (#61, #12, #5). They were not re-run for this index. Where a result lives only on a host (for example Lane F's `gteki-qa-evidence/b511263/`), it is marked "host-local, not linkable".
- **Rights.** E27 data ships under the Owner's override at the #16 merge; the licence basis is unconfirmed (see the README G0 section). Any image or video of this scene is a render of GTEki-processed data: E27 「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」「構内地図データ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成, and PLATEAU 新宿区 (国土交通省 Project PLATEAU) を加工して作成. Do not describe any of it as covered by PDL 1.0. Evidence images committed in future need a credit note beside them, as Ikebukuro's `stations/ikebukuro/docs/evidence/README.md` has (on main).
- **Structure.** Ikebukuro keeps committed stills and two videos with a credit and image-review note (`stations/ikebukuro/docs/evidence/`), and since #142 proves G1/G2/G0 rows with tests (`scene/frame.test.ts`, `scene/routing.test.ts`, `pipeline/audit_assets.ts`). Shinjuku has the second kind in large part (fare and fence replays, layout and truth tests) but no committed stills or video at the candidate SHA, and no routing-matrix or frame test yet. The sections below mirror the gates.

## 1. Evidence that exists

### 1.1 Fare and access containment (G1, G2)

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E1 | Full 8-shard fare-containment replay, in containers | Summary in [#5 handoff r13](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6331378439) and the [#61 body](https://github.com/nurockplayer/gteki/pull/61); tests `stations/shinjuku/test/fare-replay-{1..8}.heavy.test.ts` | `b511263` | 3,120 jobs, 21,328,200 paths, 0 leaks, 0 failed paths, 2 fringe contacts of at most 5.2 µm; container peak 1,259 MiB (threads=1, 2g). **Models the old walk step**, not the one shipped after #81. |
| E2 | `fence-slide.heavy`, all 785 segments (50 fare fences, 723 access fences, 8 gate machines, 4 gate lines) | [#61 comment](https://github.com/nurockplayer/gteki/pull/61#issuecomment-6332112240); `stations/shinjuku/test/fence-slide.heavy.test.ts` | `e31588b` | PASS in a container (2g, threads=1), 791 s: 146,784 runs, 10,957,414 steps, 0 leaks, using the replay's own leak rule. |
| E3 | `fence-slide` default slice (every fare fence, gate machine and gate line, plus every 30th access fence), with a negative control | [#61 body](https://github.com/nurockplayer/gteki/pull/61); `stations/shinjuku/test/fence-slide.test.ts` | `e31588b` | 26,504 runs, 2.06 M steps, 0 leaks; the negative control leaks as it must. |
| E4 | Replay step equals a reference written from `explorer.ts` | [#61 body](https://github.com/nurockplayer/gteki/pull/61); `stations/shinjuku/test/fare-replay-step.test.ts` | `e31588b` | 1,440 cases per fixture, native and accelerated, exact equality. |
| E5 | Other containment tests in the default suite | `stations/shinjuku/test/fare-boundary.test.ts`, `fare-sweep.test.ts`, `fare-signs.test.ts`, `fare-replay-public.test.ts`, `fare-replay-exact.test.ts`, `fare-replay-rays.test.ts`, `restricted-access.test.ts`, `mapped-space.test.ts`; conflict table `test/fixtures/restricted-conflicts.json` | `e31588b` (suite reported green) | Part of the 81 files / 837 tests below. |
| E6 | **(B) conflict-first prefix of all 8 shards with the new step** | Will be posted on [#61](https://github.com/nurockplayer/gteki/pull/61) | `e31588b` | **RUNNING. No result yet; none is claimed here.** |

### 1.2 Lane F captures and smoke (G1, G3)

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E7 | Lane F pass 2: 56 passed, 1 skipped (opt-in probe), 25.8 min; Brave 155 desktop plus iPhone 15 and Pixel 7 emulation; M2 Pro, ANGLE Metal | Verdicts: [#61 comment](https://github.com/nurockplayer/gteki/pull/61#issuecomment-6318371823); report §0: `docs/qa/reports/2026-10-21-lane-f-first-pass.md` | `b511263` (#61 `2784dea` + core #56) | B1, B2, B3, B4, B7, B8 PASS; C1 PASS; exit-top daylight PASS; phone occlusion PASS. Remaining: C3 (#70), C6, C8 (#66). Emulation only; a Lane B box replay ran alongside. |
| E8 | Step probes S1 and S2 | Same comment; spec `tests/e2e/specs/08-step-probe.spec.ts` | `b511263` | S1 23/23 steps, S2 31/31 steps, worst miss about 0.73–0.74 m, worst height error 0.35 m. |
| E9 | Near-black (void) fraction and draw calls | Same comment | `b511263` | Desktop max 0.061, phones max 0.003 (main `c2b5a9b`: 0.686); 279 desktop and 127 phone draw calls (main: 913 and 314). |
| E10 | Frames, JSON and videos from the pass-2 run | Lane F's QA host, `gteki-qa-evidence/b511263/` | `b511263` | **Host-local, not linkable.** Lane F can attach selected frames on request. |
| E11 | Older committed Lane F stills | `docs/qa/reports/2026-10-21-evidence/shinjuku-*.jpg` and its `README.md` | `a5a555c`, `2101993` (per that README) | Pre-stage-2 and stage-2-early; they show the problems later fixed (guide camera above slab, probe stopped at railing). They are **not** evidence for the candidate. |
| E12 | Lane B Brave smoke, production preview: exit:1 to Oedo platform guided walk, plus exit-top frames for exits 1–6 | [#61 body](https://github.com/nurockplayer/gteki/pull/61) (producer: Lane B) | `e31588b` | 53 samples, worst near-black **0.108**, 0 samples above 0.15. Above the 0.10 target in #49; Lane B attributes the dark frames to the black escalator handrail. Frames not committed. |
| E13 | Lane B explorer-walk sign-role A/B/C and exit tops | [#5 handoff r11](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6315105726) | `13352cc` / `81fe334` | Variant C shipped: worst near-black 0.109 / 0.102 / 0.101 on three routes; exits 2 and 4 show sky and pavement at the top, exits 1, 3, 5, 6 show none. |
| E14 | Lane B whole-station node sweep (456 views) | [#5 r11](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6315105726); tool `stations/shinjuku/tools/node-vantages.ts` | `81fe334` | 0 views above 0.10; worst 0.061. |
| E15 | CI `e2e-smoke` (non-required) | [#61 comment](https://github.com/nurockplayer/gteki/pull/61#issuecomment-6331469377) | `e31588b` | **Failing** on two Shinjuku walks (SwiftShader screenshot timeout, known flake #76). Not a pass; main now skips the platform-exit2 walk there (`25c7792`). |

### 1.3 Performance (G3, G4)

All numbers are from a dev Mac (M2 Pro), production `vite preview` builds, N=5 medians, via `stations/shinjuku/tools/perf.ts` and `heap.ts`. Raw outputs are in the git-ignored `.qa/` and are not linked. None is a physical-phone number.

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E16 | Start-up, reopen and heap, A/B interleaved | [#72](https://github.com/nurockplayer/gteki/issues/72) | `c2b5a9b` vs `b511263` | Brave explorer ready 1085 → 2006 ms; reopen 359 → 1143 ms; heap 27 → 71 MB; lane first frame 996 → 1782 ms; WebKit iPhone 15 load 1107 → 3239 ms. Replay box running at the same time. This is a regression, tracked in #72. |
| E17 | Raycast cost with and without the core BVH (#73) | [#46 comment](https://github.com/nurockplayer/gteki/issues/46#issuecomment-6321199700) | main `c2b5a9b`, `b511263`, `b511263` + #73 | WebKit iPhone 15 emulation walk 60 / 59.8 / 60 fps; Brave 4× CPU throttle rAF p50 5.5 / 48 / 9 ms. #73 is on main (`fd97b88`). |
| E18 | Draw calls per frame | [#5 r12](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6319280997) | `c2b5a9b` → `b511263` | Brave explorer 913 → 279; lane 309 → 118. |
| E19 | Lane F first-pass performance table | `docs/qa/reports/2026-10-21-lane-f-first-pass.md` §6 | `a5a555c`, `2101993` | Pre-stage-2 and early stage 2; superseded by E16–E18. |
| E20 | README performance block (lane build 2.86 → 1.07 s; heap 72 → 43 MB; explorer ready 3.3 → 1.55 s) | `docs/stations/shinjuku/README.md` (G3) | `d3ed80d` → `ac034d2` | Older stage branch SHAs, not reproduced on `e31588b`, and not consistent with E16 (explorer ready 2006 ms at `b511263`). Treat as history. |

### 1.4 Headless play tests and truth tests (G1, G2, G3)

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E21 | Full gate run | [#61 body](https://github.com/nurockplayer/gteki/pull/61) | `e31588b` | Frozen install, `pnpm typecheck`, station tsc, `pnpm test --maxWorkers=1` (81 files, 837 tests), `import:e27 --check`, `import:surface --check`, station and web builds, `git diff --check`: all reported passing. Reported, not re-run for this index. |
| E22 | Walkability and arrival | `stations/shinjuku/test/layout.test.ts` (ground under every non-elevator node; every walk, stairs, escalator and gate edge walkable), `guided-walk.test.ts` (every routable POI pair arrives, ticketed and step-free; ×2 and ×4 guide; walked count above 100) | `e31588b` | Part of E21. Counts in the README: 233 nodes, 263 edges, 16 POIs. |
| E23 | Clearance and enclosure | `test/clearance.test.ts`, `enclosure.test.ts`, `mapped-space.test.ts`, `scene-hook.test.ts`, `geometry-lifetime.test.ts`, `layout-equivalence.test.ts` | `e31588b` | Part of E21. |
| E24 | Truth tests | `test/height-truth.test.ts`, `arrival-truth.test.ts`, `narration-bends.test.ts`, `narration-round2.test.ts`, `contract.test.ts` | `e31588b` | Part of E21. Heights stay symbolic and labelled 推定 / est.; routes to B1 exits never claim street level; unknown hours stay unknown. |
| E25 | Narration after #33 | [#5 r10](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6314203868) | earlier stage SHA | 80/80 at that time; Lane F will recount (#77). |
| E26 | Camera diagnosis on the exit:2 stair | [#70 comments](https://github.com/nurockplayer/gteki/issues/70#issuecomment-6331548480) | main `f8ce063` via `e31588b` | Replay on the shipped rig: 14 of 130 samples exceed 1/6 of the frame, all uphill at the foot of flights; the roof caps bind in 0 of 130. |

### 1.5 Coverage, routing and data records (G0, G2)

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E27 | Coverage gaps (8 ids: transfers, heights, exit-numbers, hours, escalator-direction, platform-sides, reuse-after-publication, closures) | `stations/shinjuku/gteki/station.json` `coverage.gaps`; table in `docs/stations/shinjuku/README.md` | `e31588b` | Present. Every area is labelled as published-data extent; other operators are not modelled. |
| E28 | Lane F routes and refusals | `docs/qa/reports/2026-10-21-lane-f-first-pass.md` §5; goldens `tests/e2e/specs/__goldens__/shinjuku-routes.json`; spec `tests/e2e/specs/02-navigation.spec.ts` | `a5a555c` (goldens identical on `39ae3fb` and `a5a555c`); pass 2 on `b511263` | S1 193.4 m, S2 263.2 m, S3 172.6 m, S4 13.1 m; step-free and unpaid-only refusals correct; the three S4 lift rides are simulated jumps. |
| E29 | **Routing matrix on the Shinjuku bundle** | none | none | **MISSING.** Existing partial coverage: `contract.test.ts`, `guided-walk.test.ts`, Lane F goldens, and the core tests in `packages/navigation`. |
| E30 | Desk check of `gap:closures` | [#5 comment](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6324316392) | `b511263` | No E27 exit POI plausibly matches the closed exit 2 of 京王新線・都営新宿線 新宿駅. Official closure facts: `docs/research/gaps/DR-SJ-station-facts.md` (main, ids DR-SJ-01, DR-SJ-05). |
| E31 | Public changes after the 2025-09 snapshot | `docs/research/gaps/DR-changes-since-2023.md` (main, CH-SJ-01..19) | read 2026-10-22 | Whether E27 reflects them is UNKNOWN. See the freshness section of `l2-readiness.md`. |
| E32 | Lane D gap packet | `docs/gis/gaps/shinjuku.md` (main) | main | Combined E27 network: 1 weak component, 0 dangling references, 0 endpoint mismatches above 0.5 m; the PLATEAU underground file does not overlap E27 (disjoint by about 184–237 m); 1 of 263 links rank-inconsistent under 2024-07; spec version UNKNOWN. |

### 1.6 Rights, provenance and reviews (G0, G4)

| ID | Evidence | Where | Measured on | Result and caveat |
| --- | --- | --- | --- | --- |
| E33 | Owner override | [#16 comment](https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757); Q11 decision [#39 comment](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917) | n/a | Published under override; licence basis unconfirmed. Not a rights PASS. |
| E34 | Hash-pinned sources, reproducible importers | `stations/shinjuku/sources/manifest.json`, `sources/surface-manifest.json`, `tools/fetch-sources.sh`, `tools/import-e27.ts`, `tools/import-surface.ts` | `e31588b` | `--check` reported byte-identical (E21). Raw data is outside the repo. |
| E35 | Lane F G0 desk audit | [#12 comment](https://github.com/nurockplayer/gteki/issues/12#issuecomment-6324807437) | main `62c9640` | Shinjuku G0 HOLD (Owner); items tracked as #120, #121, #125. |
| E36 | Codex bot review at head | [#61 comments](https://github.com/nurockplayer/gteki/pull/61#issuecomment-6331472038) and [director summary](https://github.com/nurockplayer/gteki/pull/61#issuecomment-6331527510) | `e31588b` | Completed; one P2 (lane dev app, moved to #157); no P0 or P1. CodeRabbit skipped (111 files exceed 100). |
| E37 | Earlier fresh read-only Codex review | [#5 r12](https://github.com/nurockplayer/gteki/issues/5#issuecomment-6319280997) | `37d4e2a..9d01244` | PASS; the one P2 fixed in `2784dea`. |

## 2. What is still MISSING for L2

| ID | Missing evidence | Producer | Trigger |
| --- | --- | --- | --- |
| M1 | (B) conflict-first prefix replay with the shipped walk step (E6) | Lane B | Finishes in its container; result posted on #61. Merge gate for #61. |
| M2 | Lane F `04-free-walk` on the merged head | Lane F | #61 merges. |
| M3 | Lane F B1–B6 on the merged candidate SHA, a refreshed #5 gate list, and `10-look-compare` on Shinjuku | Lane F | #61 merges and a host slot is granted. |
| M4 | Full 12 h+ extended-step replay, all 8 shards, no prefix ([#156](https://github.com/nurockplayer/gteki/issues/156)) | Lane B | A weekend night box slot, with the host memory gate satisfied. Results (summary lines, per-shard peak, SHA) go on #156 and #5. |
| M5 | Mobile performance on the production build: idle-host rerun, then a physical phone. Includes the effect of the #72 fixes. | Lane F (rerun), Owner (device); Lane B for #72 | #61 merged; #72 fixes landed; a device available. |
| M6 | Independent side-by-side L2 review (fresh read-only Claude subagent, labelled) and the Owner's own visual judgement | Lane F, Owner | M3 done and a walkthrough video available. |
| M7 | Recorded landmark-to-destination walkthrough video at the final SHA, linkable | Lane B (`pnpm --filter @gteki/station-shinjuku record`) or Lane F (`03-guided-walkthrough`) | Merged head and a host slot. |
| M8 | Owner L2 sign-off | Owner | M1–M7 and the G0 items resolved or accepted in writing. |
| M9 | Shinjuku routing matrix test (E29) and a frame or CRS round-trip test | Lane B | Any time; no host slot needed. |
| M10 | Declaration of the three inlined data files and a Lane F asset audit | Lane C (schema and build check), then Lane B and Lane F | #121 design lands. |
| M11 | Provider answer on reuse after 2027-03-12 | Owner (submits the inquiry) | Before 2027-03-12. |
| M12 | Navigation-freshness check of E27 against the changes since 2025-09 (CH-SJ-01..14), or a newer E27 release | Lane D (research), Lane B (records) | A cited source per change, or a new provider release. |
| M13 | Godot proof for Shinjuku | Godot lane | #164 G-1. |
