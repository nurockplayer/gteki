# 小田急百貨店 新宿店 — store POI and brand tenants (facts only)

- Task: data-research-05 brief, 2026-10-24. Branch `ds/odakyu-dept-shinjuku` from `origin/main` (`e1d4a71a`), worktree `.claude/worktrees/ds-research`.
- Outputs: `shinjuku-odakyu-dept.json` (1 store POI), `shinjuku-odakyu-dept-tenants.json` (271 tenants), this log.
- Source ruling: OD-23 / OD-31 / OD-33 (facts only, REFERENCE_ONLY). No rights decision was made here.

## Pages read

Method: `curl -sSL` (default UA, no custom headers, no referer) to stdout/files under `/tmp`, one request at a time ~0.3 s apart, parsed with `python3 -I`. No browser, no JavaScript, no login.

| Page | URL | UTC |
| --- | --- | --- |
| Brand list p1 | `https://www.odakyu-dept.co.jp/sitesearch/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97` (301 → `http://sitesearch.odakyu-dept.co.jp/brand/result/?store=%E6%96%B0%E5%AE%BF%E5%BA%97`) | 2026-10-24T09:35:02Z |
| Brand list p2–p28 | `https://www.odakyu-dept.co.jp/sitesearch/brand/result/?lang=ja&page=<N>&store=%E6%96%B0%E5%AE%BF%E5%BA%97&q=` | 2026-10-24T09:35:23Z – 09:35:35Z |
| Store top | `https://www.odakyu-dept.co.jp/shinjuku/` | 2026-10-24T09:36:06Z |
| 営業時間・アクセス | `https://www.odakyu-dept.co.jp/shinjuku/hour_acces/index.html` | 2026-10-24T09:36:13Z |

All 28 brand-list pages returned HTTP 200 after the p1 redirect (the site redirects to plain `http://` on `sitesearch.odakyu-dept.co.jp`; no fake scheme was forced).

## Counts

- Printed total: `該当件数：275件` on every page.
- Rows read: 275 (10 per page × 27 pages + 5 on p28). All 28 pages read; no page failed.
- Imported tenants: **271** (275 − 4 service entries; no duplicates).

## Duplicates

- Exact duplicates of name + フロア + 売場: **0**, nothing removed.
- Same name, different floor or 売場 — kept as separate rows: `グッチ ★` (2 rows, 1階, インターナショナルブティック（※紳士雑貨も取り扱いあり） / （※紳士雑貨）), `サンローラン ★` (2 rows, 1階), `シャネル ★` (2 rows, 1階 / 地下1階).

## Excluded as services (4, not in the tenants file)

| Name (as printed) | フロア | 売場 |
| --- | --- | --- |
| インテリアコンサルティングカウンター ★ | ７階 | インテリア |
| ギフトサロン ★ | ２階 | ギフトサロン |
| 商品券 | ７階 | 商品券 |
| 時計修理工房 | ７階 | 時計修理工房・掛置時計 |

Nothing for hours, ATMs, lounges, toilets or parking was printed on the brand list, so nothing else was excluded. Brand counters inside the ギフトサロン 売場 (e.g. 赤ちゃんの城, ウォーターマン, ミキハウス) were kept; only the service counter named ギフトサロン was dropped.

## Dropped promotional text

- None. No name in the 275 rows carries a 【NEW】, 期間限定 or similar prefix/suffix. Nothing was rewritten.
- `★` is printed after the name in 165 imported rows (and in 2 excluded rows); it is part of the printed name and was kept. Its meaning is not printed, so it is not interpreted. `ReD★` prints the star with no space.
- Names, フロア and 売場 are copied verbatim (full-width digits/kana/brackets, U+3000 in `硝子工房　彩鳳`, `※` inside 売場 parentheticals are all as printed). Phone numbers printed after `<br>` in each shop cell are not part of the name and were not copied.

## Uncertain names (kept as printed, flagged for the Lead)

These read as generic item/counter labels rather than brand names, but the source prints them as rows:

- `サングラス`, `掛置時計 ★`, `時計バンド ★`, `補聴器（アイテム）` (７階, メガネ／時計修理 areas)
- `和洋酒` (地下２階, 売場 和洋酒), `鍋・ケトル ★`, `曲げわっぱ ★` (２階)
- `ゴールドサロン ★` (７階, 宝飾) — store-run counter, not a brand
- `有賀園ゴルフスクール プログレス` (７階, ゴルフスクール受付) — school/reception, kept as a named tenant

- `ギャラリーレア` (１階) prints no 売場, so `category` is `null`.
- フロア values `M２階` and `小田急エース北館` are printed as such and were kept verbatim; no mapping to station floors was attempted.

## Store POI

- Name as printed: `小田急百貨店 新宿店` (top page title: `新宿店TOP | 小田急百貨店`).
- Entrance/connection short labels (e.g. `地下1階 小田急線・地下鉄連絡口`): **none printed** on `/shinjuku/` or `/shinjuku/hour_acces/index.html`. The POI notes say so; no entrance was invented.
- The アクセス page prints `新宿店 新宿西口ハルクで営業しております。`; this is recorded in the POI note as the store's own wording. Hours, address and phone printed there were not imported (not in scope, and no dated source).

## Ids

The brand list prints no per-brand code, so tenant ids are a 3-digit sequence in list order across pages (`tenant-sjk-odakyudept-001` … `-271`), assigned after the 4 service exclusions.

## Validation

- `python3 -I -c "import json; json.load(...)"` on both files: parse OK.

## Lead review (2026-10-24)

- `★` is a marker printed between the name and the phone number, not part of the name; it is stripped from every tenant name.
- The store POI notes now say only what the store prints (operating in 新宿西口ハルク); the absence of entrance labels stays in this log, not in user-facing notes.
- Generic counter labels (サングラス, 和洋酒, …) are kept as printed rows: the tenant dataset is not imported as POIs, and core-search decides how tenant search treats them.
