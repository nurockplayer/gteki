# Ikebukuro B1 merchant coverage audit — 2026-10-25

Data-side half of #212 (B1 first batch of merchant POIs). This records what the B1 merchant data
in `stations/ikebukuro/data/graph.src.json` already covers after the merchant import PRs, what is
still missing and why, and why this batch imports nothing new.

Base: `origin/main` 3d1ba278 (2026-10-25). Graph: 516 POIs, of which 348 `category: shop`;
484 POIs are search-only (`connectorNodeIds: []`, `displayPosition: null`), 0 POIs carry a
`displayPosition`.

## Method

Every entry of the reviewed merchant research was matched against `graph.src.json`: first by
`id`, then by printed name and alias with full-width/half-width spaces normalised. Research read
from `origin/main`: batch 2, batch 3, batch 5. Batch 4 was read from
`origin/claude/data-research-ikb-merchants-batch4` (its 210 entries already landed on main in
commit 8706ef79, #432). No source page was fetched for this audit except the Toei probe below;
the reviewed transcriptions from 2026-10-24 are the evidence.

## Result: reviewed research is imported, 0 entries missing

| Research | Entries | In graph |
| --- | --- | --- |
| batch 2 (ISP, 東武ホープセンター, エチカ池袋) | 118 | 118 |
| batch 3 (東京メトロ 駅構内店舗) | 2 | 2 |
| batch 5 (西武 エミオ池袋 / 池袋駅) | 13 | 13 |
| batch 4 (ルミネ池袋, エソラ池袋, 東武百貨店 store POI) | 210 | 210 |

IDs match one-for-one. Two cosmetic differences against the batch-4 branch: per-floor source ids
(`…-b1`, `…-4f`) are consolidated into one source id per building, and the 東武百貨店 POI note is
richer in the graph ("池袋駅西口 直結" plus the store wording).

## B1 slice

Areas as the sources print them. Only ルミネ池袋 and エソラ池袋 print a floor (B1); the two
underground malls, エチカ池袋 and the station page print zones or labels only, so no POI in this
table carries a `floorId` (all null) and nothing here asserts a level of its own.

| B1 area | Source | Listed | In graph |
| --- | --- | --- | --- |
| ルミネ池袋 B1 | lumine.ne.jp floorguide | 18 | 18 |
| エソラ池袋 B1 | metropro-sc.jp Esola floor guide | 8 records: 7 shops + セブン銀行＜ATM＞ | 7 |
| エチカ池袋 (改札外) | metropro-sc.jp Echika | 26 | 22, 4 accounted |
| 池袋ショッピングパーク (南館 33 / 北館 20 / レンガ通り 2) | web-isp.co.jp | 55 | 55 |
| 東武ホープセンター (サウス 23 / センター 12 / ノース 8) | tobuhopecenter.jp | 43 | 43 |
| 西武池袋駅 | seibu-shop.jp station portal | 5 rows: 2 shops + 1 heading + 2 non-shops | 2 (宝くじ 1F, 宝くじ 地下) |
| 東京メトロ 駅構内店舗 | tokyometro.jp station shop page | 46 | 2 after lead review (LAWSON METRO'S, Wrapped Crepe Korot); 3 dropped as Echika duplicates; 2 dropped as outside the station; 24 names already present; 15 non-shop facilities already present as `atm-*` / `service-*` / `locker-*` POIs |

The four Echika entries not imported: Patio de METRO and Tabio (retained in batch 1), Soup Stock
Tokyo (duplicate of `shop-ikb-mr-001`), フレッシュネスバーガー (shopid 1088, its own page prints
※7/14（火）営業終了).

The two 西武池袋駅 rows not imported are the 西武バス 池袋駅案内所 (bus information counter) and
ゆうちょ銀行 AＴM (ATM). They are not shops, and neither has a counterpart in the graph: the 12
`atm-ikb-metro-*` POIs are Tokyo Metro ATMs and no 西武バス counter exists.

## Not imported, and why

- **東武百貨店 B1F and B2F (85 + 97 tenant rows)**: OD-34(5) keeps department-store brand lists
  as facts-only tenant datasets, not POIs, until tenant search exists. The rows live in
  `docs/research/merchants/ikebukuro-tobu-dept-tenants.json` on the batch-4 branch; only the one
  store POI (東武百貨店 池袋店) is in the graph.
- **西武池袋本店 tenants**: corroboration only (OD-34 third round); no round reads its B1F.
- **JR East / ecute / 東武鉄道 / 小田急・京王 rail** (OD-02, OD-34(1)(3)(5)): none has an
  Ikebukuro B1 shop list used here.
- **チェーン店自身のページ** (doutor.co.jp, meganeichiba.jp) are OD-34 fourth-round bans, not used.

## GAPs

- **Toei**: the station page was probed on 2026-10-25 (two GETs, ≥0.6 s apart) and returned an
  Incapsula bot challenge, then 404 with a challenge body. Not bypassed; no Toei Ikebukuro shop
  or facility rows are read, so none are imported. Toei store lists stay facts-only under OD-34
  round 2 when reachable. The probe sent a browser user agent rather than curl's default string,
  a deviation from the batch brief's fetch rule; the challenge came back either way.
- **No verified entrances**: all 348 shop POIs are search-only. #212's "at least a small batch of
  `shop` POIs is indexed; unproven entrances are search-only" is met; routes and scene placement
  remain GAP until a field check.
- **Hours**: `ikebukuro-hours-batch1.json` (349 entries) is transcribed but not imported into POI
  notes under OD-32 amendment (2). Out of scope for this batch.
- **Floors**: 478 of 516 POIs have `floorId: null`; the printed area (e.g. ルミネ池袋 B1) is in
  `notes`, not in a routable floor id.
- **Current status**: every shop POI note says 現在の営業状況は未確認; closures after 2026-10-24
  are not observed.

## Conclusion

The reviewed B1 merchant sources are already fully imported (343 entries, 0 missing). No POI is
added or changed by this batch; `stations/ikebukuro/gteki/*` is untouched. The remaining B1
volume is the department-store tenant datasets, which a rights decision (OD-34(5)) keeps out of
the POI graph, and Toei, which is bot-challenged.
