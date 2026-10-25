# Ikebukuro field checklist: the route gaps an on-site look can settle

**For:** the Owner's next Ikebukuro visit. **Written:** 2026-10-25 by `ds-infra` for data-research-05. **Docs only: no station data was changed.**

**Gap sources.** The route card `docs/research/routes/ikebukuro-first-slice-route.md` §8, G1–G14 (on `origin/main`, PR #482); the gap-closure note `docs/research/routes/ikebukuro-route-gap-closure.md` (PR #485); the landmark note `docs/research/routes/ikebukuro-ikefukuro-landmark.md` (PR #489, for G11). This checklist keeps only what a walk can settle; rights, code and data-lane items are listed once at the end.

## 1. The walk this checklist follows

`west-exit-b1` (西口（地下）/ West Exit (B1), node `w_c`) → `exit-22` (22番出口 / 東口（北）, node `x22`): 277.4 m, 9 edges, one floor change (the last stair). Everything is on free B1 public passages except the final stair to street. The walk is west → east on 中央通路, then north along the east side of the JR concourse to 北通路, then east to the Exit 22 stairwell and up.

| # | Edge id (as stored) | From → to | Mode | Length |
|---|---|---|---|---|
| 1 | `c_w__w_c` | `w_c` → `c_w` (stored `c_w → w_c`, reversed) | walk | 63.1 m |
| 2 | `c_w__c_mid` | `c_w` → `c_mid` | walk | 37.3 m |
| 3 | `c_mid__c_g2` | `c_mid` → `c_g2` | walk | 11.4 m |
| 4 | `c_g2__c_c` | `c_g2` → `c_c` | walk | 21.3 m |
| 5 | `c_c__c_e1` | `c_c` → `c_e1` | walk | 33.2 m |
| 6 | `c_e1__c_n` | `c_e1` → `c_n` | walk | 17.8 m |
| 7 | `c_n__n_h` | `c_n` → `n_h` | walk | 75.8 m |
| 8 | `n_h__n_c` | `n_h` → `n_c` | walk | 6.5 m |
| 9 | `n_c__x22` | `n_c` → `x22` | stairs | 11.0 m |

Data names used below: `west-exit-b1` 「西口（地下）」; `central-passage` 「中央通路」 (connector `c_mid`); `north-passage` 「北通路」 (connector `n_h`); `jr-north-gate` 「JR 北改札 / JR North Gate」 (search-only, no connector); `jr-central-gate-2` 「JR 中央2改札」 (connector `g_jr_c2`); `exit-22` 「22番出口」「東口（北）」.

## 2. Rules for this visit

- Public areas only. No faces, no staff-only areas, no track areas, no station offices.
- **Do not cross any gate line without a ticket.** The route never crosses one; the JR 北改札 and the other gates are paid boundaries. The いけふくろう check is done from the free side.
- Ask no one anything, sign nothing, post nothing. Follow staff instructions; no tripods; do not block the flow.
- **Sign photos are private evidence only.** They stay on the Owner's device or private store, never enter the repo or the product, even blurred; only the fact read from them (a number, an hour, a name) is recorded. This is the existing rule in [`../field-collection-list.md`](../field-collection-list.md) ("Rules for every visit").
- Record the date and time on every note.
- A field note is a dated observation, not a new public source: it can confirm what you see, but it does not by itself change a fact's source count in the data.

## 3. The stops, in walking order

### 1. 西口（地下）— start of the route (`w_c`, POI `west-exit-b1`)

- **Where:** the west underground hall, node `w_c`; POI `west-exit-b1` prints 「西口（地下）」/「West Exit (B1)」 and uses `w_c` as its connector.
- **What to observe:** read the hall name plates and exit signs; copy the exact wording (does any plate print 西口（地下）, or a different proper name?). Then walk **east** into 中央通路 — the route's direction — away from the west-side exits.
- **Field it fills:** POI name/alias (`west-exit-b1`), which rests on the 2022 map's area name.
- **Gap id:** G12 (endpoint is area-level evidence).

### 2. 中央通路 west run — `c_w__w_c` (63.1 m), access fact `af-central-passage-west`

- **Where:** edge `c_w__w_c` from `w_c` to `c_w`, the stretch the fact describes as passing the Marunouchi and Tobu Tojo central gates. The named gate POIs are `metro-m-central-west-gate` 「丸ノ内線 中央通路西改札」, `metro-m-central-gate` 「丸ノ内線 中央通路中央改札」, `tobu-central-gate-1` 「東武東上線 中央1改札」 and `tobu-central-gate-2` 「東武東上線 中央2改札」.
- **What to observe:** walk **east**; confirm the passage is continuous and **outside the fare gates** (no gate line across it); read every gate plate on this run and copy the exact wording — Metro prints 中央通路西改札, while the existing list expects Tobu's 中央連絡西改札, so record which wording is actually on each plate. Record **which** of those gates actually sit on this west run: the gap-closure note could corroborate only the Marunouchi side, and the Tobu Tojo clause is the one still single-source.
- **Field it fills:** `accessFacts` — the Tobu Tojo clause and the 西口-hall arrival of `af-central-passage-west`.
- **Gap id:** G4; also G7 (fare state).

### 3. 中央通路 centre — `c_w__c_mid`, `c_mid__c_g2`, `c_g2__c_c`, `c_c__c_e1`, `c_e1__c_n` (access fact `af-central-passage`)

- **Where:** the passage from `c_w` east to `c_n`, through `c_mid` (POI `central-passage` 「中央通路」), `c_g2` (the mouth of JR 中央2改札, `jr-central-gate-2`, about 7 m north of the node), `c_c` and `c_e1`.
- **What to observe:** keep walking **east**; note that the passage stays on the free side and passes the gate mouth without crossing it; note any step, threshold, slope or the narrowest point (these edges are `wheelchair: null`); read the JR 中央2改札 plate.
- **Field it fills:** `accessFacts` (`af-central-passage`); edge step-free (`wheelchair`).
- **Gap id:** G4, G2, G7.

### 4. North run — `c_n__n_h` (75.8 m), access fact `af-east-jr-passage-north`

- **Where:** edge `c_n__n_h` from `c_n` north to `n_h`, along the east side of the JR concourse; `n_h` is the connector of POI `north-passage` 「北通路」.
- **What to observe:** walk **north**; confirm the public passage continues and stays outside the gates; locate JR 北改札 (`jr-north-gate`) and note whether it opens directly onto this passage; note every lift, escalator and step.
- **Field it fills:** `accessFacts` (`af-east-jr-passage-north`: the public passage north of the JR concourse); edge step-free.
- **Gap id:** G4, G2.

### 5. いけふくろう — detour at JR 北改札 (`jr-north-gate`; no graph node)

- **Where:** on the free side by JR 北改札 (`jr-north-gate`), B1, between the gate and 北通路. The route anchors are `c_n` (the south end of the north run) and `n_h` / POI `north-passage` 「北通路」; the statue itself has no node or POI. The printed sources place it at 「JR池袋駅 東口」「地下1階 JR改札付近」 (豊島区) and, in ISP's words, on the route that leaves JR 北改札, turns right, passes the statue and then declines the stairs up. No source gives it a node or a position.
- **What to observe:** stand where a passenger who has just come out through JR 北改札 would stand — **facing away from the paid area** — then **turn right** (ISP's own direction) and walk until you find the statue. Record: which side of the passage it is on; how many structural columns or metres from the gate line; whether it stands at the foot of the street stairs, beside their mouth, or along the passage; which named element it is nearest — `n_h` (北通路), `c_n`, or the JR 北改札; and whether any plate names it 「いけふくろう」. Then walk **back** to `n_h` and continue east.
- **Field it fills:** a factual name plus a position note relative to a **named** gate or passage — the thing G11 needs to become a point landmark. The data lane decides whether it becomes a POI.
- **Gap id:** G11.

### 6. 北通路 — `n_h__n_c` (6.5 m), access fact `af-north-passage`

- **Where:** edge `n_h__n_c` from `n_h` (POI `north-passage` 「北通路」) east to `n_c`, east of the Exit 22 stairwell.
- **What to observe:** walk **east**; locate the Exit 22 stairwell first, then the short flight that leads down to the passage between the ISP blocks, and record whether it really is **east of that stairwell** (this clause is still single-source; the down-flight is on `n_e→ne_j`, not on this flat 6.5 m edge). Read the 北通路 signs.
- **Field it fills:** `accessFacts` (`af-north-passage`: the "east of the Exit 22 stairwell" clause).
- **Gap id:** G4.

### 7. Exit 22 stair — `n_c__x22` (11.0 m, stairs), node `x22`, POI `exit-22`

- **Where:** the stair from `n_c` up to `x22`; POI `exit-22` prints 「22番出口」 and 「東口（北）」/「East Exit (North)」. The stair top is the PLATEAU closure provisionally matched to Exit 22.
- **What to observe:** at the stair head, read the exit plate: does it print 22 and/or 東口（北）? **Count the steps** on the flight and note whether the whole 11 m is a flight or part landing. Note whether an escalator or lift serves this exit (the data has no lift or escalator fact for it). Then walk **up** and step aside at the top.
- **Field it fills:** the edge's stairs/step count; POI name/alias (`exit-22`).
- **Gap id:** G5 (identity of the stair as Exit 22), G6 (whole-edge stair tag), G2 (no step-free variant), G12 (printed name).

### 8. Street landing — `x22`

- **Where:** the stair top at street level (model z 32.42 m), the end of the route.
- **What to observe:** what the landing opens onto — the street or building name on the plates, whether it is roofed, whether a lift reaches street here. Step aside; do not walk into the road.
- **Field it fills:** POI `exit-22` landing note (the model ends at a stair-top closure, not surveyed street).
- **Gap id:** G13, G2.

### 9. Posted hours — all 9 edges

- **Where:** every passage mouth, door, shutter and exit stair on the walk: `c_w__w_c`, `c_w__c_mid`, `c_mid__c_g2`, `c_g2__c_c`, `c_c__c_e1`, `c_e1__c_n`, `c_n__n_h`, `n_h__n_c`, `n_c__x22`. All nine carry `hours: null`.
- **What to observe:** copy any posted 通行可能時間 / 開館時間 / shutter time, edge by edge; if there is none, write "none seen" for that edge. Do **not** use shop hours (ISP 10:00–21:00, 東武ホープセンター 10:00–21:00) or first/last train times as passage hours — they are facility or service hours, not passage hours.
- **Field it fills:** `hours` on the 9 edges.
- **Gap id:** G1.

### 10. Lifts, escalators, steps — the 8 walk edges

- **Where:** `c_w__w_c` through `n_h__n_c` (all `wheelchair: null`), plus the Exit 22 stair.
- **What to observe:** every lift and escalator seen: where it is, which floors it serves, whether it is on this route; every step, threshold or slope on a nominally flat passage — **count any steps found and record the edge id they sit on**. Note whether a lift serves Exit 22. Observing a lift does not create a lift edge; the data lane decides.
- **Field it fills:** edge step-free/lift facts.
- **Gap id:** G2.

### 11. Closures and changes — the whole walk

- **Where:** the whole route.
- **What to observe:** hoarding, a shutter down, barriers, a rerouted passage; record the node or edge it sits on and copy the sign wording.
- **Field it fills:** closure note.
- **Gap id:** G3 — the closure/change part only. The `stale` flag itself is source age and a walk cannot clear it.

## 4. Photo care

- **Sign photos** (gate-name plates, exit plates, posted hours, direction signs above a gate or stair) are private evidence only — never committed, never published, even blurred. Only the fact read from them is recorded.
- The いけふくろう photo is also private evidence: it is neither a surface close-up nor a sign, and the statue is a public meeting spot — keep faces out of frame and do not publish it.
- Do not photograph staff, gate-line interiors, track areas or anyone's face; wait or reframe.
- No tripods; do not block the passage; follow staff instructions.

**Paid area:** the walk crosses no gate line, but the paid side of JR 北改札 and every other gate is a boundary — **do not enter without a ticket**. The いけふくろう is observed from the free side.

## 5. Not field-checkable

G3's `stale` verdict, G8 (facts-only credit wording in the UI), G9 (PLATEAU licence wording), G10 (draft source in `result.sourceIds`, a code follow-up) and G14 (citation drift) are not field-checkable and stay with the data/code lanes; rights, code and #156 items are out of scope for this checklist.
