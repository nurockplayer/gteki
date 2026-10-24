# Shinjuku shop recovery batch 1 — log (小田急エース / 京王モール)

Worker: ds-research (DeepSeek-V4.1-Flash). Date: 2026-10-24.
Brief: data-research-05, following the director ruling (gteki-1b, OD-34 follow-up): the Odakyu Ace and Keio Mall
directory sites refuse all use of their content, so their shops may come back only from each shop's or chain's
own store page.

## Rules applied

- Only `docs/research/merchants/shinjuku-recovery-batch1.json` and this log were added.
- **Never opened or read**: `odakyu-sc.com`, `keiosc.co.jp`, `keio-sc.jp` (incl. `ekishop.keio-sc.jp`), `keio-mall.jp`,
  `jreast.co.jp`, `ecute.jp`, `jr-cross.co.jp`, `tobu.co.jp`. None of these appear as a source anywhere in the JSON.
  Search results surfaced them; they were skipped, not fetched, and their titles/snippets were not used as data.
- Aggregators (NAVITIME, マピオン, 食べログ, Yahoo!マップ, Retty, ホットペッパー, Uber Eats, 出前館, fashion-press,
  lipscosme, 開店閉店.com, etc.) were used as **leads only**. No aggregator is a source.
- Acceptance test: the shop's own site, or its chain's official store locator, has a page that names the shop as being
  in 小田急エース (北館/南館) or 京王モール / 京王モールアネックス. That page is the single source.
- Names are copied exactly as printed on that page — including pages that print only the branch name (眼鏡市場,
  クリスピー・クリーム・ドーナツ, MIGNON, ファミリーマート, TSUTSUMI print 「新宿京王モール店」「小田急エース北館店」
  「新宿小田急エース店」「小田急エース店」 without the chain name). The chain name is recorded in the source
  `publisher`, not added to the POI name.
- No descriptions, hours, phone numbers, images or logos were taken.
- Dates: all retrieval on 2026-10-24, window 2026-10-24T10:50Z–11:00Z. `retrievedAt` in the JSON is minute-precision
  from the session clock (±2 min); it is not a claim of second-level accuracy.

## Search queries used (text only)

1. `小田急エース 店舗 新宿`
2. `京王モール 店舗 新宿`
3. `"小田急エース北館" 店舗`
4. `"京王モールアネックス" 店舗`
5. `吉野家 新宿京王モール店 店舗情報`
6. `眼鏡市場 新宿京王モール店`
7. `ドトールコーヒーショップ 新宿京王モール店 店舗情報`
8. `ダイソー 京王モールアネックス店 店舗情報 公式`
9. `新宿高野 新宿小田急エースショップ 店舗`
10. `カラダファクトリー 新宿京王モールアネックス店`
11. `アトリエはるか 新宿京王モールアネックス店`
12. `AMERICAN HOLIC 京王モール店 店舗情報`
13. `クリスピー・クリーム・ドーナツ 小田急エース北館店 店舗`
14. `site:krispykreme.jp 小田急エース` (returned no `site:` hits)
15. `ストライプインターナショナル AMERICAN HOLIC 店舗一覧 京王モール`
16. `"京王モール" 店舗 公式 ストア 一覧 -odakyu-sc -keio-sc`
17. `京王モール カフェ ベーカリー 店 新宿 南口地下街`
18. `小田急エース スイーツ ベーカリー 店 新宿 西口地下街`
19. `Cafeルノアール 新宿京王モール店 店舗情報 銀座ルノアール`
20. `MIGNON 新宿小田急エース店 公式 店舗`
21. `ポンパドウル 小田急エース店 店舗情報`
22. `mignon-mini-croissant.com 店舗一覧 ショップ`
23. `ポンパドウル 店舗検索 小田急新宿店 pompadour.co.jp shop`
24. `俺のBakery&Cafe 新宿京王モール 公式 店舗`
25. `ビアードパパ 小田急エース店 店舗 公式`
26. `Green Parks 京王モール店 店舗 ストライプ`
27. `ビアードパパ 店舗検索 beardpapa.jp 新宿`
28. `パステル 新宿小田急エース店 公式 店舗`
29. `サボテン とんかつ 新宿 小田急エース 店舗 公式`
30. `JINS 小田急エース店 店舗 公式`
31. `ファミリーマート 小田急エース店 店舗 公式`
32. `store-jp.jins.com 新宿小田急エース店 店舗詳細`
33. `京王モール ラーメン そば 店舗 公式 店`
34. `十割蕎麦 嵯峨谷 新宿京王モール店 公式 店舗`
35. `ミスタードーナツ 小田急エース 店舗 公式`
36. `"小田急エース南館" 店 公式 店舗情報`
37. `京王モール コンビニ ドラッグストア 店舗 新宿 南口`
38. `おだむすび 小田急エース南館店 小田急レストランシステム 店舗紹介`
39. `サンドラッグ 新宿京王モール店 店舗情報 公式 サンドラッグ`
40. `ORBIS 新宿西口小田急エース南館店 店舗 公式`
41. `タリーズコーヒー 京王モール 店舗 公式`
42. `京王モール カレー 定食 店舗 公式 新宿`
43. `粥餐庁 新宿京王モール店 グリーンハウスフーズ 店舗`
44. `"カレーハウス11イマサ 新宿京王モール店" ghf.co.jp`
45. `京王モール 靴 雑貨 アパレル 店 公式 店舗情報 新宿`
46. `小田急エース 化粧品 雑貨 店 公式 店舗情報`
47. `HIBIYA KADAN 小田急エース店 公式 店舗`
48. `京王モール 菓子 スイーツ 店舗 公式 ショップ`
49. `Wrapped Crepe Korot 新宿京王モールアネックス店 公式 店舗`
50. `京王モール 1000円 カット 美容 店舗 公式 新宿`
51. `ココカラファイン 小田急エース店 店舗情報 公式`
52. `サンドラッグ 新宿京王モール店 sundrug.co.jp 店舗`
53. `京王モール 靴修理 クリーニング 店舗 公式 新宿`
54. `ミスターミニット 京王モールアネックス店 店舗情報 ミスターミニット公式`
55. `小田急エース 靴 バッグ 店舗 公式 新宿 西口地下街`
56. `京王モール ネイル 美容室 店舗 公式 新宿`
57. `Zoff 小田急エース店 店舗 公式`
58. `リーガルシューズ 新宿小田急エース店 店舗 公式`

