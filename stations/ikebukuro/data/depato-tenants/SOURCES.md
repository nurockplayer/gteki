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
