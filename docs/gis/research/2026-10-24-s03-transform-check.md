# S03 drawing-transform check — 2026-10-24

This is an offline evidence check of the acquired `tokyo-s03-zip`, independent of the station research scripts. It exports no route or public source positions. The public receipt contains hashes, numeric level IDs, counts, residuals and source-defect records; transformed nodes, provenance, source endpoints and every absolute ENU position statistic remain in the private store. Every result is `gteki_role: evidence`, `UNVERIFIED`, `NOT_FOR_ROUTING`. Source credit: 出典：東京都都市整備局「新宿駅周辺の施設情報等」. Modification: two affine transforms, horizontal projection and consistency statistics.

## Method

`gis s03-transform-check` obtains the ZIP through `getStoredSource`, re-hashes the exact buffer it parses, and reads ZIP names with the existing Shift_JIS convention. Required member basenames must be unique; missing members, malformed JSON, invalid geometry, drawing/level identity mismatches and ambiguous node levels fail closed. Every string in every source JSON member, including nested/localized properties and navigation tuple properties, is supplied to `assertNoSourceValues` before the public receipt is written. No source labels or coefficient arrays enter the receipt; it records their hashes and numeric IDs.

Apply `v5_nav.json.d[0].t`, then `com-map.geojson.drawings[0].ref_frame.transform`. Both use `[a,b,c,d,e,f]` with `u=a*x+c*y+e`, `v=b*x+d*y+f`. The second result is assumed longitude/latitude. The GIS `stationEnuProjector` supplies GRS80 horizontal ENU at the committed station origin, evaluated at zero height only for horizontal computation. Physical heights remain null. No translation, rotation, scale or datum correction is fitted.

Check A tests each level's nodes against the union of its own geometry polygons in ENU, including outer/hole boundaries and excluding hole interiors, after requiring shell membership first so a hole boundary outside its shell can never contain a point. Point/line features do not count as polygons. A polygon feature is excluded from Check A entirely, whole, on either of two director rulings of 2026-10-24: any of its rings has a first position different from its last, comparing the complete positions including an optional third value before z is dropped for horizontal maths; or any of its hole vertices lies strictly outside its shell. Rings are never closed, clipped, repaired, dropped or otherwise modified, no vertex is moved and no implicit closure is applied. The first offending polygon/ring is recorded — `SOURCE_DEFECT_UNCLOSED_RING` with its horizontal ENU endpoint gap, `SOURCE_DEFECT_HOLE_OUTSIDE_SHELL` with the offset of the worst offending hole vertex from its shell — and the exclusions are counted by kind. Every other malformation still fails closed; a self-intersecting ring does so even on a feature one of the rulings would drop. The self-intersection test is an O(n²) proper-crossing check on rings of up to 2000 vertices; a larger ring is counted as unchecked, never as clean. A level left without usable polygons keeps null inside metrics and a reason, and is not assessed. The policy fixes “overwhelmingly inside” at **95% overall and on each assessed level**, before examining results, and the overall status distinguishes **PASS** (threshold met everywhere, no node on an unassessed level) from **INCOMPLETE** (the assessed part would pass, but nodes remain on levels without usable polygons; `nodes_unassessed` and `levels_with_nodes_unassessed` say how many and where) from **FAIL** (the assessed part already fails). Outside-node distances use the nearest polygon edge in ENU. Empty or unprojectable distance samples remain null. The deliberately reversed affine composition is the negative control.

Check B independently selects reciprocal nearest nodes over all compatible floors, then applies inclusive distance thresholds. It uses the note's label-derived comparison ordinals, including E27 street ordinal 0 compared with source ground ordinal 1. Source `zlevel` is not an elevation or the comparison ordinal. The ordinals come from `station.json`, and the canonical SHA-256 of the floor mapping actually used (floor id to ordinal, sorted by id) is part of the receipt identity, so moving one ordinal changes the run id. Percentiles interpolate at `(n−1)*p`. Deltas mean S03 minus E27; their mean is reported and never applied. The selected overlap sample does not establish all-station coverage or an accepted connection.

## Observed results