## Terms / site-policy check (one visit per site used)

| site | policy page consulted | reuse clause | decision |
|---|---|---|---|
| odakyu-restaurant.jp | none found (`/sitepolicy/`, `/terms/` 404; only privacy & social-media policies linked) | none | use |
| stores.yoshinoya.com / yoshinoya.com | `/sitepolicy/` | prohibits copy/adapt/sale/upload **「法律上許容される範囲を超えて」** — legal exception express | use |
| zetteria.jp | `/terms/` | mobile-order terms only; no content-reuse clause | use |
| doutor.co.jp | `/terms/` | 「当社に無断で使用または複製もしくは転載することを禁止します」 | use — standard reservation, "無断" qualifier, not a flat 「一切お断り」; flagged for Lead |
| meganeichiba.jp | `/shop/pages/terms.aspx` | 第14条: 「無断で複製、転載、改変、その他の二次利用をすることはできません」; map data separately restricted | use — "無断" qualifier; flagged for Lead |
| daiso-sangyo.co.jp | none (`/privacy` only) | none | use |
| karada39.com | none (`/privacy/` only) | none | use |
| haruka.co.jp | none (`/privacy/` only) | copyright line only | use |
| krispykreme.jp | `/sitepolicy/` | 「私的利用の範囲を超えて…複製、改変、貸与、配布などにより使用、公開または転用することを禁じます」; licence obtainable | use — private-use exception is express; flagged for Lead |
| bake.take-eats.jp | none (`bake-jp.com/privacypolicy/` only) | none | use |
| ginza-renoir.co.jp | `/sitepolicy.html` | 「個人利用など著作権法によって認められる場合を除き、著作権者の事前の許可なく、これらの情報を利用することは出来ません」 — legal exception express | use |
| mignon-mini-croissant.com | none found | none | use |
| store.family.co.jp | none found | copyright line only | use |
| foryou-group.co.jp | none (`/privacy/` only) | none | use |
| tsutsumi.co.jp | store page footer links ご利用規約 on the online shop (`tsutsumishop.jp`); no clause on the locator page | none on the locator | use |
| shop.hibiyakadan.com | `/ext/guide/copyright.html` linked; no 利用規約 | copyright line only | use |

No site checked used 「一切お断り」 or an equivalent total refusal. Where a "no unauthorized reuse" clause exists,
the qualifier 「無断で」 / 「法律上許容される範囲」 / 「私的利用…を除き」 leaves a legal exception, so per the brief the
chain was not skipped. **The rights call stays with the Lead** — the doutor, meganeichiba and krispykreme rows are
the three to look at first.

