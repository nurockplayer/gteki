# Station facilities batch 2 — station buildings: Ikebukuro + Shinjuku

Facts only (OD-34). Facility labels and locations are transcribed as printed by the operator;
nothing was deduced, and no route, floor id or exit was inferred. Only the text of the official
facility / service / floor-guide pages below was read — no floor-guide images, PDFs, maps or
icons were opened, and no text, logo, photo or layout was reproduced.

Output files: `ikebukuro-facilities-batch2.json` (39 POIs), `shinjuku-facilities-batch2.json`
(31 POIs).

All reads happened in one session on 2026-10-24, window UTC 10:57–11:26Z (19:57–20:26 JST).
Method for every page: plain `curl`, default UA, no custom headers or referer, sequential with
≥0.3 s between requests. ego-lite was not needed (no page required JavaScript). Total: 42 HTTP
requests — 36 pages with content and 6 without (5 status-only probes, 2 of which were 404, plus
one more 404 page attempt).
`retrievedAt` in every source object is the generation timestamp (2026-10-24T11:04:19Z), not the
per-page read time; the per-page times below are approximate (exact minute not recorded).

Buildings with zero printed facilities are recorded here, not in the JSON: a source array only
lists pages that a POI actually cites.

## Pages read

### 1. ルミネ池袋 トップ — https://www.lumine.ne.jp/ikebukuro/
- Time: ~10:59Z. Method: curl. Link discovery only.
- Imported: 0. Links found: `/ikebukuro/floorguide/`, `/ikebukuro/information/`, `/ikebukuro/access/`.

### 2. ルミネ池袋 フロアガイド — https://www.lumine.ne.jp/ikebukuro/floorguide/
### 3. ルミネ池袋 フロアガイド 8F — https://www.lumine.ne.jp/ikebukuro/floorguide/?floor=8f
- Time: ~11:00Z, ~11:02Z. Method: curl.
- Imported: 0.
- The two requests return near-identical documents. The only facility text is the アイコン一覧 legend
  (女子トイレ / 男子トイレ / バリアフリートイレ / ベビー対応 / ベビー休憩室 / ベビーカー貸出／返却 /
  インフォメーション / ルミネカードカウンター / アイルミネ受取カウンター / ATM / ビューアルッテ /
  外貨両替機 / コインロッカー / カフェ / 喫煙ルーム / AED / Wi-Fi利用可能エリア / エレベーター /
  エスカレーター / 階段 / 改札口). The legend carries no location, and the per-floor facility icons
  are only in the floor-map images, which were not read (GAP, see below).

### 4. ルミネ池袋 サービス・施設案内 — https://www.lumine.ne.jp/ikebukuro/information/
- Time: ~11:01Z. Method: curl.
- Imported: 5 — service 3 (インフォメーション B1, 授乳室 6F TULLY’S COFFEE with U内, 授乳室 8F),
  toilet 2 (多目的トイレ 8F, 10F; both printed オストメイト機能あり).
- Printed and skipped as out of scope: ルミネカードカウンター 4F, アイルミネ受取カウンター 8F,
  anewloop 回収ボックス 4F / 買取カウンター 8F, Wi-Fi 利用可能エリア, 免税カウンター 3F, 配送サービス,
  ベビーカー貸出 B1 インフォメーション, キッズスペース 6F, 喫煙ルーム 8F, 補助犬.
- Printed, read as features only (not POIs): ベビーチェア (女性用 B1・2F～10F, 男性用
  B1・2F・5F・6F・8F・9F・10F, 多目的トイレ内 8F), おむつ替えベッド (女性用 B1・3F・4F・7F・9F,
  男性用 B1, 多目的トイレ内 8F・10F). Splitting them into per-floor toilet POIs would invent rooms
  the page does not print; the brief says ベビーチェア is a feature, so they stay here.

### 5. エソラ池袋 トップ — https://www.metropro-sc.jp/esola-ikebukuro/
- Time: ~11:03Z. Method: curl. Link discovery only.
- Imported: 0. No facility / service section exists on this site.

### 6–14. エソラ池袋 フロアガイド B1 / 1F–8F
- https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp (prints B1)
- https://www.metropro-sc.jp/esola-ikebukuro/shop/floor.jsp?fid=1f … `?fid=8f`
- Time: ~11:03Z (B1) and ~11:04–11:05Z (1F–8F). Method: curl.
- Imported: 7 — toilet 6 (3F トイレ(女子); 4F トイレ; 6F トイレ; 7F トイレ; 7F 車いす対応トイレ;
  8F トイレ), service 1 (授乳室 4F). Each is a facility badge printed in the floor's
  `floor_icon` block, not a shop row.
