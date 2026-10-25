# Airport selection: 羽田空港 vs 成田空港 vs 東京駅

Status: research report, for the Owner to decide from. Nothing here is a decision.
Date: 2026-10-25. Every page below was read on 2026-10-25 (JST), 14:49–15:03 JST, unless its row says otherwise. Author: data research (DeepSeek worker, for data-research-05).
Rights frame: OD-34 in [`../owner-decisions-pending.md`](../owner-decisions-pending.md). The four classes below are OD-34's: **facts only** (no ban, or only a copy/reprint request or a copyright line), **corroboration only** (business-use ban), **banned** (flat refusal of reuse), **UNKNOWN** (no quoted clause found — not a finding of risk). A class is only assigned when this report can show a quoted clause, its URL and the date it was read; anything else is UNKNOWN. **GAP** is not a class: it is the verification status of a page that could not be read (403, connection failure, JS-only, or no terms page), and such a source stays UNKNOWN.
Third candidate: 東京駅's figures in this report are taken from [`third-station-selection-2026-10.md`](third-station-selection-2026-10.md) (read 2026-10-25, same day) and were not re-read here; this report adds the two airports, plus one correction to the 東京駅 candidate — a 東京駅周辺屋内地図 exists on geospatial.jp, which the earlier report missed because it searched ほこナビ only (§3.2).

## Method and limits

- Pages were read with plain `curl` (default User-Agent), requests ≥0.6 s apart; 80 requests in total, logged at the end. Dataset facts come from the public CKAN APIs of geospatial.jp (PLATEAU) and ckan.hokonavi.go.jp (ほこナビDP), plus the 国土数値情報ダウンロードサイト.
- Three web-search queries (DuckDuckGo HTML, Bing, Yahoo Japan) were tried once each to locate a KSJ template page; all three returned a bot-consent or JavaScript shell with no results. They are logged as GAPs and nothing was taken from them. The KSJ template was found instead from the site's own data list page (`/ksj/gml/gml_datalist.html`).
- A 403, a connection failure, a JS-only page or a site with no terms page is recorded as a **GAP in verification**; the rights class stays **UNKNOWN**. Nothing was bypassed; no one was contacted; no sign-ins, forms or uploads; no browser was used.
- Every claim below carries a URL and the date seen. Anything without a quoted clause or figure is marked UNKNOWN.
- Shop counts are UNKNOWN for both airports: the shop and floor-guide pages are rendered client-side and print no rows or count in the served HTML (§3.4). Floor labels could not be read either.

## 1. Answer in one table

| | 羽田空港 | 成田空港 | 東京駅 (from the 2026-10-25 report) |
|---|---|---|---|
| PLATEAU city model | **大田区 2025** (`plateau-13111-ota-ku-2025`): 建築物 LOD0/1/2.0/2.2, 交通 LOD1–3, **no 地下街 (ubld) model**; whether the terminal buildings are inside the bldg model is UNKNOWN | **none**: no PLATEAU dataset for 成田市 (12211) or 芝山町 (12409) | 千代田区 2025 + 中央区 2025, bldg LOD1–2, **地下街 LOD4** in both |
| KSJ airport layer | **C28 空港 2021年度** (national): airport area, reference point, **terminal-building point**, name, operator | same C28 dataset | no airport in C28; not applicable |
| KSJ railway layer | N02-2025 (national, 基準日 2025-12-31, **CC BY 4.0**), stations incl. monorail 鉄道区分 | same | same |
| ほこナビ walking network | **none** in the portal (43 packages) | **none** | `nwd_tokyo`, last updated 2019-01-23 |
| Indoor map / indoor walking network (geospatial.jp) | **none** (searched; no 羽田 package) | **`mlit-indoor-narita-airport-r2`**, 成田国際空港屋内地図オープンデータ（令和2年度更新版）, published 2021-03-10: indoor base map + **歩行空間ネットワークデータ** + toilet/lift POIs; licence 政府標準利用規約 (OGL); download needs a user login | **`mlit-indoor-tokyo` / `-r2`**, 東京駅周辺屋内地図オープンデータ (found today; the 東京駅 report searched ほこナビ only and missed it) |
| Facts-only operators | **日本空港ビルデング (JAT) + 東京国際空港ターミナル (TIAT)** — one joint site policy covering T1/T2/T3; JAT corporate site; **京急** | — | 大丸東京店, 東京メトロ, メトロプロパティーズ |
| Corroboration only | — | **NAA**, JR東日本 (OD-34 (1)) | — |
| Banned | **東京モノレール** (flat reuse refusal) | — | グランスタ |
| UNKNOWN (GAP = page not readable) | none among the four operators | **京成** (no terms page found) | 6 — JR東日本 (403), JR東海, 八重洲地下街, 東京駅一番街, KITTE/JPタワー, 三菱地所 丸の内 |
| Public shop data | JS-only; count UNKNOWN; no floor labels in served HTML | JS-only; count UNKNOWN | floor labels printed at 大丸東京店; count UNKNOWN |

