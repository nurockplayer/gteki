# Ikebukuro hours batch 5 — dated building-card hours (OD-32)

Read 2026-11-03 JST; UTC timestamps below. Plain `curl -s -L` with the default User-Agent,
no custom headers, one request at a time. No browser source fetch, sign-in or raw file committed.
Times are normalized only by trimming separator whitespace; floor/tenant exceptions are not building defaults.

## Inventory before this batch

All six store/mall building POIs in imported `pois.json` (shop rows without a numeric tenant suffix):

| Building | POI | Existing hours / prior research |
| --- | --- | --- |
| 東武百貨店 池袋店 | `shop-ikb-tobudept` | UNKNOWN without text; batch 4 stale 2020 notice |
| ルミネ池袋 | `shop-ikb-lumine` | No card hours; batch 1 building-only undated row (`poiId: null`) |
| 池袋ショッピングパーク | `shop-ikb-isp` | No card hours; batch 1 building-only undated row (`poiId: null`) |
| エソラ池袋 | `shop-ikb-esola` | No card hours; batch 1 building-only undated row (`poiId: null`) |
| 池袋パルコ | `shop-ikb-parco` | No card hours or matching prior hours row |
| 西武池袋本店 | `shop-ikb-seibu-honten` | Already has batch 3 hours, 午前10時～午後8時; unchanged |

Echika池袋, 東武ホープセンター and エミオ池袋 have tenant rows but **no building POI** in this
bundle. No new POI is created. Batch 1's null-POI building rows do not attach hours to a card.

## Imported (1)

`shop-ikb-esola`: the official notice explicitly prints `2026年5月27日更新`,
`物販・サービス店舗　10:30～21:30` and `飲食店舗　11:00～23:00`.
The update is 160 days before 2026-11-03 JST, within OD-32's 180 days.
`pageDate` is 2026-05-27 and `basis` is `dated-official`. The card's `retrievedAt`
is 2026-11-02, the UTC date of the read; its label says the hours may have changed.
Tenant exceptions are not building defaults, and no tenant hours are overwritten.

## Rights

Data lead ruling on PR #740, 2026-11-03 06:0x JST: Esola/Metro Properties and
東武ホープセンター belong to **Sites allowing private use and quotation**, with S facts-only
use. The examples in `docs/research/use-tiers.md` now record that ruling.

Esola terms: https://www.metropro-sc.jp/esola-ikebukuro/shop/site_use.jsp, read
2026-11-02T20:47:47Z. Clause: 「これらについて、権利者の許可なく複製、転用などをすることは法律で禁止されています。」
The lead ruled that it restates copyright law and is no stricter than that class;
`docs/map/data-rights.md` already records the facts-only precedent. The former Esola
class-unknown GAP is resolved by the lead's ruling and the dated notice is imported.
PARCO, ISP, LUMINE and Tobu keep the brief's decided classes.

## GAP

| Store | URL | Read UTC | Reason |
| --- | --- | --- | --- |
| shop-ikb-isp | https://www.web-isp.co.jp/facilities/ | 2026-11-02T20:46:43Z | UNKNOWN: official facilities page prints whole-building hours and 年中無休, but no hours date/period or page update date. OD-32 dated-source requirement not met. |
| shop-ikb-lumine | https://www.lumine.ne.jp/ikebukuro/information/hours/ | 2026-11-02T20:46:43Z | UNKNOWN: official hours page prints shopping and restaurant hours, but no hours date/period or page update date. Dates on unrelated shop news do not date the hours. |
| shop-ikb-parco | https://ikebukuro.parco.jp/pnews/detail/?id=13950 | 2026-11-02T20:47:09Z | UNKNOWN: official hours notice and linked information page print hours without an applicable date/period or page update date. Recent News dates and lost-property service dates are unrelated. |
| shop-ikb-tobudept | https://www.tobu-dept.jp/ikebukuro/tnb/open/ | 2026-11-02T20:46:44Z | UNKNOWN: unchanged stale COVID notice. Only store-level notice is 3月3日(火)より当面の間 (2020-03-03, inferred as in batch 4), older than 180 days. No newer dated store hours printed. |
| Echika池袋 (no building POI) | https://www.metropro-sc.jp/echika-ikebukuro/shop/hours.jsp | 2026-11-02T20:46:42Z | UNKNOWN: page says hours vary by tenant and links to a list updated 2025-12-24, over 180 days old; no building-wide opening/closing printed. |
| 東武ホープセンター (no building POI) | https://tobuhopecenter.jp/ | 2026-11-02T20:46:43Z | UNKNOWN: class settled as private use and quotation by the data lead (2026-11-03 JST, #740). No building POI and no qualifying dated hours; no import. News item dates are not a page/hours update date. Terms: https://tobuhopecenter.jp/terms/ (read 2026-11-02T20:47:10Z), 情報の利用制限: 「閲覧につきましては自由ですが“私的利用”または“引用”などは著作権法上認められた場合を除き利用することを禁止いたします。」 Class settled; GAP remains for missing building POI and dated hours. |

Refuse-every-use: none of the scoped missing building cards uses that class; no such site was fetched.
UNKNOWN means no qualifying hours were imported; existing absent hours and Tobu UNKNOWN are preserved.
Unrelated campaign/news/service dates do not date a whole page's hours. エミオ池袋 is already a
batch 1 no-building-POI GAP and is not a missing building card in this scope.

## Fetch receipts

SHA-256 and byte sizes cover the downloaded response body after redirects; read time is UTC request start.
The guessed `sitepolicy.jsp` was 404; the actual linked `site_use.jsp` was then read. No denied action retried.

