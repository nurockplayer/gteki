# Merchant scene inventory and first stretch (2026-10-28)

Merchant scene lead, step 1 of the Owner request of 2026-10-28 JST: real merchants of Ikebukuro and Shinjuku should
show up in the 3D game as shopfronts (sign, window, display, interior light, entrance), not only as POIs and search
results. Tracker #209; Ikebukuro #212; Shinjuku #214 (closed); kit #152; art direction #94.

Base: `origin/main` 9e1c1d37 (2026-10-28 02:5x JST). Public tier (S, OD-35, `docs/research/use-tiers.md`) only:
nothing below comes from P-tier data.

## 1. Merchant data: what is trustworthy enough to draw

Counts from `stations/*/gteki/pois.json` and `tenants.json`.

| | Ikebukuro | Shinjuku |
| --- | --- | --- |
| POIs, all | 527 | 699 |
| `shop` POIs | 352 | 595 |
| `shop` POIs with a verified entrance (`connectorNodeIds`) | **1** (`shop-ikb-lumine` → `g_jr_s`, B1) | 0 |
| `shop` POIs with `floorId` | 0 | 0 |
| `shop` POIs with `displayPosition` | 0 | 0 |
| Tenant rows (brand directories) | 1,167 | 509 |

By evidence level (`docs/research/merchants/store-entrances-2026-10-25.md`, `ikebukuro-b1-merchant-coverage-2026-10-25.md`):

| Level | Merchants | What we may draw |
| --- | --- | --- |
| **Entrance tie printed (READY)** | ルミネ池袋: 「JR池袋駅南改札、正面右手よりすぐ」 → `g_jr_s` (B1, public side) | Its name in text on a generic sign near that gate; see ruling R1 below for how exact the spot may be |
| Station-level tie (PARTIAL) | 東武百貨店 池袋店 (西口直結), エソラ池袋 (有楽町線直結); Shinjuku ルミネ1/2 (ルミネ口), ルミネエスト, ニュウマン, 伊勢丹 本館/メンズ館, マルイ 本館/アネックス, 小田急百貨店 | Nothing placed yet; a data ask could lift some to READY |
| Floor printed, no position | ルミネ池袋 B1 (18 shops), エソラ池袋 B1 (7), department-store tenants with `floorLabel` (東武, 西武 307, 伊勢丹 83 sections, マルイ, 小田急) | Text only (a floor directory board at a READY entrance), never a shopfront at a spot |
| Area or zone only | 池袋ショッピングパーク 南館/北館/レンガ通り (55), 東武ホープセンター サウス/センター/ノース (43), エチカ池袋 改札外 (22) | Nothing placed; these are the next data asks (a printed tie to a gate or exit) |
| Name only | 西武池袋駅 shops, 東京メトロ 駅構内店舗, most Shinjuku listings | Search only |

So today exactly one real merchant has a position we can stand behind, and it is in Ikebukuro on B1, the playable floor.
Everything else stays search-only, and any shopfront drawn away from that gate is an **original placeholder shop**.

## 2. What the scene renders today

| Owner's element | Kit (#152, `assets/library/glb`, desktop + mobile) | Ikebukuro scene | Shinjuku scene |
| --- | --- | --- | --- |
| Facade / glazing | `gteki_shopfront_glazing_w2400` | Not placed. PLATEAU door/window openings get one procedural emissive texture (`materials.ts` `shopPaint`: warm gradient, mullions) with an invisible solid collider behind (`scene.ts` `solidDoors`) | Not placed. Street facades have a generic retail band (`surface.ts`); E27 concourse has none |
| Entrance | `gteki_shopfront_door_w2000` | Not placed | Not placed |
| Shutter (closed / half) | `gteki_shopfront_shutter_w2400_closed`, `_half` | Not placed | Not placed |
| Sign | `gteki_shopfront_fascia_w4800`, **blank** | No shop text anywhere. Station signs already render text (`kit_signs.ts`, `gteki_sign_frame_9slice_h480_d80`), reusable for fascia text | None |
| Window display | **missing** (no shelves, goods, mannequins, food samples) | none | none |
| Interior light | **missing** (no interior depth, no light spill on the floor) | flat emissive gradient only | none |
| Entrance dressing | **missing** (menu A-board, noren, mat, price cards, blade sign) | none | none |

None of the five shopfront GLBs is synced into `stations/ikebukuro/gteki/kit/` (that holds columns, gates, rails and the
sign frame). The kit pieces are generic Lane E art, lit by the scene's PMREM environment until kit baking lands
(`stations/ikebukuro/docs/kit-gap-list.md`, lighting caveat).

