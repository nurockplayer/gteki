# shinjuku-s03-v0

Four coordinate frames appear in one archive across its member types: standard level GeoJSON in WGS84 lon/lat; Path GeoJSON in a declared local frame that is **UNVERIFIED** in this pass; `v5_nav.json` in its own venue-local `mx`/`my` frame; and the drawing-local frame between them, reached from `v5_nav` by the first affine. The two affines that take the nav frame to geographic coordinates are scoped to `v5_nav.json` only. The nav member is **not geographic** and declares no CRS.

Source: `tokyo-s03-zip` (2,317,035 B, SHA-256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31`), drawing `35814`, specification `tokyo-s03-spec` (499,924 B, SHA-256 `c9258624d2eeacb3759f9c5c8e84c757c3caef1274574153206509ed55273095`).

**Declared CRS: none.** No member of the archive declares one. The specification (§3.2.4, printed p. 8 / PDF page 9) states 「CRS が存在しない場合、データは WGS84 緯度経度座標で提供されます。CRS が null の場合、座標は推定できません。」 — absent CRS ⇒ WGS84 latitude/longitude; CRS present but null ⇒ the coordinates cannot be inferred. §3.2.3 (printed p. 7) adds that local coordinates are a per-venue set in the venue's natural orientation, **not north-up**, used by the Path JSON files.

## Members and their frames (measured)

| Member pattern | Count | `crs` key | Frame |
| --- | ---: | --- | --- |
| `geojson-level-geom-*.geojson` | 11 | absent | WGS84 lon/lat (standard GeoJSON; the spec's absent-CRS sentence applies) |
| `path-level-geom-*.geojson` | 11 | present, `null` | drawing-local per the spec; a null CRS means the coordinates cannot be inferred, and this pass did not check that they share the drawing-local frame `ref_frame.transform` consumes — **UNVERIFIED** |
| `com-map.geojson` | 1 | absent | drawing metadata only; `drawings[0].ref_frame.transform` defines drawing-local → lon/lat |
| `v5_nav.json` | 1 | absent | venue-local `mx`/`my`; not a standard GeoJSON geometry member, so the absent-CRS sentence does not classify it; affine 1 takes it to drawing-local, affine 2 to lon/lat |

The 11 level files carry 15,556 features and the observed coordinate tuples in this pass total 90,784 positions. The level ids are 64672, 64673, 64674, 64688, 64675, 64676, 64689, 64677, 64678, 64679, 64680 (receipt `transform.level_ids`).

## The nav frame and its two affines

`v5_nav.json` stores 2,506 nodes with `mx`/`my` of order 10⁷ — not degrees, and not drawing-local: the first affine takes them there. `docs/stations/shinjuku/research/2026-10-21-tokyo-terminal-join.md:26` calls this "its own Mercator coordinate system" and forbids passing it to an EPSG:3857 inverse; the archive itself never names the frame or its unit, so the projection behind `mx`/`my` is **UNKNOWN**. Only the two affines are evidence, and they are evidence for `v5_nav.json` only — the Path GeoJSON members are a separate, unchecked case.

Order (`tools/gis/src/s03-transform.ts:829`; receipt `transform.order`), both with `[a,b,c,d,e,f]` and `u=a*x+c*y+e`, `v=b*x+d*y+f`:

1. `v5_nav.json d[0].t` (member `469d34033cbe0052…`, coefficients `0a154848be6c786e…`), then
2. `com-map.geojson drawings[0].ref_frame.transform` (member `0481b174b2fafe24…`, coefficients `78dbe40fb37f277b…`); `u` becomes longitude, `v` becomes latitude, then

no fitted translation, rotation, scale or datum correction (`transform-check` receipt `transform.order`, `external.mean_delta_within_5m.applied: false`).

Measured properties of the composition (numeric check below; the coefficient arrays themselves stay in the private store, as in the receipt):

- The composite linear part is **diagonal**: longitude depends only on `mx`, latitude only on `my`, with a sign inversion (increasing `my` decreases latitude). Both cross terms are exactly 0 in float64.
- The nav affine is a similarity: uniform scale 3.227648, rotation 99.381985° counter-clockwise from east — the negative of the drawing's published `ref_frame.angle_deg` −99.382 to within 1.5×10⁻⁵°.
- Metre size of one source unit, taken at latitude 35.69°: 0.971123 m along `mx`, 0.966881 m along `my` (0.44 % anisotropy, derived, never applied). The metadata product nav scale × `ref_frame.local2m` (3.227648 × 0.300535 m) = 0.970021 m agrees with both to 0.11 % / 0.32 %.

## From longitude/latitude to the station ENU frame

`stations/shinjuku/gteki/station.json` (`station.origin`): lat 35.687, lon 139.6994, `hM: null`, datum `JGD2011`, `crs: EPSG:6668`, `frame: ENU`. The horizontal projection is the shared GRS80 geodetic → ECEF → ENU (`packages/geo/src/index.ts:4-16`, `:55-88`; port `tools/gis/src/station-enu.ts:63-84`) at ellipsoidal height 0 for this horizontal calculation only: `stationEnuProjector({lat: 35.687, lon: 139.6994, hM: 0})` (`tools/gis/src/s03-transform.ts:764-771`). `x` is east, `y` north, `z` up; the renderer mapping is `(x, z, -y)` (`packages/geo/src/index.ts:91-93`). S03 carries no heights, so `z` stays null and no floor elevation is asserted. The frame artifact is `tools/gis/frames/shinjuku-station-enu-v0.json:8-23`: origin EPSG:6668, and `source_crs` EPSG:6697 is the **artifact's** own source CRS for PLATEAU context geometry — it is not a CRS for S03 data, whose datum stays UNKNOWN.

The station latitude/longitude are **used as published** with no datum transformation: the source is treated as WGS84 and projected on the JGD2011/GRS80 frame. No WGS84 realization/epoch → JGD2011 correction has been established, its magnitude is **UNKNOWN**, and none is applied.

## Evidence

1. **Specification.** The two sentences quoted above are the only CRS statements in the source package; they classify the level members (absent → WGS84) and the path members (null → cannot be inferred) exactly as the archive's own `crs` keys do.
2. **Member flags.** Measured on the archive: 11 level members with no `crs` key, 11 path members with `"crs": null`, `v5_nav.json` with no `crs` key.
3. **Geographic extent.** The level geometry spans lon 139.6965262–139.7037375, lat 35.6865190–35.6953073 — a 0.65 × 0.98 km block around Shinjuku station, matching the rounded envelope already recorded at `docs/gis/HANDOFF.md:70` and in gap SJ-06. A projection unit would not appear in this range.
4. **The nav chain lands in the level geometry's space.** Applied to all 2,506 nodes, the two affines put 2,506/2,506 inside that geographic envelope, and Check A puts 2,463/2,506 inside the level polygons themselves (0.982841). That containment is what carries the spec's WGS84 reading from the level members to the nav output — as an assumption, not a declaration: the nav chain and the level geometry occupy one geographic space.
5. **Overlap control under the uncorrected datum assumption: the E27 graph.** Reciprocal nearest compatible-floor pairs between transformed S03 nodes and the 233 checked-in E27 nodes (`stations/shinjuku/gteki/graph.json`): 15 pairs within 5 m, min 0.145701610 m, median 1.853869309 m, p90 3.366510600 m, max 3.418081058 m. This reproduces the join study's 15 pairs / 1.85 m median (`2026-10-21-tokyo-terminal-join.md:59`; receipt `external.research_comparison.reproduced: true`). It compares two sources treated as one datum without correction; it is not a geodetic datum determination and not absolute accuracy.
6. **Metadata cross-checks** listed in the previous section (rotation vs `angle_deg`, scale vs `local2m`).
7. **Negative control.** The reversed affine composition puts 0/2506 nodes inside and all 2,506 out of geographic range (receipt `internal.swapped_order`).

## Residuals

| Check | Result |
| --- | --- |
| Check A, as-is (node in own-level polygons) | 2,463 / 2,506 inside, 0.982841; **FAIL** the fixed rule of 95 % overall and per level |
| Level 64677 | 333 / 363 inside, 0.917355, 30 outside (nearest-edge 0.014454 / 1.008816 / 2.234095 / 5.304428 m) |
| Level 64678 | 282 / 295 inside, 0.955932, 13 outside (1.091371 / 3.968638 / 6.788107 / 8.765265 m) — passes its own 95 % threshold; the 13 are residual outliers, not a level failure |
| Check B, S03 minus E27 | 4 / 8 / 12 / 15 reciprocal pairs at 1 / 2 / 3 / 5 m; residuals as in evidence item 5 |
| Mean S03-minus-E27 vector | east +0.934294041 m, north +0.127433023 m, length 0.942944606 m — **measured, not applied** |

The 43 outside nodes are all plain corridor nodes, spread over hundreds of metres (SD 140.444466 m east, 193.412358 m north on 64677; 72.327988 / 31.113925 m on 64678) and touching 20 and 6 distinct nearest polygons, so they do not support one rigid offset; subtracting the 0.94 m mean vector lowers the inside rate to 0.956105 overall and 0.779614 on 64677 (`docs/gis/research/2026-10-24-s03-transform-check.md:118-161`). The Check B residual combines source cartography, node placement and datum/epoch uncertainty and is **not** a survey accuracy certificate (`docs/gis/s03/transform-check-92b28d4d3986c27d8203.json` `datum_note`).

## Decided (2026-10-24 rulings) versus open

Decided:

- The datum is **UNKNOWN and not asserted**; the spec's absent-CRS statement is used for projection only (`docs/gis/s03/positions-import-contract.md:7`; `tools/gis/src/s03-transform.ts:21-27` `S03_DATUM`; receipt `crs` block: `declared: null`, `status: "UNKNOWN"`, `asserted: false`).
- The transform method itself — nav affine, then drawing affine, then horizontal ENU, no fitted correction — is the agreed method, and this pass reproduces the join study's numbers (`external.research_comparison`).
- The S03 positions that may be derived and how they are labelled: one approximate representative point per ticket gate and transfer, `approximate (±max(5 m, polygon radius))`, `NOT_FOR_ROUTING`, `gteki_role: context`, floor `UNVERIFIED`; platforms name-only (`docs/gis/decisions/2026-10-24-s03-positions-ruling.md:10-12`). **No other S03 geometry ships**; it stays HOLD.
- Three source polygon features are excluded whole, never repaired or moved: two `SOURCE_DEFECT_UNCLOSED_RING` (level 64676 feature 195, gap 3.028552467 m; level 64679 feature 0, gap 48.922969786 m) and one `SOURCE_DEFECT_HOLE_OUTSIDE_SHELL` (level 64676 feature 384, offset 0.511531472 m).
- Level labels are not elevations; physical heights are UNKNOWN.

Open:

- The source's WGS84 realization and epoch, and whether any WGS84 → JGD2011 horizontal offset exists here, are UNKNOWN. A datum correction would move every point and is not modelled.
- Absolute accuracy and station alignment are **not** established: the only control is the E27 overlap (15 pairs, median 1.85 m, max 3.42 m), not an official survey control such as the GSI `bl2xy` controls used for the PLATEAU frame. The PLATEAU CRS note's controls validate a projection; nothing equivalent exists for S03.
- Why level 64677 fails containment (91.74 %), and why 64678 still has 13 outside nodes while passing its own threshold (95.59 %), is unresolved: local polygon gaps vs node placement vs cartography. Only 64677 fails; the overall FAIL follows from it.
- The composite's 0.44 % x/y anisotropy and the source's linear unit are derived, not declared; the definition of the `mx`/`my` projection is UNKNOWN.
- Publication of nav paths, path geometry or opening hours is **not** covered by any ruling: the 2026-10-24 ruling allows 25 approximate points and 19 platform names only.

## Numeric checks run

`python3 -I`, standard library only, reading the stored ZIP in place (no extraction): member `crs` inventory; bbox of the 90,784 level-geometry positions (the `label_area` tuples excluded); the two affines applied to all 2,506 nodes and counted against that bbox; decomposition of the composite linear part (diagonal, sign, scales); nav scale × `local2m` cross-check at latitude 35.69° with GRS80 radii of curvature. All counts above are from those runs; the residual tables are quoted from receipt `transform-check-92b28d4d3986c27d8203`.

## Handoff to the path transform (WP7 → ds-sjk-2)

What ds-sjk-2 needs, and nothing else:

1. **Inputs, by hash.** ZIP `fc3466270c08593a…`; `v5_nav.json` `469d34033cbe0052…`; `com-map.geojson` `0481b174b2fafe24…`; drawing id 35814; the 11 level-member hashes in receipt `transform.level_member_sha256`; filenames are Shift_JIS (`legacyFileNameEncoding: 'shift_jis'`, `tools/gis/src/s03-transform.ts:762`, `tools/gis/src/zip.ts:10`).
2. **Order and tuple convention, scoped to `v5_nav.json` only.** `v5_nav.json d[0].t` (raw nav frame → drawing-local), then `com-map.geojson drawings[0].ref_frame.transform` (drawing-local → longitude/latitude), both `[a,b,c,d,e,f]` with `u=a*x+c*y+e`, `v=b*x+d*y+f`; the second result is `(u, v) = (longitude, latitude)`. Do not swap the two affines (the reversed order yields 0/2506 inside and out-of-range coordinates), and do not pass `mx`/`my` to any projection inverse. **Do not feed Path GeoJSON coordinates through this recipe**: their `crs: null` local frame is unchecked and may already be drawing-local, so reusing the pair would transform them twice.
3. **Geographic interpretation.** Treat the output as WGS84 lon/lat and project it as JGD2011 geographic on GRS80. Apply **no** datum/epoch correction, shift, rotation or scale.
4. **Station ENU.** `stationEnuProjector({lat: 35.687, lon: 139.6994, hM: 0})` — or `stationHorizontal` with `tools/gis/frames/shinjuku-station-enu-v0.json` — evaluated at height 0 for the horizontal result only; `x` east, `y` north; renderer `(x, z, -y)`. S03 heights do not exist: `z` stays null, no floor elevation is derived from `zlevel` or from node level ids.
5. **Node and link model.** 2,506 nodes `n[]` (`id`, `mx`, `my`, `l[].lid` levels); 2,653 links `l[]` with `n1`/`n2`, `d` = direction (1 forward, 2 reverse, 3 both) and `dz` only across levels; no stair/lift/escalator field exists (`docs/gis/research/2026-10-24-s03-transform-check.md:122`).
6. **Reproductions to assert before using the output.** 2,506 transformed nodes; all inside the level envelope; Check A 2,463/2,506 (0.982841) with 64677 at 0.917355 and 64678 at 0.955932; Check B 4/8/12/15 pairs at 1/2/3/5 m with median 1.853869309 m; the three excluded features above stay excluded whole.
7. **What must not be claimed or shipped.** Paths, connectors and routes are not cleared by the 2026-10-24 ruling and stay HOLD — the transform may be computed for evidence only. The result keeps `UNVERIFIED`, `NOT_FOR_ROUTING` and `gteki_role: evidence`; it proves neither current-world geometry, connectivity, hours nor accessibility, and the 0.94 m mean offset must stay unapplied.
8. **Reference implementation.** `tools/gis/src/s03-transform.ts` (v4) already implements steps 1–2 and the station projector; use its order rather than re-deriving, and its receipt as the identity to reproduce. Per-node positions exist only in the private store (`~/.gteki/gis-store/out/s03-transform-check-92b28d4d3986c27d8203.provenance.json`).

出典：東京都都市整備局「新宿駅周辺の施設情報等」

This note is not a rights PASS and does not widen the publish gate; the derived outputs it discusses stay `CONDITIONAL` with licence fields UNKNOWN, as decided on 2026-10-24.

UNVERIFIED. This note establishes which frames the archive contains and how they chain to the station ENU; it does not certify datum, absolute accuracy or station alignment.
