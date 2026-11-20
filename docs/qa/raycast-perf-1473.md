# J12 instanced collision raycasts — #1473

Reported 2026-11-20 10:37 JST. PR #1480.

## Change and source

Native instanced collision meshes now use the existing shared geometry BVH,
with a geometry-local bounding box for per-instance rejection. Each cast reads
current instance matrices, including writes before the GPU upload version changes.
Three still computes triangle hits; material sides, draw ranges, face and instance
identity, ordering, portal filtering and custom raycasts retain their semantics.

Measured product commit: `f8c7e7c31b8b40c7939dd5587d282b71fd31f9f1`.
Compared main: `c3c94d0d71a407e19595447e7f217f81ccfaef6f`.
This report adds no product change.

## FPS

Brave 158.0.8127.42, headed Chromium, ANGLE Metal / Apple M2 Pro.
Whole natural guide walk, real cold-open click, Exit 1 to Oedo platform,
`?qaTimeBand=morning`; no seeking, fixed-step simulation or profiling in FPS runs.
The harness is spec 32 and its config from open PR #1470 at
`88a3e8ce1d595fafaf04eddebe5aa1fe14048afc`, copied into scratch because
this checkout lacks `measure:gpu-fps`. Only paths were adjusted; the measurement
logic, geometry and throttling were retained. Scratch pins pnpm 12.11.2.

| Run | Throttle | Median fps | p5 fps | Completed (JST) |
|---|---:|---:|---:|---|
| Candidate desktop, first run | 1x | 40.82 | 29.94 | 2026-11-20 08:18 |
| Candidate phone | 4x | 65.36 | 54.64 | 2026-11-20 08:21 |
| Main desktop, comparison run | 1x | 104.17 | 57.47 | 2026-11-20 10:30 |
| Candidate desktop, comparison run | 1x | 119.05 | 59.52 | 2026-11-20 10:33 |

Phone uses the low tier, 412x839 viewport and 618x1258 drawing buffer.
Desktop uses the high tier, 960x600 viewport and 1440x900 drawing buffer.
The first desktop result failed the brief, prompting sequential main/candidate
measurement in the next heavy job. Its cause was not isolated. Both comparison
runs exceed the desktop floor; the candidate improves over the paired main run.
The phone median exceeds 30 fps at the unchanged 4x throttle, and the comparison
candidate desktop exceeds median 62.5 / p5 55.0.

The main comparison build substitutes only main's `meshBvh.ts` through a scratch
Vite resolver. Its JSON observer reports the worktree's candidate Git HEAD;
`mainSha` in the pose report and the resolver identify the actual baseline code.

## Camera poses and fingerprints

Separate deterministic replay of the full default guide, 9,151 frames per profile
and version, fixed dt 1/60 s and CPU throttle 1x. Each frame calls production
`step` and `render`, including moving scene instances and render callbacks.
Comparison includes camera position, quaternion, FOV, projection matrix, avatar
position and guide distance. FPS measurement above uses natural frames instead.

| Profile | Maximum position component difference (m) | Maximum quaternion component difference | FOV / projection / guide state difference |
|---|---:|---:|---:|
| Desktop | 1.4006541970701392e-7 | 4.3163495361264737e-8 | 0 / 0 / 0 |
| Phone | 0 | 0 | 0 / 0 / 0 |

Assumed float comparison tolerance: absolute 1e-6 per component (one micrometre
for positions). Both profiles pass within that tolerance; no visual change is
indicated. The desktop result is numerically different, not bit-identical.
The scratch checker originally used a stricter 1e-9 tolerance and exited 1 for
desktop; its original failed verdict is preserved rather than rewritten.

SHA-256 over the complete JSON pose arrays:

- Main desktop: `cd2edbc13f216f6ab9a9c658a1086fb04c60388320591c0bebde5525a8aec883`
- Candidate desktop: `648789f0f9b3119039371fff186d8685f4b4d8886cb7b2041d1603f7e8febd9b`
- Main and candidate phone: `549ed3f8e0f28ac91a4a44923353948be8795cac5daf9e4fb5aa04aa9e641e7d`

## Tests and artifacts

- `tachi-run -- pnpm exec vitest run apps/web/src/explorer/meshBvh.test.ts --maxWorkers=1`
  — exit 0; `Tests 12 passed (12)` (2026-11-20 08:01 JST).
- `job-run --id raycast-1473-acceptance-r2 --artifact /Volumes/KIOXIA/scratch/raycast-perf-1473 -- tachi-run --heavy --host -- sh /Volumes/KIOXIA/scratch/raycast-perf-1473/run.sh`
  — FPS specs passed; later baseline build failed because the source extraction
  had been truncated by RTK. Corrected with `rtk proxy git show`.
- `job-run --id raycast-1473-poses-r3 --artifact /Volumes/KIOXIA/scratch/raycast-perf-1473 -- tachi-run --heavy --host -- sh /Volumes/KIOXIA/scratch/raycast-perf-1473/resume-poses.sh`
  — desktop specs each ended `1 passed`; all four pose walks completed.
  Exit 1 from `POSE COMPARISON` desktop `pass:false` at 1e-9, as described above.
  The final shell FPS assertion was consequently not reached; the recorded
  FPS numbers independently satisfy its thresholds.

An earlier job stopped before measurement on `ERR_PNPM_BAD_PM_VERSION`; pinning
the scratch package to pnpm 12.11.2 fixed it. No product edits were needed for
these harness failures. The brief-wide explorer Vitest command is left to
cx-exec as instructed, rather than repeated here.

Artifacts: `/Volumes/KIOXIA/scratch/raycast-perf-1473/` contains original per-frame
FPS JSON and reports under `artifacts/gpu-fps/` (first desktop retained as
`desktop-r2.json`), baseline desktop under `artifacts/gpu-fps-main/`, the four
`poses-{main,candidate}-{desktop,phone}.json` arrays, original
`pose-comparison.json`, derived `acceptance-summary.json`, and all scratch runners.
Raw timestamps are ISO UTC; times in this report are JST.
