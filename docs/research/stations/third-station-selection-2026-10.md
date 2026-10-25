# Third-station selection: 東京駅 vs 品川駅 vs 梅田・大阪駅

Status: research report, for the Owner to decide from. Nothing here is a decision.
Date: 2026-10-25. Every page was read on 2026-10-25 (JST) unless its row says otherwise; three operator terms pages (東京メトロ, アトレ品川, ecute品川) are dated 2026-10-24 under OD-34 and were not re-read. Author: data research (DeepSeek worker, for data-research-05).
Rights frame: OD-34 in [`../owner-decisions-pending.md`](../owner-decisions-pending.md). The four classes below are OD-34's: **facts only** (no ban, or only a copy/reprint request or a copyright line), **corroboration only** (business-use ban), **banned** (flat refusal of reuse), **UNKNOWN** (no quoted clause found — not a finding of risk). A class is only assigned when this report can show a quoted clause, its URL and the date it was read; anything else is UNKNOWN. **GAP** is not a class: it is the verification status of a page that could not be read (403, connection failure, JS-only, or no terms page), and such a source stays UNKNOWN.

## Method and limits

- Pages were read with plain `curl` (default UA), requests ≥0.6 s apart; about 77 requests in total, including the CKAN metadata queries. Dataset facts come from the public CKAN APIs of geospatial.jp (PLATEAU) and ckan.hokonavi.go.jp (ほこナビDP), plus the 国土数値情報ダウンロードサイト. Two further pages were read on 2026-10-25 while fixing this report: the メトロプロパティーズ terms page (200) and the JR East homepage (403).
- A 403, a connection failure, a JS-only page or a site with no terms page is recorded as a **GAP in verification**; the rights class stays **UNKNOWN**. Nothing was bypassed; no one was contacted; no sign-ins, forms or uploads.
- Every claim below carries a URL and the date seen. Anything without a quoted clause or figure is marked UNKNOWN.
- Shop counts are UNKNOWN for all three stations: the floor guides are rendered by JavaScript and print no count in the served HTML (§3.4). Floor labels themselves were only readable at 大丸東京店.

## 1. Answer in one table

| | 東京駅 | 品川駅 | 梅田・大阪駅 |
|---|---|---|---|
| PLATEAU city model | **two ward datasets**: 千代田区 2025 (丸の内) + 中央区 2025 (八重洲); both bldg LOD1–2 and both **地下街 LOD4**; the station area is split at the ward line; which malls the two ubld models contain is UNKNOWN until loaded | 港区 2025 (2023 also published); bldg LOD1–3, **no 地下街 model**; the whole station area is in one ward | 大阪市 2020/2022/2024/2025; 2022 bldg LOD1–3, no 地下街 model; the current-year catalogue is empty, so 2025 LOD is UNKNOWN |
| KSJ N02 railway | N02-2025 (national, 基準日 2025-12-31); the dataset page labels it **CC BY 4.0** | same | same |
| ほこナビ walking network | **`nwd_tokyo`**, last updated 2019-01-23 (2D network; no floor data stated) | none in the portal (43 packages) | none in the portal |
| E27-type station indoor map | none | none | none |
| Facts-only operators | 大丸東京店, 東京メトロ, メトロプロパティーズ (エチカ) | アトレ品川 | 阪急電鉄, 大丸梅田店 (group terms only) |
| Corroboration only | — | — | LUCUA, ホワイティうめだ |
| Banned | グランスタ (JR東日本クロスステーション) | ecute品川 (JR東日本クロスステーション) | 大阪ステーションシティ, グランフロント大阪 |
| UNKNOWN (GAP = page not readable) | 6 — JR東日本 (403), JR東海, 八重洲地下街, 東京駅一番街, KITTE/JPタワー (unreachable), 三菱地所 丸の内 | 5 — JR東日本 (403), 京急, JR東海, ウィング高輪 (unreachable), 品川インターシティ (unreachable) | 6 — JR西日本, 阪神電気鉄道, 阪急百貨店/阪神百貨店, ディアモール大阪, 阪急三番街 (unreachable), 大阪メトロ (unreachable) |
| Public shop data | floor labels printed (大丸東京店); count UNKNOWN | floor guide exists, JS-only; count UNKNOWN | floor guides exist, JS-only; count UNKNOWN |

