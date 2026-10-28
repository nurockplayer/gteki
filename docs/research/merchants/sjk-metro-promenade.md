# 新宿 メトロプロムナード — identity and directory facts (2026-10-29)

Scope: row 49 of `docs/research/gaps/coverage-sjk-ikb.md` (新宿 メトロプロムナード, all cells `?`) and fifth-round (d) of OD-34 ("no directory, 404"). This file records **facts only**: every fact carries its URL and retrieval time, and nothing else was copied — no shop list, descriptive copy, map, logo or photo. Times are JST unless marked `Z`; UTC is the retrieval record, JST is the report time.

Method: `curl -sS -L` with the tool's **default User-Agent only** (no `-A`, no `User-Agent` header, no browser, no ego-lite). No new fetch was made for this revision. `tokyometro.jp` HTML returns **403 (Akamai "Access Denied")** to this host, so its pages were read through Wayback captures and each capture ID is printed (Wayback IDs are UTC by definition). WebSearch was used for URL discovery only; Wikipedia and event pages that the search surfaced were not used as sources and nothing was taken from them. The ad-agency home page was fetched once for discovery (200) and yielded no fact. Requests are listed in §6, plus five HEAD size checks.

## 1. Identity

| # | Fact | Printed text (quoted, one sentence or less) | Source | Read |
|---|---|---|---|---|
| 1 | Official name as printed: 「メトロプロムナード」 | 「営団地下鉄丸ノ内線開通に伴い、新宿通り地下に「メトロプロムナード」完成」 | 新宿区史年表 昭和34（1959）年, `https://www.city.shinjuku.lg.jp/kusei/70kinenshi/s34.html` (HTTP 200, 38,328 B, sha256 `5d148c76981a07a524f52e24231b8c66133b0276995b229a4011e05ec0ecb170`) | 2026-10-29 07:07 JST |
| 2 | Completed 1959-03-15, in the same timeline entry as the 丸ノ内線 opening | 「3月15日」「営団地下鉄丸ノ内線（池袋～新宿間）16・6km、全線開通」 | same page as 1 | 2026-10-29 07:07 JST |
| 3 | Sits under 新宿通り (printed as the location) | same sentence as 1 (「新宿通り地下に」) | same page as 1 | 2026-10-29 07:07 JST |
| 4 | The line that opened with it was 営団地下鉄's 丸ノ内線; **no source read states the promenade's own operator or manager**, past or present | same sentence as 1 (「営団地下鉄丸ノ内線開通に伴い」) — this names the line's operator, not the promenade's | same page as 1 | 2026-10-29 07:07 JST |
| 5 | Is the 東京メトロ丸ノ内線 **改札外コンコース** at 新宿駅 | 「西武新宿駅～新宿駅間の地下部の移動は、新宿サブナード及び東京メトロ丸ノ内線改札外コンコース（メトロプロムナード）を経由する必要があり、アクセスに迂回が生じています。」 | 新宿区「都市計画変更案について」2021年7月, `https://www.city.shinjuku.lg.jp/content/000314336.pdf` (HTTP 200, 3,735,132 B, 8 pages, sha256 `9ee2c977d78a14b2c895a09670d62faa0710acea68f3c791ffe6127323be1091`), PDF p1 | 2026-10-29 07:12 JST |
| 6 | Diagram labels place it beside 新宿駅（東京メトロ丸ノ内線）和 新宿通り | 「新宿駅 (東京メトロ丸ノ内線)」「メトロプロムナード」「新宿通り」 (three diagram labels, not a sentence) | same PDF as 5, PDF pp2–3 | 2026-10-29 07:12 JST |
| 7 | Belongs to the 丸ノ内線 新宿駅, printed as M08 | 「新宿駅/M08 | 路線・駅の情報 | 東京メトロ」 (page title, not a sentence) | `https://www.tokyometro.jp/station/shinjuku/index.html`, Wayback capture `20261008072439` (HTTP 200, 91,853 B; live URL returns 403) | 2026-10-29 07:08 JST |
| 8 | Is an existing 地下通路 in the 新宿駅 area (not a planned one) | 「既存の地下通路としては、紫色の新宿サブナードとオレンジ色のメトロプロムナードがございます。」 | 第205回新宿区都市計画審議会議事録（令和3年7月9日）, `https://www.city.shinjuku.lg.jp/content/000321763.pdf` (HTTP 200, 642,364 B, 26 pages, sha256 `1b348f38969df5688d6a53bc7d83a29cb6e0f91406e4c09c55f783c92a8633d4`) | 2026-10-29 07:07 JST |
| 9 | A メトロピア shop stood inside it in 2018 (one shop fact, not a list) | 「① 新宿メトロピア店（丸ノ内線新宿駅メトロプロムナード内）」 | 東京地下鉄 press release, 2018-12-06, `https://www.tokyometro.jp/news/images_h/metroNews20181206_121.pdf`, Wayback capture `20181210123018` (HTTP 200, 560,234 B, sha256 `e76e16888777d407c3bde8385c7be3919be20fffe345da654683e395d75f8653`) | 2026-10-29 07:10 JST |

