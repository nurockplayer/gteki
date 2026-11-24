# Package A-I capture retry — 2026-11-24 JST

PR #1512 remains **draft**. Job `depato-ikb-ai-r12e` exited 0, 2026-11-24 06:08:07–06:17:45 JST. Process success is not an acceptance pass. This was the one authorized capture retry; no further capture is scheduled.

All 28 comparison frames in [frames.json](frames.json) and 16 return-walk frames in [walks.json](walks.json) record source SHA `cd9547a3835e5f28a84f8307294cf0697482fc58` and per-frame UTC timestamps. [Job receipt](capture-job.json) timestamps include the +09:00 zone. The unchanged product candidate is `328a3764366f023d1dc288bb0304fa7d17b4e272`; the capture driver comes from the recorded source head.

## Measurements — 2026-11-24 JST

The street backdrop opacity is 1 for all 14 next comparison frames. The six measured look views now meet facade/sky ≤0.8. Null text measurements remain failures to establish the text bar, rather than passes. Walk and look poses are retained; x35 uses the real follow camera at 55° desktop / 65° phone. The x35 sign is outside the viewport.

| Next frame | Ja cap px | Letter contrast ≥3 | Facade / sky ≤0.8 |
|---|---:|---:|---:|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | 0.00 | not measured | not measured |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 25.17 | 5.762 | 0.661 |
| [desktop-pparco-walk-next.png](desktop-pparco-walk-next.png) | 16.61 | 6.897 | not measured |
| [desktop-pparco-look-next.png](desktop-pparco-look-next.png) | 23.40 | 7.719 | 0.558 |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) | 2.77 | 1.874 | not measured |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 27.74 | 8.039 | 0.621 |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | 8.03 | not measured | not measured |
| [phone-seibu-walk-next.png](phone-seibu-walk-next.png) | 0.00 | not measured | not measured |
| [phone-seibu-look-next.png](phone-seibu-look-next.png) | 19.36 | 5.308 | 0.746 |
| [phone-pparco-walk-next.png](phone-pparco-walk-next.png) | 15.58 | 6.672 | not measured |
| [phone-pparco-look-next.png](phone-pparco-look-next.png) | 18.00 | 7.048 | 0.609 |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) | 2.59 | 1.877 | not measured |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 17.67 | 6.481 | 0.630 |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | 6.86 | not measured | not measured |

**Text bar remains unmet:** Sunshine walk is 1.874 desktop / 1.877 phone. Both Seibu walk frames have no sign measurement. Both x35 follow-camera frames have no visible-letter measurement. Facade/sky is measured only for look views, matching the retained sampling method.

## Resource budget — 2026-11-24 JST

[Desktop budget](budget-desktop.json) and [phone budget](budget-phone.json) record each of the seven stores at **2 draws** (one facade with street band, one sign), below the ≤3/store limit. Every store has one **512×128** sign texture, meeting ≤512 px. The separate landmark-ring ground adds one shared draw. These counts come from loaded mesh/material groups and texture dimensions, not total scene draw statistics.

## Walks — 2026-11-24 JST

Walk targets are the explorer’s generated runtime connector centrelines, in ENU. The walker uses the normal `walkPath` input hook with vertical checks. There is no teleport between outward and return legs. Raw receipts include each target, post-leg avatar position, steps, stuck/timed-out result, path and source SHA.

| Exit | Outward / return | Desktop next / off | Phone next / off |
|---|---|---|---|
| x18 | FAIL / FAIL | FAIL / FAIL | FAIL / FAIL |
| x22 | PASS / FAIL | FAIL / FAIL | FAIL / FAIL |
| x37 | PASS / PASS | PASS / PASS | PASS / PASS |
| x38 | PASS / PASS | PASS / PASS | PASS / PASS |

Both devices and flags stop at the same first failures (ENU metres):

- x18 outward waypoint 22: target (-93, 154.5, 30.545), avatar (-93.164, 155.075, 30.545), `stuck: true`. The outward path does not finish, so return coverage also fails.
- x22 return waypoint 53: target (71.5, 116.5, 28.45), avatar (72.291, 117.493, 28.450), `stuck: true`. Outward travel passes.

## Tests — 2026-11-24 JST

Capture command:

```sh
job-run --id depato-ikb-ai-r12e --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r12-retry -- tachi-run --heavy --host --est 15m -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-package-ai-r12-retry --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r12.mjs'
```

Result: exit 0, 44 PNGs saved. Final job log line:

```text
tachi-run: host run (gteki/depato-ikebukuro): sh -c nice -n 15 ego-browser nodejs --session ikb-package-ai-r12-retry --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r12.mjs
```

The product is unchanged from the existing two-spec result: 2 files and 33 tests passed; `Duration 3.66s (tests 66%, transform 26%, import 8%)`. Final two-spec validation and hosted CI checks are handed to a detached job after this evidence commit is pushed. Their result is not yet known.

## Assumptions — 2026-11-24 JST

The diff exceeds 300 lines because it retains 44 PNGs and complete per-frame, per-waypoint, budget and job receipts. No product code changed. This set supersedes r12 for these 44 views; unrelated earlier captures are not rerun.

## Follow-ups — 2026-11-24 JST

Read the final validation/CI job result and report it against the pushed evidence head. Art-director acceptance stays with the lead.

## Blocked — 2026-11-24 JST

The text and x18/x22 walk bars still fail. The first run used graph paths and a stale street backdrop; the one retry uses runtime connector paths and refreshed street state, but those bars remain unmet. The lead must route the remaining sign/view and existing walk failures before acceptance; no further capture retry or bar waiver is claimed.
