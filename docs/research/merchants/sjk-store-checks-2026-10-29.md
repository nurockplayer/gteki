# 新宿 store desk checks, 2026-10-29: 小田急百貨店 新宿店 state, 新宿マルイ メン access

- Task: coverage-sjk-ikb row 42 (小田急百貨店 新宿店 — "verify current rebuild state") and row 39 (新宿マルイ メン — station access "?").
- Read 2026-10-29 07:55–07:57 JST (2026-10-28 22:55–22:57Z). Times in this file are UTC with the JST equivalent.
- Method: `curl -sS -L`, default User-Agent, no added headers, one request at a time ~1 s apart, 12 requests of the 14 allowed. No browser, no JavaScript execution, no login, no forms. Pages parsed with `python3 -I`. Nothing was imported into the bundle by this task; no data files changed.
- Rights: facts only. 小田急百貨店's site policy has no use clause (OD-34 second round: only 「Copyright© 2026 Odakyu Department Store Co.,Ltd. All rights reserved.」). `0101.co.jp` was already read 2026-10-25 with no quoted ban clause ([`dept-store-terms-2026-10-25.md`](dept-store-terms-2026-10-25.md) §2 row 3); that record is cited below instead of re-read. Every quote below is one sentence or shorter, with its URL and retrieval time.

## Fetch log

| # | UTC | JST | Page | URL | Status | Bytes |
|---|---|---|---|---|---|---|
| 1 | 2026-10-28T22:55:09Z | 2026-10-29 07:55:09 | 小田急 新宿店 top | `https://www.odakyu-dept.co.jp/shinjuku/` | 200 | 76,402 |
| 2 | 2026-10-28T22:55:10Z | 07:55:10 | 小田急 営業時間・アクセス | `https://www.odakyu-dept.co.jp/shinjuku/hour_acces/index.html` | 200 | 21,493 |
| 3 | 2026-10-28T22:55:34Z | 07:55:34 | 小田急 access notice PDF (top-page news list) | `https://www.odakyu-dept.co.jp/info/v4l5d000001cquyy-att/20250917.pdf` | 200 (`application/pdf`) | 542,206 |
| 4 | 2026-10-28T22:55:43Z | 07:55:43 | 小田急 お知らせ index | `https://www.odakyu-dept.co.jp/info/index.html` | 200 | 9,318 |
| 5 | 2026-10-28T22:55:44Z | 07:55:44 | マルイ メン アクセス | `https://www.0101.co.jp/074/access/` | 200 | 26,514 |
| 6 | 2026-10-28T22:55:45Z | 07:55:45 | マルイ メン top | `https://www.0101.co.jp/074/` | 200 | 61,688 |
| 7 | 2026-10-28T22:56:13Z | 07:56:13 | マルイ メン フロアガイド | `https://www.0101.co.jp/074/info/` | 200 | 29,047 |
| 8 | 2026-10-28T22:56:25Z | 07:56:25 | マルイ メン 施設案内 | `https://www.0101.co.jp/074/facility/` | 200 | 25,821 |
| 9 | 2026-10-28T22:56:30Z | 07:56:30 | マルイ site map | `https://www.0101.co.jp/sitemap/` | 200 | 63,470 |
| 10 | 2026-10-28T22:56:35Z | 07:56:35 | マルイ store constants (JS) | `https://www.0101.co.jp/assets/js/v1/stores/constant.js?date=20261015155651` | 200 | 74,510 |
| 11 | 2026-10-28T22:56:47Z | 07:56:47 | マルイ メン facility data (JSON the store pages load) | `https://www.0101.co.jp/contents2/facilityinfo/074/facility.json` | 200 (`application/json`) | 11,700 |
| 12 | 2026-10-28T22:56:48Z | 07:56:48 | マルイ メン announcements (JSON) | `https://www.0101.co.jp/contents2/announce/074/emgncy_announce_list.json` | 200 (`application/json`) | 405 |

No GAP: every request returned 200, no challenge page, no JS-only dead end for the facts below (requests 9–12 exist because the train-access text is not in the server-rendered HTML).

## A. 小田急百貨店 新宿店 (row 42)

### Where it operates now, as printed

- 営業時間・アクセス page (request 2): 「新宿店 新宿西口ハルクで営業しております。」 — building named 新宿西口ハルク, as on 2026-10-24.
- Floors under 「営業日・時間」 on the same page: 「■地下2階～2階 10：00→20：30（※日曜・祝日は20：00まで）」 and 「■7階 10：00→20：00」. So the store prints two blocks: 地下2階～2階 and 7階.
- 新宿店 top (request 1) carries a topic placing a sales floor on M2階: 「場所 新宿店M2階＝ハルクスポーツ＜ジャックバニー＞」. M2階 is printed but not in the hours block.
- Address as printed (request 2): 「〒160-8001 東京都新宿区西新宿1丁目5番1号」, ナビダイヤル 0570-025-888. The same page also prints 「SHINJUKU DELISH PARK 小田急エース北館で営業しております。」 — the デリッシュパーク area is in 小田急エース北館, a different building from the store.

