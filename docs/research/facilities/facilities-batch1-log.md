# Station facilities batch 1 — Tokyo Metro / Toei: Ikebukuro + Shinjuku

Facts only (OD-31 / OD-33). Facility names and locations are transcribed as printed by the
operator; nothing was deduced and no route, floor or exit was inferred. No images or PDFs were
read. No text, logo, photo or layout was reproduced.

Output files: `ikebukuro-facilities-batch1.json` (37 POIs), `shinjuku-facilities-batch1.json`
(24 POIs).

All reads happened in one session on 2026-10-24 (UTC 09:2x–09:49Z). `retrievedAt` in the new
source objects is the timestamp of the generation step (2026-10-24T09:48:44Z); the per-page
times below are the times the page was read, and the two Toei store pages carry the site's own
clock (`運行情報[18:47現在]`, `[18:48現在]` JST = 09:47Z, 09:48Z).

## Pages read

### 1. 東京メトロ 池袋駅 施設・店舗 — https://www.tokyometro.jp/station/ikebukuro/shop/index.html
- Time: 2026-10-24, ~09:30Z (approx.; exact minute not recorded). Method: WebFetch (plain
  HTTP first: `curl` got an HTTP 403 WAF block, 420 bytes, so WebFetch was used), then a second
  verbatim pass over the same cached page to re-check characters. The two passes agreed,
  including the full-width space in `有楽町線池袋駅　南西口改札外` and in
  `副都心線（改札内）西通路東改札下　１／２`.
- Imported: atm 12, locker 2, service 14 (証明写真 6, 外貨自動両替機 3, モバイルバッテリーレンタル機 2, CocoDesk 3).
- Skipped as out of scope: 30 shop / food entries (including the 売店 LAWSON METRO'S listing,
  期間限定ショップ ×2, 開運館E&E, iCure鍼灸接骨院) and 3 external-facility links (Echika池袋,
  Esola池袋, LifeFit). No ticket gates, platforms, exits, transfers, lifts or escalators are
  listed on this page.

### 2. 東京メトロ 池袋駅 バリアフリー設備 — https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html
- Time: 2026-10-24, ~09:44Z (approx.). Method: WebFetch, twice (second pass was a full
  row-by-row reproduction of the トイレ設備 section; both agreed).
- Imported: toilet 9 (丸ノ内線 / 有楽町線 / 副都心線 × 車いす対応トイレ・乳幼児用設備・オストメイト).
- Skipped: 9 rows printed なし (no facility). The エレベーター / エスカレーター / 階段昇降機
  sections were not transcribed at all — out of scope (lines-lead); their row counts are not
  recorded here.

### 3. 東京メトロ 新宿駅 施設・店舗 — https://www.tokyometro.jp/station/shinjuku/shop/index.html
- Time: 2026-10-24, ~09:40Z (approx.). Method: WebFetch (single verbatim pass).
- Imported: atm 3, locker 2, service 5 (証明写真 3, モバイルバッテリーレンタル機 1,
  モバイルWi-fiレンタル機 1).
- Skipped as out of scope: the page's shop / food entries were not enumerated (not requested
  and not transcribed). No ticket gates, platforms, exits, transfers, lifts or escalators are
  listed on this page.

### 4. 東京メトロ 新宿駅 バリアフリー設備 — https://www.tokyometro.jp/station/shinjuku/accessibility/index.html
- Time: 2026-10-24, ~09:45Z (approx.). Method: WebFetch, twice (the first pass filtered rows on
  its own judgement; the second reproduced every row of トイレ設備 verbatim).
- Imported: toilet 3 (車いす対応トイレ / 乳幼児用設備 / オストメイト, all 改札外 東改札外広場).
- Skipped: 3 rows printed なし. エレベーター / エスカレーター / 階段昇降機 not transcribed (out of scope).

### 5. 都営 新宿駅 店舗・コインロッカー・ATM等 — https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html
- Time: 2026-10-24T09:47Z (site clock 18:47 JST). Method: ego-lite, read-only, own task space.
  Plain HTTP returned the Incapsula interstitial (HTTP 200, 835 bytes, "Request unsuccessful");
  WebFetch returned an empty page. No sign-in, form, post or upload was made.
