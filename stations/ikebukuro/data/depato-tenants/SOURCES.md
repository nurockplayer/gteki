# Department-store tenant sources

## Tobu Ikebukuro (`tobu-ikebukuro`)

Fetched 2026-11-27 JST with sequential curl requests using curl's default User-Agent. The mobile shop guide supplies the printed shop names, category tags and position text. The desktop floor map lists the same cards, checked by shop ID, printed name and position.

The `name_latin` column contains 832 printed names. It uses the floor heading when it is written in Latin script, otherwise the Latin name printed on the page linked from that card, such as [Din Tai Fung](https://www.tobu-dept.jp/sp/ikebukuro/shop/115441201) or [HANA 3 TERRACE](https://www.tobu-dept.jp/ikebukuro/event/detail/7969). Blank values indicate that these sources supplied no Latin-script shop name in text. The [6F Rolex listing](https://www.tobu-dept.jp/sp/ikebukuro/shop/108959401) redirects to [Tobu's Rolex page](https://www.tobu-dept.jp/ikebukuro/tnb/shop/rolex/shop_rolex.html), which prints the boutique name in Japanese.

Tobu's displayed total is the number of `.list li` cards already in the page HTML. Its [pagination script](https://www.tobu-dept.jp/ikebukuro/search/js/search.js) sets that total and shows 20 cards at a time. Counts below include named services and event spaces when Tobu includes them in the directory.

| Floor | TSV rows | Official cards | Coverage | Mobile shop guide | Desktop floor map |
| --- | ---: | ---: | --- | --- | --- |
| B2F | 108 | 108 | complete | [B2F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/B2F) | [B2F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/B2F) |
| B1F | 87 | 87 | complete | [B1F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/B1F) | [B1F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/B1F) |
| 1F | 37 | 37 | complete | [1F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/1F) | [1F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/1F) |
| 2F | 130 | 130 | complete | [2F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/2F) | [2F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/2F) |
| 3F | 81 | 81 | complete | [3F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/3F) | [3F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/3F) |
| 4F | 100 | 100 | complete | [4F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/4F) | [4F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/4F) |
| 5F | 108 | 108 | complete | [5F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/5F) | [5F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/5F) |
| 6F | 130 | 130 | complete | [6F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/6F) | [6F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/6F) |
| 7F | 49 | 49 | complete | [7F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/7F) | [7F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/7F) |
| 8F | 12 | 12 | complete | [8F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/8F) | [8F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/8F) |
| 9F | 2 | 2 | complete | [9F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/9F) | [9F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/9F) |
| 10F | 1 | 1 | complete | [10F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/10F) | [10F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/10F) |
| 11F | 8 | 8 | complete | [11F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/11F) | [11F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/11F) |
| 12F | 12 | 12 | complete | [12F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/12F) | [12F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/12F) |
| 13F | 13 | 13 | complete | [13F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/13F) | [13F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/13F) |
| 14F | 10 | 10 | complete | [14F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/14F) | [14F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/14F) |
| 15F | 5 | 5 | complete | [15F](https://www.tobu-dept.jp/sp/ikebukuro/search/floor/15F) | [15F](https://www.tobu-dept.jp/ikebukuro/floormap/detail/15F) |
| **Total** | **893** | **893** | **complete** | | |

Live spot checks on 2026-11-27 JST matched the rendered totals and sampled listings:

- B2F (108) — 麻布あさひ at 4番地 and RF1 at 5番地.
- 7F (49) — 伊東屋 at 8・9番地 and 紀伊國屋書店 at 9～11番地.
- 13F (13) — 鼎泰豐 and 大阪道頓堀 ぼてぢゅう in スパイス. Both live guides include 鼎泰豐.
## seibu-ikebukuro

Fetched 2026-11-27 JST. The [official main-building floor guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) was fetched with curl's default User-Agent, serially with at least one second between requests. The guide URL for each set of cards is in the TSV. Its embedded floor dataset reports the total for each floor. Card counts and unique listings within each floor matched those totals after pagination.

| Floor | Listed | Collected | Coverage | Source |
| --- | ---: | ---: | --- | --- |
| B2F | 60 | 60 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide), [page 8 of 8](https://www.sogo-seibu.jp/ikebukuro/floor-guide?comp-mf120014_page=8&comp-mf121fxh_page=8) |
| B1F | 107 | 107 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide), [page 14 of 14](https://www.sogo-seibu.jp/ikebukuro/floor-guide?comp-mf120014_page=14) |
| 1F | 14 | 14 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 2F | 7 | 7 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 3F | 48 | 48 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide), [page 6 of 6](https://www.sogo-seibu.jp/ikebukuro/floor-guide?comp-mf11vudm_page=6&comp-mf120014_page=6&comp-mf121fxh_page=6) |
| 4F | 17 | 17 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 5F | 23 | 23 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 6F | 19 | 19 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 7F | 14 | 14 | complete | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide) |
| 8F | 0 | 0 | complete (closed) | [Main guide](https://www.sogo-seibu.jp/ikebukuro/floor-guide), [sales area reopens in phases starting 2026-12-09 JST](https://www.sogo-seibu.jp/ikebukuro/topics/8f-fashion-lifestyle-renewal). [Dining Park is operated separately](https://www.sogo-seibu.jp/ikebukuro/topics/restaurant-information). |
| **Total** | **309** | **309** | **complete** | |

The [official brand search](https://www.sogo-seibu.jp/ikebukuro/brand) yielded 314 cards across ten pages on the fetch date. Six were annex or bookstore listings. The other 308 brand records matched the 309 floor rows because Louis Vuitton is listed on both 1F and 2F.

I spot-checked all cards on the [live final pages for B2F, B1F and 3F](https://www.sogo-seibu.jp/ikebukuro/floor-guide?comp-mf11vudm_page=6&comp-mf120014_page=14&comp-mf121fxh_page=8) against the TSV. The live pages showed four, three and eight cards respectively, with matching names and categories.

The guide's text cards show floor, names and category. They provide no tenant-level map numbers, 番地 or zones in text, so `zone_text` is blank. The TSV records facts only under the #1509 precedent. [Site terms](https://www.sogo-seibu.jp/usage).
# Ikebukuro department-store tenant sources

Fetched 2026-11-27 JST with curl. Counts were taken from the official text directories, which show individual listings without a separate total. Categories and printed map numbers are transcribed as shown. Blank fields mean the corresponding value was absent from the source.

## PARCO Ikebukuro main

TSV: `ikebukuro-parco.tsv`. [Official floor guide](https://ikebukuro.parco.jp/floor/).

The two buildings share one store ID. Floor links identify the main building with `ft=type1` and P’PARCO with `ft=type2`. The [official alphabetical shop index](https://ikebukuro.parco.jp/shop/?category_search=alpha) supplies published readings for Latin-script names where available. Its information counter and ATM entries are building facilities outside the numbered shop lists.

| Floor | Guide entries | TSV rows | Coverage |
| --- | ---: | ---: | --- |
| [B2F](https://ikebukuro.parco.jp/floor/detail/?f=b2f&ft=type1) | 6 | 7 | complete, plus [one shop listed separately](https://ikebukuro.parco.jp/shop/detail/?id=11977) |
| [B1F](https://ikebukuro.parco.jp/floor/detail/?f=b1f&ft=type1) | 16 | 16 | complete |
| [1F](https://ikebukuro.parco.jp/floor/detail/?f=1f&ft=type1) | 5 | 5 | complete |
| [M2F](https://ikebukuro.parco.jp/floor/detail/?f=m2f&ft=type1) | 4 | 4 | complete |
| [2F](https://ikebukuro.parco.jp/floor/detail/?f=2f&ft=type1) | 11 | 11 | complete |
| [3F](https://ikebukuro.parco.jp/floor/detail/?f=3f&ft=type1) | 8 | 8 | complete |
| [4F](https://ikebukuro.parco.jp/floor/detail/?f=4f&ft=type1) | 15 | 15 | complete |
| [5F](https://ikebukuro.parco.jp/floor/detail/?f=5f&ft=type1) | 16 | 16 | complete |
| [6F](https://ikebukuro.parco.jp/floor/detail/?f=6f&ft=type1) | 17 | 17 | complete |
| [7F](https://ikebukuro.parco.jp/floor/detail/?f=7f&ft=type1) | 14 | 14 | complete |
| [8F](https://ikebukuro.parco.jp/floor/detail/?f=8f&ft=type1) | 10 | 10 | complete |

The separately listed B2F pop-up uses its [Japanese shop detail](https://ikebukuro.parco.jp/shop/detail/?id=11977) and [English shop name](https://en.ikebukuro.parco.jp/shop/detail/?id=11977). Its detail page publishes the category and no map number.

## P’PARCO

TSV: `ikebukuro-parco.tsv`. [Official floor guide](https://ikebukuro.parco.jp/floor/).

The two buildings share one store ID. Floor links identify the main building with `ft=type1` and P’PARCO with `ft=type2`. The [official alphabetical shop index](https://ikebukuro.parco.jp/shop/?category_search=alpha) supplies published readings for Latin-script names where available. Its information counter and ATM entries are building facilities outside the numbered shop lists.

| Floor | Guide entries | TSV rows | Coverage |
| --- | ---: | ---: | --- |
| [B2F](https://ikebukuro.parco.jp/floor/detail/?f=b2f&ft=type2) | 1 | 1 | complete |
| [B1F](https://ikebukuro.parco.jp/floor/detail/?f=b1f&ft=type2) | 1 | 1 | complete |
| [1F](https://ikebukuro.parco.jp/floor/detail/?f=1f&ft=type2) | 5 | 5 | complete |
| [2F](https://ikebukuro.parco.jp/floor/detail/?f=2f&ft=type2) | 5 | 5 | complete |
| [3F](https://ikebukuro.parco.jp/floor/detail/?f=3f&ft=type2) | 8 | 8 | complete |
| [4F](https://ikebukuro.parco.jp/floor/detail/?f=4f&ft=type2) | 2 | 2 | complete |
| [5F](https://ikebukuro.parco.jp/floor/detail/?f=5f&ft=type2) | 1 | 1 | complete |
| [6F](https://ikebukuro.parco.jp/floor/detail/?f=6f&ft=type2) | 1 | 1 | complete |
| [7F](https://ikebukuro.parco.jp/floor/detail/?f=7f&ft=type2) | 1 | 1 | complete |
| [8F](https://ikebukuro.parco.jp/floor/detail/?f=8f&ft=type2) | 1 | 1 | complete |

## Lumine Ikebukuro

TSV: `lumine-ikebukuro.tsv`. [Official floor guide](https://www.lumine.ne.jp/ikebukuro/floorguide/).

| Floor | Guide entries | TSV rows | Coverage |
| --- | ---: | ---: | --- |
| [B1](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=b1f) | 18 | 18 | complete |
| [1F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=1f) | 8 | 8 | complete |
| [2F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=2f) | 13 | 13 | complete |
| [3F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=3f) | 21 | 21 | complete |
| [4F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=4f) | 23 | 23 | complete |
| [5F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=5f) | 20 | 20 | complete |
| [6F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=6f) | 13 | 13 | complete |
| [7F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=7f) | 17 | 17 | complete |
| [8F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=8f) | 24 | 24 | complete |
| [9F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=9f) | 8 | 8 | complete |
| [10F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=10f) | 11 | 11 | complete |

## Esola Ikebukuro

TSV: `esola-ikebukuro.tsv`. [Official floor guide](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp).

| Floor | Guide entries | TSV rows | Coverage |
| --- | ---: | ---: | --- |
| [B1](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=b1) | 7 | 7 | complete |
| [1F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=1f) | 4 | 4 | complete |
| [2F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=2f) | 3 | 3 | complete |
| [3F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=3f) | 1 | 1 | complete |
| [4F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=4f) | 2 | 2 | complete |
| [5F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=5f) | 5 | 5 | complete |
| [6F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=6f) | 6 | 6 | complete |
| [7F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=7f) | 3 | 3 | complete |
| [8F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=8f) | 3 | 3 | complete |
| [9F](https://www.metropro-sc.jp/esola-ikebukuro/shop/index.jsp?bf=1&fmt=6&shopid=1036) | — | 1 | unknown total, official shop detail confirms KICHIRI seating shared with 8F |

The operator's [building description](https://www.metropro-sc.jp/esola-ikebukuro/shop/page.jsp?id=3) places the top of the shopping center at 9F. The floor guide ends at 8F. The [all-shop search](https://www.metropro-sc.jp/esola-ikebukuro/shop/index.jsp?bf=8) lists 34 tenant detail links, matching the total on B1–8F, and indexes KICHIRI at 8F. The 9F row records that same tenant's upstairs seating. The operator publishes no standalone 9F count.

9F route evidence from 2026-11-27 JST. Each command used `curl -sSL --max-time 14 -w '%{stderr}HTTP %{http_code}; %{size_download} bytes; effective %{url_effective}\n' '<URL below>'` and exited 0. Status and size refer to the final response after redirects.

| URL passed to curl | HTTP | Bytes | Response |
| --- | ---: | ---: | --- |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=9f | 200 | 6,026 | Redirected to `/esola-ikebukuro/shop/error.jsp?scid=2`, a CMS error page with no tenant rows. Uppercase `fid=9F` returned the same response. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/sp/floor.jsp?fid=9f | 404 | 6,026 | CMS error page. The alternate `/esola-ikebukuro/sp/shop/floor.jsp?fid=9f` returned a 5,132-byte 404 page. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/index.jsp?bf=8&page=2 | 200 | 51,907 | Same 34 links as the unpaginated all-shop search. The page has no next-page link. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/index.jsp?bf=6&cat=5 | 200 | 36,890 | The restaurant and café category lists KICHIRI at 8F and has no separate 9F listing. |
| https://www.metropro-sc.jp/sitemap.xml | 200 | 1,477 | Sitemap contains Metro M Korakuen routes and no Esola 9F route. The Esola-prefixed sitemap returned the same size and content. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/gourmet/ | 200 | 67,811 | Gourmet guide lists KICHIRI at 8F and references its 9F seats. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/index.jsp?bf=1&fmt=6&shopid=1036 | 200 | 34,947 | KICHIRI shop detail confirms 9F seating. |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/pdfimage.jsp?id=42 | 200 | 350,306 | Extractable text in the building's 2025–2026 holiday directory names KICHIRI without floor labels. |
| https://www.kichiri.co.jp/ir/pdf/090928a.pdf | 200 | 118,580 | Extractable text in the tenant's opening announcement specifies Esola 8F–9F. |

The 8F floor page and category search contain their lists in HTML. Their inline scripts handle the floor image and interface. The linked first-party scripts inspected for a floor JSON/XHR route were [jquery-plugin.js](https://www.metropro-sc.jp/cmsdata/js/jquery-plugin.js) (HTTP 200, 19,040 bytes), [sw_plugin.js](https://www.metropro-sc.jp/cmsdata/js/sw_plugin.js) (HTTP 200, 10,314 bytes), and [shoppage.js](https://www.metropro-sc.jp/cmsdata/js/shoppage.js) (HTTP 200, 1,657 bytes). They expose no tenant-feed endpoint.

## Visual spot checks

Compared the rendered guide listings with the extracted names, categories and printed map numbers on 2026-11-27 JST.

- [P’PARCO 3F](https://ikebukuro.parco.jp/floor/detail/?f=3f&ft=type2) — 8 listings, positions 1–8, from fantasy village to THE CHARA SHOP.
- [Lumine 1F](https://www.lumine.ne.jp/ikebukuro/floorguide/?area=area01store01&floor=1f) — 8 listings, positions 1–8, from gelato pique cafe creperie to ete.
- [Esola 8F](https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=8f) — 3 listings, positions 1–3, KICHIRI -relax&dine-, ガチ中華ＦＯＯＤ ＨＡＬＬ and H¹T.
# Sunshine City tenant sources

Fetched 2026-11-27 JST. Counts refer to published listings and named public-facing facilities. Shared entrances, elevators, toilets, vacant renovation slots and online-only stores have no tenant rows. Separate directory cards for the same brand are retained when the floor map gives them separate positions. Floor labels follow the source, including `B1階`, `1階` and `3階` in the operator guides. `屋上` and `屋上(10F)` refer to the same World Import Mart rooftop.

The landmark pass reconciles the [facility guide](https://sunshinecity.jp/facility/) with the [complex floor map](https://sunshinecity.jp/information/floor_map/) and the building operators' guides. The six TSVs contain 317 rows. Bunka Kaikan and Prince Hotel have their own TSVs because the complex map identifies them separately. The Annex's Chiikawa Park also has its own building file.

## sunshine-city-alpa

2026-11-27 JST · **complete for published listings** · 165 rows across B1–4F, including seven facility rows beyond the 158 entries reconciled below. The Japanese [shop](https://sunshinecity.jp/shop/shop_list/) and [restaurant](https://sunshinecity.jp/restaurant/restaurant_list/) lists were read through pages 8 and 5. The [English shop](https://sunshinecity.jp/en/shop/shop_list/) and [English restaurant](https://sunshinecity.jp/en/restaurant/restaurant_list/) lists supply Latin names where shown. Map positions come from the respective floor legends. The [services guide](https://sunshinecity.jp/information/guide.html#anc_09) supplies the separately listed ATM locations.

| Floor | Published count | TSV | Reconciliation |
| --- | ---: | ---: | --- |
| [B1](https://sunshinecity.jp/information/floor_map/b1f.html) | [54 shops](https://sunshinecity.jp/shop/shop_list/field/reg_section/201/) + [18 food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/201/) | 73 | The 83 map slots contain 71 ALPA cards, 11 renovation slots and 1 Annex listing. The directory's post office is attributed to Sunshine 60 B1 by the services guide. Two ALPA ATM locations supplement the 71 ALPA cards. |
| [1F](https://sunshinecity.jp/information/floor_map/1f.html) | [21 shops](https://sunshinecity.jp/shop/shop_list/field/reg_section/202/) + [15 food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/202/) | 37 | The 40 map slots contain 36 ALPA cards, 3 renovation slots and 1 Sunshine 60 listing. One ALPA ATM supplements the 36 cards. The two Sesame Street Market cards occupy 01 and 02. |
| [2F](https://sunshinecity.jp/information/floor_map/2f.html) | [15 shops](https://sunshinecity.jp/shop/shop_list/field/reg_section/203/) + [3 food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/203/) | 18 | The 19 map slots include one renovation slot. |
| [3F](https://sunshinecity.jp/information/floor_map/3f.html) | [0 shops](https://sunshinecity.jp/shop/shop_list/field/reg_section/204/) + [30 food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/204/) | 30 | The 31 named map entries include the Sunshine 60 Hello Work counter. |

Facility rows add [Fountain Plaza](https://sunshinecity.jp/facility/fountain.html) and two [information desks](https://sunshinecity.jp/information/guide.html) on B1, another information desk and [Picture Book Plaza](https://co.sunshinecity.co.jp/archives/007/202305/6f94bd7d44476932ab0a579557409894.pdf) on 1F, the [kids' play space](https://sunshinecity.jp/enjoy/course05.html) on 2F, and [Sunshine Garden](https://sunshinecity.jp/enjoy/course05.html) on the [4F rooftop](https://www.princehotels.co.jp/sunshine/files/170328_kyouikuryoko.pdf). [SOLARIUM closed on 2026-03-12 JST](https://sunshinecity.jp/news/entry-36390.html).

Live spot checks, 2026-11-27 JST

- B1 map, 83 slots. Compared ゴディバ (01), 天丼　てんや (42) and the Annex's ちいかわパーク (83). [B1 map](https://sunshinecity.jp/information/floor_map/b1f.html)
- 2F map, 19 slots. Compared the renovation slot (01), Re.Ra.Ku (10) and the Orico counter (19). [2F map](https://sunshinecity.jp/information/floor_map/2f.html)
- 3F map, 31 entries. Compared 焼肉トラジ (01), Ducky Duck (16) and JOURNAL STANDARD CAFE (32). [3F map](https://sunshinecity.jp/information/floor_map/3f.html)

## sunshine-city-world-import-mart

2026-11-27 JST · **complete for published listings** · 94 rows. The [complex overview](https://sunshinecity.jp/information/floor_map/) identifies public uses. The five-card [World Import Mart shop filter](https://sunshinecity.jp/shop/shop_list/field/reg_section/301/) and two-card [food filter](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/301/) cover the listings filed under the building. ALTA, NAMJATOWN, Cross Store and the aquarium publish their own directories.

| Floor | TSV | Published coverage |
| --- | ---: | --- |
| B1階 | 24 | The [ALTA operator floor guide](https://www.isetan.mistore.jp/common/alta/shops/floorb1.html) has 24 numbered cards. Sunshine City's [shop](https://sunshinecity.jp/shop/shop_list/field/reg_section/1801/) and [food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/1801/) filters have 16 and 8. |
| 1階 | 20 | The [ALTA operator floor guide](https://www.isetan.mistore.jp/common/alta/shops/floor1.html) has 20 cards, including the event space and two unnumbered concessions. Sunshine City's [shop](https://sunshinecity.jp/shop/shop_list/field/reg_section/1802/) and [food](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/1802/) filters have 11 and 6. |
| 2F | 14 | NAMJATOWN and its three [food and shop areas](https://bandainamco-am.co.jp/tp/namja/food/), with 7 [gyoza shops](https://bandainamco-am.co.jp/tp/namja/food/gyoza/) and 3 [dessert shops](https://bandainamco-am.co.jp/tp/namja/food/dessert/). The operator's [access page](https://bandainamco-am.co.jp/tp/namja/ticket/index.html) identifies the floor. |
| 3階 | 24 | [Cross Store Tokyo](https://bandainamco-am.co.jp/crossstore/store/crossstore_tokyo/) and its 21 titled brands from the Tokyo listing, plus the [amusement area](https://bandainamco-am.co.jp/game_center/loc/crossstore_tokyo/) and the [event area](https://sunshinecity.jp/facility/). |
| 4F | 1 | 展示ホールA in the [exhibition guide](https://sunshinecity.jp/facility/exhibition.html). |
| 5F | 4 | Three directory cards plus コンファレンスルーム, identified by the [complex overview](https://sunshinecity.jp/information/floor_map/) and [conference guide](https://sunshinecity.jp/facility/conference.html). |
| 6F | 1 | The showroom is the only 6F card in the [building filter](https://sunshinecity.jp/shop/shop_list/field/reg_section/301/). |
| 9F | 1 | さくらルーム in the [complex overview](https://sunshinecity.jp/information/floor_map/). [Aquarium access](https://sunshinecity.jp/aquarium/access/) also identifies 9F as a route to the rooftop. |
| 屋上(10F) / 屋上 | 5 | The [aquarium](https://sunshinecity.jp/aquarium/access/) and its two [onsite shop/café listings](https://sunshinecity.jp/aquarium/information/shop-cafe/), [Manten](https://planetarium.konicaminolta.jp/manten/access/) and [Gallery Planetaria](https://sunshinecity.jp/shop/shop_list/entry-23040.html). The [operator's access routes](https://sunshinecity.jp/information/floor_map/) explicitly place both the aquarium and Manten on the rooftop (10F). |

The overview and both directories publish no tenant counts for 7F or 8F and identify no public tenant floors there. Shared visitor parking is described in the [parking guide](https://sunshinecity.jp/information/access_car.html).

## sunshine-city-60

2026-11-27 JST · **complete for published listings** · 34 rows. Sources are the [complex overview](https://sunshinecity.jp/information/floor_map/), [12-card building shop filter](https://sunshinecity.jp/shop/shop_list/field/reg_section/101/) and [one-card building restaurant filter](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/101/), supplemented by the main directories, [services guide](https://sunshinecity.jp/information/guide.html), [Sky Restaurants](https://sunshinecity.jp/facility/sky-restaurant.html) and [observatory map](https://sunshinecity.jp/observatory/information/floor_map.html).

| Floor | TSV | Published coverage |
| --- | ---: | --- |
| B2 | 2 | One rental-car card and the staffed [parking front](https://sunshinecity.jp/information/access_car.html). |
| B1 | 3 | The [post office](https://sunshinecity.jp/information/guide.html#anc_08) and two [ATM locations](https://sunshinecity.jp/information/guide.html#anc_09) at or next to it. The main cards and Japanese [postal detail](https://sunshinecity.jp/shop/shop_list/entry-378.html) use ALPA B1 for navigation. The [English deli detail](https://sunshinecity.jp/en/shop/shop_list/entry-29914.html) says Sunshine 60 B1, while the [Japanese deli detail](https://sunshinecity.jp/shop/shop_list/entry-29914.html) and B1 legend place it at ALPA map position 66. |
| 1F | 4 | One café in the [1F legend](https://sunshinecity.jp/information/floor_map/1f.html), the office lobby in the complex overview, and the information desk and disaster prevention center in the services guide. |
| 3F | 1 | Hello Work in the [3F legend](https://sunshinecity.jp/information/floor_map/3f.html). |
| 4F | 1 | ファミマ!! in the [4F legend](https://sunshinecity.jp/information/floor_map/4f.html). |
| 5F | 1 | 都民共済プラザ in the shop directory. |
| 7F | 5 | Five of the seven published [clinic/pharmacy cards](https://sunshinecity.jp/shop/shop_list/field/reg_category/9/). |
| 8F | 4 | The remaining two clinic/pharmacy cards and two service cards in the shop directory. |
| 36F | 1 | 東京都民共済生活協同組合(都民共済) in the shop directory. |
| 58F | 1 | One card in the [58F food filter](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/1101/). |
| 59F | 7 | Six cards in the [59F food filter](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/1102/) plus [bridal services](https://sunshinecity.jp/shop/shop_list/entry-571.html). The Sky Restaurants map alternate text also lists an older Queens Bath entry, absent from the current Sky Restaurants cards and 59F filter. |
| 58F・59F | 1 | Sky Restaurants is the venue for both floors. Individual restaurants keep their own floor listings above. |
| 60F | 3 | The [observatory](https://sunshinecity.jp/observatory/access/), its event space in the observatory map, and the one card in the [observatory food filter](https://sunshinecity.jp/restaurant/restaurant_list/field/reg_section/1001/). |

The operator does not publish building-wide office tenant totals or a tenant directory for the shared B3 parking level. The table covers floors with a published, named public-facing listing and does not estimate office tenants.

## sunshine-city-bunka-kaikan

2026-11-27 JST · 10 rows. The [complex overview](https://sunshinecity.jp/information/floor_map/) assigns the bus terminal to 1F, the [exhibition halls D, C and B](https://sunshinecity.jp/facility/exhibition.html) to 2F, 3F and 4F respectively, the [theatre](https://sunshine-theatre.co.jp/access/index.html) to 4F, the special hall and [sports club](https://sunshinecity.jp/shop/shop_list/entry-376.html) to 5F, and the meeting rooms and [museum](https://aom-tokyo.com/about/) to 7F. The [room directory](https://co.sunshinecity.co.jp/conference/guidance.html) lists rooms 701–710 as the 7F meeting suite. The [services guide](https://sunshinecity.jp/information/guide.html) places the disaster prevention center inside the 1F bus terminal. The [operator FAQ](https://sunshinecity.jp/information/faq.html) identifies 6F as an office floor and publishes no tenant roster for it.

## sunshine-city-prince-hotel

2026-11-27 JST · 13 rows. The [hotel floor diagram](https://www.princehotels.co.jp/sunshine/files/170328_kyouikuryoko.pdf) and current [facility guide](https://www.princehotels.co.jp/sunshine/facility/) place the lobby and front desk on 1F. B1 has three separately listed restaurants and mamaro. 1F also has Chef’s Palette, FamilyMart and WiFiBOX. The hotel pages give floors for the laundry (6F), meeting room (19F), stretch room (21F), IKEPRI25 concept floor (25F) and conference rooms (29F).

## sunshine-city-annex

2026-11-27 JST · 1 row. The [operator's Chiikawa Park listing](https://sunshinecity.jp/shop/shop_list/entry-33932.html) identifies the entrance and immersive exhibit on B1, and the games and shop on 1F.

## Route evidence

All commands below ran 2026-11-27 JST, using curl's default user agent. The table gives HTTP status, downloaded bytes and what the response contained. The PDFs were deleted after text extraction.

| Exact command | HTTP / bytes | Body |
| --- | --- | --- |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/sp/information/floor_map/` | 404 / 90,191 | Official not-found HTML. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/sp/shop/shop_list/` | 404 / 90,191 | Official not-found HTML. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/sp/restaurant/restaurant_list/` | 404 / 90,191 | Official not-found HTML. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/sp/facility/` | 404 / 90,191 | Official not-found HTML. The standard facility guide and XML sitemap supplied the facility routes. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/sitemap.xml` | 200 / 964,576 | XML sitemap links the numbered B1–4F complex maps and the facility, exhibition, conference, fountain and Sky Restaurants guides. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/file/official/pdf/alpa_guide.pdf` | 200 / 15,652,619 | `pdftotext -layout` returned eight bytes of page breaks. The hotel floor diagram supplied the 4F Sunshine Plaza label. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://www.princehotels.co.jp/sunshine/files/170328_kyouikuryoko.pdf` | 200 / 7,325,183 | `pdftotext -layout` returned 25,869 bytes and identified ALPA 4F Sunshine Plaza, the hotel 1F lobby and its B1 restaurants. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/json/recommend_shop.json` | 200 / 172,330 | Shop detail's recommendation endpoint, 142 records. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/json/recommend_restaurant.json` | 200 / 109,770 | Restaurant recommendation endpoint, 96 records. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/file/official/pdf/map/saf_map.pdf` | 200 / 16,310,511 | ALPA staff map PDF, 65,758 extracted text characters. The HTML legends give the current numbered cards. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://sunshinecity.jp/file/aquarium/pdf/aquarium_guide_jp.pdf` | 200 / 1,639,520 | Aquarium map PDF, zero extracted text characters. Its official shop/café page supplies the tenant names. |
| `curl -LsS --max-time 12 -w '%{stderr}%{http_code} %{size_download} %{url_effective}' https://bandainamco-am.co.jp/documents/tp/namja/about/20261017_map.pdf` | 200 / 3,627,368 | NAMJATOWN map PDF, zero extracted text characters. The official food and shop pages list the counters. |