- Floors with no facility badge: B1, 1F, 2F, 5F.
- Skipped as out of scope: all shop rows on every floor.
- Uncertain: 3F prints only トイレ(女子) — no 男子 counterpart is printed on that page.
- GAP / trap: every Esola floor page contains the row `9 セブン銀行＜ATM＞ / ATM / 7:00-22:00`,
  but it sits inside an HTML comment (`<!--セブン銀行ATMのみ静的表示-->`) and is **not displayed**.
  It was therefore not imported anywhere; the same commented row appears on every Echika page.

### 15. エチカ池袋 トップ — https://www.metropro-sc.jp/echika-ikebukuro/
- Time: ~11:06Z. Method: curl.
- Imported: 0. No facility / service section.

### 16. エチカ池袋 フロアガイド — https://www.metropro-sc.jp/echika-ikebukuro/shop/floor.jsp
- Time: ~11:06Z. Method: curl.
- Imported: 0. The page has a single floor block (`f_bf`), no `floor_icon` facility badges, and
  no トイレ / ロッカー / 授乳室 text at all. The セブン銀行＜ATM＞ row is HTML-commented (see above).

### 17. エチカ池袋 交通アクセス — https://www.metropro-sc.jp/echika-ikebukuro/shop/access.jsp
- Time: ~11:07Z. Method: curl.
- Imported: 0. Address and access text only.

### 18–20. エミオ池袋 — https://www.seibu-shop.jp/emio/
- Time: ~11:08Z. Method: curl.
- https://www.seibu-shop.jp/emio/ikebukuro/ → HTTP 404 (probe). Site-wide navigation only at
  `/emio/`; the mall list links to `/emio/floorguide/?emio=emio01`.
- Imported: 0.

### 21. エミオ池袋 フロアガイド — https://www.seibu-shop.jp/emio/floorguide/?emio=emio01
- Time: ~11:09Z. Method: curl.
- Imported: 0. The page prints エミオ池袋, the address, a list of shop rows (including four
  トモニー stores labelled 改札内 / 改札外) and a floor-map **image** (`map_emio1.png`). No facility
  text of any kind is printed, and images were not read.

### 22. エミオ サービスページ — https://www.seibu-shop.jp/emio/use/
- Time: ~11:09Z. Method: curl. HTTP 404 — GAP: no service / facility page could be located for
  エミオ池袋 within seibu-shop.jp; no further URL guessing was done.

### 23. 東武百貨店 池袋店 トップ — https://www.tobu-dept.jp/ikebukuro/
- Time: ~11:10Z. Method: curl. Link discovery only. Imported: 0.

### 24. 東武百貨店 サービスガイド — https://www.tobu-dept.jp/ikebukuro/service/
- Time: ~11:10Z. Method: curl.
- Imported: 0. Section headings only (店内案内所 / 店内の便利なサービス / 施設・設備のサービス /
  お子様連れ / 女性 / 男性 / ご高齢 / 海外 / 売場のサービス), each linking to `information/detail/*`.

### 25. 東武百貨店 店内・施設のサービス — https://www.tobu-dept.jp/ikebukuro/information/detail/6
- Time: ~11:11Z. Method: curl.
- Imported: 10 — service 6 (店内案内所 B1F 3番地 お入口 / B1F 6番地 お入口 / B1F 8番地 お入口;
  AED（自動体外式除細動器）B1F 3番地 / B1F 8番地 / 4F 3番地), locker 4 (コインロッカー（有料）常温:
  1F 2番地 お入口, 2F 11番地 お入口, B2F 6番地 階段前, B2F 11番地).
- Imported from the same page, locker 3 more: 冷蔵 lockers at B2F 6番地 階段前, B2F 11番地, 1F 2番地
  (so 7 lockers in total from this page).
- Printed and skipped as out of scope: ショップ検索機, お忘れ物・落とし物, フィッティングボードのある
  化粧室 (see below), 水飲み場, 給水スポット, 電話, 商品券, お客様相談室, 理容室 ×1, 美容室 ×3,
  フォトスタジオ, クリーニング, リフォーム, 東武カード, 東武友の会.
