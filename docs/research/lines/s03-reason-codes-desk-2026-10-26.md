# S03 v5_nav reason codes — what public sources settle at the desk (2026-10-26)

**Written:** 2026-10-26 11:5x JST by data-research-98 (data lead), from the director's 11:4x JST request: "S03 的 reason code 裡能用公開資料在桌面上解決的先做 … 解不了的列進 #533".
**Docs only.** No station data, POI, graph, tool or test file changes. Nothing here lifts the S03 HOLD; that needs the director's sign-off. **Context:** the gap table's S03 note (#544) and gteki-31's receipt `docs/gis/s03/nav-route-1dbcbe456d260edb18e6.json`: 351 of 351 gate pairs reachable, 0 routable.

## Answer in one line per code

| Code (graph edges) | Desk result | Basis | What is still open |
|---|---|---|---|
| `CRS_UNCONFIRMED` (2,254) | **Evidence found.** The spec prints the v5_nav frame as Mercator. The Mercator inverse matches the existing two-affine chain to ≤ 0.123 m for all 2,506 nodes | Spec §4.4, §4.6 (S1); §1 below | The director's ruling. The datum stays as the spec prints it ("WGS84"); JGD2011 vs WGS84 is cm-level at this scale |
| `CHECK_A_CONTAINMENT_FAIL` (2,254) | **Not settled by a source.** This is a computation on the station footprint (level 64677 = 1F, 0.917 inside) | — | GIS work after the CRS ruling. Not a field item |
| `CHECK_B_RESIDUAL_UNVERIFIED` (2,254) | **Not settled.** No new independent control points. The only public candidate is the MLIT 新宿駅周辺屋内地図 (R2), and its downloads are login-gated, so it was not fetched (§4) | — | GIS work. Control points must come from a source we may read |
| `FLOOR_ORDINAL_UNVERIFIED` (2,254) | **Half settled.** S03 prints its own level names and an ordering value `z` for all 11 levels (§2). The S03 level ↔ bundle `floorId` tie is **not** printed anywhere | S03 file (CC BY 4.0, factual fields); spec §3.2.3, §4.5 | Tying S03 to the bundle (Toei) floors: one look-for added to field item 30. 42 links whose `dz` disagrees with `z` (§2.2) |
| `CROSS_LEVEL_DEVICE_UNKNOWN` (105) | **Mostly settled.** 242 of S03's 246 cross-level links have the same printed `facility` (stairs / escalator / elevator) at both ends (§3) | S03 level-geometry `facility`, a factual field | 4 links (§3.1). They need private locating before they can be a field item |
| `ONE_WAY` (9) | **Settled as fact, not as a gap.** The spec prints the meaning of `d` (1 forward, 2 reverse, 3 both). All 18 one-way source links are escalators | Spec §4.8; S03 `facility`/`from`/`to` | Product: route by direction instead of refusing (gteki-31) |
| `SELF_LOOP` (5) | Product cleanup, already gteki-31's | — | — |

Source counts here are for the whole S03 `v5_nav` (2,506 nodes, 2,653 links, 246 cross-level, 18 one-way, 6 self-loops). The graph counts in the first column are gteki-31's builder subset (2,254 edges). This pass did not map one onto the other link by link.

## Sources (all read 2026-10-26, default curl UA, ≥ 1 s apart)

- **S1** S03 specification 『新宿駅周辺の施設情報及び施設から目的地への移動ルート情報』仕様書.
  - URL: `https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_kiban_shinjuku_terminal_pdf_shisetsu_siyousho`
  - Read: 200, 499,924 bytes, 11:43:44 JST. sha256 `c9258624…` equals the acquisition record `docs/gis/acquisitions/tokyo-s03-spec.json`.
- **S2** S03 ZIP.
  - URL: `https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/zip_kiban_shinjuku_terminal_pdf_shisetsu_root`
  - Read: 200, 2,317,035 bytes, 11:43:45 JST. sha256 `fc346627…` equals `tokyo-s03-zip.json`.
  - Scope: CC BY 4.0 (catalog), cleared for geometry and factual fields.
- **S3** Tokyo CKAN `package_show?id=t000008d0000000037`.
  - Read: 200, 4,486 bytes, 11:43:43 JST.
  - Metadata fields: licence CC-BY-4.0, maintainer 都市基盤部交通企画課, `metadata_modified` 2025-12-12, extras 更新頻度 「随時（修正があれば）」.
  - **No CRS, 座標系 or 測地系 field.**
- **S4** G空間情報センター `package_show?id=mlit-indoor-shinjuku-r2` (国土交通省「新宿駅周辺屋内地図オープンデータ（令和2年度更新版）」).
  - Read: 200, 151,647 bytes, 11:43:46 JST. Metadata only (§4).

Working copies were in the session scratchpad and are deleted after this pass. Nothing was added to the repo.

## 1. CRS — the v5_nav frame is printed as Mercator

S1 §4.4 (Nav Drawing Object) prints the drawing transform as 「"t": [txx, tyx, txy, tyy, tx0, ty0], // メルカトル座標からマップ座標への変換」 and 「変換（6 * double）-メルカトルから自然（マップ）座標へのアフィン変換。」. S1 §4.6 (Nav Node) prints the node coordinates as 「"mx":ノード X 座標, //メルカトル座標内」 and 「メルカトル X 座標（ダブル）・メルカトル Y 座標（ダブル）」.

The frame record `docs/gis/crs/shinjuku-s03-v0.json` calls the projection behind mx/my "UNKNOWN except for the two affines". S1 names it, and it can be checked numerically:

- **Scale.** mx/my are spherical Mercator in units of 2²⁵ per world: lon = mx / 2²⁵ · 360 − 180, and lat = atan(sinh(π(1 − 2·my / 2²⁵))). The 2²⁵ scale is fitted, not printed; it is the web-map pixel scale at zoom 17 with 256-pixel tiles.
- **Check.** For each of the 2,506 nodes, that inverse was compared with the existing chain: the nav `t` affine, then the drawing `ref_frame.transform` in `com-map`.
- **Result.** Median 0.088 m, p95 0.108 m, max **0.123 m**. Two independent routes to longitude and latitude agree at the decimetre level.
- **What it does and does not show.** The affine chain the builder already uses is the Mercator inverse, up to a sub-decimetre residual. It does not certify the datum. S1 §3.2.4 prints WGS84 for the GeoJSON members; for v5_nav the Mercator is defined on the same longitude and latitude.

**Ask to the director:** accept "S03 v5_nav = spherical Mercator (S1 §4.4/§4.6) at 2²⁵ scale, reconciled with the affine chain at ≤ 0.123 m" as the WP7 CRS finding. If accepted, the frame record's `verification` moves from UNVERIFIED, and `CRS_UNCONFIRMED` can clear. Whether to clear it is the director's call; this doc changes no code.

## 2. Floor ordinals — what S03 prints

S1 §3.2.3 prints 「zlevel - レベルの zlevel、または順序付けパラメーター」, and §4.5 prints 「"z": zlevel 値」. In S2's v5_nav, the one drawing (35814, 新宿駅) carries 11 levels:

| level id | name | z |
|---|---|---|
| 64672 | B5F | −7 |
| 64673 | B4F | −6 |
| 64674 | B3F | −5 |
| 64688 | MB2F | −4 |
| 64675 | B2F | −3 |
| 64676 | B1F | −2 |
| 64689 | M1F | −1 |
| 64677 | 1F | 0 |
| 64678 | 2F | 1 |
| 64679 | 3F | 2 |
| 64680 | 4F | 3 |

### 2.1 What this settles and what it does not

**Settled within S03.**
- The order of S03's own levels, including the two mezzanines (MB2F between B3F and B2F, M1F between B1F and 1F), is printed.
- `z` is an ordering value, not a floor number: B1F is z = −2, because M1F takes −1.
- No node sits on more than one level.
- Routing **inside S03** can use S03's own level ids and `z`, with no inference.

**Not settled.**
- Nothing ties an S03 level to the bundle's floors. `stations/shinjuku/gteki/station.json` carries only Toei NWD floors (`toei-nwd-*`, with GSI labels such as 「GSI B1 (地下1階)」).
- That S03 "B1F" and Toei "地下1階" are the same physical level is a **name hint**, not a printed fact. Shinjuku's operators do not share one floor scheme.
- One S03 B1F geometry is named 「大江戸線改札B」. That is the only seam name found, so field item 30 gets one look-for (see the field-run doc).

### 2.2 A source inconsistency — 42 links whose `dz` is not the `z` difference

**Update 2026-10-26 18:30 JST:** [Private locating result and field decisions](s03-dz-locate-2026-10-26.md): 42 A links in 16 clusters; all 40 1F↔2F links carry `dz` ±3, a source-wide convention, so no field item (lead decision).

S1 §4.8 prints 「"dz":デルタ zlevel」. For 2,611 of 2,653 links, `dz` equals z(to) − z(from). The other 42 do not:

| Levels | Links | `dz` printed | z difference | Device |
|---|---|---|---|---|
| 2F → 1F | 31 | −3 | −1 | stairs 24, escalator 6, elevator 1 |
| 1F → 2F | 9 | +3 | +1 | elevator 5, escalator 3, stairs 1 |
| 2F → M1F | 2 | −4 | −2 | escalator |

All 42 touch 2F. One reading is that part of S03's "2F" stands about three storeys above 1F (a deck level). That is an **inference, not recorded as fact**.

These links still carry `FLOOR_ORDINAL_UNVERIFIED` after any mapping. They cannot become a field item until each is located; locating needs private positions, which this public doc does not carry. Link-id sha256 prefixes are kept in the lead's working notes on request.

## 3. Cross-level device type — printed in S03 itself

Each nav node carries a geometry id (`gid`, S1 §4.7) on its level. In S2's level-geometry members, the geometries at cross-level link ends carry a `facility` property and a `display_name`:

- 「階段」 / `stairs`
- 「エスカレーター」 / `escalator`, and also `EscalatorForward` / `EscalatorReverse` with `from` / `to` = `above` / `below`
- 「エレベーター」 / `elevator`, some with `openinghour`, e.g. 「6:00〜23:00」

Of the 246 cross-level source links:

| Both ends agree | Links |
|---|---|
| stairs | 124 |
| escalator | 79 |
| elevator | 39 |
| **Total** | **242** |

These are factual fields under the S2 clearance.

### 3.1 The 4 that do not resolve

**Update 2026-10-26 18:30 JST:** [Located device-UNKNOWN residue](s03-dz-locate-2026-10-26.md): all four prefixes reproduce in two clusters; the three one-end-device candidates become field items 50–51; the no-device link stays GAP.

| link-id sha256 (first 12) | levels | `dz` | device at the ends |
|---|---|---|---|
| `543e76f800f3` | B2F → M1F | +2 | — / stairs |
| `5881c3d7f3a8` | B1F → 1F | +2 | — / elevator |
| `cd92def53002` | 1F → B1F | −2 | — / — |
| `9ac2af998909` | 1F → M1F | −1 | — / stairs |

Three have a device printed at one end only. Taking the one-end value would be an inference, so they stay UNKNOWN. One has none. They are not field items yet, for the same locating reason as §2.2.

## 4. geospatial.jp — what the director's example turns up

The S03 dataset is **not** on G空間情報センター; its catalog is Tokyo's (S3), and S3 prints no CRS.

The geospatial.jp dataset for this area is a different one: 国土交通省「新宿駅周辺屋内地図オープンデータ（令和2年度更新版）」 (S4).
- Its metadata prints that the 製品仕様書 is based on 国土地理院「階層別屋内地理空間情報データ仕様書（案）」（平成30年3月）.
- Its licence is 政府標準利用規約.
- Every resource prints 「データのダウンロードは、ユーザ登録の後、 ログイン状態で行ってください。」, and the extras carry `ダウンロード: ログイン`.

By the login rule, **no file of S4 was requested**. So S4 cannot supply S03's CRS, a floor tie or control points from this desk. It is recorded as a **GAP**: a login-gated candidate for `CHECK_B` control points. Whether to register is the Owner's call, not the data lane's.

## 5. Follow-ups

1. **Director:** rule on §1. If accepted, `CRS_UNCONFIRMED` can clear (2,254 edges), and `CHECK_A` / `CHECK_B` become computable GIS tasks rather than blocked ones.
2. **gteki-31 (product):**
   - read `facility` at the link ends to clear `CROSS_LEVEL_DEVICE_UNKNOWN` (242 of 246 source links);
   - honour `d` as direction instead of refusing `ONE_WAY`;
   - drop `SELF_LOOP`.
   The data lane does not edit `tools/gis`.
3. **Floor tie:** field item 30 gets a look-for (the 「大江戸線改札B」 name) as the only seam evidence. The S03 ↔ bundle floor mapping stays UNVERIFIED until then.
4. **§2.2 and §3.1 (46 links):** locate privately, then decide whether any becomes a field item. They do not block routing inside S03 levels once the CRS is ruled, but each still carries its code.
5. **S4:** recorded GAP; Owner decision on registration.
