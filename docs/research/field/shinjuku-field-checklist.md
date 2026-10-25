# Shinjuku field checklist: the route gaps an on-site look can settle

**For:** the Owner's next Shinjuku visit. **Written:** 2026-10-25 by `ds-infra` for data-research-05. **Docs only: no station data was changed.**

**Gap sources.** The route card `docs/research/routes/shinjuku-first-slice-route.md` §6, G-01–G-12 (PR #484, not yet on `main`) and the gap-closure note `docs/research/routes/shinjuku-route-gap-closure.md` (PR #487: G-08 exit closure, G-09 gate name, G-03 hours). This checklist keeps only what a walk can settle; rights, code and #156 items are listed once at the end.

## 1. The walk this checklist follows

`poi:platform:oedo` (新宿駅（都営大江戸線）ホーム / Toei Oedo Line platform, B6, node `n:e31954cbec9e4b1cac647326d5bcb4e4`) → `poi:gate:2` (改札（地下1階・北側）/ Ticket gates (B1, north side), B1, node `n:d9cd1bb0f76a440d83010e5b9f63ad65`): 14 edges, 136.5 m, two escalators and one gate at the fare boundary. The walk goes up the B6→B3 escalator, follows the B3 concourse, up the B3→B1 escalator, then through the B1 concourse to the north gate.

| # | Edge id (as stored) | From → to | Mode | Length |
|---|---|---|---|---|
| 1 | `e:451d2ec8f7c84ec5ba9d95591af20721` | `n:e31954cbec9e4b1cac647326d5bcb4e4` → `n:f05b059c1a26438aa642be9782e20e89` | walk | 3.4 m |
| 2 | `e:2768d162a2d648cf9df2fc76ca89257f` | `n:f05b059c1a26438aa642be9782e20e89` → `n:c99810e72aa449b284a4d630880a7aa9` | escalator | 35.5 m |
| 3 | `e:9609e8988c7f4ca8a2842bbc882d036e` | `n:c99810e72aa449b284a4d630880a7aa9` → `n:c2d390021c29442f86dda359e503febd` | walk | 5.8 m |
| 4 | `e:291d449b63224d49ae45000c2c16b7ca` | `n:c2d390021c29442f86dda359e503febd` → `n:6bd46cd107a4491bba3469e8f51f9900` | walk | 3.8 m |
| 5 | `e:55ef6f47ff854c04b6c1a8800ad16e12` | `n:6bd46cd107a4491bba3469e8f51f9900` → `n:180ce956ffb7470b9cc42ec7e75255d4` | walk | 16.8 m |
| 6 | `e:a4ed9fc953984c52a914f0cbe73cd318` | `n:180ce956ffb7470b9cc42ec7e75255d4` → `n:453ea111f1524cef8f3ac139bbf2e26b` | walk | 4.8 m |
| 7 | `e:525935a8223f47698df67818a2af4362` | `n:453ea111f1524cef8f3ac139bbf2e26b` → `n:5d2a3fac668d4a068a98e0b9e3aeaf5d` | walk | 9.0 m |
| 8 | `e:2692fe08625f4a3f92d69a1380a58ccd` | `n:5d2a3fac668d4a068a98e0b9e3aeaf5d` → `n:57e00b46b8804e7f95bd92ba9a20fb7b` | escalator | 30.1 m |
| 9 | `e:38541dff6da6468697900bff23840f98` | `n:57e00b46b8804e7f95bd92ba9a20fb7b` → `n:2d2bc35b4043433da2914b2705ef69bb` | walk | 8.6 m |
| 10 | `e:8fcace9d16974a91ae8617b1423de276` | `n:2d2bc35b4043433da2914b2705ef69bb` → `n:1452afaefe044bc98bdd66b7a746842c` | walk | 4.3 m |
| 11 | `e:b56c4b8d15ec46118120e3430388d9f0` | `n:1452afaefe044bc98bdd66b7a746842c` → `n:94efe2c9901d474c8369e21de5b8b16c` | walk | 3.5 m |
| 12 | `e:02c8371d589e429b8c006d60f3d6b73e` | `n:94efe2c9901d474c8369e21de5b8b16c` → `n:1dce5642e8164d59a63976316f18b8a0` | walk | 5.2 m |
| 13 | `e:f9e5aa8338b241b5b78933927d42a12a` | `n:1dce5642e8164d59a63976316f18b8a0` → `n:c8d8d8290e5b419bafc8582997846052` | walk | 2.6 m |
| 14 | `e:3763bee44e4740ac86216e99e212f8d1` | `n:c8d8d8290e5b419bafc8582997846052` → `n:d9cd1bb0f76a440d83010e5b9f63ad65` | gate (fare boundary) | 3.1 m |

Data names used below: `poi:platform:oedo`; `poi:gate:1` 「改札（地下1階・北西側）」, `poi:gate:2` 「改札（地下1階・北側）」, `poi:gate:3` 「改札（地下2階・南東側）」; the six exit POIs `poi:exit:1`–`poi:exit:6` (all descriptors, no printed exit number in the data).

## 2. Rules for this visit

- Public areas only. No faces, no staff-only areas, no track areas, no station offices.
- **The whole route is inside the paid area** (all 14 edges are `paid: true`, the start is the platform). **Do not walk it without a ticket.** Free-side checks that need no ticket: the B1 north-gate sign seen across the gate line, the six exit plates, and the free B1 concourse. Do not pass through any gate without a valid ticket.
- Collect the "during the walk" observations (stops 6–8) while you traverse stops 1–5, **before** leaving the paid area; they are placed there so the visit needs one fare. The free-side exit survey is stop 9, after the gate.
- **Check an escalator's running direction before boarding.** Walk up only while it runs upward; if it is running down, do not ride against it — record the mismatch and use the signed stairs or lift, or stop that segment.
- Ask no one anything, sign nothing, post nothing. Follow staff instructions; no tripods; do not block the flow.
- **Sign photos are private evidence only.** They stay on the Owner's device or private store, never enter the repo or the product, even blurred; only the fact read from them (a number, an hour, a name) is recorded. This is the existing rule in [`../field-collection-list.md`](../field-collection-list.md) ("Rules for every visit").
- Record the date and time on every note. This visit is what supplies the on-site observation G-10 says the card is missing.
- A field note is a dated observation, not a new public source: it can confirm what you see, but it does not by itself change a fact's source count in the data.

## 3. The stops, in walking order

### 1. First escalator B6 → B3 — `e:2768d162a2d648cf9df2fc76ca89257f` (35.5 m)

- **Where:** from `poi:platform:oedo` / `n:e31954cbec9e4b1cac647326d5bcb4e4` across edge 1 to the escalator foot `n:f05b059c1a26438aa642be9782e20e89`, then edge `e:2768d162a2d648cf9df2fc76ca89257f` up to `n:c99810e72aa449b284a4d630880a7aa9` (B3). Mode escalator, one-way `forward`.
- **What to observe** (ticket needed): **check the running direction before boarding**; walk up only while it runs upward, and if it runs down record the mismatch and take the signed stairs or lift instead. Record any posted time-of-day reversal (e.g. 平日朝は下り) — this is the G-06 unknown; the floor labels it connects (地下6階 → 地下3階); whether a lift serves the same floors.
- **Field it fills:** the edge's mode and direction; stair vs escalator.
- **Gap id:** G-06, G-05.

### 2. B3 concourse — `e:9609e8988c7f4ca8a2842bbc882d036e`, `e:291d449b63224d49ae45000c2c16b7ca`, `e:55ef6f47ff854c04b6c1a8800ad16e12`, `e:a4ed9fc953984c52a914f0cbe73cd318`, `e:525935a8223f47698df67818a2af4362`

- **Where:** edges 3–7 between `n:c99810e72aa449b284a4d630880a7aa9` and `n:5d2a3fac668d4a068a98e0b9e3aeaf5d`, the B3 concourse between the two escalators.
- **What to observe:** walk toward the second escalator, following 改札 signs; the floor label 地下3階; any step, threshold or slope on the walk — **count any steps found and record which edge id they sit on**; any lift; posted passage or concourse hours; hoarding or a closure.
- **Field it fills:** edge step-free; `hours`; closure note.
- **Gap id:** G-05, G-03, G-02.

### 3. Second escalator B3 → B1 — `e:2692fe08625f4a3f92d69a1380a58ccd` (30.1 m)

- **Where:** from `n:5d2a3fac668d4a068a98e0b9e3aeaf5d` up to `n:57e00b46b8804e7f95bd92ba9a20fb7b`. Mode escalator, one-way `forward`.
- **What to observe:** **check the running direction before boarding** (same rule as stop 1); any posted reversal; whether a lift serves the same floors; the floor labels (地下3階 → 地下1階).
- **Field it fills:** the edge's mode and direction.
- **Gap id:** G-06, G-05.

### 4. B1 concourse to the gate — `e:38541dff6da6468697900bff23840f98`, `e:8fcace9d16974a91ae8617b1423de276`, `e:b56c4b8d15ec46118120e3430388d9f0`, `e:02c8371d589e429b8c006d60f3d6b73e`, `e:f9e5aa8338b241b5b78933927d42a12a`

- **Where:** edges 9–13 from `n:57e00b46b8804e7f95bd92ba9a20fb7b` to `n:c8d8d8290e5b419bafc8582997846052` (the paid side of the gate line).
- **What to observe:** the floor label 地下1階; the signs ahead naming the gate — read and record the exact wording (this pre-reads G-09); any step, threshold or slope on these walking edges — **count any steps found and record the edge id**; any lift or escalator passed; confirm no gate line is crossed before the destination gate (the fare boundary should be edge 14 only); posted concourse or passage hours; hoarding.
- **Field it fills:** `hours`; POI name/alias (pre-read); fare state; edge step-free.
- **Gap id:** G-09, G-03, G-07, G-02, G-05.

### 5. The B1 north gate — `e:3763bee44e4740ac86216e99e212f8d1` (3.1 m, gate), `poi:gate:2`

- **Where:** the gate edge from `n:c8d8d8290e5b419bafc8582997846052` to `n:d9cd1bb0f76a440d83010e5b9f63ad65`; `poi:gate:2` prints 「改札（地下1階・北側）」/「Ticket gates (B1, north side)」, a positional descriptor with no operator name or number.
- **What to observe:** **photograph the sign above the gate showing its name** (sign photo = private evidence only); copy the exact printed name and number and any line or concourse tag; count the gate lanes; confirm it is the north-side B1 gate the descriptor claims; note any posted gate hours. View it from the free side without a ticket; if you have a ticket, note the paid-side plates too. Do not pass through without a valid ticket.
- **Field it fills:** POI name/alias (`poi:gate:2`); a printed gate name would be the first name evidence for G-09.
- **Gap id:** G-09; also G-07 (the fare boundary is this edge).

### 6. During stops 1–5: posted hours — all 14 edges

- **Where:** the B6, B3 and B1 concourses and passage mouths on the route (`e:451d2ec8f7c84ec5ba9d95591af20721` through `e:3763bee44e4740ac86216e99e212f8d1`), all `hours: null`. Record these **as you pass them on stops 1–5**, not after leaving the paid area.
- **What to observe:** copy any posted concourse or passage hours or shutter times. Do **not** use exit hours (printed for exits 4–7 as 6:00–23:00 and exit 8 as 7:00–23:00), first/last train times, or the 定期券販売情報 11:00–20:00 ticket-office block — if you see that block, record it as the known trap, never as passage hours.
- **Field it fills:** `hours` on the 14 edges.
- **Gap id:** G-03.

### 7. During stops 1–5: lifts and step-free — the walking edges and the lift landings

- **Where:** the 11 walking edges `e:451d2ec8f7c84ec5ba9d95591af20721`, `e:9609e8988c7f4ca8a2842bbc882d036e`, `e:291d449b63224d49ae45000c2c16b7ca`, `e:55ef6f47ff854c04b6c1a8800ad16e12`, `e:a4ed9fc953984c52a914f0cbe73cd318`, `e:525935a8223f47698df67818a2af4362`, `e:38541dff6da6468697900bff23840f98`, `e:8fcace9d16974a91ae8617b1423de276`, `e:b56c4b8d15ec46118120e3430388d9f0`, `e:02c8371d589e429b8c006d60f3d6b73e`, `e:f9e5aa8338b241b5b78933927d42a12a` (all `wheelchair: null`), and every lift landing you pass. Anchor a landing to the nearest route node on its floor: B6 `n:e31954cbec9e4b1cac647326d5bcb4e4` / `n:f05b059c1a26438aa642be9782e20e89`; B3 `n:c99810e72aa449b284a4d630880a7aa9` / `n:5d2a3fac668d4a068a98e0b9e3aeaf5d`; B1 `n:57e00b46b8804e7f95bd92ba9a20fb7b` / `n:c8d8d8290e5b419bafc8582997846052`.
- **What to observe:** every step, threshold or slope on the walking edges — count steps and name the edge id; every lift you pass: floors served, where it opens, whether the B1 landing is on the paid or free side, floor labels. The card's `--step-free` alternative (26 edges, 166.3 m) was **not evidence-checked**, and its edge ids are not in the card — record the landings you see and do not assign them to an edge yourself; the data lane matches them. Walking the full lift path is a separate branch, not part of this one-fare walk.
- **Field it fills:** edge step-free and lift facts.
- **Gap id:** G-05.

### 8. During stops 1–5: closures and changes — the paid route

- **Where:** the 14 edges above.
- **What to observe:** hoarding, barriers, a closed passage; record the exact node or edge it sits on.
- **Field it fills:** closure note.
- **Gap id:** G-02 — the current-state part only; the `stale` flag is source age and a walk cannot clear it.

### 9. Free side: E27 exits and closures — `poi:exit:1` to `poi:exit:6`

- **Where:** the six mapped E27 exit points, each with its connector node; order by floor, following the exit signs (free side, after the gate):

| POI | Data name (descriptor, no printed number) | Connector node | Floor / side |
|---|---|---|---|
| `poi:exit:5` | 出口（地下1階・北側・階段に隣接） | `n:032cf295875e4f1fa99164971cab0680` | B1, north |
| `poi:exit:6` | 出口（地下1階・南側・通路/コンコースに隣接） | `n:5cbcddf0b6e34fb89c2b7ee1220b35b2` | B1, south |
| `poi:exit:1` | 出口（地上・北側・階段に隣接・屋根あり） | `n:a06f3d191885497bac197b666c4daef9` | street, north |
| `poi:exit:2` | 出口（地上・北西側・通路/コンコースに隣接） | `n:4423521d79e54865b7c41e4aec29826d` | street, northwest |
| `poi:exit:3` | 出口（地上・南側・エレベーターに隣接） | `n:e6feaa2cc7514b68be2758b956baeb28` | street, south |
| `poi:exit:4` | 出口（地上・南側・階段とエスカレーターに隣接） | `n:e4cfe61e944e4f5e8ad8caeb6d521750` | street, south |

- **What to observe:** at each, read the plate: the printed exit number and any name or line tag (大江戸線 / 新宿線 / 京王新線); any 閉鎖中 tag or closure notice — copy the printed text; for a closed exit, note which passage and gate it adjoins. The Toei page (read 2026-10-22) tags exits 1 and 2 閉鎖中, and the only notice on file is for the 新宿線 2番出口, which cannot be matched to any E27 POI by printed name. **Never infer a printed number from a POI id** — `poi:exit:2`'s `2` is internal and the gap closure forbids using it; record the printed number at the POI whose plate you read, and if a printed number cannot be tied to the POI you are standing at, record the plate text and its location separately. The shared station's A1 and exits 7–8 are outside these six POIs (the existing `FC-SJ-02` row covers the full set); if you pass them, record the plate text but do not attach them to a `poi:exit:*` POI by position. Do not enter a paid area for an exit check without a ticket.
- **Field it fills:** POI name/alias (exit numbers); closure note.
- **Gap id:** G-08.

## 4. Photo care

- The gate sign above `poi:gate:2` and every exit plate are **sign photos = private evidence only**; never committed, never published, even blurred.
- Inside the paid area, photograph signs or surfaces only — no people, no staff, no operations, no track areas, no gate-line interiors.
- No tripods; do not block the flow; follow staff instructions.
- Nothing photographed goes into the repo; only the wording, number or hour you read is recorded.

**Paid area:** the route from the Oedo platform is paid on all 14 edges — **do not walk it without a ticket**. Free-side checks without a ticket: the B1 north-gate sign across the gate line, the six exit plates, and the free B1 concourse. Never enter staff areas.

## 5. Not field-checkable

G-01 (rights), G-04 (heights and lengths, which need a measured survey), G-11 (PLATEAU street context), G-12 (cross-operator continuation, which needs sourced passages) and G-02's `stale` verdict are not field-checkable and stay with the data/rights lanes; rights, code and #156 items are out of scope for this checklist.