## 2. Airport by airport

### 2.1 羽田空港

**3D/GIS coverage.** PLATEAU 大田区, 2025年度版, dataset `plateau-13111-ota-ku-2025` on geospatial.jp. Its note lists:

- 建築物モデル **LOD0, 1, 2.0 and 2.2** (CityGML and 3D Tiles),
- 交通（道路）モデル LOD1, 2, 3.0, 都市計画決定情報 LOD1, 土地利用 LOD1, 橋梁 LOD2.1, 水部 LOD0/1, 区域 LOD1, 地形 LOD1, and the flood/storm-surge/landslide risk models kept in a separate resource,
- **no 地下街モデル (ubld)** — the 整備データ list has no underground-mall entry,
- a 関連データセット resource (70 kB) with station, railway, landmark, park, shelter, emergency_route and border GeoJSON.

CityGML zip 544 MB, 3D Tiles+MVT zip 616 MB (sizes printed in the データ目録（v5）).

Source: `https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13111-ota-ku-2025`, read 2026-10-25.

Dataset terms: 「商用利用も含め、どなたでも無償で自由にご利用いただけます。」 — the same basis as our PLATEAU precedent (commercial use allowed with the PLATEAU credit).

**Whether the airport is in the model is a separate question.** PLATEAU buildings come from aerial survey; the catalogue says nothing about the airport restricted area, and the 大田区 package does not name the terminals. Whether the T1/T2/T3 buildings are present, and at what LOD, is **UNKNOWN until the tiles are loaded**. There is no interior: PLATEAU models exteriors, and C28's terminal-building feature is a point, not a footprint (and the C28 page does not state how many terminal points each airport has).

**KSJ.** Two layers, both national, so both airports are in each:

- **C28 空港 2021年度** (基準日 2021年12月31日): 「全国の公共用空港・飛行場について、範囲（面）、標点位置（点）、ターミナルビル位置（点）、種別（空港整備法に基づく第一種～第三種空港、共用飛行場等）、名称、設置者・管理者、特定飛行場指定状況等を整備したものです。」 The terminal building is a **point**, not a footprint and not a floor plan.
- **N02 鉄道 2025年度** (基準日 2025年12月31日): 「全国の旅客鉄道・軌道の路線や駅について、形状（線）、鉄道区分（普通鉄道、鋼索鉄道、懸垂式モノレール、跨座式モノレール等）、事業者（新幹線、JR在来線、公営鉄道、民営鉄道、第三セクター）、路線名、運営会社等を整備したものです。駅は、鉄道路線の一部分として整備しています。」 — the 鉄道区分 includes monorail, so the Tokyo Monorail stations are in the dataset even though the operator's own site is banned.

