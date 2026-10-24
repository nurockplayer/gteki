# S03 drawing-transform check — 2026-10-24

This is an offline evidence check of the acquired `tokyo-s03-zip`, independent of the station research scripts. It exports no route or public source positions. The public receipt contains hashes, numeric level IDs, counts, residuals and source-defect records; transformed nodes, provenance and source endpoints remain in the private store. Every result is `gteki_role: evidence`, `UNVERIFIED`, `NOT_FOR_ROUTING`. Source credit: 出典：東京都都市整備局「新宿駅周辺の施設情報等」. Modification: two affine transforms, horizontal projection and consistency statistics.

## Method

`gis s03-transform-check` obtains the ZIP through `getStoredSource`, re-hashes the exact buffer it parses, and reads ZIP names with the existing Shift_JIS convention. Required member basenames must be unique; missing members, malformed JSON, invalid geometry, drawing/level identity mismatches and ambiguous node levels fail closed. Every string in every source JSON member, including nested/localized properties and navigation tuple properties, is supplied to `assertNoSourceValues` before the public receipt is written. No source labels or coefficient arrays enter the receipt; it records their hashes and numeric IDs.

Apply `v5_nav.json.d[0].t`, then `com-map.geojson.drawings[0].ref_frame.transform`. Both use `[a,b,c,d,e,f]` with `u=a*x+c*y+e`, `v=b*x+d*y+f`. The second result is assumed longitude/latitude. The GIS `stationEnuProjector` supplies GRS80 horizontal ENU at the committed station origin, evaluated at zero height only for horizontal computation. Physical heights remain null. No translation, rotation, scale or datum correction is fitted.

Check A tests each level's nodes against the union of its own geometry polygons in ENU, including outer/hole boundaries and excluding hole interiors. Point/line features do not count as polygons. A polygon feature is excluded from Check A entirely when any of its rings has a first position different from its last: rings are never closed, repaired, dropped or otherwise modified, and no implicit closure is applied (director ruling, 2026-10-24). The whole feature is excluded, the first offending polygon/ring is recorded as `SOURCE_DEFECT_UNCLOSED_RING` with its horizontal ENU endpoint gap, and every other malformation still fails closed. A level left without usable polygons keeps null inside metrics and a reason, and is not assessed. The policy fixes “overwhelmingly inside” at **95% overall and on each assessed level**, before examining results. Outside-node distances use the nearest polygon edge in ENU. Empty or unprojectable distance samples remain null. The deliberately reversed affine composition is the negative control.

Check B independently selects reciprocal nearest nodes over all compatible floors, then applies inclusive distance thresholds. It uses the note's label-derived comparison ordinals, including E27 street ordinal 0 compared with source ground ordinal 1. Source `zlevel` is not an elevation or the comparison ordinal. Percentiles interpolate at `(n−1)*p`. Deltas mean S03 minus E27; their mean is reported and never applied. The selected overlap sample does not establish all-station coverage or an accepted connection.

## Observed results

