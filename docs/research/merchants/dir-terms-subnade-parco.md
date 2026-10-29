# DR: 新宿サブナード / 池袋PARCO — directory and terms facts (2026-10-29)

- Basis: `origin/main` `e643daa6` (2026-10-29 07:05 JST). Covers `docs/research/gaps/coverage-sjk-ikb.md` line 46 (新宿 サブナード, "find permissible directory") and line 53 (池袋 PARCO, "obtain usable public directory"). Prior inventory: `docs/research/gaps/DR-merchant-sources.md` rows DR-MR-10..14; prior reads: `docs/research/merchants/dept-store-terms-2026-10-25.md` rows 5–6, `docs/research/gaps/DR-terms-and-retries-2026-10-24.md` GAP-2, `docs/research/merchants/shinjuku-3stores-facts-2026-10-26.md` (`shop-sjk-subnade`, 新宿駅 B10), `docs/research/merchants/merchant-source-matrix.md` (subnade row; `parco.co.jp` row).
- Method: `curl` only, default User-Agent, no added headers, no browser, no sign-ins, no forms. Times are UTC with JST in parentheses. `000` = no HTTP response (connection refused). The Wayback Machine is used only for サブナード, because its live site still refuses connections; archived bodies are labelled as such and are **not** a live read.
- Rights (OD-34): this file records **facts** (quoted clauses, URLs, retrieval times, sha256 of the body) and **what a directory shows** (counts, field names, floor labels). No shop names, descriptive copy, maps, logos or photos are copied. Every facility below ends with `classification: for director` and the closest OD-34 precedent. Nothing is imported on the strength of this file.
- Scope limit: 池袋PARCO's terms were already read and ruled on 2026-10-25 (`dept-store-terms-2026-10-25.md` row 6; director ruling #502, Corroboration only). This file cites that read and records only the current status, the page's own update date, and the directory facts.

## 1. 新宿サブナード — coverage-sjk-ikb row 46

### 1.1 Live site reachability (re-check of the #415 GAP)

| # | URL | Status | Retrieval (UTC / JST) | Note |
|---|---|---|---|---|
| 1 | `https://www.subnade.co.jp/` | 000 | 2026-10-28T22:05:57Z / 2026-10-29 07:05:57 JST | connection refused, 31 ms |
| 2 | `https://www.subnade.co.jp/` | 000 | 2026-10-28T22:06:03–22:06:06Z / 07:06:03–07:06:06 JST | three retries, refused in 18–36 ms |
| 3 | `http://www.subnade.co.jp/` | 000 | 2026-10-28T22:06:07Z / 07:06:07 JST | port 80 also refused, 14 ms |
| 4 | `https://subnade.co.jp/`, `http://subnade.co.jp/` | 000 / 000 | 2026-10-28T22:07:49–22:07:51Z / 07:07:49–07:07:51 JST | bare domain, both ports refused |
| 5 | `https://www.subnade.co.jp/shop/`, `/legal/`, `/floorguide/` | 000 | 2026-10-28T22:07:53–22:07:57Z / 07:07:53–07:07:57 JST | refused in 13–16 ms |

DNS resolves: `www.subnade.co.jp` and `subnade.co.jp` → `163.44.2.142` (checked 2026-10-28T22:06:07Z / 07:06:07 JST). The failure is at TCP connect, not HTTP, and is unchanged from #415 (2026-10-24) and `dept-store-terms-2026-10-25.md` row 5 (2026-10-25). **No live page could be read.** Everything in 1.2–1.4 is from Wayback Machine captures, clearly labelled.

### 1.2 Terms, as captured by the Wayback Machine

| Field | Value |
|---|---|
| Live page | `https://www.subnade.co.jp/legal/` — 000, refused (1.1) |
| Captured page | `http://web.archive.org/web/20261012202212/https://www.subnade.co.jp/legal/` |
| Capture time | 2026-10-12 20:22:12 UTC (2026-10-13 05:22:12 JST) |
| Retrieval | 2026-10-28T22:08:54Z / 2026-10-29 07:08:54 JST |
| HTTP status / bytes | 200 / 34,980 |
| sha256 (body as served by Wayback) | `54a5c766d5ee72abbefead201744aa377c4a09fbf65800a0b182b61f657bcb4d` |
| Page title | 「サイトご利用について｜新宿サブナード」 |

Clause 1 著作権について (verbatim):

> 当サイトで提供する情報及びサービス、並びに広告等に含まれるデザイン・写真・文章・画像・ロゴマーク等に関する著作権は新宿サブナード株式会社に、または新宿サブナード株式会社に使用を認めた権利者に帰属します。私的利用など法律によって認められる範囲を超えて、当サイトに掲載されている内容を無断使用することはできません。

