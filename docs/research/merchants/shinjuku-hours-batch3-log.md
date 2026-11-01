# Shinjuku department-store hours — batch 3 log (OD-32)

Tracking: data-research-05 brief, 2026-11-02 06:55 JST. Output: `shinjuku-hours-batch3.json` (schema `gteki.research.hours/0.1`, same row fields as `shinjuku-hours-batch1.json`).
Scope: the six department-store POIs in `shinjuku-dept-stores.json`. Hours are facts; no current open/closed status is asserted anywhere.

## Rights

- 新宿マルイ (本館 / アネックス / メン): class from #502 — no quoted ban on the store's own pages; facts only. Source record reused: `marui-shinjuku-floorguide-2026-10` in `shinjuku-dept-stores.json`.
- 伊勢丹新宿店 本館 / メンズ館: class 私的使用・引用 ("private use and quotation", `docs/research/use-tiers.md`). Source record reused: `isetan-shinjuku-floorguide-2026-10` in `shinjuku-dept-stores.json`.
- 高島屋タイムズスクエア: class 私的使用・引用 (`docs/research/use-tiers.md`, 高島屋 per #591). Source record reused: `takashimaya-shinjuku-floorguide-2026-10` in `shinjuku-dept-stores.json`.
- No new source records were added.

## A. 新宿マルイ ×3 — fetched

Plain `curl -s`, default User-Agent, no custom headers, sequential, 0.5–0.7 s apart. Each request below is one line: UTC time, URL, HTTP status, bytes.

The three building pages print their 営業時間 through JavaScript: the `/info/` HTML carries an empty `#businessHours` section and a jsrender template, and `/assets/js/v1/stores/pages/store-info.js` fetches the text from the facility data file named in `/assets/js/v1/stores/constant.js` (`TTS_FILES.FACILITY_INFO = /contents2/facilityinfo/${stcd}/facility.json`). The JSON rows were read directly; no browser was used.

| UTC | URL | HTTP | bytes |
| --- | --- | --- | --- |
| 2026-11-01T21:55:59Z | `https://www.0101.co.jp/003/info/` (新宿マルイ 本館) | 200 | 28,922 |
| 2026-11-01T21:55:59Z | `https://www.0101.co.jp/005/info/` (アネックス) | 200 | 29,103 |
| 2026-11-01T21:56:00Z | `https://www.0101.co.jp/074/info/` (メン) | 200 | 29,049 |
| 2026-11-01T21:56:13Z | `https://www.0101.co.jp/assets/js/v1/stores/pages/store-info.js` | 200 | 7,266 |
| 2026-11-01T21:56:16Z | `https://www.0101.co.jp/assets/js/v1/stores/functions.js` | 200 | 882 |
| 2026-11-01T21:56:19Z | `https://www.0101.co.jp/assets/js/v1/stores/param.js?date=20260205175305` | 200 | 4,291 |
| 2026-11-01T21:56:22Z | `https://www.0101.co.jp/assets/js/v1/stores/constant.js?date=20261029123108` | 200 | 74,998 |
| 2026-11-01T21:56:23Z | `https://www.0101.co.jp/assets/js/v1/stores/utility.js?date=20261015155651` | 200 | 20,810 |
| 2026-11-01T21:56:30Z | `https://www.0101.co.jp/contents2/facilityinfo/003/facility.json` | 200 | 18,223 |
| 2026-11-01T21:56:30Z | `https://www.0101.co.jp/contents2/facilityinfo/005/facility.json` | 200 | 12,599 |
| 2026-11-01T21:56:31Z | `https://www.0101.co.jp/contents2/facilityinfo/074/facility.json` | 200 | 11,714 |

11 requests, all HTTP 200. No page answered with a challenge or a JS-only shell that hid the hours.

How the row was chosen on each building page (`STORE.PAGE.getFacilityData`): the page shows the first `facility_info_class: "01"` row whose title starts `基本営業時間` as the main hours, a row titled `基本営業時間２` as the sub-line, and a `休業日` row as closure days. The main row is taken exactly as printed.

| POI | Printed row | `hoursText` |
| --- | --- | --- |
| `shop-sjk-marui-honkan` | 基本営業時間 `11：00～20：00` + 基本営業時間２ `（B1F 11:00～21:00 一部店舗を除く）` | `11：00～20：00（B1F 11:00～21:00 一部店舗を除く）` |
| `shop-sjk-marui-annex` | 基本営業時間 `【平日】11：00～20：00【土・日・祝日】10：30～20：00` (first of two rows with that title) | `【平日】11：00～20：00【土・日・祝日】10：30～20：00` |
| `shop-sjk-marui-men` | 基本営業時間 `11:00～20:00` | `11:00～20:00` |

None of the three pages prints a date (no year-month-day string in the HTML or the JSON), so `pageDate: null`, `basis: "undated-official"`. The `updated` field in each `facility.json` is the data file's generation timestamp, not a date printed on the page; it is not used as `pageDate`.

Other printed blocks, deliberately not folded into `hoursText`: the 例外営業時間 line points to a tenant list (`営業時間が異なるショップ…はこちら`); the 本館 and メン data also carry a legacy `通常営業時間` row that the page template does not render.

## B. 伊勢丹 and 高島屋 — read by the lead

These sites do not answer curl from this host (same as #591). The rows below were read by the lead via ego-lite (in-page fetch); this worker did not refetch them.

| POI | URL | UTC |
| --- | --- | --- |
| `shop-sjk-isetan-honkan` | `https://www.mistore.jp/content/isetan/mistore/shinjuku/access.html` | 2026-11-01T21:54:52Z |
| `shop-sjk-isetan-mens` | same URL | 2026-11-01T21:54:52Z |
| `shop-sjk-takashimaya` | `https://www.takashimaya.co.jp/shinjuku/businesshours/` | 2026-11-01T21:54:44Z |

All three are `status: "OK"`, `pageDate: null`, `basis: "undated-official"`; `hoursText` and `note` are exactly as the lead supplied them.

## Result

| POI | status | hoursText |
| --- | --- | --- |
| `shop-sjk-marui-honkan` | OK | `11：00～20：00（B1F 11:00～21:00 一部店舗を除く）` |
| `shop-sjk-marui-annex` | OK | `【平日】11：00～20：00【土・日・祝日】10：30～20：00` |
| `shop-sjk-marui-men` | OK | `11:00～20:00` |
| `shop-sjk-isetan-honkan` | OK | `午前10時～午後8時` |
| `shop-sjk-isetan-mens` | OK | `午前10時～午後8時` |
| `shop-sjk-takashimaya` | OK | `午前10時30分～午後7時30分` |

6 rows, 6 OK, 0 UNKNOWN. No GAPs.

## Not done

- `coverage-matrix.md` is not edited (out of scope for this batch).
- No tenant-level hours, no hours parsing, no current-status wording.