Not printed by any source read: the English name, the present manager/operator, the east endpoint (新宿三丁目駅 side), a dedicated exit series, a passage length and opening hours. Each is a GAP in §4 rather than an inference. The repo already carries the internal leads for the two location gaps and they are linked here, not restated: `docs/research/lines/field-run-2026-11-01.md` item 40 (the 新宿マルイ 本館 B1F entrance on メトロプロムナード) and item 56 (the walk from the 東京メトロ新宿駅 east end to the 新宿三丁目駅 「新宿駅方面」 end, exits B3/B4/B5 and A5). Those are field-check items, not first-party facts.

## 2. Directory

**Question:** is there a current shop/space list for the promenade?

**Answer: no current shop/space list was located.** Nothing was imported; there are no fields or counts to record beyond the single 2018 shop fact (#9).

| URL tried | Status at read | What it shows |
|---|---|---|
| `https://www.tokyometro.jp/metropromenade/` | **403** (Akamai "Access Denied", 390 B), 2026-10-29 07:06 JST (2026-10-28T22:06Z) | live site refuses this host |
| `https://www.tokyometro.jp/metropromenade/index.html` | Wayback returns **404 — no capture served** (4,648 B Wayback error page), 2026-10-29 07:10 JST (22:10Z) | no archived copy was returned for this path |
| Wayback CDX prefix `tokyometro.jp/metropromenade/` | 0 rows, 2026-10-29 07:06–07:08 JST (22:06–22:08Z) | no archived promenade page under that path |
| `https://www.tokyometro.jp/station/shinjuku/shop/index.html` | live **403** (419 B), 07:06 JST; Wayback capture `20260208110640` HTTP 200, 90,379 B, 07:08 JST | the station shop page prints **no** プロムナード text (0 hits) and no promenade list; DR-MR-15 recorded 6 shop-type entries for 2026-10-24, none of them the promenade |
| `https://www.tokyometro.jp/station/shinjuku/map/index.html` | **403** (418 B), 07:06 JST | station map page refused |
| `https://www.metro-pro.jp/` + `/sitemap/` + `/news/` + `/corporate/history/` + `/corporate/outline/` + `/enterprise/retail/` + `/enterprise/commerce/` + `/enterprise/commerce/metropia/` | all **200** (9,742–16,287 B), 07:06–07:07 JST | 0 hits for プロムナード; the site map lists **7 facilities (count only)**, none of them the promenade |
| `https://www.metropro-sc.jp/` + `/sitemap.xml` + `/shop/honbu/echikalist.jsp` | all **200** (1,477–20,629 B), 07:06 JST | 0 hits; the portal covers Echika / Esola / メトロ・エム only |
| Metro Properties「Metro pia」所在地一覧 (`https://www.metro-pro.jp/enterprise/commerce/metropia/`) | 200, 12,085 B, 07:07 JST | lists **station names only** (新宿駅 appears); no shop names, no promenade |
| 新宿区 documents (s34, 000313318, 000321763, 000324472, 000314336) | 200, 07:07–07:12 JST | planning/minutes text only; no shop list |

The only directory-shaped fact found anywhere is the Metro Properties Metro pia page's station-level list (`新宿駅` is one entry, no shop names) and press release #9's single 2018 shop name. Current shop count, categories and floors: **UNKNOWN**.

## 3. Terms

Only **新宿区** (`city.shinjuku.lg.jp`) is used beyond the sites already read into OD-34. It is recorded here verbatim and left unclassified.

- **URL:** `https://www.city.shinjuku.lg.jp/kusei/about.html` (HTTP 200, 67,486 B), read **2026-10-29 07:06 JST** (2026-10-28T22:06Z).
- **sha256 of the fetched HTML:** `abc05302f63de4d42980ad6a7b9a4970aacce0031ffee74a8eb388b4c3182e6f`
- **Clause, quoted verbatim (two sentences; the operative one first):** 「掲載されている情報は、個人的かつ非営利的な使用目的だけのために利用する場合に限り、複製、使用、ダウンロードすることができます。」「著作権法上の「私的使用」や「引用」の範囲を越えて、本ページのコンテンツの使用を希望する場合は事前に問合せ担当課または区政情報課までお問い合わせください。事前の許可がない限り、転載、変更、発行、配布、掲示などは一切できません。」
- **classification: for director.** Closest precedent named for the director, not ruled here: the 新宿区 entry already recorded in `docs/research/merchants/shinjuku-3stores-facts-2026-10-26.md` §5 (#502 class: a quoted use restriction covering purposes beyond private use → corroboration only). Until the director rules, the 新宿区 facts above are recorded as **corroboration only** and must not be imported.

Two sites are already inside OD-34 and were re-read only to test status, not to add a clause:

- **Tokyo Metro** — OD-34 §2, facts only. Live `https://www.tokyometro.jp/terms/index.html` returns **403** (395 B) at 07:06 JST; the live data file `https://www.tokyometro.jp/station/exit.json` returns **200** (445,757 B, sha256 `e05abf041cce32e0efac843f3c67169b03634f45fa02614112700c57eb51693a`), same bytes as the read recorded on 2026-10-26.
- **Metro Properties** — OD-34 §2. `https://www.metro-pro.jp/terms/` returned 200 (10,013 B) at 07:06 JST; no new clause is quoted because OD-34 already records it.

Sites used for **discovery only** (no fact taken): Wikipedia, eventernote, shunkosha.co.jp, metro-ad.co.jp. Only the metro-ad home page was fetched (200, 22,820 B); its media sheet `https://www.metro-ad.co.jp/common/pdf/media/station/216.pdf` returned **404** and its terms page also **404** at 07:12 JST, so no ad-media page was used.

## 4. GAPs

| ID | Gap | Detail (status, time) | What would close it |
|---|---|---|---|
| MPR-1 | Tokyo Metro HTML blocked | `tokyometro.jp` station/shop/map/metropromenade/terms pages all **403** (Akamai "Access Denied") from this host, 2026-10-29 07:06 JST (22:06Z); only `exit.json` answers (200). | A host or path that does not hit the WAF, or a director-approved read method. |
| MPR-2 | No archived promenade page | Wayback returned **no capture** for `/metropromenade/` (404 from Wayback, 07:10 JST); the CDX prefix query returned 0 rows. The fifth-round OD-34 record (301 → `/metropromenade/index.html` 404, 2026-10-24) still describes the last readable state. | A current official directory, if one is ever published. |
| MPR-3 | East endpoint unprinted | No source read prints the 新宿三丁目駅 end. The ward documents print only the 新宿駅 side and 新宿通り. | Tokyo Metro station pages/構内図 (MPR-1), or field item FC-SEP-02. |
| MPR-4 | Exit letters not attributed | `exit.json` holds **28 rows for 新宿駅 between A6–A18 and B5–B18**, counting B12a and B12b as printed separately; 新宿三丁目 rows carry A/B/C/E letters, but **none** is tagged メトロプロムナード; the 構内図 is a Flash/SWF shell (`yardmap/index_print.html`, no text), and field-run item 56 notes the Metro station maps print only 方面 arrows here. | 構内図 read (MPR-1) or the field walk in item 56 copying sign wording. |
| MPR-5 | Length and hours unprinted | No first-party page read prints either. The 「延長は約140m」 in 000324472 is the **proposed** 新宿サブナード–メトロプロムナード connector, not the promenade. | Official page or field sign photo (sign photo is private evidence only). |
| MPR-6 | English name unknown | The English station page has **no Wayback capture** (404 from Wayback, 07:11 JST); Japanese pages print only the katakana name. | Tokyo Metro English page when reachable. |
| MPR-7 | Large ward PDFs not read | `000347763.pdf` (11.7 MB, 「バリアフリー縦動線の整備事例（メトロプロムナード・新宿サブナード間）」), `000336763.pdf` (7.1 MB), `000319159.pdf` (6.4 MB), `000319161.pdf` (4.7 MB) were skipped under the no-large-download limit. | Read when the limit allows; they are planning material, likely no directory. |
| MPR-8 | No current shop/space list | §2. Only one dated shop fact (2018). | Field walk or a future official page. |
| MPR-9 | 新宿区 facts need a ruling | Clause quoted in §3; recorded as corroboration only, classification: for director. | OD-34 sixth-round entry by the director. |

## 5. What this unblocks

1. Row 49 **station access** can move from `?` to **partial**: the promenade is printed as the 東京メトロ丸ノ内線 新宿駅 out-of-gate concourse under 新宿通り (facts #5–#7), which ties it to M08 without asserting a route.
2. Row 49 **passage attribution** can move from `?` to **partial** (name, opening year, existing-passage status, one shop fact); **directory and inventory** stays `?` — no current list was located.
3. Still needs **FC-SEP-02** in `docs/research/field-collection-list.md` (新宿三丁目 endpoint, exits, posted hours, and the observed Subnade connection), which no page read here can replace.

## 6. Fetch log (JST; UTC in the record column)

| JST | UTC | Target | Status | Bytes | Note |
|---|---|---|---|---|---|
| 07:06:01 | 2026-10-28T22:06Z | `tokyometro.jp/station/shinjuku/index.html` | 403 | 410 | Akamai Access Denied |
| 07:06:02 | 22:06Z | `tokyometro.jp/station/shinjuku/shop/index.html` | 403 | 419 | same |
| 07:06:02 | 22:06Z | `tokyometro.jp/station/shinjuku/map/index.html` | 403 | 418 | same |
| 07:06:02 | 22:06Z | `tokyometro.jp/metropromenade/` | 403 | 390 | same |
| 07:06:02 | 22:06Z | `metro-pro.jp/` | 200 | 12,476 | |
| 07:06:04 | 22:06Z | `city.shinjuku.lg.jp/kusei/about.html` | 200 | 67,486 | terms, sha256 in §3 |
| 07:06:05 | 22:06Z | `tokyometro.jp/terms/index.html` | 403 | 395 | |
| 07:06:05 | 22:06Z | `metro-pro.jp/terms/` | 200 | 10,013 | already OD-34 |
| 07:06:20 | 22:06Z | `tokyometro.jp/station/exit.json` | 200 | 445,757 | sha256 in §3 |
| 07:06:21 | 22:06Z | `metro-pro.jp/sitemap/` | 200 | 9,742 | 7 facilities, no promenade |
| 07:06:22 | 22:06Z | `metropro-sc.jp/` | 200 | 20,629 | |
| 07:06:22 | 22:06Z | `metropro-sc.jp/sitemap.xml` | 200 | 1,477 | |
| 07:06:23 | 22:06Z | `metropro-sc.jp/shop/honbu/echikalist.jsp` | 200 | 15,642 | |
| 07:07:31 | 22:07Z | `city.shinjuku.lg.jp/kusei/70kinenshi/s34.html` | 200 | 38,328 | fact #1, #2 |
| 07:07:31 | 22:07Z | `metro-pro.jp/enterprise/commerce/` | 200 | 16,287 | |
| 07:07:41 | 22:07Z | `city.shinjuku.lg.jp/content/000313318.pdf` | 200 | 127,443 | 1 page |
| 07:07:41 | 22:07Z | `city.shinjuku.lg.jp/content/000321763.pdf` | 200 | 642,364 | 26 pages, fact #8 |
| 07:07:41 | 22:07Z | `city.shinjuku.lg.jp/content/000324472.pdf` | 200 | 862,578 | 37 pages |
| 07:07:51 | 22:07Z | `metro-pro.jp/corporate/history/` | 200 | 14,605 | |
| 07:07:51 | 22:07Z | `metro-pro.jp/news/` | 200 | 10,892 | |
| 07:07:51 | 22:07Z | `metro-pro.jp/enterprise/retail/` | 200 | 10,230 | |
| 07:07:52 | 22:07Z | `metro-pro.jp/corporate/outline/` | 200 | 9,853 | |
| 07:07:56 | 22:07Z | `metro-pro.jp/enterprise/commerce/metropia/` | 200 | 12,085 | station list only |
| 07:08:44 | 22:08Z | Wayback `station/shinjuku/index.html` `20261008072439` | 200 | 91,853 | fact #7 |
| 07:08:46 | 22:08Z | Wayback `station/shinjuku/shop/index.html` `20260208110640` | 200 | 90,379 | 0 promenade hits |
| 07:09:04 | 22:09Z | Wayback `station/shinjuku-sanchome/index.html` `20261017113922` | 200 | 96,640 | 0 hits |
| 07:09:06 | 22:09Z | Wayback `station/shinjuku-sanchome/shop/index.html` `20260607134644` | 200 | 99,540 | 0 hits |
| 07:10:13 | 22:10Z | Wayback `metropromenade/index.html` | 404 | 4,648 | no capture |
| 07:10:14 | 22:10Z | Wayback `http://…/metropromenade/index.html` | 404 | 4,645 | no capture |
| 07:10:15 | 22:10Z | Wayback `metropromenade` | 404 | 4,607 | no capture |
| 07:10:26 | 22:10Z | Wayback `station/shinjuku/map/index_print.html` | 200 | 91,188 | resolved to index capture `20250730020536` |
| 07:10:27 | 22:10Z | Wayback `station/shinjuku/yardmap/index_print.html` `20250809063327` | 200 | 7,685 | SWF map shell, no text |
| 07:10:31 | 22:10Z | Wayback `station/shinjuku-sanchome/map/index_print.html` | 200 | 95,956 | resolved to index capture `20250730020540` |
| 07:10:32 | 22:10Z | Wayback `station/shinjuku-sanchome/yardmap/index_print.html` `20260907202038` | 200 | 7,791 | SWF map shell |
| 07:10:50 | 22:10Z | Wayback `metroNews20181206_121.pdf` `20181210123018` | 200 | 560,234 | fact #9 |
| 07:10:52 | 22:10Z | Wayback `metroNews230516_24.pdf` `20230801023255` | 200 | 1,049,893 | 0 promenade hits |
| 07:10:55 | 22:10Z | Wayback `metronews_202203.pdf` `20240430105822` | 200 | 7,523,250 | 0 promenade hits |
| 07:11:14 | 22:11Z | Wayback `en/station/shinjuku/index.html` | 404 | 4,663 | no capture |
| 07:11:24 | 22:11Z | Wayback `station/shinjuku/map/index_print.html` `20160730203340` | 200 | 1,674,107 | 0 promenade hits |
| 07:11:47 | 22:11Z | `city.shinjuku.lg.jp/kusei/70kinenshi/index.html` | 200 | 46,244 | 0 hits |
| 07:11:48 | 22:11Z | `city.shinjuku.lg.jp/kusei/70kinenshi/` | 200 | 46,244 | same bytes |
| 07:12:01 | 22:12Z | `city.shinjuku.lg.jp/content/000314336.pdf` | 200 | 3,735,132 | 8 pages, fact #5, #6 |
| 07:12:10 | 22:12Z | `metro-ad.co.jp/` / `/terms/` / `/policy/` / media `216.pdf` | 200 / 404 / 404 / 404 | 22,820 / — / — / — | discovery only, nothing taken |

CDX queries (`web.archive.org/cdx/search/cdx`) were made at 07:06–07:10 JST: `tokyometro.jp/metropromenade/` prefix → 0 rows; `tokyometro.jp` domain filtered for `promenade` → 504 (timeout), retried with `--globoff` → also timed out; `tokyometro.jp/station/shinjuku/` and `tokyometro.jp/corporate/` prefixes → 200 lists. Wayback returned "Temporarily Offline" for two prefix queries at 07:08 JST and recovered by 07:08:44 JST. The 7,523,250 B `metronews_202203.pdf` was read because the search hit for the site listed it; it carried no promenade text.