No other clause on that page restricts reuse, reproduction, 転載, 複製, 営利 or business use; the remaining sections are about links and the accuracy of information.

Cross-check of the other footer policy page: `http://web.archive.org/web/20261012202224/https://www.subnade.co.jp/policy/` (capture 2026-10-12 20:22:24 UTC; retrieved 2026-10-28T22:08:57Z / 07:08:57 JST; 200 / 43,588; sha256 `532a3236b5dd10d1ccd086d35854c2a01181c99590c99eab7cfc2388478bf3f6`). It is the privacy policy (個人情報の取得・利用, Google Analytics); **no reuse, reproduction or commercial-use clause was found on it**.

**Closest OD-34 precedent:** LUMINE type — OD-34 §2 quotes the same shape at `https://www.lumine.ne.jp/policy/` (「私的利用など法律によって認められる範囲を超えて、当サイトに掲載されている内容を無断使用することはできません。」). The サブナード clause bans only use beyond private use or what the law allows; it contains no 営利 / business-use word.

**Ruled (director gteki-1b, 2026-10-29, OD-34 sixth round): LUMINE type, facts only** (store name, floor, category, entrances worded as the source prints them). Basis: the Wayback capture above (archive URL, capture timestamp and sha256 recorded), labelled 「live 拒連，存檔讀取」 (live refused, read from archive). Facts that can also only be read from an archive carry that archive's capture date; hours follow OD-32 with their date. When the live site answers again, re-read the terms and the facts; a changed clause is ruled again.

### 1.3 Directory (archived)

| Field | Value |
|---|---|
| Floor guide URL | `https://www.subnade.co.jp/floorguide/` (captured `http://web.archive.org/web/20261014182146/https://www.subnade.co.jp/floorguide/`) |
| Capture / retrieval | 2026-10-14 18:21:46 UTC (2026-10-15 03:21:46 JST); retrieved 2026-10-28T22:09:01Z / 07:09:01 JST |
| Status / bytes / sha256 | 200 / 103,567 / `7f8484fded97201ba73c989de089bba79ba4f0aeff0d9d51bd968f4eeb29dbd5` |
| Static HTML? | **Partly.** The floor/area shell, the exit list and the symbol legend are server-rendered HTML (`floorguide_map`, `exitBox`, `exitList`). Shop names are **not** printed on this page; the detail map pane is filled from other pages. |
| Shop search URL | `https://www.subnade.co.jp/search/` (captured `http://web.archive.org/web/20260917163336/https://www.subnade.co.jp/search/`) |
| Capture / retrieval | 2026-09-17 16:33:36 UTC (2026-09-18 01:33:36 JST); retrieved 2026-10-28T22:09:26Z / 07:09:26 JST |
| Status / bytes / sha256 | 200 / 227,549 / `1e4ca7bee8806044bdb2965a65d2acfc01a9e0a3a6882a7a964554ed85059f95` |
| Static HTML? | **Yes** — the result cards are server-rendered (`shopList_item` / `cs-shopName`), 85 cards on the page as fetched. |
| Fields shown | Shop name (`cs-shopName`), category (`cs-shopCate`), a short introduction block, photo and logo elements; filters by 五十音, category and map. |
| Floors printed | No floor-by-floor shop list is printed in the HTML; floor/area assignment is only inside the map pane of the floor guide. |
| Per-floor shop count | **GAP** — not printed in server-rendered HTML; the map pane was not rendered (no browser). Total from `/search/`: 85 cards. |
| Page update date | None printed on either page. |

Caveat: the directory numbers come from two different captures (search 2026-09-17, floor guide 2026-10-14), so they are not a single-day snapshot. Nothing from these pages may be imported until the director rules on 1.2.

### 1.4 Station access the facility prints

From `https://www.subnade.co.jp/access/` (captured `http://web.archive.org/web/20260917163336/https://www.subnade.co.jp/access/`; capture 2026-09-17 16:33:36 UTC; retrieved 2026-10-28T22:09:04Z / 07:09:04 JST; 200 / 44,902; sha256 `a3e36d809bc308b837219fec532c78f1492084bde48937c6a66f52cc68bfd4d1`):

> 「JR新宿駅東口より徒歩2分」
> 「西武新宿駅より徒歩1分」
> 「東京メトロ新宿駅より徒歩1分」
> 「東京メトロ新宿三丁目駅より徒歩1分」

