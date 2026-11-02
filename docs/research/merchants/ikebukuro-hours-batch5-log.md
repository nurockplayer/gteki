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

## Imported (0)

No new hours meet both this brief's rights rule and dated-source requirement.
Esola's own notice explicitly prints `2026年5月27日更新`, within 180 days of
2026-11-03 JST (160 days). Its site/operator is not named in `use-tiers.md`, however,
so the brief requires class UNKNOWN and no import. No hours from this notice enter the bundle.

## Rights

The brief's named-source requirement controls this batch. The older Metro Properties
(Echika, Esola) facts-only precedent in `docs/map/data-rights.md` does not substitute for a
lead ruling under this brief. Esola and Hope Center terms are recorded below for the lead.
PARCO, ISP, LUMINE and Tobu use the brief's decided classes; no rights ruling is changed.

## GAP

| Store | URL | Read UTC | Reason |
| --- | --- | --- | --- |
| エソラ池袋 (`shop-ikb-esola`) | https://www.metropro-sc.jp/esola-ikebukuro/event/item_eventnews.jsp?id=12 | 2026-11-02T20:47:09Z | class unknown: dated hours notice (updated 2026-05-27), but Metro Properties/Esola is not named in use-tiers.md. Terms: https://www.metropro-sc.jp/esola-ikebukuro/shop/site_use.jsp (read 2026-11-02T20:47:47Z), 著作権: 「これらについて、権利者の許可なく複製、転用などをすることは法律で禁止されています。」 Lead to classify; no import. |
| shop-ikb-isp | https://www.web-isp.co.jp/facilities/ | 2026-11-02T20:46:43Z | UNKNOWN: official facilities page prints whole-building hours and 年中無休, but no hours date/period or page update date. OD-32 dated-source requirement not met. |
| shop-ikb-lumine | https://www.lumine.ne.jp/ikebukuro/information/hours/ | 2026-11-02T20:46:43Z | UNKNOWN: official hours page prints shopping and restaurant hours, but no hours date/period or page update date. Dates on unrelated shop news do not date the hours. |
| shop-ikb-parco | https://ikebukuro.parco.jp/pnews/detail/?id=13950 | 2026-11-02T20:47:09Z | UNKNOWN: official hours notice and linked information page print hours without an applicable date/period or page update date. Recent News dates and lost-property service dates are unrelated. |
| shop-ikb-tobudept | https://www.tobu-dept.jp/ikebukuro/tnb/open/ | 2026-11-02T20:46:44Z | UNKNOWN: unchanged stale COVID notice. Only store-level notice is 3月3日(火)より当面の間 (2020-03-03, inferred as in batch 4), older than 180 days. No newer dated store hours printed. |
| Echika池袋 (no building POI) | https://www.metropro-sc.jp/echika-ikebukuro/shop/hours.jsp | 2026-11-02T20:46:42Z | UNKNOWN: page says hours vary by tenant and links to a list updated 2025-12-24, over 180 days old; no building-wide opening/closing printed. |
| 東武ホープセンター (no building POI) | https://tobuhopecenter.jp/ | 2026-11-02T20:46:43Z | class unknown: operator is not named in use-tiers.md; no import. Page prints hours, but news item dates are not a page/hours update date. Terms: https://tobuhopecenter.jp/terms/ (read 2026-11-02T20:47:10Z), 情報の利用制限: 「閲覧につきましては自由ですが“私的利用”または“引用”などは著作権法上認められた場合を除き利用することを禁止いたします。」 Lead to classify. |

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

No rows are imported, so no generated file or source registry entry changes. A trial
#707 rebuild was completed with `SOURCE_DATE_EPOCH=1792594800` (66 nodes, 67 edges,
67 verified); graph.json equalled main. The proposed Esola import and generated changes
were removed when the brief's named-source rule was applied. No Shinjuku import is needed.
The pinned GML used for that trial had SHA-256
`38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`.

There are no new imported rows to exercise in a card test; no test or product code is changed.
The requested station-package check is still attempted. An early card-test launch was canceled
before execution while generation ran, and the queued replacement was canceled when the import
was removed; neither is claimed as a test pass.

Coverage matrix is not edited. Proposed PR-only update: five missing building cards researched;
Esola class UNKNOWN with a dated official notice; ISP/LUMINE/PARCO no dated hours; Tobu stale
notice unchanged; Echika/Hope Center have no building POI. Seibu already has hours, unchanged.

## Tests (2026-11-03 JST)

`orb-test -- pnpm --filter @gteki/station-ikebukuro check` was queued at 05:52 JST and
canceled at 05:59 JST before container execution. Last output:
`orb-test: waiting for a gteki slot (2 light run(s) at a time inside the work window)`.
The selected package defines `typecheck`, not `check`; no successful package check is claimed.
No test files are touched in this research-only change; no imported-row test ran.