**歩行空間ネットワーク.** There is **no 羽田 or 大田区 package** in ほこナビDP: the full `package_list` (43 packages, read 2026-10-25) contains nothing for 羽田空港, 大田区 or 空港. No E27-type station map either (the portal's station maps are 都営大江戸線 stations only). **geospatial.jp returns no 羽田 package**: a search for 羽田 returned 0 packages, and a search for 屋内 returned 13 — 成田空港, 東京駅, 新宿駅, 新横浜駅, two Nagoya underground malls and unrelated items, but nothing for 羽田 (both read 2026-10-25). So 羽田 has **no public indoor map, no indoor walking network and no outdoor walking network that this research can find**. (CKAN keyword search is not exhaustive — the 大田区 PLATEAU package itself was not returned by a city-code search — so this is "none found", not a proof of absence.)

**Operators.** The terminal operator's airport site is one joint site: tokyo-haneda.com is run for 日本空港ビルデング株式会社 (JAT, T1/T2) and 東京国際空港ターミナル株式会社 (TIAT, T3), and the policy page names both as rights holders. The two companies also have corporate sites: JAT's is `https://www.tokyo-airport-bldg.co.jp/`, whose サイトポリシー is facts only (quoted in the table); TIAT's is `tiat.co.jp` (the host answers, but `/policy.html` returns 404 and no terms page was read — its corporate site stays UNKNOWN; it does not affect the airport content, which the joint policy settles). Note: `jat.jp` (where `www.jat.jp` redirects) is **not** JAT — it is the 柔整鍼灸療術協会; an earlier draft of this report mistook it for the operator's site.

| Operator | Role | Terms URL | Quoted clause | Class | Date seen |
|---|---|---|---|---|---|
| 日本空港ビルデング (JAT) + 東京国際空港ターミナル (TIAT) | T1/T2 and T3 terminals, shops, floor guides, access information (joint site) | https://www.tokyo-haneda.com/site_policy/index.html | 「本ウェブサイトの情報の著作権は日本空港ビルデング株式会社および東京国際空港ターミナル株式会社またはその両者に利用を認めた権利者が著作権等の知的財産権、使用権その他の権利を有しています。私的使用または引用等著作権法上認められた行為を除き、本ウェブサイトの情報を事前に当社の承認を得ずに、複製、配信等を行うことはできません。」 (legal-exception clause; no business-use ban on the page) | facts only | 2026-10-25 |
| 日本空港ビルデング (JAT) corporate site | company information | https://www.tokyo-airport-bldg.co.jp/site_policy/index.html | 「本ウェブサイトの情報の著作権は日本空港ビルデング株式会社に帰属します。私的使用または引用等著作権法上認められた行為を除き、本ウェブサイトの情報を事前に当社の承認を得ずに、複製、配信等を行うことはできません。」 | facts only | 2026-10-25 |
| 京急 (京浜急行電鉄) | 京急空港線, 羽田空港第1・第2ターミナル駅 (KK17) and 羽田空港第3ターミナル駅 (KK16) | https://www.keikyu.co.jp/website-guide.html | 「当サイトのダウンロード、プリントアウトその他の方法による複製は、個人的または家庭内での限られた範囲における私的使用に限らせていただきます。当社の事前の許諾なくして、当サイト内の情報およびプログラムを、他のホームページや印刷物に転用（コピー、アップロード、掲載、引用など）することはお控えください。その他著作権法で認められている範囲を超えて、当サイトに掲載されているコンテンツを無断で使用することはお控えください。」 (お控えください = a request, not a refusal; same type as the Seibu ruling in OD-34 round 2) | facts only | 2026-10-25 |
| 東京モノレール | 東京モノレール羽田空港線, 羽田空港第1ターミナル駅 / 第2ターミナル駅 / 第3ターミナル駅 | https://www.tokyo-monorail.co.jp/policy/ | 「当サイト上に記載されている全ての写真、社名ロゴ、画像、文章等のデータ等の利用については、複製・転用・転載・電磁的加工・送信・頒布・二次的使用・その他これらに類する全ての行為も含め、一切お断りいたします。」 (no legal exception; same wording as Odakyu Ace / Keio Mall / グランスタ) | **banned** | 2026-10-25 |

Note on 京急: the earlier 東京駅/品川駅 report recorded keikyu.co.jp as a GAP (no terms page found). The terms page exists at `/website-guide.html`, linked from the homepage footer as ウェブサイトご利用案内; this report closes that GAP. The classification is facts only, so 京急's station pages (names, adjacency) are usable.

**Stations.** 京急 prints two stations at the airport: 羽田空港第3ターミナル駅 (KK16) and 羽田空港第1・第2ターミナル駅 (KK17), with KK17 next to KK16 and KK16 next to 天空橋 (KK15) — read on the station pages' adjacency lists, 2026-10-25. Tokyo Monorail runs **three separate stations** (羽田空港第1ターミナル駅, 第2ターミナル駅, 第3ターミナル駅) — its station page for 第1ターミナル prints 住所 東京都大田区羽田空港3-3-2 and 開業 平成5年9月, but that site is banned, so these are noted as facts seen at a banned source, not usable as data. The Monorail and 京急 station counts therefore differ for the same terminal complex (two 京急 stations vs three Monorail stations), and any station import must keep the operator separate from the terminal; the names may come from KSJ N02, which carries both operators.

**Shop and facility data.** The terminal operator publishes shop, restaurant and floor-guide pages, but the served HTML has no shop rows, no floor labels and no count: `/floor/floor-guide.html?area=7&tab=terminal1` (T1; `area=8` T2, `area=9` T3), `/shop_and_dine/search_s.html` and `/access/train/index.html` all render their body client-side (read 2026-10-25; no `B1F`/`2F` label and no shop list in the source). Floor maps are images or a separate app (HANEDA MAP), **not text or data**. A count and any floor labels need a browser read, which this task's brief does not allow: UNKNOWN.

### 2.2 成田空港

**3D/GIS coverage.** **No PLATEAU dataset exists for 成田市 or 芝山町.** Checked four ways on 2026-10-25: `package_show` for `plateau-12211-narita-shi-2025` and `plateau-12409-shibayama-machi-2025` (both 404), and `package_search` for 成田, 芝山, `12211` and `12409` — none of the returned packages is a PLATEAU city model (they are 法務省地図, 農業ポリゴン and similar). So Narita has **no 3D city model, no building LOD list and no 地下街 model** in PLATEAU.

**KSJ.** Same national C28 空港 and N02 鉄道 layers as 羽田 (§3.1): the airport area, terminal-building point features and the station data come from KSJ, not from PLATEAU.

**Indoor map and indoor walking network.** Unlike 羽田, 成田 **has** a published indoor dataset, on geospatial.jp rather than in ほこナビ:

- `mlit-indoor-narita-airport-r2`, 「成田国際空港屋内地図オープンデータ（令和２年度更新版）」, published **令和3年3月10日 (2021-03-10)**, made by 国土交通省 for the 高精度測位社会プロジェクト: 「実証実験に用いた屋内地図のうち、通路や部屋の範囲などの基盤となる地図、歩行空間ネットワークデータ、トイレ・エレベータ等公共設備POIのデータを公開しています。」
- Resources: 利用規約 PDF, 製品仕様書, 地物/設備 legends, a whole-airport PDF map, a **GeoPDF zip** and a **Shapefile zip**.
- Licence field: 「政府標準利用規約」 (**OGL**).
- Access: 「データのダウンロードは、ユーザ登録の後、ログイン状態で行ってください。」 — the files need a **registered account and a login**; nothing was downloaded in this task.
- An earlier edition also exists (`mlit-indoor-narita-airport`, 令和元年度版).

Source: `https://www.geospatial.jp/ckan/api/3/action/package_show?id=mlit-indoor-narita-airport-r2`, read 2026-10-25. **Which terminals and areas the map covers, and whether the network reaches the station concourses or only the airside, is UNKNOWN** until the package is downloaded and opened; the catalogue describes the contents by type, not by area.

**ほこナビ.** No 成田, 芝山 or 空港 package in ほこナビDP (43 packages, 2026-10-25); no E27-type map there either. The indoor dataset above is the walking-network base Narita would use, not ほこナビ.

**Operators.**

| Operator | Role | Terms URL | Quoted clause | Class | Date seen |
|---|---|---|---|---|---|
| NAA (成田国際空港株式会社) | all three terminals, shops, maps, access information | https://www.narita-airport.jp/ja/copyright/ | 著作権: 「当サイト上の文字、写真、イラストなどのあらゆるコンテンツの著作権は、原則として当社に帰属します。これらのコンテンツの全部または一部について、「私的使用」または「引用」など著作権法上認められている場合以外の転載、複製、改変、翻訳、公衆送信等をすることはできません。」; 禁止事項 14: 「当サイトを利用した営利活動又は営利を目的とする行為」 | **corroboration only** (the 著作権 clause keeps the 私的使用 exception, but the 禁止事項 list bans business use — the same structure as 西武池袋本店 clause 2 item 8 in OD-34's third round) | 2026-10-25 |
| NAA corporate site | company information | https://www.naa.jp/ | no clause: the site returned **403** to plain curl (GAP in verification) | UNKNOWN (does not change the site classification above) | 2026-10-25 |
| JR東日本 | 成田空港駅, 空港第2ビル駅 (成田線/成田エクスプレス) | https://www.jreast.co.jp/ | OD-34 (1) ruling (corroboration only); the site returns 403 and was not re-read | corroboration only | 2026-10-24 (OD-34) |
| 京成電鉄 | 成田空港駅 and 空港第2ビル駅 (京成本線/成田スカイアクセス) | https://www.keisei.co.jp/ | no terms page found: the footer links only クッキーポリシー and 個人情報保護方針 (the rest of the footer is loaded from `/include/html/footer_sitemap.php`, read 2026-10-25, which lists no サイトポリシー); `/keisei/sitepolicy/`, `/sitepolicy/`, `/keisei/site_policy.php` and `/keisei/policy/index.php` all return 404 (GAP in verification) | UNKNOWN | 2026-10-25 |

JR East's class comes from the OD-34 (1) **Owner amendment** (corroboration only), not from a clause read in this task: the site returns 403 to plain curl. A flat-refusal clause on that site, if someone reads it later, would be a new rights question for the lead; it does not change the frame this report is built on.

**Stations.** 成田空港駅 is a 京成 station page (title 成田空港駅) that prints 開業日 1991年3月19日, 所在地 千葉県成田市三里塚御料牧場1-1 and 「当駅は、成田空港第１ターミナルの地下１階にございます。」 — a printed station-to-terminal connection. But 京成's rights are UNKNOWN (no terms page), so under the OD-34 frame nothing from that page is imported; the station itself is in KSJ N02. For 空港第2ビル, no 京成 station page was found (`narita-airport-terminal-2.php` and `narita-airport-2.php` both 404, and the 電車と駅の情報 index lists only 成田空港 among the airport stations): GAP. JR East's own station pages are corroboration only and were not read (403 on the site, as recorded in OD-34 (1)).

**Shop and facility data.** `/ja/shop/` prints only promo headlines in the served HTML; the directory itself is at `/ja/shop/shop-search/?category=shop` and `?category=restaurant`, and both return a page whose result list is empty in the source (the Next.js payload carries no shop rows) — read 2026-10-25. `/ja/map/` is client-side. So: no count, no floor labels, **not plain HTML**. Even if either were readable, NAA is corroboration only, so its directory could not be imported.

## 3. Cross-cutting

### 3.1 KSJ: the airport layer and the station layer

**C28 空港** is the KSJ airport dataset. Current edition **2021年度（令和3年度）版**, データ基準年月日 **2021年12月31日時点**; coverage quoted in §2.1. Its own 使用許諾条件 line is 「商用可」 — commercial use is stated, but it is **not** the CC BY 4.0 label the 2020-onward railway data carries, so under OD-34 (b) it must be recorded as 商用可 (with the KSJ credit) rather than as CC BY 4.0. The site-wide 利用規約 (`https://nlftp.mlit.go.jp/ksj/other/agreement.html`, read 2026-10-25) says 「…権利表記の記載がない限り（「公共データ利用規約（第1.0版）」（PDL1.0）が適用されています。」 and 「本利用規約は、2026年（令和8年）3月23日から施行します。」; its credit example is 「出典：国土交通省国土数値情報ダウンロードサイト（当該ページのURL）」. KSJ also lists **N08 空港時系列** and **S10b 空港間流通量** in its data list; neither is needed for a station slice and neither was opened.

**N02 鉄道** 2025年度版, 基準日 2025年12月31日, updated 2026年4月, national (§2.1 quote). Its 使用許諾条件 line: 「2020年（令和2年）以降：オープンデータ（CC_BY_4.0）」／「上記以外：商用可」 — for this edition, **CC BY 4.0**. `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html`, read 2026-10-25.

Both datasets cover both airports nationally, so KSJ adds no difference between 羽田 and 成田; the difference is that KSJ is the *only* structured source either airport has.

### 3.2 ほこナビDP inventory

`https://ckan.hokonavi.go.jp/api/3/action/package_list` returned **43 packages** on 2026-10-25. None covers 羽田空港/大田区 or 成田/芝山町. The E27-type station-indoor maps in the portal are the 都営大江戸線 station packages only (`station_oedo_*`, `mlpt_station_oedo_*`). Licence: the portal's PDL 1.0 basis, as recorded in the 東京駅 report §3.2 (same portal, same day); not re-read here.

**geospatial.jp indoor maps are a separate inventory, and the earlier report did not check it.** `package_search?q=屋内` returned 13 packages (2026-10-25): 成田空港 (令和元年度版 and 令和2年度更新版), 東京駅周辺 (令和元年度版 and 令和2年度更新版), 新宿駅周辺 (three versions), 新横浜駅, two Nagoya underground malls and unrelated items; `?q=羽田` returned 0. So the indoor-map inventory is **成田 yes, 東京駅 yes, 羽田 no**. The 東京駅 report's line "there is no E27-type station-indoor map for 東京駅" was about ほこナビDP only and is now known to be incomplete for the 東京駅 candidate: a 東京駅周辺屋内地図 exists on geospatial.jp, and the lead should re-check its coverage before treating the earlier comparison as final.

### 3.3 What the rights classes cost at each airport

- **羽田空港** — 2 facts-only (JAT+TIAT joint policy; 京急), 1 banned (東京モノレール), 0 UNKNOWN. This is the cleanest operator set of any candidate researched so far: the terminal operator's policy covers all three terminals and its shops in one clause, and the only banned operator's stations are still in KSJ N02.
- **成田空港** — 2 corroboration-only (NAA, JR East), 1 UNKNOWN (京成), 0 facts-only and 0 banned. The airport operator itself cannot be a data source beyond corroboration, and the one operator whose terms could in principle be usable has not published them, so nothing at Narita is importable from an operator's own page today — its geometry and network would come from MLIT's OGL indoor dataset, not from an operator.
- **東京駅** (from the same-day report) — 1 banned, 3 facts-only, 6 UNKNOWN of ten operators.

### 3.4 Shop counts and floor labels

Neither airport's directory can be read from the served HTML: 羽田's shop search, floor guide and access pages, and 成田's shop-search pages, all render client-side and print no rows. Counts are UNKNOWN for both; so are printed floor labels. 羽田's floor guide is a JS app and 成田's is a JS map; no airport-published floor map in text or data form was found at either. A browser read (ego-lite) would give the counts; this task's brief does not allow one.

## 4. Gaps

1. **Airside vs public area.** Both airports have 保安検査後 (after-security) shops: 成田's shop page prints 「T1保安検査後(国際線)」, 「T2保安検査後(国際線)」, 「T3保安検査後(国際線)」 as section headings (read 2026-10-25), and 羽田's shop and floor pages print no airside wording at all (no 保安検査 in the served HTML). No text or data list of which shops are airside was found at either airport, so an area scope for shops is UNKNOWN.
2. **Terminal-to-station connections need printed sources.** 京急 prints two stations and their adjacency, and 京成 prints that 成田空港駅 is in T1's basement — but 京成's rights are UNKNOWN, the Monorail is banned, and JR East is corroboration only. The walking connection (which level, which walkway) appears on JS maps and PDF floor guides only. At 成田, no station serving T3 appears in the station data read here; how T3 is reached by rail is UNKNOWN from these sources.
3. **Multi-operator stations.** 羽田: 京急's one 第1・第2 station vs the Monorail's separate 第1 and 第2 stations; 成田: JR East and 京成 share 成田空港駅 and 空港第2ビル駅. A station import must key on operator + station, and at 成田 the station facts would rest on KSJ N02 alone.
4. **Walking networks are asymmetric.** 成田 has an indoor base map, walking network and public-facility POIs in `mlit-indoor-narita-airport-r2` (OGL), but its **coverage is UNKNOWN** (which terminals, whether it reaches the stations, public vs airside) and the download needs a registered account and login — the same "Owner registers personally" pattern as the ODPT key. 羽田 has **no indoor and no outdoor walking network** at all, so its routes would have to be built from scratch.
5. **No 3D model at 成田**, and at 羽田 no 地下街 model, no LOD3 buildings, and the terminal interiors are not modelled anywhere. Whether the terminals themselves are in the 大田区 bldg model is UNKNOWN until loaded.
6. **No readable shop list at either airport**, and at 成田 the operator is corroboration only anyway.
7. **Narita's rail operator terms are unread** (京成 has no findable site policy), which makes the airport's main rail access UNKNOWN rather than banned or usable.
8. **東京モノレール is a flat ban**, so its station pages and its floor-guide PDF are out even though its stations are in KSJ N02.

## 5. Recommendation

**Order: 東京駅 → 成田空港 → 羽田空港.** If the Owner wants an airport first, **成田 is the airport to open**. Facts and reasoning; the Owner decides.

- **東京駅 first**, on rights and data both. It is the only candidate with a public walking network (`nwd_tokyo`, 2019), 地下街 LOD4 models in both wards and three facts-only operators — and it also has a 東京駅周辺屋内地図 on geospatial.jp, which the earlier report missed because it checked ほこナビ only. Its weakness is the size of its unknown set (six unread operators, two of them the main rail operators) and one banned retail floor.
- **成田空港 second.** It is the only airport with the kind of base our Shinjuku slice is built on: a published **indoor floor map, walking network and public-facility POIs** (`mlit-indoor-narita-airport-r2`, MLIT, 2021, OGL), alongside both KSJ layers (C28 airport + terminal points, N02 with 京成 and JR stations). Its rights are weak but workable: NAA is corroboration only, so the airport's own directory cannot be imported, while shop names may still come from the chains' own pages under OD-34 (4), and the facility POIs come from the MLIT dataset, not from NAA. Its costs: no PLATEAU and no 3D model, the indoor dataset's coverage is UNKNOWN and needs a registered login to download, and 京成's terms are unread so the rail operator's own pages stay out.
- **羽田空港 third.** It has the cleanest operator rights of any candidate researched so far — a single facts-only policy covering all three terminals plus facts-only 京急 — a current PLATEAU dataset (大田区 2025, buildings to LOD2.2, no 地下街) and both KSJ layers. But it has **no public walking network, indoors or outdoors, that this research can find**, no indoor map, and no underground model, so a route layer would have to be authored from nothing. Rights decide what may be used; data decides what exists. 羽田 wins the first and loses the second, and for a transport map the missing network is the larger hole.

What this evidence does **not** establish: that a usable 成田 slice can be drawn — that depends on what the MLIT indoor package actually covers (which terminals, whether it reaches the stations, public vs airside), which is UNKNOWN until the package is downloaded. Nor does it establish that 羽田 has no indoor data anywhere; it establishes that none was found in the two catalogues searched. The next steps are: for 成田, register for the geospatial.jp download and check the package's coverage, then read 京成's terms; for 羽田, load the 大田区 tiles to see whether the terminals are modelled, and a browser read of the shop/floor pages; for 東京駅, re-check its indoor map's coverage before the earlier comparison is treated as final.

---

## Sources read (2026-10-25)

| Source | URL | Used for |
|---|---|---|
| PLATEAU 大田区 2025 | `https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13111-ota-ku-2025` | dataset id, LOD list, no ubld, terms note, file sizes |
| PLATEAU search: 成田 / 芝山 / 12211 / 12409 | `https://www.geospatial.jp/ckan/api/3/action/package_search?q=…` | no PLATEAU dataset for Narita or Shibayama |
| ほこナビDP package list | `https://ckan.hokonavi.go.jp/api/3/action/package_list` | 43 packages, none for either airport |
| KSJ data list | `https://nlftp.mlit.go.jp/ksj/gml/gml_datalist.html` | KSJ 空港 = C28 (and N08, S10b) |
| KSJ C28 空港 2021 | `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-2021.html` | coverage, 基準日, terminal point, 商用可 |
| KSJ N02 鉄道 2025 | `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html` | edition, 基準日, stations incl. monorail, CC BY 4.0 |
| KSJ 利用規約 | `https://nlftp.mlit.go.jp/ksj/other/agreement.html` | PDL 1.0 default, credit wording, effective date |
| 羽田 site policy (JAT+TIAT) | `https://www.tokyo-haneda.com/site_policy/index.html` | facts-only clause |
| JAT corporate site policy | `https://www.tokyo-airport-bldg.co.jp/site_policy/index.html` | facts-only clause |
| TIAT corporate site | `https://www.tiat.co.jp/policy.html` | 404 — no terms page read (GAP) |
| 成田 indoor map open data | `https://www.geospatial.jp/ckan/api/3/action/package_show?id=mlit-indoor-narita-airport-r2` | indoor map + walking network + POIs, 2021, OGL, login required |
| geospatial.jp indoor inventory | `…/package_search?q=屋内&rows=50`, `…?q=羽田&rows=30` | 13 indoor packages incl. 成田 and 東京駅; none for 羽田 |
| 羽田 floor guide T1/T2/T3 | `https://www.tokyo-haneda.com/floor/floor-guide.html?area=7&tab=terminal1` (8=T2, 9=T3) | JS-only, no floor labels in HTML |
| 羽田 shop search | `https://www.tokyo-haneda.com/shop_and_dine/search_s.html` | JS-only, no shop rows |
| 羽田 access (train) | `https://www.tokyo-haneda.com/access/train/index.html` | JS-only |
| `jat.jp` (not JAT) | `https://jat.jp/` | 柔整鍼灸療術協会 — mistaken for JAT's corporate site in an earlier draft; not the operator |
| TIAT | `https://www.tiat.jp/` | DNS failure — no separate site (GAP) |
| 京急 site terms | `https://www.keikyu.co.jp/website-guide.html` | facts-only clause (closes the earlier GAP) |
| 京急 station pages | `https://www.keikyu.co.jp/ride/kakueki/KK16.html`, `…/KK17.html` | station names and adjacency |
| 東京モノレール site terms | `https://www.tokyo-monorail.co.jp/policy/` | banned clause |
| 東京モノレール station page | `https://www.tokyo-monorail.co.jp/guidance/haneda1/` | banned source; station facts noted only |
| NAA site policy | `https://www.narita-airport.jp/ja/copyright/` | 著作権 clause + 禁止事項 14 → corroboration only |
| NAA corporate | `https://www.naa.jp/` | 403 (GAP) |
| 成田 shop / map | `https://www.narita-airport.jp/ja/shop/`, `…/ja/shop/shop-search/?category=shop`, `…?category=restaurant`, `…/ja/map/` | JS-only, no shop rows |
| 京成 site | `https://www.keisei.co.jp/`, `/include/html/footer_sitemap.php`, `/keisei/privacy/index.php` | no terms page found (GAP) |
| 京成 station page | `https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-terminal-1.php` | 成田空港駅 facts (rights UNKNOWN, not imported) |
| 京成 station index | `https://www.keisei.co.jp/keisei/tetudou/accessj/index.php`, `…/people_top.html` | 空港第2ビル page not found (GAP) |
| 東京駅 report | [`third-station-selection-2026-10.md`](third-station-selection-2026-10.md) | third candidate's figures |

## Fetch log (2026-10-25, 14:49–14:57 JST; plain `curl`, default UA, ≥0.6 s apart)

| # | URL | HTTP |
|---|---|---|
| 1 | https://www.tokyo-haneda.com/ | 301 → `/index.html` |
| 2 | https://www.narita-airport.jp/ | 307 → `/en/` |
| 3 | https://www.keikyu.co.jp/ | 200 |
| 4 | https://www.tokyo-monorail.co.jp/ | 200 |
| 5 | https://www.keisei.co.jp/ | 200 |
| 6 | HEAD https://www.tokyo-haneda.com/ | 301 |
| 7 | HEAD https://www.narita-airport.jp/ | 307 |
| 8 | https://www.tokyo-haneda.com/index.html | 200 |
| 9 | https://www.narita-airport.jp/ja/ | 200 |
| 10 | https://www.narita-airport.jp/ja/sitemap/ | 200 |
| 11 | https://www.narita-airport.jp/ja/sitepolicy/ | 404 |
| 12 | https://www.narita-airport.jp/ja/site-policy/ | 404 |
| 13 | https://www.naa.jp/ | 403 |
| 14 | https://www.narita-airport.jp/ja/copyright/ | 200 |
| 15 | https://www.tokyo-haneda.com/site_policy/index.html | 200 |
| 16 | https://www.keikyu.co.jp/website-guide.html | 200 |
| 17 | https://www.keisei.co.jp/keisei/sitepolicy/index.php | 404 |
| 18 | https://www.jat.jp/ | 301 → `https://jat.jp/` |
| 19 | https://www.tokyo-monorail.co.jp/sitemap.html | 404 |
| 20 | https://www.tokyo-monorail.co.jp/company/ | 200 |
| 21 | https://www.tokyo-monorail.co.jp/guidance/haneda1/ | 200 |
| 22 | https://www.keisei.co.jp/keisei/privacy/index.php | 200 |
| 23 | HEAD https://www.jat.jp/ | 301 |
| 24 | HEAD https://www.tiat.jp/ | DNS failure |
| 25 | https://www.tokyo-monorail.co.jp/shared/js/header_footer.js | 200 |
| 26 | https://www.keisei.co.jp/keisei/sitemap/index.php | 404 |
| 27 | https://jat.jp/ | 200 |
| 28 | https://www.tokyo-monorail.co.jp/policy/ | 200 |
| 29 | https://jat.jp/policy/ | 404 |
| 30 | https://www.keisei.co.jp/keisei/company/index.php | 404 |
| 31 | https://www.keisei.co.jp/keisei/site_policy.php | 404 |
| 32 | https://www.keikyu.co.jp/visit/haneda-airport/ | 200 |
| 33 | https://www.haneda-tokyo-access.com/ | 301 |
| 34 | https://www.keisei.co.jp/sitepolicy/ | 404 |
| 35 | https://www.keisei.co.jp/keisei/sitepolicy/ | 404 |
| 36 | https://www.keisei.co.jp/include/html/footer_sitemap.php | 200 |
| 37 | https://nlftp.mlit.go.jp/ksj/gml/datalist/ | 403 (GAP) |
| 38 | https://ckan.hokonavi.go.jp/api/3/action/package_list | 200 |
| 39 | https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13111-ota-ku-2025 | 200 |
| 40 | …?id=plateau-12211-narita-shi-2025 | 404 |
| 41 | …?id=plateau-12409-shibayama-machi-2025 | 404 |
| 42 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N04.html | 200 (道路密度, not the airport layer) |
| 43 | …/package_search?q=成田 | 200 |
| 44 | …/package_search?q=芝山 | 200 |
| 45 | …/package_search?q=12211 | 200 |
| 46 | …/package_search?q=12409 | 200 |
| 47 | …/package_search?q=13111 | 200 |
| 48 | https://html.duckduckgo.com/html/?q=… | 202, bot page, no results (GAP) |
| 49 | https://nlftp.mlit.go.jp/ksj/sitemap.xml | 404 |
| 50 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N43.html | 404 |
| 51 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N44.html | 404 |
| 52 | https://www.bing.com/search?q=… | 200, JS shell, no results (GAP) |
| 53 | https://search.yahoo.co.jp/search?p=… | 200, bot page, no results (GAP) |
| 54 | https://nlftp.mlit.go.jp/ksj/gml/gml_datalist.html | 200 |
| 55 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-2021.html | 200 |
| 56 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html | 200 |
| 57 | https://www.tokyo-haneda.com/floor/floor-guide.html?area=7&tab=terminal1 | 200, JS body |
| 58 | https://www.tokyo-haneda.com/shop_and_dine/search_s.html | 200, JS body |
| 59 | https://www.tokyo-haneda.com/access/train/index.html | 200, JS body |
| 60 | https://www.narita-airport.jp/ja/shop/ | 200 |
| 61 | https://www.narita-airport.jp/ja/map/ | 200, JS body |
| 62 | https://www.narita-airport.jp/ja/shop/shop-search/?category=shop | 200, empty result list |
| 63 | https://www.narita-airport.jp/ja/shop/shop-search/?category=restaurant | 200, empty result list |
| 64 | https://www.keikyu.co.jp/visit/haneda-airport/access/train.html | 200 |
| 65 | https://www.keisei.co.jp/keisei/tetudou/accessj/index.php | 200 |
| 66 | https://www.keikyu.co.jp/ride/kakueki/ | 200 |
| 67 | https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-terminal-1.php | 200 |
| 68 | https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-terminal-2.php | 404 |
| 69 | https://www.keisei.co.jp/keisei/tetudou/railmap/railmap.php | 302 |
| 70 | https://www.keikyu.co.jp/ride/kakueki/KK16.html | 200 |
| 71 | https://www.keikyu.co.jp/ride/kakueki/KK17.html | 200 |
| 72 | https://www.keisei.co.jp/keisei/tetudou/accessj/people_top.html | 200 |
| 73 | https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-2.php | 404 |
| 74 | https://www.keisei.co.jp/keisei/policy/index.php | 404 |
| 75 | https://nlftp.mlit.go.jp/ksj/other/agreement.html | 200 |
| 76 | https://www.geospatial.jp/ckan/api/3/action/package_show?id=mlit-indoor-narita-airport-r2 | 200 |
| 77 | https://www.tokyo-airport-bldg.co.jp/site_policy/index.html | 200 |
| 78 | https://www.tiat.co.jp/policy.html | 404 |
| 79 | https://www.geospatial.jp/ckan/api/3/action/package_search?q=屋内&rows=50 | 200 |
| 80 | https://www.geospatial.jp/ckan/api/3/action/package_search?q=羽田&rows=30 | 200 |
