# #645 step 5: snap-only navmesh guide

Final status 2026-11-03 20:22 JST: **DRAFT — shrink-only failed; do not merge with the old baked paths.**

Started 2026-11-03 19:20 JST from `1b9e2c82` on `cx/645-s5-snap-guide`.

## Changes

The audit and public runtime share `assembleSnapPath`. Each step begins and ends at a navmesh snap. A different next snap requires an actual navmesh junction path; missing steps or junctions fail instead of adding a straight graph-node segment. Attached vertical links use their endpoints; the audit no longer reconstructs graph approach lines or vertical graph polylines. Junctions and vertical paths are baked for the public runtime. The app reports a failed route when no continuous baked guide exists.

Link snap admission checks the snapped floor point because the discarded graph-node-to-snap approach is no longer walked. No height constants, proximity rules, per-piece probes or legacy-builder changes were added.

## Tests

- Red proof: `orb-test --memory 3g --cpus 1 -- pnpm vitest run packages/navigation/src/present.test.ts --maxWorkers=1` — `Tests 3 failed | 62 passed (65)` on the old implementation; completed 2026-11-03 19:26 JST. The failures are the off-mesh junction, offset vertical polyline, and absent snap/join cases.
- Focused: `orb-test --memory 3g --cpus 1 -- pnpm vitest run packages/navigation/src/present.test.ts packages/godot/src/navmesh-audit.test.ts --maxWorkers=1` — `Tests 72 passed (72)`; completed 2026-11-03 19:47 JST.
- Final correction check: the combined root typecheck + three focused files command below exited 0, `Tests 85 passed (85)`; last line `orb-test: end 2026-11-03 20:20 JST`.
- `pnpm map:gen` completed; the new shared assembly is included in the symbol map.

## Assumptions

- `unvalidatedJoins` retains its existing meaning: incomplete audited routes. It is not a literal count of junction segments.
- Missing baked paths report route failure. Existing stations without any baked navmesh data retain their graph presentation.
- The removed m3shell worktree's runner is reproduced in PR #775. Regeneration uses that container-only timeout approach and mounts only `.qa/s5` for write-back.
- A vertical link uses its snapped endpoints and the built connector interior for physical bends/landings. The first measured straight-chord interpretation clips real stairs, so preserving the model interior is the smallest reading that keeps snap-only ends and physical traversal.
- The diff exceeds 300 lines because it includes the required code map, test/report evidence, regeneration runners, comparison script and symbol-map updates. Production scope remains guide assembly and its bake/runtime wiring.
- The initial base is live origin/main `1b9e2c82`; PR #775 is not in that base. No unrelated changes from #775 are imported.

## First measured candidate

The first full regeneration completed 2026-11-03 20:03 JST on the implementation in `f47e547`. It used `orb-test --heavy --memory 3g --cpus 2 --out .qa/s5 -- sh .qa/s5/regenerate-gates.sh`; last result: `orb-test: end 2026-11-03 20:03 JST`, exit 0. Generator completion is not a shrink-only pass.

| Station | fallback | unvalidatedJoins | invalidJoins | detours | offFloor | snap_failed at exit stairs |
|---|---:|---:|---:|---:|---:|---:|
| Ikebukuro | 1 → 0 | 62 → 120 | 0 → 120 | 0 → 0 | 0 → 0 | 1 → 0 |
| Shinjuku | 6 → 12 | 146 → 170 | 0 → 0 | 2 → 4 | 0 → 0 | 0 → 1 |

Exit stairs are stairs whose endpoint is a connector node of a public exit POI. Counts are unique failed edges, not directed queries.

**Shrink-only FAIL.** Ikebukuro additionally grows connector wall samples 0 → 3604 and has 424 connector samples without floor; 36 published path directions are rejected. Shinjuku has eight rejected directions; six suspect edges enter the failure list. The first implementation used direct end-to-end off-mesh link segments, which do not preserve the built bends/landings of the Ikebukuro stairs. The final correction retains the built connector interior and replaces only its ends with the attached link snaps; it never restores graph polylines. These are real scene results, not a synthetic-only claim.

All eight generated gate files were copied out of the disposable container into `.qa/s5/regen-output`. They were **not** promoted into `stations/`: doing so would violate the required shrink-only gate. Raw audit JSON stays local and untracked. The comparator lives at `.qa/s5/r5/compare.py` (the old `.qa/s5/compare-gates.py` reported failures but exited 0, so it was removed); the recorded result is `SHRINK-ONLY FAIL` (individual growth entries follow).

Oracle corrections after this measurement block generic fare-gate bypasses, enforce rounded published join endpoints, retain the existing local join-length bound, and fail closed on public navmesh-load errors. The final corrected measurement is recorded separately below; this first table does not claim to measure those corrections.

## Follow-ups

See `oracle-review.md` for the one bounded diff review, concrete fixes, and findings rejected with call-flow evidence. The remaining scene/link representation issue needs a bounded repair before these baselines can be lowered. Do not merge this draft with the old baked paths: they do not contain the new vertical/junction data.

## Blocked

