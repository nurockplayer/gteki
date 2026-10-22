# Ikebukuro: step-free (accessible) route coverage of the verified graph

Read at `gteki/graph.json` (62 nodes, 63 edges, 1,744.1 m), `gteki/pois.json` and `gteki/station.json` on this branch, 2026-10-22. Desk analysis only: nothing here is field-verified, and **no graph, POI, accessFact or coverage text was changed**. This is a coverage report, not an acceptance and not a routing claim.

## Result in one paragraph

**Verified step-free coverage is 0 edges, 0 m of 63 edges, 1,744.1 m.** Wheelchair access is `null` (UNKNOWN) on every edge, so the `stepFree` profile fails closed: it finds no path, not even a flat walk between two halls. The PLATEAU geometry says 25 edges (504.4 m) are stairs, 12 edges (609.2 m) are walking edges that change level a little (up to 0.56 m), and 26 edges (630.5 m) are flat polylines. The last two groups are **geometry only**: a flat survey polyline does not show that there are no steps, thresholds, narrow gate openings or closed doors, so none of it counts as step-free. A "geometry-only candidate" below means "nothing in the PLATEAU geometry rules it out", never "accessible".

## 1. What the data says about step-free

- The router refuses an edge for the step-free profile unless it is not a `stairs` or `escalator` edge, **and** `wheelchair === true`, **and** `steps !== true` (`packages/navigation/src/router.ts:284`, `NOT_STEP_FREE_MODES` at `:10`). Nothing in the graph sets `wheelchair` to `true`, so every edge is refused.
- `routing.test.ts` pins this. `routing.test.ts:269-273`, test "step-free fails closed: wheelchair access is unknown (null) on every edge, so even the flat walk to the gate stair foot has none" (inside `describe("strict hours and step-free")`, `:249`): line 270 asserts `bundle.edges.every((e) => e.wheelchair === null)`; line 271 asserts `stepFree: true` from the golden start to Exit 35 gives `{ ok: false, reason: "no_path" }`; line 272 asserts the same for the flat walk to `c_e2` (East Exit B1). `g0-g4-status.md` G0 row 3 and G2 row 4 cite the same test.
- No edge uses a vertical mode other than `stairs`: the schema allows `escalator`, `elevator`, `ramp` and others (`packages/schema/src/index.ts:170`), but the 63 edges are 38 `walk` and 25 `stairs`. `steps` is `true` on exactly the 25 `stairs` edges. The README notes that single risers modelled as two floor levels are passable on stair edges only, so walk edges are not "proven step-free" even by the data's own convention.
- A test that no edge sets `wheelchair` without a cited `accessEvidence` source was considered and not added: the existing assertion at `routing.test.ts:270` is stricter (every edge is `null`), so a weaker "unless cited" test would add nothing today.

## 2. Per-edge classification (all 63 verified edges)

Class rules (applied in this order):

| Class | Rule | What it does and does not say |
|---|---|---|
| `stair` | `mode` is `stairs` and `steps` is `true` (the data says it has steps) | Not step-free. Counts as the data's own statement. |
| `slope` | not a stair, and the polyline's z range is at least 0.01 m | PLATEAU z changes along the walk. **Geometry only, step-free NOT verified.** The grade is read from sampled geometry (surface sampled every 0.5 m, tolerance 0.35 m per `geometryEvidence.method`), so the larger values are at the size of the sampling tolerance: they are not measured ramp grades and not evidence that a ramp exists. |
| `level-geometry` | not a stair, and the polyline is flat (z range under 0.01 m) | PLATEAU geometry shows no level change and no stair. **Geometry only, step-free NOT verified**: a flat polyline does not prove there are no steps, thresholds, door sills, gate or opening widths, or surface problems. |

Columns: net level change is last vertex z minus first vertex z along `from` to `to`, in metres (TP height); z range is max minus min along the polyline; grade is the net change over the edge length, then the steepest single polyline segment (slope edges only). `wheelchair` is the value stored in `graph.json`. All 63 edges are `verified` (geometry and access evidence as in `station.json`), unpaid, two-way, with `hours: null`.

Summary:

