# Partial r8 captures — 2026-11-22 JST

Capture source commit: `d638a9a6c0135ebca4825f5e09091e1fa5bf02a9`.
Job `depato-ikebukuro-capture-r8b` ran 2026-11-22 09:11:32–09:12:39 JST and exited 1.
Only **9 of 60 frames** completed: desktop next views through Parco walk. No phone, off, P'PARCO or Sunshine frame completed. These PNGs and raw [frames.json](frames.json) preserve the failed job's partial output; they have not been visually inspected in this follow-up.

The Parco replacement pose completed at 45.02 m horizontal sign distance, pitch 15°. All four completed look-frame measurements meet contrast ≥3:1 and facade/sky ≤0.8. The remaining look frames and the full 60-frame set are incomplete, so this is not visual acceptance.

## Measurements

Distances below are horizontal sign distances for walk frames. Facade/sky is the measured luminance ratio for look frames. Capture timestamps in frames.json are ISO UTC.

| Frame | Pitch ° | Horizontal m | Letter contrast | Facade/sky | Pose label |
|---|---:|---:|---:|---:|---|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | 15.00 | 59.83 | 7.094 | n/a | capture-only pose (outside walk coverage) |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 17.68 | n/a | 5.691 | 0.758 | capture-only pose (outside walk coverage) |
| [desktop-tobu-walk-next.png](desktop-tobu-walk-next.png) | 15.00 | 59.99 | 6.597 | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-look-next.png](desktop-tobu-look-next.png) | 30.18 | n/a | 8.097 | 0.771 | capture-only pose (outside walk coverage) |
| [desktop-lumine-walk-next.png](desktop-lumine-walk-next.png) | 15.00 | 59.93 | 2.455 | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-look-next.png](desktop-lumine-look-next.png) | 32.09 | n/a | 4.265 | 0.498 | capture-only pose (outside walk coverage) |
| [desktop-esola-walk-next.png](desktop-esola-walk-next.png) | 15.00 | 59.52 | 5.487 | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-look-next.png](desktop-esola-look-next.png) | 19.35 | n/a | 5.837 | 0.112 | capture-only pose (outside walk coverage) |
| [desktop-parco-walk-next.png](desktop-parco-walk-next.png) | 15.00 | 45.02 | 4.649 | n/a | capture-only pose (outside walk coverage) |

## Command and result

`job-run --id depato-ikebukuro-capture-r8b --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r8 -- sh -c 'nice -n 15 ego-browser nodejs < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r8.mjs'`

Last result line: `ego's nodejs process exited with code 1.`

Error:

```text
PageEvaluationTimeoutError: page.evaluate exceeded its 14000ms page-execution safety limit. The current JavaScript execution was stopped and the Page is ready for another command, but work scheduled earlier may still produce late side effects.
```

The timeout happened after `desktop-parco-walk-next.png` was saved and before `desktop-parco-look-next.png` completed. An earlier broad diagnostic evaluation hit the same execution limit; this is the second occurrence. The repeat-failure rule stops this capture path; no replacement job or alternate execution mechanism was started.

## CI

A single GitHub status snapshot at code commit `d638a9a6` (2026-11-22 JST) showed `changes` successful, CodeRabbit skipped and the remaining checks queued. No workflow was dispatched and no CI wait was started. Historical CI7 does not validate this source commit or the subsequent evidence commit.

## Assumptions

The evidence diff exceeds 300 lines because frames.json preserves nine raw camera/pixel measurement records. This follow-up changes no scene or capture code.

## Blocked

The 60-frame capture fails at the browser's 14-second page-evaluation limit. The broad diagnostic and the replacement capture both hit this limit. The lead must resolve the execution limit before the remaining 51 captures, visual inspection and complete measurement publication can resume.
