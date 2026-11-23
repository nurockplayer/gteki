# Lead follow-up — 2026-11-24 JST

PR #1512 stays draft. Merged origin/main `936bfe0f` in `4780635a`; GitHub then reported MERGEABLE and queued changes/test/reuse/root-test. Main depato metadata, asynchronous context cut and complete font subset are preserved along with the landmark preview.

Sunshine uses its existing 6 m cap limit, weight 800 and a narrower coverage transition instead of lighting nearly the whole minified band. The capture refreshes street context before looking up the Seibu sign. x35 uses the real follow camera with an ordinary held look-up pitch of 0.42 radians; desktop/phone lenses remain 55/65 degrees. Capture receipts determine whether these satisfy the bars.

## Tests — 2026-11-24 JST

`tachi-run -- pnpm exec vitest run stations/ikebukuro/scene/data_files.test.ts stations/ikebukuro/scene/identity.test.ts --maxWorkers=1`

Passed on product commit `ec51c507`: 2 files, 35 tests. Last result line: `tachi-run: end 2026-11-24 06:26 JST`; vitest duration `3.52s (tests 57%, transform 31%, import 12%)`. The two additional tests came from main.

`nice -n 15 node --check docs/visual/ikebukuro-landmarks-2026-11-22/capture-r13.mjs`: exit 0.

## Next — 2026-11-24 JST

First of two newly authorized capture runs: r13 records origin/main flag-off x18/x22 walks on both devices, then candidate next/off connectors and retained Seibu/P'PARCO/Sunshine walk/look frames plus x35 real-camera frames. The main snapshot is extracted from origin/main within this worktree and receives its own frozen offline dependency installation; no branch changes or shared package source substitution. Servers stop in finally blocks.

On resume, commit frames and compare baseline failures. If main reproduces them, open the requested breakage issue with pose/position evidence and link it in the PR. Otherwise fix the regression here. Record contrasts and whether the whole tower top is within the x35 frame. One capture run remains after r13. Final CI watch starts only after pushed final head shows checks.

## Assumptions — 2026-11-24 JST

Larger Sunshine lettering remains under the existing 6 m style maximum and on its current facade. x35 permits a normal player look-up through the follow-camera controls. Captures do not change the product camera or station fog/exposure. The diff exceeds 300 lines because merging main brings its existing changes and the capture driver records both sources.

## Launcher correction — 2026-11-24 JST

Job `depato-ikb-ai-r13` exited 2 before browser startup, 2026-11-24 06:27:30–06:29:02 JST. Exact error: `error: invalid --timeout-ms value "1500000": use 1 to 600000`. Main's frozen offline installation succeeded. No frames or walks were produced, so the two capture runs have not begun. The launcher now executes main and candidate scripts sequentially with the supported 600000 ms limit and reuses the prepared snapshot directory. Product code is unchanged; the passing two-spec result remains applicable.