| Class | Edges | Metres | Share of 1,744.1 m |
|---|---|---|---|
| `stair` | 25 | 504.4 | 28.9 % |
| `slope` (geometry only) | 12 | 609.2 | 34.9 % |
| `level-geometry` (geometry only) | 26 | 630.5 | 36.2 % |
| **Total** | **63** | **1,744.1** | 100 % |
| **Verified step-free** | **0** | **0.0** | **0 %** |

Notes on the numbers:

- The 25 stair edges climb or descend 0.83 m (`s41_j__s41_f`) to 6.61 m (`s39_f__x39`), 112.6 m in total (sum of the absolute net changes).
- The 12 slope edges change level by 0.04 m (net, `c_n__n_h`, which rises and falls 0.14 m) to 0.56 m (`c_s__sp_j`, over 84.2 m); the largest net grade is 2.4 % (`c_e1__c_n`) and the steepest single polyline segment is 5.7 % (`se_1__se_j`). Six of them change by 0.20 m or less, which is inside the 0.35 m sampling tolerance; the field checks for them are in `field-checklist.md` I11.
- Three short "stair" edges rise under 1.5 m (`s41_j__s41_f` 0.83 m, `e_hall__e_low` 0.91 m, `sp_e__s38_w` 1.47 m). The data treats them as stairs (the README and `af-south-passage` describe "one short flight up and another down"); they are the places where a ramp or lift beside the flight would matter most (I12).

### Per-edge table