## 3. First stretch: Ikebukuro B1 east passage, 中央通路 east end → 北通路

A first survey of the PLATEAU openings (`rooms[].openings`, 63 Door/Window components in `build/ubld_enu.json`,
scratch script, to be committed in step 2a) puts them in a few clusters. Distances are from the walk graph:

| Where (graph edges) | Openings | Distance to the walk | Guided routes |
| --- | --- | --- | --- |
| **`c_n` → `n_h` → `n_c` → `n_e`** (east end of 中央通路 north to 北通路 and east) | **~20**, mostly 3.5–5 m wide glazing, plus 3 doors | 1.6–15 m | I3 (JR Central Gate 1 → Exit 22), I7 |
| Northwest, around (−100, 125…160) | ~10 doors and windows | 3–10 m | none of the goldens |
| JR South Gate (`g_jr_s`) | 4 | 13–18 m | I4 starts there |
| South, around (−15, −100…−130) | ~8 | 40–80 m | none |

**Choice.** The east passage `c_n` → `n_h` → `n_c` → `n_e`: an L-shaped run of about 100 m on B1 with about 20 shop
openings right beside a guided route. These openings are real shop openings in the survey, so placeholder shops go where
the station has a shopfront, not on invented walls. No tenant is tied to any of them yet, so every shop there starts
as an original placeholder.

**ルミネ池袋 as the first real merchant.** It is the only merchant with a printed public-tier entrance tie
(`g_jr_s`, B1) and it prints its B1 tenant list (18). It gets a generic entrance sign with its name in text and a
B1 directory board in text at the South Gate (4 openings there), shipped in the same batch as a small second spot.

**Why not elsewhere.** The northwest cluster is off every guided route; the south cluster is far from the walk;
Shinjuku E27 has no entrance tie and no surveyed openings, and Lane B (#156) is working there.

**Data rules for the stretch.**
- Each placement records `kind: "real" | "placeholder"`. `real` needs a `poiId` with a printed entrance tie; its sign
  carries the name as plain text in our own type, with no logo, photo or brand artwork.
- `placeholder` shops have original generic names in our own words (e.g. 「ベーカリー」「カフェ」), are flagged in
  data as 「示意店面」/"illustrative shop", and never get a POI, a connector, a route node or a search result.
- Placements are visual only: the walk graph, connectors and search index do not change, and every opening keeps its
  solid collider.

## 4. Plan

| Step | Work | Who |
| --- | --- | --- |
| 2a | Commit the opening survey: `pipeline/extract_shop_openings.py` → `scene/shop_openings.json` (centre, normal, width, height, base height, nearest edge and distance), deterministic, + test, like `extract_columns.py` → `columns.json` | worker |
| 2b | `scene/kit_shops.ts`: sync the five shopfront GLBs, place them from a curated `scene/shop_placements.json` (`kind`, `poiId`, sign text), fascia text through the existing sign texture path; route-clearance and collider tests | worker |
| 2c | The missing pieces: window display sets (café, bakery, fashion, drugstore), an interior back card for depth (interior mapping, cheap on phones), menu A-board, blade sign. Materials and light follow `docs/assets/style.md`, agreed with the vertical-transport art lead | worker (Blender, heavy window) |
| 2d | Evidence: same camera before/after at 1280×800 and 390×844, a play-view walk, draw calls and frame time, walk/collision tests and route-clip-audit (#577) | lead + worker |
| 3 | Live on gteki.pages.dev; then stretch 2 (Shinjuku E27, placeholders, after #156) and more real ties from the data lead | lead |

## 5. Open items

- **R1 (director ruling, truth).** May the ルミネ池袋 entrance facade sit in the PLATEAU opening by the South Gate that
  matches 「正面右手よりすぐ」, recorded as a printed relative position (not surveyed), visual only, with no new connector
  or coordinate? Until ruled, it is a name sign and directory board at the gate, not a facade at a chosen opening.
- **Data asks (data lead).** (1) A finer ルミネ池袋 B1 entrance position (facts-only source or the #533 field run);
  (2) printed ties from エチカ池袋, 池袋ショッピングパーク and 東武ホープセンター entrances to named gates or exits on B1;
  (3) any facts-only tie of a tenant to the east passage `c_n` → `n_e` (e.g. a 西武池袋本店 B1 entrance) or to the
  openings near `g_jr_s`, so placeholders there can become real shops.