### Printed move / closure / access notice

- 新宿店 top (request 1), お知らせ list, six items dated 2026-10-26, 2026-10-22 (×2), 2026-09-23, 2026-04-01 and 2025-09-17. Only the last is about getting to the store: 「新宿駅西口駅前広場の動線変更に伴う電車・バスなどでお越しのお客さまの地上から小田急百貨店へのアクセス方法について」 (dated 2025-09-17, PDF request 3).
- That PDF prints 「■改定日 2025 年 9 月 27 日（土）未明より」 with a fallback 「当日、悪天候等やむを得ない事情により動線変更工事が実施されない場合は、１０月４日（土）未明に実施されます。」 Its reason is the ward project, not a store rebuild: 「東京都が推進する土地区画整理事業により新宿駅西口駅前広場が車中心から人中心の広場に再編され、歩行者の回遊性の向上が図られます。」
- The access sentence it prints, route ①: 「地上出口より青梅街道に向かって直進、「ユニクロ」が出店している新宿西口パレットビル前の横断歩道を新宿西口ハルクの館に向かってお進みください。」 followed by 「約３０ｍ直進すると右手に見える１階正面入口からご入店ください。」 Route ②: 「新宿エルタワー前（新宿西口ロータリー入口の交差点）の横断歩道を新宿西口ハルクの館に向かってお進みください。」 and 「渡った先「喫茶ピース」右手の入口からご入店ください。」
- The station exit is printed only as 「地上出口」, unnamed and unnumbered; the diagram labels 「西口地上」 and 「新たな歩行者動線」. No JR or Metro gate, exit number or passage name is printed.
- No 建替・閉館・移転・改装 notice appears on requests 1, 2 or 4: the お知らせ index (request 4) renders only two 注意喚起 items in HTML, and the 新宿店 top news list has none. Nothing on these pages states a rebuild, and nothing states a closing date.

### Comparison with the 2026-10-24 log

`shinjuku-odakyu-dept-log.md` recorded 「新宿店 新宿西口ハルクで営業しております。」 and that no entrance/connection label was printed. Both hold today: **the operating sentence is unchanged**. What this pass adds, not a change in the store's state:

- the 2025-09-17 notice and its 改定日 2025-09-27 (the 10-24 log did not read the news list or the PDF);
- the printed hours blocks and address (deliberately not imported on 10-24);
- the M2階 sales floor in the topics list, which the hours block does not cover.

The rebuild question in row 42 is answered only as far as the store's own pages go: it prints current operation in 新宿西口ハルク, no closure and no rebuild notice; those pages print nothing about the former 本館 building's state.

## B. 新宿マルイ メン (row 39)

### The access page itself

`https://www.0101.co.jp/074/access/` (request 5, read 2026-10-28T22:55:44Z / 2026-10-29 07:55:44 JST) prints three tabs — アクセス, 駐車場, 駐輪場 — and under them only 「Park　One　新宿マルイメン駐車場」 and 「駐車場までのルートのご案内」. It prints no train, gate, exit or passage line. This matches the 2026-10-25 record ([`store-entrances-2026-10-25.md`](store-entrances-2026-10-25.md), `shop-sjk-marui-men` row): unchanged.

### Station access as the store prints it elsewhere on its own site

The address and 最寄駅 lines are not in the server HTML of `/074/`, `/074/info/` or `/074/facility/` (0 hits for 新宿区 / 住所 / 徒歩 / 出口 / 改札). They are in `facility.json` (request 11, `updated` `20260710131446`), the data file those pages load:

- 住所 block: 「〒160-0022 東京都新宿区新宿5-16-4」 and 「新宿駅地下通路 E2口より徒歩1分」.
- 「新宿マルイメン 所在地のご案内」: 「住所：〒160-0022　東京都新宿区新宿5-16-4」, 「電話番号：03(3354)0101」, then 「最寄駅(徒歩ルート)」 —
  - 「新宿三丁目/東京メトロ副都心線　E2出口　220m約3分」
  - 「新宿三丁目/都営新宿線　C6出口　169m約3分」
  - 「新宿三丁目/東京メトロ丸ノ内線　B2出口　257m約4分」
- 通常営業時間 printed in the same file: 「11:00～20:00」 (not imported; out of scope here).