| # | Edge | Kind (`mode`) | `steps` | Net level change (m) | z range (m) | Grade net / worst segment | Length (m) | `wheelchair` | Class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `c_w__c_mid` | walk | false | +0.00 | 0.00 | - | 37.3 | `null` | `level-geometry` |
| 2 | `g_jr_c2__c_g2` | walk | false | +0.00 | 0.00 | - | 7.0 | `null` | `level-geometry` |
| 3 | `c_mid__c_g2` | walk | false | +0.00 | 0.00 | - | 11.4 | `null` | `level-geometry` |
| 4 | `c_mid__g_jr_c1` | walk | false | +0.00 | 0.00 | - | 10.5 | `null` | `level-geometry` |
| 5 | `c_g2__c_c` | walk | false | +0.00 | 0.00 | - | 21.3 | `null` | `level-geometry` |
| 6 | `c_c__c_e1` | walk | false | +0.16 | 0.16 | 0.5% / 2.8% | 33.1 | `null` | `slope` |
| 7 | `c_e1__c_n` | walk | false | +0.42 | 0.42 | 2.4% / 2.8% | 17.8 | `null` | `slope` |
| 8 | `c_n__c_e2` | walk | false | +0.00 | 0.00 | - | 16.4 | `null` | `level-geometry` |
| 9 | `c_e1__c_s` | walk | false | +0.07 | 0.07 | 0.5% / 0.6% | 13.3 | `null` | `slope` |
| 10 | `c_s__x37` | stairs | true | +4.20 | 4.20 | - | 18.6 | `null` | `stair` |
| 11 | `c_e2__x36f` | walk | false | +0.00 | 0.00 | - | 8.1 | `null` | `level-geometry` |
| 12 | `c_e2__e_27j` | walk | false | -0.39 | 0.39 | 2.0% / 3.9% | 19.9 | `null` | `slope` |
| 13 | `e_27j__e_hall` | walk | false | -0.31 | 0.31 | 2.2% / 3.0% | 14.1 | `null` | `slope` |
| 14 | `e_27j__x27` | stairs | true | +4.17 | 4.17 | - | 16.1 | `null` | `stair` |
| 15 | `e_hall__e_low` | stairs | true | -0.91 | 0.91 | - | 37.1 | `null` | `stair` |
| 16 | `e_low__x34` | stairs | true | +5.01 | 5.01 | - | 25.4 | `null` | `stair` |
| 17 | `e_low__x35` | stairs | true | +4.39 | 4.39 | - | 31.9 | `null` | `stair` |
| 18 | `e_hall__se_1` | walk | false | -0.20 | 0.20 | 0.7% / 4.4% | 27.6 | `null` | `slope` |
| 19 | `se_1__se_j` | walk | false | -0.51 | 0.51 | 1.8% / 5.7% | 27.6 | `null` | `slope` |
| 20 | `se_j__x43` | stairs | true | +4.71 | 4.71 | - | 16.0 | `null` | `stair` |
| 21 | `se_j__x42` | stairs | true | +4.89 | 4.89 | - | 18.0 | `null` | `stair` |
| 22 | `c_s__sp_j` | walk | false | -0.56 | 0.56 | 0.7% / 1.8% | 84.2 | `null` | `slope` |
| 23 | `sp_j__sp_e` | walk | false | +0.00 | 0.00 | - | 27.5 | `null` | `level-geometry` |
| 24 | `sp_e__s38_w` | stairs | true | +1.47 | 1.47 | - | 11.4 | `null` | `stair` |
| 25 | `s38_w__s38_j` | walk | false | +0.00 | 0.00 | - | 31.0 | `null` | `level-geometry` |
| 26 | `s38_j__x38` | stairs | true | +3.59 | 3.59 | - | 13.4 | `null` | `stair` |
| 27 | `s38_j__s41_j` | stairs | true | -3.19 | 3.19 | - | 25.8 | `null` | `stair` |
| 28 | `s41_j__s41_f` | stairs | true | +0.83 | 0.83 | - | 16.2 | `null` | `stair` |
| 29 | `s41_f__x41` | stairs | true | +5.46 | 5.46 | - | 20.2 | `null` | `stair` |
| 30 | `s41_j__s40_j` | walk | false | +0.07 | 0.07 | 0.1% / 0.1% | 90.4 | `null` | `slope` |
| 31 | `s40_j__x40` | stairs | true | +6.58 | 6.58 | - | 24.0 | `null` | `stair` |
| 32 | `s40_j__s39_f` | walk | false | +0.11 | 0.11 | 0.2% / 0.2% | 53.2 | `null` | `slope` |
| 33 | `s39_f__x39` | stairs | true | +6.61 | 6.61 | - | 26.5 | `null` | `stair` |
| 34 | `c_n__n_h` | walk | false | -0.04 | 0.14 | 0.1% / 1.3% | 75.8 | `null` | `slope` |
| 35 | `n_h__n_c` | walk | false | +0.00 | 0.00 | - | 6.5 | `null` | `level-geometry` |
| 36 | `n_c__n_e` | walk | false | +0.00 | 0.00 | - | 27.5 | `null` | `level-geometry` |
| 37 | `n_c__x22` | stairs | true | +3.97 | 3.97 | - | 11.0 | `null` | `stair` |
| 38 | `n_e__ne_j` | stairs | true | -2.21 | 2.21 | - | 14.6 | `null` | `stair` |
| 39 | `ne_j__x26` | stairs | true | +6.01 | 6.01 | - | 19.8 | `null` | `stair` |
| 40 | `ne_j__ne_m` | walk | false | +0.00 | 0.00 | - | 19.7 | `null` | `level-geometry` |
| 41 | `ne_m__x28` | stairs | true | +6.13 | 6.13 | - | 20.6 | `null` | `stair` |
| 42 | `ne_m__ne_e` | walk | false | +0.00 | 0.00 | - | 22.3 | `null` | `level-geometry` |
| 43 | `ne_e__ne_k` | walk | false | +0.00 | 0.00 | - | 9.4 | `null` | `level-geometry` |
| 44 | `ne_k__x32` | stairs | true | +6.19 | 6.19 | - | 23.0 | `null` | `stair` |
| 45 | `ne_e__x33` | stairs | true | +5.84 | 5.84 | - | 23.8 | `null` | `stair` |
| 46 | `c_w__w_c` | walk | false | +0.00 | 0.00 | - | 63.1 | `null` | `level-geometry` |
| 47 | `w_c__w_n` | walk | false | +0.00 | 0.00 | - | 31.4 | `null` | `level-geometry` |
| 48 | `w_c__w_cj` | walk | false | +0.00 | 0.00 | - | 20.3 | `null` | `level-geometry` |
| 49 | `w_cj__w_13j` | walk | false | +0.00 | 0.00 | - | 12.9 | `null` | `level-geometry` |
| 50 | `w_13j__w_w` | walk | false | +0.00 | 0.00 | - | 12.9 | `null` | `level-geometry` |
| 51 | `w_13j__x13f` | walk | false | +0.00 | 0.00 | - | 6.5 | `null` | `level-geometry` |
| 52 | `w_w__w_nw` | walk | false | +0.00 | 0.00 | - | 43.9 | `null` | `level-geometry` |
| 53 | `w_nw__w_n` | walk | false | +0.00 | 0.00 | - | 46.0 | `null` | `level-geometry` |
| 54 | `w_n__x15` | stairs | true | +5.24 | 5.24 | - | 18.6 | `null` | `stair` |
| 55 | `w_n__x17` | stairs | true | +5.24 | 5.24 | - | 16.2 | `null` | `stair` |
| 56 | `w_n__x18` | stairs | true | +5.26 | 5.26 | - | 25.4 | `null` | `stair` |
| 57 | `w_nw__x10` | stairs | true | +5.24 | 5.24 | - | 15.0 | `null` | `stair` |
| 58 | `w_nw__x11` | stairs | true | +5.24 | 5.24 | - | 15.8 | `null` | `stair` |
| 59 | `sp_j__sp_m` | walk | false | +0.00 | 0.00 | - | 64.9 | `null` | `level-geometry` |
| 60 | `sp_m__g_jr_s` | walk | false | +0.00 | 0.00 | - | 9.7 | `null` | `level-geometry` |
| 61 | `sp_m__sw_h` | walk | false | +0.00 | 0.00 | - | 48.7 | `null` | `level-geometry` |
| 62 | `sw_h__x4f` | walk | false | +0.00 | 0.00 | - | 14.3 | `null` | `level-geometry` |
| 63 | `sw_h__w_cj` | walk | false | +0.33 | 0.33 | 0.2% / 3.7% | 152.2 | `null` | `slope` |


