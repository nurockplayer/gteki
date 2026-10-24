# DR: terms of use and retries (Odakyu dept, Toei, Keio dept, Subnade, NewDays, Seibu, Tobu)

## 1. Header

- Date: 2026-10-24. All times below are UTC (JST = UTC+9).
- Purpose: input for **OD-34**. This file records clause wording and reachability only. It makes no rights decision and gives no advice on whether the project may reuse any source.
- Method: plain reader (WebFetch, no added headers) first; ego-lite read-only in a private task space only where a page needs JavaScript or blocks plain readers. No sign-ins, no forms, no uploads, no ChatGPT. Where a page was saved for checking, it was inspected for keywords with a local script and not reused.
- Scope: no shop names recorded in this file (brief instruction). No page from jreast.co.jp, ecute.jp, jr-cross.co.jp, odakyu-sc.com, keiosc.co.jp / ekishop.keio-sc.jp was read (OD-34 exclusion). No one was contacted.
- Result: 4 of 7 terms pages read. 3 could not be read (one site-wide maintenance, one refused connection, one domain problem). Both Part 2 targets were still unreachable, so no counts were taken.

## 2. Part 1 — terms pages

| # | Site | Terms URL | UTC read | Method | Clause on copyright / reproduction / use of content (verbatim, trimmed) | Private-use or "what the law allows" exception? |
|---|---|---|---|---|---|---|
| 1 | 小田急百貨店 (site policy) | https://www.odakyu-dept.co.jp/sitepolicy/index.html | 2026-10-24 09:54 | ego-lite page text; page HTML also saved and searched for 著作権 / 転載 / 複製 / 私的使用 / 引用 / 知的財産 (0 hits each) | No copyright, reproduction or content-use clause exists on this page. The only rights statement is the footer: 「Copyright© 2026 Odakyu Department Store Co.,Ltd. All rights reserved.」. The page covers operating environment, cookies, privacy, membership, online shopping and contact. | No (nothing to except). |
| 2 | 東京都交通局 (サイトポリシー) | https://www.kotsu.metro.tokyo.jp/riyo/ | 2026-10-24 09:54 | ego-lite (plain reader not attempted; the brief reported Incapsula protection) | Under 権利関係について / 著作権: 「当サイトに掲載している個々の情報（文章、写真、イラストなど）は、著作権の対象となっています。また、当サイト全体も編集著作物として著作権の対象となっており、ともに著作権法により保護されています。「私的使用のための複製」や「引用」など著作権法上認められた場合を除き、無断で複製・転用することはできません。」. Footer: 「本サイト上の文書や画像等に関する諸権利は東京都に帰属します。文書・画像等の無断使用・転載を禁止します。」 | Yes — private-use reproduction and quotation "など著作権法上認められた場合". No separate statement about data extraction or research use. |
| 3 | 京王百貨店 | https://www.keionet.com/ | 09:55 and 10:02 | plain reader; curl status check | Not readable. The site returns a maintenance page (title 「メンテナンス中」) and redirects to `/error_res.html`. Text: 「メンテナンスを実施しております。メンテナンス完了後、サービスは自動的に再開されます。」 No terms link, no date printed. | UNKNOWN. |
| 4 | 新宿サブナード | https://www.subnade.co.jp/ | 09:55, 09:58, 10:02 | plain reader; curl (HTTPS and HTTP) | Not reachable. `connect ECONNREFUSED 163.44.2.142:443`; curl to port 80 and port 443 both failed to connect (13 ms, 12 ms) at 09:58 and 10:02. | UNKNOWN. |
| 5 | NewDays | https://www.newdays.co.jp/ | 09:55 and 09:58 | plain reader; curl; DNS lookups | Domain problem, no page served. Plain reader: `getaddrinfo ENOTFOUND www.newdays.co.jp`. curl: "Could not resolve host". `dig +short www.newdays.co.jp` returned 150.95.255.38 once, and a request to that IP timed out after 20 s. `https://www.newdays.jp/` presents a certificate for `*.linkclub.jp`, and its own name is not in the certificate. NewDays is operated by JR東日本クロスステーション, whose site (jr-cross.co.jp) is excluded under OD-34, so the operator's terms were not read. | UNKNOWN. |
| 6 | 西武 station-shop portal (seibu-shop.jp) | https://www.seibu-shop.jp/use/ | 09:55 | plain reader, then ego-lite page text | Under 著作権について: 「本サイト内に掲載されている情報、デザイン、ロゴマーク、キャラクター、商標等に関しては、弊社または弊社にその利用を認めた権利者が著作権等の知的財産権、使用権その他の権利を有しています。権利者の許可なく複製、転用等されることのないようお願いいたします。」. Operator named on the page: 株式会社西武不動産プロパティマネジメント. The site is a 駅ナカ・駅チカ information portal; the store list is a portal list, not a Seibu Railway corporate page. | No. No 私的使用 / 法令 / 著作権法上認められた場合 wording on the page. |
| 7 | 東武鉄道 (サイトポリシー) | https://www.tobu.co.jp/sitepolicy/ | 09:55 | plain reader, then ego-lite page text | 第7条（私的利用の範囲外の利用禁止）: 「利用者は、当社が承認した場合を除き、サービスを通じて入手したいかなるデータ、情報、文書、発言等（以下、併せて「データ等」といいます）も、著作権法で認められた私的利用の範囲を超える複製、販売、出版のために利用することはできません。利用者は、前項に違反する行為を第三者にさせることはできません。」. 第8条（営業活動の禁止）: 「利用者は、サービスを使用して営業活動、営利を目的とした利用およびその準備を目的とした利用（以下「営業活動」といいます。）をすることができません。」. 第9条第1号 also forbids infringing intellectual property rights. Page states it takes effect from 日本国標準時間2002年7月22日9時00分; no revision date is shown. | Yes, in the sense of a boundary: use beyond 「著作権法で認められた私的利用の範囲」 needs Tobu's approval. No separate research/data-extraction exception. |

