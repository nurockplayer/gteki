# Round 2 Oracle disposition

Substantive source review completed 2026-11-03 21:17 JST, GPT-6 / high, exit 0. Verdict: **Changes required; keep draft**. Run: `~/.local/state/oracle-ego/runs/20261103-210915-5575-gteki-645-s5-r2-patch-review`.

The first upload at 2026-11-03 21:07 JST mistakenly contained RTK's 17-line diffstat. That invocation exited 0 with **insufficient patch evidence**, without a source assessment. I corrected the artifact with `rtk proxy git diff`, verified the 684-line unified patch in the rendered bundle, and obtained the source review above. No further review round was run.

## Bounded QA corrections

- Measurement outputs now go directly to the variant's `.qa/s5/r2-*` directory, which `orb-test --out .qa/s5` copies back through its mount. Experimental outputs do not rewrite station baselines even inside the disposable container.
- The classifier handles a fallback artifact without route usage explicitly and does not fabricate an adjacent pair.
- Empty straight-path candidates are identified; endpoint projection and length-bound causes are assigned only when their recorded numeric predicates hold. Otherwise the class remains unresolved.
- The generated class report derives its actual timestamp in JST.

These QA corrections passed Python compilation and shell syntax checks. They were not exercised on station outputs because no paired measurement ran.

## Source findings left blocked

1. Raw endpoints closer than 1e-6 m can round to different 0.01 m coordinates, causing runtime failure after a raw route passed. Publication must use authoritative serialized endpoints and validate serialized routes with the shared assembler.
2. A required junction whose query returns null can be silently absent from both computed and committed joins. Publication must record missing router-required joins as failures.
3. The query's 0.01 m endpoint acceptance and assembly's 1e-6 m identity contract need real rejected-pair evidence before choosing a canonical representation. The real flat/ramp fixtures both preserve exact endpoints, so they do not reproduce the historical 120 failures.

No production correction is claimed for these findings. The paired measurement remained queued for approximately 48 minutes and was cancelled before start at 2026-11-03 21:15 JST. Missing-link/physical scene classes cannot be repaired by changing assembly tolerances; current-main class counts are unavailable.

## Findings narrowed by actual call flow

- An arbitrary link record is not sufficient in this implementation: `links` is filtered by `attachedLinkIds`. The bake derives that set from actual Detour link ends 0 and 1; `linksByEdge` then selects the requested edge's own link. Its bidirectional flag comes from that edge's direction, which graph routing also enforces. The old explicit Detour userId check followed an earlier vertical branch and was unreachable for vertical steps. Physical attachment to the built connector region remains a real Exit 26 concern; no graph-node approach was restored.
- `DEFAULT_PROFILE` is ticketed and non-step-free. `router.allowed()` shows public unpaid-only, step-free, avoid-mode, extra-closure and known-hours policies only restrict its accepted set. The suggested non-default public profile that admits a DEFAULT-excluded edge was not established; no profile expansion was added.
- The original runner's baseline writes occurred only inside an `orb-test` disposable snapshot, and separate light tests use separate snapshots. Host baselines were never changed. Direct QA destinations nevertheless make that boundary explicit.
