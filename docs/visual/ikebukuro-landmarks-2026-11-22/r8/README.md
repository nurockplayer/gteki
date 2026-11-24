# Completed r10 capture evidence — 2026-11-22 JST

PR #1512 stays **draft** for lead/art-director acceptance. **60/60 frames** are saved and visually inspected: 15 views × next/off × desktop/phone. Job `depato-ikebukuro-capture-r10c` exited **0**, running 2026-11-22 19:22:35–19:31:58 JST. It completed the remaining 48 frames after r10b saved the two P’PARCO desktop frames. Earlier jobs supplied the first 10. Product code remains `d638a9a6`; this continuation changes capture evidence/docs only. No signs moved.

## Visual inspection — 2026-11-22 JST

All 60 complete frames were inspected in 16 labelled contact sheets (long side ≤1600 px), plus two sheets of the 30 next-frame sign crops. All next frames show their store and sign within the viewport; all off frames show the corresponding context without the landmark layer. Sunshine’s landmark is absent in off frames. This is completed capture evidence; visual acceptance belongs to the lead/art director.

Observed limits: Lumine walk lettering is small and oblique; Sunshine walk lettering is too small to read at native size. Sunshine east-exit lettering has visible stippling across parts of the sign in both devices. No product changes or replacement captures were made after inspection.

Measured limits: Lumine walk Japanese cap height is **7.75 px desktop / 7.26 px phone**, with letter/background contrast **2.455 / 2.370**. Sunshine walk cap height is **2.77 / 2.59 px**, contrast **1.487 / 1.470**. These four frames are below the earlier 14 px and 3:1 targets. All 14 look frames have letter contrast ≥3:1. **13/14** look facade/sky ratios are ≤0.8; phone Seibu look is **0.858**, above that target. These limits are reported without asserting visual acceptance.

## Approved distance exceptions — 2026-11-22 JST

- **P’PARCO walk: 74.86 m horizontal**, for desktop/phone and matching off frames. The lead approved the previously captured clear public-pavement eye: no public pavement point within 25–60 m faces the sign; the nearest sampled front-facing point is 70.05 m away. The sign stays in place.
- **Sunshine walk: 65.86 m horizontal**, for desktop/phone and matching off frames. This is the nearest clear sampled public-road centroid passing the existing full-sign, non-grazing sightline check. No sampled pose within 25–60 m qualifies. The approved rule permits the nearest clear capture-only pavement pose when the band cannot be met.

The original Sunshine sample file contained only 25–60 m points and could not supply an exception. The same acquired `plateau-13116-tran-53394577` source was SHA256-verified (`052919a57424e9a6d33edc1bbaad8e2bdea91dac33ebaeb62c032769e0b52cb2`); broader sampling yielded **3,914 LOD3 road-polygon centroids over 25–150 m**. Coordinates use the station’s GRS80 ENU transform and preserve TP heights. No source-road geometry was added. [../r10-sunshine-pose.json](../r10-sunshine-pose.json) · [../r10-sunshine-road-candidates.json](../r10-sunshine-road-candidates.json).

## Capture method and measurements — 2026-11-22 JST

Every pose is labelled **capture-only pose (outside walk coverage)**: public road/pavement at eye height 1.6 m, without a navigability claim. The walker is held at x38. Desktop is 1440×900; phone is 390×844; lighting is morning, with shell and labels hidden. Sunshine east-exit uses the already selected clear road centroid **23.14 m from x35**.

Each next/off pair uses the same eye and target. Lumine walk off FOV differs from next by floating-point roundoff only (91.83412647965831° versus 91.8341264796583°); other pair FOVs match. Walk pitch is 15°. Look cameras retain their existing eyes and target the current sign.

Horizontal distances below are recomputed from each recorded eye and current sign aim; this also corrects the retained r6 Sunshine-look distance field to **104.92 m**. Japanese cap height is in CSS px. Letter contrast is the rendered letter/background luminance ratio, including haze and obliquity. Facade/sky is the mean visible upper-facade luminance divided by sampled adjacent unobstructed sky luminance, measured in look frames. Off frames have cap 0 and n/a sign/facade ratios because the landmark layer is absent. Camera/FOV, road IDs, anchors, source hashes, projected sign corners and facade/sky sample pairs are in [frames.json](frames.json); capture timestamps are ISO UTC. Retained `facadeDistanceM` fields are historical pose-selection metadata, not the horizontal distances reported here.

### Desktop — 2026-11-22 JST

