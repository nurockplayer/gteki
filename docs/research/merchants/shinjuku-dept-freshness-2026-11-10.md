# Shinjuku department-store freshness — queue 159

Partial research, 2026-11-10 JST. Counts are directory rows, except LUMINE's existing shop POIs. A GAP means the comparison or update is incomplete; no tenant or hours data was changed in this pass.

| Store | Source URL | Read at (JST) | Tenants before → after (+added −removed ~changed) | Hours changed? | Status |
|---|---|---|---|---|---|
| 伊勢丹新宿店 (sections and brands) | https://www.mistore.jp/store/shinjuku/shops.html | 2026-11-10 12:51 JST | 83 sections + 1,464 brands → unknown | Unknown | GAP: curl timed out with no response; brand CSV also timed out. |
| 新宿マルイ 本館 | https://www.0101.co.jp/contents2/shopinfo/003/shop_introduce_list.json | 2026-11-10 12:51 JST | 63 → 62 (+0 −1 ~0) | No | GAP: observed removal not yet applied. |
| 新宿マルイ アネックス | https://www.0101.co.jp/contents2/shopinfo/005/shop_introduce_list.json | 2026-11-10 12:51 JST | 56 → 57 (+1 −0 ~0) | No | GAP: observed addition not yet applied. |
| 新宿マルイ メン | https://www.0101.co.jp/contents2/shopinfo/074/shop_introduce_list.json | 2026-11-10 12:51 JST | 38 → 37 (+0 −1 ~0) | No | GAP: observed removal not yet applied. |
| 新宿高島屋 | https://www.takashimaya.co.jp/shinjuku/floor/ | 2026-11-10 12:51 JST | 366 → unknown | Unknown | GAP: curl HTTP/2 stream error, including terms URL. |
| 京王百貨店 新宿店 | https://www.keionet.com/re2024/json/shop_shinjuku.json | 2026-11-10 12:51 JST | 593 → 595 (+3 −1 ~0) | No | GAP: observed tenant changes not yet applied. |
| 小田急百貨店 新宿店 | https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97 | 2026-11-10 12:51 JST | 269 → unknown; first page reports 272 total source rows | No | GAP: remaining result pages and exclusions not compared. |
| ルミネ新宿 ルミネ1 | https://www.lumine.ne.jp/shinjuku/floorguide/ | Not read | Existing shop POIs captured; not compared | Unknown | GAP: comparison not completed. |
| ルミネ新宿 ルミネ2 | https://www.lumine.ne.jp/shinjuku/floorguide/ | Not read | Existing shop POIs captured; not compared | Unknown | GAP: comparison not completed. |
| ルミネエスト新宿 | https://www.lumine.ne.jp/est/floorguide/ | Not read | 245 shop POIs → unknown | Unknown | GAP: comparison not completed. |

Marui counts compare source IDs, printed names and floor labels; categories were not compared. Hours were compared with the existing batch 3 rows from the three facility JSON files. Keio counts compare IDs, names, floors and sales-floor categories; the store-wide hours lines match batch 4. Odakyu's hours page has the same SHA-256 as the 2026-11-03 JST batch 4 receipt. The Marui change is HealthyTOKYO CBD Shop ＆ Cafe removed from 本館, ビック・ママ added to アネックス 7F, and ヴィヴィアン・ウエストウッド マン removed from メン. These are source-feed differences, not independent claims of closure.

LUMINE is not labelled “never captured”: `shinjuku-merchants-batch2.json` and its log contain existing shop POI transcriptions (230 combined for ルミネ1/2 and 245 for エスト). No new transcription was started.
