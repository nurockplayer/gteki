# S03 navigation path import contract (WP7)

`gis s03-paths [--crs <label>]` writes one private document to `~/.gteki/gis-store/out/s03/paths-<digest>.json` and one public receipt to `docs/gis/s03/paths-<digest>.json`. Only the private document carries coordinates or record identities. The receipt carries counts, length statistics, reason codes and the quoted evidence only: no coordinate, no link or node hash, no level label and no other source value.

Numeric ids are the documented exception, on the `s03-transform-check` precedent, which publishes numeric level ids (and #505 quotes 64677): `level_counts[].level_id` and the numeric `transform.drawing_id` are carried as numbers. The parser already guarantees the drawing id is a positive safe integer; a non-numeric or label-like drawing id would have to be hashed like the record ids instead. Level labels, coordinates, record hashes and entity or feature ids stay private. Input-file provenance hashes and the run identity are carried exactly as the positions receipt carries them; they identify the run, not a position or a record.

It reads `v5_nav.json` only, through `getStoredSource`, and applies the agreed transform exactly as `s03-transform-check` does: the nav affine, then the drawing affine, then the horizontal station ENU projection (GRS80, height 0, no fitted correction). **The Path GeoJSON members are never read here**: their frame is UNKNOWN (`crs: null`), so passing them through this affine pair would transform them twice if they already are drawing-local ([`../crs/shinjuku-s03-v0.md`](../crs/shinjuku-s03-v0.md), "Handoff to the path transform").

## Provenance of a segment

One segment per link: both endpoint nodes transformed and projected into station ENU; the segment carries the endpoint ENU positions, the straight-line length, its level relation and the source direction.

`segments[]` fields: `link_id_sha256`, `from_node_sha256`, `to_node_sha256`, `from_level_id`, `to_level_id`, `level_relation` (`same_level` / `cross_level`), `direction` (1 forward, 2 reverse, 3 both), `dz_m`, `from_east_m`, `from_north_m`, `to_east_m`, `to_north_m`, `length_m`, `reason_codes`, `labels`.

`nodes[]` fields: `source_id`, `level_id`, `level_label`, `floor_ordinal`, `lon`, `lat`, `east_m`, `north_m`, `labels`.

The three hashes are SHA-256 hex of the decimal source id (`sha256("201")` for link 201). They identify records without carrying the source ids themselves; the private document still names the nodes by source id in `nodes[]`.

A link is `cross_level` when its endpoints sit on different levels or it carries a non-zero `dz`, matching WP7's classification. The source has no stair, lift or escalator field, so the device is UNKNOWN and `CROSS_LEVEL_DEVICE_UNKNOWN` is recorded.

Two degenerate shapes occur in the real source and are kept, not dropped: six links join a node to itself (six `SELF_LOOP`) and two cross-level links have identical horizontal positions (`ZERO_LENGTH`, with `length_m: 0`). Neither is walkable in the horizontal frame; a same-level segment whose endpoints coincide is also flagged `ZERO_LENGTH`.

Every node and segment record carries its own `labels` object (`navigation_use: NOT_FOR_ROUTING`, `verification: UNVERIFIED`, `gteki_role: evidence`), identical to the document-level `labels`. An importer must propagate the record labels with each record.

## Reason codes

Counted in the public receipt; each segment lists the ones that apply.

| Code | Meaning |
| --- | --- |
| `CRS_UNCONFIRMED` | The S03 datum is UNKNOWN and nothing here confirms it. |
| `CHECK_A_CONTAINMENT_FAIL` | The nodes this segment joins sit on geometry that fails the fixed containment rule: 2,463 / 2,506 inside (0.982841), level 64677 at 0.917355. |
| `CHECK_B_RESIDUAL_UNVERIFIED` | The only control is the E27 overlap under an uncorrected datum: 15 reciprocal pairs within 5 m, median 1.853869309 m, max 3.418081058 m; the 0.94 m mean offset is measured and never applied. |
| `FLOOR_ORDINAL_UNVERIFIED` | The level label maps to a comparison ordinal by assertion, not a surveyed floor or elevation. |
| `CROSS_LEVEL_DEVICE_UNKNOWN` | A cross-level segment whose device type the source does not name. |
| `ONE_WAY` | Direction 1 or 2: the link is not walkable in both directions. |
| `SELF_LOOP` | The link joins one node to itself. |
| `ZERO_LENGTH` | The endpoints share one horizontal position: a vertical transition with no horizontal step, or a degenerate same-level link. |

The receipt's `evidence` block quotes these numbers from `../crs/shinjuku-s03-v0.md` and the v4 transform-check receipt; the run fails closed if the stored ZIP, node count (2,506) or link count (2,653) differs from what those numbers were measured on. `publication` is `paths: HOLD, routing: HOLD`: the 2026-10-24 ruling covers 25 approximate points and 19 platform names only.

## The CRS input and what flips when the data delivers it

The datum is an explicit input, `--crs <label>`, default `UNKNOWN`. Whatever is passed is recorded as `crs.declared` in the receipt and the run identity:

- `UNKNOWN` (default) → `crs.status: UNKNOWN`.
- Any other value → `crs.status: DECLARED_UNVERIFIED`.

`crs.confirmed` is always `false` in this policy. **Passing a value is not confirmation**: the flag that flips the labels is `crs.confirmed`, and only a director ruling backed by the data research can set it. Until then every output stays `NOT_FOR_ROUTING` and `UNVERIFIED`, whatever the input says.

When the data research establishes the CRS and a ruling accepts it, the change is a policy bump to `s03-paths-v2` that:

1. reads `crs.confirmed: true` from the ruling record (the `--crs` value records which CRS, it does not assert it);
2. drops `CRS_UNCONFIRMED` from the per-segment codes;
3. takes `verification` and `navigation_use` from the ruling instead of the fixed `UNVERIFIED` / `NOT_FOR_ROUTING`.

A confirmed CRS does **not** clear `CHECK_A_CONTAINMENT_FAIL` or `CHECK_B_RESIDUAL_UNVERIFIED`; those need the containment gap explained or a ruling that accepts it. Path publication and routing stay HOLD after the CRS too: the existing rulings do not cover paths, connectors or routes.

## How the segments map onto `stations/shinjuku/gteki/graph.json`

Only after the CRS is confirmed, the containment and residual codes are cleared or ruled on, and a ruling permits path placement. Until then the station writer must not write these records.

- **Nodes.** One graph node per distinct endpoint hash. id `n:` + the first 32 hex characters of the stored `from_node_sha256` / `to_node_sha256`. `position: { x: east_m, y: north_m, z: null }`: station ENU has x east and y north, the same axes the E27 node positions use. `floorId` from `level_label` through the asserted ordinal map onto `station.json` floors — the same mapping that is UNVERIFIED today. `kind`, `inOut` and `renderZ` come from the writer's own rules: S03 has no device, kind or height field, so nothing is derived from it.
- **Edges.** One per segment. id `e:` + the first 32 hex characters of `link_id_sha256`. `lengthM: length_m`; geometry omitted (the edge is the straight segment between the two nodes). `direction`: 3 → `both` with `from` = the `n1` node and `to` = the `n2` node; 1 → `forward` with the same endpoints; 2 → `forward` with the endpoints swapped, because the schema has no reverse direction. `verification: "unverified"` until the ruling says otherwise.
- **What blocks an edge.** `mode` must be one of `walk`, `stairs`, `escalator`, `elevator`, `ramp`, `moving_walkway` or `gate`, and a cross-floor edge needs a vertical mode. S03 names no device, so a cross-level segment cannot be given a mode from this source at all; another source has to establish it. A same-level segment would be `walk`, which is itself a routing claim and stays HOLD under the ruling.
- **Evidence.** `geometryEvidence` and `accessEvidence` need checked evidence and a source whose rights allow shipping; S03 is evidence-only, `CONDITIONAL` with licence fields UNKNOWN. Do not mark anything verified from this file.

## Credit

出典：東京都都市整備局「新宿駅周辺の施設情報等」

The NOTICE 4.7 change notice applies: GTEki derived station-ENU segments from the source navigation nodes and links (two affine transforms plus the station projection). This is not a rights PASS and does not widen the publish gate, which stays `CONDITIONAL` with the licence fields UNKNOWN.
