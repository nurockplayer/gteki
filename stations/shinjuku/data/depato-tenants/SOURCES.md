# Isetan Shinjuku tenant sources

Fetched 2026-11-27 JST. **Complete** means every named placement on Isetan's public shop and restaurant lists is represented. The floor guides supply a second check, and the rooftop guides name the rooftop venues. The `category` column retains the printed category and appends `[kind=shop]` for a shop, sales or service space, restaurant, or named rooftop venue. `[kind=brand]` identifies a row sourced from a stocked-brand listing. Brand Search aliases, including shorter restaurant names, remain in the brand rows. Where a restaurant alias matched its listed storefront, the shop row uses the Latin name printed by Brand Search.

## isetan-shinjuku-main

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

## isetan-shinjuku-mens

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

## Live comparison

On 2026-11-27 JST, visually checked Main B1F (17 cards, including グランアルチザン and フードコレクション), Main 7F (four named shops, the restaurant group and the rooftop link), and Men's 8F (レジデンス, スイング and リジーグ). Compared every indoor floor's rendered card names and link paths with the building-filtered shop results and the restaurant results. All agreed after expanding the 7F restaurant group and assigning the roof garden to RF. The separate Men's index spot checks covered 2F, 3F and 8F by floor anchor.

## Fetch evidence

Default-user-agent curl ran serially, at least one second between requests. The exact commands, JST timestamps, curl exit codes, HTTP codes, byte counts, redirects, and short body text or signatures are in `/private/tmp/gteki-1630/curl-receipts.jsonl`. The 60-second desktop retry is in `/private/tmp/gteki-1630/mistore-retry.txt`. No website HTML, images, or floor plans are in the repository.

```sh
curl -q --http1.1 --max-time 60 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{redirect_url}' https://www.mistore.jp/store/shinjuku/shops.html
curl -q --http1.1 --max-time 60 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/sp/store/shinjuku/shops.html
curl -q --http1.1 --max-time 9 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/sitemap.xml
curl -q --http1.1 --max-time 10 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/store/shinjuku/shop_search/shops.json
curl -q --http1.1 --max-time 10 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/store/shinjuku/restaurant_search/restaurants.json
curl -q --http1.1 --max-time 8 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' 'https://www.mistore.jp/store/shinjuku/shop_search.html?category_search%5B%5D=food&place_search%5B%5D=main_building'
curl -q --http1.1 --max-time 4 -sS -w '\n@@@ %{http_code}\t%{size_download}\t%{content_type}\t%{remote_ip}\t%{redirect_url}' https://www.mistore.jp/store/shinjuku/shops/restaurant/rejiig.html
```

- All seven commands above returned exit 28, HTTP `000` (no response), and a zero-byte empty body. The Men's desktop guide, `/sp/store/shinjuku/`, `/store/shinjuku/sp/` and `/sp/shinjuku/` for both buildings, all 18 indoor floor paths, both building filters, exact browser cache-busted XHR URLs, and sampled per-shop pages gave the same result. The 60-second desktop command timed out at 60,003 ms. A second curl installation and Linux curl also returned exit 28 on the shop feed.
- Curl fetched the [directory's own JS](https://cp.mistore.jp/content/dam/isetan/isetan_mistore_jp/shinjuku/js/search.js) with HTTP 200 and 17,097 bytes. It requests `shop_search/shops.json` and `restaurant_search/restaurants.json`, then filters the full returned arrays by category and building and renders every match. A live Main Building food-category query showed 11 matches from the same 82,669-byte shop JSON. These lists use client-side filters over the whole feed. The [Isetan site search](https://sitesearch.mistore.jp/) does paginate. Curl tried name, floor/category, and `page=2` and `page=3` queries on that site and corroborated 82 of 95 in-scope directory cards by title. Search also returns event announcements and can abbreviate shop titles. It supplied no floor-level denominator.
- Curl fetched the [CP sitemap](https://cp.mistore.jp/sitemap.xml) with HTTP 200 and 990,204 bytes, an XML URL set with 5,766 entries. The [Men's sitemap](https://www.imn.jp/sitemap.xml) returned HTTP 200 and 3,354 bytes, an XML index with 28 child sitemaps. Its [pages child](https://www.imn.jp/sitemap/pages.xml) returned HTTP 200 and 2,193 bytes and lists the floor guide and brand index. The legacy Isetan shop JSON URL returned HTTP 301 and a 375-byte “Moved Permanently” body pointing to the Japanese shop JSON above. The CP host's attempted shop search and JSON page paths returned HTTP 404 and a 300-byte “The requested URL was not found on this server” body.
- Curl fetched the dated [official floor directory PDF](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/shinjuku_degi/others/pdf/shopping_guide.pdf) with HTTP 200 and 2,393,915 bytes beginning `%PDF-1.7`. `pdftotext -layout` extracted 89,041 characters of selectable text, including labels for both buildings, the RF facilities, and floor-map tenant labels. The guide is marked September 2023. Current counts come from the live directories. The PDF and text are temporary files in `/private/tmp/gteki-1630/`.
- The public Japanese pages opened normally in Ego-lite. The directory XHRs returned HTTP 200 and decoded JSON sizes of 82,669 bytes for shops and 38,919 bytes for restaurants. The floor pages returned HTTP 200 and displayed the names and categories in text. All 95 linked in-scope detail pages opened with HTTP 200, including the golf school's official site after redirect. The detail pages identify shop areas and can include separate `BRAND LIST` sections for stocked labels. The `/sp/store/shinjuku/` and `/sp/shinjuku/` guide paths redirected to the desktop guides for both buildings. The `/store/shinjuku/sp/shops.html` path displayed `ご指定のページは見つかりません。` (HTTP 200, 6,762 decoded bytes). The Japanese sitemap displayed the same message with HTTP 404 and 11,096 decoded bytes. The current shop counts and exact placements come from the browser checks, with independent curl evidence from the official site search, floor data, brand sources and the [I'm Green detail page](https://www.isetan.mistore.jp/common/service/imgreen.html). Curl also fetched the golf school's branch page with HTTP 200 and 57,070 bytes, with the location text `メンズ館8Fフロント(屋上レンジ)`. No required shop list was available solely as map pixels.

The temporary browser receipts `main-directory-check.json`, `mens-directory-check.json`, `restaurants-directory-check.json`, `live-floor-facts.jsonl`, and `live-per-shop.jsonl` contain the published names, link paths, and response sizes used for comparison.