## Leads and outcomes

Confirmed on the shop's own page (18) and the exact location wording each page prints. After the lead review, 15 are in the JSON; rows 5, 6 and 15 (ドトール ×2, 眼鏡市場) are not used under the OD-34 ruling and sit in `removed[]` (see the end):

| # | printed shop name | own page (URL) | UTC | exact location words on the page |
|---|---|---|---|---|
| 1 | 新宿小田急エース店 (ゼッテリア) | https://maps.zetteria.jp/shop/shop2312.html | 10:50 | shop name 「新宿小田急エース店」; 住所 「〒160-0023 東京都新宿区西新宿1」 — no 北館/南館 |
| 2 | 箱根そば本陣　小田急エース北館店 | https://www.odakyu-restaurant.jp/shop/hakonesoba/hakonesoba-honjin/ace-north.html | 10:51 | 住所 「東京都新宿区西新宿一丁目西口地下街1号 小田急エース北館」; 「各路線新宿駅から地下道直結」 |
| 3 | 箱根そば本陣　小田急エース南館店 | https://www.odakyu-restaurant.jp/shop/hakonesoba/hakonesoba-honjin/ace-south.html | 10:53 | 住所 「東京都新宿区西新宿一丁目西口地下街1号 小田急エース南館」 |
| 4 | 吉野家 新宿京王モール店 | https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_061476 | 10:52 | 店名に「京王モール」; 住所 「〒160-0023 東京都新宿区西新宿１丁目１南口地下街」 — no block/floor |
| 5 | ドトールコーヒーショップ 新宿京王モール店 **[not used, OD-34]** | https://shop.doutor.co.jp/doutor/spot/detail?code=1012430 | 10:56 | 住所 「〒160-0023 東京都新宿区 西新宿 １‐１ 京王モール Ｂ１Ｆ　第Ｄ‐４号区画」 |
| 6 | 新宿京王モール店 (眼鏡市場) **[not used, OD-34]** | https://shop.meganeichiba.jp/meganeichiba/spot/detail?code=00896 | 10:56 | 店名・住所「〒160-0023 東京都新宿区西新宿１－１ 京王モールＢ１Ｆ」 |
| 7 | DAISO 京王モールアネックス店 | https://www.daiso-sangyo.co.jp/shop/detail/002645 | 10:57 | 所在地 「東京都新宿区西新宿1丁目19番地京王モールアネックス内」 |
| 8 | カラダファクトリー 新宿京王モールアネックス店 | https://salon.karada39.com/detail/942/ | 10:57 | 所在地 「〒160-0023 東京都新宿区西新宿1丁目19 京王モールアネックスB1F」; 本文「京王モールアネックス地下街（B1F）にございます。」 |
| 9 | アトリエはるか 新宿京王モール アネックス店 | https://www.haruka.co.jp/salon/082/ | 10:58 | 住所 「〒160-0023 東京都新宿区西新宿1-19 京王モール アネックス」; 注記「※京王モールと京王モールアネックスは別の通りとなります」 |
| 10 | 小田急エース北館店 (クリスピー・クリーム・ドーナツ) | https://krispykreme.jp/store/tokyo/odakyuace.html | 10:58 | 住所 「東京都新宿区西新宿1丁目西口地下街1号　小田急エース北館」 |
| 11 | PRESS BUTTER SAND 新宿小田急エース店 | https://bake.take-eats.jp/select-shop-info/3549 | 10:58 | 住所 「〒160-0023 東京都新宿区西新宿一丁目西口地下街１号 小田急エース 北館」 |
| 12 | Cafeルノアール 新宿京王モール店 | https://www.ginza-renoir.co.jp/shopsearch/shops/tokyo/shinjuku-ku/caferenoir-shinjuku-keio-mall.html | 10:59 | 住所 「〒160-0023 東京都新宿区西新宿1-南口地下街1 京王モール第A-5区画」 |
| 13 | 新宿小田急エース店 (MIGNON) | https://mignon-mini-croissant.com/open-shinjuku-2022/ | 10:59 | 「〒160-0023 東京都新宿区西新宿1丁目西口地下街1号 小田急エース南館」 — also the official shop list on the site root |
| 14 | 小田急エース店 (ファミリーマート) | https://store.family.co.jp/points/21520 | 10:59 | 店名「小田急エース店」; 住所 「東京都新宿区西新宿１丁目 西口地下街１号」 — no 北館/南館 |
| 15 | ドトールコーヒーショップ 新宿京王モールアネックス店 **[not used, OD-34]** | https://shop.doutor.co.jp/doutor/spot/detail?code=1012046 | 10:59 | 店名に「新宿京王モールアネックス店」; 住所 「〒160-0023 東京都新宿区 西新宿 １‐１９」 |
| 16 | 十割蕎麦 さがたに 新宿京王モール店 | http://foryou-group.co.jp/brandfc/kantou/entry-86.html | 10:59 | 住所 「東京都新宿区西新宿1-1　京王モールB-4区画」 |
| 17 | 新宿京王モール店 (TSUTSUMI) | https://www.tsutsumi.co.jp/shop/detail/tokyo/1624.html | 10:59 | 住所 「東京都新宿区西新宿1-1 京王モールB1F」 |
| 18 | 日比谷花壇 新宿小田急エース店 | https://shop.hibiyakadan.com/detail/80640/ | 11:00 | 住所 「〒160-0023 東京都新宿区西新宿１丁目１ 小田急エース」; アクセス欄「小田急エース南館 ロッテリアさん向かい」 |

