# Merchant source matrix, position precision and field-check list (issue #211)

- **Tracking:** issue #211 (parent #209). Two stations, Ikebukuro first, then Shinjuku. Docs only:
  this file changes no station data, adds no coordinate and no route.
- **Built:** 2026-10-25 (JST) from repo records on `main` (`b10e6557`), the open batch-4 PR
  [#432](https://github.com/nurockplayer/gteki/pull/432) and the open PR
  [#415](https://github.com/nurockplayer/gteki/pull/415). **No page was fetched for this file**;
  every date below is the date already recorded by the lane that read the page.
- **Inputs:** [`gaps/DR-merchant-sources.md`](../gaps/DR-merchant-sources.md) (the earlier #211
  sample), the shop and facility inventory in open PR
  [#415](https://github.com/nurockplayer/gteki/pull/415), the merchant batches under this
  directory (`ikebukuro-merchants{-batch2,-batch3,-batch5}.json`,
  `ikebukuro-merchants-batch4.json` in PR #432, `shinjuku-merchants-batch1/2.json`,
  `shinjuku-odakyu-dept*.json`, `shinjuku-recovery-batch1.json`), the facilities batches under
  [`../facilities/`](../facilities/), and the rulings in
  [`../owner-decisions-pending.md`](../owner-decisions-pending.md) (OD-23, OD-25, OD-31, OD-32,
  OD-34).
- **Not in scope:** store visual assets, shop interiors, logos, photos, menus, and the GTEki
  position of any shop. Hours are recorded only under OD-32 as amended on 2026-10-24: a dated
  first-party page, or an undated official page carrying its retrievedAt and URL plus the UI line
  「GT-Eki 確認日 YYYY-MM-DD 時点の公式表記。変更されている場合があります」, hidden or marked for
  re-check once retrievedAt is more than 180 days old; precedence is merchant submission > dated
  official page > undated official page. Everywhere else they stay null.

## 1. Rights classes used here

The class is the OD-34 status of the source, not a guess about the operator. **Usable** = OD-34
(or a still-standing earlier OD) allows facts-only use. **Corroboration only** = a business-use
ban or a permission-based refusal, so at most "consistent with … (URL, retrieval time)" for a name
sourced elsewhere. **Banned** = a flat ban; nothing is used, not even a cross-check (OD-34 §3/§4).
**UNKNOWN** = not read, not covered, or unreachable.

- **OD-34, 2026-10-24** (director gteki-1b, [#377 comment 6382700098](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6382700098)),
  with rounds 2–4 the same day and the **fifth round on 2026-10-25** (odakyu.jp / keio.co.jp,
  KSJ per dataset, Toshima policy), each with the terms entry it cites.
- **OD-32, 2026-10-24, as amended the same day** (same record): hours from a first-party page,
  either dated (with its date and the "may have changed" label) or undated (from a source OD-34
  allows, with its retrievedAt and URL, the UI line 「GT-Eki 確認日 YYYY-MM-DD 時点の公式表記。
  変更されている場合があります」 and the official link; hidden or marked for re-check once
  retrievedAt is older than 180 days). Building-level hours carry 「店舗により異なる場合あり」.
  Precedence: merchant submission > dated official page > undated official page. Hours stay null
  when the source is a third-party aggregator or older than 180 days; `current_status` stays
  UNKNOWN until a field check.
- Facts are not copyright works; **no licence exists to relicense** any of these sources, and no
  directory text, map, layout, logo, photo or interior image is copied. See §6.

## 2. Source list

### 2.1 Ikebukuro

| source id | Directory / page | URL | OD-34 status (ruling date) | Position precision | What it supports |
| --- | --- | --- | --- | --- | --- |
| `lumine-ikebukuro-floorguide-2026-10` (#432) | ルミネ池袋 floor guide | https://www.lumine.ne.jp/ikebukuro/floorguide/ | usable (OD-34 §2, 2026-10-24; LUMINE policy) | operator-printed floor where the page names one (B1–10F); 18 of the 176 rows name only ルミネ池袋 — area only | shop name, floor |
| `esola-ikebukuro-floorguide-2026-10-{b1,1f…8f}` (#432) | エソラ池袋 floor pages | https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=b1 … `fid=8f` | usable (OD-34 §2, 2026-10-24; Metro Properties terms) | operator-printed floor where the page names one (B1–8F); 7 of the 33 rows name only エソラ池袋 — area only | shop name, floor |
| `tobu-dept-ikebukuro-2026-10` (#432) | 東武百貨店 池袋 store and floor maps | https://www.tobu-dept.jp/ikebukuro/ | usable (OD-34 §2, 2026-10-24; 東武百貨店 policy) | operator-printed floor (B2F–15F) | store POI; the tenant dataset cites per-floor ids (`…-2026-10-6F` etc.) |
| `tokyometro-ikebukuro-shops-2026-10` | 施設・店舗 / Tokyo Metro | https://www.tokyometro.jp/station/ikebukuro/shop/index.html | usable (OD-34 §2, 2026-10-24; Metro terms §1(1) wording ruled usable) | exit/gate vicinity or none — area or search only | shop name |
| `echika-ikebukuro-2026-10` | Echika 池袋 / Metro Properties | https://www.metropro-sc.jp/echika-ikebukuro/ | usable (OD-34 §2, 2026-10-24; Metro Properties terms; OD-31, 2026-10-24) | facility only — area only | shop name inside Echika 池袋 |
| `isp-floorguide-2026-10` | 池袋ショッピングパーク floor guide | https://www.web-isp.co.jp/floorguide/ | usable (OD-23, 2026-10-22; OD-34 §2, 2026-10-24; ISP terms) | hall/zone (South Hall, Brick Street, …) — area only | shop name, zone |
| `tobu-hopecenter-floorguide-2026-10` | 東武ホープセンター floor guide | https://tobuhopecenter.jp/floorguide/ | usable (OD-34 §2, 2026-10-24; Hope Center terms) | zone (South/Center/North) — area only | shop name, zone |
| `seibu-shop-ikebukuro-2026-10` | エミオ池袋 floor guide | https://www.seibu-shop.jp/emio/floorguide/?emio=emio01 | usable (OD-34 round 2, 2026-10-24: request, not ban) | operator-printed floor/zone — area only | shop name, floor |
| `seibu-shop-ikebukuro-station-2026-10` | 西武 station-shop portal (station) | https://www.seibu-shop.jp/floorguide/station/?station=st01 | usable (OD-34 round 2, 2026-10-24) | operator-printed floor/zone — area only | shop name, floor |
| `seibu-ikebukuro-station-2026-10` | 西武鉄道 池袋駅 | https://www.seiburailway.jp/railway/station/ikebukuro/ | usable (OD-25, 2026-10-22) | station-level facility text — search only for merchants | 西武南口 hours, gates, lifts; no shop directory |
| `tokyometro-ikebukuro-accessibility-2026-10` | バリアフリー設備 / Tokyo Metro | https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html | usable (OD-34 §2, 2026-10-24) | equipment end pairs — not a merchant position | facility POIs only |
| `lumine-ikebukuro-facilities-2026-10`, `esola-ikebukuro-facilities-{3f,4f,6f,7f,8f}-2026-10`, `tobudept-ikebukuro-facilities*-2026-10` | facility pages (facilities batches) | see `../facilities/ikebukuro-facilities-batch2.json` | usable (OD-34 §2, 2026-10-24) | floor/zone label | facility POIs only |
| `city.toshima.lg.jp` (underground guide, sign guideline) | 豊島区 池袋駅地下空間案内図 and sign guideline | https://www.city.toshima.lg.jp/405/1705251510.html | usable, facts only (OD-34 fifth round (c), 2026-10-25; site-policy URL, retrievedAt and sha256 recorded in #414) | exits and gate names — no merchant floor | exit/gate names as aliases; never layout or route |
| `sogo-seibu.jp` | そごう・西武 floor guide | https://www.sogo-seibu.jp/ikebukuro/floor-guide ; terms https://www.sogo-seibu.jp/usage | **corroboration only** (OD-34 round 3, 2026-10-24: clause 2 item 8 bans profit-making activity) | none usable | cross-check only; no brand tenants |
| `tobu.co.jp` | 東武鉄道 station page | https://www.tobu.co.jp/railway/guide/station/info/7105/ | **corroboration only** (OD-34 round 2, 2026-10-24: §8 business-use ban) | none usable | cross-check only |
| `jreast.co.jp` | JR East station pages | https://www.jreast.co.jp/estation/ | **corroboration only** (OD-34 §1, 2026-10-24; OD-02 A) | none usable | cross-check only; 403 to plain reads (#415 GAP) |

### 2.2 Shinjuku

| source id | Directory / page | URL | OD-34 status (ruling date) | Position precision | What it supports |
| --- | --- | --- | --- | --- | --- |
| `lumine-est-shinjuku-floorguide-2026-10` | ルミネエスト新宿 floor guide | https://www.lumine.ne.jp/est/floorguide/ | usable (OD-34 §2, 2026-10-24) | operator-printed floor (B2F–8F) | shop name, floor |
| `lumine-shinjuku-floorguide-2026-10` | ルミネ新宿 (ルミネ1, ルミネ2) | https://www.lumine.ne.jp/shinjuku/floorguide/ | usable (OD-34 §2, 2026-10-24) | operator-printed floor | shop name, floor |
| `newoman-shinjuku-floorguide-2026-10` | ニュウマン新宿 floor guide | https://www.newoman.jp/shinjuku/floorguide/ | usable (OD-34 §2, 2026-10-24; NEWoMan policy) | floor for area01; operator zone label (エキナカ / エキソト / フードホール) for area02 — area only | shop name, floor or zone |
| `toei-shinjuku-stores-2026-10` | 都営 新宿駅 店舗一覧 | https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html | usable (OD-01 A; OD-34 round 2, 2026-10-24: facts only) | `設置場所` text (concourse/exit vicinity) — area only; some rows search only | shop name, area text |
| `toei-shinjuku-nishiguchi-stores-2026-10` | 都営 新宿西口 店舗一覧 (open CSV) | https://www.opendata.metro.tokyo.lg.jp/kotsu/other/other_stores_shinjuku-nishiguchi.csv | usable (Toei open data CC BY 4.0; rights record `docs/gis/rights/tokyo-s10-shinjuku-csv.json`) | `設置場所` text — area only | 新宿西口 rows only; not E27 |
| `tokyometro-shinjuku-shops-2026-10` | 施設・店舗 / Tokyo Metro | https://www.tokyometro.jp/station/shinjuku/shop/index.html | usable (OD-34 §2, 2026-10-24) | exit/gate vicinity or none — area or search only | shop name |
| `odakyu-dept-shinjuku-2026-10` | 小田急百貨店 新宿店 | https://www.odakyu-dept.co.jp/shinjuku/ | usable (OD-34 round 2, 2026-10-24: copyright line only, no use clause) | store page names the store only — search only (the POI records SEARCH_ONLY) | one store POI; brand tenants are a facts-only dataset, not POIs |
| `odakyudept-shinjuku-facilities-2026-10`, `odakyudept-shinjuku-floorguide-2026-10` | 小田急百貨店 facility pages | see `../facilities/shinjuku-facilities-batch2.json` | usable (OD-34 round 2, 2026-10-24) | floor/area label | facility POIs only |
| `chain-krispykreme-ace-north-sjk-2026-10` | クリスピー・クリーム・ドーナツ store page | https://krispykreme.jp/store/tokyo/odakyuace.html | usable (OD-34 round 4, 2026-10-24: LUMINE-type clause) | store page names the facility (小田急エース北館) — area only (the POI records AREA_ONLY) | one chain row; the Odakyu Ace directory itself stays banned |
| `tokyometro-shinjuku-accessibility-*`, `lumineest-shinjuku-facilities-2026-10`, `lumine-shinjuku-facilities-2026-10`, `newoman-shinjuku-facilities-2026-10` | facility pages | see the facilities batches | usable (OD-34 §2, 2026-10-24) | floor/area label | facility POIs only |
| `odakyu.jp` | 小田急電鉄 駅設備 | https://www.odakyu.jp/station/shinjuku/ | **corroboration only** (OD-34 fifth round, 2026-10-25; terms clause read in #415 at 2026-10-24T16:41:16Z) | none usable | cross-check only |
| `keio.co.jp` | 京王電鉄 新宿駅 | https://www.keio.co.jp/train/station/ko01_shinjuku/ | **corroboration only** (OD-34 fifth round, 2026-10-25; terms clause read in #415 at 2026-10-24T16:41:17Z) | none usable | cross-check only |
| `odakyu-sc.com` (小田急エース), `keiosc.co.jp` (京王モール) | Mall portals | https://www.odakyu-sc.com/sitepolicy/ ; https://www.keiosc.co.jp/sitepolicy/ | **banned** — flat ban (OD-34 §3, 2026-10-24; overturns OD-33 for these two) | none usable | nothing imported, not even a cross-check |
| `ecute.jp` / JR東日本クロスステーション | ecute shop directories | https://www.ecute.jp/terms/ | **banned** — flat ban (OD-34 §3, 2026-10-24) | none usable | nothing imported |
| `doutor.co.jp`, `meganeichiba.jp` | chain store pages | — | **banned** — flat ban (OD-34 round 4, 2026-10-24) | none usable | self-service form candidates (#438) |
| 新宿サブナード official site | — | https://www.subnade.co.jp/ | UNKNOWN (connection refused, #415 GAP) | none established | nothing imported |
| 京王百貨店 新宿 (`keionet.com`) | — | https://www.keionet.com/shinjuku/ | UNKNOWN (maintenance page, #415 GAP) | none established | nothing imported |
| chain pages in `shinjuku-recovery-batch1.json` other than krispykreme | ゼッテリア, 箱根そば, 吉野家, DAISO, カラダファクトリー, アトリエはるか, BAKE, ルノアール, MIGNON, ファミリーマート, TSUTSUMI, 日比谷花壇 | see the file's `sources` | UNKNOWN (no per-page ruling; not on the OD-34 usable list) | address/unit text only — area or search only | rows stay UNKNOWN-status facts from chain pages |

### 2.3 Open data and official statistics

| source id | Dataset | URL | Status | Position precision | What it supports |
| --- | --- | --- | --- | --- | --- |
| `tokyo-s10-shinjuku-csv` | 東京都 S10 店舗等一覧 (新宿) | https://www.opendata.metro.tokyo.lg.jp/kotsu/other/other_stores_shinjuku.csv | **usable under CC BY 4.0** with attribution and change notice; rights record verdict `CLEARED_WITH_CONDITIONS`, `publish_gate: HOLD`, `routable: false` (`docs/gis/rights/tokyo-s10-shinjuku-csv.json`) | `設置場所` text only — area/search only | factual CSV fields only; no coordinates, no floor field; floor assignment and navigation not established |
| KSJ N02-2023 | 国土数値情報 鉄道データ (2023年度版, data as of 2023-12-31) | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html | usable as **primary evidence**, judged per dataset (OD-34 fifth round (b), 2026-10-25): dataset N02-2023 prints CC BY 4.0 and 商用可; both agreement pages read in #415 at 2026-10-24T16:41:31–32Z; credit 「出典：国土数値情報（鉄道データ）（国土交通省）…（2026年10月24日取得）」 | station identity only | line and station identity, not shops |

## 3. Candidate position-precision list

Three classes, from issue #211: `ENTRANCE_VERIFIED` (entrance evidence that can be aligned to
GTEki coordinates **and** a legal walkable path), `AREA_ONLY` (operator-printed floor or named
area/zone, no entrance), `SEARCH_ONLY` (name and existence only).

**No merchant POI in this repository is `ENTRANCE_VERIFIED`.** Every merchant POI checked has
`floorId: null`, `displayPosition: null`, `connectorNodeIds: []` and `paid: null`, and no source
states a shop entrance.

| Class | Rows today (counted from the JSON files) |
| --- | --- |
| `ENTRANCE_VERIFIED` | 0 |
| `AREA_ONLY` | 727: Ikebukuro 133 (batch 2 118 + batch 5 11 + sample 4), Shinjuku 594 (batch 1 3 + batch 2 576 + recovery 15). Batch 4's 210 are all AREA_ONLY but are in open PR #432, not on `main`, so they are not counted here. |
| `SEARCH_ONLY` | 9: Ikebukuro 5 (batch 3 2 + batch 5 2 + sample 1), Shinjuku 4 (batch 1 3 + 小田急百貨店 store POI 1). |

The counts follow each record's own `evidence.method`: in the Shinjuku recovery batch the
Krispy Kreme row is AREA_ONLY (the chain page names 小田急エース北館), and the 小田急百貨店 store row
is SEARCH_ONLY (the page names the store, not an area).

**Importable small sample** (one source per row, no coordinate). Every row has `checkedDate`
2026-10-24, category `shop`, `current_status` UNKNOWN and hours null. The area text is what the
row's own note records.

| id | Station | Name (ja) | Area/floor as recorded | Source id | OD-34 status | Class |
| --- | --- | --- | --- | --- | --- | --- |
| `shop-ikb-mr-002` | Ikebukuro | Patio de METRO | Echika 池袋内 | `tokyometro-ikebukuro-shops-2026-10` | usable | AREA_ONLY |
| `shop-ikb-mr-003` | Ikebukuro | Tabio | Echika 池袋 | `tokyometro-ikebukuro-shops-2026-10` | usable | AREA_ONLY |
| `shop-ikb-mr-004` | Ikebukuro | マツモトキヨシ | 池袋ショッピングパーク 南館 | `isp-floorguide-2026-10` | usable (OD-23) | AREA_ONLY |
| `shop-ikb-mr-005` | Ikebukuro | スターバックス コーヒー 南館店 | 池袋ショッピングパーク 南館 | `isp-floorguide-2026-10` | usable (OD-23) | AREA_ONLY |
| `shop-ikb-mr-001` | Ikebukuro | Soup Stock Tokyo | not stated | `tokyometro-ikebukuro-shops-2026-10` | usable | SEARCH_ONLY |
| `shop-sjk-toei-001` | Shinjuku | カレーショップC＆C | 都営 新宿駅 B1階改札外コンコース（2出口付近） | `toei-shinjuku-stores-2026-10` | usable (OD-01 A) | AREA_ONLY |
| `shop-sjk-toeinishi-001` | Shinjuku (新宿西口) | ファミリーマート（ミニ・コンビニ） | 都営 新宿西口 B3階改札外コンコース（JR新宿駅方面改札付近） | `toei-shinjuku-nishiguchi-stores-2026-10` | usable (CC BY 4.0) | AREA_ONLY |
| `shop-sjk-metro-002` | Shinjuku | OOTORI BANANA | 東京メトロ 新宿駅 A8出入口付近 | `tokyometro-shinjuku-shops-2026-10` | usable | AREA_ONLY |
| `shop-sjk-metro-001` | Shinjuku | LAWSON METRO'S | 東京メトロ 新宿駅 新宿東口店 | `tokyometro-shinjuku-shops-2026-10` | usable | SEARCH_ONLY |

Excluded from the sample: `ikb-mr-006` (RF1, B2, そごう・西武 floor guide) is corroboration only;
the Subnade rows in `DR-merchant-sources.md` come from chain pages with UNKNOWN status; every
Odakyu Ace and Keio Mall directory row is a flat ban and must not be imported.

## 4. Station scope boundaries

- **Ikebukuro.** JR East, Tokyo Metro, Tobu Railway, Seibu Railway and the commercial facilities
  (ISP, 東武ホープセンター, Echika, Esola, 東武百貨店, ルミネ池袋) are separate scopes. A shop in
  one is not a fact about another. JR East merchant rows do not exist here (OD-02 A); Tobu Railway
  gate names are excluded (OD-01 B); そごう・西武 rows are corroboration only.
- **Shinjuku: S10 is not E27.** S10 is the Tokyo Metropolitan Government open dataset of station
  shops (CC BY 4.0, factual CSV fields only, no coordinates, no floor field, `設置場所` text).
  E27 is the MLIT Hokonavi walking-network package for the Toei Oedo Line Shinjuku station,
  dataset `2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45` (`NOTICE` §4.3, lines 89–114: a marker, not a
  licence; the resource-level licences are null). Neither gives a merchant position: S10 is a
  text location, and E27 is a walking network. The S10 Shinjuku and 新宿西口 resources are
  separate datasets; the 新宿西口 CSV is not E27 merchant geometry.
- **Subnade and the mall directories** (新宿サブナード, 小田急エース, 京王モール) are their own
  commercial scopes; this repository records no source for which operators connect to them.
  Subnade's official site is unreadable; Odakyu Ace and Keio Mall are flat bans.

## 5. Field-check list

Every item records the checked date and the exact sign text in private notes; no logo, map or
interior photo is reproduced in the repository.

### 5.1 Does the store exist, under this name, today

1. Ikebukuro: Metro-listed shops, Echika, Esola, ISP halls, 東武ホープセンター zones, 東武百貨店
   floors, ルミネ池袋 floors, Seibu portal (エミオ池袋 / station shops). Note temporary closures
   and replacements; source-listed hours are stale until checked (OD-32).
2. Shinjuku: Toei 新宿 and 新宿西口 rows, Metro shop list, ルミネ / ルミネエスト / ニュウマン
   floors, 小田急百貨店 floors, and the Odakyu Ace / Keio Mall chain rows (those come from chain
   pages, not the banned directories). Confirm before any use; they are UNKNOWN-status, not closed.
3. The 1a and C4 exits at Ikebukuro were named as closed in the 2022-01 ward notice; whether the
   2026-03 Metro list means they reopened is UNKNOWN (PR #414). Check the exits in the same pass.

### 5.2 Is the entrance navigable (the only route to ENTRANCE_VERIFIED)

4. Record the storefront frontage against a named pillar, sign or a GIS base, the floor, and
   whether access is before or after a fare gate. Both coordinates and a legal walkable path are
   needed; neither is present today.
5. For Toei rows, state which operator/line area the shop belongs to (新宿, 新宿西口) and verify
   the page's lettered placement against physical signs, without tracing a station map.
6. For Echika, Esola, ISP, 東武ホープセンター, Subnade and the department stores, establish which
   facility boundary contains the storefront and whether crossing a fare gate is required. Do not
   infer an entrance from a facility's connection or from an exit number.
7. Until a row passes 4–6 it stays AREA_ONLY or SEARCH_ONLY with `floorId`, `displayPosition`,
   `connectorNodeIds` and any routing edge unset; GTEki geometry alignment is the GIS lane's work.

## 6. Rights split: text facts vs assets

- **Text facts** (store name, category, floor or zone label, the entrance wording a source prints)
  are used only from sources whose OD-34 status is usable, under the facts-only class. Every row
  keeps its source id and read date; nothing is relicensed.
- **Logos, photos, maps, floor-plan images and interior shots** are **not** usable from any source
  here, including the usable ones. They are referenced at most by link, never committed. No
  directory text, layout or drawing is reproduced.
- **CC BY 4.0 sources** (S10, KSJ) keep the printed credit line and a change notice; the credit is
  recorded on the source entry, not on shop records.
- **Banned sources** (ecute / JR Cross, 小田急エース, 京王モール, doutor.co.jp, meganeichiba.jp)
  contribute nothing at all: OD-34 §3 and §4 say an excluded directory may not be used even as a
  cross-check, so no stored record and no "consistent with" line may cite them.
- **Corroboration-only sources** (JR East, tobu.co.jp, sogo-seibu.jp, odakyu.jp, keio.co.jp) may
  appear only as "consistent with … (URL, retrieval time)" for a name already sourced elsewhere;
  they never supply a fact, a floor or a position.

## 7. GAPs

1. **新宿サブナード**: official site refuses connections; merchant rows there stay UNKNOWN.
2. **京王百貨店 新宿**: maintenance page; no rows.
3. **JR East pages**: 403 at the domain edge; no JR East merchant rows (OD-02 A anyway).
4. **小田急エース / 京王モール**: flat bans; no directory rows may be imported and no cross-check
   may cite them (OD-34 §3/§4).
5. **Chain store pages**: only krispykreme.jp has a ruling (facts only). The other recovery-batch
   chains, and the earlier Starbucks / ORIHICA / DAISO sample rows, stay UNKNOWN until a terms
   read or the self-service route (#438).
6. **Entrances**: no source in this repository states a shop entrance; ENTRANCE_VERIFIED stays 0
   until the field checks in §5.2 are done.
7. **Hours dates**: most directory pages are undated. OD-32 as amended allows their hours with
   retrievedAt, URL, the UI line 「GT-Eki 確認日 YYYY-MM-DD 時点の公式表記。変更されている場合が
   あります」 and an official link, hidden or re-checked after 180 days — but no batch has
   harvested them yet, so hours stay null until that pass runs.
8. **`odakyu.jp` and `keio.co.jp`** — **resolved 2026-10-25**: now OD-34 fifth round (a), citing
   the flat-refusal clauses read in #415 at 2026-10-24T16:41:16–17Z. Both stay corroboration only
   and their rights stay UNKNOWN; nothing is imported from either. Keio department store, Subnade
   and メトロプロムナード remain UNKNOWN because #415 recorded no clause for them (fifth round (d)).
9. **Batch 4 source ids** (`lumine-ikebukuro-floorguide-2026-10`, `esola-…-{b1…8f}`,
   `tobu-dept-ikebukuro-2026-10`) are taken from open PR #432, not from `main`; if that PR changes
   them, this table must follow.
10. **Batch 3's source record is empty**: its two POIs cite `tokyometro-ikebukuro-shops-2026-10`,
    which is defined in `ikebukuro-merchants.sample.json`, not in batch 3's own `sources[]`. The id
    is documented here, but batch 3 should carry the record before any import.
