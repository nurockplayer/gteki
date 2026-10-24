# Station facilities batch 3 — Seibu Railway 池袋駅

Facts only (OD-25). Facility names and locations are transcribed as printed in the page text;
nothing was deduced and no route, floor, exit or gate was inferred. The station-map image and the
legend image were not opened or read. No text, logo, photo or layout was reproduced.

Output file: `ikebukuro-facilities-batch3.json` — 2 POIs (service 2: AED ×2).

Reads happened in one session on 2026-10-24. `retrievedAt` on the source object is the main page
read time below.

## Pages read

### 1. 池袋駅 ：西武鉄道Webサイト — https://www.seiburailway.jp/railway/station/ikebukuro/
- Time: 2026-10-24T11:15:58Z. Method: plain `curl`, default UA, no custom headers — HTTP 200,
  63,220 bytes, `text/html;charset=utf-8`. Read as extracted text, then the raw HTML was checked
  around `駅設備` / `駅からのお知らせ` / `駅施設の営業時間` to confirm no location was lost in
  extraction.
- Imported: service 2 — AED ×2, from the 駅からのお知らせ sentence
  `1F改札口付近およびB1F改札口付近にAED(自動体外式除細動器)を設置しております。`
  Locations used as printed: `1F改札口付近`, `B1F改札口付近`.
- Skipped as out of scope: `定期券うりば（B1・乗車券センター）`, `特急券うりば（1F）` (ticket
  sales windows, not one of the brief's facility types), `西武南口` (exit; exits are out of
  scope and already in the station data).
- Skipped, needs a lead decision: `お忘れ物取扱所（西武南口）` — a customer-facing counter with a
  printed location, but it is a lost-property counter rather than the brief's
  `駅事務室/案内所 for customers`. Not imported; reported to the lead.
- Facility labels with no printed location (駅設備 list): `トイレ`, `待合室`, `授乳室`,
  `駅ナカ・コンビニ「トモニ―」`; (バリアフリー設備 list) `エレベーター`, `エスカレーター`,
  `ワイド型改札機`, `ハンドル型電動車いす`, `バリアフリートイレ`, `触知案内板`,
  `点字手すりプレート`, `点字運賃表`. No location was printed for any of these in the text —
  positions exist only in the 駅構内のご案内 image (GAP below). Elevators/escalators/gates are out
  of scope anyway.

### 2. バリアフリー情報一覧 — https://www.seiburailway.jp/railway/barrierfree/list/
- Time: 2026-10-24T11:16:21Z. Method: plain `curl`, default UA — HTTP 200, 149,553 bytes.
  Reached from the station page's `バリアフリー情報一覧` link (same host).
- Content is a presence matrix only. 池袋 row, all columns printed `〇`:
  バリアフリートイレ / エレベーター / エスカレーター / ワイド型改札機 /
  ハンドル型電動車いすのご利用 / 点字触知図版 / 点字手すりプレート / 点字運賃表.
- Imported: none — the matrix prints no location, and a `〇` is presence, not a place.
  Recorded here so the absence is traceable.

### 3. バリアフリー情報 — https://www.seiburailway.jp/railway/barrierfree/
- Time: 2026-10-24T11:16:36Z. Method: plain `curl`, default UA — HTTP 200, 60,586 bytes.
- Generic guidance page; no 池袋駅 facility listing. The only 池袋 hits are the line/station names
  in the unattended-station and remote-support lists. Imported: none.

No other same-host page was read: the station page links no station-specific facility page
(checked `href`s; the only extra facility link is `池袋駅の店舗情報` → `www.seibu-shop.jp`, which is
excluded by the brief), and the barrier-free pages have no per-station detail page.

## GAP — facilities visible only in images/maps

- `駅構内のご案内`: image `/railway/station/image/SI01_1.png`, with the legend image
  `/railway/station/images/detail_guide_img002.png` behind 凡例. This is the only place the
  positions of `トイレ`, `待合室`, `授乳室`, `駅ナカ・コンビニ「トモニ―」` and `バリアフリートイレ`
  are shown. Not read (brief: images/maps are not read). → GAP for toilet, 授乳室 and any other
  facility location at this station.
- `エレベーター、エスカレーター、階段の位置`: images `si01_pos_10.png`, `si01_pos_8.png` — not
  read; out of scope as well.
- `池袋駅の店舗情報` → `www.seibu-shop.jp` — excluded by the brief (already done elsewhere).

## Totals

- Pages loaded: 3 (limit 15). No 403 / captcha / interstitial encountered.
- Printed facilities with a printed location: 6 → imported 2, skipped 4
  (2 ticket windows out of scope, 1 exit out of scope, 1 lost-property counter left to the lead).
- Facility labels without a printed location: 12 (see page 1); positions are image-only → GAP.
- JSON: 2 POIs, `removed` empty; `python3 -c "json.load(...)"` parses.

## Lead review (2026-10-24, data-research-05)

- お忘れ物取扱所（西武南口）: added as `service-ikb-seibu-003`. It is a customer-facing counter with a printed location. Total: 3 POIs.
- Facilities shown only on the station map image (toilets, waiting room, nursing room, barrier-free toilet) stay GAPs: images are not read.