- Printed, not imported: AED in staff areas — 2F 防犯センター, 2F 防災センター,
  6F 11番地 ロイヤルサロン事務所, 8F催事 事務所, 15F 賃貸事業部営業課 事務所, 別館5F受付,
  総合商品センター(下板橋)3F事務所（事務所内7台）. These are offices behind the sales floor, not
  customer facilities; the page's own count is 計10台 (3 売場内 + 7 事務所内).
- Printed without a per-floor list: 化粧室 — "1・2番地、6番地、11番地を中心に、1Fを除くほとんどのフロアに
  化粧室がございます". No floor list, so no ordinary-toilet POIs; the barrier-free list on page 27 is
  used instead.

### 26. 東武百貨店 お子様連れのお客様へのサービス — https://www.tobu-dept.jp/ikebukuro/information/detail/7
- Time: ~11:12Z. Method: curl.
- Imported: 2 — service ベビー休憩室 7F2番地 (授乳室:3室、おむつ交換台:5台、着替台:2台、
  ベビーチェア:6台、給湯器、おむつ・飲料自動販売機、電子レンジ) and ベビー休憩室 11F1番地
  (授乳室:個室3室・ソファ席、おむつ交換台:3台、着替台:1台、給湯器、飲料、電子レンジ).
- Printed and skipped as out of scope: コインロック式ベビーカート 1F 3番地 お入口,
  車イス・ベビーカー優先エレベーター, お子様専用のヘアーサロン 7F1番地, パンスト用フィッティングルーム.
- Printed, read as features only (not POIs): ベビーチェアのある化粧室, ベビーシートのある化粧室,
  お子様用補助便座がある化粧室, 婦人用にお子様用トイレがある化粧室 (2F2番地、4F6番地、4F11番地、
  5F11番地、6F6番地、6F11番地、7F2番地、7F11番地). Per the brief these are features of toilets, not
  separate places; turning the long 《…》 floor lists into POIs would duplicate the same rooms many
  times over.

### 27. 東武百貨店 ご高齢・お体の不自由なお客様へのサービス — https://www.tobu-dept.jp/ikebukuro/information/detail/8
- Time: ~11:12Z. Method: curl.
- Imported: 12 — toilet バリアフリートイレ at B2F 3番地, B2F 11番地, B1F 11番地, 3F 2番地,
  4F 2番地, 4F 11番地, 5F 2番地, 5F 11番地, 6F 2番地, 7F 11番地, 8F 2番地, and the printed range
  「11～15F」 as one POI. Note feature: 車イスで利用できる (the heading of the list).
- Printed and skipped as out of scope: 車イスのお貸出し (B1F8番地案内所、B1F6番地案内所、パーキング2),
  アテンドサービス, 優先エレベーター.
- Cross-check: page 25's フィッティングボードのある化粧室 (《バリアフリートイレ》 B2F 11番地、
  5F 11番地、7F 11番地、11～15F レストラン街スパイス) is a subset of this list and was not imported twice.

### 28. 東武百貨店 売場のサービス — https://www.tobu-dept.jp/ikebukuro/information/detail/9
- Time: ~11:12Z. Method: curl. Imported: 0 (sales-floor services only).

### 29. 東武百貨店 FAQ — https://www.tobu-dept.jp/ikebukuro/information/detail/36
- Time: ~11:25Z. Method: curl. Imported: 0 (FAQ index).

### 30. 東武百貨店 海外からのお客様へ — https://www.tobu-dept.jp/ikebukuro/information/detail/64
- Time: ~11:25Z. Method: curl. Imported: 0 — 免税手続き 2F1番地 and 外貨両替機 2F1番地 are
  printed, but neither is an ATM and neither is one of the brief's service kinds.

### 31. ルミネエスト新宿 トップ — https://www.lumine.ne.jp/est/
- Time: ~11:13Z. Method: curl. Link discovery only. Imported: 0.

### 32. ルミネエスト新宿 サービス・施設案内 — https://www.lumine.ne.jp/est/information/
- Time: ~11:13Z. Method: curl.
- Imported: 2 — service インフォメーション 1F, toilet 多目的トイレ B1 (オストメイト機能あり).
- Printed and skipped as out of scope: ルミネカードカウンター 6F, 免税サービス, 配送サービス, ベビーカー.
- Printed, read as features only (not POIs): ベビーチェア付トイレ (B2・B1・3F・4F・5F・6F・7F・8F),
  ベビーベッド付トイレ (B2・B1・3F・4F・6F・7F・8F). The page adds 「詳しい場所はフロアマップを
  ご確認ください」, so the floor list is not a room list.

