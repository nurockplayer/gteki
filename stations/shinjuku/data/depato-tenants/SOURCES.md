# Shinjuku department-store tenant sources

Fetched 2026-11-27 JST. Counts are TSV rows. Separate counters or departments count individually when the official directory lists them separately. The source date and any limits on the scope of a published count are given below.

The response tables record the default-User-Agent curl GET used for each URL. Replace `URL` with the linked URL or the full URL listed under the table. Redirect destinations were requested separately. HTTP status and size are for the response body before parsing. PDF text was extracted from the response stream.

```sh
curl -sS --max-time 20 -w '\n%{http_code}\t%{size_download}\t%{content_type}\t%{redirect_url}' 'URL'
```

## odakyu-shinjuku

The [department-store floor guide](https://www.odakyu-dept.co.jp/shinjuku/floorguide/) supplies floor labels and links to the brand directory for its sales areas. The [June 2026 JST shopping-card PDF](https://www.odakyu-dept.co.jp/tomonokai/da4d7d000000oof2-att/tomonokai_shop_list.pdf) names selected HALC tenants. The [2025-01-07 JST release](https://www.odakyu.jp/news/h3de7600000007sj-att/h3de7600000007sq.pdf) contains a floor-by-floor restaurant table and states that ハル★チカ had ten tenants across MB3 and B3.

| Floor | Rows | Coverage | Published count or reason |
| --- | ---: | --- | --- |
| R | 1 | complete | The overview names one rooftop tenant. |
| 8F | 4 | complete | The June 2026 JST PDF names four. The [Odakyu floor article](https://www.odakyu-life.jp/entry/006712.html) enumerates the same four, and the January 2025 JST table includes three and expressly excludes 叙々苑 from the promotion. なだ万's [own shop page](https://www.nadaman.co.jp/pages/restaurant_shinjuku/) describes 萬助 as a counter within the same listing. |
| 7F | 20 | partial | All 17 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%97%E9%9A%8E) plus three from the separate ビューティー＆サービス zone. The [membership page](https://www.odakyu-dept.co.jp/tomonokai/) names both salons and the dental office. The [dental office](https://www.aishikai.jp/) confirms 7F. The department-store guide provides no total for the HALC zone and the operator guide has the crawler restriction below. |
| 6F | 1 | complete | The overview names one building tenant. |
| 5F | 1 | complete | The overview names one building tenant. |
| 4F | 1 | complete | The overview names one building tenant. |
| 3F | 1 | complete | The overview names one building tenant. |
| 2F | 89 | complete | All 88 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%92%E9%9A%8E) plus ビックカメラ from the overview. |
| M2F | 10 | complete | All 10 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=M%EF%BC%92%E9%9A%8E). |
| 1F | 37 | partial | All 34 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%91%E9%9A%8E) plus three street-front shops named by Odakyu and confirmed by the [天兼 shop page](https://www.tenkane.tokyo/), [時屋 floor article](https://www.odakyu-life.jp/entry/006636.html) and [entrance notice](https://www.odakyu-dept.co.jp/info/v4l5d000001cquyy-att/20250917.pdf). The [青松園 shop page](https://www.seisyoen1947.jp/shop) prints its street address without a floor. The operator guide is needed for a current HALC-wide count. |
| B1F | 63 | complete | All 63 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%91%E9%9A%8E). |
| B2F | 42 | complete | All 41 [brand results](https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%92%E9%9A%8E), plus the one separate café named in both the June 2026 JST PDF and the January 2025 JST restaurant table. The current linked department-store map has no text layer. The older text map is dated 2015-03-11 JST. |
| MB3 | 8 | partial | All eight MB3 listings in Odakyu's January 2025 JST restaurant table. GAP for verification against the current operator directory. |
| B3 | 2 | partial | Both B3 listings in Odakyu's January 2025 JST restaurant table. GAP for verification against the current operator directory. |