## 2. Station by station

### 2.1 東京駅

**3D/GIS coverage.** PLATEAU 千代田区, 2025年度版, dataset `plateau-13101-chiyoda-ku-2025` on geospatial.jp (the 2023年度 dataset `plateau-13101-chiyoda-ku-2023` is also published). The データ目録（v5） for the 2025 dataset lists:

- 建築物モデル **LOD1 and LOD2** (3D Tiles only — no LOD3),
- **地下街モデル LOD1 and LOD4** (ubld),
- 交通（道路）モデル LOD1–LOD3, 都市設備 LOD1/LOD3, 橋梁 LOD1/LOD2,
- CityGML 2.1 GB, 3D Tiles+MVT 841 MB, 関連データセット 27 kB (station, railway, landmark, shelter, park, emergency_route, border as GeoJSON).

Source: `https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13101-chiyoda-ku-2025`, データ目録 resource, read 2026-10-25.

The station straddles two wards, and **both have a 2025 dataset with a 地下街 model**:

- 丸の内 side — 千代田区 (above): bldg LOD1/LOD2, ubld LOD1/LOD4.
- 八重洲 side — 中央区, dataset `plateau-13102-chuo-ku-2025` (2023年度 also published). Its データ目録（v5） lists 建築物モデル LOD1 and LOD2, **地下街モデル LOD1 and LOD4** (ubld), 交通 LOD1–LOD3, 橋梁 LOD1–LOD3, 都市設備 LOD1/LOD3; CityGML 2.5 GB. That establishes a 地下街 model in 中央区; **whether it covers the 八重洲地下街 footprint is UNKNOWN** until the tiles are loaded (the catalogue names the model, not the malls in it).

Sources: `package_show?id=plateau-13101-chiyoda-ku-2025` and `…?id=plateau-13102-chuo-ku-2025`, データ目録 resources, read 2026-10-25.

