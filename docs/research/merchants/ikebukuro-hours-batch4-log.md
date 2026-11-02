# Ikebukuro hours batch 4 — 東武百貨店 池袋店 refetch (OD-32)

Facts only. Requested by the merchant lead (w6:p16, 2026-11-02 08:2x JST): refetch 東武百貨店's hours; keep UNKNOWN if none is printed. Read by the data lead (data-research-05). Plain `curl -sL`, default User-Agent, sequential; pages parsed in memory and deleted.

| # | URL | Time (UTC) | HTTP | Bytes | Result |
|---|---|---|---|---|---|
| 1 | https://www.tobu-dept.jp/ikebukuro/ | 2026-11-01T23:22:09Z | 200 | 55,551 | 「営業時間」 is a link to /ikebukuro/tnb/open/ only |
| 2 | https://www.tobu-dept.jp/ikebukuro/access/ | 2026-11-01T23:22:09Z | 200 | 17,591 | same link, no hours text |
| 3 | https://www.tobu-dept.jp/ikebukuro/info/ | 2026-11-01T23:22:09Z | 404 | 1,567 | guessed path |
| 4 | https://www.tobu-dept.jp/ikebukuro/hours/ | 2026-11-01T23:22:10Z | 404 | 1,567 | guessed path |
| 5 | https://www.tobu-dept.jp/ikebukuro/tnb/open/ | 2026-11-01T23:22:23Z | 200 | 17,128 | 「東武百貨店　池袋店　営業時間のご案内」: a COVID-19 notice, see below |

## Result

Page 5 is the store's hours page. Its only store-level hours are in ≪営業時間変更のお知らせ≫: 「厚生労働省から発表された「新型コロナウイルス感染症対策の基本方針」をふまえ、お客様ならびに従業員の健康と安全確保の観点から、3月3日(火)より当面の間、下記の通り全館の営業時間を変更いたします。」, then 【変更後の営業時間】 ■午前11時～午後8時. No year is printed. The cited policy and the weekday date the notice to 2020-03-03. OD-32: hours stay null when the source date is older than 180 days, so nothing is imported and `shop-ikb-tobudept` keeps `status: UNKNOWN` (unchanged in `graph.src.json`). The page also lists hours for individual restaurants and services; they are not this POI's hours and are not taken.

Rights: tobu-dept.jp facts are usable (OD-34 §2); hours are facts.