### v4 revision: the source topology defect is excluded by ruling

Policy `s03-transform-check-v3` added the INCOMPLETE status, the hole/shell and self-intersection fail-closed rules, the full-position ring-closure test, the floor-mapping hash in the receipt identity and private-only outside-node means. Under it the real run stopped, before writing any receipt, on one hole that lies outside its shell:

| Numeric level ID | Feature index | Kind |
| ---: | ---: | --- |
| 64676 | 384 | hole ring 1 of multipolygon part 1 has every vertex outside its shell |

Measured on the private copy: the part is a sliver of about 0.16 m² whose hole is about 0.16 m² (ratio 1.03), its bounding boxes overlap, and its worst vertex lies 0.511531 m from the nearest shell point in horizontal ENU; all 4 unique hole positions, plus the repeated closing position, are outside. It is 1 of 15,556 features (15,204 polygon features); no ring in the dataset self-intersects, none exceeds the 2000-vertex cap, and the two known unclosed rings are unchanged.

Policy `s03-transform-check-v4` applies the director ruling of 2026-10-24: this feature is excluded whole, exactly like an unclosed ring, and recorded as `SOURCE_DEFECT_HOLE_OUTSIDE_SHELL`. It is never clipped, repaired or moved, every other malformation still fails closed, and no v3 receipt was ever written, so nothing was reissued under an old policy. The exclusion changes **0 of 2506 nodes and 0 of 2463 inside**, with every per-level inside count identical: no node changed side. The only numbers that move are the coverage counts, by exactly this feature — `features_used` 15202 → 15201, and level 64676 uses 1097 instead of 1098 features and 1247 instead of 1256 polygon surfaces.

The tables in this section are the run under `s03-transform-check-v4` (receipt `transform-check-d482981cd55e9f9010c6.json`), which replaces the v2 receipt `transform-check-a7ccdb9007422f33546f.json`.

