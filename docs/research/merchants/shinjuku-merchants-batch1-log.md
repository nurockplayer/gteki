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

## 4. Odakyu Ace (removed under OD-34; redacted)
- Directory read 2026-10-24T08:54:54Z: https://www.odakyu-sc.com/odakyu-ace/shopsearch/category/ and its category views, plus individual shop detail pages. Listed 44; after the lead review 43. All of them were later removed under OD-34 (see the end). Store codes, names and page text from this directory are redacted from this log.

## 5. Keio Mall / Keio Mall Annex (removed under OD-34; redacted)
- Directory read 2026-10-24T08:54:54Z: https://ekishop.keio-sc.jp/keiomall-keiomallannex/ and individual shop detail pages. Listed 24 京王モール + 5 京王モールアネックス = 29 shops (1 ATM excluded). All of them were later removed under OD-34 (see the end). Store codes, names and page text from this directory are redacted from this log.

## Lead review (2026-10-24)

The first transcription was re-checked against the raw HTML of each source. For the Toei and Tokyo Metro entries that remain: full-width spaces kept as printed; Tokyo Metro prints LAWSON METRO'S with 新宿東口店 as a separate label, so the name is LAWSON METRO'S and 新宿東口店 goes in notes (same as Ikebukuro `shop-ikb-metro-001`). The Odakyu Ace and Keio Mall entries were also re-checked (names, promotional prefixes, two delisted shops, one missed shop, closure notices) before they were removed under OD-34; those details are redacted here. oracle-ego (GPT-6) reviewed the batch at that stage.

## OD-34 removal (2026-10-24)

The terms of the Odakyu SC portal (https://www.odakyu-sc.com/sitepolicy/) and Keio SC (https://www.keiosc.co.jp/sitepolicy/), read 2026-10-24T09:42Z, refuse every use of the sites' content data, with no legal exception (paraphrased; not quoted). The director ruled (OD-34) that they get OD-02 A treatment, overturning the earlier OD-33 facts-only ruling for these two sites. Sections 4 and 5 above keep only the URLs and counts (store identifiers, names and page text redacted after review): none of their 72 entries is in the JSON, and the SC directories may not be used as a source or a cross-check. The same shops may come in later from each chain's own store page. The batch is now 6 POIs (Toei 1, Toei Shinjuku-nishiguchi 1, Tokyo Metro 4).
