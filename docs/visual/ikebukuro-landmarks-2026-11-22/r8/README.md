# r10 capture continuation — 2026-11-22 JST

The lead approved P'PARCO's previously captured clear public-road eye at **74.86 m**, leaving the sign in place. No public pavement point within 25–60 m faces the sign; the nearest sampled front-facing point is 70.05 m. This frame is a distance exception. If another store has no qualifying pose, capture uses the nearest clear sampled public-pavement pose and records its distance and exception in frames.json. Product code remains unchanged.

The remaining 50 captures will resume from the preserved 10 frames. Full-set visual inspection, complete PR measurements and final-head CI confirmation follow completion of the capture job. PR #1512 stays draft.

Job `depato-ikebukuro-capture-r10` exited 1 at 2026-11-22 19:17:41 JST: `Error: task space not found: 44`. No new frame was saved. The capture script now creates a named capture space when the former space no longer exists; `depato-ikebukuro-capture-r10b` resumes the same saved frames.

Job `depato-ikebukuro-capture-r10b` added both desktop P'PARCO next frames, bringing the set to **12/60**, then exited 1 at 2026-11-22 19:18:48 JST: `No clear public pavement pose: sunshine`. The prior Sunshine candidate file contained only 25–60 m samples, so could not supply a distance exception.

The same acquired source tile was SHA256-verified and sampled over 25–150 m from the current Sunshine sign, yielding 3,914 LOD3 road-polygon centroid samples. The nearest clear sample passing the existing full-sign, non-grazing sightline check is **65.86 m** away; no sampled pose within 25–60 m qualifies. This is an approved-rule distance exception, with the pose recorded in [r10-sunshine-pose.json](../r10-sunshine-pose.json) and the broader samples in [r10-sunshine-road-candidates.json](../r10-sunshine-road-candidates.json). Job `depato-ikebukuro-capture-r10c` resumes the remaining **48 frames**. Source coordinates retain TP heights and use the station's GRS80 ENU transform. No road geometry or product code is changed.

## Historical r9 result — 2026-11-22 JST

Capture source commit: `cb2afa72`; scene code remains `d638a9a6`. The first nine r8 frames are preserved. Job `depato-ikebukuro-capture-r9b` added `desktop-parco-look-next.png`, bringing the set to **10/60 frames**. It ran 2026-11-22 09:22:24–09:23:23 JST and exited 1 at P'PARCO walk. The bounded facade measurements got past the previous browser timeout.

These PNGs and [frames.json](frames.json) preserve the partial output. They have not been visually inspected in this follow-up; no complete visual acceptance is claimed. No phone, off, P'PARCO or Sunshine frame completed. All five completed look measurements meet contrast ≥3:1 and facade/sky ≤0.8.

## Measurements

Distances are horizontal sign distances for walk frames. Facade/sky is a luminance ratio for look frames. Raw capture timestamps are ISO UTC in frames.json.

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
| [desktop-parco-look-next.png](desktop-parco-look-next.png) | 16.05 | n/a | 7.952 | 0.564 | capture-only pose (outside walk coverage) |

## Command and result

`job-run --id depato-ikebukuro-capture-r9b --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r8 -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-capture-r9 --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r8.mjs'`

Exit 1. Error: `No full-sign public pavement pose at 25–60 m: pparco`.

## P'PARCO distance decision

A denser check sampled 2,291 distinct road points within 25–60 m in the shipped scene. All were behind the sign plane; the greatest facing dot product was −0.329. The four nearest-to-front samples tested were occluded by P'PARCO's own mesh at all six sign corner/edge probes.

The already acquired PLATEAU LOD3 road polygons were also checked outside the shipped window. Tile `plateau-13116-tran-53394576` (SHA256 `6cc53f9c3ddfa90423ae1ae5c5741ceb004be2ddd6580b533644c449a7d068f7`) supplied no qualifying front-facing centroid or sampled boundary point in the 25–60 m range; its nearest sampled front-facing road point was 70.05 m away. Tile `plateau-13116-tran-53394577` (SHA256 `052919a57424e9a6d33edc1bbaad8e2bdea91dac33ebaeb62c032769e0b52cb2`) supplied no sampled front-facing boundary point in that range even with the facing threshold reduced to positive. Source hashes were verified; coordinates use the station's GRS80 ENU transform with TP heights preserved. No road geometry was added.

The previously captured full-sign P'PARCO public-road pose is **74.86 m** horizontally from the sign. The lead must choose a P'PARCO distance exception using that pose or authorize moving the sign to meet 25–60 m. Recommendation: the distance exception preserves the requested capture/docs-only scope. No distance exception or product change was applied.

## Assumptions

The diff exceeds 300 lines because frames.json preserves the additional raw camera/pixel record. Product and capture code are unchanged in this follow-up. PR #1512 stays draft until art-director acceptance.

## Follow-ups

After the distance decision: capture the remaining 50 frames, inspect the full set, publish all per-frame contrasts and look-frame facade/sky ratios, and confirm CI on the final pushed head.

## Blocked

No qualifying P'PARCO 25–60 m public-road pose was found. Shipped-road and acquired-source samples were checked without moving the sign. The lead must authorize a distance exception or a sign relocation before the complete capture can resume.
