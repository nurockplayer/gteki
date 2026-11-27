# Shinjuku department-store tenant sources

Collected on 2026-11-27 JST. Where a floor guide shows tenant cards, counts compare TSV rows with the published cards. Each TSV row cites the official feed or page used for verification. The Takashimaya category field appends `[kind=shop]` for a shop, service counter, restaurant or named rooftop venue and `[kind=brand]` for a Brand Search or stocked-brand placement. Floor labels and categories come from the displayed lists. The Latin field repeats a Latin-only display name when the guide prints it. Empty categories and positions mean the list leaves those fields blank.

## Shinjuku Marui Main — `shinjuku-marui-main`

- **Complete** for the shop guide, 63 rows. B1F 4/4, 1F 10/10, 2F 12/12, 3F 1/1, 4F 1/1, 5F 17/17, 6F 5/5, 7F 8/8, 8F 5/5. The facility guide identifies RF as the Q-COURT rooftop garden and provides no tenant list. [Floor guide](https://www.0101.co.jp/003/info/?floor=B1F) · [Floor feed](https://www.0101.co.jp/contents2/floormap/003/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/003/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/003/shop_list.json) · [Facility guide](https://www.0101.co.jp/003/facility/index.html) · [Facility feed](https://www.0101.co.jp/contents2/facilityinfo/003/facility.json).
- Live spot check on 2026-11-27 JST matched all four B1F shop names and their displayed categories. [B1F](https://www.0101.co.jp/003/info/?floor=B1F).

## Shinjuku Marui Annex — `shinjuku-marui-annex`

- **Complete** for the shop guide, 57 rows. B1F 1/1, 1F 8/8, 2F 8/8, 3F 11/11, 4F 6/6, 5F 1/1, 6F 1/1, 7F 14/14, 8F 7/7. The 6F guide displays one named shop card. [Floor guide](https://www.0101.co.jp/005/info/) · [Floor feed](https://www.0101.co.jp/contents2/floormap/005/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/005/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/005/shop_list.json).
- Live spot check on 2026-11-27 JST matched all eight 1F shop names and their displayed categories. [1F](https://www.0101.co.jp/005/info/?floor=1F).

## Shinjuku Marui Men — `shinjuku-marui-men`

- **Complete** for the shop guide, 38 rows. Counts match the live cards on 1F 3/3, 2F 4/4, 3F 8/8, 4F 9/9, 5F 5/5, 6F 5/5, 7F 2/2, 8F 2/2. The approved TSV filename reserves the ID for the import step. [Floor guide](https://www.0101.co.jp/074/info/) · [Floor feed](https://www.0101.co.jp/contents2/floormap/074/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/074/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/074/shop_list.json).
- Live spot check on 2026-11-27 JST matched all five 5F shop names and their displayed categories, including ムッシュニコル キャナルドゥ　コンセプトストア and メンズ　メルローズ. [5F](https://www.0101.co.jp/074/info/?floor=5F).

## Shinjuku Takashimaya department store — `takashimaya-shinjuku`

Ego-lite read the Japanese floor guide, all 12 shopping-floor pages, the 16 linked detail pages, and the browser's network responses on 2026-11-27 JST. Each floor's `/front/api/floor/` response supplies a PNG path and hotspot links. `front_floor.php` supplies the layout. `front_xml.php` supplies floor summaries and topics. The full map's shop-name labels are part of its PNG, with no roster or published floor-wide count in these responses. Each GAP link below identifies that floor's image. Text coverage includes the floor-specific links and the separate official Brand Search. The [main floor guide](https://www.takashimaya.co.jp/shinjuku/floor/) and [access guide](https://www.takashimaya.co.jp/shinjuku/access/) identify 地下2階 and 地下3階 as parking.

The [official Brand Search](https://www.takashimaya.co.jp/brandsearch/?sid=2), scoped to Shinjuku, displays all its entries across 37 initial filters and 104 result pages. The 1,683 cards matched the sum of those result counts and resolve to 839 distinct cards after removing repeated cards across filters. The table's Detail names counts listed names before merging repeated placements and excludes placeholders such as ほか. Multiple categories for the same Brand Search placement are kept together. Linked details and the size guide contribute further text placements. A named salon or counter and the brands stocked there have their respective kind markers. Text lists give 83 shops and 1089 brand placements across these floors. All 64 earlier verified department-store rows are retained.

| Floor and rendered route | Checked | Distinct Brand Search cards | Detail names | Shop rows | Brand rows | Total TSV | Supplemental text routes | Full floor map labels |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| [地下1階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_b1.html) | 2026-11-27 JST | 153 | 34 | 15 | 179 | 194 | [detail 01](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_b1/detail_01.html), [food counters](https://www.takashimaya.co.jp/shinjuku/information/food.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/61792390409.png) |
| [1階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_01.html) | 2026-11-27 JST | 50 | 0 | 7 | 50 | 57 | Brand Search | [GAP](https://www.takashimaya.co.jp/front/img/floor/61792390560.png) |
| [2階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_02.html) | 2026-11-27 JST | 120 | 51 | 6 | 146 | 152 | [detail 01](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_02/detail_01.html), [detail 03](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_02/detail_03.html), [detail 02](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_02/detail_02.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/61793321559.png) |
| [3階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_03.html) | 2026-11-27 JST | 17 | 0 | 3 | 17 | 20 | [café](https://www.takashimaya.co.jp/shinjuku/cafe/) | [GAP](https://www.takashimaya.co.jp/front/img/floor/69261764142031.png) |
| [4階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_04.html) | 2026-11-27 JST | 123 | 151 | 7 | 224 | 231 | [detail 01](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_04/detail_01.html), [detail 02](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_04/detail_02.html), [detail 03](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_04/detail_03.html), [café](https://www.takashimaya.co.jp/shinjuku/cafe/), [size guide](https://www.takashimaya.co.jp/shinjuku/shop/brand/size.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/61794190234.png) |
| [5階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_05.html) | 2026-11-27 JST | 69 | 17 | 4 | 82 | 86 | [detail 01](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_05/detail_01.html), [café](https://www.takashimaya.co.jp/shinjuku/cafe/), [size guide](https://www.takashimaya.co.jp/shinjuku/shop/brand/size.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/691777251662.png) |
| [6階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_06.html) | 2026-11-27 JST | 61 | 0 | 6 | 65 | 71 | [café](https://www.takashimaya.co.jp/shinjuku/cafe/), [size guide](https://www.takashimaya.co.jp/shinjuku/shop/brand/size.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/681756428535.png) |
| [7階](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_07.html) | 2026-11-27 JST | 54 | 17 | 6 | 58 | 64 | [detail 01](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_07/detail_01.html), [café](https://www.takashimaya.co.jp/shinjuku/cafe/), [size guide](https://www.takashimaya.co.jp/shinjuku/shop/brand/size.html) | [GAP](https://www.takashimaya.co.jp/front/img/floor/691778235486.png) |
... (+24 lines) [see remaining: rtk proxy git show :3:stations/shinjuku/data/depato-tenants/SOURCES.md | tail -n +36]

## Isetan Shinjuku tenant sources

Fetched 2026-11-27 JST. **Complete** means every named placement on Isetan's public shop and restaurant lists is represented. The floor guides supply a second check, and the rooftop guides name the rooftop venues. The `category` column retains the printed category and appends `[kind=shop]` for a shop, sales or service space, restaurant, or named rooftop venue. `[kind=brand]` identifies a row sourced from a stocked-brand listing. Brand Search aliases, including shorter restaurant names, remain in the brand rows. Where a restaurant alias matched its listed storefront, the shop row uses the Latin name printed by Brand Search.

### isetan-shinjuku-main

The [Japanese Main Building floor guide](https://www.mistore.jp/store/shinjuku/shops.html), [building-filtered shop list](https://www.mistore.jp/store/shinjuku/shop_search.html?category_search%5B%5D=all&place_search%5B%5D=main_building), and [restaurant list](https://www.mistore.jp/store/shinjuku/restaurant_search.html?genre_search%5B%5D=all&place_search%5B%5D=all) supply named listings. The shop list shows 51 cards and 52 placements, since the cosmetics and fragrance card lists both 1F and 2F. The restaurant list shows 32 cards across Isetan Shinjuku. It contains 29 Main Building placements, one Men's Building placement, one parking building restaurant and one Park City 3 restaurant. The last two are outside the requested buildings. The [global floor guide](https://cp.mistore.jp/global/en/shinjuku.html) and [floor data](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-floor.json) identify the RF roof garden.

The [Brand Search](https://cp.mistore.jp/global/en/shinjuku/brand.html) loads the [brand CSV](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-brand.csv) with its stated sales zones. The starting brand export contains 262 1F records, including one expired and one future record, omitted as of the fetch date. ザ・コンランショップ was already in the 5F export. Its original row is marked as a shop because Isetan also lists that exact name as a 5F space.

| Floor | Floor-guide cards | Shop list placements | Restaurant placements | Roof venue | Shop rows | Brand rows | Total TSV | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| [B2F](https://www.mistore.jp/store/shinjuku/shops/mainfloorB2.html) | 2 | 1 | 1 | 0 | 2 | 63 | 65 | complete |
| [B1F](https://www.mistore.jp/store/shinjuku/shops/mainfloorB1.html) | 17 | 10 | 7 | 0 | 17 | 181 | 198 | complete |
| [1F](https://www.mistore.jp/store/shinjuku/shops/mainfloor1.html) | 4 | 4 | 0 | 0 | 4 | 260 | 264 | complete |
| [2F](https://www.mistore.jp/store/shinjuku/shops/mainfloor2.html) | 8 | 6 | 2 | 0 | 8 | 110 | 118 | complete |
| [3F](https://www.mistore.jp/store/shinjuku/shops/mainfloor3.html) | 7 | 6 | 1 | 0 | 7 | 108 | 115 | complete |
| [4F](https://www.mistore.jp/store/shinjuku/shops/mainfloor4.html) | 2 | 2 | 0 | 0 | 2 | 36 | 38 | complete |
| [5F](https://www.mistore.jp/store/shinjuku/shops/mainfloor5.html) | 7 | 7 | 0 | 0 | 7 | 231 | 238 | complete |
| [6F](https://www.mistore.jp/store/shinjuku/shops/mainfloor6.html) | 14 | 12 | 2 | 0 | 14 | 156 | 170 | complete |
| [7F](https://www.mistore.jp/store/shinjuku/shops/mainfloor7.html) | 6 | 4 | 16 | 0 | 20 | 43 | 63 | complete |
| [RF](https://cp.mistore.jp/global/en/shinjuku.html) | 1 | 0 | 0 | 1 | 1 | 0 | 1 | complete |
| **Total** | | **52** | **29** | **1** | **82** | **1,188** | **1,270** | |

On 7F, the floor guide has four named shop cards, a collective `レストラン＆カフェ` card for the 16 named restaurants in `イートパラダイス`, and an `屋上/アイ・ガーデン` card for the RF garden. The landing page refers to the garden and stage together. It publishes no separate stage shop.

### isetan-shinjuku-mens

The [Japanese Men's Building floor guide](https://www.mistore.jp/store/shinjuku/shops_mens.html), [building-filtered shop list](https://www.mistore.jp/store/shinjuku/shop_search.html?category_search%5B%5D=all&place_search%5B%5D=mens_building), and [restaurant list](https://www.mistore.jp/store/shinjuku/restaurant_search.html?genre_search%5B%5D=all&place_search%5B%5D=all) supply the listings. The shop list shows 14 cards and 15 placements, since the designers card lists 2F and 3F. The 8F guide links to the golf school, and the [global floor guide](https://cp.mistore.jp/global/en/shinjuku.html) and [ISETAN MEN'S net guide](https://www.imn.jp/floorguide) identify the rooftop golf school. The golf school's own Shinjuku page specifies an 8F front desk and a rooftop range. The TSV records both placements. [Shinjuku golf school](https://www.isetan-swing.co.jp/shinjuku/shinjuku/)

The [Brand Search](https://cp.mistore.jp/global/en/shinjuku/brand.html), [brand CSV](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-brand.csv), [floor data](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-floor.json), and [ISETAN MEN'S net index](https://www.imn.jp/brand/floor) supply the brand listings. The index shows 181/138/13/12/14/123/67/21/33 labels on B1F through 8F. The starting TSV omits explicitly online-only index listings, one expired B1F CSV record, and two index entries annotated for a 1F promotion. The regular AMIRI and Rick Owens floor placements remain sourced to Brand Search.

| Floor | Floor-guide cards | Shop list placements | Restaurant placements | Roof venue | Shop rows | Brand rows | Total TSV | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| [B1F](https://www.mistore.jp/store/shinjuku/shops/mensfloorB1.html) | 3 | 3 | 0 | 0 | 3 | 221 | 224 | complete |
| [1F](https://www.mistore.jp/store/shinjuku/shops/mensfloor1.html) | 3 | 3 | 0 | 0 | 3 | 189 | 192 | complete |
| [2F](https://www.mistore.jp/store/shinjuku/shops/mensfloor2.html) | 1 | 1 | 0 | 0 | 1 | 14 | 15 | complete |
| [3F](https://www.mistore.jp/store/shinjuku/shops/mensfloor3.html) | 1 | 1 | 0 | 0 | 1 | 16 | 17 | complete |
| [4F](https://www.mistore.jp/store/shinjuku/shops/mensfloor4.html) | 1 | 1 | 0 | 0 | 1 | 15 | 16 | complete |
| [5F](https://www.mistore.jp/store/shinjuku/shops/mensfloor5.html) | 2 | 2 | 0 | 0 | 2 | 133 | 135 | complete |
| [6F](https://www.mistore.jp/store/shinjuku/shops/mensfloor6.html) | 1 | 1 | 0 | 0 | 1 | 71 | 72 | complete |
| [7F](https://www.mistore.jp/store/shinjuku/shops/mensfloor7.html) | 1 | 1 | 0 | 0 | 1 | 23 | 24 | complete |
| [8F](https://www.mistore.jp/store/shinjuku/shops/mensfloor8.html) | 3 | 2 | 1 | 0 | 3 | 37 | 40 | complete |
| [RF](https://www.imn.jp/floorguide) | 1 | 0 | 0 | 1 | 1 | 0 | 1 | complete |
| **Total** | | **15** | **1** | **1** | **17** | **719** | **736** | |

### Live comparison

On 2026-11-27 JST, visually checked Main B1F (17 cards, including グランアルチザン and フードコレクション), Main 7F (four named shops, the restaurant group and the rooftop link), and Men's 8F (レジデンス, スイング and リジーグ). Compared every indoor floor's rendered card names and link paths with the building-filtered shop results and the restaurant results. All agreed after expanding the 7F restaurant group and assigning the roof garden to RF. The separate Men's index spot checks covered 2F, 3F and 8F by floor anchor.

### Fetch evidence

Default-user-agent curl ran serially, at least one second between requests. The exact commands, JST timestamps, curl exit codes, HTTP codes, byte counts, redirects, and short body text or signatures are in `/private/tmp/gteki-1630/curl-receipts.jsonl`. The 60-second desktop retry is in `/private/tmp/gteki-1630/mistore-retry.txt`. No website HTML, images, or floor plans are in the repository.

```sh
curl -q --http1.1 --max-time 60 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{redirect_url}' https://www.mistore.jp/store/shinjuku/shops.html
curl -q --http1.1 --max-time 60 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/sp/store/shinjuku/shops.html
... (+14 lines) [see remaining: rtk proxy git show :2:stations/shinjuku/data/depato-tenants/SOURCES.md | tail -n +58]