The [operator guide](https://www.odakyu-sc.com/odakyu-halc/) is covered by the operator's crawler restriction. The June 2026 JST department-store PDF confirms the two basement floors by zone. The January 2025 JST roster is the latest floor-assigned tenant list found on an accessible Odakyu-owned site. The 2020 roster differs and was excluded from the TSV.

| Route | HTTP / bytes | Body evidence |
| --- | --- | --- |
| [Department-store floor guide](https://www.odakyu-dept.co.jp/shinjuku/floorguide/) | 200 / 24,186 | 8F, separate 7F zone, MB3 and B3 show zone names without shop links. Department-store 7F and B2F link to floor detail and brand search. |
| [7F detail](https://www.odakyu-dept.co.jp/shinjuku/floorguide/07/index.html), [B2F detail](https://www.odakyu-dept.co.jp/shinjuku/floorguide/b02/index.html), [shared script](https://www.odakyu-dept.co.jp/common_wr/js/functions.js) | 200 / 25,309; 200 / 24,642; 200 / 51,910 | The HTML links the brand directory. The script has no shop-list fetch or XHR. |
| [Services](https://www.odakyu-dept.co.jp/shinjuku/services/index.html), [operator portfolio](https://www.odakyu-scd.co.jp/works/) | 200 / 32,690; 200 / 42,517 | Both link to the restricted operator guide for HALC tenants. |
| [Operator robots.txt](https://www.odakyu-sc.com/robots.txt) | 200 / 1,249 | `Disallow: /` for GPTBot, ChatGPT-User and OAI-SearchBot. The guide itself was skipped under the crawler restriction. |
| [Department-store sitemap](https://www.odakyu-dept.co.jp/sitemap.xml), [operator's corporate sitemap](https://www.odakyu-scd.co.jp/sitemap.xml), [railway sitemap](https://www.odakyu.jp/sitemap.xml) | 200 / 91,402; 200 / 331; 200 / 469,754 | 469, 1 and 2,521 URLs respectively. The first links the department-store floors and maps. The second lists the corporate homepage. The third includes the three legacy HALC URLs below. |
| [Legacy HALC](https://www.odakyu.jp/terrace-city/guide/halc.html), [legacy HALC 2](https://www.odakyu.jp/terrace-city/guide/halc_2.html), [legacy HALC 3](https://www.odakyu.jp/terrace-city/guide/halc_3.html) | 404 / 13,162 each | The railway's missing-page notice says the URL may have changed. No replacement shop list in the body. |
| [Mobile attempt 1](https://www.odakyu-dept.co.jp/shinjuku/sp/floorguide/), [attempt 2](https://www.odakyu-dept.co.jp/sp/shinjuku/floorguide/), [attempt 3](https://www.odakyu-dept.co.jp/shinjuku/floorguide/sp/) | 403 / 8,980 each | The department-store response says the requested page does not exist. Its [robots.txt](https://www.odakyu-dept.co.jp/robots.txt) then confirmed `Disallow: /sp/` (200 / 80). |
| Brand search for [8F](http://sitesearch.odakyu-dept.co.jp/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%EF%BC%98%E9%9A%8E), [MB3](http://sitesearch.odakyu-dept.co.jp/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%E4%B8%AD%EF%BC%93%E9%9A%8E), [B3](http://sitesearch.odakyu-dept.co.jp/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%93%E9%9A%8E) | 200 / 13,520 each | Each department-store URL returned 301 with 0 bytes to the listed HTTP search URL. Search responses say no matching brands. |
| [B2F food category, page 2](http://sitesearch.odakyu-dept.co.jp/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97&floor=%E5%9C%B0%E4%B8%8B%EF%BC%92%E9%9A%8E&page=2&genre=%E9%A3%9F%E5%93%81) | 200 / 24,326 | Body prints `該当件数：41件` and the second page of brand results. |
| [7F map](https://www.odakyu-dept.co.jp/shinjuku/floorguide/07/v4l5d00000142khu-att/07.pdf), [B2F map](https://www.odakyu-dept.co.jp/shinjuku/floorguide/b02/v4l5d000001431hq-att/b02.pdf), [legacy B2F map](https://www.odakyu-dept.co.jp/shinjuku/floorguide/pdf/halc_b02.pdf) | 200 / 320,006; 200 / 286,066; 200 / 271,446 | The current maps return zero text lines each. The legacy map returns 25 lines and prints its March 2015 JST update date. |
| [June 2026 JST card PDF](https://www.odakyu-dept.co.jp/tomonokai/da4d7d000000omin-att/tomonokai_shop_list.pdf), [January 2025 JST restaurant PDF](https://www.odakyu.jp/news/h3de7600000007sj-att/h3de7600000007sq.pdf), [2020 JST restaurant PDF](https://www.odakyu.jp/news/o5oaa1000001u5l5-att/o5oaa1000001u5lc.pdf) | 200 / 86,854; 200 / 1,257,089; 200 / 715,926 | 32, 114 and 82 text lines. The card PDF labels itself a selection. The other two give different dated basement rosters. |
| [2026 group news](https://www.odakyu.jp/company/group/news/), [2025 group news](https://www.odakyu.jp/company/group/news/2025.html), [operator corporate news](https://www.odakyu-scd.co.jp/news/) | 200 / 64,958; 200 / 64,861; 200 / 188,848 | The January 2025 JST restaurant roster is linked from group news. The 2026 index and operator news provided no newer floor-assigned roster. |
| [Membership page](https://www.odakyu-dept.co.jp/tomonokai/), [bridal services](https://www.odakyu-dept.co.jp/bridal/kaiin/index.html), [dental office](https://www.aishikai.jp/), [青松園](https://www.seisyoen1947.jp/shop) | 200 / 25,481; 200 / 24,628; 200 / 19,408; 200 / 35,252 | Membership lists the 7F shops among the HALC tenants. The bridal page identifies the salons, and the dental office prints 7F. 青松園 gives only the street address. |

Manual spot-checks against live text covered M2F (all ten names and categories), B2F (first and last result pages, 41-brand count and the separately listed café), and the eight MB3 and two B3 rows in the dated Odakyu roster.

## keio-shinjuku

The [shop search](https://www.keionet.com/info/shinjuku/shop/) loads the [complete shop data](https://www.keionet.com/re2024/json/shop_shinjuku.json). The site's script filters category and kana locally. Each of the 598 unique entries appears once. The [floor index](https://www.keionet.com/info/shinjuku/floor/) supplies the full ＭＢ階 and Ｂ1階 labels and the 京王スカイガーデン rooftop zone. The JSON's リフレピア売場 label for its rooftop shop disagrees with the index, which puts リフレピア on 8階. The TSV uses the floor index's label there.

Categories use the printed subcategory, or the printed parent category when the subcategory is blank. Latin spellings come from the same listing or a matching name in [Popular Brands](https://www.keionet.com/info/shinjuku/foreign/en/), the [cosmetics directory](https://www.keionet.com/info/shinjuku/event/cosmetic_tel2009.html) or a linked shop guide. The English selection includes carried brands and some legacy names. The live Japanese directory and current individual shop guides determine which shops get rows.

| Floor | Directory count | TSV rows | Coverage |
| --- | ---: | ---: | --- |
| [屋上](https://www.keionet.com/info/shinjuku/floor/rooftop.html) | 1 | 2 | complete. The floor guide separately names 京王BBQガーデン, which was open through 2026-11-29 JST. |
| [8階](https://www.keionet.com/info/shinjuku/floor/08.html) | 32 | 32 | complete. Includes all 14 restaurants and the four 2026-11-26 JST openings. |
| [7階](https://www.keionet.com/info/shinjuku/floor/07.html) | 39 | 39 | complete |
| [6階](https://www.keionet.com/info/shinjuku/floor/06.html) | 75 | 75 | complete |
| [5階](https://www.keionet.com/info/shinjuku/floor/05.html) | 55 | 55 | complete |
| [4階](https://www.keionet.com/info/shinjuku/floor/04.html) | 85 | 85 | complete |
| [3階](https://www.keionet.com/info/shinjuku/floor/03.html) | 60 | 60 | complete |
| [2階](https://www.keionet.com/info/shinjuku/floor/02.html) | 51 | 51 | complete |
| [1階](https://www.keionet.com/info/shinjuku/floor/01.html) | 100 | 100 | complete |
| [ＭＢ階](https://www.keionet.com/info/shinjuku/floor/mb.html) | 86 | 86 | complete |
| [Ｂ1階](https://www.keionet.com/info/shinjuku/floor/b1.html) | 14 | 14 | complete |

| Route | HTTP / bytes | Body evidence |
| --- | --- | --- |
| [Desktop shop search](https://www.keionet.com/info/shinjuku/shop/), [search script](https://www.keionet.com/re2024/re2024_site.js) | 200 / 16,700; 200 / 5,615 | Widget declares `data-json="shop_shinjuku"`. Its script builds the URL with prefix `/re2024/json/` and filters the full array in memory. |
| [Shop JSON](https://www.keionet.com/re2024/json/shop_shinjuku.json), [floor/category/pagination probe](https://www.keionet.com/re2024/json/shop_shinjuku.json?floor=08&category=cat12&page=2) | 200 / 345,864 each | Identical SHA-256 `87cb3e862e9229e03d82c29bc015db051539c9ad1d53acc747117eeb9a8b1979`. The array contains 598 distinct IDs and the printed title, floor, category and salesfloor fields. |
| [Sitemap](https://www.keionet.com/sitemap.xml), [branch sitemap](https://www.keionet.com/info/shinjuku/sitemap.xml) | 200 / 88,373; 404 / 1,998 | Main XML lists 500 URLs, including shop search, floor guide, a floor-map PDF and legacy category paths. The branch URL returns Keio's missing-page notice. |
| Mobile shop and 8階 URLs listed below | 404 / 1,998 each | Keio HTML says the requested page could not be found. Desktop floor pages return HTTP 200 with floor headings and map images. |
| Legacy category paths listed below | 301 / 251 each | Redirect notice points to the desktop shop search. [index.html](https://www.keionet.com/info/shinjuku/shop/index.html) returns the same widget (200 / 16,700). [post-11.html](https://www.keionet.com/info/shinjuku/shop/post-11.html) returns the missing-page notice (404 / 1,998). |
| [Official English floor-map PDF](https://www.keionet.com/info/shinjuku/foreign/assets/pdf/floormap.pdf) | 200 / 8,571,184 | `pdftotext -layout` extracts 15 nonblank lines, mostly floor labels and isolated names such as Ginza Aster. |
| [Dining list](https://www.keionet.com/info/shinjuku/gourmet/), [VANSAN](https://www.keionet.com/info/shinjuku/gourmet/033320.html), [HARMONY](https://www.keionet.com/info/shinjuku/topics/000425.html), [BBQ guide](https://www.keionet.com/info/shinjuku/event/bbq2026.html), [renewal PDF](https://www.keionet.com/corp/pressrelease/cms_img/20261116_keionewsrelease_shinjyuku-renewal.pdf) | 200 / 22,602; 200 / 18,677; 200 / 54,471; 200 / 44,738; 200 / 1,018,716 | Dining and shop guides identify their floor and exact names. The renewal PDF names four new 8階 shops, all in the JSON. |

The six mobile probes used these complete URLs.

```text
https://www.keionet.com/info/shinjuku/sp/shop/
https://www.keionet.com/sp/info/shinjuku/shop/
https://www.keionet.com/info/shinjuku/shop/sp/
https://www.keionet.com/info/shinjuku/sp/floor/08.html
https://www.keionet.com/sp/info/shinjuku/floor/08.html
https://www.keionet.com/info/shinjuku/floor/sp/08.html
```

The legacy category requests used `https://www.keionet.com/info/shinjuku/shop/shop_search/` followed by each of `cosme.html`, `ladies-goods.html`, `ladies.html`, `mens.html`, `baby.html`, `household.html` and `others.html`.

Manual spot-checks against live text covered 屋上 (the garden shop and separately published BBQ venue), 8階 (all 14 dining names and categories and all four November openings), and Ｂ1階 (the floor guide label and all 14 names from the shop-search response).