Notes on Part 1:

- The Toei clause is the only one of the four readable pages that names both "私的使用のための複製" and "引用" as permitted cases.
- Tobu's policy is a numbered 利用規約 (第1条 to 第13条), not a short site-policy paragraph; 第7条 is the operative copyright/use clause.
- 小田急百貨店's page has no rights clause at all, so there is no wording to weigh. A membership agreement exists at a separate URL (linked from the same page, `shop.odakyu-dept.co.jp/entry/contract`) but was not read in this task.

## 3. Part 2 — retries and counts

| Target | URL attempted | Result | Entries | Floor / zone labels | Store-code URL pattern | Page date | UTC | Method |
|---|---|---|---|---|---|---|---|---|
| 新宿サブナード shop directory | https://www.subnade.co.jp/shop/ | NOT REACHABLE. `connect ECONNREFUSED 163.44.2.142:443` (plain reader). curl: port 80 and port 443 both refused (13 ms). Re-tried at 09:58 and 10:02 with the same result. | n/a | n/a | n/a | n/a | 09:55, 09:58, 10:02 | plain reader; curl |
| 京王百貨店 新宿店 floor guide / brand list | https://www.keionet.com/shinjuku/floor/ | NOT READABLE. Site-wide maintenance page (「メンテナンス中」). `https://www.keionet.com/` returns 302 to `https://www.keionet.com/error_res.html`. Re-tried at 10:02 with the same result. | n/a | n/a | n/a | none printed | 09:55, 10:02 | plain reader; curl |

No counts, floor labels, store-code patterns or page dates could be recorded for either target.

## 4. GAP list

| ID | Gap | Detail | What would close it |
|---|---|---|---|
| GAP-1 | 京王百貨店 terms text | Site in maintenance on every attempt between 08:51 (earlier attempt by the lead) and 10:02 UTC on 2026-10-24. No terms clause, no floor guide, no brand count. | Retry after maintenance ends; archived copies were not used and would need a lead decision. |
| GAP-2 | 新宿サブナード terms and shop directory | TCP connection refused on both port 80 and 443, from at least 09:55 to 10:02 UTC. Not an HTTP-level block, so no content can be read. | Retry later; nothing else in this task's scope can retrieve it. |
| GAP-3 | NewDays terms | Listed URL `www.newdays.co.jp` does not resolve for curl or the plain reader; one DNS lookup returned 150.95.255.38, which timed out. `www.newdays.jp` serves a `*.linkclub.jp` certificate. The operating company's site is under the OD-34 exclusion (jr-cross.co.jp). | Lead decision: either a working URL inside scope, or accept UNKNOWN. |
| GAP-4 | 小田急百貨店 rights clause | The site-policy page contains no copyright/reproduction/use clause; only a footer line. So there is no clause wording from this source for OD-34. | Lead decision on whether to read the membership agreement at `shop.odakyu-dept.co.jp/entry/contract` (not read here). |
| GAP-5 | Seibu terms are a portal's, not Seibu Railway's | The readable terms belong to 株式会社西武不動産プロパティマネジメント for a 駅ナカ・駅チカ portal. The clause prohibits reproduction/reuse without the rights holder's permission and states no private-use or law-allowed exception. | Lead decision on whether this portal is the intended Seibu source, or whether a Seibu Railway page is needed. |
| GAP-6 | Scope of permitted use (all readable pages) | None of the four readable pages states that data extraction, indexing or reuse in a project is permitted. Toei and Tobu carve out what copyright law allows for private use; Seibu does not. Treat as a rights question for OD-34, not as permission. | OD-34 decision. |
| GAP-7 | Page dates | Only Tobu prints an effective date (2002-07-22 09:00 JST). Toei, Odakyu and Seibu print no revision date on the pages read. | None needed unless OD-34 requires version dating; a site-wide change history would be the only route. |