## 3. Which routable POIs are reachable on geometry-only edges?

Question: starting from each JR gate or B1 hall, is there any path to the POI that uses only `level-geometry` and `slope` edges (no `stair` edge)? This is a **geometry-only candidate**, not a verified route: every edge on it still has `wheelchair: null`, and the step-free router would refuse all of them.

Method (read-only, JSON only, not committed): take the 38 non-stair edges as an undirected graph (all 63 edges are two-way), find connected components, then run shortest paths from the nine origin nodes (the three JR gates `jr-central-gate-2`, `jr-central-gate-1`, `jr-south-gate`, and the six halls and passages `central-passage`, `north-passage`, `south-passage`, `east-exit-b1`, `west-exit-b1`, `west-exit-south-b1`). Origins are the public side of each gate; no gate is passed through and no fare area is entered. The 20 search-only POIs (5 gates, 15 exits; #185 adds a 21st, the Yurakucho 南通路西改札) have no node and are out of scope: they cannot be routed at all.

Headline:

- **32 routable POIs**: 23 exits, 3 JR gates, 6 halls and passages.
- **All 9 origins sit in one geometry-only component** of 31 nodes and 32 edges (1,013.7 m). Every JR gate and B1 hall reaches every other one without a stair edge. That says nothing about step-free access.
- **0 of 23 exits** have a geometry-only candidate path to the exit itself. 20 exits have no such path from any origin: every route to them crosses at least one stair edge. 3 exits (4, 13, 36) are routed only to the **foot** of their stairs (`stair_end` nodes): the foot is reachable on geometry-only edges, but the stairs themselves are outside the survey (Exit 4) or only partly surveyed (Exits 13 and 36), and are not claimed as step-free.
- 6 non-stair edges (226.0 m) lie in three islands that can only be reached by stairs: the north-east block (`ne_j__ne_m`, `ne_m__ne_e`, `ne_e__ne_k`), the south-east corridor start (`s38_w__s38_j`) and the south-east corridor (`s41_j__s40_j`, `s40_j__s39_f`).

### 3a. Halls, passages and JR gates (9)

| POI | Connector node | Geometry-only path from every JR gate and B1 hall? | Metres from JR Central Gate 2 / Central Gate 1 / South Gate |
|---|---|---|---|
| `jr-central-gate-2` (JR Central Gate 2) | `g_jr_c2` | yes (same component as all 9 origins) | 0.0 / 28.9 / 233.5 |
| `jr-central-gate-1` (JR Central Gate 1) | `g_jr_c1` | yes (same component as all 9 origins) | 28.9 / 0.0 / 248.4 |
| `central-passage` (Central Passage) | `c_mid` | yes (same component as all 9 origins) | 18.4 / 10.5 / 237.9 |
| `jr-south-gate` (JR South Gate) | `g_jr_s` | yes (same component as all 9 origins) | 233.5 / 248.4 / 0.0 |
| `north-passage` (North Passage) | `n_h` | yes (same component as all 9 origins) | 155.0 / 169.9 / 265.7 |
| `south-passage` (South Passage) | `sp_e` | yes (same component as all 9 origins) | 186.4 / 201.3 / 102.1 |
| `east-exit-b1` (East Exit (B1)) | `c_e2` | yes (same component as all 9 origins) | 95.6 / 110.5 / 206.3 |
| `west-exit-b1` (West Exit (B1)) | `w_c` | yes (same component as all 9 origins) | 118.8 / 110.9 / 230.9 |
| `west-exit-south-b1` (West Exit South (B1)) | `sw_h` | yes (same component as all 9 origins) | 272.5 / 283.4 / 58.4 |

### 3b. Exits routed only to the foot of their stairs (3)

The foot is on surveyed B1 floor. The climb is not modelled and not claimed (README, "Exits whose stairs are outside the survey"), so this is **not** a candidate for the exit.

| POI | Connector | Result | Metres from JR C2 / C1 / South |
|---|---|---|---|
| `exit-36` (Exit 36) | `x36f` (`stair_end`, B1) | reaches the stair foot only, from all 9 origins | 103.7 / 118.6 / 214.4 |
| `exit-4` (Exit 4) | `x4f` (`stair_end`, B1) | reaches the stair foot only, from all 9 origins | 286.8 / 297.7 / 72.7 |
| `exit-13` (Exit 13) | `x13f` (`stair_end`, B1) | reaches the stair foot only, from all 9 origins | 158.5 / 150.6 / 230.0 |

### 3c. Exits behind at least one stair edge (20)

Every route to these exits crosses a `stair` edge. The column lists the stair edges on the shortest route from JR Central Gate 2 (a minimal set: the exit node is joined to the rest of the graph only by stair edges, and the stair edges before it are the ones named).

| POI | Connector node | Stair edge(s) on the shortest route from JR Central Gate 2 | Geometry-only path |
|---|---|---|---|
| `exit-22` (Exit 22) | `x22` | `n_c__x22` | none (0 of 9 origins) |
| `exit-26` (Exit 26) | `x26` | `n_e__ne_j`, `ne_j__x26` | none (0 of 9 origins) |
| `exit-28` (Exit 28) | `x28` | `n_e__ne_j`, `ne_m__x28` | none (0 of 9 origins) |
| `exit-32` (Exit 32) | `x32` | `n_e__ne_j`, `ne_k__x32` | none (0 of 9 origins) |
| `exit-33` (Exit 33) | `x33` | `n_e__ne_j`, `ne_e__x33` | none (0 of 9 origins) |
| `exit-27` (Exit 27) | `x27` | `e_27j__x27` | none (0 of 9 origins) |
| `exit-34` (Exit 34) | `x34` | `e_hall__e_low`, `e_low__x34` | none (0 of 9 origins) |
| `exit-35` (Exit 35) | `x35` | `e_hall__e_low`, `e_low__x35` | none (0 of 9 origins) |
| `exit-37` (Exit 37) | `x37` | `c_s__x37` | none (0 of 9 origins) |
| `exit-42` (Exit 42) | `x42` | `se_j__x42` | none (0 of 9 origins) |
| `exit-43` (Exit 43) | `x43` | `se_j__x43` | none (0 of 9 origins) |
| `exit-41` (Exit 41) | `x41` | `sp_e__s38_w`, `s38_j__s41_j`, `s41_j__s41_f`, `s41_f__x41` | none (0 of 9 origins) |
| `exit-38` (Exit 38) | `x38` | `sp_e__s38_w`, `s38_j__x38` | none (0 of 9 origins) |
| `exit-39` (Exit 39) | `x39` | `sp_e__s38_w`, `s38_j__s41_j`, `s39_f__x39` | none (0 of 9 origins) |
| `exit-40` (Exit 40) | `x40` | `sp_e__s38_w`, `s38_j__s41_j`, `s40_j__x40` | none (0 of 9 origins) |
| `exit-10` (Exit 10) | `x10` | `w_nw__x10` | none (0 of 9 origins) |
| `exit-11` (Exit 11) | `x11` | `w_nw__x11` | none (0 of 9 origins) |
| `exit-15` (Exit 15) | `x15` | `w_n__x15` | none (0 of 9 origins) |
| `exit-17` (Exit 17) | `x17` | `w_n__x17` | none (0 of 9 origins) |
| `exit-18` (Exit 18) | `x18` | `w_n__x18` | none (0 of 9 origins) |

Reading the three tables: a geometry-only candidate is only an absence of a stair edge in a PLATEAU polyline. It is not a route anyone should be told is accessible, and it ends at a hall or at the foot of stairs. No exit has a geometry-only candidate to the exit itself.

## 4. Lifts, escalators and ramps known from public sources but not in the graph

None of these is an edge. An edge needs PLATEAU geometry (sampled on surveyed floor, no wall crossing) **and** an `accessFacts` entry, and a POI needs a node; a public sentence that names two endpoints gives neither the geometry of the passage nor the identity of the opening. Source ids are the research ids: `DR-IK-nn` in `docs/research/gaps/DR-IK-station-facts.md` (PR #177), `CH-IK-nn` in `DR-changes-since-2023.md` (PR #174), `DR-RT-nn` in `DR-retry-unread-sources.md` (PR #197, not yet on this branch's base). All pages were read on 2026-10-22 under the facts-only rule (#26); Tokyo Metro's own pages are `FACTS_ONLY_REFERENCE`. JR East facts are barred (OD-02) and are not recorded here. Tobu gate names are not used (OD-01). OD-18 allows only simple connection facts from the 東武百貨店, 東武ホープセンター and PARCO sites, each with URL and date, and a fact without a second source stays UNVERIFIED.

| # | Facility, as the source words it | Source (id, URL, date) | POIs it would connect | Why it is not an edge | Status |
|---|---|---|---|---|---|
| 1 | Lift (改札外): 中央通路東改札 to 34番出入口 | Tokyo Metro 池袋駅 バリアフリー設備, DR-IK-02, https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html, 2026-10-22 | `metro-m-central-east-gate` (search-only, no node), `exit-34` (routed to the stair top `x34` by `e_low__x34` stairs) | The gate has no node: PLATEAU has no gate semantics and the opening is not identified (`gap-metro-tobu-gates`). No lift geometry is matched to this pair. | Conflict: Metro's exit list (DR-IK-01, https://www.tokyometro.jp/station/ikebukuro/index.html, list rev. 2026-03) puts the ground lift on 35, not 34. Field I2 (FC-IK-02). UNVERIFIED. |
| 2 | Escalator: 中央通路東改札 to 35番出入口 (direction not read) | DR-IK-02, as above | `metro-m-central-east-gate`, `exit-35` | As row 1. PLATEAU has an escalator bank ("esc01", rise 4.39 m) whose lower and upper landings are within about 2 m of the `e_low__x35` stair edge, and no edge for it. That is co-location only, not a match to Metro's pair, and an escalator is not step-free (`NOT_STEP_FREE_MODES`). | Field I2 and H2. UNVERIFIED. |
| 3 | Lift and escalator (改札外): 南通路西改札 to 4番出入口（エソラ） | DR-IK-02, as above; POI `metro-y-south-west-gate` is added search-only by #185 | `metro-y-south-west-gate` (no node), `exit-4` (routed to the foot `x4f`) | The gate line is not placed (`gap-south-west`), the page gives no passage shape, and the stairs of Exit 4 are outside the survey (the graph ends at the foot). | Single source (Metro). Field I8 and F2. UNVERIFIED. |
| 4 | Lift (改札内, inside the fare zone): platform terminus end to 中央通路西改札 | DR-IK-02, as above | `metro-m-central-west-gate` (no node) | Fare areas and platforms are not modelled, and the gate has no node. It is not a free-passage fact. | Not field-checkable from outside the gates. UNVERIFIED. |
| 5 | Lift (改札外): Fukutoshin 西通路東改札 to C9 and to C1b. C1b is new: "階段、エレベーター（1基・20人乗り）", service "始発から終発まで（予定）", start "2024年11月下旬（予定）". Outage notice for C9 lists B1F-1F. | DR-IK-02 and DR-IK-01; Metro release 24-56, DR-RT-18, https://www.tokyometro.jp/news/images_h/metroNews240902_56.pdf, 2024-09-02 (planned values); CH-IK-01 | None: C9, C1b and 西通路東改札 are not POIs, and the Fukutoshin West Passage is outside the routable areas | No POI, no node, no surveyed and fenced-in passage. Dates and hours are plans; the actual opening date is not documented. | Field I5 and I9. UNVERIFIED. |
| 6 | Lift display added to the overhead sign for exit C4 ("EV設置に伴う表示追加"); exits 1a and C4 reported in service from "3月6日" (year not printed; slide tabled 2026-03-25) | DR-RT-10, https://www.city.toshima.lg.jp/documents/56546/20260519131902.pdf, 2026-10-22 | None (C4, 1a are not POIs) | The sign note gives no route, levels or hours. | Field I9 (FC-RT-01). UNVERIFIED. |
| 7 | Exit 2b stairs to 東京芸術劇場 B1, then an elevator to 1F; a wheelchair stair-lift on request by intercom | DR-RT-22 (route guide, text dated 2022.12.16) and DR-RT-20 (https://www.geigeki.jp/access/, fetch summary); rights status UNKNOWN in the register | None (2b is not a POI) | A lead, not a fact for the data. Neither page says 2b reopened; the register records no reopening date. | Field I9 (FC-RT-01) and I6. UNVERIFIED. |
| 8 | Exits 36 and 37: "4 new escalators and an elevator" were being considered (committee 2024-11-05) | CH-IK-04 (DR-CH-20); position and outcome UNKNOWN | `exit-36` (`x36f`), `exit-37` (`x37`) | A statement of consideration, not a built facility. | Field I4. UNKNOWN. |
| 9 | Ikebukuro Shopping Park: step removal at the underground entrance on the 明治通り sidewalk; slope-structure renovation of the central-passage-side entrance under consideration; both 未着手 at the end of FY2019 | Toshima 特定事業計画, DR-RT-24, https://www.city.toshima.lg.jp/documents/15443/tokuteijigyoukeikau_31.pdf, file dated 2020-03-25 | No POI or node; no exit numbers in the source | A 2020 plan, status today unknown; the entrances are not tied to any node. | Field I10 (FC-RT-02). UNKNOWN. |
| 10 | 東武百貨店, 東武ホープセンター, PARCO access pages | DR-RT-07 https://www.tobu-dept.jp/ikebukuro/access/, DR-RT-08 https://tobuhopecenter.jp/info/access/, DR-RT-06 https://ikebukuro.parco.jp/info/, all 2026-10-22 | none | Nothing to add: the department store and Hope Center pages state no lift and no passage hours. PARCO lists a multipurpose toilet (本館B2F・7F, P'PARCO 6F) and no exit number. The simple connection facts OD-18 allows (for example the department store's direct connection to the 西口) say nothing about lift, level or ramp. | Each is a single source, so UNVERIFIED if ever used. |
| 11 | Ground-lift pictograms next to 5 and 19 on Metro's 3D yard map | DR-IK-03, `tokyometro-ikebukuro-yardmap-2026-03` | `exit-5`, `exit-19` (search-only) | Metro's text exit list and accessibility page do not list 19, and the accessibility page puts the ground lift for Y09 at Exit 4, not 5. | Conflict between Metro pages. Field B4, D1, I1. UNVERIFIED. |

PLATEAU escalator geometry that no edge uses (`scene/dressing_anchors.json`, 3 banks, 5 lanes, all from the survey): `esc01` beside the Exit 35 stairs (`e_low__x35`), `esc02` beside the Exit 33 stairs (`ne_e__x33`), `esc03` beside the short flight from the north passage down to the shopping-park passage (`n_e__ne_j`). All three are escalators (not step-free), none carries a type, hours or service direction from a source, and each sits next to a `stair` edge that already stands for that corridor. No lift is known in the survey; whether any PLATEAU element is a lift is the open part of `gap-step-free` ("EF_80 transport elements exist but their type, served levels and hours are unknown").

## 5. Gaps and whether a desk can close them

"Desk-closable" means a document or dataset could close the gap without anyone going on site. Every row that says no is on the field checklist or needs a source that does not exist yet.

| Gap | What step-free needs from it | Desk-closable? | Why, and what is left | Field items |
|---|---|---|---|---|
| `gap-step-free` | Any `wheelchair: true` edge; lift and ramp edges | **No** | The desk part is done: Metro's accessibility page, exit list and 3D map, and the Toshima documents were read (#177, #197). They give names and exit pairs, not passage geometry, levels, hours or which opening is which. The PLATEAU survey has escalators and no identified lift. | I1, I2, I4, I5, I8, I9, I10, I11, I12, I13; H2 |
| `gap-metro-tobu-gates` | Gate openings for any Marunouchi route through the Central Passage | No | No source places a gate line against the geometry. | A1 to A3 |
| `gap-south-west` | Yurakucho 南通路西改札 to Exit 4 pair | No | The page names both ends and says 改札外, but gives no gate line or passage shape. | F2, I8 |
| `gap-west-corridor-exits`, `gap-west-stairs`, `gap-ne-north` | Step-free exits in the West, south-west and north-east | No (yes only if a new survey source or PLATEAU release appears) | The stairs are outside the survey or unmatched; no source states which opening is which exit. | B2 to B6, C1, D1, G1, G2, I3 |
| `gap-tobu-jr-link` | A second west-east link outside the gates | No | Public or transfer concourse is not stated in any source read. | F3 |
| `gap-hours` | Hours for any step-free route (a lift that is closed at night is not a route) | **Partly yes** | Only Metro's own asterisks, lift outage notices and a few lift hours exist; read the rendered Metro exit list again (deferred in #197 until after the browser freeze) and the part of the 2026-03-25 committee 資料3 that was too large to read. Posted exit-level hours need the field. | H1, I1, I8, I9 |
| `gap-freshness` | Evidence younger than the 2022 guide and the 2023 survey | No | Needs a dated walk-through. Desk reading of Metro and ward pages can only list reported changes (CH-IK-01 to 09). | H3, I4 to I7, I9 |
| New, this report: no edge has any wheelchair evidence | `wheelchair` per edge | No | A value needs an observation or a source that names the edge's passage. Neither exists for any of the 63 edges. | I11, I12 |
| New, this report: slope edges are read from sampled geometry | Real grade, step or ramp on the 12 `slope` edges | No | The PLATEAU surface is sampled every 0.5 m with 0.35 m tolerance, so level changes of 0.2 m or less cannot be told from noise. | I11 |
| New, this report: short stair flights with a possible alternative | Ramp, lift or escalator beside `e_hall__e_low`, `sp_e__s38_w`, `s41_j__s41_f`, `n_e__ne_j` | No | Public text names no alternative at these flights. | I12, I13 |
| New, this report: ODPT 駅情報 JSON may carry lift or exit fields | Machine-readable lift facts | **Yes** | DR-IK-15 did not read the payload. If it carries lift data, it still needs the on-site match; it does not give geometry. | none |

### Cheapest next steps

1. Desk (after the 19:30 freeze lifts): read the ODPT 駅情報 payload for lift and exit fields; re-read Metro's rendered exit list for 1a, 2b, C1b and C4; read the remaining pages of the committee 資料3. Each only adds facts; none can set `wheelchair`.
2. One field visit, outside the gates, in the walking order of the checklist: I2 and I11 along the Central Passage and East Hall; I8 along the South Passage; I12 and I13 at the short flights; I9 and I10 are 15 minutes each.
3. Only then author a lift or ramp edge, and only for a pair whose both ends and passage shape are observed. Until then the correct output of the step-free profile is "no path, access unknown".