| Frame | Pitch ° | Horizontal m | Ja cap px | Letter contrast | Facade/sky | Pose label |
|---|---:|---:|---:|---:|---:|---|
| [desktop-seibu-walk-next.png](desktop-seibu-walk-next.png) | 15.00 | 59.83 | 20.26 | 7.094 | n/a | capture-only pose (outside walk coverage) |
| [desktop-seibu-look-next.png](desktop-seibu-look-next.png) | 17.68 | 80.00 | 25.17 | 5.691 | 0.758 | capture-only pose (outside walk coverage) |
| [desktop-tobu-walk-next.png](desktop-tobu-walk-next.png) | 15.00 | 59.99 | 16.70 | 6.597 | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-look-next.png](desktop-tobu-look-next.png) | 30.18 | 80.00 | 25.12 | 8.097 | 0.771 | capture-only pose (outside walk coverage) |
| [desktop-lumine-walk-next.png](desktop-lumine-walk-next.png) | 15.00 | 59.93 | 7.75 | 2.455 | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-look-next.png](desktop-lumine-look-next.png) | 32.09 | 120.00 | 25.17 | 4.265 | 0.498 | capture-only pose (outside walk coverage) |
| [desktop-esola-walk-next.png](desktop-esola-walk-next.png) | 15.00 | 59.52 | 19.95 | 5.487 | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-look-next.png](desktop-esola-look-next.png) | 19.35 | 80.00 | 25.16 | 5.837 | 0.112 | capture-only pose (outside walk coverage) |
| [desktop-parco-walk-next.png](desktop-parco-walk-next.png) | 15.00 | 45.02 | 18.39 | 4.649 | n/a | capture-only pose (outside walk coverage) |
| [desktop-parco-look-next.png](desktop-parco-look-next.png) | 16.05 | 120.00 | 23.41 | 7.952 | 0.564 | capture-only pose (outside walk coverage) |
| [desktop-pparco-walk-next.png](desktop-pparco-walk-next.png) **exception** | 15.00 | 74.86 | 16.61 | 6.896 | n/a | capture-only pose (outside walk coverage) |
| [desktop-pparco-look-next.png](desktop-pparco-look-next.png) | 11.75 | 80.00 | 23.40 | 7.720 | 0.558 | capture-only pose (outside walk coverage) |
| [desktop-sunshine-walk-next.png](desktop-sunshine-walk-next.png) **exception** | 15.00 | 65.86 | 2.77 | 1.487 | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-look-next.png](desktop-sunshine-look-next.png) | 64.60 | 104.92 | 27.74 | 6.688 | 0.621 | capture-only pose (outside walk coverage) |
| [desktop-sunshine-east-exit-next.png](desktop-sunshine-east-exit-next.png) | 26.75 | 436.78 | 24.85 | 4.286 | n/a | capture-only pose (outside walk coverage) |
| [desktop-seibu-walk-off.png](desktop-seibu-walk-off.png) | 15.00 | 59.83 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-seibu-look-off.png](desktop-seibu-look-off.png) | 17.68 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-walk-off.png](desktop-tobu-walk-off.png) | 15.00 | 59.99 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-tobu-look-off.png](desktop-tobu-look-off.png) | 30.18 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-walk-off.png](desktop-lumine-walk-off.png) | 15.00 | 59.93 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-lumine-look-off.png](desktop-lumine-look-off.png) | 32.09 | 120.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-walk-off.png](desktop-esola-walk-off.png) | 15.00 | 59.52 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-esola-look-off.png](desktop-esola-look-off.png) | 19.35 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-parco-walk-off.png](desktop-parco-walk-off.png) | 15.00 | 45.02 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-parco-look-off.png](desktop-parco-look-off.png) | 16.05 | 120.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-pparco-walk-off.png](desktop-pparco-walk-off.png) **exception** | 15.00 | 74.86 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-pparco-look-off.png](desktop-pparco-look-off.png) | 11.75 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-walk-off.png](desktop-sunshine-walk-off.png) **exception** | 15.00 | 65.86 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-look-off.png](desktop-sunshine-look-off.png) | 64.60 | 104.92 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [desktop-sunshine-east-exit-off.png](desktop-sunshine-east-exit-off.png) | 26.75 | 436.78 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |

### Phone — 2026-11-22 JST

