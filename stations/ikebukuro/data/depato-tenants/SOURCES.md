# Department-store tenant sources

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