| Source | Read UTC | HTTP | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/hours.jsp | 2026-11-02T20:46:41Z | 200 | 28220 | `41d4d8aa939657043a2fd6fa6b3eedffc2a58970835fddddc7eec81aa0dd316d` |
| https://www.metropro-sc.jp/echika-ikebukuro/shop/hours.jsp | 2026-11-02T20:46:42Z | 200 | 21128 | `5bc594597a62931b726a5a105fc3dbcc47569062b85d66418b372f392ed4ebca` |
| https://www.web-isp.co.jp/facilities/ | 2026-11-02T20:46:43Z | 200 | 24162 | `aad0f0021e4740617ba085e8b2240a7547219d915648611c6bcdaf427457b0eb` |
| https://tobuhopecenter.jp/ | 2026-11-02T20:46:43Z | 200 | 55813 | `d0156a169021874bb63b48defe8b2bb4ec50745af3c37f86d90f8c78810b6d30` |
| https://www.lumine.ne.jp/ikebukuro/information/hours/ | 2026-11-02T20:46:43Z | 200 | 25447 | `7586a2f91b16793203938a54b1c59025ba439de84fd58f0bad4aaa6694c50dda` |
| https://ikebukuro.parco.jp/info/ | 2026-11-02T20:46:44Z | 200 | 49714 | `ff79fa6ed7c1d367b97961632756ad737bc476f06d66665d5429fc8837438d6e` |
| https://www.tobu-dept.jp/ikebukuro/tnb/open/ | 2026-11-02T20:46:44Z | 200 | 17128 | `d09f452fc582d361664e038c2557b9e8ed400ffd2327b6f480a2d2235a3cdb43` |
| https://www.metropro-sc.jp/esola-ikebukuro/event/item_eventnews.jsp?id=12 | 2026-11-02T20:47:09Z | 200 | 37618 | `138a1d12e4f22a19848949d61dfdb47ff9b14a710bb56a99ac91ae0515ac8fbe` |
| https://ikebukuro.parco.jp/pnews/detail/?id=13950 | 2026-11-02T20:47:09Z | 200 | 34097 | `5835f626a1a7f19356b1b704f19131534466c840c993d2154c9e3b6ee5d37475` |
| https://www.lumine.ne.jp/ikebukuro/news/ | 2026-11-02T20:47:09Z | 200 | 34249 | `bd8713485624cc8a47ba6a5fa319b57b1fdf81f20ad2aa7a7a6cd84527b513e9` |
| https://www.web-isp.co.jp/ | 2026-11-02T20:47:10Z | 200 | 60929 | `075b37e48f823e7f4ec0f0bbb7e6f0e47f8fe1bc0b009e3131fa84718bd3a9de` |
| https://tobuhopecenter.jp/terms/ | 2026-11-02T20:47:10Z | 200 | 37824 | `045fa831a71936bb63e94f1b15a7ecf51c314747feca18b6e2a110efc159a518` |
| https://www.lumine.ne.jp/ikebukuro/ | 2026-11-02T20:47:33Z | 200 | 42448 | `463f290ab47a4b2ffaaf4873577ec3c832ad1658e0a5a71d374b73f34f5803e0` |
| https://www.web-isp.co.jp/information/ | 2026-11-02T20:47:34Z | 200 | 11733 | `349739a97285c2fa98fc41c1da39b1d4a49a8b80f79b2369447ef8d1222a51d4` |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/sitepolicy.jsp | 2026-11-02T20:47:34Z | 404 | 6026 | `54c1b18c3acaadf61fda7e4a5e2b5fc870389ea6af24ee8367ea1c7833357374` |
| https://www.metropro-sc.jp/esola-ikebukuro/shop/site_use.jsp | 2026-11-02T20:47:47Z | 200 | 29034 | `ff53c06fd7a61163d2153d6ea3c22ae1e87ecc1a20fc4a5e15be8f8a6840bc14` |
| https://ikebukuro.parco.jp/pnews/ | 2026-11-02T20:47:47Z | 200 | 26158 | `460695af30fa71492e550f7ab0128e373a38e4936d3a80b328ddb9ba5cf71131` |

## Rebuild and assumptions

Follow #707: one source and `shop-ikb-esola.hours` in `graph.src.json`; rebuild with
`SOURCE_DATE_EPOCH=1792594800 python3 -I stations/ikebukuro/pipeline/build_station.py`.
The pinned epoch preserves the graph's geometry dates; graph.json must remain unchanged.
GML SHA-256: `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`.
After merging main on 2026-11-03 JST, regenerate from main’s data plus the Esola source/hours.
Retain all eight `tobu-tj-*` POIs and their referenced source from #738.
No Shinjuku import is needed. No building POI is created for Echika/Hope/Emio.
The new OD-32 card regression loads the committed Esola POI and asserts the printed
open/close text, the read-date label and the official link together.

Coverage matrix is not edited. Proposed PR-only update: Esola building hours imported;
ISP/LUMINE/PARCO still have no dated hours; Tobu stale notice unchanged; Echika/Hope have
no building POI. Seibu already has hours, unchanged. Neither Esola nor Hope is class unknown.

## Tests (2026-11-03 JST)

The initial requested `check` command was canceled before execution: the package has no
`check` script. The lead corrected the command to `typecheck` in the 06:0x JST ruling.
Run once after this correction:

- `orb-test -- pnpm exec vitest run apps/web/src/ui/app.notes.test.ts stations/ikebukuro/scene/search.test.ts`
- `orb-test -- pnpm --filter @gteki/station-ikebukuro typecheck`

Results are recorded in PR #740 at hand-off.
