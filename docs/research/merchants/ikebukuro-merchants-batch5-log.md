# Ikebukuro merchants batch 5 — Seibu station shops (西武池袋駅 / エミオ池袋)

Batch 5 of the Ikebukuro merchant transcription (#211). Facts only: shop name, facility and
floor as printed, item category. No descriptions, hours, phone numbers, logos, images or maps
are transcribed into the JSON. Locations and entrances are not route evidence.

## Pages read

| URL | UTC | Method |
| --- | --- | --- |
| https://www.seibu-shop.jp/floorguide/station/?station=st01 | 2026-10-24T10:11Z | ego-lite, read-only, DOM text (`document.body.innerText` + table rows) |
| https://www.seibu-shop.jp/emio/floorguide/?emio=emio01 | 2026-10-24T10:12Z | ego-lite, read-only, DOM text + table rows + link list |
| https://www.seibu-shop.jp/emio/floorguide/detail/?scd=001261, 000597, 000598, 000514, 000513, 000515, 000687, 000512, 000516, 000599, 000600 | 2026-10-24T10:12Z | ego-lite, read-only, DOM text (facility label and closure check) |
| https://www.seibu-shop.jp/floorguide/detail/?scd=000901, 000902, 001157, 001177 | 2026-10-24T10:12Z | ego-lite, read-only, DOM text (facility label and closure check) |

One tab in one task space; the space was closed after the last read. No sign-ins, forms,
posts or uploads. The "大きい画像で見る" floor-map image was not opened (no maps or images
are transcribed).

## Counts

- Rows listed on the two directory pages: 16 (11 on the エミオ池袋 page, 5 on the 池袋 station page).
- Imported as POIs: 13 (11 エミオ池袋 shops, 2 宝くじ POIs from the 池袋 station page).
- Excluded: 3, listed below.

## Excluded entries

Non-shop entries, left out per the brief:

- `エミオ池袋` — facility heading row on the station page (アイテム: エミオ); the facility itself,
  not a shop. Its tenants are the 11 entries imported from the エミオ池袋 page.
- `西武バス 池袋駅案内所` (アイテム: 西武バス案内所) — bus information counter, not a shop.
- `ゆうちょ銀行 AＴM` (アイテム: AＴM) — ATM, not a shop.

Nothing outside 池袋 was imported. 西武池袋本店 (the Sogo & Seibu department store) was not
read or imported; it is not part of this portal section.

## Closures

No 営業終了, 閉店 with a past date, or 移転 notice was printed on any imported shop's detail
page or on either directory page. No shop was dropped as closed; nothing was listed as 臨時休業.

One false positive to record: the SWEETS BOX row and detail page contain the string 閉店 only in
the trading-hours note "※店舗入替日は9:00P.M.閉店" (closing time on tenant-change days). SWEETS BOX
is kept.

## Dropped promotional text

None. No shop name on either page carried a 【NEW OPEN】, 期間限定, リニューアル or similar prefix.
`SWEETS BOX` keeps its printed name; the 期間限定 wording appears only in its item category
(期間限定スイーツ), which is not part of the name.

## Readings

No kana reading was printed for any shop name on the listing or detail pages, so no `ja-Hrkt`
aliases were added. All `aliases` arrays are empty.

## Uncertain or unprinted fields

- **Floor/zone**: the エミオ池袋 listing and detail pages print the facility label (`エミオ 池袋`)
  but no floor. The 11 エミオ池袋 POIs therefore carry only the facility in their notes.
  `floorId` is null for every POI (no floor identifiers are available).
- **宝くじ 1F / 宝くじ 地下**: the station page prints the floor inside the shop name (link text
  `宝くじ 1F`, `宝くじ 地下`) and prints no facility name. The names are copied as printed; the
  notes state that `1F` / `地下` are part of the printed name and that facility and floor are
  unverified — no floor is assigned. `西武池袋駅` is the page context (the portal's 池袋 station
  page), not a verbatim facility label.
- **Missing MAP numbers**: the エミオ池袋 list runs 1–10 then 13 (11 and 12 absent); the station
  list runs 0, 2, 3, 4, - (1 absent). The pages print no reason. The missing numbers are not
  treated as closed shops and nothing was inferred for them; they may be map symbols for
  facilities (toilets, stairs) that the text list does not show. Flagged for the Lead.
- **Name spacing**: spacing is as printed. `そばダイニング　凛や` contains a full-width space
  (U+3000); the トモニー entries use half-width spaces and the full-width digit `１` in
  `トモニー 池袋駅１階改札内店`. `ゆうちょ銀行 AＴM` (excluded) also uses a full-width `Ｔ`.
- **Item categories** are printed (コーヒーショップ, コンビニエンスストア, 宝くじ, etc.) but are
  not carried into the JSON: the schema's `category` is the POI kind (`shop`), per the brief.

## Conventions

- POI ids use the shop code from the detail URL (`scd`), e.g. `shop-ikb-seibu-001261`; all 13
  ids come from printed codes, none from page order.
- Evidence method is `AREA_ONLY` for the 11 エミオ池袋 POIs (the facility label `エミオ 池袋` is
  printed on the page). The 2 宝くじ POIs are `SEARCH_ONLY`: the station page prints only the
  池袋 station heading, with no facility or floor label, so the `AREA_ONLY` rule is not met.
- `paid` is null everywhere; 改札内 wording in shop names was not used to derive it.
- Sources: two `REFERENCE_ONLY` / facts-only entries under OD-34, decision
  https://github.com/nurockplayer/gteki/pull/377#issuecomment-6382878896 (2026-10-24).
- JSON validated with Python `json.load` after writing.
