# DR: department-store terms and floor guides (2026-10-25)

## 1. Header

- Date: 2026-10-25. Times below are UTC (JST = UTC+9).
- Purpose: input for **OD-34** and the gap table in #501 (Owner priority 2). For each named store this records the official site's terms or site-policy wording, a classification under OD-34, and the official floor guide or shop list: whether it is plain HTML, the printed floor range and a rough shop count. No shop lists are copied.
- Method: `curl` only, default User-Agent, no added headers, requests spaced ≥0.6 s apart, **58 requests** in total. No browser, no sign-ins, no forms. A 403, challenge page, JS-only page, timeout or refused connection is recorded as a GAP. No page from an OD-34-excluded site was read.
- Director's ruling applied here (relayed 2026-10-25, [#501 comment 6394872033](https://github.com/nurockplayer/gteki/issues/501#issuecomment-6394872033)): a clause that only restricts copying (private use only) means **facts-only is OK**; a clause that expressly bans commercial use means **corroboration only**; without a quoted clause it is **not** a ban.

## 2. Table

| # | Store / source | Terms or site-policy URL | Read (UTC) | Clause (verbatim, as read) | Private-use or law-allowed exception | OD-34 class | Official floor guide / shop list URL | Plain HTML? | Printed floors | Rough shop count |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 伊勢丹新宿店 | `https://www.isetan.mistore.jp/shinjuku.html` → 301 → `https://www.mistore.jp/store/shinjuku.html` | attempted 07:26–07:32 | none read | — | **UNKNOWN** (read failed) | same host (store site) | GAP | GAP | GAP |
| 2 | 高島屋新宿店 | `https://www.takashimaya.co.jp/shinjuku/` | attempted 07:26–07:31 | none read | — | **UNKNOWN** (read failed) | same host (store site) | GAP | GAP | GAP |
| 3 | 新宿マルイ 本館 / アネックス / メン | `https://www.0101.co.jp/policy/` (privacy) and `/user_guide/` (当サイトについて: browsers, cookies, JavaScript); the footer also links `/cookie/`, not fetched | 07:32–07:33 | No copyright, reproduction or content-use clause was found on the pages inspected. The site map (`/sitemap/`) lists no 利用規約 page; the only rights statement is the footer 「© MARUI CO.,LTD.」 | n/a (no clause found) | **Facts only OK** — no quoted ban clause | `https://www.0101.co.jp/003/info/`, `/005/info/`, `/074/info/` (フロアガイド) | **No** — `/003/info/` (the page fetched) is an empty template filled by JavaScript from `/contents2/floormap/{stcd}/floor_map_list.json` and `/contents2/shopinfo/{stcd}/shop_list.json`; the other two use the same script and template (not fetched as HTML) | 本館: B1F–8F; アネックス: B1F–8F; メン: 1F–8F (distinct `facility_floor_name` values in each `floor_map_list.json`) | 本館 172; アネックス 69; メン 60 (length of `shop_list.shop` in each `shop_list.json`) |
| 4 | 京王百貨店 新宿店 | `https://www.keionet.com/` | 07:26:32 | Site-wide maintenance page (`<title>メンテナンス中</title>`): 「現在、システムメンテナンスを実施しております。」「システムの安定運用およびセキュリティ向上を目的としたメンテナンスを実施しております。」 No terms link. | — | **UNKNOWN** (read failed; unchanged from #415) | `https://www.keionet.com/shinjuku/floor/` (from the 2026-10-24 attempt) | GAP | GAP | GAP |
| 5 | 新宿サブナード | `https://www.subnade.co.jp/legal/` (and `/` ) | 07:26–07:35, five attempts | none read | — | **UNKNOWN** (read failed; unchanged from #415) | `https://www.subnade.co.jp/floorguide/` | GAP | GAP | GAP |
| 6 | 池袋PARCO | `https://www.parco.co.jp/terms/` | 07:34:41 | §1 知的財産権等について: 「本サイトの利用者（以下「利用者」といいます）は、本サイトで提供する情報・サービス等について、(1)当社の事前の承諾を得ずに、私的利用以外の目的で利用すること、及び、(2)当社の事前の承諾（権利者である第三者が存在する場合には、当社を通じた当該第三者の承諾を含みます）を得ずに、著作権法で定める私的利用の範囲を超えて複製、送信、頒布、譲渡、貸与、翻訳、翻案する等の行為を行うこと、はできません。」 Page date: `Updated Feb. 24, 2021` | Yes — 私的利用以外の目的 / 著作権法で定める私的利用の範囲 | **Facts only OK** — both limbs are limited to private use; there is no express commercial-use ban (see note 6); the director decides | `https://ikebukuro.parco.jp/floor/`; shop list `https://ikebukuro.parco.jp/shop/?category_search=alpha` | **Yes** (floor guide and shop list both server-rendered) | 本館: B2F, B1F, 1F, M2F, 2F–8F; P'PARCO: B2F–8F | 151 shop cards in the alphabetical shop list (all buildings; no per-building split on that page) |
| 7 | だれでも東京 (portal) | `https://www.daredemo-tokyo.metro.tokyo.lg.jp/` | 07:28:42 | Portal returns a maintenance page (403 bytes): 「サイトメンテナンスのためご利用いただけません。」 No terms link. `/terms/`, `/sitepolicy/`, `/policy/`, `/riyou/` all returned 404 (196 bytes) at 07:35 | — | **UNKNOWN** (read failed; unchanged from #415) | not applicable (not a store) | — | — | — |

## 3. Notes

- **伊勢丹 (1).** `www.isetan.mistore.jp` answers 301 and redirects every path tried (`/shinjuku.html`, `/sitepolicy/`, `/terms/`) to `www.mistore.jp`. `www.mistore.jp` completed the TCP connection and the TLS handshake (certificate CN=www.mistore.jp, O=Isetan Mitsukoshi Holdings Ltd.) and then returned no HTTP response within 15–45 s on both HTTP and HTTPS, GET and HEAD. No clause was read, so nothing can be classified.
- **高島屋 (2).** Same failure shape: TCP and TLS succeed (`23.217.205.166`), no HTTP response within 15–45 s on GET or HEAD, HTTP or HTTPS.
- **新宿マルイ (3).** The three buildings are printed on the site as 「新宿マルイ 本館」 (`/003/`), 「新宿マルイ アネックス」 (`/005/`) and 「新宿マルイ メン」 (`/074/`). The only policy pages linked from the footer and listed in the site map are the privacy policy, the cookie policy and 当サイトについて (environment/JavaScript settings). No 利用規約 or copyright/reproduction clause was found on the store site, so per the director's ruling this is not a ban; facts only are allowed. The floor guide is JavaScript-only, so the floor range and counts above were read from the JSON the page loads (`floor_map_list.json`: distinct `facility_floor_name`; `shop_list.json`: length of `shop_list.shop`), all three fetched 2026-10-25 07:33:58–07:34:03Z. Only the 本館 HTML page was fetched; the アネックス and メン pages are the same template driven by the same script.
- **京王 (4).** `www.keionet.com` returned a maintenance page on 2026-10-25; unchanged from the 2026-10-24 read (#415, `DR-terms-and-retries-2026-10-24.md` GAP-1). Nothing was read.
- **新宿サブナード (5).** `www.subnade.co.jp` refused TCP connections on port 443 on all five attempts (three on `/` at 07:26:33, 07:27:37 and 07:28:41; one each on `/legal/` and `/floorguide/` at ~07:34:50), 15–40 ms. Unchanged from #415 GAP-2.
- **池袋PARCO (6).** Re-quoted from `https://www.parco.co.jp/terms/` (fresh read 2026-10-25; DR-RT-06's wording matches; page date `Updated Feb. 24, 2021`). §1 has two limbs: (1) no use of the site's information or services for purposes other than 私的利用 without prior consent, and (2) no reproduction, transmission, distribution, transfer, lending, translation or adaptation beyond the private-use range set by the Copyright Act without consent. Limb (1) is a **use** restriction, not only a copying one, but it is bounded by private use in the same way as LUMINE's 「私的利用など法律によって認められる範囲を超えて…無断使用することはできません」, which OD-34 §2 already classes as facts only. There is no express ban on commercial use (contrast ecute's flat 「無断使用・複製することを禁止します」). On the director's 2026-10-25 ruling — a private-use-only clause means facts-only is OK — this is facts-only; **the director decides** whether limb (1) changes that. The old access URL `parco.jp/ikebukuro/access/` is still 404; the current host is `ikebukuro.parco.jp`.
- **だれでも東京 (7).** The portal URL is `www.daredemo-tokyo.metro.tokyo.lg.jp` (the bare `daredemotokyo.jp` does not resolve). The site is in maintenance and the guessed policy paths return 404, so no terms page could be found or read.

## 4. Fetch log

Every request in this task, in order. Status is the final HTTP code after redirects; `000` = no HTTP response (timeout / refused / DNS).

| # | UTC | Target | URL | Status | Bytes | Note |
|---|---|---|---|---|---|---|
| 1 | 07:26:11 | 伊勢丹 | `https://www.isetan.mistore.jp/shinjuku.html` | 301 | 0 | → `www.mistore.jp`, which never answered |
| 2 | 07:26:30 | 高島屋 | `https://www.takashimaya.co.jp/shinjuku/` | 000 | 0 | connection reset/timeout |
| 3 | 07:26:31 | マルイ | `https://www.0101.co.jp/` | 200 | 56,594 | store list |
| 4 | 07:26:32 | 京王 | `https://www.keionet.com/` | 200 | 1,939 | maintenance page |
| 5 | 07:26:33 | サブナード | `https://www.subnade.co.jp/` | 000 | 0 | connection refused |
| 6 | 07:26:34 | だれでも東京 | `https://daredemotokyo.jp/` | 000 | 0 | DNS: host does not resolve |
| 7 | 07:26:47 | 伊勢丹 | `https://www.isetan.mistore.jp/shinjuku.html` | 301 | 0 | retry |
| 8 | 07:27:06 | 高島屋 | `https://www.takashimaya.co.jp/shinjuku/` | 000 | 0 | retry |
| 9 | 07:27:37 | サブナード | `https://www.subnade.co.jp/` | 000 | 0 | retry, refused |
| 10 | 07:27:51 | 伊勢丹 | `https://www.isetan.mistore.jp/shinjuku.html` | 301 | 0 | retry with -L; redirect target timed out |
| 11 | 07:28:10 | 高島屋 | `https://www.takashimaya.co.jp/shinjuku/` | 000 | 0 | retry with -L, IPv4 |
| 12 | 07:28:41 | サブナード | `https://www.subnade.co.jp/` | 000 | 0 | retry |
| 13 | 07:28:42 | だれでも東京 | `https://www.daredemo-tokyo.metro.tokyo.lg.jp/` | 200 | 403 | maintenance page |
| 14 | ~07:29 | 伊勢丹 | `https://www.mistore.jp/store/shinjuku.html` | 000 | 0 | direct GET, timeout |
| 15 | ~07:29 | 高島屋 | `https://www.takashimaya.co.jp/shinjuku/` | 000 | 0 | direct GET, timeout |
| 16 | ~07:30 | 伊勢丹 | `https://www.mistore.jp/store/shinjuku.html` | 000 | 0 | IPv4, 45 s timeout |
| 17 | ~07:31 | 高島屋 | `https://www.takashimaya.co.jp/shinjuku/` | 000 | 0 | IPv4, 45 s timeout |
| 18 | ~07:31 | 伊勢丹 / 高島屋 / マルイ | `https://www.mistore.jp/`, `https://www.takashimaya.co.jp/`, `https://www.0101.co.jp/` (HEAD) | 000 / 000 / 200 | 0 / 0 / — | confirms マルイ reachable, the other two not |
| 19 | ~07:32 | 伊勢丹 / 高島屋 | same hosts over HTTP port 80 (HEAD) | 000 / 000 | 0 | no response on port 80 either |
| 20 | ~07:32 | 伊勢丹 | `https://www.isetan.mistore.jp/sitepolicy/`, `/terms/` (HEAD) | 301 / 301 | 0 | both redirect off-host |
| 21 | 07:32:33 | マルイ | `https://www.0101.co.jp/policy/` | 200 | 44,488 | privacy policy only |
| 22 | 07:32:34 | マルイ | `https://www.0101.co.jp/003/` | 200 | 61,834 | 新宿マルイ 本館 store page |
| 23 | 07:32:48 | マルイ | `https://www.0101.co.jp/003/info/` | 200 | 29,047 | floor guide, JS template |
| 24 | 07:32:54 | マルイ | `https://www.0101.co.jp/terms/` | 200 | 56,594 | redirects to the homepage |
| 25 | 07:32:55 | マルイ | `https://www.0101.co.jp/sitepolicy/` | 200 | 56,594 | redirects to the homepage |
| 26 | 07:33:04 | マルイ | `https://www.0101.co.jp/user_guide/` | 200 | 27,822 | 当サイトについて: no use clause |
| 27 | 07:33:21 | マルイ | `/assets/js/v1/stores/pages/store-info.js` | 200 | 7,266 | shows the JSON data source |
| 28 | 07:33:22 | マルイ | `https://www.0101.co.jp/sitemap/` | 200 | 63,465 | no 利用規約 link |
| 29 | 07:33:31 | マルイ | `/assets/js/v1/stores/constant.js` | 200 | 74,510 | JSON path templates |
| 30 | 07:33:37 | マルイ | `/assets/js/v1/stores/functions.js` | 200 | 882 | loader |
| 31 | 07:33:46–52 | マルイ | `/contents2/floormap/floor_map_list/{stcd}/floor_map_list.json` etc. (6 malformed URLs) | 200 | 56,594 each | redirected to the homepage; discarded, not used |
| 32 | 07:33:58–07:34:03 | マルイ | `/contents2/floormap/{003,005,074}/floor_map_list.json` and `/contents2/shopinfo/{stcd}/shop_list.json` (6) | 200 | 5,180 / 61,644 / 4,688 / 24,573 / 4,469 / 21,417 | floors and counts |
| 33 | 07:34:41 | 池袋PARCO | `https://www.parco.co.jp/terms/` | 200 | 36,312 | ご利用規約 |
| 34 | ~07:34:50 | サブナード | `https://www.subnade.co.jp/legal/`, `/floorguide/` | 000 / 000 | 0 | refused, 15–18 ms |
| 35 | ~07:35:00 | 高島屋 | `https://www.takashimaya.co.jp/` | 000 | 0 | verbose probe: TLS ok, HTTP request never answered |
| 36 | ~07:35:05 | 伊勢丹 | `https://www.mistore.jp/` | 000 | 0 | verbose probe: TLS ok, HTTP request never answered |
| 37 | 07:35:14 | だれでも東京 | `https://www.daredemo-tokyo.metro.tokyo.lg.jp/terms/` | 404 | 196 | |
| 38 | 07:35:20–22 | だれでも東京 | `/sitepolicy/`, `/policy/`, `/riyou/` | 404 | 196 | |
| 39 | 07:35:32 | 池袋PARCO | `https://ikebukuro.parco.jp/` | 200 | 71,464 | current host |
| 40 | 07:35:41 | 池袋PARCO | `https://ikebukuro.parco.jp/floor/` | 200 | 56,292 | floor guide, plain HTML |
| 41 | 07:35:51 | 池袋PARCO | `https://ikebukuro.parco.jp/shop/?category_search=alpha` | 200 | 126,454 | 151 shop cards |

Request count: 13 in the scripted batch + 45 manual = **58** (some log rows group related requests: 6 malformed Marui URLs in one row, 6 correct JSON files in one row, 3 404 probes in one row).

How the Marui numbers were obtained (2026-10-25): `floor_map_list.json` → `floor_map_list.floor_map[]`, distinct `facility_floor_name`; `shop_list.json` → `shop_list.shop[]`, counted. Values: 003 → `[B1F,1F,2F,3F,4F,5F,6F,7F,8F]`, 172 shops; 005 → the same nine labels, 69 shops; 074 → `[1F,2F,3F,4F,5F,6F,7F,8F]`, 60 shops. The files carry `updated` timestamps of 2026-10-14, 2026-10-11 and 2026-10-17 respectively. PARCO's floors are the heading text of the server-rendered `/floor/` page; its 151 is the count of distinct `/shop/detail/?cd=` links on `/shop/?category_search=alpha`.

## 5. GAP list

| ID | Gap | Detail | What would close it |
|---|---|---|---|
| DS-GAP-1 | 伊勢丹新宿店 terms and floor guide | `www.mistore.jp` completes TCP and TLS but never returns an HTTP response (GET and HEAD, HTTP and HTTPS, IPv4, 15–45 s). `www.isetan.mistore.jp` 301s to it. No clause, no floor guide, no count. | Retry later from a network the site answers, or a lead decision on another official URL. |
| DS-GAP-2 | 高島屋新宿店 terms and floor guide | Same failure on `www.takashimaya.co.jp` (TLS ok, no HTTP response). | Retry later; no alternate official host was found. |
| DS-GAP-3 | 京王百貨店 新宿店 | Site-wide maintenance page on 2026-10-25 (same as 2026-10-24). | Retry after maintenance ends. |
| DS-GAP-4 | 新宿サブナード | TCP connection refused on port 443 on every attempt. | Retry when the host answers. |
| DS-GAP-5 | だれでも東京 terms | Portal is in maintenance (403-byte page); the policy paths tried return 404. | Retry once the portal is back; the terms URL is not known until a page links it. |

## 6. Effect on OD-34

- **New facts-only sources (no quoted ban clause):** 新宿マルイ's store site (0101.co.jp) — no use clause was found — and 池袋PARCO — §1 is limited to private use in both limbs and has no express commercial-use ban. Both fit the director's 2026-10-25 ruling; nothing is imported from either in this pass.
- **Unchanged UNKNOWN:** 伊勢丹新宿店, 高島屋新宿店, 京王百貨店 新宿店, 新宿サブナード, だれでも東京. Per OD-34 (fifth round, item d), a site whose terms could not be read stays UNKNOWN and nothing is imported from it.
- **Floor-guide readability:** only 池袋PARCO's floor guide is plain HTML. 新宿マルイ's is JavaScript-only, so its floors and counts come from the JSON the page loads. The other five could not be read.
