# Ikebukuro first-slice route evidence card: 西口（地下） → 22番出口（推定対応）

**Card for the bounded L2 route slice (2-week plan, week 1, item 1; #3, #165). Written 2026-10-25 by `ds-research` for data-research-05. Base commit `f8743e63` (`origin/main`, 2026-10-25). Docs only: no station data was changed by this card.**

This card records one positive route and one negative case, both taken from the shipped Ikebukuro bundle as it is today. Every statement below is either read from `stations/ikebukuro/data/graph.src.json`, from the built bundle `stations/ikebukuro/gteki/{station,graph,pois}.json`, or produced by running the repo's own router (`packages/navigation` via `packages/cli/src/route.ts`). No passage, connector or stair was inferred, hand-drawn or added. One identification on the route is an inherited positional match rather than an independent one: which PLATEAU stair-top closure is Exit 22 (`af-ne-exits`, 5–9 m from the projected map position; see G5).

## 1. Why this pair

- **Start**: `west-exit-b1` — 西口（地下） / West Exit (B1), connector node `w_c`.
- **Destination**: `exit-22` — 22番出口（推定対応）/ 東口（北）/ East Exit (North): a PLATEAU stair-top closure **provisionally matched to Exit 22** rather than a one-to-one fixed exit (G5), connector node `x22`.
- It crosses the whole station on the public B1 level and arrives at **street level**, which is the arrival moment L2 item 1 asks for and the two existing recorded walks do not have (`stations/ikebukuro/docs/l2-evidence.md` §1: both end underground or at a stair foot).
- Every one of its 9 edges carries both a PLATEAU geometry check and an `accessFacts` entry whose `sourceIds` resolve in `sources` (§4). In the graph, no edge on the path is marked paid, closed or synthetic — graph fields, not a current operating-condition check (G7).
- It is short enough to record in one take (277.4 m, about 4 minutes at the router's pace) and uses five different access facts, so one recording exercises most of the station's evidence classes.
- The いけふくろう landmark from #342 cannot be used as the start: it has no node, POI or source-backed position in the repo (§8, G11).

## 2. The path, as the router returns it

```
lockf -k /tmp/GTEki-local-test.lock pnpm exec tsx packages/cli/src/route.ts \
  stations/ikebukuro west-exit-b1 exit-22 --from-poi --goal-poi --today 2026-10-24
```

Result (`gteki.route/0.1`, `today` = Saturday 2026-10-24, profile `fare: ticketed`, `stepFree: false`):

| Field | Value |
|---|---|
| `ok` | true |
| nodes | `w_c → c_w → c_mid → c_g2 → c_c → c_e1 → c_n → n_h → n_c → x22` (10 nodes, 9 edges) |
| `totalLengthM` | 277.4 |
| `estimatedSeconds` | 244 (walk 266.4 m at 1.2 m/s + stairs 11.0 m at 0.5 m/s; `ROUTE_PACE`) |
| `floorChanges` | 1 (`b1` → `street`, on the last edge) |
| `crossesFareBoundary` | false |
| `operatorIds` | `["public"]` |
| `synthetic` | false |
| `stale` / `oldestSourceDate` / `evidenceCheckedDate` | `true` / `2022-01` / `2026-10-22` |
| `unknowns` | `hours` on all 9 edges; `wheelchair` on the 8 walk edges |
| `timeRestricted` | `[]` |
| `sourceIds` | `plateau-ubld-13116`, `tokyometro-ikebukuro-yardmap-2026-03`, `toshima-terminal-sign-guideline-draft-v1.3`, `toshima-underground-guide-2022` |

Router narration (both languages, as produced):

- ja: 出発 ／ 約112m 進む。約100m先の分岐は左寄りに進む ／ 右へ曲がり約72m。約55m先の分岐はそのまま直進 ／ 左へ曲がり約82m ／ 階段で上へ・地上へ ／ 目的地に到着
- en: Start / Go ~112 m. After ~100 m, keep left at the junction. / Turn right, ~72 m. After ~55 m, continue straight through the junction. / Turn left, ~82 m / Take the stairs up to street level / Arrive at destination

Path legs, in order (`from → to`, mode, length, cumulative):

| # | Edge id | Leg | Mode | Length (m) | Cumulative (m) |
|---|---|---|---|---|---|
| 1 | `c_w__w_c` | `w_c → c_w` (edge stored `c_w → w_c`, reversed) | walk | 63.1 | 63.1 |
| 2 | `c_w__c_mid` | `c_w → c_mid` | walk | 37.3 | 100.4 |
| 3 | `c_mid__c_g2` | `c_mid → c_g2` | walk | 11.4 | 111.8 |
| 4 | `c_g2__c_c` | `c_g2 → c_c` | walk | 21.3 | 133.1 |
| 5 | `c_c__c_e1` | `c_c → c_e1` | walk | 33.2 | 166.3 |
| 6 | `c_e1__c_n` | `c_e1 → c_n` | walk | 17.8 | 184.1 |
| 7 | `c_n__n_h` | `c_n → n_h` | walk | 75.8 | 259.9 |
| 8 | `n_h__n_c` | `n_h → n_c` | walk | 6.5 | 266.4 |
| 9 | `n_c__x22` | `n_c → x22` | stairs | 11.0 | 277.4 |

Node evidence (all 67 edges in this bundle are `verification: "verified"`):

- `w_c`, `c_w`, `c_mid`, `c_g2`, `c_c`, `c_e1`, `c_n`, `n_h`, `n_c` — floor `b1`, `kind: junction`, `inOut: inside`, single `sourceRef` `{plateau-ubld-13116, walkable-grid-cell}`, z 27.91–28.49 m (surveyed walking heights, not a flat level).
- `x22` — floor `street`, `kind: exit`, `inOut: boundary`, same `sourceRef`, z 32.42 m = the PLATEAU stair-top closure height that `af-ne-exits` matched to Exit 22.

## 3. Per-edge evidence

Every edge is `verification: "verified"`, `paid: false`, `crossesFareBoundary: false`, `closed: false`, `hours: null`. Geometry evidence for all nine edges is the same source and method:

- **Geometry**: `plateau-ubld-13116`, `sampled-on-plateau-surface:step=0.5m,tol=0.35m;no-wall-crossing` (the last, stair edge: `tol=0.9m`), `checkedDate 2026-10-22`.

Access evidence, edge by edge:

| # | Edge | Access fact | Access `sourceIds` | Fact checked | What the fact states (paraphrase of the stored text) |
|---|---|---|---|---|---|
| 1 | `c_w__w_c` | `af-central-passage-west` | `toshima-underground-guide-2022` | 2026-10-20 | 中央通路 continues west outside the fare gates past the Marunouchi and Tobu Tojo central gates into the 西口 underground hall; matched to PLATEAU floor TP 27.9 m |
| 2–6 | `c_w__c_mid`, `c_mid__c_g2`, `c_g2__c_c`, `c_c__c_e1`, `c_e1__c_n` | `af-central-passage` | `toshima-underground-guide-2022`, `tokyometro-ikebukuro-yardmap-2026-03` | 2026-10-20 | 中央通路 is a public east-west passage outside fare gates linking the west and east exits |
| 7 | `c_n__n_h` | `af-east-jr-passage-north` | `toshima-underground-guide-2022` | 2026-10-20 | A public passage runs north from the Central Passage along the east side of the JR concourse to the North Passage; matched to the PLATEAU passage linking them |
| 8 | `n_h__n_c` | `af-north-passage` | `toshima-underground-guide-2022` | 2026-10-20 | 北通路 is a public passage outside fare gates; east of the Exit 22 stairwell a short flight leads down to the ISP-blocks passage (that down-flight is on `n_e→ne_j`, not on this flat 6.5 m edge: `n_h` and `n_c` are both at z 28.45) |
| 9 | `n_c__x22` | `af-ne-exits` | `toshima-underground-guide-2022`, `tokyometro-ikebukuro-yardmap-2026-03` | 2026-10-20 | Exit 22 (東口（北）) rises from the stairwell in the North Passage; exit order matched one-to-one to PLATEAU stair-top closures (TP 32.1–32.4 m, 5–9 m from the projected map positions). The identification of this particular closure as Exit 22 is that positional match, not an independent fix (G5) |

Endpoints:

| Endpoint | POI | Connector | POI evidence `sourceIds` | Method | Checked |
|---|---|---|---|---|---|
| Start | `west-exit-b1` (西口（地下）) | `w_c` | `toshima-underground-guide-2022` | area name as printed on the map; connector = a junction inside that area | 2026-10-21 |
| Destination | `exit-22` (22番出口 / 東口（北）) | `x22` | `toshima-underground-guide-2022`, `tokyometro-ikebukuro-yardmap-2026-03`, `plateau-ubld-13116`, `toshima-terminal-sign-guideline-draft-v1.3` | exit number from the official maps; location = PLATEAU stair-top closure | 2026-10-20 |

The router folds the endpoint evidence into `result.sourceIds`, which is why `toshima-terminal-sign-guideline-draft-v1.3` appears in the route summary: POI `exit-22` cites it for the name-to-number mapping 東口（北）=22 only. That source is a draft (案, Ver1.3) and is explicitly **not route evidence** (OD-22, PR #222); the route itself does not depend on it (see G10).

## 4. Sources cited by this route

| Source id | Title | Publisher | URL | Retrieved | Dataset date | Rights / usage | Attribution to show | Decision |
|---|---|---|---|---|---|---|---|---|
| `plateau-ubld-13116` | PLATEAU 豊島区 2025 地下街モデル (ubld) 53394576 — 池袋駅_B1地下通路 | 国土交通省 Project PLATEAU (survey: 東京都 2023 LidarSLAM) | https://www.mlit.go.jp/plateau/ (GML: https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml, sha256 `38f17964…901ac09`) | 2026-10-20T10:44:13Z | 2023 | `REUSABLE_WITH_CONDITIONS`; PLATEAU Site Policy 「３．著作権について」; modified by GTEki | 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成 | G0 audit; #161 for the CC BY wording |
| `toshima-underground-guide-2022` | 池袋駅地下空間案内図 (2022年1月版) | 豊島区 | https://www.city.toshima.lg.jp/405/1705251510.html | 2026-10-20T10:52:00Z | 2022-01 | `REFERENCE_ONLY`, `usage: facts-only` | 豊島区「池袋駅地下空間案内図」(facts only; not reproduced) | #26 comment (2026-10-21), facts/works separation |
| `tokyometro-ikebukuro-yardmap-2026-03` | 東京メトロ 池袋駅構内立体図 (2026.3現在) | 東京地下鉄 | https://www.tokyometro.jp/station/ikebukuro/yardmap/index.html | 2026-10-20T10:49:00Z | 2026-03 | `REFERENCE_ONLY`, `usage: facts-only` | 東京メトロ 池袋駅構内図 (facts only; not reproduced) | #26 comment (2026-10-21) |
| `toshima-terminal-sign-guideline-draft-v1.3` | 池袋ターミナル案内サインガイドライン（案） Ver1.3 (資料3-3 p20) | 豊島区 | https://www.city.toshima.lg.jp/documents/56546/20260519131956.pdf | 2026-10-22T00:00:00+09:00 | 2026-03 | `REFERENCE_ONLY`, `usage: facts-only` | 豊島区「池袋ターミナル案内サインガイドライン（案）Ver1.3」(facts only; not reproduced) | OD-22 / PR #222 — exit names only, never route evidence |

Rights check for this route: all three REFERENCE_ONLY sources are used under the Owner's facts/works separation (#26, 2026-10-21) — exit numbers, gate names and access facts may be used and published; no map image, layout or pictogram is copied. The PLATEAU geometry is redistributable with the attribution above plus a modification notice (reprojected to a local ENU frame, triangulated, re-encoded as glTF). **No edge on this path depends on a source whose terms ban the use**, and no source in the route is `UNKNOWN` rights. Nothing on the path is JR East data (OD-02; traced in the G0 audit).

## 5. Negative case: a search-only shop POI

**Chosen case**: `shop-ikb-lumine-000496` — TOMORROWLAND, ルミネ池袋 1F.

```json
{
  "ok": false,
  "reason": "unknown_goal",
  "message": "destination has no verified entrance"
}
```

Command: the same CLI call with `--goal-poi shop-ikb-lumine-000496`; exit status 1, `path` and `polyline` empty, no instructions.

Why the router refuses, in data terms:

- `connectorNodeIds: []`, `displayPosition: null`, `floorId: null`, `paid: null` — the POI has no node and no position, so there is nothing to route to.
- Evidence: `lumine-ikebukuro-floorguide-2026-10` (株式会社ルミネ, https://www.lumine.ne.jp/ikebukuro/floorguide/, retrieved 2026-10-24T09:18:40Z, `REFERENCE_ONLY` / `facts-only`, decision #377 comment, 2026-10-24), method `facts-only directory listing (OD-23/OD-31/OD-33), UNVERIFIED, AREA_ONLY`.
- The POI note states it in both languages: 「ルミネ池袋 1F。位置・入口は未確認（検索のみ。案内ルートなし）。現在の営業状況は未確認。」 / "LUMINE Ikebukuro, 1F. Location and entrance not verified (search only, no route). Current status unknown."

What the product shows today (`apps/web/src/ui/noRouteText.ts` + `apps/web/src/i18n.ts`): for `unknown_goal` on a shop with no connector and no position, `t.shopNoRoute` —

- ja: この店舗への道案内はまだありません（位置未確認）
- en: No directions to this shop yet (location not verified).

This is the behaviour the acceptance contract asks for ("a negative route case fails safely", `docs/acceptance.md`): a refusal with the reason named, not a guessed route.

Scale of the negative class in this bundle: **32 of 516 POIs are routable** (23 exits, 3 ticket gates, 6 area POIs) and the other 484 are search-only — 348 shops, 14 escalator, 7 lift, 29 service, 12 ATM, 7 locker, 23 toilet, 30 exits, 13 ticket gates and 1 other POI (`seibu-minami-guchi`). All 484 have an empty `connectorNodeIds`, and `routeBetween` (`packages/navigation/src/poi.ts:20`) refuses any such goal with `unknown_goal` before the search starts, so the refusal shown above is that shared code path, not a property of this one POI.

A second, softer case the product must *warn* on rather than refuse: `exit-36` (`x36f`) is routed only to its stair foot — 93 of the 992 ordered POI pairs in #203 end at a stair foot (Exits 4, 13, 36). This card's destination `exit-22` is **not** one of them: `x22` is the street-floor stair top (the closure provisionally matched to Exit 22), and the route's single floor change is that stairwell.

## 6. Freshness

| Item | Date | Freshness note |
|---|---|---|
| Geometry (PLATEAU ubld, survey year) | `datasetDate` 2023 (creationDate 2024-03-15) | Older than the router's 730-day default as of 2026-10-25; a field visit cannot clear this (`gap-freshness`, #203 A8) |
| Access facts from the Toshima underground guide | `datasetDate` 2022-01 | The route's `oldestSourceDate`; drives `stale: true` |
| Tokyo Metro yard map | `datasetDate` 2026-03 | 2026-03 source; later changes unverified |
| Draft sign guideline (names only) | 2026-03 | Draft (案); replace when the final guideline is published |
| Edge geometry checks | `checkedDate` 2026-10-22 | Latest check, recorded on every edge |
| Edge/POI access checks | `checkedDate` 2026-10-20 (edges), 2026-10-21 (start POI) | Route `evidenceCheckedDate` 2026-10-22 |

The route's own freshness verdict is `stale: true`, `expiredSourceIds: []`, `undatedSourceIds: []`. The route card must show the stale state and `evidenceCheckedDate`; nothing here supports a "current as of today" claim.

## 7. Geographic limits

- Frame: station-local ENU metres, snapped from the PLATEAU grid; `gridBBox` [-190, 180, -190, 186].
- This path spans x −107.0 … 80.0 m, y 41.5 … 122.0 m, z 27.91 … 32.42 m (33 polyline vertices). It stays inside the surveyed free B1 passage network and the stairwell provisionally matched to Exit 22.
- Modelled here: public B1 passages outside fare gates and the PLATEAU stair closures they meet. **Not modelled**: fare-paid concourses and platforms (JR East, Tobu, Seibu, Tokyo Metro), shop interiors, the street surface, Echika and the Fukutoshin C exits.
- The card therefore claims arrival at a PLATEAU stair-top closure provisionally matched to Exit 22, not a walkable street beyond it (G13).
- Hours are unknown on every edge: no night-time or 24-hour claim is made (`gap-hours`).

## 8. Gap list

Each item is a place where this route's evidence, freshness, redistribution right or attribution is missing or weaker than the card's claim. `#161`, `#203`, `#342` are cited where they set the rule.

1. **G1 — Hours unknown on all 9 edges.** `hours: null`; the router reports `unknowns: hours ×9` and `timeRestricted: []`. The station README and `coverage-gaps.md` (`gap-hours`) say the same. The card must not imply round-the-clock access.
2. **G2 — Step-free status unknown on the 8 walk edges, and the last edge is stairs.** `wheelchair: null` on `c_w__w_c` … `n_h__n_c`; `wheelchair: false` and `steps: true` on `n_c__x22` (11 m, 28.45 → 32.42 m). No lift or escalator fact exists for Exit 22 (`gap-step-free`), so the graph has **no step-free variant** of this slice and the product must not offer one; that is a data-coverage limit, not a finding that no accessible route exists in the real station.
3. **G3 — The route is stale, by design of the sources.** `stale: true`, oldest source 2022-01, geometry 2023. `gap-freshness` records that a field walk cannot clear it; #203 A3 records that `coverage.freshness: "2023"` in `station.json` is neither the latest (2026-03) nor the oldest (2022-01) source date, and #203 A8 that the street floor's `_note` contradicts its `sourceLabels`.
4. **G4 — 145.4 m of 277.4 m (52%) rests on a single 2022 facts-only source.** `af-central-passage-west` (63.1 m), `af-east-jr-passage-north` (75.8 m) and `af-north-passage` (6.5 m) each cite only `toshima-underground-guide-2022`. OD-18's rule ("a fact confirmed by a second public source is preferred, and one that is not is marked UNVERIFIED") is not reflected anywhere in the graph or the route output. This is the main corroboration gap; the rights position itself is settled (#26).
5. **G5 — Exit 22's stair is matched positionally, not fixed one-to-one.** `af-ne-exits` matches exit order to PLATEAU stair-top closures "5–9 m from the projected map positions", so a neighbouring closure could in principle take the Exit 22 number and the route would arrive at a different exit than the narration says. The endpoint must therefore be presented as a provisional Exit 22 (a modelled stair top) until a field check confirms the identity. Step count, riser height and the street-level landing are also unrecorded; the narration 「階段で上へ・地上へ」 is backed, but "11 m of stairs" is PLATEAU tread geometry, not a stair schedule.
6. **G6 — Whole-edge stair tagging (#203 A1) has not been step-checked on `n_c__x22`.** The builder tags an entire edge `stairs` once the A* path touches a stair face; #203 A1 found two edges where only ~2.6 m of the edge was a flight. This 11 m edge climbs 3.97 m, which is consistent with a real flight, but no step-level check is recorded.
7. **G7 — `paid`, `crossesFareBoundary` and `steps` are build defaults, not stated facts (#203 A6).** The "outside the fare gates" claim on this path rests on the `af-*` facts, not on those flags. The path passes the mouth of JR Central Gate 2 (`c_g2`, about 7 m south of `g_jr_c2`) without crossing it; platforms behind the gate are not modelled.
8. **G8 — Facts-only credit wording is not implemented in the app** (`stations/ikebukuro/docs/g0-g4-status.md` row 8, #122): the UI currently shows `[REFERENCE_ONLY, facts-only]` instead of the agreed wording. The attribution strings in §4 are the ones a shipped route card must show.
9. **G9 — PLATEAU licence wording must not say "CC BY 4.0".** The repo's recorded licence for this dataset is the catalogue's Site Policy 「３．著作権について」; the CC BY clause seen earlier is recorded as unconfirmed evidence and is not shown (#161, G0 audit). This card does not re-decide the licence: it repeats the repo's recorded position and its attribution string (§4) so the route card and the app cannot disagree.
10. **G10 — The draft guideline is name evidence only; the data needed no fix (checked 2026-10-25, `graph.src.json` at `d1ed1986`).** `toshima-terminal-sign-guideline-draft-v1.3` is marked "never as route evidence" (OD-22, PR #222) and supports only POI `exit-22`'s name mapping (東口（北）=22). Its citations are all name or asset evidence — POI `exit-22`, the other exit POIs (`exit-19`, `exit-37`, `exit-38`, `exit-4`), the station identity's east-side entry and the `signage` data file — and **no edge's `accessEvidence` and no `accessFacts[].sourceIds` cite it**; the built `gteki/graph.json` cites it zero times. It reaches the route summary because the router merges the endpoint POIs' `evidence.sourceIds` into `result.sourceIds` (`packages/navigation/src/poi.test.ts:85`), so the summary shows it flatly beside the path's sources although it carries a name, not the path. Nothing is removed: the citation stays where it supports the name, and the route must not be read as resting on it. **Code follow-up for gteki-fa:** separate endpoint name evidence from path evidence in `result.sourceIds` (e.g. an `endpointSourceIds` list), so a card that copies the summary cannot present a draft as route evidence.
11. **G11 — The いけふくろう landmark cannot start this slice.** There is no node, POI, `accessFacts` entry or source-backed position for it anywhere in the repo (the only record is #342 ruling 7: a factual name and location marker are allowed, no replica). L2 item 1 wants a walk "from at least one actual in-scene landmark"; until a source gives its position, the start is the 西口（地下） **area** POI, not a point landmark. This is a data gap for the L2 walkthrough, not a rights problem.
12. **G12 — Both endpoints are area-level or alias-level evidence.** `west-exit-b1` is a single-source (2022) area name whose connector is "a junction inside that area"; `exit-22`'s second name 東口（北） comes from the draft guideline and the two official maps, while its position is the stair-top closure. Accurate as written, but the card should not present either endpoint as a surveyed point.
13. **G13 — The street end is a stair-top closure, not surveyed street.** `x22` is a `street` node whose only `sourceRef` is the ubld model's `walkable-grid-cell`, at z 32.42 m. The ubld survey covers B1; the street floor's own `_note`/`sourceLabels` disagree (#203 A8). Arrival is at the stair-top closure provisionally matched to Exit 22; walking on from there is outside this route's evidence.
14. **G14 — Cosmetic citation drift on the negative-case POI.** `shop-ikb-lumine-000496`'s evidence method still cites OD-23/OD-31/OD-33, while its source decision is the LUMINE terms check in #377 (OD-34, which partly supersedes OD-33). The refusal is correct; only the citation should be updated.

## 9. Reproduce

```sh
# positive case
lockf -k /tmp/GTEki-local-test.lock pnpm exec tsx packages/cli/src/route.ts \
  stations/ikebukuro west-exit-b1 exit-22 --from-poi --goal-poi --today 2026-10-24

# negative case (exit status 1, reason unknown_goal)
lockf -k /tmp/GTEki-local-test.lock pnpm exec tsx packages/cli/src/route.ts \
  stations/ikebukuro west-exit-b1 shop-ikb-lumine-000496 --from-poi --goal-poi --today 2026-10-24
```

Both commands were run on the card's base `f8743e63`. The positive output is byte-identical to runs made on `386beb9f` and `1c5b30b3` (the station bundle is unchanged between them). No station test file was run for this card.
