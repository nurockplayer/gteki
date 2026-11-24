# Shinjuku department-store R9 corrections — 2026-11-22 JST

Captured from `719f83da492abc9a056a9d628d8f07dc75fa6485`, 2026-11-22 19:50 JST. Only the four requested R8 views and their flag-off pairs were recaptured. PR #1511 stays draft.

The Keio/Lumine 1, Odakyu and Lumine 2 landmark sign meshes now use an unlit atlas material with fog disabled, removing directional specular glare. Keio and Lumine 1 share one sign mesh and material. Sign geometry, positions and sizes, station fog and exposure are unchanged. All four recaptured next frames exceed 3:1 contrast. The two frames with visible sky have facade/sky below 0.8; the other two have no visible sky and report N/A.

Keio’s previous 0.815/0.825 values are sign/reference, not facade/sky. Its facade/sky remains 0.590/0.683; sign/reference is now 0.332/0.339. Camera poses, distances, cap heights and panel coverage match R8. The desktop Lumine 2 close road-pose exception remains 15.86 m. Measurement uses the [R8 method](../r8/README.md#measurement-method); full telemetry is in [frames.json](frames.json). Flag-off rows have no landmark measurements; inherited next-frame telemetry in the raw saved pose does not apply to them.

## Replacement measurements — 2026-11-22 JST

| Frame | ja cap px | Contrast | Pitch up ° | Distance m | Facade/sky | Sign/reference | Pose |
|---|---:|---:|---:|---:|---:|---:|---|
| [desktop-odakyudept-walk-next.png](desktop-odakyudept-walk-next.png) | 81 | 6.83:1 | 11.64 | 25.52 | N/A | 0.322 | public pavement |
| [desktop-keio-walk-next.png](desktop-keio-walk-next.png) | 105 | 7.01:1 | 9.74 | 30.44 | 0.590 | 0.332 | public pavement |
| [desktop-lumine2-look-next.png](desktop-lumine2-look-next.png) | 125 | 6.97:1 | 6.75 | 15.86 | N/A | 0.206 | **EXCEPTION**; capture-only road |
| [desktop-odakyudept-walk-off.png](desktop-odakyudept-walk-off.png) | N/A | N/A | 11.64 | 25.52 | N/A | N/A | public pavement |
| [desktop-keio-walk-off.png](desktop-keio-walk-off.png) | N/A | N/A | 9.74 | 30.44 | N/A | N/A | public pavement |
| [desktop-lumine2-look-off.png](desktop-lumine2-look-off.png) | N/A | N/A | 6.75 | 15.86 | N/A | N/A | **EXCEPTION**; capture-only road |
| [phone-keio-walk-next.png](phone-keio-walk-next.png) | 100 | 6.99:1 | 9.74 | 30.44 | 0.683 | 0.339 | public pavement |
| [phone-keio-walk-off.png](phone-keio-walk-off.png) | N/A | N/A | 9.74 | 30.44 | N/A | N/A | public pavement |

## Capture result — 2026-11-22 JST

`job-run --id depato-shinjuku-r9 --artifact docs/visual/shinjuku-department-stores-2026-11-22/r9 -- nice -n 15 node tools/qa/depato-capture.mjs` — exit 0.

Last result: `2026-11-22 JST: completed four affected next frames and their off pairs`.

No local test suite was run, per brief. Vite and browser task space were stopped. The capture logged a failed import of `stations/shinjuku/navmesh-paths.json?import`; all eight captures completed. CI will be watched on the pushed evidence head.

Other R8 rows remain historical measurements. R8 contains facade/sky values above 0.8 in phone Isetan Men (0.894), Odakyu walk (0.829), Marui Annex walk (0.821) and Lumine Est walk (1.025). They were outside the four named recaptures and were not changed in R9; this is not an all-44-frame facade pass.
