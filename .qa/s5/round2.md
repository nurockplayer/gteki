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
