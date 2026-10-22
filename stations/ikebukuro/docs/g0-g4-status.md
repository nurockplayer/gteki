# Ikebukuro: G0-G4 status against `docs/acceptance.md`

**Read at main `dc59b38` (2026-10-22).** This replaces the gap list posted on #3 (read at `250c7e5`, now stale).

This is not an acceptance and not a merge gate. Lane F gives the independent verdict, and the Owner decides acceptance. Companion: [l2-evidence.md](l2-evidence.md) (the four required L2 evidence items, what exists, what is missing, how to capture it).

Status words:

The words are the ones in `docs/acceptance.md` and `docs/qa/protocol.md`:

- **PASS**: concrete evidence is cited (file:line, test, PR or report). Every PASS here rests on desk evidence; no field visit was involved. A row that a human has to judge (the G3 look-and-feel rows) is not PASS until the Owner or an independent reviewer has judged it on current main.
- **GAP**: missing evidence or scope, including "nothing checked either way yet" (formerly UNKNOWN); the row says what closes it. "(#N in flight)" in the evidence cell means an open PR carries it. "needs eyes" means a person has to look.
- **HOLD**: blocked on an Owner, rights or field decision (here, the Owner's on-site visit).
- **FAIL**: a demonstrated defect against the gate (none listed).

What was run for this refresh, on a clean checkout of `dc59b38`, single worker, no browser or GPU:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `pnpm exec vitest run packages/schema/src/stations.test.ts` | 2/2 |
| `pnpm exec vitest run --maxWorkers=1 stations/ikebukuro` | 103 passed, 2 skipped, 1 failed on the first run: `crowd.test.ts` "keeps every sampled pedestrian of the real crowd inside the routable union" timed out at the 5 s default while the other files ran. It passes alone (16/16, 2.7 s). Fixed in #176 with a 60 s timeout on that one test. |
| `pnpm build` (root, the deploy build) then `pnpm audit:assets --dist apps/web/dist` | ok: 10 shipped files, every one declared, every non-inlined declared file found in `dist` by sha256 (see G0 row 6) |
| `GTEKI_UBLD_ENU=<extract of the pinned GML> pnpm exec vitest run stations/ikebukuro/scene/frame.test.ts` | 12/12; **17,703 of 17,703** sampled PLATEAU polygon vertices are in the shipped GLB within 1 cm (see G1 row 2) |

Not re-run here (cited from the PRs that ran them): `pnpm check:godot` (re-run 2026-10-22 11:40 slot on #110's head, see G1 row 6), `pnpm test:heavy`, `pnpm check:access`, any browser run.

## G0 Evidence / rights / safety

| # | Criterion | Status | Evidence, or what is missing | Owner |
|---|---|---|---|---|
| 1 | Downloaded resource, coverage and licence checked before use | PASS | [G0-source-audit.md](G0-source-audit.md); `pipeline/fetch_sources.sh` re-checks sha256. Today the pinned GML (`53394576_ubld_6697_op.gml`) hashes to `38f17964...901ac09`, equal to `station.json` `sources[plateau-ubld-13116].sha256`, and `frame.test.ts:219` ties the GLB to that hash. | Ikebukuro |
| 2 | No inferred edges, paid-area shortcuts, invented stairs or levels, guessed 24 h access | PASS | `build_station.py` fails unless an edge has geometry evidence and an access fact. `routing.test.ts:253` (hours unknown on every edge; `require_known` fails closed) and `:283` (no paid edge). Exits 4, 13 and 36 end at the stair foot, as documented in the README. | Ikebukuro |
| 3 | Missing accessibility data is UNKNOWN | PASS | `routing.test.ts:269` (wheelchair is `null` on every edge; step-free fails closed) and `:275`. Lane F IN3. | Ikebukuro |
| 4 | Open-data rights: dataset, derivative, attribution | GAP | The dataset, licence and attribution facts check out on the desk; the Japanese wording is not on main (#110 in flight). PLATEAU ubld 53394576, CC BY 4.0, `modified: true`. On main `station.json:138` is still the English string "Contains PLATEAU data (MLIT), CC BY 4.0. Modified: ..."; the #39 Japanese line 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」 is in #110 (`a5f27e6`). Persistent on-screen credit is Lane C's #137. | Ikebukuro, Lane C |
| 5 | Operator graphics reference-only | GAP | Open until the pictogram below is resolved; the rest holds. Toshima 2022 and Tokyo Metro 2026-03 are `facts-only` in `station.json`; JR East was traced and is not used. All 34 evidence JPEGs have been looked at one by one by a Claude subagent (model and effort not recorded; not an independent review; see [evidence/README.md](evidence/README.md)): no photographs, no operator maps or logos; signs are GTEki's. One distant sign in `24-south-passage-west.jpg` carries a pictogram too small to read; a human should check it against JIS/operator pictograms (an open point the evidence README already records). The two MP4s are checked by one frame each only. | Ikebukuro, Lane F |
| 6 | Independent audit of every shipped asset against the manifest | GAP | Non-inlined files: PASS on desk evidence. Inlined JSON: GAP (#121). Lane F desk audit: [#12 comment](https://github.com/nurockplayer/gteki/issues/12#issuecomment-6324807437). `pnpm audit:assets` (#142, `pipeline/audit_assets.ts`) run today against the real `pnpm build` output with `--dist`: 10 files, all declared; both GLBs and both lightmaps are in `dist` byte-for-byte (`ikebukuro_b1.glb` `aef077a6...`, `ikebukuro_b1_lit.glb` `29b98e44...`); the two small `.meta.json` are inlined by Vite, as the audit expects. One WARN remains and is pinned on purpose: `ikebukuro_b1_lit.meta.json` records `source_glb_sha256 e0188c50...` while the shipped generic GLB is `aef077a6...` (a material-only rebuild, `lit_provenance.test.ts:64-76`, #139). Still open: the four inlined scene JSON files (`signage`, `crowd_lanes`, `walk_bridges`, `access_fences`) are not declared anywhere (#121). [inlined-data-declarations.md](inlined-data-declarations.md) (#150) proposes a `dataFiles` schema; it needs `packages/schema` and `apps/web/stations-plugin.ts`, so it is Lane C's. | Lane F (audit), Lane C (#121) |
| 7 | Street-context rights (#39) | GAP | (#110 in flight) Owner chose option (b) on #39 (buildings, roads as geometry only, credit shown in-app). #110 at `d3e248a` carries the sources, the credits and the independent review. Nothing street-related is on main. | Ikebukuro |
| 8 | Facts-only credit wording (#26 follow-up) | GAP | The app shows `[REFERENCE_ONLY, facts-only]`, not the agreed wording. Draft: `docs/gis/decisions/facts-only-credit-wording.md`; tracked as #122. | Lane C |
| 9 | Field verification of access, gates and hours | HOLD | 21 checks (A1 to H4) plus section I (I1 to I7: FC-IK-01 to 03 and the #174 freshness checks) in [field-checklist.md](field-checklist.md); Exit 9 is B2. | Owner |

## G1 Geometry

| # | Criterion | Status | Evidence, or what is missing | Owner |
|---|---|---|---|---|
| 1 | Model scale and local coordinates | PASS | Real-scale PLATEAU geometry, identity transform, z = TP height. `frame.test.ts:123` (both GLBs' POSITION bounds equal the ENU bounds mapped by `enuToRenderer`, 1 mm) and `:162-205` (Python extractor, `packages/geo` and `tools/gis` agree on the origin; worst difference 0.424 mm over 75 footprint points). | Ikebukuro |
| 2 | CRS to station-local to renderer round trip | PASS | `frame.test.ts:97` (every node and edge vertex round-trips exactly), `:123` and `:148` (the shipped GLBs and the graph are in the renderer frame), `:219` (PLATEAU polygon vertices in the GLB). The extract-to-GLB check only runs where the git-ignored `ubld_enu.json` exists; it was run here from the pinned GML: 17,703/17,703 vertices within 1 cm. Limit: the test starts from the extractor's output, so the GML's own lat/lon is trusted through the Python-vs-TS agreement, not read by the test. | Ikebukuro |
| 3 | Collisions | PASS | `walker_replay.test.ts:35` (the explorer's real walker never reaches floor outside the routable areas), `:47` and `:58` (negative controls: drop the longest panel, drop all fences); `access.test.ts:11-30` (outline coverage, flood). README records 1.52 M replayed steps with 0 escapes and 126/126 keyboard-walked edges; those long runs were not repeated here. | Ikebukuro |
| 4 | Floor connectors; no clipping or teleport shortcuts | PASS | README G1 (Exit 35, 28, 18 stairs and the level changes); Lane F free walks I1-I6 on `b511263`. Caveat from Lane F: the Exit 18 switchback has been walked upward only; the full descent is not covered. | Ikebukuro, Lane F |
| 5 | Approximations documented | PASS | README "Deliberate simplifications"; copied into [l2-evidence.md](l2-evidence.md). | Ikebukuro |
| 6 | Godot compatibility | PASS | Proof path only (parity is row 7): `pnpm check:godot` (#93): 63 edges, 7,140 samples, 0 blocked; negative control reproduces `w_n__x18`. Re-run in the 2026-10-22 11:40 slot on #110's head: identical. | Ikebukuro |
| 7 | Godot parity with the web's fences and doors | GAP | Awaiting a decision. Access fences are web-only; doors, windows and portals do not collide in Godot. README recommendation: not now, keep `check:godot` as the regression gate. | Core, Owner |
| 8 | No camera clipping in guided travel | GAP | #56, #85 and #90 are merged, but Lane F has not re-run Ikebukuro on current main. One transient frame (`ikebukuro-walk-jrc2-exit35-07`, camera above the stair cover, near-black 0.202) did not recur in about 530 frames. | Lane F |

## G2 Routing

| # | Criterion | Status | Evidence, or what is missing | Owner |
|---|---|---|---|---|
| 1 | Paths follow a verified directed graph | PASS | 62 nodes, 63/63 edges verified, 1,744 m. `routing.test.ts:39` (golden JR Central Gate 2 to Exit 35: 9 edges, 198.6 m, one floor change, two stair edges) and `:49` (optimal for every endpoint pair against an independent Dijkstra). | Ikebukuro |
| 2 | Substantial source-grounded route, confidence and freshness shown | PASS | Same golden, plus 17 other exits (README G2). Freshness: `routing.test.ts:233` (oldest source 2022-01, evidence checked 2026-10-21) and `:241`: **on 2026-10-22 the route is `stale: true` under core's default 730 days** (the 2022 Toshima guide), fresh only with a longer window. The UI should therefore show a stale flag; Lane F should confirm it on the route card. | Ikebukuro, Lane F |
| 3 | Negative routes fail safely | PASS | `routing.test.ts:103-130` (unknown ids, start equals goal, search-only POI, `no_path`); Lane F IN1-IN5 on `b511263`. | Ikebukuro, Lane F |
| 4 | Core test matrix (stale, closed link, level transition, wrong-way, unknown, accessible, paid, cross-operator) | PASS | `routing.test.ts`: one-way `:131`, closed link `:151`, level transition `:187`, freshness `:225`, hours and step-free `:249`; fare-paid and cross-operator rows do not apply (asserted, `:281-291`, no paid edge, one operator). | Ikebukuro |
| 5 | Narration reads sensibly | PASS | `routing.test.ts:207`: the "stairs down, then stairs up to street level" in I1 is real (`e_hall` to `e_low` down, `e_low` to `x35` up), closing Lane F's A5. | Ikebukuro |
| 6 | Exits and gates routable | GAP | 20 POIs are search-only (5 gates, 15 exit numbers; #185 adds a 21st, a sixth gate) and refuse to route (`routing.test.ts:113`). Per-POI evidence: [coverage-gaps.md](coverage-gaps.md) (#140). Cheapest field unlock: checklist B2 (Exit 9). Desk research R1 (data-research PR #177, merged, `DR-IK-station-facts.md`, 2026-10-22) found no public source that closes the blocker for any of the 20, so all 20 stay search-only; the per-POI verdicts are the last column of the coverage-gaps table. One candidate is not wireable yet: `metro-m-central-east-gate` (Metro's pages disagree on whether the lift is at Exit 34 or 35, FC-IK-02). | Ikebukuro, Owner |
| 6b | Yurakucho 南通路西改札 POI (not one of the 20) | GAP | Yurakucho 南通路西改札 to Exit 4 is stated by Tokyo Metro's accessibility page with both endpoints (改札外 lift and escalator), and Exit 4 is already routed. The Owner approved adding this POI ([relayed by the director on #165](https://github.com/nurockplayer/gteki/issues/165#issuecomment-6334967835)); the director then decided it ships **search-only** ([#3 comment, item 3](https://github.com/nurockplayer/gteki/issues/3#issuecomment-6335140484)), because the page gives neither the gate's position nor the passage geometry. #185 (in flight) adds it as `metro-y-south-west-gate`, with no node, no edge, and it refuses to route. Until #185 merges the gate has no POI (`gap-south-west`). Field item I8 (with F2) checks the gate line and the passage. | Owner |
| 7 | Narration and destination match real public access within data freshness | GAP | Based on a 2023 survey and 2022/2026 map facts; hours unknown; gate lines not placed. Needs the field visit; see "Freshness risks since the 2023 survey" below. | Owner |

### Freshness risks since the 2023 survey (G0 / G2 field-check items)

Source: data-research PR #174 (merged as `2b49ad2`, `docs/research/gaps/DR-changes-since-2023.md`, items CH-IK-01 to 09; PR #177 is merged too). These are **checks, not conclusions**: each is a public report of a change or plan, with the outcome unconfirmed. **No graph, POI or access data was changed here.** They add to `gap-freshness` (geometry is a 2023 survey; later construction unknown) and to the field checklist; none is verified on site.

| Item | Public report (per #174) | What it could affect in the shipped data | Field check |
|---|---|---|---|
| CH-IK-04 | Stairs at exits 36 and 37: at the Toshima committee of 2024-11-05 a store representative said 4 new escalators and an elevator were being considered there; position and outcome unknown | `exit-36` (node `x36f`, a stair-foot connector), `exit-37` (node `x37`) and edges on the Seibu-side passage; also `gap-step-free` | Are there escalators or a lift at the 36 / 37 stairs now, and did the stair or passage geometry change? |
| CH-IK-01 | Fukutoshin Line exit C1b is new (C1 renamed C1a); it has an elevator per Metro; opening date unconfirmed | No shipped POI or `accessFacts` entry names C1b, so nothing is wrong today; it is an unmapped exit and a possible lift fact for `gap-step-free` | Confirm C1a / C1b naming and opening; record lift facts only if sourced |
| CH-IK-02 | Metro exit 2b planned closed 2024-09-30 to 2025-07-07; no reopening found | Not among the shipped POIs; relevant only if Metro-side exits are ever routed | Is exit 2b open? |
| CH-IK-05, 06 | 西口地区 redevelopment plan decided 2024-11-11; 池袋駅付近地下道 No.3 and No.4 listed for "change" in the 2024-06-04 notice (one secondary summary says abolition, not read in an opened document); no closure tied to either was found | Slice 4 and 5 passages and exits in the West Exit area (西池袋一丁目 / 三丁目): `gap-west-stairs`, `gap-west-corridor-exits` (exits 5, 6a, 6b, 7, 8, 9) and the verified West Exit hall edges | Whether any West Exit passage, stair or hoarding differs from the 2023 survey; which physical passages No.3 and No.4 are |
| CH-IK-03 | Exit 1b sign changed to wall-embedded during a 2025 building renovation; no passage change stated | None expected | Photograph the sign for facts only |
| CH-IK-07 to 09 | Concept-stage over-track east-west deck, east plaza (2040s), Tobu platform work | None today (beyond 2030, or no gate or passage change stated) | None |

Effect on the rows above: G0 row 9 and G2 row 7 stay HOLD / GAP, and G2 row 2's `stale: true` is the right signal. These items give the field visit a concrete list. They are now checks I4 to I7 in [field-checklist.md](field-checklist.md) section I (CH-IK-04, 01, 02, 05/06), together with FC-IK-01 to 03 from #177, cross-referenced to the existing A to H items.

## G3 Quality (L2)

| # | Criterion | Status | Evidence, or what is missing | Owner |
|---|---|---|---|---|
| 1 | Actual recorded walks | GAP | Needs eyes: Owner or independent reviewer on current main. The recordings are stale: `docs/evidence/walk-jr-central-gate2-to-exit35.mp4` (121 s, 2026-10-20) and `walk-west-exit-to-exit4.mp4` (117 s, 2026-10-21). Both predate #38, #48, #54, #56, #81 and #85. A recording on current main is in the capture plan (l2-evidence.md item 1). | Ikebukuro |
| 2 | Lighting: no blown-out destinations (A3) | GAP | Needs eyes: Owner or independent reviewer on current main (Lane F judged PASS on `b511263`; main has changed since). Fix `30a82fb`: clipped white 41.82 % to 0 % at the Exit 35 stair top ([stills 30-33](evidence/30-a3-exit35-stair-top.jpg)). Lane F on `b511263`: clipped white max 0.85 % desktop and 0.04 % phones per walk frame, near-black max 0.047 (#3 comment, interim list). | Lane F |
| 3 | Avatar is not a glare source (C4) | GAP | Needs eyes: Owner or independent reviewer on current main. Indirect evidence only: the per-frame clipped-white maximum above includes the avatar (rigged commuter, #38). No dedicated C4 re-judgement is recorded. | Lane F |
| 4 | Recognizable station identity | GAP | Finishes are generic and procedural. A4 / #108: repeater signs in #126 (`23662c9`, draft). #94: Lane E kit and look work in flight (#133, #143, #145, #155, #105, #119, #134, #136, #160); Blender versus game RMSE 0.450 (escalators) and 0.325 (gates) at main `15cf589` ([report](../../../docs/qa/reports/2026-10-22-art-94-look-gap.md)). | Ikebukuro, Lane E, Lane G |
| 5 | Sound and input comfort | GAP | Procedural ambience (`scene/ambience.ts`) plays through the host audio hook; nobody has assessed it by ear. Headless capture has no audio review. | Lane F, Owner |
| 6 | Desktop and phone capture | GAP | Desktop: recorded. Phone: emulation only (iPhone 15 WebKit, Pixel 7 Chromium) on a desktop GPU; no physical phone. The 641 ms iPhone-WebKit guide frame (`a5a555c`) has not been re-measured. | Owner, Lane F |
| 7 | Independent critique | GAP | Stale: the only independent visual review was Astra at `08d4668` (that model is retired). Lane F plans a fresh read-only Claude review of current frames and video against the reference-only documents. | Lane F |
| 8 | Side-by-side with the real reference | HOLD | Needs the field visit and the Owner's own judgement. The desk version (facts against the reference-only documents) is a checklist in l2-evidence.md. | Lane F, Owner |
| 9 | Street-level context at exits | GAP | (#110 in flight) Draft, CI green, head `d3e248a`. 2026-10-22 measurement slot: underground identical to main; street level +5-9 draws and +20-30k triangles on the low tier; Godot: context loads with no colliders. Open on GPU: roads against the explorer's pavement plane at x10, x11, x15, x39, x42, the follow camera against buildings, load time. | Ikebukuro, Lane F |
| 10 | Overview opening frame (C5, #109) | GAP | (#114 in flight, Lane C) 79 % near-black desktop overview at `b511263`. | Lane C |

## G4 Delivery

| # | Criterion | Status | Evidence, or what is missing | Owner |
|---|---|---|---|---|
| 1 | Reproducible build and tests | PASS | pnpm only. Frozen install, deploy build and the Ikebukuro suite pass on `dc59b38` (table above). The one timeout flake is fixed in #176. | Ikebukuro |
| 2 | PR and reviewed SHA | PASS | #14 at `82d1a11` (merged), then #62, #78, #80, #87, #93, #139, #140, #142, #144, #150, #154 (merged; review records are on each PR). | Ikebukuro |
| 3 | Screenshots and video | PASS | `docs/evidence/`: 34 JPEGs and 2 MP4s; Lane F frames in `docs/qa/reports/2026-10-21-evidence/`. | Ikebukuro |
| 4 | Sources and rights bundle | PASS | 3 sources, [G0-source-audit.md](G0-source-audit.md), evidence credit README (#150). Street context is added by #110. | Ikebukuro |
| 5 | Coverage report | PASS | [coverage-gaps.md](coverage-gaps.md) plus the `station.json` twin. | Ikebukuro |
| 6 | Known limitations and handoff | PASS | This file, [l2-evidence.md](l2-evidence.md) and the README pointer replace the stale "Remaining" lists (merged in #176, `c0cb22f`). | Ikebukuro |
| 7 | Owner approval; no live-travel guarantee | GAP | Owner acceptance not recorded: no Owner statement approving delivery or the no-live-travel-guarantee wording was found in the issue threads searched (#3, #6, #12, #26, #39, #165). The earlier PASS rested on the lane's own #3 comment (6324197321), not on an Owner link. What the UI shows (desk-verified, hours unknown) is a product fact, not an approval. | Owner |
| 8 | Independent Lane F verdict on current main | GAP | The last full Lane F run is `b511263`; nothing newer. Lane F's order: full QA on main, `10-look-compare`, the independent review, the G0 asset audit. | Lane F |
| 9 | `e2e-smoke` becomes a required check | GAP | Planned around 2026-10-29 if stable (#76). | Lane F, Lane C |

## Remaining GAPs, with owner

Desk-closable by Ikebukuro: none left. What remains needs a GPU or phone, another lane, the Owner, or the field.

| Item | Owner | Needs |
|---|---|---|
| Lane F verdict on current main; G1 row 8 camera recheck; Exit 18 full descent; stale flag on the route card | Lane F | GPU slot (see l2-evidence.md capture plan) |
| Fresh independent side-by-side review (G3 7, 8) | Lane F | Read-only Claude subagent over fresh frames and the video |
| Physical phone checks (G3 6) | Owner | A real iPhone and Android phone |
| Field visit: 21 checks plus section I (FC-IK-01 to 03, I8 南通路西改札, CH-IK-04, 01, 02, 05/06); search-only POIs; hours; narration versus reality (G0 9, G2 6, 7, G3 8) | Owner | On-site |
| Sound assessment (G3 5) | Owner, Lane F | Listening on a device |
| Inlined scene JSON declared (G0 6) | Lane C | `packages/schema` and `apps/web` change (#121, proposal in #150) |
| Facts-only credit wording (G0 8); persistent HUD credit (G0 4) | Lane C | #122, #137 |
| Overview opening frame (G3 10) | Lane C | #109, #114 |
| Street context lands: credit wording, roads versus pavement plane, camera (G0 4, 7; G3 9) | Ikebukuro, Lane F | #110 GPU slot, then merge |
| Wayfinding repeaters (G3 4) | Ikebukuro, Lane F | #126 judged on the recorded walk |
| Kit and look (G3 4) | Lane E, Lane G, Ikebukuro | #94 PRs; finish packs are a data-only follow-up once #133 lands |
| Godot door and fence parity (G1 7) | Core, Owner | Decision |