The run uses the ZIP with SHA-256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31`; the receipt is `transform-check-a7ccdb9007422f33546f.json` under policy `s03-transform-check-v2`.

### Source defects

Two source polygon features have a ring whose last position does not repeat the first. They are excluded from Check A and recorded as defects. No ring was closed, repaired, dropped or otherwise modified, and no vertex was changed:

| Numeric level ID | Feature index (zero-based) | Polygon / ring index | Source defect | Endpoint gap in horizontal ENU (m) |
| --- | ---: | --- | --- | ---: |
| 64676 | 195 | 0 / 0 | `SOURCE_DEFECT_UNCLOSED_RING` | 3.028552467 |
| 64679 | 0 | 0 / 0 | `SOURCE_DEFECT_UNCLOSED_RING` | 48.922969786 |

The endpoint gap is the horizontal ENU distance between the first and last ring positions, using the same station projector as Check A. Both gaps are substantial, not floating-point closure noise.

Check A uses all polygon features except 2 excluded for SOURCE_DEFECT_UNCLOSED_RING.

| Numeric level ID | Features total | Features used | Excluded (`SOURCE_DEFECT_UNCLOSED_RING`) | Non-polygon features excluded |
| ---: | ---: | ---: | ---: | ---: |
| 64672 | 12 | 12 | 0 | 0 |
| 64673 | 37 | 37 | 0 | 0 |
| 64674 | 338 | 277 | 0 | 61 |
| 64675 | 183 | 131 | 0 | 52 |
| 64676 | 1246 | 1098 | 1 | 147 |
| 64677 | 13125 | 13122 | 0 | 3 |
| 64678 | 309 | 277 | 0 | 32 |
| 64679 | 78 | 67 | 1 | 10 |
| 64680 | 142 | 103 | 0 | 39 |
| 64688 | 33 | 28 | 0 | 5 |
| 64689 | 53 | 50 | 0 | 3 |
| **All** | **15556** | **15202** | **2** | **352** |

### Check A (as-is)

| Numeric level ID | Nodes | Inside | Inside share | Outside | Outside-edge min / median / p90 / max (m) |
| ---: | ---: | ---: | ---: | ---: | --- |
| 64672 | 27 | 27 | 1.000000 | 0 | — |
| 64673 | 50 | 50 | 1.000000 | 0 | — |
| 64674 | 420 | 420 | 1.000000 | 0 | — |
| 64675 | 278 | 278 | 1.000000 | 0 | — |
| 64676 | 710 | 710 | 1.000000 | 0 | — |
| 64677 | 363 | 333 | 0.917355 | 30 | 0.014454 / 1.008816 / 2.234095 / 5.304428 |
| 64678 | 295 | 282 | 0.955932 | 13 | 1.091371 / 3.968638 / 6.788107 / 8.765265 |
| 64679 | 96 | 96 | 1.000000 | 0 | — |
| 64680 | 118 | 118 | 1.000000 | 0 | — |
| 64688 | 52 | 52 | 1.000000 | 0 | — |
| 64689 | 97 | 97 | 1.000000 | 0 | — |
| **All** | **2506** | **2463** | **0.982841** | **43** | per level only |

Overall **98.28% of 2506 nodes are inside**, and nine of the eleven levels are 100% inside. The fixed policy also requires **95% inside on every assessed level**, and level 64677 is **91.74% inside**, so the as-is run is **FAIL**, not overwhelmingly inside. Level 64678 is 95.59% inside and passes its own threshold. Nothing was tuned, refitted or adjusted in response; these are the unmodified results.

### Negative control (swapped order)

The reversed affine composition puts **0 of 2506** nodes inside (inside share 0), with all 2506 transformed points outside geographic range and therefore unprojectable. Its status is **FAIL** and no edge distance is asserted, as intended.

### Check B (reciprocal compatible-floor pairs)

| Threshold (m) | Reciprocal compatible-floor pairs |
| ---: | ---: |
| 1 | 4 |
| 2 | 8 |
| 3 | 12 |
| 5 | 15 |

For the 15 pairs within 5 m: **min 0.145701610 m, median 1.853869309 m, p90 3.366510600 m, max 3.418081058 m**. The mean S03-minus-E27 vector is **east +0.934294041 m, north +0.127433023 m**, length **0.942944606 m**; it was not applied. There are 22 reciprocal compatible-floor pairs before thresholding. The counts and median reproduce the note, including its 1.85 m rounded median (receipt `research_comparison.reproduced: true`); this selected overlap is not all-station accuracy or a set of accepted joins.

The current E27 graph hash is `06d6193124f0dc6d44a663c5a1bfdff224bcd0d71114fc303c154501555863be`, whereas the note recorded `37a24b303828755fbdbdb76f59d1b1a529e535cc16e9e3c19424468771cf928b`. The note's exact historical graph was found in local commit `0bdf68cd`: comparison confirms all 233 horizontal node positions and floor IDs are unchanged; nonhorizontal node data differ. The residuals have no numerical discrepancy to explain. The transform run now completes; the as-is Check A verdict above is still FAIL at the fixed per-level threshold.

## Outside-node diagnosis (64677, 64678)

This section is a diagnostic only. It recomputes the Check A containment rule independently and is stored as receipt field `internal_outside_diagnostic` with `diagnostic_only: true` and `main_check_a_modified: false`. It changes no main Check A result, status or threshold: the as-is run above stays **2463 of 2506 inside (0.982841), FAIL**, and the gate stays **HOLD**.

**Classification field.** The source navigation members have no stair, lift or escalator attribute (device type **UNKNOWN**). What they do have is the link tuple: `l[].d` is the direction (**1** forward, **2** reverse, **3** both), and `l[].dz` is present only when the two endpoints sit on different levels. Floor-transition ends are therefore identified structurally: a node is one when it is an endpoint of a link whose endpoints are on different levels or which carries `dz`. Class codes: **0** corridor (no incident cross-level link), **1** floor-transition end with one forward-only link, **2** one reverse-only link, **3** one bidirectional link, **4** mixed directions. No source node property on these levels was used, because none names a device.

### (a) Outside nodes by class

| Numeric level ID | Nodes | Outside | Class 0 outside / all | Class 1 outside / all | Class 2 outside / all | Class 3 outside / all | Class 4 outside / all |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64677 | 363 | 30 | 30 / 224 | 0 / 2 | 0 / 7 | 0 / 130 | 0 / 0 |
| 64678 | 295 | 13 | 13 / 231 | 0 / 3 | 0 / 5 | 0 / 56 | 0 / 0 |

Every outside node on both levels is a plain corridor node; none is an end of a cross-level link. The 139 floor-transition nodes on 64677 and the 64 on 64678 are all inside. The outside population is therefore not a stair/lift/escalator artefact as far as the available fields can tell.

### (b) Spread and direction

Positions are horizontal station ENU. The direction of each outside node is the unit vector from the node to its nearest polygon edge point; bearing is measured clockwise from east, and the circular spread is `sqrt(-2 ln R)` of the mean resultant length `R`.

| Numeric level ID | Outside nodes | Mean ENU east / north (m) | SD east / north (m) | RMS radius (m) | Mean unit vector east / north | Mean bearing | `R` | Circular spread | Distinct nearest polygons |
| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 64677 | 30 | 89.879778 / 480.542657 | 140.444466 / 193.412358 | 239.025079 | −0.492127 / −0.032757 | 183.808° | 0.493216 | 68.122° | 20 |
| 64678 | 13 | 115.686253 / 212.452242 | 72.327988 / 31.113925 | 78.736358 | 0.171179 / 0.338928 | 63.204° | 0.379703 | 79.737° | 6 |

8-sector histogram of the nearest-edge direction, sector order `0:east, 1:north-east, 2:north, 3:north-west, 4:west, 5:south-west, 6:south, 7:south-east`:

| Numeric level ID | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64677 | 2 | 1 | 5 | 1 | 13 | 5 | 2 | 1 |
| 64678 | 3 | 1 | 5 | 1 | 0 | 1 | 1 | 1 |

The outside nodes are spread over hundreds of metres (SD 140.444466 m east and 193.412358 m north on 64677; 72.327988 m and 31.113925 m on 64678), the resultant length is low (0.493216 and 0.379703), the mean directions of the two levels differ (183.808° and 63.204°), and the nodes touch 20 and 6 distinct nearest polygons. These numbers **do not support one systematic offset**; they are consistent with local polygon gaps and coverage differences that hit scattered corridor nodes. The offset size under discussion (0.94 m) is two orders of magnitude smaller than this spread.

### (c) Diagnostic offset (not adopted)

For this diagnostic only, the Check B mean S03-minus-E27 vector (**east −0.934294041 m, north −0.127433023 m**, exact receipt values, i.e. subtracting the recorded +0.934294041 / +0.127433023 m) was subtracted from every projected node and containment was re-evaluated. Flagged `diagnostic_offset_applied: true, adopted: false`; the main Check A result is untouched.

| Numeric level ID | Nodes | Inside, as-is | Inside share, as-is | Inside, offset applied | Inside share, offset applied |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 64677 | 363 | 333 | 0.917355 | 283 | 0.779614 |
| 64678 | 295 | 282 | 0.955932 | 280 | 0.949153 |
| **All** | **2506** | **2463** | **0.982841** | **2396** | **0.956105** |

The offset moves the inside rate **down**, on both target levels and overall (64674, 64676, 64688 and 64689 also lose nodes). A uniform shift in the Check B direction therefore does not explain the outside nodes, which matches the spread and direction evidence in (b). Nothing was adopted, no threshold was changed, and the as-is **FAIL** label stands.

## Datum assumption

```json
{
  "declared": null,
  "spec_statement": "absent crs means WGS84 (S03 spec p8)",
  "status": "UNKNOWN",
  "assumed_for_projection": "WGS84 lon/lat used as JGD2011 geographic; no realization/epoch correction",
  "asserted": false
}
```

The navigation JSON declares no CRS; the specification's absent-CRS statement concerns geographic geometry. This block records the comparison assumption. The combined residual includes datum/epoch, cartography and node-placement error. This check is not a survey certificate. The source realization/epoch, physical heights, cross-operator floor equivalence, current-world accuracy, present access/hours and accessibility remain UNKNOWN.

## Can S03 positions be published?

[Owner Q2](../decisions/owner-rights-questions.md) is Yes for neutral geometry and factual fields with the credit 出典：東京都都市整備局「新宿駅周辺の施設情報等」. It explicitly retains **CRS UNKNOWN**, unverified status and no routing; floor labels are not elevations. Q3 accepts the dataset grant over the general bureau-site reservation. Q4 excludes promotional prose, linked target content and the reference illustration. The [rights record](../rights/tokyo-s03-zip.json) clears the bounded subset with conditions and leaves the whole ZIP and promotional subset UNKNOWN.

This check adds reproducible evidence for the affine order, internal geometric consistency and a selected E27 overlap sample. It does not resolve the datum or establish survey accuracy, current conditions or route connectivity. A director ruling would need to decide whether these assumptions and residuals support publishing positions as **UNVERIFIED context** or **search-area hints**, with credit and clear uncertainty. Such a ruling would also need to specify the position subset, presentation and uncertainty treatment; positions would remain **NOT_FOR_ROUTING**. This run makes no publication ruling. The source gate stays **HOLD**.
