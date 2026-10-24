# S03 drawing-transform check — 2026-10-24

This is an offline evidence check of the acquired `tokyo-s03-zip`, independent of the station research scripts. It exports no route or public source positions. The public receipt contains hashes, numeric level IDs, counts and residuals; transformed nodes and provenance remain in the private store. Every result is `gteki_role: evidence`, `UNVERIFIED`, `NOT_FOR_ROUTING`. Source credit: 出典：東京都都市整備局「新宿駅周辺の施設情報等」. Modification: two affine transforms, horizontal projection and consistency statistics.

## Method

`gis s03-transform-check` obtains the ZIP through `getStoredSource`, re-hashes the exact buffer it parses, and reads ZIP names with the existing Shift_JIS convention. Required member basenames must be unique; missing members, malformed JSON, invalid geometry, drawing/level identity mismatches and ambiguous node levels fail closed. Every string in every source JSON member, including nested/localized properties and navigation tuple properties, is supplied to `assertNoSourceValues` before the public receipt is written. No source labels or coefficient arrays enter the receipt; it records their hashes and numeric IDs.

Apply `v5_nav.json.d[0].t`, then `com-map.geojson.drawings[0].ref_frame.transform`. Both use `[a,b,c,d,e,f]` with `u=a*x+c*y+e`, `v=b*x+d*y+f`. The second result is assumed longitude/latitude. The GIS `stationEnuProjector` supplies GRS80 horizontal ENU at the committed station origin, evaluated at zero height only for horizontal computation. Physical heights remain null. No translation, rotation, scale or datum correction is fitted.

Check A tests each level's nodes against the union of its own geometry polygons in ENU, including outer/hole boundaries and excluding hole interiors. Point/line features do not count as polygons. The policy fixes “overwhelmingly inside” at **95% overall and on each populated level**, before examining results. Outside-node distances use the nearest polygon edge in ENU. Empty or unprojectable distance samples remain null. The deliberately reversed affine composition is the negative control.

Check B independently selects reciprocal nearest nodes over all compatible floors, then applies inclusive distance thresholds. It uses the note's label-derived comparison ordinals, including E27 street ordinal 0 compared with source ground ordinal 1. Source `zlevel` is not an elevation or the comparison ordinal. Percentiles interpolate at `(n−1)*p`. Deltas mean S03 minus E27; their mean is reported and never applied. The selected overlap sample does not establish all-station coverage or an accepted connection.

## Observed results and input failure

The full command **FAILS CLOSED** before either check: two source polygon rings have nonidentical first/last positions. These are substantial endpoint gaps, not floating-point closure noise. A separate read-only diagnostic projected the stored endpoints without joining or moving them:

| Numeric level ID | Feature index (zero-based) | Polygon / ring index | Endpoint gap in horizontal ENU (m) |
| --- | ---: | --- | ---: |
| 64676 | 195 | 0 / 0 | 3.028552467 |
| 64679 | 0 | 0 / 0 | 48.922969786 |

The ZIP SHA-256 is `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31`. No ring was closed, dropped or repaired. Consequently **Check A's real containment shares, outside-edge statistics and swapped-order result remain UNKNOWN**. The full command writes no public transform receipt or private transformed-node GeoJSON/provenance for this rejected input. A director/lead decision on the malformed source is still needed before adopting the transform under this command's complete acceptance procedure.

A separate diagnostic using this module's pure affine/pairing functions, the hash-verified navigation/map members and the committed E27 graph reproduced **Check B only**, independently of polygon geometry:

| Threshold (m) | Reciprocal compatible-floor pairs |
| ---: | ---: |
| 1 | 4 |
| 2 | 8 |
| 3 | 12 |
| 5 | 15 |

For the 15 pairs within 5 m: **min 0.145701610 m, median 1.853869309 m, p90 3.366510600 m, max 3.418081058 m**. The mean S03-minus-E27 vector is **east +0.934294041 m, north +0.127433023 m**, length **0.942944606 m**; it was not applied. There are 22 reciprocal compatible-floor pairs before thresholding. The counts and median reproduce the note, including its 1.85 m rounded median; this selected overlap is not all-station accuracy or a set of accepted joins.

The current E27 graph hash is `06d6193124f0dc6d44a663c5a1bfdff224bcd0d71114fc303c154501555863be`, whereas the note recorded `37a24b303828755fbdbdb76f59d1b1a529e535cc16e9e3c19424468771cf928b`. The note's exact historical graph was found in local commit `0bdf68cd`: comparison confirms all 233 horizontal node positions and floor IDs are unchanged; nonhorizontal node data differ. The residuals have no numerical discrepancy to explain. These diagnostic numbers do not convert the failed full run into a PASS.

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
