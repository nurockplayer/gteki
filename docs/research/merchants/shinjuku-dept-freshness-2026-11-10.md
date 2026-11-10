# Shinjuku department-store freshness — queue 159

Read 2026-11-10 JST with plain curl and its default User-Agent. Counts are directory rows; +, − and ~ count added, removed and changed rows. These are changes in the published directories, not independent claims of closure. No routing or POI was added.

| Store | Source URL | Read at (JST) | Tenants before → after (+added −removed ~changed) | Hours changed? | Status |
|---|---|---|---|---|---|
| 伊勢丹新宿店 (sections and brands) | https://www.mistore.jp/store/shinjuku/shops.html | 2026-11-10 12:51 JST | 83 sections + 1,464 brands → unknown | Unknown | GAP: curl timed out with no response; brand CSV also timed out. |
| 新宿マルイ 本館 | https://www.0101.co.jp/003/info/ | 2026-11-10 12:51 JST | 63 → 62 (+0 −1 ~0) | No | changed |
| 新宿マルイ アネックス | https://www.0101.co.jp/005/info/ | 2026-11-10 12:51 JST | 56 → 57 (+1 −0 ~0) | No | changed |
| 新宿マルイ メン | https://www.0101.co.jp/074/info/ | 2026-11-10 12:51 JST | 38 → 37 (+0 −1 ~0) | No | changed |
| 新宿高島屋 | https://www.takashimaya.co.jp/shinjuku/floor/ | 2026-11-10 12:51 JST | 366 → unknown | Unknown | GAP: curl HTTP/2 stream error, including terms URL. |
| 京王百貨店 新宿店 | https://www.keionet.com/info/shinjuku/shop/ | 2026-11-10 12:51 JST | 593 → 595 (+3 −1 ~0) | No | changed |
| 小田急百貨店 新宿店 | https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97 | 2026-11-10 13:03 JST | 269 → 266 (+0 −3 ~0) | No | changed |
| ルミネ新宿 ルミネ1 | https://www.lumine.ne.jp/shinjuku/floorguide/ | 2026-11-10 13:05 JST | No tenant research file → not transcribed | No | GAP: never captured as tenant directory. |
| ルミネ新宿 ルミネ2 | https://www.lumine.ne.jp/shinjuku/floorguide/ | 2026-11-10 13:05 JST | No tenant research file → not transcribed | No | GAP: never captured as tenant directory. |
| ルミネエスト新宿 | https://www.lumine.ne.jp/est/floorguide/ | 2026-11-10 13:05 JST | No tenant research file → not transcribed | No | GAP: never captured as tenant directory. |

Marui's floor-guide introduction feeds contain 62 / 57 / 37 entries: HealthyTOKYO CBD Shop ＆ Cafe is absent from 本館, ビック・ママ is added on アネックス 7F, and ヴィヴィアン・ウエストウッド マン is absent from メン. The 005 shop-list feed supplied the new row's printed kana. Marui comparison covered IDs, names, floors and categories. Hours were compared against the batch 3 entries from the three facility JSON files. The 2026-10-25 JST index-only reconciliation in the research file remains historical.

Keio's JSON was compared by source ID, name, printed floor and sales-floor category. Store-wide hours match batch 4. Odakyu's 28 result pages contain 272 rows; excluding the same four services and two rotating spaces as the original capture leaves 266. The three absent rows are ジューススタンド バブルス, パステル and フレグランス. Its hours page is byte-identical to the 2026-11-03 JST batch 4 receipt. The original rights classes are retained; the Odakyu terms response is byte-identical to the 2026-11-03 JST receipt, and the relevant Marui and Keio terms wording remains as recorded. Isetan's Group ID terms still carry the 2026-10-05 JST revision and the recorded scope; its directory did not answer. Takashimaya's terms could not be re-read.

The LUMINE gap concerns the tenant-directory input: there is no `shinjuku-lumine*-tenants.json`. Earlier `shinjuku-merchants-batch2.json` and its log contain separate shop POI transcriptions (230 combined for ルミネ1/2 and 245 for エスト); those are not a tenant research file, and no new transcription was started. The two LUMINE hours pages are byte-identical to their 2026-11-03 JST batch 4 receipts.