Both measured stations fail shrink-only, so the generated baselines cannot be adopted. I implemented strict missing-snap failure and retained the existing baseline instead of adding exemptions or restoring graph joins. The lead needs a connector/link geometry repair or an explicit scope decision before this candidate can become mergeable; final focused checks passed, but the second station measurement also failed shrink-only.


## Final validation commands

The required related run (started 2026-11-03 19:52 JST) used:

```sh
orb-test --memory 3g --cpus 1 -- sh -c 'pnpm typecheck && pnpm vitest related apps/web/src/explorer/explorer.ts apps/web/src/ui/app.ts packages/godot/src/navmesh-audit.ts packages/godot/src/navmesh-bake.ts packages/godot/src/navmesh-fallback.ts packages/godot/src/navmesh-gate.test.ts packages/navigation/src/index.ts packages/navigation/src/present.ts packages/navigation/src/present.test.ts packages/navigation/src/snap-path.ts packages/scene-api/src/index.ts --run --maxWorkers=1'
```

Post-review focused corrections use:

```sh
orb-test --memory 3g --cpus 1 -- sh -c 'pnpm typecheck && pnpm vitest run packages/navigation/src/present.test.ts packages/godot/src/navmesh-audit.test.ts apps/web/src/explorer/explorerQa.test.ts --maxWorkers=1'
```

Final station measurement:

```sh
orb-test --heavy --memory 3g --cpus 2 --out .qa/s5 -- sh .qa/s5/regenerate-final.sh
```

The final measurement started 2026-11-03 20:07 JST. Its first Ikebukuro diagnostic pass had already loaded the pre-interior-fix audit. At 2026-11-03 20:11 JST, before the fallback-list publication pass, the final audit source was atomically copied from the worktree into this run's disposable container. The fallback edge set is unaffected by the interior-path correction; the returned clip/path outputs come from the subsequent final-source audit. Both Shinjuku passes use the final source. No process was killed or restarted for this update.

Final audit source SHA-256: `5e51c22cf84518fcc1a996d32c10b469cc5fda0fbf56a290490dc90bda6cf116`.


### Related-run outcome

Root typecheck passed before Vitest began. The related run was intentionally interrupted at 2026-11-03 20:17 JST, exit **130**, after at least seven failed cases while still running scene tests. Only this run's Vitest main PID 169 inside container `orb-test-gteki-70200` received SIGINT. It was not rerun. The last result line was `orb-test: end 2026-11-03 20:17 JST`; no final Vitest count or failure-detail summary was produced.

Failures observed before interruption:

- `greybox.test.ts`: 16 km/five-floor budget; incremental floor-discovery budget (two failures).
- Shinjuku `identity-boards.test.ts`: first qualifying platform-board candidate.
- Shinjuku `enclosure.test.ts`: 2.1 m head-band clearance along every edge.
- Ikebukuro `signage.test.ts`: `test_fitting_exclusion.py`.
- Shinjuku `escalator-shell.test.ts`: two failures (the run had not printed assertion details).

These modules were not modified. Their causes were not established by this interrupted run, and no neighbouring geometry or thresholds were changed. The separate post-review focused command was already queued before interruption; it validates the changed code, not a restart of the killed related run.


## Final corrected measurements

Completed 2026-11-03 20:20 JST, exit 0. Last generator lines:

```json
{"station":"ikebukuro","edges":0,"bakeMs":12788.480778999998,"elapsedMs":538097.101757}
{"station":"shinjuku","edges":15,"bakeMs":27086.117271999996,"elapsedMs":182870.01606}
```

| Station | fallback | unvalidatedJoins | invalidJoins | detours | offFloor | snap_failed exit stairs |
|---|---:|---:|---:|---:|---:|---:|
| ikebukuro | 1 → 0 | 62 → 120 | 0 → 120 | 0 → 0 | 0 → 0 | 1 → 0 |
| shinjuku | 6 → 15 | 146 → 208 | 0 → 0 | 2 → 2 | 0 → 0 | 0 → 1 |

The comparator is now `.qa/s5/r5/compare.py`; the historical run over `.qa/s5/final-output` reported **SHRINK-ONLY FAIL**. Both stations preserve routable/failed-pair coverage and have zero offFloor; connector samples without floor are now zero in both. Ikebukuro still grows connector wall samples 0 → 58 on `ne_j__x26` and has 120 invalid-join routes. Its only rejected published directions are `ne_j__x26:forward` and `ne_j__x26:reverse`. Shinjuku adds six suspect-edge failures and three gate failures; eight path directions remain rejected. Its detour list no longer grows after rejecting fare-gate bypasses.

All eight final generated files were copied back to `.qa/s5/final-output`. They remain untracked and were not promoted into the station directories because the required gate failed twice. No baseline reset, exemption list, height constant, probe, or legacy-builder patch was added.

## Handoff

The final snap-only candidate fails both shrink-only gates, and the related run was interrupted with failures. I ran two full station regenerations, corrected the physical connector interior and concrete Oracle findings, and kept committed baselines unchanged. The lead must resolve the remaining join/Exit 26 clip and Shinjuku gate/suspect connections before publishing new baked paths; this draft must not merge.

Denied actions: none. The interrupted related run is explicitly recorded above and was not rerun. No task-owned test or regeneration process remains running.
