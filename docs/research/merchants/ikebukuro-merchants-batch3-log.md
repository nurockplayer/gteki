# Transcription log: Ikebukuro batch 3

- URL: https://www.tokyometro.jp/station/ikebukuro/shop/index.html
- Read time (UTC): 2026-10-24 (WebFetch, two passes; second pass asked for verbatim names and labels). Exact time not recorded.
- Pagination: none on the page (only a back-to-top link). Single page read.
- Method: WebFetch plain-text summaries only. No browser, no downloads, no forms, no oracle.

## Counts
- Listed: 46
- Imported: 7 (shop-ikb-mr-001 to 007)
- Skipped: 24
- Excluded (non-shop): 15

## Imported (page order)
1. shop-ikb-mr-001 （売店）LAWSON METRO'S, label 池袋南西口店 (AREA_ONLY)
2. shop-ikb-mr-002 Wrapped Crepe Korot（ラップドクレープコロット） (reading as alias, SEARCH_ONLY)
3. shop-ikb-mr-003 Rainbow SPECTRUM（レインボー スペクトラム）, reading as alias (SEARCH_ONLY)
4. shop-ikb-mr-004 SENCE OF PLACE byURBAN RESEARCH (SEARCH_ONLY)
5. shop-ikb-mr-005 キュービーハウス (SEARCH_ONLY)
6. shop-ikb-mr-006 Esola池袋, listed under 駅周辺の施設・店舗 (SEARCH_ONLY)
7. shop-ikb-mr-007 24時間フィットネスジム　LifeFit 上池袋店, listed under 駅周辺の施設・店舗 (SEARCH_ONLY)

## Skipped: exact name already in existing-names.txt (18)
ローソン, 成城石井, マツモトキヨシ, 立喰美登利, はなまるうどん, スターバックスコーヒー, MR.waffle, KINTAN IN THE HOUSE, 梅丘寿司の美登利, Soup Stock Tokyo, クリスピー・クリーム・ドーナツ, 一等米おにぎり専門店　ぼんたぼんた, RANDA CLEPORTE, atelier haruka, ラフィネ, ミスターミニット, 開運館E&E, iCure鍼灸接骨院

## Skipped: Echika label (5)
- 銀座　篝（ギンザ　カガリ）, label Echika fit池袋
- Patio de METRO（パティオ ドゥ メトロ）, label Echika池袋内 (also in existing list)
- リンツ ショコラ ブティック, label Echika池袋 (also in existing list)
- Tabio, label Echika池袋 (also in existing list)
- ACCESSORIES　BLOSSOM, label Echika池袋内

## Skipped: Echika site link (1)
- Echika Echika（エチカ）池袋 公式サイト

## Excluded: non-shop facilities (15)
- 証明写真 (photo booth service)
- 期間限定ショップ (temporary shop slot, no shop name)
- ATM・セブン銀行, ATM・みずほ銀行, ATM・三井住友銀行, ATM・三菱UFJ銀行, ATM・ゆうちょ銀行, ATM・中央労働金庫, ATM・千葉銀行
- 外貨自動両替機・CITV, 外貨自動両替機・アクトプロ
- コインロッカー
- 東京メトロッカー＋（Tokyo Metlocker PLUS）
- モバイルバッテリーレンタル機
- CocoDesk (service desk)

## Uncertain names and possible duplicates
- SENCE OF PLACE byURBAN RESEARCH: the fetched text prints "SENCE". The existing list has "SENSE OF PLACE by URBAN RESEARCH". Imported as printed. The source's own spelling could not be confirmed by the text tool. Possible duplicate of an existing entry.
- Rainbow SPECTRUM: the existing list has "レインボースペクトラム" (Japanese only). Imported as printed. Possible duplicate.
- キュービーハウス: the existing list has "QBハウス". Different printed name, imported. Possible duplicate.
- （売店）LAWSON METRO'S: the leading （売店） is kept as part of the printed name. The apostrophe is a straight quote as returned by the tool. Possible duplicate of the existing ローソン entry (a different shop name).
- Full-width spaces (U+3000) in names could not be verified against the live page through the text tool.
- Esola池袋 and 24時間フィットネスジム　LifeFit 上池袋店 are labelled 駅周辺の施設・店舗 (around the station) on the page. They are not station-internal; kept as search-only directory entries.
- The page prints a notice on 開運館E&E (ラヴィアン蓉子はインターネット予約のみ). Not copied (descriptive text).

## Not done
- No hours, descriptions, photos, maps, or logos copied.
- No sources added (tokyometro-ikebukuro-shops-2026-10 already exists).

## Lead review (2026-10-24)

Rechecked against the page (WebFetch, verbatim quote). Changes:
- IDs renamed to `shop-ikb-metro-<NNN>`: the worker's `shop-ikb-mr-*` ids collided with batch 1 and are not used.
- `（売店）` is a category marker and is dropped: the name is LAWSON METRO'S; 池袋南西口店 stays in notes. It is listed separately from the コンビニ entry ローソン (Echika), so it is kept as a distinct shop.
- Dropped as likely duplicates of batch 2 Echika entries: SENCE OF PLACE byURBAN RESEARCH (printed so on this page; Echika prints SENSE OF PLACE by URBAN RESEARCH, `shop-ikb-echika-1100`), Rainbow SPECTRUM (`shop-ikb-echika-1106` レインボースペクトラム), キュービーハウス (`shop-ikb-echika-1085` QBハウス).
- Dropped as outside the station (labelled 駅周辺): Esola池袋 (a building; its own directory is a later batch), 24時間フィットネスジム　LifeFit 上池袋店.
- Result: 2 POIs (shop-ikb-metro-001 LAWSON METRO'S, shop-ikb-metro-002 Wrapped Crepe Korot with the printed kana alias).
- 池袋南西口店 is a branch name, not a place in the station, so the LAWSON entry is SEARCH_ONLY.
