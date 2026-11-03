# Seibu 1F gate ↔ stair 36 — second-source check

Checked 2026-11-03 21:25 JST on `codex/seibu-stair36`, base `39230047`.
Result: **no route-usable second source prints the tie; field required**.

## Sources and printed relation

| Source | Location and finding | Result |
|---|---|---|
| [ISP access](https://www.web-isp.co.jp/access/), existing MER-02 record in `docs/research/gaps/DR-IK-merchant-ties.md` | The recorded directions connect Seibu's 1F gate to stair 36 opposite the gate, then describe the ISP メトロ口 approach from its foot. | Facts only (OD-23 / OD-34 §2); never route evidence. This is the candidate relation, not an independent source. |
| [Toshima January 2022 underground guide](https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf), PDF **p.2**, single underground plan, east end of Central Passage | Prints **36** beside a stair symbol south of **中央通路東改札 / Central Passage East Gate** and near **東口（中央）37**. The Seibu gate printed farther south is **地下改札 / B1F Gate**. No Seibu 1F gate or 1F-gate ↔ stair-36 relation is printed. | The brief permits this guide as `toshima-underground-guide-2022` under OD-02 A, but its exit number and B1F gate do not establish the requested 1F tie. |
| [PLATEAU 13116 underground building GML](https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml), `13116-ubld-1` | Streamed the source XML: one UndergroundBuilding, three Rooms, one CityObjectGroup; the only `gml:name` is `池袋駅_B1地下通路`. No text value matches 西武, 改札, 36番 or 1階. No named gate ↔ numbered stair relation is supplied. | Geometry is usable, but it cannot independently identify the requested gate or connection. This agrees with `G0-source-audit.md`, “Semantics that are absent.” |

The PDF and GML were downloaded with curl's default User-Agent (HTTP 200).
SHA-256:

- PDF: `db85abf7d77131ca7f72af074de993a371b6925d0e903fa2f82a2a330d1a7a15`
- GML: `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`

Only source-check facts are recorded here; neither source file nor its image
is committed. Seibu's own site remains facts only (OD-25), so it cannot
supply route evidence for this task.

## Existing graph and decision

`data/graph.src.json` contains only **`x36f`** among nodes numbered 36:
`kind: stair_end`, `floor: b1`, `xy: [61.5, 26.0]`, `zHint: 28.49`.
Its only edge is `c_e2` → `x36f` (`af-east-exits`). `exit-36` connects to
this **foot**, not a street-level top. Its existing evidence says PLATEAU
surveys only the lower flight to TP 29.7 m, ending at a vertical closure;
the README's “Deliberate simplifications” records the same limitation.
There is no surveyed stair-36 top node to reuse.

`seibu-1f-gate` has no floor, position or connector and remains search-only.
No graph, POI, accessibility, golden or kit-catalog data changes. The matrix's
desk item becomes a field item because neither checked route-usable source
prints the requested connection. An exit-number label alone cannot turn
the B1 stair foot into a 1F gate endpoint.

## Assumptions

- The brief's permission to use the Toshima guide is applied as given;
  no broader source-rights ruling is changed.
- The docs-only branch of the brief applies when the guide and PLATEAU do
  not independently print the relation; no speculative top node is added.

## Follow-ups

- Field: identify the 1F gate's public side, stair-36 top, intervening walk
  and complete stair connection before making the gate routable. Record
  steps and wheelchair access from that evidence.