This is the only one of the three station areas where a **地下街 (ubld) model at LOD4 is published at all**, in both wards (大阪市's current catalogue is empty, so its case stays UNKNOWN). Which underground malls each model actually contains is a loading-time check. The cost is operational: the area needs two ward datasets (2.1 GB + 2.5 GB CityGML, or their 3D Tiles) stitched at the 千代田区/中央区 line, which runs through the station.

Dataset terms, from the package notes of both: 「商用利用も含め、どなたでも無償で自由にご利用いただけます。」 — the same basis as our PLATEAU precedent (commercial use allowed with the PLATEAU credit).

**KSJ.** N02 鉄道 2025年度版 covers all lines and stations at 東京駅 nationally; see §3.1.

**歩行空間ネットワーク.** ほこナビDP has `nwd_tokyo`, 歩行空間ネットワークデータ（東京駅周辺）, 最終更新日 **2019/01/23**:

| File | Bytes |
|---|---|
| link.csv | 835,037 |
| node.csv | 626,732 |
| link.geojson | 3,871,735 |
| node.geojson | 2,043,790 |

Source: `https://ckan.hokonavi.go.jp/api/3/action/package_show?id=nwd_tokyo`, read 2026-10-25. It is a 2D walking network (2024-07 network spec, per the package notes); the page states no floor data. The date above is the package's **最終更新日** (last updated), not a documented survey or content date, so the network's own survey and content dates are UNKNOWN; the package gives the date of its last update and nothing for the passages themselves. It is older than the Shinjuku E27 snapshot we ship (2025-09). A second, wider package `nwd_chiyoda_chuo` (皇居外苑・日本武道館を含む千代田区、中央区周辺, 最終更新日 2018/06/20) also exists and may overlap the station area. There is **no** E27-type station-indoor map (GSI hierarchical spec) for 東京駅 in the portal; the only station maps are 都営大江戸線 stations.

**Operators.**

| Operator | Role | Terms URL | Quoted clause | Class | Date seen |
|---|---|---|---|---|---|
| JR東日本 | station, all lines | https://www.jreast.co.jp/ | no clause: the site returned **403** to plain curl, so nothing could be quoted (GAP in verification). OD-34 (1) of 2026-10-24 records an Owner ruling that keeps JR East out as a data source; a ruling is not a clause read for this report | UNKNOWN | 2026-10-25 |
| JR東海 (東海道新幹線) | 新幹線 platforms | — | site terms not read in this task | UNKNOWN | 2026-10-25 |
| JR東日本クロスステーション / グランスタ東京 | 駅ナカ retail | https://www.gransta.jp/terms/ | 「複製・転用・転載・電磁的加工・送信・頒布・二次的使用・その他これらに類する全ての行為も含め、一切お断りいたします。」 | **banned** (same wording as Odakyu Ace / Keio Mall) | 2026-10-25 |
| 大丸東京店 | department store | https://dmdepart.jp/siteinfo/ | 「「私的使用」または「引用」など著作権法上認められた場合を除き、当社に無断で、転載、複製、改変、翻訳、販売、貸与、公衆送信などの利用をすることを禁止します。」 | facts only | 2026-10-25 |
| 東京メトロ (丸ノ内線) | metro | https://www.tokyometro.jp/terms/index.html | 「著作権法上の「私的使用」や「引用」の範囲を超えて…」 | facts only | 2026-10-24 (OD-34 (2)) |
| メトロプロパティーズ (エチカ) | underground retail | https://www.metro-pro.jp/terms/ | 「これらについて、権利者の許可なく複製、転用などをすることは法律で禁止されています。」 (restates the law; no ban beyond it) | facts only | 2026-10-25 |
| 八重洲地下街 | underground mall | https://www.yaechika.com/ | no terms page found: `/terms/` and `/sitepolicy/` return 404; the homepage footer links only プライバシーポリシー and ソーシャルメディアポリシー | UNKNOWN | 2026-10-25 |
| 東京駅一番街 | 駅ナカ retail | https://www.tokyoeki-1bangai.co.jp/ | footer links only プライバシーポリシー; `/terms/` 404 | UNKNOWN | 2026-10-25 |
| KITTE / JPタワー (日本郵政) | retail + office | https://www.jptower-kitte.jp/ | no clause: did not answer plain curl (connection failure — GAP in verification) | UNKNOWN | 2026-10-25 |
| 三菱地所 丸の内 | district operator | https://www.marunouchi.com/ | no terms page found: `/terms` 404; the homepage footer is JS-rendered (GAP in verification) | UNKNOWN | 2026-10-25 |

### 2.2 品川駅

**3D/GIS coverage.** PLATEAU 港区, 2025年度版, `plateau-13103-minato-ku-2025` (2023年度 also published). The データ目録（v5） lists 建築物モデル **LOD1, LOD2 and LOD3**, 交通 LOD1–LOD3, 橋梁 LOD1–LOD3, 都市設備 LOD1/LOD3, 植生 LOD1/LOD3, 水部 LOD0/LOD1, 区域モデル, plus the same 関連データセット (station, railway, landmark, …). CityGML 2.0 GB, 3D Tiles+MVT 1.7 GB. There is **no 地下街モデル (ubld)** in the catalogue — the CityGML udx list is bldg, brid, dem, fld, frn, htd, lsld, luse, tran, urf, veg, wtr, area only.

Source: `package_show?id=plateau-13103-minato-ku-2025`, read 2026-10-25.

品川駅 (高輪/港南) is entirely inside 港区, so one dataset covers the whole station area — cleaner than 東京駅's ward split — and it has LOD3 buildings, which 千代田区 does not. It has no underground-mall model, and the station's own concourse is not modelled (PLATEAU buildings come from aerial survey; no interior).

Dataset terms: same note, 「商用利用も含め、どなたでも無償で自由にご利用いただけます。」 (read 2026-10-25).

**KSJ.** Same national N02-2025 (§3.1).

**歩行空間ネットワーク.** There is **no 品川駅 package** in ほこナビDP: the full `package_list` (43 packages, read 2026-10-25) contains nothing for 品川 or 港区 — only the Tokyo stations we already use (新宿, 渋谷/千駄ヶ谷, 池袋, 上野, 大門, 新木場, etc.) and unrelated cities. No E27-type station map either.

**Operators.**

| Operator | Role | Terms URL | Quoted clause | Class | Date seen |
|---|---|---|---|---|---|
| JR東日本 | station, all JR lines | https://www.jreast.co.jp/ | no clause: the site returned **403** to plain curl, so nothing could be quoted (GAP in verification). OD-34 (1) of 2026-10-24 records an Owner ruling that keeps JR East out as a data source; a ruling is not a clause read for this report | UNKNOWN | 2026-10-25 |
| アトレ品川 | station building retail (JR East group) | https://www.atre.co.jp/company/site/ | 「私的利用など法律によって認められる範囲を超えて無断使用・複製することを禁止」 | facts only | 2026-10-24 (OD-34 (2)) |
| ecute品川 | 駅ナカ retail (JR East Cross) | https://www.ecute.jp/terms/ | 「本ウェブサイトの掲載内容全部につき、無断使用・複製することを禁止します。」 | **banned** | 2026-10-24 (OD-34 (3)) |
| JR東海 (東海道新幹線) | 新幹線 platforms | — | site terms not read in this task | UNKNOWN | 2026-10-25 |
| 京急 (京急線) | railway | https://www.keikyu.co.jp/ | no terms page found: the homepage footer links only プライバシーポリシー; `/siteinfo/` and `/siteinfo/terms.html` return 404 (GAP in verification) | UNKNOWN | 2026-10-25 |
| ウィング高輪 (京急ショッピングセンター) | station building retail | https://www.wing-takanawa.com/ | no clause: did not answer plain curl (GAP in verification) | UNKNOWN | 2026-10-25 |
| 品川インターシティ (港南口) | office + retail | https://www.shinagawa-intercity.jp/ | no clause: did not answer plain curl (GAP in verification) | UNKNOWN | 2026-10-25 |

### 2.3 梅田・大阪駅

**3D/GIS coverage.** PLATEAU 大阪市 is published for 2020, 2022, 2024 and 2025 (`plateau-27100-osaka-shi-2020/2022/2024/2025`); it is a **city** dataset (27100), not a ward one, so 北区梅田 is inside it but the download is the whole city.

- The 2025 (v5) and 2024 (v4) データ目録 resources come back **empty** (119 bytes — the intro sentence only), so the current-year LOD set is **UNKNOWN** from the catalogue.
- The 2022 (v3) 目録 lists 建築物モデル LOD1, **LOD2 and LOD3**, 交通 LOD1–LOD3, 都市設備 LOD3, 植生 LOD2/LOD3, and **no 地下街モデル**; CityGML 1.4 GB, 3D Tiles+MVT 1.6 GB, 関連データセット 419 kB.

Sources: `package_show?id=plateau-27100-osaka-shi-2025`, `…-2024`, `…-2022`, read 2026-10-25. Our precedent treats PLATEAU as usable with credit; the dataset notes carry the same 「商用利用も含め、どなたでも無償で自由にご利用いただけます。」 line (2026-10-25).

**KSJ.** Same national N02-2025 (§3.1).

**歩行空間ネットワーク.** No 大阪 or 梅田 package in ほこナビDP (43 packages, 2026-10-25). No E27-type station map.

**Operators.**

| Operator | Role | Terms URL | Quoted clause | Class | Date seen |
|---|---|---|---|---|---|
| JR西日本 | 大阪駅, all JR lines | https://www.westjr.co.jp/ | no terms page found: homepage footer is JS-rendered; `/terms/` and `/site_policy/` return 404 (GAP in verification) | UNKNOWN | 2026-10-25 |
| 大阪ステーションシティ (JR西日本ステーションシティ) | station building | https://osakastationcity.com/info/rule.php | 「…全てのコンテンツ…はＪＲ西日本ステーションシティ株式会社をはじめとする権利者の許可なく、無断で複製、転記、放送、配布、貸与、翻訳、変造、販売することはできません。」 (no legal-exception clause) | **banned** | 2026-10-25 |
| LUCUA (JR西日本SC開発) | station retail | https://www.lucua.jp/sitepolicy/ | 「これらのコンテンツの個人的な利用に関しては、第三者が閲覧可能な環境に流用しない、または営利目的で利用しない場合にのみ表示・印刷等の複製を認めます。」 | corroboration only (business-use ban) | 2026-10-25 |
| 阪急電鉄 | 大阪梅田駅, 阪急線 | https://www.hankyu.co.jp/sitepolicy/index.html | 「法的に認められる範囲を超えて、著作権者の事前の許諾なく、これらのコンテンツを利用…することを禁止いたします。」 | facts only | 2026-10-25 |
| 阪神電気鉄道 | 大阪梅田駅, 阪神線 | — | site terms not read in this task | UNKNOWN | 2026-10-25 |
| ホワイティうめだ (大阪地下街) | underground mall | https://www.osaka-chikagai.jp/policy/ | 「個人的な利用に関しては、第三者が閲覧可能な環境に流用しない、または営利目的で利用しない場合にのみ表示、複製、印刷を認めます。」 + 禁止事項「営業活動または営利を目的とする行為、またはその準備を目的とする行為。」 | corroboration only | 2026-10-25 |
| グランフロント大阪 (うめきた) | retail + office | https://www.grandfront-osaka.jp/sitepolicy/ | 「…は当法人の許可なく、無断で複製、転記、放送、配布、貸与、翻訳、変造、販売することはできません。」 (no legal-exception clause) | **banned** | 2026-10-25 |
| 阪急百貨店 / 阪神百貨店 (H2Oリテイリング) | department stores | https://www.hankyu-dept.co.jp/, https://www.hanshin-dept.jp/hshonten/ | no terms page found on either store site; `/sitepolicy/` 404; the holding company site lists only privacy, social-media and cookie policies (GAP in verification) | UNKNOWN | 2026-10-25 |
| ディアモール大阪 (大阪ダイヤモンド地下街株式会社) | underground mall | https://www.diamor.jp/ | no terms link on the homepage; `/sitepolicy/` 404; only a privacy page, which names 「大阪ダイヤモンド地下街株式会社」 (https://www.diamor.jp/about/privacy/) (GAP in verification) | UNKNOWN | 2026-10-25 |
| 阪急三番街 | underground mall | https://www.hankyu-sanbangai.com/ | no clause: did not answer plain curl (GAP in verification) | UNKNOWN | 2026-10-25 |
| 大阪メトロ (梅田・東梅田・西梅田) | metro | https://www.osaka-metro.co.jp/ | no clause: did not answer plain curl (GAP in verification) | UNKNOWN | 2026-10-25 |
| 大丸梅田店 | department store | https://dmdepart.jp/siteinfo/ | 「「私的使用」または「引用」など著作権法上認められた場合を除き、当社に無断で、転載、複製、改変、翻訳、販売、貸与、公衆送信などの利用をすることを禁止します。」 (group terms, the same page read for 大丸東京店); the store's own page `https://www.daimaru.co.jp/umeda/` returned **403** (GAP in verification) | facts only (group terms) | 2026-10-25 |

## 3. Cross-cutting

### 3.1 KSJ N02 鉄道

The current edition is **2025年度（令和7年度）版**, データ基準年月日 **2025年12月31日時点**, updated 2026年4月, and it is **national**: 「全国の旅客鉄道・軌道の路線や駅について、形状（線）、鉄道区分…事業者…路線名、運営会社等を整備した」 (`https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html`, 2026-10-25). All three stations are in the same dataset, so N02 adds no difference between them.

Terms, two layers:

- The dataset page itself states 「このデータの使用許諾条件 2020年（令和2年）以降：オープンデータ（CC_BY_4.0）／上記以外：商用可」 (`KsjTmplt-N02-2025.html`, read 2026-10-25). For the 2025 edition (基準日 2025-12-31) that is the operative label: **CC BY 4.0**.
- The site-wide 利用規約 (`https://nlftp.mlit.go.jp/ksj/other/agreement.html`, read 2026-10-25) says 「…特記されていない限り国土交通省に属し、権利表記の記載がない限り（「公共データ利用規約（第1.0版）」（PDL1.0）が適用されています。」 and 「本利用規約は、2026年（令和8年）3月23日から施行します。」 — i.e. PDL 1.0 only where the dataset carries no label of its own, so it does not displace the CC BY 4.0 line above.
- Credit wording from the same 利用規約: 「出典：国土交通省国土数値情報ダウンロードサイト（当該ページのURL）」.

Either way the data is usable with credit, matching our N02-2023 precedent; the 2025 edition's label is the stronger of the two.

### 3.2 ほこナビDP inventory

`https://ckan.hokonavi.go.jp/api/3/action/package_list` returned **43 packages** on 2026-10-25. For our three stations:

- 東京駅: `nwd_tokyo` (last updated 2019/01/23) — present; `nwd_chiyoda_chuo` (last updated 2018/06/20) overlaps.
- 品川駅: none.
- 梅田・大阪駅: none.
- Station-indoor (E27-type) maps: only 都営大江戸線 stations (`station_oedo_shinjuku`, `…_shinjukunishiguchi`, `…_tochomae`, `…_daimon`, `…_akanabebashi`, `…_kokuritsu-kyogijo`, plus `mlit_station_oedo_*`). None of the three candidates has one.

Licence per the portal: PDL 1.0 (same basis as our E27/S02 records, DR-NS-08/09/10).

### 3.3 What the rights classes cost at each station

Counting the tables in §2.1–§2.3 (ten operators at 東京駅, seven at 品川駅, twelve at 梅田・大阪駅):

- **東京駅** — 1 banned (グランスタ), 3 facts-only (大丸東京店, 東京メトロ, メトロプロパティーズ/エチカ), 6 UNKNOWN (JR East, JR東海, 八重洲地下街, 東京駅一番街, KITTE/JPタワー, 三菱地所 丸の内). Six of ten operators are unread, and 八重洲地下街 is the largest of them.
- **品川駅** — 1 banned (ecute), 1 facts-only (アトレ), 5 UNKNOWN (JR East, 京急, JR東海, ウィング高輪, 品川インターシティ). All three railway operators at the station (JR East, 京急, JR東海) are unread, so none of the station's own operators is usable.
- **梅田・大阪駅** — 2 banned (大阪ステーションシティ, グランフロント大阪), 2 corroboration-only (LUCUA, ホワイティうめだ), 2 facts-only (阪急電鉄, 大丸梅田店 at group-terms level, its own pages 403), 6 UNKNOWN (JR West, 阪神電気鉄道, 阪急/阪神百貨店, ディアモール大阪, 阪急三番街, 大阪メトロ). JR West — the station's main operator — is one of the unread.

### 3.4 Shop counts

None could be read. The floor guides that exist are JS-rendered and print no count in the served HTML:

- 大丸東京店: `https://www.daimaru.co.jp/tokyo/` (200) and `https://www.daimaru.co.jp/tokyo/floor/` (200) — the floor page **does print floor labels** (B1F, 1F–13F) in the served HTML; the shop list and count do not.
- アトレ品川: `https://www.atre.co.jp/shinagawa/` (200) and `/shinagawa/floor/` (200, 10 kB) — floor labels are not in the served HTML.
- 大丸梅田店: `https://www.daimaru.co.jp/umeda/` → **403**.

A browser read (ego-lite) would give the counts; this task's brief does not allow one, so they are UNKNOWN.

## 4. Gaps

1. **東京駅 — two datasets, one seam.** The station area needs both 千代田区 and 中央区 2025 (2.1 GB + 2.5 GB CityGML). Whether the two ubld LOD4 footprints join cleanly across the ward line is UNKNOWN until both are loaded, and so is which malls each model actually contains (including whether the 八重洲地下街 is in the 中央区 model at all).
2. **東京駅 — 八重洲地下街 terms unread** (no terms page on yaechika.com). It is the largest unknown at the station and worth one more pass (for example the operator's corporate site) before any import.
3. **東京駅 — グランスタ is banned** (same wording as the Odakyu Ace / Keio Mall flat bans), so the 丸の内 駅ナカ floor belongs to the same excluded family as ecute.
4. **品川駅 — no walking network and no underground model**: no ほこナビ package, and 港区's PLATEAU has no ubld. Routes at 品川 would be line-of-sight only.
5. **品川駅 — 京急 has no findable terms page**; 京急 runs half the station (and ウィング高輪), and its site's footer links only プライバシーポリシー while ウィング高輪 and 品川インターシティ did not answer plain curl at all.
6. **梅田 — JR West's terms are unread.** The station's main operator is UNKNOWN, which is worse than a ban: a ban at least settles it.
7. **梅田 — 大阪市 PLATEAU current-year catalogue is empty** (119 B), so the 2025 LOD set (and the presence or absence of a 地下街 model) is UNKNOWN; only the 2022 (v3) list was readable.
8. **梅田 — the two flagship complexes are flat bans** (大阪ステーションシティ, グランフロント大阪), and 阪急/阪神百貨店, ディアモール and 大阪メトロ are unread or unreachable.
9. **All three — no E27-type indoor map and no shop counts**; counts need a browser read of the floor guides.
10. **All three — the station concourse itself is not modelled** by PLATEAU (aerial-survey buildings only), so a station-interior visual would follow the same approach as Shinjuku/Ikebukuro, not a new data source.

## 5. Recommendation

**Open 東京駅 next**, subject to the load test in the next paragraph. It is the only candidate that offers both of the things our Shinjuku lane actually builds on: a public walking network (`nwd_tokyo` — last updated 2019-01-23, its content date UNKNOWN, but present and PDL 1.0) and 地下街 models at LOD4 — two of them, one in 千代田区 (丸の内 side) and one in 中央区 (八重洲 side), each on a 2025 PLATEAU dataset that also carries the buildings around the station. Its usable operator set is the strongest of the three, though weaker than a first reading suggests: 大丸東京店 is facts-only with floor labels printed in its floor guide, and 東京メトロ plus メトロプロパティーズ (エチカ) are facts-only under OD-34 — three of ten operators. JR East and five other operators at the station (JR東海, 八重洲地下街, 東京駅一番街, KITTE/JPタワー, 三菱地所 丸の内) are UNKNOWN, so the usable set covers a minority of the station. Its known holes are bounded — the two ward datasets must be stitched at the line that runs through the station, a stitching cost 品川駅 does not have, and 八重洲地下街's terms are unread. Against that, 品川駅 has the cleanest single-dataset coverage (one ward, bldg LOD3, no seam) but no walking network, no underground model, an unread 京急 and an ecute-banned retail floor, and much less to explore; 梅田・大阪駅 has the largest and richest station area but loses it to the rights frame: both flagship complexes are flat bans, the next tier is a business-use ban, JR West's terms could not be read at all, and the current PLATEAU catalogue publishes no LOD list.

What this evidence does **not** establish is that a usable 東京駅 slice can be built on the 丸の内 side itself. Whether either ubld model contains the malls and passages a route would need, and whether the two ward footprints join across the line through the station, is UNKNOWN until both datasets are loaded. So the recommendation is an ordering, not a delivery plan. If the load test shows usable interior coverage on the 丸の内 side with route continuity across the seam, the 丸の内 side is where the station's first slice starts. If it shows the 丸の内 model lacks the passages a route needs, the first slice would have to start on the 八重洲 side instead — and that depends on the 八重洲地下街 terms, which are still unread, so the station would then wait on them rather than ship. The next steps are the load test of both ward datasets (it decides which side can carry a first slice) and the 八重洲地下街 terms page (it decides whether the 八重洲 side may be used at all).

---

## Sources read (2026-10-24 to 2026-10-25)

| Source | URL | Used for |
|---|---|---|
| PLATEAU 千代田区 2025 | `https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025` (via `package_show`) | dataset id, LOD list, terms note |
| PLATEAU 千代田区 2023 | `https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023` | dataset exists |
| PLATEAU 港区 2025 / 2023 | `https://www.geospatial.jp/ckan/dataset/plateau-13103-minato-ku-2025`, `…-2023` | dataset id, LOD list, no ubld |
| PLATEAU 大阪市 2020/2022/2024/2025 | `https://www.geospatial.jp/ckan/dataset/plateau-27100-osaka-shi-2025`, `…-2024`, `…-2022`, `…-2020` | dataset ids, 2022 LOD list, empty current catalogues |
| PLATEAU 中央区 2025 / 2023 | `https://www.geospatial.jp/ckan/dataset/plateau-13102-chuo-ku-2025`, `…-2023` | dataset id, LOD list, ubld LOD4 |
| ほこナビDP package list | `https://ckan.hokonavi.go.jp/api/3/action/package_list` | 43 packages, none for 品川/大阪 |
| ほこナビ `nwd_tokyo` | `https://ckan.hokonavi.go.jp/dataset/nwd_tokyo` (via `package_show`) | 最終更新日, file sizes |
| ほこナビ `nwd_chiyoda_chuo` | `https://ckan.hokonavi.go.jp/dataset/nwd_chiyoda_chuo` | overlapping package |
| KSJ N02-2025 | `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html` | edition, 基準日, national coverage |
| KSJ 利用規約 | `https://nlftp.mlit.go.jp/ksj/other/agreement.html` | PDL 1.0 + credit wording, effective 2026-03-23 |
| グランスタ | `https://www.gransta.jp/terms/` | banned clause |
| 大丸 (site use) | `https://dmdepart.jp/siteinfo/` | facts-only clause |
| 大丸東京店 floor guide | `https://www.daimaru.co.jp/tokyo/`, `/tokyo/floor/` | floor labels printed |
| 大丸梅田店 | `https://www.daimaru.co.jp/umeda/` | 403 (GAP) |
| アトレ品川 | `https://www.atre.co.jp/shinagawa/`, `/shinagawa/floor/` | floor guide, JS-only |
| 京急 | `https://www.keikyu.co.jp/` (+ `/siteinfo/`: 404) | no terms page found |
| ウィング高輪 / 品川インターシティ | `https://www.wing-takanawa.com/`, `https://www.shinagawa-intercity.jp/` | connection failure (GAP) |
| 八重洲地下街 | `https://www.yaechika.com/` (`/terms/`: 404) | no terms page found |
| 東京駅一番街 | `https://www.tokyoeki-1bangai.co.jp/` (`/terms/`: 404) | no terms page found |
| KITTE / JPタワー | `https://www.jptower-kitte.jp/` | connection failure (GAP) |
| 三菱地所 丸の内 | `https://www.marunouchi.com/` (`/terms`: 404) | no terms page found |
| 大阪ステーションシティ | `https://osakastationcity.com/info/rule.php` | banned clause |
| LUCUA | `https://www.lucua.jp/sitepolicy/` | business-use ban |
| 阪急電鉄 | `https://www.hankyu.co.jp/sitepolicy/index.html` | facts-only clause |
| ホワイティうめだ | `https://www.osaka-chikagai.jp/policy/` | business-use ban |
| グランフロント大阪 | `https://www.grandfront-osaka.jp/sitepolicy/` | banned clause |
| 阪急百貨店 / 阪神百貨店 / H2O | `https://www.hankyu-dept.co.jp/`, `https://www.hanshin-dept.jp/hshonten/`, `https://www.h2o-retailing.co.jp/ja/` | no terms page found |
| ディアモール大阪 | `https://www.diamor.jp/` (`/sitepolicy/`: 404) | no terms page found |
| 阪急三番街 | `https://www.hankyu-sanbangai.com/` | connection failure (GAP) |
| 大阪メトロ | `https://www.osaka-metro.co.jp/` | connection failure (GAP) |
| JR西日本 | `https://www.westjr.co.jp/` (`/terms/`, `/site_policy/`: 404) | no terms page found |
| JR東日本 | `https://www.jreast.co.jp/` | **403** on 2026-10-25; no class assigned (OD-34 (1) ruling noted, §2.1) |
| 東京メトロ / アトレ品川 / ecute品川 | — | read 2026-10-24 (OD-34 (2), (3)); not re-read on 2026-10-25 |
| メトロプロパティーズ | `https://www.metro-pro.jp/terms/` | re-read 2026-10-25 (200), clause quoted |
