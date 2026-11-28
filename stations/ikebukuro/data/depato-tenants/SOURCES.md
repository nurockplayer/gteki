# Ikebukuro department-store tenant sources

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