The floor guide's own 出入口 list (same capture as 1.3, `https://www.subnade.co.jp/floorguide/`) prints 20 exits, each with its destinations:

| Exit | Text as printed |
|---|---|
| 1 | 新宿駅西口方面 / 大江戸線 新宿西口駅 / 西武新宿線 西武新宿駅 / 新宿プリンスホテル / 西武新宿PePe |
| 2 | 新宿駅西口方面 / 大江戸線 新宿西口駅 / 西武新宿線 西武新宿駅 / 新宿プリンスホテル / 西武新宿PePe |
| 3 | 歌舞伎町(一番街) / ホテルグレイスリー新宿 / ＴＯＨＯシネマズ新宿 / シネシティ広場 / 東急歌舞伎町タワー |
| 4 | ＪＲ新宿駅方面 |
| 5 | 歌舞伎町(一番街) / ホテルグレイスリー新宿 / ＴＯＨＯシネマズ新宿 / 東急歌舞伎町タワー |
| 6 | Alpen TOKYO |
| 7 | 歌舞伎町(中央通り) / ホテルグレイスリー新宿 / ＴＯＨＯシネマズ新宿 / ドン・キホーテ / 東急歌舞伎町タワー |
| 9 | 歌舞伎町(さくら通り) |
| 11 | 歌舞伎町(さくら通り) |
| 13 | 歌舞伎町(区役所通り) / 新宿区役所 / 花園神社 / 新宿ゴールデン街 |
| 14 | 伊勢丹 |
| 15 | 歌舞伎町(区役所通り) / 新宿区役所 / 花園神社 / 新宿ゴールデン街 |
| 15b | 歌舞伎町(区役所通り) / 新宿区役所 / 花園神社 / 新宿ゴールデン街 |
| 16 | 伊勢丹 / 新宿ピカデリー / ＭＵＪＩ新宿(無印良品) / 紀伊国屋書店 |
| 17 | モア４番街 |
| 18 | モア４番街 |
| 19 | モア４番街 |
| 20 | モア４番街 |
| 21 | モア４番街 / ビックカメラ新宿東口店 |
| 22 | モア４番街 / 三井住友銀行 / みずほ銀行 |

Exits 8, 10 and 12 are not printed on the page. These are entrance-field facts from the facility's own wording, not route evidence.

### 1.5 GAPs — 新宿サブナード

| ID | Item | What happened (status, time) | Next |
|---|---|---|---|
| SB-1 | Live site (all pages) | TCP connection refused, port 443 and 80, 10 attempts, 2026-10-28T22:05:57–22:07:57Z / 2026-10-29 07:05:57–07:07:57 JST. Unchanged from #415 and 2026-10-25. | Retry later; nothing live can be read now. |
| SB-2 | Per-floor shop counts | Not printed in server-rendered HTML; the map pane is client-side and no browser was used. | A browser read (OD-33 allows ego-lite for サブナード) or a future live-site read. |
| SB-3 | Live terms vs archived terms | The clause in 1.2 is a 2026-10-12 capture, not a live read. | Re-read `/legal/` when the host answers again. |
| SB-4 | Shop list on the floor guide | The floor guide prints no shop names; only `/search/` does, and from an older capture (2026-09-17). | Same as SB-1/SB-2. |

## 2. 池袋PARCO — coverage-sjk-ikb row 53

### 2.1 Terms (already ruled; cited, not re-litigated)

| Field | Value |
|---|---|
| Terms URL | `https://www.parco.co.jp/terms/` |
| Retrieval | 2026-10-28T22:05:57Z / 2026-10-29 07:05:57 JST |
| Status / bytes / sha256 | 200 / 36,312 / `c81b85974ab9fd5bbb233979f064067188a3395bcd6306539ae837e471ad62c0` |
| Page's own update date | `Updated Feb. 24, 2021` — **unchanged** from the 2026-10-25 read (`dept-store-terms-2026-10-25.md` row 6) |
| Clause | §1 知的財産権等について, limb (1): 「本サイトの利用者（以下「利用者」といいます）は、本サイトで提供する情報・サービス等について、(1)当社の事前の承諾を得ずに、私的利用以外の目的で利用すること、及び、(2)当社の事前の承諾（権利者である第三者が存在する場合には、当社を通じた当該第三者の承諾を含みます）を得ずに、著作権法で定める私的利用の範囲を超えて複製、送信、頒布、譲渡、貸与、翻訳、翻案する等の行為を行うこと、はできません。」 |
| Prior ruling | **Corroboration only** — director, 2026-10-25, #502 (`dept-store-terms-2026-10-25.md` row 6 and note 6; `merchant-source-matrix.md` `parco.co.jp` row). Limb (1) restricts *use* for any purpose other than 私的利用. |