### 33. ルミネ新宿 トップ — https://www.lumine.ne.jp/shinjuku/
- Time: ~11:14Z. Method: curl. Link discovery only. Imported: 0.

### 34. ルミネ新宿 サービス・施設案内 — https://www.lumine.ne.jp/shinjuku/information/
- Time: ~11:14Z. Method: curl.
- Imported: 7 — service 4 (インフォメーション ＜ルミネ1＞5F / ＜ルミネ2＞2F, 授乳室 ＜ルミネ1＞7F /
  ＜ルミネ2＞4F), toilet 3 (バリアフリートイレ ＜ルミネ1＞4F・7F, ＜ルミネ2＞2F（オストメイト機能付き）).
- Printed and skipped as out of scope: ルミネカードカウンター, アイルミネ受取カウンター,
  anewloop 買取・回収, ルミネカードWEB決済, 免税サービス, 配送サービス, ベビーカー貸出 ＜ルミネ1・2＞2F.
- Printed, read as features only (not POIs): ベビーチェア付トイレ (＜ルミネ1＞B2・4F・5F・6F・7F /
  ＜ルミネ2＞2F・4F・5F・7F), ベビーベッド付トイレ (＜ルミネ1＞4F・5F・6F・7F / ＜ルミネ2＞2F・3F・4F・5F),
  着替台付トイレ (＜ルミネ1＞4F、5F、7F(バリアフリートイレ) / ＜ルミネ2＞2F).

### 35. ニュウマン新宿 トップ — https://www.newoman.jp/shinjuku/
- Time: ~11:15Z. Method: curl. Link discovery only. Imported: 0.

### 36. ニュウマン新宿 サービス・施設案内 — https://www.newoman.jp/shinjuku/information/
- Time: ~11:15Z. Method: curl.
- Imported: 11 — service 2 (4F インフォメーション, 授乳室 4F), toilet 9 (お客さま用トイレ B1, M2,
  2F フードホール内, 4F, 6F, 7F; 多目的トイレ M2, 4F, 7F with オストメイト対応あり).
- お客さま用トイレ is the one page in this batch that prints a plain per-floor list of ordinary
  toilets, so it is imported one POI per printed floor as the brief allows.
- Printed and skipped as out of scope: ルミネカードカウンター 4F, アイルミネ受取カウンター 4F,
  anewloop 4F, CHARGESPOT 4F, Recute ヘアアイロン M2 女性用トイレ, 免税カウンター 4F, 配送,
  駐車サービス, 喫煙所 2F フードホール内, ベビーカー貸出 4F, 補助犬.
- Uncertain: the Recute row's location reads 「M2 女性用トイレ」 — a rental service inside a toilet,
  not a facility; skipped.

### 37. 小田急百貨店 新宿店 トップ — https://www.odakyu-dept.co.jp/shinjuku/
- Time: ~11:16Z. Method: curl. Link discovery only. Imported: 0.

### 38. 小田急百貨店 サービスガイド(新宿店) — https://www.odakyu-dept.co.jp/shinjuku/services/index.html
- Time: ~11:16Z. Method: curl.
- Imported: 1 — service サービスカウンター 地下1階. Plus the printed AED statement used as the
  feature text of the five AED POIs below (「AED(自動体外式除細動器)をM2階を除く全フロアへ設置して
  おります」).
- Printed and skipped as out of scope: 免税手続きカウンター 地下1階, 通訳・お買い物アテンド,
  ギフトサロン 2階, OPカードカウンター 7階, 団体購買 7階, 小田急友の会カウンター 7階,
  小田急ブライダル会員, 補助犬, ペット, オンラインショッピング店舗受け取り, インテリアコンサルティング,
  ご進物相談, メガネ相談, 補聴器診断, オーダー / 名入れ / 修理.
- Skipped with a question for the lead: ecbo cloak(エクボクローク) 2階＝ギフトサロン — a paid
  luggage-storage service, booked by app. It is not printed as a コインロッカー, so it was not
  filed under "locker"; the lead may want it reclassified.