Method for every accepted row: read the chain's own store page only; recorded the printed name and the printed
location words; no other field taken. `evidence.method` = `facts-only chain store page (OD-34), UNVERIFIED, AREA_ONLY`.

Rejected or unconfirmed leads (name only + outcome):

| lead | outcome | note |
|---|---|---|
| 新宿高野 新宿小田急エースショップ | closed (relocated) | takano.jp 「小田急エースショップ　移設のお知らせ」 (posted 2025.09.17): moved to 小田急ハルク店 on 10/17. 移設 → not accepted |
| パステル 新宿小田急エース店 | closed | pastel-pudding.com shop list and shop page print 「※2026年10月24日(土)閉店」 |
| ねこねこチーズケーキ 新宿小田急エース店 | closed | nekonekocheesecake.com shop page prints 「※2026年10月24日(土)閉店」 |
| Green Parks 京王モール | closed | stripe-club.com/real-store/1000001305 prints 「Green Parks 京王モール【閉店】」 |
| ポンパドウル 小田急新宿店 | no own page | no store page on pompadour.co.jp found; only a 2022 「新宿店移転のお知らせ」 topic about moving *into* 小田急エース北館 |
| 俺のBakery＆Cafe 新宿京王モール | no own page | oreno.co.jp/restaurant/bakerycafe_keiomall/ returned 404 |
| カレーハウス11イマサ 新宿京王モール店 | no own page (site down) | ghf.co.jp serves a maintenance notice; shop pages 404 |
| 粥餐庁 新宿京王モール店 | no own page (site down) | same — ghf.co.jp under maintenance |
| ビアードパパ 新宿小田急エース店 | no own page readable | beardpapa.jp/shop/ is a JS locator with no store data in the HTML |
| ロッテリア 新宿小田急エース店 | no own page readable | lotteria.jp store detail returns HTTP 403 |
| JINS 新宿小田急エース店 | no own page readable | store-jp.jins.com returns HTTP 403 |
| ココカラファイン薬局 小田急エース店 | no own page readable | matsukiyococokara-online.com store page returns HTTP 403 |
| とんかつ新宿さぼてん 本店小田急エース南館店 | no own page readable | shinjuku-saboten.com fails TLS verification (and `www.` host does not resolve) |
| Wrapped Crepe Korot 新宿京王モールアネックス店 | no own page readable | korot.jp/shop/keio_shinjyuku.html returns 404; some aggregators also list it as closed |
| ミスターミニット 京王モールアネックス店 | no own page readable | minit.co.jp/shopsearch/detail/849 returns 404; one aggregator says closed, others say open — unresolved |
| サンドラッグ 新宿京王モール店 | no own page | no store page on sundrug.co.jp surfaced |
| ORBIS 新宿西口小田急エース南館店 | other | no official store page found; an aggregator records a 2021-01-13 closure — current status unresolved, not accepted |
| ミスタードーナツ 新宿小田急エースショップ | other | only a 2017 opening release; a 2020 summary lists it as closed; no current official store page found |
| AMERICAN HOLIC 京王モール店 | no own page | only a press release (opened 2026-10-09); stripe-club locator search returned no match for this store |
| ジ・エンポリアム 京王モール アネックス | no own page | only aggregators surfaced |
| タリーズコーヒー 京王モール | no own page | no current store in the chain locator surfaced |
| QB HOUSE 京王モールアネックス店 | no own page | aggregator/recruitment listings only |
| Zoff 小田急エース北館店 | no own page | zoff.co.jp store search has no entry in its HTML; only aggregators list the shop |
| リーガルシューズ 新宿小田急エース店 | no own page | no page on the REGAL site surfaced; one aggregator marks it closed |
| おだむすび 小田急エース南館店 | no own page | described only as a counter inside the 箱根そば本陣 南館 page; no separate store page |
| リモーネプラス 京王モール店 | no own page readable | keionet.com page returned 「メンテナンス中」 |
| 新宿デリッシュパーク | other | a 小田急百貨店 food-floor area inside 小田急エース北館, not a shop; not accepted as a POI |
| ABCマート GRAND STAGE / KEEN / FANS. / ミスターミニット(京王百貨店1F・5F) | other | 京王百貨店新宿店 floors, not 京王モール; out of scope |