**Closest OD-34 precedent:** the director's 2026-10-25 ruling on #502 is itself the precedent — a quoted use restriction covering any purpose other than private use is the same class as Tobu's commercial-use ban and Keio's 「一切お断り」. PARCO is **corroboration only**; no directory or tenant data from `parco.co.jp` or `ikebukuro.parco.jp` may be imported as primary evidence.

**classification: for director** (already ruled Corroboration only, 2026-10-25; nothing in the current read changes that). The facts below are recorded so the director can decide whether the directory is usable on any other basis; they are **not** a claim that it is.

### 2.2 Directory

| Field | Value |
|---|---|
| Floor guide URL | `https://ikebukuro.parco.jp/floor/` |
| Retrieval | 2026-10-28T22:06:19Z / 2026-10-29 07:06:19 JST |
| Status / bytes / sha256 | 200 / 56,180 / `4c002a5fcd73cce22c6eb853b8ab5d6f8227652b68918de4fa907041ccf866b7` |
| Static HTML? | **Yes** — 21 floor boxes are server-rendered (`floor-list__box`, `floor-list__floor`, `floor-list__name`), each linking to `/floor/detail/?f=<floor>&ft=type1` (本館) or `ft=type2` (P'PARCO). |
| Buildings / floors printed | 本館: B2F, B1F, 1F, M2F, 2F, 3F, 4F, 5F, 6F, 7F, 8F (11 floors). P'PARCO: B2F, B1F, 1F, 2F, 3F, 4F, 5F, 6F, 7F, 8F (10 floors; no M2F). |
| Per-floor detail URL | `https://ikebukuro.parco.jp/floor/detail/?f=<b2f|b1f|1f|m2f|2f…8f>&ft=<type1|type2>` |
| Shop list URL | `https://ikebukuro.parco.jp/shop/?category_search=alpha` |
| Retrieval (shop list) | 2026-10-28T22:06:19Z / 07:06:19 JST; 200 / 127,143 / `2a6baec42d9d300b91c2baee81b496c41f590f0c5f04b9e876f2fdb3ab6bdba4` |
| Static HTML (shop list)? | **Yes** — 152 server-rendered cards (`c-card06`), grouped by initial letter; no floor grouping on this page. |
| Fields shown | Shop name, floor label, category, unit number (printed on the floor detail cards), and a map link. |
| Page update date | None printed on the floor guide, the floor detail pages or the shop list. |

Per-floor shop counts, from the 21 floor detail pages (each status 200, fetched 2026-10-28T22:06:42–22:06:49Z / 07:06:42–07:06:49 JST; count = `floor-shop-block__name` occurrences):

| Building | Floor | Count | sha256 (page body) |
|---|---|---|---|
| 本館 | B2F | 7 | `f7fb6bb6f7979a0b5765c7615b099196ea8836a264d88fe7f601be04c36b6179` |
| 本館 | B1F | 16 | `964b649268effe8b89ce1dad0f10dfc8786da3c47ba0b8ade6993457184da786` |
| 本館 | 1F | 5 | `351bde53d3767c0b05946f17b2e9804b50966c7474c4bf239cd8997b4aa121c1` |
| 本館 | M2F | 4 | `d4c968dfc09e60c9c2bc1d419f2d7856848a627e96332d092ea381ffc60295da` |
| 本館 | 2F | 11 | `d99fe3f8d32a2bcfe6f2e3d47f00bf862522299fe51ab2b7b0c8fa96616ea4b1` |
| 本館 | 3F | 8 | `ae488559af819c5321edae5936b8dab8568533681de3de0617c1c80a27ae20a4` |
| 本館 | 4F | 15 | `91e0968f94535bb006239ea89a60a978c8896cbc8cc8f518b8d96ab6d10fd368` |
| 本館 | 5F | 16 | `0870cac5dc7cdbfd9e77eb5a4463522577db67fbdccb7c104f7b8ab5bd0d3b5e` |
| 本館 | 6F | 17 | `86b71e96aea1b005716213c0c369922f0e39ad85512916099fb88e65bcf49b46` |
| 本館 | 7F | 14 | `a176e4c2fc5931395b4383fd83a03a9a8974f9dfbd8db17bf6bcf6414ae4896c` |
| 本館 | 8F | 11 | `e68d82e5c55385503955550c44d889c0011e4ac95f1c491cd07b8c02c5dbd488` |
| P'PARCO | B2F | 1 | `de8f39a30bec3d383ce80eae25882cd0b2a827980dcf20025d181640d2fc4547` |
| P'PARCO | B1F | 1 | `e49560787c00234fae8b1a99515e6fcbbdb12aa8450225139430eb57663b02c9` |
| P'PARCO | 1F | 5 | `981015b5b282c423d9df27464991d918c1111592ef41f931e902350593cb1944` |
| P'PARCO | 2F | 5 | `841a0cc107e45489ae0fa2debabc9cdf89a89c8e9539375c36d16e2eb7b4398a` |
| P'PARCO | 3F | 8 | `7687cf2439a84ca3b64548c47293877c25259108196f58706c342e12eca60c9c` |
| P'PARCO | 4F | 2 | `2837214869bed83d52be6d10fd2eb84004f6cffef52e94b858bca82f77f8094e` |
| P'PARCO | 5F | 1 | `3fbd32d4630d3a3f7e56f40ed22496a6cf9cfc64e22b7930868326f05555a0b0` |
| P'PARCO | 6F | 1 | `c4f35691bcf656055027bca11bffc494acc33961c5a890fc6e7e52e69e807873` |
| P'PARCO | 7F | 1 | `f1c550d6202a99e587680c23b4990d12893919945b133af83937e16a9863b22c` |
| P'PARCO | 8F | 1 | `edf2b790a11ee0d72e075a5dc9a7deafc52b9f58e26f6ebfdbd52dafb8d9edca` |

Totals: 本館 124, P'PARCO 26, **150** across the floor detail pages. The alphabetical shop list shows **152** cards, so 2 cards are not on a floor detail page (or are listed twice); recorded as a fact, not resolved.

### 2.3 Station access the facility prints

**GAP.** The facility's own アクセス＆施設案内 page prints an address and map links; no station, line or exit wording is present in its text.

| URL | Status | Retrieval | Note |
|---|---|---|---|
| `https://ikebukuro.parco.jp/info/` | 200 / 49,714 / sha256 `ff79fa6ed7c1d367b97961632756ad737bc476f06d66665d5429fc8837438d6e` | 2026-10-28T22:07:17Z / 2026-10-29 07:07:17 JST | Prints 「東京都豊島区南池袋1-28-2」, opening hours and a Google Maps link; no line, station or exit wording anywhere on the page. |
| `https://ikebukuro.parco.jp/access/` | 200 (soft 404) / 14,675 / sha256 `4af54b9f350c7570ff916d72f856c7696236300d000bf159e0e17ca6c34d9624` | 2026-10-28T22:06:19Z / 07:06:19 JST | Body is 「ページが見つかりませんでした。」 — the URL exists but serves the not-found template. |
| `https://en.ikebukuro.parco.jp/info/` | 503 | 2026-10-28T22:07:37Z / 07:07:37 JST | English site unavailable. |

The current host's sitemap (`https://ikebukuro.parco.jp/sitemap.xml`, 200 / 6,323, 2026-10-28T22:06:52Z / 07:06:52 JST) lists no access page. Entrance facts for PARCO therefore have to come from a non-PARCO source (ward guide map or a field check), not from the facility's site.

### 2.4 GAPs — 池袋PARCO

| ID | Item | What happened (status, time) | Next |
|---|---|---|---|
| IK-1 | Station / exit access text | No such text is printed on the official site; `/access/` is a soft 404, the English site is 503. 2026-10-28T22:06:19–22:07:37Z / 2026-10-29 07:06:19–07:07:37 JST. | Field check or a facts-only ward source; field entrance is already item 27. |
| IK-2 | Directory rights | The directory is readable and static, but PARCO is Corroboration only (2026-10-25 ruling). | Director decision; nothing imported from it meanwhile. |
| IK-3 | 152 vs 150 | The alphabetical list has 2 cards more than the floor detail pages sum to. | Not investigated (out of scope). |

## 3. What this unblocks

1. サブナード: ruled facts only (OD-34 sixth round, 2026-10-29), read from archive. That does not by itself make a tenant import ready: the 85 cards are from a 2026-09-17 capture, floor assignment is unavailable, and neither the directory nor the terms have been verified live. A pre-import check of current status must come first.
2. 池袋PARCO: the directory is technically readable (static HTML, per-floor counts); its rights stay Corroboration only until the director rules otherwise, so there is **no** tenant import path from PARCO's own site today.
3. Both rows 46 and 53 stay `partial` in `coverage-sjk-ikb.md` until a field entrance is recorded; nothing here is route evidence.