### 39. 小田急百貨店 フロアガイド(新宿店) — https://www.odakyu-dept.co.jp/shinjuku/floorguide/index.html
- Time: ~11:17Z. Method: curl. Facility icons are printed per floor row (alt text read as the
  printed label).
- Imported: 10 — service 6 (AED 7F, 2F, 1F, B1F, B2F; 授乳室 7F), toilet 4 (ご婦人専用化粧室 7F;
  化粧室 2F, M2F, B2F).
- Printed and skipped as out of scope: おむつ交換台 7F (feature of the same floor's rooms),
  カードカウンター 7F, カフェ M2F, and every shop row.
- Floors with no facility icon: 8F (ハルクレストラン街), R, 7F has no 化粧室 icon other than
  「ご婦人専用化粧室」.
- Cross-check: the five AED floors agree with page 38's 「M2階を除く全フロア」 — M2F and 8F carry no
  AED icon.

## GAPs

1. **No ATM was imported anywhere.** Every ATM mention in the allowed pages was either a legend
   entry with no location (ルミネ池袋 アイコン一覧: ATM / ビューアルッテ) or a row inside an HTML
   comment (エソラ池袋 and エチカ池袋: `<!--セブン銀行ATMのみ静的表示-->`). Both files carry zero
   `atm` POIs. 東武百貨店 prints 外貨両替機 2F1番地 but no ATM; 小田急 prints no ATM.
2. **Floor-guide images were not read.** ルミネ池袋 / ルミネエスト新宿 / ルミネ新宿 and
   エミオ池袋 place their facility icons only inside floor-plan images; reading them was out of
   scope, so those buildings' ordinary-toilet floors are unknown from the pages allowed here.
3. **エチカ池袋 prints no facilities at all** on its top, floor-guide and access pages.
4. **エミオ池袋 has no findable facility page**: `/emio/ikebukuro/` is 404 and `/emio/use/` is 404;
   only the floor guide (shops + one map image) exists.
5. **エソラ池袋 B1 / 1F / 2F / 5F** print no facility badge.
6. **東武百貨店 化粧室** is described only as 「1Fを除くほとんどのフロア」 — no per-floor list, so
   only barrier-free toilets are recorded for that building.

## Totals (must match the JSON)

| file | sources | pois | toilet | atm | locker | service |
| --- | --- | --- | --- | --- | --- | --- |
| ikebukuro-facilities-batch2.json | 9 | 39 | 20 | 0 | 7 | 12 |
| shinjuku-facilities-batch2.json | 5 | 31 | 17 | 0 | 0 | 14 |

Per building:
- ルミネ池袋 — toilet 2, service 3 (5)
- エソラ池袋 — toilet 6, service 1 (7)
- エチカ池袋 — 0
- エミオ池袋 — 0
- 東武百貨店 池袋店 — toilet 12, locker 7, service 8 (27)
- ルミネエスト新宿 — toilet 1, service 1 (2)
- ルミネ新宿 — toilet 3, service 4 (7)
- ニュウマン新宿 — toilet 9, service 2 (11)
- 小田急百貨店 新宿店 — toilet 4, service 7 (11)

## Uncertain labels

- 東武百貨店 「11～15F」 (barrier-free toilets) is printed as a floor range; kept as one POI with
  the range as its location, not split.
- ニュウマン新宿 「M2」 is the operator's mid-floor label; kept verbatim.
- エソラ池袋 3F prints トイレ(女子) alone — no 男子 label on that page.
- 小田急百貨店 distinguishes 化粧室 from ご婦人専用化粧室; both are recorded under `toilet` with
  the printed label as the name.
- ルミネ新宿 「＜ルミネ2＞2F（オストメイト機能付き）」 — the parenthetical is treated as a feature.

No rights decision was taken here; every source is REFERENCE_ONLY / facts-only under OD-34, and
the 小田急 pages cite the second ruling comment as instructed.

## Lead review (2026-10-24, data-research-05)

- ecbo cloak(エクボクローク) 2階＝ギフトサロン: added as `service-sjk-odakyudept-008` (category service, not locker). It is a printed luggage-storage service with a printed location, which travellers search for.
- AED: the 5 Odakyu floor POIs stand, because the floor guide prints an AED icon on each of those floors. Tobu's staff-area AEDs stay out (not customer areas).
- ATMs printed only inside HTML comments or as legend icons without a place are correctly not imported (not printed for readers).
- Totals: Ikebukuro 39, Shinjuku 32.
