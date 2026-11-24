# Package A-I capture receipt — 2026-11-24 JST

Product candidate: `328a3764366f023d1dc288bb0304fa7d17b4e272`.

The first validation/capture job `depato-ikb-ai-r12` ran the required two-spec test command successfully, then stopped before any browser capture: `error: invalid --timeout-ms value "1200000": use 1 to 600000`. The heavy host gate opened and acquired lock #1600; this was a capture CLI argument error. The capture-only retry uses `--timeout-ms 600000`; no test or product code changed on this continuation.

Capture command:

```sh
job-run --id depato-ikb-ai-r12b --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r12 -- tachi-run --heavy --host --est 15m -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-package-ai-r12 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r12.mjs'
```

Frames and their source SHAs will be recorded in `frames.json` and `walks.json` when the job runs. No r12 visual or walk acceptance is claimed before those results exist. PR #1512 stays draft.

## Capture startup correction — 2026-11-24 JST

Capture-only job `depato-ikb-ai-r12b` acquired heavy lock #1611, then exited before creating a browser task: `Error: Capture server exited: 127`. The embedded Ego runtime has PATH `/usr/bin:/bin:/usr/sbin:/sbin`, which cannot resolve the fnm `node` executable. This worktree also has no host `node_modules` or `apps/web/node_modules/vite/bin/vite.js`; the successful tests installed dependencies only in their isolated container.

The driver now uses `/Users/tachikoma/.local/share/fnm/aliases/default/bin/node` for Vite. Job `depato-ikb-ai-r12c` first runs `pnpm install --frozen-lockfile` through `tachi-run --heavy --host --cpu`, then runs the same GPU-gated capture command with the legal 600000 ms timeout. Product code and the passing 33-test result are unchanged. Capture frames, measurements and walks remain pending.

## Module URL correction — 2026-11-24 JST

Job `depato-ikb-ai-r12c` completed `pnpm install --frozen-lockfile` with pnpm 12.11.2 and started Vite successfully, then failed at the old optimized-cache import URL `/node_modules/.vite/deps/three.js`. The driver now imports the installed package's `/node_modules/three/build/three.module.js` and reuses its existing task space 50. The capture retry is `depato-ikb-ai-r12d`; product code and the passing 33-test result remain unchanged. No frames or walk results were produced by r12c.

## Completed capture and failed acceptance — 2026-11-24 JST

Job `depato-ikb-ai-r12d` exited 0, 2026-11-24 05:55:39–06:04:17 JST. It produced 28 comparison frames and 16 walk-return frames. Every entry in [frames.json](frames.json) and [walks.json](walks.json) records source SHA `36149fe885ef03bd7230af444f5b0e8ef8f27a09` and its UTC capture timestamp. Process success does not mean acceptance passed.

| Next frame | Text contrast (minimum 3) | Facade / sky (maximum 0.8) |
|---|---:|---:|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | not measured | not measured |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 5.310 | 41.096 |
| [desktop-pparco-walk-next.png](desktop-pparco-walk-next.png) | 6.361 | not measured |
| [desktop-pparco-look-next.png](desktop-pparco-look-next.png) | 7.067 | 436.515 |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) | 1.949 | not measured |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 7.527 | 483.313 |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | not measured | not measured |
| [phone-seibu-walk-next.png](phone-seibu-walk-next.png) | not measured | not measured |
| [phone-seibu-look-next.png](phone-seibu-look-next.png) | 4.892 | 761.675 |
| [phone-pparco-walk-next.png](phone-pparco-walk-next.png) | 6.162 | not measured |
| [phone-pparco-look-next.png](phone-pparco-look-next.png) | 6.493 | 22.030 |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) | 1.931 | not measured |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 6.192 | 568.518 |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | not measured | not measured |

The manually positioned exterior cameras retained an underground backdrop after the return walks: the sky is black, so these facade/sky ratios do not qualify as daylight measurements. The first Seibu walk frame has no loaded sign metric. Sunshine walk remains below 3:1; x35 default follow views place its sign outside the frame. These failures are retained, not waived.

| Exit | Desktop next / off | Phone next / off |
|---|---|---|
| x18 | FAIL / FAIL | FAIL / FAIL |
| x22 | FAIL / FAIL | FAIL / FAIL |
| x37 | PASS / PASS | PASS / PASS |
| x38 | PASS / PASS | PASS / PASS |

One capture-driver correction uses the runtime connector paths instead of the raw graph polyline, waits for landmarks, updates the street state before exterior poses, settles the real follow lens, and records per-store draw/texture usage. The one rerun writes `r12-retry/`; it changes no product geometry or materials. No final CI has been started yet. PR #1512 remains draft.
