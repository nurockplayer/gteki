# Package A-I capture receipt — 2026-11-24 JST

Product candidate: `328a3764366f023d1dc288bb0304fa7d17b4e272`.

The first validation/capture job `depato-ikb-ai-r12` ran the required two-spec test command successfully, then stopped before any browser capture: `error: invalid --timeout-ms value "1200000": use 1 to 600000`. The heavy host gate opened and acquired lock #1600; this was a capture CLI argument error. The capture-only retry uses `--timeout-ms 600000`; no test or product code changed on this continuation.

Capture command:

```sh
job-run --id depato-ikb-ai-r12b --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r12 -- tachi-run --heavy --host --est 15m -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-package-ai-r12 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r12.mjs'
```

Frames and their source SHAs will be recorded in `frames.json` and `walks.json` when the job runs. No r12 visual or walk acceptance is claimed before those results exist. PR #1512 stays draft.