The run uses the ZIP with SHA-256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31`. The run id changed from the v2 receipt because the identity now includes the policy version and `floor_mapping_sha256`.

### Source defects

Three source polygon features are excluded from Check A by the two rulings and recorded as defects: two have a ring whose last position does not repeat the first, one has a hole whose vertices lie outside its shell. No ring was closed, clipped, repaired, dropped or otherwise modified, and no vertex was changed:

| Numeric level ID | Feature index (zero-based) | Polygon / ring index | Source defect | Gap / offset in horizontal ENU (m) |
| --- | ---: | --- | --- | ---: |
| 64676 | 195 | 0 / 0 | `SOURCE_DEFECT_UNCLOSED_RING` | 3.028552467 |
| 64676 | 384 | 1 / 1 | `SOURCE_DEFECT_HOLE_OUTSIDE_SHELL` | 0.511531472 |
| 64679 | 0 | 0 / 0 | `SOURCE_DEFECT_UNCLOSED_RING` | 48.922969786 |

The gap is the horizontal ENU distance between the first and last ring positions, and the offset is the horizontal ENU distance from the worst offending hole vertex to the nearest point of its shell; both use the same station projector as Check A. Both gaps are substantial, not floating-point closure noise.

Check A uses all polygon features except 3 excluded by director ruling: 2 for SOURCE_DEFECT_UNCLOSED_RING and 1 for SOURCE_DEFECT_HOLE_OUTSIDE_SHELL.

| Numeric level ID | Features total | Features used | Excluded (`SOURCE_DEFECT_UNCLOSED_RING`) | Excluded (`SOURCE_DEFECT_HOLE_OUTSIDE_SHELL`) | Non-polygon features excluded |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 64672 | 12 | 12 | 0 | 0 | 0 |
| 64673 | 37 | 37 | 0 | 0 | 0 |
| 64674 | 338 | 277 | 0 | 0 | 61 |
| 64675 | 183 | 131 | 0 | 0 | 52 |
| 64676 | 1246 | 1097 | 1 | 1 | 147 |
| 64677 | 13125 | 13122 | 0 | 0 | 3 |
| 64678 | 309 | 277 | 0 | 0 | 32 |
| 64679 | 78 | 67 | 1 | 0 | 10 |
| 64680 | 142 | 103 | 0 | 0 | 39 |
| 64688 | 33 | 28 | 0 | 0 | 5 |
| 64689 | 53 | 50 | 0 | 0 | 3 |
| **All** | **15556** | **15201** | **2** | **1** | **352** |

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

**Classification field.** The source navigation members have no stair, lift or escalator attribute (device type **UNKNOWN**). What they do have is the link tuple: `l[].d` is the direction (**1** forward, **2** reverse, **3** both), and `l[].dz` is present only when the two endpoints sit on different levels. Floor-transition ends are therefore identified structurally: a node is one when it is an endpoint of a link whose endpoints are on different levels, or of a same-level link with a non-zero `dz`; a same-level `dz` of 0 is a corridor link. The dataset contains no such link — all 2,407 same-level links carry no `dz` and no link anywhere has `dz` = 0 — so the class counts below are unchanged by that rule. Class codes: **0** corridor (no incident cross-level link), **1** floor-transition end with one forward-only link, **2** one reverse-only link, **3** one bidirectional link, **4** mixed directions. No source node property on these levels was used, because none names a device.

### (a) Outside nodes by class

| Numeric level ID | Nodes | Outside | Class 0 outside / all | Class 1 outside / all | Class 2 outside / all | Class 3 outside / all | Class 4 outside / all |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64677 | 363 | 30 | 30 / 224 | 0 / 2 | 0 / 7 | 0 / 130 | 0 / 0 |
| 64678 | 295 | 13 | 13 / 231 | 0 / 3 | 0 / 5 | 0 / 56 | 0 / 0 |

Every outside node on both levels is a plain corridor node; none is an end of a cross-level link. The 139 floor-transition nodes on 64677 and the 64 on 64678 are all inside. The outside population is therefore not a stair/lift/escalator artefact as far as the available fields can tell.

### (b) Spread and direction

Positions are horizontal station ENU. The direction of each outside node is the unit vector from the node to its nearest polygon edge point. The bearing is the raw `atan2(north, east)` angle in **degrees counter-clockwise from east**; the compass column is the same direction measured clockwise from north (`(90 − raw) mod 360`). The circular spread is `sqrt(-2 ln R)` of the mean resultant length `R`. Absolute ENU means locate nodes, so they are not published: they stay in the private provenance, and the public per-level summary keeps only counts, standard deviations, RMS radius, directions and the count of distinct nearest polygons. A level with fewer than three outside nodes publishes only its two counts and `suppressed: "fewer than 3 nodes"`; both levels here have more than three.

| Numeric level ID | Outside nodes | SD east / north (m) | RMS radius (m) | Mean unit vector east / north | Bearing (ccw from east) | Compass bearing | `R` | Circular spread | Distinct nearest polygons |
| ---: | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 64677 | 30 | 140.444466 / 193.412358 | 239.025079 | −0.492127 / −0.032757 | 183.808° | 266.192° | 0.493216 | 68.122° | 20 |
| 64678 | 13 | 72.327988 / 31.113925 | 78.736358 | 0.171179 / 0.338928 | 63.204° | 26.796° | 0.379703 | 79.737° | 6 |

8-sector histogram of the nearest-edge direction, sector order `0:east, 1:north-east, 2:north, 3:north-west, 4:west, 5:south-west, 6:south, 7:south-east`:

| Numeric level ID | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64677 | 2 | 1 | 5 | 1 | 13 | 5 | 2 | 1 |
| 64678 | 3 | 1 | 5 | 1 | 0 | 1 | 1 | 1 |

The outside nodes are spread over hundreds of metres (SD 140.444466 m east and 193.412358 m north on 64677; 72.327988 m and 31.113925 m on 64678), the resultant length is low (0.493216 and 0.379703), the mean directions of the two levels differ (183.808° and 63.204° counter-clockwise from east), and the nodes touch 20 and 6 distinct nearest polygons. These numbers **do not support one systematic offset**; they are consistent with local polygon gaps and coverage differences that hit scattered corridor nodes. The offset size under discussion (0.94 m) is two orders of magnitude smaller than this spread.

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
