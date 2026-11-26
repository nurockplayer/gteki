# Isetan Shinjuku tenant sources

## isetan-shinjuku-main

Fetched 2026-11-27 JST. The official [Brand Search](https://cp.mistore.jp/global/en/shinjuku/brand.html) loads the [brand CSV](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-brand.csv) and [floor labels and descriptions](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-floor.json). The [global floor guide](https://cp.mistore.jp/global/en/shinjuku.html) supplies the short floor labels and identifies RF as the roof garden. The [Japanese building guide](https://www.mistore.jp/store/shinjuku/shops.html), its [indexed URL](https://www.mistore.jp/store/shinjuku/shops.html/1000/index.html), and the [B1F](https://www.mistore.jp/store/shinjuku/shops/mainfloorB1.html) and [7F](https://www.mistore.jp/store/shinjuku/shops/mainfloor7.html) pages timed out in curl (exit 28, zero bytes).

| Floor | TSV rows | Brand Search records (active / raw) | Coverage |
| --- | ---: | ---: | --- |
| B2F | 63 | 63 / 63 | partial |
| B1F | 181 | 181 / 181 | partial |
| 1F | 260 | 260 / 262 | partial |
| 2F | 110 | 110 / 110 | partial |
| 3F | 108 | 108 / 108 | partial |
| 4F | 36 | 36 / 36 | partial |
| 5F | 232 | 232 / 232 | partial |
| 6F | 156 | 156 / 156 | partial |
| 7F | 43 | 43 / 43 | partial |
| RF | 1 | — | partial |

The Brand Search records count named brands and concessions at each listed sales zone. Its public interface supplies no unfiltered floor total and no independent count of physical shops. The 1F export excludes one expired and one future listing. RF has one named public facility (アイ・ガーデン, named in the floor data) and no enumerated tenant list. Floor-plan images and PDFs were excluded.

## isetan-shinjuku-mens

Fetched 2026-11-27 JST. Sources are the [Brand Search](https://cp.mistore.jp/global/en/shinjuku/brand.html), its [brand CSV](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-brand.csv) and [floor data](https://cp.mistore.jp/content/dam/isetan_mitsukoshi/brand-search/shinjuku/data/shinjuku-floor.json), the [ISETAN MEN'S net brand index by floor](https://www.imn.jp/brand/floor), and the [ISETAN MEN'S net floor guide](https://www.imn.jp/floorguide). The [global floor guide](https://cp.mistore.jp/global/en/shinjuku.html) labels the golf school floor RF. The [Japanese building guide](https://www.mistore.jp/store/shinjuku/shops_mens.html) and [8F guide](https://www.mistore.jp/store/shinjuku/shops/mensfloor8.html) timed out in curl (exit 28, zero bytes).

| Floor | TSV rows | Brand Search records (active / raw) | Men's index listings (eligible / shown) | Coverage |
| --- | ---: | ---: | ---: | --- |
| B1F | 221 | 133 / 134 | 178 / 181 | partial |
| 1F | 189 | 150 / 150 | 138 / 138 | partial |
| 2F | 14 | 12 / 12 | 13 / 13 | partial |
| 3F | 16 | 15 / 15 | 10 / 12 | partial |
| 4F | 15 | 14 / 14 | 14 / 14 | partial |
| 5F | 133 | 37 / 37 | 123 / 123 | partial |
| 6F | 71 | 21 / 21 | 66 / 67 | partial |
| 7F | 23 | 16 / 16 | 21 / 21 | partial |
| 8F | 37 | 20 / 20 | 32 / 33 | partial |
| RF | 1 | — | — | partial |

The index lists stocked labels as well as shops. The sources supply no independent count of physical tenants per floor. The TSV keeps the dated Brand Search placements and adds index entries missing by floor and name. Index-only listings have the printed category and an empty zone when no separate position appears. Brand Search B1F excludes one expired record. The index counts exclude explicitly online-only items and AMIRI and Rick Owens entries annotated for a 1F promotion in the B1F and 3F blocks. Brand Search still lists the regular floor placements. The promotion end date and current 1F placement could not be confirmed. RF has the separately named SWING ISETAN GOLF SCHOOL and no enumerated tenant list. Annexes were excluded.

Live spot checks on 2026-11-27 JST compared the official index text against the TSV for [2F](https://www.imn.jp/brand/floor#2F) (13 shown, including BLACK COMME des GARCONS), [3F](https://www.imn.jp/brand/floor#3F) (12 shown, including Yohji Yamamoto and two 1F promotion notes), and [8F](https://www.imn.jp/brand/floor#8F) (33 shown, including rejiig and one online-only label).