| Frame | Pitch ° | Horizontal m | Ja cap px | Letter contrast | Facade/sky | Pose label |
|---|---:|---:|---:|---:|---:|---|
| [phone-seibu-walk-next.png](phone-seibu-walk-next.png) | 15.00 | 59.83 | 19.00 | 7.006 | n/a | capture-only pose (outside walk coverage) |
| [phone-seibu-look-next.png](phone-seibu-look-next.png) | 17.68 | 80.00 | 19.36 | 5.244 | 0.858 | capture-only pose (outside walk coverage) |
| [phone-tobu-walk-next.png](phone-tobu-walk-next.png) | 15.00 | 59.99 | 15.66 | 6.334 | n/a | capture-only pose (outside walk coverage) |
| [phone-tobu-look-next.png](phone-tobu-look-next.png) | 30.18 | 80.00 | 19.32 | 7.460 | 0.683 | capture-only pose (outside walk coverage) |
| [phone-lumine-walk-next.png](phone-lumine-walk-next.png) | 15.00 | 59.93 | 7.26 | 2.370 | n/a | capture-only pose (outside walk coverage) |
| [phone-lumine-look-next.png](phone-lumine-look-next.png) | 32.09 | 120.00 | 19.36 | 3.715 | 0.637 | capture-only pose (outside walk coverage) |
| [phone-esola-walk-next.png](phone-esola-walk-next.png) | 15.00 | 59.52 | 18.71 | 5.367 | n/a | capture-only pose (outside walk coverage) |
| [phone-esola-look-next.png](phone-esola-look-next.png) | 19.35 | 80.00 | 19.36 | 5.124 | 0.123 | capture-only pose (outside walk coverage) |
| [phone-parco-walk-next.png](phone-parco-walk-next.png) | 15.00 | 45.02 | 17.25 | 4.543 | n/a | capture-only pose (outside walk coverage) |
| [phone-parco-look-next.png](phone-parco-look-next.png) | 16.05 | 120.00 | 18.00 | 7.411 | 0.588 | capture-only pose (outside walk coverage) |
| [phone-pparco-walk-next.png](phone-pparco-walk-next.png) **exception** | 15.00 | 74.86 | 15.58 | 6.672 | n/a | capture-only pose (outside walk coverage) |
| [phone-pparco-look-next.png](phone-pparco-look-next.png) | 11.75 | 80.00 | 18.00 | 7.048 | 0.609 | capture-only pose (outside walk coverage) |
| [phone-sunshine-walk-next.png](phone-sunshine-walk-next.png) **exception** | 15.00 | 65.86 | 2.59 | 1.470 | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-look-next.png](phone-sunshine-look-next.png) | 64.60 | 104.92 | 17.67 | 5.678 | 0.630 | capture-only pose (outside walk coverage) |
| [phone-sunshine-east-exit-next.png](phone-sunshine-east-exit-next.png) | 26.75 | 436.78 | 19.12 | 4.328 | n/a | capture-only pose (outside walk coverage) |
| [phone-seibu-walk-off.png](phone-seibu-walk-off.png) | 15.00 | 59.83 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-seibu-look-off.png](phone-seibu-look-off.png) | 17.68 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-tobu-walk-off.png](phone-tobu-walk-off.png) | 15.00 | 59.99 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-tobu-look-off.png](phone-tobu-look-off.png) | 30.18 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-lumine-walk-off.png](phone-lumine-walk-off.png) | 15.00 | 59.93 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-lumine-look-off.png](phone-lumine-look-off.png) | 32.09 | 120.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-esola-walk-off.png](phone-esola-walk-off.png) | 15.00 | 59.52 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-esola-look-off.png](phone-esola-look-off.png) | 19.35 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-parco-walk-off.png](phone-parco-walk-off.png) | 15.00 | 45.02 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-parco-look-off.png](phone-parco-look-off.png) | 16.05 | 120.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-pparco-walk-off.png](phone-pparco-walk-off.png) **exception** | 15.00 | 74.86 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-pparco-look-off.png](phone-pparco-look-off.png) | 11.75 | 80.00 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-walk-off.png](phone-sunshine-walk-off.png) **exception** | 15.00 | 65.86 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-look-off.png](phone-sunshine-look-off.png) | 64.60 | 104.92 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |
| [phone-sunshine-east-exit-off.png](phone-sunshine-east-exit-off.png) | 26.75 | 436.78 | 0.00 | n/a | n/a | capture-only pose (outside walk coverage) |

## Tests — 2026-11-22 JST

`Test: none`, as instructed. Capture command:

`nice -n 15 job-run --id depato-ikebukuro-capture-r10c --artifact docs/visual/ikebukuro-landmarks-2026-11-22/r8 -- sh -c 'nice -n 15 ego-browser nodejs --session ikb-capture-r10b --timeout-ms 600000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r8.mjs'`

Result: **exit 0**, job status **ok**. The job log tail was empty; no last output line was emitted. The saved [frames.json](frames.json) contains **60 frames** (30 next, 30 off; 30 desktop, 30 phone), and all 60 PNGs were inspected.

## Assumptions — 2026-11-22 JST

Nearest means nearest clear **sampled** public-road centroid under the existing full-sign, non-grazing sightline rule. P’PARCO uses its explicitly approved previous eye. The diff exceeds 300 lines because it preserves the remaining 48 PNGs and their raw per-frame camera/pixel measurement records. Product code is unchanged.

## Follow-ups — 2026-11-22 JST

Lead/art-director judgment of the reported readability, stippling and facade/sky limits. Confirm CI on the final pushed evidence head; historical green checks do not certify the new head. PR remains draft.

## Blocked — 2026-11-22 19:34 JST

`gh workflow list` was denied with HTTP 403: `API rate limit exceeded for user ID 9923669` (GitHub timestamp 2026-11-22 10:34:38 UTC). That request was not retried. Capture and visual inspection are complete; final-head CI status must be read separately.
