# Shinjuku merchants batch 1 transcription log

Read time recorded in UTC: 2026-10-24T08:54:54Z. Directory pages are undated unless noted. Only names, source codes, and printed area labels were transcribed; no descriptions, hours, images, or layouts were used. Each POI remains unverified/search-only for routing purposes.

## 1. Toei Shinjuku Station
- Pages read: https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html — 2026-10-24T08:54:54Z.
- Counts: listed 1 shop; imported 1; skipped 0; excluded: 2 コインロッカー, 証明写真機, ATM（みずほ銀行）.
- Imported: カレーショップC＆C; area B1階改札外コンコース（2出口付近）. No uncertain name.
- Category markers removed: none. ID: no store code in a detail URL; sequential page order `shop-sjk-toei-001` (the page's A is a placement marker, not a store code).

## 2. Toei Shinjuku-nishiguchi
- Pages read: https://www.opendata.metro.tokyo.lg.jp/kotsu/other/other_stores_shinjuku-nishiguchi.csv — 2026-10-24T08:54:54Z; CSV decoded from Shift-JIS to stdout, not saved. Dataset catalog states last updated 2025-01-30.
- Counts: listed 1 shop; imported 1; skipped 0; excluded: 2 コインロッカー, 証明写真機, ATM（みずほ銀行）, ATM（ゆうちょ銀行）, ATM（セブン銀行）, ベビーカーレンタルサービス（ベビカル）, 育児用品自動販売機.
- Imported: ファミリーマート（ミニ・コンビニ）; area B3階改札外コンコース（JR新宿駅方面改札付近）. No uncertain name.
- Category markers removed: none. ID: no detail URL code; sequential page order `shop-sjk-toeinishi-001`.

## 3. Tokyo Metro Shinjuku Station
- Pages read: https://www.tokyometro.jp/station/shinjuku/shop/index.html — 2026-10-24T08:54:54Z; named shop detail pages https://www.tokyometro.jp/station/shinjuku/shop/lawson_metros.html, https://www.tokyometro.jp/station/shinjuku/shop/ootoribanana.html, https://www.tokyometro.jp/station/shinjuku/shop/ms.html, https://www.tokyometro.jp/station/shinjuku/shop/misterminit.html — read during the same UTC session.
- Counts: listed 4 named shops; imported 4; skipped 2 unnamed 期間限定ショップ listings; excluded 証明写真, ATM・りそな銀行, ATM・セブン銀行, ATM・みずほ銀行, コインロッカー, 東京メトロッカー＋（Tokyo Metlocker PLUS）, モバイルバッテリーレンタル機, モバイルWi-fiレンタル機.
- Imported in page order: LAWSON METRO'S 新宿東口店; OOTORI BANANA (A8出入口付近); MS・Style; ミスターミニット 新宿東口店. No uncertain names.
- Dropped the category marker （売店） from the Lawson label. No store code was present in a detail URL; IDs are 3-digit page-order sequences `shop-sjk-metro-001` through `004`. SEARCH_ONLY used when no area/zone/floor field was printed.

## 4. Odakyu Ace
- Pages read: https://www.odakyu-sc.com/odakyu-ace/shopsearch/category/ (all results, 44 items), plus category views https://www.odakyu-sc.com/odakyu-ace/shopsearch/category/101, /103, /104, /105, /102 — 2026-10-24T08:54:54Z; individual shop detail URLs use `https://www.odakyu-sc.com/odakyu-ace/shop/detail/<code>?tenant_cd=<code>` and were opened one at a time. Codes in page order: 100021, 100071, 100145, 100311, 100330, 1003321, 100350, 100400, 100811, 101504, 101822, 101960, 103050, 103314, 103315, 103316, 103317, 103319, 103320, 103322, 103323, 103324, 103325, 103326, 103327, 103329, 103330, 103331, 103332, 103334, 103336, 103337, 103338, 103339, 103340, 103341, 103342, 103344, 103345, 103347, 103348, 103349, 103350, 103351. Details were read sequentially; exact per-page retrieval instants were not separately captured.
- Counts (first transcription, superseded by the lead review below): listed 44; imported 44; skipped 0; excluded 0. Final: 43. Category views deduplicated against the all-results list. No category icons/markers removed.
- Uncertain name: all-results listing prints デリパのひろば for code 103325 while its detail page title prints デリパのちか弁; the listing text was imported as the requested directory-list transcription. The ライフスタイル category view (`/102`) returned a reader cache miss; shop names were checked against the all-results list, which reports 44 total.
- ID rule: use each numeric shop code from its detail URL, e.g. `shop-sjk-odakyuace-100021`.

## 5. Keio Mall / Keio Mall Annex
- Pages read: https://ekishop.keio-sc.jp/keiomall-keiomallannex/ — 2026-10-24T08:54:54Z; individual detail URLs `https://ekishop.keio-sc.jp/keiomall-keiomallannex/shop/detail/?scd=<code>` were opened one at a time.
- Counts: listed 24 京王モール shops and 5 京王モールアネックス shops; imported 29; skipped 0; excluded セブン銀行ATM.
- The a-1 through a-24 and b-1 through b-5 directory placement codes were not copied into names. Source detail codes in listing order: 000758, 000759, 000760, 000761, 000762, 000763, 000764, 000765, 000766, 000767, 000768, 000769, 000770, 000771, 000883, 000773, 000774, 000935, 000776, 000777, 000778, 000779, 000780, 000842, 000782, 000783, 000784, 000867, 000865. Alias recorded only for the printed reading in 粥餐庁(かゆさんちん): ja-Hrkt かゆさんちん. No uncertain names.
- ID rule: preserve the detail URL `scd` as the code, including leading zeroes, e.g. `shop-sjk-keio-000758`. No category markers removed.

## Lead review (2026-10-24)

Odakyu Ace and Keio Mall names were re-extracted from the raw directory HTML (Odakyu Ace card `alt` text, Keio Mall `shopname`) and compared with this transcription: 72 of 78 entries checked character for character, plus the Tokyo Metro page by verbatim quote. Changes:
- Full-width spaces restored where the reader had turned them into half-width (だし茶漬け＋肉うどん　えん, 箱根そば本陣　小田急エース北館店).
- Promotional prefixes dropped from names: 3/28オープン (箱根そば本陣　小田急エース北館店), 【10月9日NEW OPEN】 (AMERICAN HOLIC).
- Dropped: サラダデリ MARGO (`1003321`) and パステル (`103326`): neither is on the current directory, and their detail pages return 404.
- Added: いい菜＆ゼストプラス (`103352`, 北館内 SHINJUKU DELISH PARK), which is on the directory but was missed. Odakyu Ace is now 43, matching the 43 codes on the page.
- Tokyo Metro: the page prints LAWSON METRO'S with 新宿東口店 as a separate label, so the name is LAWSON METRO'S and 新宿東口店 goes in notes (same as Ikebukuro `shop-ikb-metro-001`).
- 粥餐庁 is printed 粥餐庁(かゆさんちん); the reading in parentheses is the alias.
- Every Odakyu Ace and Keio Mall detail page was re-read for closure notices: none is closed. Odakyu Ace `100350` prints 【臨時休業】設備不良のため、現在休業中です (temporarily closed); it is kept, and its notes already say current status is unknown, as for every entry. Neither site prints readings other than the 粥餐庁 one.
- Result: 78 POIs (Toei 1, Toei Shinjuku-nishiguchi 1, Tokyo Metro 4, Odakyu Ace 43, Keio Mall 29).
- oracle-ego (GPT-6) review: Keio Mall entries name 京王モール or 京王モールアネックス in notes, so their method is AREA_ONLY (was SEARCH_ONLY); the Odakyu Ace source note now gives the final 43.