- Imported: locker 2 (B / C), service 1 (証明写真機 D), atm 1 (ATM（みずほ銀行）E).
- Skipped as out of scope: 1 shop (カレーショップC＆C).

### 6. 都営 新宿西口駅 店舗・コインロッカー・ATM等 — https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku-nishiguchi.html
- Time: 2026-10-24T09:48Z (site clock 18:48 JST). Method: ego-lite, read-only, same space.
- Imported: locker 3 (B / C / D), service 1 (証明写真機 E), atm 3 (F / G / H).
- Skipped as out of scope: 3 (ファミリーマート, ベビーカーレンタルサービス（ベビカル）,
  育児用品自動販売機).

### 7. 都営 新宿駅 — https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html
- Time: 2026-10-24T09:47Z. Method: ego-lite (same Incapsula behaviour).
- Imported: 0. The バリアフリー設備 section prints `バリアフリートイレ（車椅子使用者対応トイレ） :
  あり` for 新宿線 and for 大江戸線 with **no location**, so no POI was created.
- This page is the reason `toei-shinjuku-station-2026-10` appears in `sources` with no POIs
  citing it: it records what was checked and why nothing was imported.

### 8. 都営 新宿西口駅 — https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-nishiguchi.html
- Time: 2026-10-24T09:48Z. Method: ego-lite.
- Imported: 0. Same reason: `バリアフリートイレ（車椅子使用者対応トイレ） : あり`, no location.

Two index pages were opened only to find URLs (no data used):
`https://www.kotsu.metro.tokyo.jp/subway/stations/` and
`https://www.kotsu.metro.tokyo.jp/other/kanren/stores/`, both ego-lite, 09:45–09:47Z.

## Counts per category

| File | atm | locker | toilet | service | total |
|---|---|---|---|---|---|
| ikebukuro-facilities-batch1.json | 12 | 2 | 9 | 14 | 37 |
| shinjuku-facilities-batch1.json | 7 | 7 | 3 | 7 | 24 |

`shinjuku` breaks down as 東京メトロ 13 (atm 3, locker 2, toilet 3, service 5),
都営 新宿 4 (atm 1, locker 2, service 1), 都営 新宿西口 7 (atm 3, locker 3, service 1).

Skipped as out of scope, totals across all pages: ticket gates / platforms / exits / transfers /
lifts / escalators — 0 listed on any facility page; the accessibility pages' エレベーター・
エスカレーター・階段昇降機 sections were not transcribed. Shops and food: 30 entries on the
池袋 page + 1 on 都営 新宿 + 3 other in-scope-looking-but-excluded facilities on 都営 新宿西口
+ the 新宿 page's shop entries (not enumerated).

## Sources reused (not redefined in the JSON)

| id | defined where | note |
|---|---|---|
| `tokyometro-ikebukuro-shops-2026-10` | already on main (`stations/ikebukuro/gteki/station.json`) | same URL as read here |
| `tokyometro-shinjuku-shops-2026-10` | **open PR #418**, not on main at the base commit | same URL; merge order matters |
| `toei-shinjuku-stores-2026-10` | **open PR #418**, not on main at the base commit | same URL as read here |

New source objects added to the JSON: `tokyometro-ikebukuro-accessibility-2026-10`,
`tokyometro-shinjuku-accessibility-2026-10`, `toei-shinjuku-station-2026-10`,
`toei-shinjuku-nishiguchi-station-2026-10`, `toei-shinjuku-nishiguchi-stores-page-2026-10`.

**Id collision avoided:** PR #418 already defines `toei-shinjuku-nishiguchi-stores-2026-10` for
the Open Data CSV (`https://www.opendata.metro.tokyo.lg.jp/kotsu/other/other_stores_shinjuku-nishiguchi.csv`).
This batch reads the HTML page at a different URL, so it uses the distinct id
`toei-shinjuku-nishiguchi-stores-page-2026-10`.

## Uncertain items / decisions for the Lead

1. **`tokyometro-shinjuku-shops-2026-10` and `toei-shinjuku-stores-2026-10` are not on main.**
   They exist only in open PR #418 (base commit of this branch: `00420763`). If this PR merges
   first, those `sourceIds` dangle until #418 lands. Please decide the merge order, or ask for
   the two source objects to be inlined.
