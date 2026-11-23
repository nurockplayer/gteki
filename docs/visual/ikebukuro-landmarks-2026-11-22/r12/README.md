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