Printed as-is, the two blocks disagree on what E2 belongs to: the 住所 block says 「新宿駅地下通路 E2口」, the 所在地 block says 「新宿三丁目/東京メトロ副都心線 E2出口」. Both are recorded verbatim above; this file does not pick one. No JR line, JR gate, or 新宿駅 exit number is printed anywhere on the メン pages or in its data file.

Announcements (request 12, `updated` `20260730104342`) carry one item only — the 令和8年熊本地震 message — so no closure, move or access change is printed.

### Terms

`0101.co.jp` was read 2026-10-25 with no copyright, reproduction or content-use clause found: no 利用規約 page in the site map, the only rights statement the footer 「© MARUI CO.,LTD.」 ([`dept-store-terms-2026-10-25.md`](dept-store-terms-2026-10-25.md) §2 row 3). That record is cited rather than re-read, per the brief. Re-checked today at no extra request: the footer of `/074/` links only プライバシーポリシー, Cookieポリシー, サイトマップ, 商品のお取り扱い方法, お問い合わせ, 当サイトについて, ウェブアクセシビリティについて, and `/sitemap/` (request 9) contains no 利用規約 / 著作権 text. There is therefore no reuse clause to quote and no page to hash; classification stands at **facts only OK, no quoted ban clause**.

## What this changes

| Row | Cell | Now | After this desk check |
|---|---|---|---|
| 42 小田急百貨店 新宿店 | station access ("partial — 新宿西口ハルク operation recorded") | partial | stays **partial**: the building name and hours floors (地下2階～2階, 7階) are confirmed as printed, but the store prints only 「地上出口」 — no exit number, gate or passage — so no station element can be tied. The "verify current rebuild state" half of the next action is **done at the desk**: current operation printed, no closure or rebuild notice on the store's own pages |
| 42 | exits ("partial — entrance tie incomplete") | partial | **unchanged**; field item 39 still needed |
| 39 新宿マルイ メン | station access ("? — station access not established") | ? | **partial**: three printed 新宿三丁目駅 exits with distances and minutes (E2 220 m/約3分, C6 169 m/約3分, B2 257 m/約4分), plus the 住所 block's 「新宿駅地下通路 E2口より徒歩1分」. Printed text only — no adjacency or walkability claim |
| 39 | exits ("? — entrance needs field check") | ? | **still ?**; the printed exits are 新宿三丁目駅 exits, and whether any of them faces the store's own entrance door is unprinted |

Field items still needed (the checks that would close the exit cells):

- Row 42 → **item 39** 「小田急百貨店 新宿店 — the ground exit its 1階正面入口 opens onto」. Note: item 39 lives in [`field-run-2026-10-26.md`](../lines/field-run-2026-10-26.md) (line 389), not in `field-run-2026-11-01.md`, which has no 小田急百貨店 item at all (its New Shinjuku section jumps item 30 → 40). The brief's "row 42 → item 39 in field-run-2026-11-01.md" does not resolve; the coverage row and the 2026-10-26 sheet agree with each other.
- Row 39 → **item 42** 「新宿マルイ メン — whether any public entrance stands against a station element」 (field-run-2026-11-01.md line 439). This pass gives the field a numbered set of plates to look for (E2, C6, B2 at 新宿三丁目駅) where the item previously had none.

## Assumptions

- The brief asked for a fresh read of 0101's site policy with a quoted clause and sha256, but also said to cite an existing record instead of re-reading. The existing record found no clause; re-checked today the footer and site map still list no 利用規約, so nothing was fetched again and there is no clause or hash to record.
- `facility.json` is treated as the store's own first-party printing: it is served from `www.0101.co.jp` and loaded by the store's own pages. It is cited with its `updated` stamp and retrieval time, and its text is quoted, not copied wholesale.
- The two E2 attributions are both recorded as printed; resolving which station E2 belongs to is left to the data lane or the field, not decided here.
- Only this file was created. `coverage-sjk-ikb.md` was read, not edited, since another worker has it.

## Follow-ups

- The 新宿店 お知らせ index (`/info/index.html`) renders its list by JavaScript; only two 注意喚起 items were in the HTML. A full news sweep for 新宿店 notices would need either the shop-status PDF (`/info/v4l5d000000z6tsb-att/shinjuku-shop.pdf`, linked as 「営業状況変更店舗のお知らせはコチラ」, not fetched) or a browser — neither was in this brief.
- Row 42's exit cell could gain a second printed source: the 2026-10-26 field sheet's item 39 already quotes a store PDF (改定日 2025-09-27); that PDF and the 2025-09-17 notice appear to be the same document or siblings. Worth reconciling so one citation covers both.
- The メン site prints 「新宿マルイメン」 without the space in `facility_name` while the pages print 「新宿マルイ メン」; only the page form is used in this file.
