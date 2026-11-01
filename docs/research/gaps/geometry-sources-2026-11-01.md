# Geometry sources for the unmodelled station areas (desk search, 2026-11-01)

Coverage matrix next action 5 ([`../coverage-matrix.md`](../coverage-matrix.md)), assigned to the data lead by the director on 2026-11-01 JST. Question: is there a public **geometry** source (shapes or a network with coordinates, not facts-only text) for:

- **A**: 池袋 Tokyo Metro 副都心線 F09, Echika池袋 and the C exits (absent from PLATEAU 13116 `ubld`);
- **B**: 池袋 paid areas and platforms (JR, 東武東上線, 西武池袋線, M25, Y09);
- **C**: 新宿 paid areas and platforms (JR, 小田急, 京王, 京王新線, 都営新宿線 S01, M08).

Method: one oracle-ego search (ChatGPT draft, 2026-11-01 11:31 JST, run `20261101-113124-16719-geo5`); each lead it raised was then re-checked with plain `curl` (default User-Agent, no login, 2026-11-01 11:39–11:41 JST) or against files already in the repo. Only re-checked results are stated as facts below. No resource file was downloaded except the already-acquired 池袋 walk network, which was re-read to count floors.

## Result by gap

| Gap | Result | Basis |
|---|---|---|
| A (F09 / Echika / C exits) | **None found.** | See rows 1, 4 and 5 below. |
| B (池袋 paid areas, platforms) | **JR only, under a restricted licence (row 2). Others: none found.** | Rows 2, 4 |
| C (新宿 paid areas, platforms) | **JR only, under the same restricted licence (row 3). Others: none found** beyond the S03 data already held. | Rows 3, 6 |

## Leads checked

| # | Source | What was checked | Result |
|---|---|---|---|
| 1 | MLIT ほこナビDP 「歩行空間ネットワークデータ（池袋駅周辺）」, `nwd_ikebukuro` (already acquired: `docs/gis/networks/hokonavi-ikebukuro-walk-node-geojson.md`, node.geojson sha256 `4960a88b…`) | Re-downloaded 2026-11-01 11:4x JST (same sha256); counted the `floor` attribute | Street network: 1,852 of 1,887 nodes are `floor 0`; 20 are below ground (`-0.5` ×8, `-1.0` ×12), all within lon 139.7094–139.7114. No F09, Echika or paid-area coverage. |
| 2 | ODPT 「歩行空間ネットワークデータ（JR東日本 池袋駅）」, `https://ckan.odpt.org/dataset/jrc_nwd_ikebukuro` | HTML catalogue page, HTTP 200 | 「最終更新日: 2026/10/26」. Resources: network CSV / GeoJSON ZIP, 「構内地図データ（JR東日本 池袋駅）」 GeoJSON / Shapefile ZIP. Licence printed: 「公共交通オープンデータチャレンジ限定ライセンス / Public Transport Open Data Challenge Limited License」 (`odpt-ptodcll`, terms at `https://developer.odpt.org/challenge_license`). Notes: 「「公共交通オープンデータチャレンジ限定ライセンス」およびその特定利用条件をよく読んで、ご利用ください。」 Not downloaded. |
| 3 | ODPT 「歩行空間ネットワークデータ（JR東日本 新宿駅）」, `https://ckan.odpt.org/dataset/jrc_nwd_shinjuku` | Same | Same date, licence, notes sentence and four resource types. Not downloaded. |
| 4 | MLIT 高精度測位社会プロジェクト 令和元年度成果 (池袋駅 階層別屋内電子地図, NTTデータ, from ゼンリン / JR東日本コンサルタンツ maps) | ChatGPT draft only | Not re-checked. Even as drafted, no public download is named; the result went to a past 公共交通オープンデータチャレンジ. Not a usable source. |
| 5 | PLATEAU 豊島区 / 新宿区 2025 editions (`ubld` LOD4.1) | Repo | Already the vintage in use (`stations/ikebukuro/pipeline/fetch_sources.sh`, `13116_toshima-ku_pref_2025`); F09/Echika absence (G0) stands. |
| 6 | 東京都都市整備局 「新宿駅周辺の施設情報等の更新について」 (2023-02-28 S03 update, spec 令和５年２月改訂版) | Site top, sitemap, site search (屋内測位, 新宿ターミナル), three guessed URLs | **Not found** (no page; guessed URLs 404). Unconfirmed ChatGPT claim; not recorded as a source. |
| 7 | ほこナビDP 「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」 2026-09-17 with 構内地図, limited publication to 2027-03-12 | CKAN `package_search` (大江戸線, 新宿, 構内地図) | **Not in the public index** (count 0; the index holds 43 records). Unconfirmed. The E-27 network and station map the station is built from are already acquired (`docs/gis/networks/hokonavi-oedo-shinjuku-*`). |

Also excluded: the 豊島区 池袋駅地下空間案内図 2022 is a PDF diagram, not coordinate geometry. It stays `REFERENCE_ONLY`, used to identify named elements only.

## What follows

- **Gap A stays a GAP.** F09 and Echika can only come from on-site observation (field items 4, 5, V2) plus greybox built from facts. No desk source can be cited.
- **JR (rows 2–3): GAP by director ruling (2026-11-02 04:2x JST).** The licence is limited to participants in 公共交通オープンデータチャレンジ. GTEki does not enter the challenge and does not acquire the files. They are used in neither the public tier nor the private tier. JR paid areas and platforms at both stations stay a GAP. This is reopened only if the Owner later decides to register for the challenge; that decision belongs to the Owner.
- **Other operators' paid areas and platforms (東武, 西武, Metro, 小田急, 京王, 都営新宿線): no source.** They stay search-only in the public tier.
