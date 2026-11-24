# Final permitted capture — 2026-11-24 JST

PR #1512 remains **draft**. Job `depato-ikb-ai-r14` exited 0, 2026-11-24 06:36:48–06:44:56 JST, with 28 comparison frames and 16 connector-return frames. Source SHA `130383e9f0512a62ad915a67d8c18c43765049ab` is recorded in every raw receipt; per-frame timestamps are UTC. Product changes are in `7ba51e7`. This completes the two newly authorized capture runs (the first launcher failure occurred before browser startup). No further capture is scheduled.

## Acceptance measurements — 2026-11-24 JST

Sunshine walk contrast passes: desktop **4.084**, phone **3.991**. Seibu walk now has measurements and passes: desktop **7.179**, phone **7.094**. All six retained look views meet facade/sky ≤0.8. Sunshine's 5 m nominal cap stays within its 6 m maximum; the rectangle is fully backed by the original facade after lowering its centre from y=253 to y=251. No footprint or building height changes.

| Next frame | Ja cap px | Letter contrast ≥3 | Look facade / sky ≤0.8 |
|---|---:|---:|---:|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | 20.26 | 7.179 | — |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 25.17 | 5.764 | 0.660 |
| [desktop-pparco-walk-next.png](desktop-pparco-walk-next.png) | 16.61 | 6.896 | — |
| [desktop-pparco-look-next.png](desktop-pparco-look-next.png) | 23.40 | 7.720 | 0.558 |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) | 4.46 | 4.084 | — |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 45.54 | 9.847 | 0.611 |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | 11.77 | outside frame / not measured | — |
| [phone-seibu-walk-next.png](phone-seibu-walk-next.png) | 19.00 | 7.094 | — |
| [phone-seibu-look-next.png](phone-seibu-look-next.png) | 19.36 | 5.308 | 0.746 |
| [phone-pparco-walk-next.png](phone-pparco-walk-next.png) | 15.58 | 6.672 | — |
| [phone-pparco-look-next.png](phone-pparco-look-next.png) | 18.00 | 7.048 | 0.609 |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) | 4.18 | 3.991 | — |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 19.48 | 8.850 | 0.647 |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | 7.70 | outside frame / not measured | — |

## Remaining x35 failure — 2026-11-24 JST

**Whole tower top is outside the real follow frame on both devices. This requirement remains unmet.** The walker is at x35, heading 94.2 degrees, with ordinary held pitch input 0.42 radians. Actual lens is 55° desktop / 65° phone; the solved camera points down 12.843° desktop / 6.826° phone. Highest roof vertices project to NDC y=1.7647–1.7675 desktop and 1.1650–1.1669 phone, beyond the upper viewport boundary y=1. Their horizontal coordinates are inside. The sign need not be readable here and is also outside the frame. No zoom, camera relocation, fabricated pass or further capture is used.

`topEdge` now contains actual geometry vertices within 0.05 m of the highest roof point (TP 286.571 m), rather than raising the whole connected complex's bounding-box corners to that height. `wholeTowerTopInFrame` is false for both east-exit next frames. The evidence distinguishes requested pitch input from the camera's solved direction; the follow solver does not deliver the intended upward view here. The lead must route that remaining camera/framing failure or authorize further work/capture; acceptance is not claimed.

## Connector walks — 2026-11-24 JST

On desktop and phone, next and off: x18 outward/return FAIL, x22 outward PASS / return FAIL, x37 and x38 PASS both directions. No teleport between outward and return legs. Raw walks.json retains every runtime connector waypoint, target/avatar result, source SHA and UTC timestamp.

[Origin/main baseline](../r13-main/README.md) reproduces x18/x22 failures at identical positions on both devices. [Breakage #1545](https://github.com/nurockplayer/gteki/issues/1545) contains poses and coordinates. Per lead routing these inherited failures no longer block this PR.

## Resource budget — 2026-11-24 JST

Both devices: each of the seven stores uses 2 draws and one 512×128 texture. Landmark-ring ground adds one shared draw. Draw/texture limits remain satisfied; budgets are measured from loaded mesh/material groups and texture sizes.

## Tests — 2026-11-24 JST

`tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1`

2 files, 35 tests passed. Vitest last result line: `Duration 3.38s (tests 58%, transform 33%, import 9%)`; wrapper last line: `tachi-run: end 2026-11-24 06:37 JST`. [Exact log](focused-tests.log). Start at 21:37:24 in the Vitest log is UTC (2026-11-23), corresponding to 06:37:24 JST (2026-11-24).

`job-run --id depato-ikb-ai-r14 --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r14 -- sh -c 'mkdir -p docs/visual/ikebukuro-landmarks-2026-11-22/r14 && tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1 > docs/visual/ikebukuro-landmarks-2026-11-22/r14/focused-tests.log 2>&1 && tail -n 9 docs/visual/ikebukuro-landmarks-2026-11-22/r14/focused-tests.log && tachi-run --heavy --host --est 15m -- sh -c "nice -n 15 ego-browser nodejs --session ikb-package-ai-r14 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r14.mjs"'`

Result: exit 0; 44 PNGs saved. Final job log line: `tachi-run: host run (gteki/depato-ikebukuro): sh -c nice -n 15 ego-browser nodejs --session ikb-package-ai-r14 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r14.mjs`.

Final hosted CI watch follows the evidence commit/push, only after GitHub shows checks. Its result is not yet known.

## Assumptions — 2026-11-24 JST

The diff exceeds 300 lines because it retains full frame/waypoint receipts and 44 PNGs; product edits are bounded to Sunshine's sign and the main merge. The two-spec result applies to the unchanged product in this evidence commit. Look-up is exercised through normal camera controls, not an authored product camera shot. No review agent, self-review or review-run was used.

## Follow-ups — 2026-11-24 JST

Read final-head hosted CI result. Lead routing is required for x35 framing before acceptance; the capture allowance is exhausted. #1545 owns the inherited connector failures. All owned Vite servers stopped via finally, and the browser task was closed after reading the completed capture output.

## Blocked — 2026-11-24 JST

x35 tower-top framing fails desktop and phone. Both authorized captures are used. A camera fix plus new capture allowance, or a lead scope ruling, is needed; this PR remains draft.
