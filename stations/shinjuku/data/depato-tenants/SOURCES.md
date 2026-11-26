# Shinjuku department-store tenant sources

Collected on 2026-11-27 JST. Counts compare TSV rows with the official directory cards for each floor. The floor-guide text and its public data feeds were read with curl. Floor labels and categories come from the displayed lists. The Latin field repeats a Latin-only display name when the guide prints it. Empty categories and positions mean the list leaves those fields blank.

## Shinjuku Marui Main — `shinjuku-marui-main`

- **Complete** for the shop guide, 63 rows. B1F 4/4, 1F 10/10, 2F 12/12, 3F 1/1, 4F 1/1, 5F 17/17, 6F 5/5, 7F 8/8, 8F 5/5. The facility guide identifies RF as the Q-COURT rooftop garden and provides no tenant list. [Floor guide](https://www.0101.co.jp/003/info/?floor=B1F) · [Floor feed](https://www.0101.co.jp/contents2/floormap/003/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/003/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/003/shop_list.json) · [Facility guide](https://www.0101.co.jp/003/facility/index.html) · [Facility feed](https://www.0101.co.jp/contents2/facilityinfo/003/facility.json).
- Live spot check on 2026-11-27 JST matched all four B1F shop names and their displayed categories. [B1F](https://www.0101.co.jp/003/info/?floor=B1F).

## Shinjuku Marui Annex — `shinjuku-marui-annex`

- **Complete** for the shop guide, 57 rows. B1F 1/1, 1F 8/8, 2F 8/8, 3F 11/11, 4F 6/6, 5F 1/1, 6F 1/1, 7F 14/14, 8F 7/7. The 6F guide displays one named shop card. [Floor guide](https://www.0101.co.jp/005/info/) · [Floor feed](https://www.0101.co.jp/contents2/floormap/005/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/005/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/005/shop_list.json).
- Live spot check on 2026-11-27 JST matched all eight 1F shop names and their displayed categories. [1F](https://www.0101.co.jp/005/info/?floor=1F).

## Shinjuku Marui Men — store ID pending

- **Complete** extraction, pending TSV placement. Extracted rows match the live card counts on 1F 3/3, 2F 4/4, 3F 8/8, 4F 9/9, 5F 5/5, 6F 5/5, 7F 2/2, 8F 2/2. The station floor data has no store ID for this building. [Floor guide](https://www.0101.co.jp/074/info/) · [Floor feed](https://www.0101.co.jp/contents2/floormap/074/floor_map_list.json) · [Shop feed](https://www.0101.co.jp/contents2/shopinfo/074/shop_introduce_list.json) · [Shop index](https://www.0101.co.jp/contents2/shopinfo/074/shop_list.json).
- Live spot check on 2026-11-27 JST matched all five 5F shop names and their displayed categories, including ムッシュニコル キャナルドゥ　コンセプトストア and メンズ　メルローズ. [5F](https://www.0101.co.jp/074/info/?floor=5F).

## Shinjuku Takashimaya department store — `takashimaya-shinjuku`

- **Unknown**. GAP on B2, B1 and 1F–11F. Each has zero department-store rows in this collection and an unknown official count. Curl returned exit 92 (`HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)`) on the overview, the B1 floor page and the filtered brand search on 2026-11-27 JST. A retry of the overview over HTTP/1.1 returned exit 28 (`Operation timed out after 12005 milliseconds with 0 bytes received`). The remaining department-store floor pages share that host. [Floor guide](https://www.takashimaya.co.jp/shinjuku/floor/) · [B1 page](https://www.takashimaya.co.jp/shinjuku/floor/building_01/floor_b1.html) · [Brand search](https://www.takashimaya.co.jp/brandsearch/result/?page=1&skin=01&sks=2&sky=B00201).

## Takashimaya Times Square specialty floors — dining under `takashimaya-shinjuku`

- **Partial**, 31 rows. The official Restaurants Park card counts match 12F 6/6, 13F 15/15 and 14F 10/10, including the 14F tenant listed as closed for renovation. Each row includes the printed map number. The station floor data uses the Takashimaya ID for these three floors. [Restaurants Park directory](https://www.restaurants-park.jp/restaurant/) · [12F](https://www.restaurants-park.jp/floor_map?floor=12) · [13F](https://www.restaurants-park.jp/floor_map?floor=13) · [14F](https://www.restaurants-park.jp/floor_map?floor=14).
- GAP for the broader specialty directory. The earlier coverage report identified 2F～7F, 8F, 11F, 12F and 南館 1F～5F, 6F and 7F as having non-dining listings. Each has zero verified non-dining rows and an unknown current total. Curl returned exit 92 on the specialty directory on 2026-11-27 JST. [Official specialty directory](https://www.takashimaya.co.jp/shinjuku/timessquare/).
