# GTEki — Lane F browser QA protocol

**Owner:** Lane F ([#12](https://github.com/nurockplayer/gteki/issues/12)). This protocol feeds the joint release gate in [#6](https://github.com/nurockplayer/gteki/issues/6). It produces evidence. It does not grant acceptance. Passing automated checks never substitutes for a reviewer watching the recordings and judging L2 ([acceptance.md](../acceptance.md)).

## What is under test

- **Product entry point:** the shared explorer (`apps/web`), opened with `?station=<key>`. It is what a user loads, so G1–G3 verdicts are judged here first.
- **Lane clients:** the Shinjuku lane app (`stations/shinjuku/app`) and the Ikebukuro preview (`stations/ikebukuro`) are captured as secondary evidence. A visual that exists only in a lane client is reported as such. It is never credited to the product.
- **Exact code:** `tools/qa/run-candidate.sh` builds a detached local worktree from exact refs, merges stacked PRs locally (never pushed) and records every SHA in `manifest.json`. A report without that manifest is not evidence.

## How to run

```bash
tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" origin/main
```

For stacked PRs, pass the base ref followed by each ref to merge:

```bash
tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" origin/claude/gteki-shinjuku-station-on-core origin/feat/ikebukuro-g0-slice -- --project=desktop-chromium
```

Phone projects only run tests tagged `@phone`:

```bash
tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" <base> <refs...> -- --project=phone-webkit --project=phone-chromium
```

First-time setup is `pnpm install --ignore-workspace` in `tests/e2e`. The harness is deliberately not a workspace member, so Lane F never edits root workspace files owned by Lane C. The `desktop-chromium` and `phone-chromium` projects drive Brave on the dev Mac (the machine's browser policy rules out Chrome), or the executable in `GTEKI_BROWSER`; without either they fall back to Playwright's bundled Chromium. WebKit comes from Playwright's cache. `manifest.json` records the browser used.

Outputs go to `tests/e2e/artifacts/`, which is git-ignored:

- `evidence/<project>/`: PNG frames and JSON measurements.
- `test-results/`: one `.webm` per test, plus traces on failure.
- `html/`: the Playwright report.

`tools/qa/contact-sheet.sh` tiles frames for review.

## Suites

| Spec | Interaction | What it shows | Hard asserts | Recorded only |
|---|---|---|---|---|
| `01-smoke` | URL open, station switching | Scene loads (not the L0 fallback). Honest banner. Coverage dialog. Station switch drops the old state. | Page errors, failed requests, labels painted over UI | Load time, image exposure stats, label clutter |
| `02-navigation` | `__gteki` hooks, then visible search UI | Per-scenario route goldens: length, floors, unknowns, edge modes, narration. Fail-closed cases. Deep-link reload. Search → card → instruction preview → provenance. | Expected ok/fail, step-free uses no stairs, unpaid-only crosses no fare line, unknown badges visible | Goldens in `specs/__goldens__` (diff = review) |
| `03-guided-walkthrough` | Real clicks: search fields, Start guide, HUD speed | Recorded guided walk at ×4. A frame every 3–4 s with the HUD instruction, avatar position, exposure and label overlap. | Ends at the destination, arrival feedback, several instructions shown | FPS / draw calls during the walk |
| `04-free-walk` | Real mouse-look drags + `W` via `simulate()` | Can a player physically walk each verified route under the explorer's own walls, colliders and ground rules? Wall probe from each spawn. | No blocks, no off-surface height (also on approximate arrivals), reaches the goal, a 30 s run ends inside the scene bounds and either within 15 m of a walkable edge on its level or inside a mapped, unrestricted plan space on its level | Blocked positions with screenshots. Lift rides are logged as simulated jumps. |
| `05-performance` | Hooks + held `W` | Load, overview, guide and walk frame times. Draw calls per frame. Heap. Transfer size. The actual WebGL renderer string. | none | Everything. No FPS threshold is asserted (acceptance forbids ungrounded thresholds). |
| `06-repros` | Hooks + real drags + fixed keys | Minimal reproductions of reported defects, independent of the autopilot | The defect's own condition | Stop positions, 3rd/1st-person frames |
| `07-lane-apps` | Lane hooks | Lane client frames for side-by-side visual comparison | none | Frames, stats |
| `08-step-probe` | Real drags + `W`, opt-in via `GTEKI_PROBE=<station>:<from>><to>` | Re-walks each routed step alone from its from-node along the exact edge geometry, with no nudges. Separates autopilot steering from scene geometry before a free-walk block is filed. | Steps ending > 1 m short | Per-step end position, screenshots of short steps |
| `09-label-fade` | Real drags + `simulate()`, 8 poses per walking route | POI label fade evidence for human review. Per pose: live frame (a), same frame with labels hidden (b), and (b) annotated with a box per visible label, red = faded (`occluded`), green = shown, + at the anchor (c). A faded label with no drawn geometry in its sight line in (b) is the defect (e.g. a hidden camera-only cap). | Soft only: at least half the poses show a visible label | Per-pose label list (text, rect, occluded, opacity), `__gteki.labels()` counts, avatar, camera, total faded / shown |

### Real vs simulated, stated per run

- Search, clicks, HUD buttons and keyboard are real browser input.
- Guided playback advances in real time.
- Free walk advances the explorer's own deterministic 60 Hz step (`__gteki.simulate`). It uses the same `stepWalk` collision code as real input. Mouse-look is real pointer drags.
- Elevator rides are not walkable in the explorer. The autopilot jumps to the far node and logs it.
- Phone projects are Playwright device emulation: an iPhone 15 profile on WebKit and a Pixel 7 profile on Chromium, both with touch. **This is not a physical device.** Physical-device checks stay a GAP until someone runs them on hardware.
- Headless Brave (Chromium 155) is launched with `--use-angle=metal`. The probe records the WebGL renderer, and any run reporting SwiftShader is invalid for performance.

## L2 review (human / independent model)

Automated checks only gate regressions. For each station, the reviewer:

1. Watches the guided-walk recordings end to end on desktop and phone.
2. Scores the frames against the L2 list in acceptance.md: believable scale, station-specific landmarks, materials and light, wayfinding, movement feedback, readable UI, sound.
3. Separates the shared explorer from the lane client.
4. Lists deliberate simplifications versus defects.
5. Records the reviewer's model and effort, only if that model actually ran.

## Verdict vocabulary

G0–G4 use **PASS / GAP / HOLD / FAIL** per [acceptance.md](../acceptance.md):

- **GAP:** missing evidence or scope.
- **HOLD:** blocked on an Owner, rights or field decision.
- **FAIL:** demonstrated defect against the gate.

Lane F reports. The Owner decides merges and releases.