2. **乳幼児用設備 included as `toilet`.** The operator prints it as its own facility row; the
   page does not say it is inside a toilet. It is listed at the same printed 設置場所 as
   車いす対応トイレ and オストメイト on both stations, which is why it was included per the
   brief's "entries that are toilets or are inside toilets". Drop if the Lead disagrees.
3. **モバイルWi-fiレンタル機 (新宿, A8出入口付近) included** as `service` although it is not in
   the brief's enumerated list; the brief's `service` definition says "rental machines". It is
   a separate printed row from モバイルバッテリーレンタル機. Drop if unwanted.
4. **`コインロッカー` rows are aggregate.** 東京メトロ prints one row per station whose location
   cell is a sentence covering several lines (`以下の路線周辺にコインロッカーがあります` +
   `・丸ノ内線 …`). One POI per printed row was created (Ikebukuro: 3 lines; Shinjuku:
   1 line). Line breaks inside a printed cell were flattened to spaces; no characters changed.
5. **Toei names printed across two lines.** The facility-name cell prints `ATM` then
   `（みずほ銀行）` on the next line; joined without a separator as `ATM（みずほ銀行）`. Same for
   `ATM（ゆうちょ銀行）`, `ATM（セブン銀行）`.
6. **Toei toilets have no location.** 都営 新宿駅 (新宿線 and 大江戸線) and 新宿西口駅 each print
   `バリアフリートイレ（車椅子使用者対応トイレ） : あり` with no place name. Per the brief
   (only entries "listed as text with a location") they were skipped: 3 facilities skipped.
7. **Toilet POIs for 東京メトロ carry the line name as a prefix** (`丸ノ内線 中央通路東改札外広場`)
   because the 設置場所 is printed under a per-line heading; the place text itself is verbatim.
   The entry label is kept whole including its `（改札内）` / `（改札外）` suffix, since that is
   the printed label. `paid` was left `null` — 改札内/改札外 was not turned into a payment flag.
8. **都営 新宿 C ロッカー** is `B2階改札内コンコース（A1出口方駅務室横）`. The page's contact
   block names it `大江戸線新宿駅（Cのコインロッカー）`; that line attribution is not printed on
   the row itself, so it was not added to the POI note.
9. **No duplicates created.** The three existing facility POIs on main
   (`poi:toilet:1` トイレ（女性）（地下3階）, `poi:toilet:2` トイレ（男女共用）（地下3階）,
   `poi:toilet:3` トイレ（男性）（地下3階）, from the MLIT E27 map) are printed with a 地下3階
   location that does not match any 東京メトロ printed 設置場所 in this batch (`東改札外広場`),
   so they are **not** plainly the same toilet and were left untouched — no new B3 toilet was
   created either. 池袋 had no facility POIs on main.
10. **Transcription risk.** The two 東京メトロ shop pages were read through WebFetch, which
    converts the page before answering; exact characters were double-checked with a second
    verbatim pass, but a character-level diff against the raw HTML was not possible (the site
    returns 403 to plain HTTP). If character-exactness is critical for these, a re-read through
    ego-lite would remove the remaining doubt.

## Lead review (2026-10-24)

- Toilets: the Metro accessibility pages list 車いす対応トイレ, 乳幼児用設備 and オストメイト as separate rows at the same place. They are now one `toilet` POI per place, named 車いす対応トイレ, with the other two as facilities in notes (operator wording). The 改札内/改札外 label stays text in notes. Result: Ikebukuro 3 toilets (was 9), Shinjuku 1 (was 3). Ids are renumbered within this unmerged batch.
- Coin lockers: the Metro sentence 「以下の路線周辺にコインロッカーがあります」 is not copied. Notes give only the line names (e.g. 丸ノ内線・有楽町線・副都心線周辺).
- Merge order: the Shinjuku file reuses `tokyometro-shinjuku-shops-2026-10` and `toei-shinjuku-stores-2026-10`, which are defined in #418, so it merges after #418. The Ikebukuro file reuses source ids that are already in station data.
- Totals: Ikebukuro 31 POIs, Shinjuku 22.
