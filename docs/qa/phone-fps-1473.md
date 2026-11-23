# J12 whole-walk phone frame rate — #1473

Reported 2026-11-21 09:46 JST. This change records the result of merged #1480;
it changes documentation and evidence images only. No new quality cuts.

## Whole-walk acceptance

| Measurement | Exact measured SHA | Desktop median / p5 fps | Phone median / p5 fps |
|---|---|---:|---:|
| Before, #1473 (2026-11-20 07:00 JST) | `3f0a988bf657707b20fd4f5ef3a08b925e5374de` | 62.50 / 54.95 | 17.57 / 14.77 |
| Current main after #1480 (2026-11-21 09:39–09:42 JST) | `6ec258d1d64530298f3fad6eb42b37e46a080dee` | 119.05 / 59.52 | 119.05 / 58.14 |

The before values are the published issue #1473 measurement, not a new paired
run. Current main meets desktop median ≥50 and phone median ≥30. Phone remains
Mac-GPU emulation, not a physical phone measurement; CPU throttling stays 4×.

Both profiles use headed Brave, Apple M2 Pro via ANGLE Metal, morning lighting,
and the natural default guide from Exit 1 to the Oedo platform. The FPS runs
include the entire walk, including its initial dip, without profiling, seeking,
fixed-step simulation or manually invoked rendering.

Desktop: high tier, 960×600 viewport, 1440×900 drawing buffer, 1× CPU;
15,221 frames over 153.283 s. Phone: low tier, mobile/touch, 412×839 viewport,
618×1258 drawing buffer, 4× CPU; 15,473 frames over 154.344 s.
The worst one-second bucket is the first second: desktop 48 fps, phone 13 fps.
No subsequent full one-second bucket falls below the respective target.

## CPU versus GPU

Separate diagnostic run at the same measured SHA, completed 2026-11-21
09:45 JST. These instrumented samples are not the FPS acceptance run.
At each frame below, advance the production guide deterministically, then run
120 requestAnimationFrame-paced production step/render calls at dt=1/60 s.
CPU entries are median main-thread wall times, including renderer submission
and possible waits; nested method times overlap and must not be added together.
GPU entries use `EXT_disjoint_timer_query_webgl2` around each complete render.
All samples report no GPU disjoint; 117/120 desktop and 119/120 phone queries
were available when read. Unavailable queries are excluded from GPU medians.
Renderer counters reset once per complete explorer frame, so totals include
all shadow, scene and post draws rather than only the last composer pass.

| Profile | Reel sample / simT | CPU step ms | CPU render ms | GPU render ms | Draw calls | Triangles |
|---|---|---:|---:|---:|---:|---:|
| Desktop | #0 / 4 s | 1.10 | 3.40 | 9.53 | 436 | 1,628,701 |
| Desktop | #14 / 60 s | 1.00 | 2.40 | 12.42 | 243 | 1,261,412 |
| Desktop | #29 / 120 s | 1.30 | 2.70 | 13.08 | 328 | 1,427,869 |
| Phone, 4× CPU | #0 / 4 s | 2.80 | 6.60 | 2.50 | 104 | 345,139 |
| Phone, 4× CPU | #14 / 60 s | 2.00 | 4.80 | 3.73 | 61 | 288,357 |
| Phone, 4× CPU | #29 / 120 s | 3.70 | 5.10 | 2.76 | 81 | 295,258 |

The phone's CPU-side step/render wall times exceed its GPU times in these
samples. Within the measured JS methods under 4× throttle, camera placement
costs 1.2–1.9 ms median, label updates 1.0–1.2 ms (including identity labels
0.4–0.8 ms), and station update 0.1–1.2 ms. Guide stepping itself rounds to
0.0 ms median. CDP CPU sampling profiles are retained with the raw artifacts.
The original expensive instanced-triangle camera raycasts were accelerated
in #1480; its [report](raycast-perf-1473.md) records the implementation and
full-walk camera comparisons. No further optimization is required for J12.

Desktop retains shadows and six enabled composer stages: scene, GTAO, floor
reflection, bloom, output and grade. Phone already uses no shadows and no
composer. Those existing tier differences are unchanged by this PR.

## Frames for art direction

These are representative GPU-host captures at the default journey reel's
sample times, not a new full CI reel. Screenshots precede each diagnostic
window. JPEG copies below are scaled to at most 1600 px; original PNGs remain
in the artifacts. Runtime, camera, geometry, lighting and quality settings are
unchanged from measured main. There are no before/after cut pairs because
this change introduces no cuts.

| Sample | simT | Desktop | Phone |
|---|---:|---|---|
| #0 | 4 s | [Frame](../release/evidence/2026-11-21-j12/shinjuku-desktop-000-4s.jpg) | [Frame](../release/evidence/2026-11-21-j12/shinjuku-phone-000-4s.jpg) |
| #14 | 60 s | [Frame](../release/evidence/2026-11-21-j12/shinjuku-desktop-014-60s.jpg) | [Frame](../release/evidence/2026-11-21-j12/shinjuku-phone-014-60s.jpg) |
| #29 | 120 s | [Frame](../release/evidence/2026-11-21-j12/shinjuku-desktop-029-120s.jpg) | [Frame](../release/evidence/2026-11-21-j12/shinjuku-phone-029-120s.jpg) |

## Commands and retained artifacts

- `job-run --id j12-baseline-6ec258d-retry -- tachi-run --heavy --host -- pnpm measure:gpu-fps`
  — exit 0, `2 passed (5.5m)`, completed 2026-11-21 09:42 JST.
- `job-run --id j12-main-profile-6ec258d --artifact /Volumes/KIOXIA/scratch/j12-main-evidence -- tachi-run --heavy --host -- node /Volumes/KIOXIA/scratch/j12-main-evidence/profile.cjs`
  — exit 0, `J12 CPU/GPU profiles and six reel frames captured.`, completed
  2026-11-21 09:45 JST.
- The first baseline attempt built successfully but stopped at
  `error: unknown command 'test'`. Installing the standalone E2E dependencies
  with `pnpm --dir tests/e2e install --frozen-lockfile` restored the local
  Playwright Test CLI; no manifest or lockfile changed.

Raw whole-walk JSON, diagnostic per-frame timings/counters, six CDP CPU
profiles, original PNGs and the profiling runner are retained at
`/Volumes/KIOXIA/scratch/j12-main-evidence/`. Raw ISO timestamps are UTC.
Job result/log directories are under `~/.local/state/job-run/` with the IDs
above. No extra tests were added or run; the draft PR uses normal CI.
