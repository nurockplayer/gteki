# Shinjuku department-store tenant sources

Fetched 2026-11-27 JST. Counts are TSV rows, including distinct brand-directory entries that share a shop name. A floor with no verified listings has zero rows and an unknown total.

## odakyu-shinjuku

[Shinjuku floor guide](https://www.odakyu-dept.co.jp/shinjuku/floorguide/) supplies the floor labels. The linked ブランド一覧 pages report totals for the Odakyu sales areas. Their links redirect to the public HTTP brand directory. The [shopping-card shop list](https://www.odakyu-dept.co.jp/tomonokai/da4d7d000000oof2-att/tomonokai_shop_list.pdf) is a text list of selected stores. It identifies additional HALC tenants on 8F, 7F and B2F.

| Floor | Rows | Coverage | Count or gap |
| --- | ---: | --- | --- |
| R | 1 | complete | The overview names one rooftop tenant. |
| 8F | 4 | partial | Four restaurant names in the selected-store text list. The overview names the restaurant zone and gives no floor total. |
| 7F | 19 | partial | All 17 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%97%E9%9A%8E), plus two named tenants in ビューティー＆サービス. The separate zone has no published total in the accessible text. |
| 6F | 1 | complete | The overview names one building tenant. |
| 5F | 1 | complete | The overview names one building tenant. |
| 4F | 1 | complete | The overview names one building tenant. |
| 3F | 1 | complete | The overview names one building tenant. |
| 2F | 89 | complete | All 88 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%92%E9%9A%8E), plus ビックカメラ, which the overview lists separately. |
| M2F | 10 | complete | All 10 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=M%EF%BC%92%E9%9A%8E). |
| 1F | 34 | complete | All 34 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%91%E9%9A%8E). |
| B1F | 63 | complete | All 63 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%91%E9%9A%8E). |
| B2F | 42 | partial | All 41 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%92%E9%9A%8E), plus one HALC tenant in the selected-store text list. No combined floor total is published. |
| MB3 | 0 | unknown | GAP. The overview names 食堂酒場 ハル★チカ. The operator's public shop preview gives no floor assignments. |
| B3 | 0 | unknown | GAP. The overview names 食堂酒場 ハル★チカ. The operator's public shop preview gives no floor assignments. |

HALC GAP URLs are the [operator guide](https://www.odakyu-sc.com/odakyu-halc/) ([crawler restriction](https://www.odakyu-sc.com/robots.txt)) and the [operator's ハル★チカ shop preview](https://page.line.me/261wxnkc/showcase/564223458528010) (four names without floor labels, source rights UNKNOWN). The standalone [HTTPS brand endpoint](https://sitesearch.odakyu-dept.co.jp/brand/result/) gave curl exit 60 for a certificate hostname mismatch. The floor-guide-linked brand pages resolved through the ordinary site redirect.

Manual spot-checks against live text: M2F matched all ten names and categories. B2F matched the first and last result pages and the published 41-brand total.

## keio-shinjuku

The [floor index](https://www.keionet.com/info/shinjuku/floor/) links eleven specific floors. Each displays its floor map as an image. The [shop-search page](https://www.keionet.com/info/shinjuku/shop/) returns filter controls without tenant results in curl (GAP). The TSV uses the [restaurants and cafés](https://www.keionet.com/info/shinjuku/gourmet/), the [cosmetics directory](https://www.keionet.com/info/shinjuku/event/cosmetic_tel2009.html), the [women's apparel list](https://www.keionet.com/info/shinjuku/topics/001539.html), the [golf shop guide](https://www.keionet.com/info/shinjuku/topics/001685.html), floor-linked shop guides and the official [Popular Brands](https://www.keionet.com/info/shinjuku/foreign/en/) selection. A name from Popular Brands needs one unambiguous floor.

| Floor | Rows | Coverage | Count or gap |
| --- | ---: | --- | --- |
| [屋上](https://www.keionet.com/info/shinjuku/floor/rooftop.html) | 1 | partial | Named rooftop BBQ listing. Image-only floor map, no floor total in text. |
| [8階](https://www.keionet.com/info/shinjuku/floor/08.html) | 19 | partial | All 14 dining entries plus five listings from other directories. Image-only floor map, no combined floor total in text. |
| [7階](https://www.keionet.com/info/shinjuku/floor/07.html) | 13 | partial | Named shop guides and Popular Brands. Image-only floor map, no floor total in text. |
| [6階](https://www.keionet.com/info/shinjuku/floor/06.html) | 17 | partial | Named floor listings, Popular Brands and four cosmetics-directory entries. Image-only floor map, no floor total in text. |
| [5階](https://www.keionet.com/info/shinjuku/floor/05.html) | 27 | partial | Named shop guides, golf listings and Popular Brands. Image-only floor map, no floor total in text. |
| [4階](https://www.keionet.com/info/shinjuku/floor/04.html) | 22 | partial | Café, apparel, cosmetics, named shop guides and Popular Brands. Image-only floor map, no floor total in text. |
| [3階](https://www.keionet.com/info/shinjuku/floor/03.html) | 18 | partial | Café, apparel, named shop guides and Popular Brands. Image-only floor map, no floor total in text. |
| [2階](https://www.keionet.com/info/shinjuku/floor/02.html) | 19 | partial | Café, apparel, cosmetics, named shop guides and Popular Brands. Image-only floor map, no floor total in text. |
| [1階](https://www.keionet.com/info/shinjuku/floor/01.html) | 41 | partial | 34 cosmetics-directory entries plus named shop guides and Popular Brands. Image-only floor map, no combined floor total in text. |
| [ＭＢ階](https://www.keionet.com/info/shinjuku/floor/mb.html) | 15 | partial | Popular Brands names 15 here. Image-only floor map, no floor total in text. |
| [Ｂ1階](https://www.keionet.com/info/shinjuku/floor/b1.html) | 3 | partial | Café and Popular Brands. Image-only floor map, no floor total in text. |

Manual spot-check against the live Keio dining text: 8階 matched all 14 restaurant names and their categories.
