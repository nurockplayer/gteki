# #645 step 5, round 2

Started 2026-11-03 20:26 JST; cap 2026-11-03 21:41 JST.

Merged `origin/main` at `f3e4e27ee2877888b05a5afdf464d3accf8ce5d7` (includes #775 and #778) in `f1baf84cf39122c12d21318d5c7fd505b40072e0`, then pushed. The generated symbol-map conflict was resolved with `pnpm map:gen`.

The paired runner extracts an immutable main archive and then an immutable head archive inside the disposable container. Both variants use the same station scene. Only container source receives the 600-second `spawnSync` timeout and diagnostic recording. Each variant regenerates both stations and copies back four gate files plus its audit. Diagnostic arrays retain public route identities, missing steps, query rejection stages, endpoint representations and polygon references. No acceptance rule is changed by instrumentation.

Command queued 2026-11-03 20:27 JST as heavy ticket #303:

```sh
orb-test --heavy --memory 3g --cpus 2 --out .qa/s5 -- sh .qa/s5/r2-regenerate.sh
```

As of 2026-11-03 20:47 JST it is still queued behind five other heavy jobs. The focused real-navmesh endpoint probe is also waiting for a light slot. There are no new measurements yet; the previous report's numbers are not a fair comparison against this main.

A diagnostic `oracle-ego` question completed 2026-11-03 20:35 JST, exit 0, GPT-6/high, run `~/.local/state/oracle-ego/runs/20261103-203251-48235-gteki-645-s5-r2-diagnosis`. It identifies a falsifiable endpoint-contract discrepancy (Detour wrapper 0.01 m versus shared assembly 1e-6 m), and confirms that an ordinary walking query does not establish semantic fare-gate traversal. A tentative gate-to-walking change was withdrawn before any measurement. No production code has changed in round 2 yet.

At 2026-11-03 20:56 JST, both requested lanes are still waiting. The heavy ticket is sixth in line behind running #297 and queued #298–302. No test or regeneration has been killed or rerun in round 2.

The real endpoint probe completed 2026-11-03 21:11 JST, exit 0. Command: `orb-test --memory 3g --cpus 1 -- pnpm vitest run packages/godot/src/r2-probe.test.ts --maxWorkers=1`; last test result `Tests 2 passed (2)`, final line `orb-test: end 2026-11-03 21:11 JST`. It bakes a flat floor and a ramp at station-scale coordinates and feeds actual query results to `assembleSnapPath`. Both preserve exact endpoints. This falsifies reproduction in those two fixtures; it neither identifies nor fixes the station's 120 historical invalid joins. The task-owned temporary source was removed after the run; its exact content is retained locally at `.qa/s5/r2-probe.test.ts`.

Root typecheck and related audit tests were queued 2026-11-03 21:00 JST:

```sh
orb-test --memory 3g --cpus 1 -- sh -c 'pnpm typecheck && pnpm vitest related packages/godot/src/navmesh-audit.ts --run --maxWorkers=1'
```

## Heavy measurement blocked by the queue

At 2026-11-03 21:15 JST, ticket #303 remained fifth in line, behind a running job and four queued jobs, after approximately 48 minutes. I cancelled the queued request before container start: prior station timings require roughly 24 minutes for both variants, with no remaining room for the queued jobs, a correction, validation and handoff before the 2026-11-03 21:41 JST cap. No regeneration process was started or killed, and it was not rerun. Both current-main station measurements and the complete route/edge classification therefore remain **not run**. The historical taxonomy in `classes.md` is explicitly incomplete and is not shrink-only evidence.

## Final source review

The full-patch Oracle review completed 2026-11-03 21:17 JST, exit 0, **Changes required**. See `r2-oracle-review.md`, including the corrected first diffstat-only upload. Bounded QA fixes were applied; serialized endpoint/required-junction publication findings remain blocked with the physical classes. No production code was changed in round 2 beyond merging main.

The cancelled heavy wrapper exited 143; its last line was `orb-test: end 2026-11-03 21:15 JST`. This was cancellation while queued, before a container or regeneration process existed. It was not rerun.