Terms-ban rejections: none. No site used stated 「一切お断り」.

## Totals

- Final (after the lead review): **15 POIs** in the JSON, 15 sources, 3 in `removed[]` (ドトール ×2, 眼鏡市場: terms ban reuse; OD-34 ruling).
  - 京王モール: 吉野家, Cafeルノアール, さがたに, TSUTSUMI — 4
  - 京王モールアネックス: DAISO, カラダファクトリー, アトリエはるか — 3
  - 小田急エース北館: 箱根そば本陣(北館), クリスピー・クリーム・ドーナツ, PRESS BUTTER SAND — 3
  - 小田急エース南館: 箱根そば本陣(南館), MIGNON, 日比谷花壇 — 3
  - 小田急エース (wing not printed): ゼッテリア, ファミリーマート — 2
  - So 7 on 京王モール / アネックス and 8 on 小田急エース.
- First pass (worker): 18 confirmed (10 京王モール / アネックス, 8 小田急エース), 18 sources, `removed` empty.
- Leads examined: 46 (18 accepted + 28 not accepted).

## Open questions for the Lead (first pass; answered in the lead review below)

1. Six accepted POIs print only the branch name (ゼッテリア, 眼鏡市場, クリスピー・クリーム・ドーナツ, MIGNON,
   ファミリーマート, TSUTSUMI) — kept verbatim per the brief, so the POI name alone does not identify the chain.
   If the renderer needs a chain-qualified name, that is a Lead decision.
2. ゼッテリア, ファミリーマート print 小田急エース without 北館/南館. Accepted on the facility name alone;
   wing stays UNKNOWN.
3. ドトール, 眼鏡市場 and クリスピー・クリーム・ドーナツ have explicit "no unauthorized reuse" clauses (legal
   exceptions present). Not skipped, but the rights call is the Lead's.
4. `retrievedAt` is minute-precision and approximate (±2 min); the whole run was 2026-10-24T10:50Z–11:00Z.
5. Several shops closed on 2026-10-24 (パステル, ねこねこチーズケーキ) — same day as this run. That may be a
   single-operator closure of the SHINJUKU DELISH PARK confectionery counters and worth a check before the next batch.

## Lead review (2026-10-24, data-research-05)

- Names: six store pages print only the branch name in the body, but the same page's title names the chain. The POI name is now `<chain as in the page title> <branch name as printed>`, and the branch-only name is kept as an alias: rec-001 ゼッテリア, rec-010 クリスピー・クリーム・ドーナツ, rec-013 MIGNON, rec-014 ファミリーマート, rec-017 TSUTSUMI (and rec-006 眼鏡市場, held below).
- 北館/南館: rec-001 and rec-014 print only 「小田急エース」. Kept as printed; the building stays UNKNOWN.
- Terms: krispykreme.jp states a private-use exception, so it is the same type as LUMINE (facts only; kept). doutor.co.jp (「当社に無断で使用または複製もしくは転載することを禁止します」) and meganeichiba.jp (第14条 「無断で複製、転載、改変、その他の二次利用をすることはできません」) state no private-use or legal exception. Their 3 POIs (rec-005, rec-015 ドトール; rec-006 眼鏡市場) are held in `removed[]` pending a director ruling under OD-34. Their sources were dropped from the file.
- Result: 15 POIs in the file, 3 held.
- Director ruling (gteki-1b, 2026-10-24, OD-34): doutor.co.jp is the same wording type as ecute and meganeichiba.jp the same family as the Odakyu/Keio SC 二次利用 bans, so neither is used. The 3 POIs stay in `removed[]` and are candidates for the merchant self-service form (#438). Krispy Kreme (LUMINE type), the naming rule and the 北館/南館 UNKNOWN are confirmed.
