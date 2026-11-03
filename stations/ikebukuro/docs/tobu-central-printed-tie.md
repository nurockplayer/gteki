# Tobu Central Gates — printed passage approach

Checked 2026-11-03 21:12 JST on `codex/tobu-central-gate`, base `39230047`.

## Source and tie

[Toshima's January 2022 underground guide](https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf),
PDF **page 2**, the single underground plan, west end of **中央通路 / Central Passage**.
Downloaded with curl's default User-Agent (HTTP 200); SHA-256
`db85abf7d77131ca7f72af074de993a371b6925d0e903fa2f82a2a330d1a7a15`.
Only the following location facts are recorded; the PDF/image is not committed.
Source authority is the brief's OD-02 A precedent, already recorded as
`toshima-underground-guide-2022`; no Tobu operator source is imported.

| POI | What is printed in the figure | Tie / result |
|---|---|---|
| `tobu-central-gate-2` | Central Gate 2 is on the north side of Central Passage, west of JR Central Gate 2, beside the Marunouchi Central Passage West Gate; the west hall is labelled 西口（中央）19 | Route to `c_w`, the existing west Central Passage approach at the junction of `c_w__w_c` and `c_w__c_mid`. This is a named-passage **STATION_TIE**, not a surveyed gate opening. |
| `tobu-central-gate-1` | Central Gate 1 is below the passage, on the Tobu side of the north–south strip between Tobu and JR, with gate marks along the JR side | No connector. The strip is `gap-tobu-jr-link`; its public/transfer status and approach are unresolved. A tie to `c_w` would skip that distinction. |

The printed passage name and relative gate sides support the Central Gate 2
approach permitted by this brief. `c_w` is the nearest existing west Central
Passage junction serving that approach; `w_c` is the west hall and `c_mid` is
farther east toward the JR gates. No gate coordinates or connector edge are
invented. The POI notes tell users that directions stop on the passage.
Existing edge `wheelchair:null` and `steps:false` values remain unchanged;
a gate or lift pictogram does not supply new accessibility evidence.

This differs from #777's rejected lift ties: no lift landing, served floor,
or step-free connection is claimed. The exact gate opening remains part of
`gap-metro-tobu-gates`.

## Regression and generated files

`build_station.py` emits `src.pois` verbatim into `gteki/pois.json`. That POI
projection is regenerated with the same JSON serialization; graph, station,
geometry and scene artifacts do not change.

The real-bundle search test searches 中央2改札, checks the routable flag, and
routes from JR Central Gate 2 to `c_w`. The existing refusal test now uses
Central Gate 1, which still has no connector. Search-only POIs: **508 → 507**.
IN5 already uses Central Gate 1 and still fails closed, so its origin and the
browser golden do not change. The kit catalog's golden input hash therefore
does not change and no catalog regeneration is needed.

## Matrix result

`orb-test -- pnpm coverage:matrix` passed at 2026-11-03 21:12 JST; last
application line: `Coverage generated in 3.40 s.` The 東武東上線 output is
`search y; route y; step-free 0/46` (previously `route n; step-free 0/0`).
Counts remain 5 gates + 5 platforms + 1 lifts + 1 escalators + 1 toilets;
only Central Gate 2 has a routable approach.

## Field-item comment draft (not posted)

2026-11-03 21:12 JST — Toshima 2022 PDF p.2 supports a Central Gate 2
**passage-approach** tie at `c_w`, not its exact opening. Keep field-run
**item 6** open for gate plates, columns and fare side. **Item 11 is Tobu
北改札**, so this central-gate tie does not close it. **Item 26 is the Tobu
department-store entrance**, so it also remains open. Central Gate 1 still
needs the gate-line/public-side observation for `gap-tobu-jr-link`; do not
infer its connector or wheelchair access from Central Gate 2.

## Assumptions

- The brief's named-passage approach tie is sufficient for Central Gate 2;
  it does not require a newly surveyed gate-line endpoint. Central Gate 1
  remains search-only because its approach is a different unresolved strip.

## Follow-ups

- Field item 6: locate the exact two gate lines against columns and verify
  the public approach to Central Gate 1. Items 11 and 26 retain their own scope.
