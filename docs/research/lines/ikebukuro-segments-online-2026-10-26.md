# Ikebukuro walking segments — online pass, 2026-10-26

**For:** data-research-98 (data lead). **Written:** 2026-10-26, 06:05–06:21 JST, by `ds-infra` (deepseek-flash). **Docs only: no station data, POI, graph or import file is changed.**

**Question.** [`gap-table-2026-10-25.md`](gap-table-2026-10-25.md) Table A gives the Ikebukuro rows (b) **walkable segments** as `NONE` for Seibu, Tobu, M25, Y09 and F09, and [`field-run-2026-10-26.md`](field-run-2026-10-26.md) carries the same gaps as field items. This pass asks whether any **facts-only** source outside PLATEAU prints those segments, so fewer of them have to be walked.

**Answer in one line.** No **gate-to-exit** segment can be closed from a facts-only source: Metro's and Seibu's pages print every named endpoint pair that involves a lift or an escalator, and print **no gate-to-exit opening, no fare side and no position**. What they do print is already shipped as a SEARCH_ONLY POI, and the import contract forbids authoring a connector from a lift end pair ([`ikebukuro-line-pois-contract.md`](ikebukuro-line-pois-contract.md) §3). Four items narrow, and one Seibu segment turned out to have no sheet item at all and is added as item 49. **The pass's biggest lead sits outside the brief's source classes**: 交通エコロジー・モビリティ財団 prints turn-by-turn, text-only transfer routes that name both gates for six of the thirteen open gates — including a route to the Seibu B1F gate — but its rights class is UNKNOWN, so §2.6 records it and escalates it rather than using it.

## 1. Method, rights, and what "CLOSED-online" means here

- **Usable for this pass** (OD-34 facts-only classes, per the brief): Tokyo Metro station pages (live 403 from this host, so read through Wayback), Seibu Railway station pages (registered facts-only), 豊島区 pages (OD-34 r5c, terms recorded in #414), and the Toei CSVs **where they apply**. JCSC was checked only for the store side, which this pass does not touch.
- **Not usable as a basis:** JR East, Keio, Odakyu railway, Sogo & Seibu, PARCO, Takashimaya, Subnade — corroboration only. **らくおでかけネット** is also not a basis: it was classed **corroboration only** in #516 item 36 (「…営利目的での利用はお断りいたします。」), and it is not in OD-34.
- **Outside the brief's list → UNKNOWN.** 交通エコロジー・モビリティ財団's transfer-route pages were not in the brief's facts-only list, so they are **rights UNKNOWN** and nothing from them is a basis here (§2.6). Same treatment for だれでも東京, which the research run also named: its policy page did not load, so its class is **UNKNOWN** too, and it was not fetched.
- **Basis rule for a segment:** a segment counts only if a page **prints text or a printed list** that names both ends. Tracing a line on a 構内図, a PNG or a PDF figure is not evidence, and nothing below is derived that way. §3 records the drawings that were tried so a later pass does not repeat them.
- **No row in §2 carries the CLOSED-online verdict.** A printed lift/escalator span, or a 「改札外」 label, names both ends of a *device* or a *side* — not the gate↔exit opening the segment is about — so each such row is PARTIAL with the print kept in the quote column. CLOSED-online is reserved for a printed gate↔exit opening, and this pass found none.
- **CLOSED-online**, had one been found, would mean: *the printed link between two named points exists and is not contradicted.* It would still never mean the POI's `connectorNodeIds` can be filled — the contract forbids that from a printed pair, and position and fare side are printed nowhere.
- **豊島区 terms, quoted** (read 2026-10-26 06:12 JST, `https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html`): 「当サイト上の文書や画像等は、「私的使用のための複製」や「引用」など著作権法上認められた場合を除き、無断で複製・転用することはできません。」 Facts only, unchanged from #414's record.
- **Toei CSVs: not applicable.** 池袋 is served by JR East, Tobu, Seibu and Tokyo Metro only; no 都営 line calls there, so the three Toei CSVs (障害者設備一覧 大江戸線/新宿線, 駅基本情報, EV点検) have no 池袋 row and cannot contribute a segment. Nothing was imported from them and nothing was fetched for them this pass.

## 2. Segment record

Segment ids are mine (`S-…`) so the table can be cited; the POI ids and printed names are the repo's. "Ends" gives the shipped POI where one exists — a printed name with no POI is marked **no POI**.

### 2.1 Metro Y09（有楽町線）

| id | Ends | Printed text naming both ends | Source | Result |
| --- | --- | --- | --- | --- |
| S-Y1 | `metro-y-south-west-gate` 「有楽町線 南通路西改札」 ↔ `exit-4` 「4番出口」/「西口（南）」 | 「改札外 エレベーター 設置場所」「南通路西改札～４番出入口（エソラ）」; also 「エスカレーター（上り・下り） 設置場所」「南通路西改札～４番出入口（エソラ）」 | M1 (2026-06-07 snapshot) | **PARTIAL — device span printed, segment open.** The pair is printed as a lift/escalator span, i.e. a device link, not a gate↔exit opening; a second facts-only page agrees the Exit 4 end has a lift (M2 `elevator: "1"`). Field still owes: the gate↔exit opening, the floor list, the gate-line side and the fare side (item 3) |
| S-Y2 | `metro-y-south-west-gate` ↔ `ホーム（和光市寄り）` (no POI) | 「改札内 エレベーター 設置場所」「ホーム（和光市寄り）～南通路西改札」; escalator 「ホーム（中央・和光市寄り）～南通路西改札」 | M1 | **PARTIAL** — both ends printed, but the platform end has no POI and no number is printed (item 22) |
| S-Y3 | `metro-y-south-east-gate` 「有楽町線 南通路東改札」 ↔ `ホーム（中央・新木場寄り）` (no POI) | 「エスカレーター（上り・下り） 設置場所」「ホーム（中央・新木場寄り）～南通路東改札」; 「エスカレーター（上り）」「ホーム（新木場寄り）～南通路東改札」 | M1 | **PARTIAL** — printed, platform end has no POI |
| S-Y4 | `metro-y-south-west-gate` ↔ `seibu-b1f-gate` 「西武池袋線 B1F改札口」 | Ward barrier-free route table: 「南通路 有楽町線西改札～西武線改札」 | #512 S2 (not re-fetched) | **PARTIAL** — the gate at each end is named differently from the POIs: 「有楽町線西改札」 omits 南通路, and 「西武線改札」 names neither 1F nor B1F, so no POI can be matched by exact name. Item 2 / the Seibu row |

**Note on S-Y1 and item 3.** #512 already had the printed span; what is new here is that the **exit list (M2)** independently marks exit 4 as the lift-served end, which removes "does a lift stand at 4番出入口" from the walk. What remains for item 3 is unchanged and unprintable: whether that gate opens onto Exit 4 at all, the lift's floor list, the gate line it sits outside of, and whether the way to Exit 4 stays outside the gates.

### 2.2 Metro F09（副都心線）

| id | Ends | Printed text naming both ends | Source | Result |
| --- | --- | --- | --- | --- |
| S-F1 | `metro-f-west-east-gate` 「副都心線 西通路東改札」 ↔ `exit-c9` 「C9番出口」 | 「改札外 エレベーター 設置場所」「西通路東改札～Ｃ９番出入口」 | M1; M2 gives exit C9 `elevator: "1"` | **PARTIAL — device span printed, segment open.** Field still owes the gate↔exit opening and the C9 lift's floors (item 5) |
| S-F2 | `metro-f-west-east-gate` ↔ `exit-c1b` 「C1b番出口」 | 「改札外 エレベーター 設置場所」「西通路東改札～C１b出入口」 | M1; M2 gives exit C1b `elevator: "1"` | **PARTIAL — device span printed, segment open.** **No field item asks for the C1b lift's floor list** — see §6 follow-up 2 |
| S-F3 | `metro-f-west-east-gate` ↔ `exit-c8` 「C8番出口」 | 「エスカレーター（上り） 設置場所」「西通路東改札～Ｃ８番出入口」 | M1; M2 gives exit C8 `elevator: "0"` (consistent: an escalator, not a lift) | **PARTIAL** — an up-only escalator is not a step-free link, and no floor list is printed |
| S-F4 | `metro-f-west-west-gate` 「副都心線 西通路西改札」 ↔ `exit-c6` 「C6番出口」 | 「エスカレーター（上り・下り） 設置場所」「西通路西改札～Ｃ６番出入口」 | M1 | **PARTIAL** — printed link, no floor list, no fare side |
| S-F5 | `metro-f-west-west-gate` ↔ `exit-c7` 「C7番出口」 | 「エスカレーター（上り・下り） 設置場所」「西通路西改札～Ｃ７番出入口」 | M1 | **PARTIAL** — as S-F4 |
| S-F6 | `metro-f-west-east-gate` ↔ `ホーム（中央）` via 中二階 | 「改札内 エレベーター 設置場所」「ホーム（中央）～中二階～西通路東改札」; escalators 「ホーム（中央・和光市寄り）～中二階～西通路東改札始発～24：00」, 「ホーム（中央・渋谷寄り）～中二階～西通路東改札」 | M1 | **PARTIAL** — the platform end has no POI; the printed 「始発～24：00」 is escalator **service** hours, not passage hours (G1) |

Two devices appear in the 2026-06 snapshot that no POI carries: a **階段昇降機** 「西通路東改札～丸ノ内線・有楽町線連絡階」 and an escalator of the same span. Neither end is a shipped POI, and a stair lift is not a general step-free route, so neither closes anything; they are listed so the data lane can decide whether they become POIs.

### 2.3 Metro M25（丸ノ内線）

| id | Ends | Printed text naming both ends | Source | Result |
| --- | --- | --- | --- | --- |
| S-M1 | `metro-m-central-west-gate` 「丸ノ内線 中央通路西改札」 ↔ `ホーム（終端寄り）` (no POI) | 「改札内 エレベーター 設置場所」「ホーム（終端寄り）～中央通路西改札」; escalator 「ホーム（荻窪寄り）～中央通路東改札」 | M1 | **PARTIAL** — both ends printed, platform end has no POI (item 21) |
| S-M2 | `metro-m-central-east-gate` 「丸ノ内線 中央通路東改札」 ↔ `exit-34` 「34番出口」 | 「改札外 エレベーター 設置場所」「中央通路東改札～３４番出入口」 | M1 | **CONTESTED — stays FIELD.** M2 marks exit **34 `elevator: "0"`** and exit **35 `elevator: "1"`**. The two Metro pages disagree and cannot both be right; item 9's landing-plate check is the only way to settle it |
| S-M3 | `metro-m-central-east-gate` ↔ `exit-35` 「35番出口」 | 「エスカレーター（上り・下り） 設置場所」「中央通路東改札～３５番出入口」 | M1 | **CONTESTED — stays FIELD.** Same conflict, from the other side: M1 prints an escalator to 35, M2 marks 35 as the lift-served exit |
| S-M4 | `metro-m-central-east-gate` ↔ 改札外広場 (toilet/baby/ostomy) | 「車いす対応トイレ（改札外）」「中央通路東改札外広場」; 「乳幼児用設備（改札外）」「中央通路東改札外広場」; 「オストメイト（改札外）」「中央通路東改札外広場」 | M1 | **PARTIAL** — the free-side fact is printed (「改札外」 labels), which corroborates #512 row 5, but it is not a walking segment for a POI and is not entered as one |

**The 34/35 conflict, stated precisely.** M1 gives the M25 ground lift the span 「中央通路東改札～３４番出入口」 and the escalator the span 「中央通路東改札～３５番出入口」. M2, a per-exit list generated from the same operator, flags exactly four Ikebukuro exits as lift-served — **4, 35, C1b, C9** — which agrees with M1 on every lift except this one. So the two pages agree four times and disagree once, and the disagreement is item 9's whole question. The 2019 capture of Metro's exit index (M3) does not carry an elevator column and cannot break the tie.

### 2.4 Tobu（東武東上線）

| id | Ends | Printed text naming both ends | Source | Result |
| --- | --- | --- | --- | --- |
| S-T1 | `tobu-central-gate-1` 「東武東上線 中央1改札」 / `tobu-central-gate-2` 「中央2改札」 ↔ 西口方面地下通路 (no POI) | 「中央改札を出て地下通路を西口方面へ」 (under the 東武東上線 heading) | #512 S11 — the page of **東武ホープセンター**, the underground-mall operator, whose class #512 recorded as facts-only; **東武鉄道 itself is corroboration only and was not used** (not re-fetched) | **PARTIAL, and only while that class holds** — one gate group named 「中央改札」, no side, no exit. If the lead reads ホープセンター as Tobu material, this row drops to corroboration and the gate placement is FIELD with no online candidate. Already recorded as #512 row 4 |
| S-T2 | `tobu-north-gate` 「東武東上線 北改札」 ↔ `north-passage` 「北通路」 / 北口（東武鉄道） (no POI) | Ward route table 「北通路 アップルロード～北口（東武鉄道）」 | #512 S2 (not re-fetched) | **PARTIAL** — the route names 北通路 and a Tobu 北口, not the 北改札, so it does not place the gate. Item 11 stands |
| S-T3 | Tobu 中央1/中央2 gates ↔ the 中央通路 west run | 東武百貨店's access-map legend lists 「東上線中央改札1・2」 under 〈東武東上線〉 | #529 / field-run item 26 (corroboration of a legend, not a tie) | **still FIELD** — a legend is a list of gate names, not a printed tie from a store entrance to a gate. Item 6 stands |

Tobu's own site stays corroboration only (OD-34 r2, §8 営業活動の禁止), so no Tobu page was fetched for this pass. Nothing in a usable class places a Tobu gate on a named passage with both ends named — the closest prints are S-T1's 西口方面 direction, which names no passage, and §2.6's S-E2, which is rights-UNKNOWN. That is what #512 row 27 and item 11 already say.

### 2.5 Seibu（西武池袋線）

| id | Ends | Printed text naming both ends | Source | Result |
| --- | --- | --- | --- | --- |
| S-S1 | `seibu-b1f-gate` 「西武池袋線 B1F改札口」 ↔ 南通路 (POI `south-passage` 「南通路」) | Ward route table 「南通路 有楽町線西改札～西武線改札」 | #512 S2 (not re-fetched) | **PARTIAL** — 「西武線改札」 is not the POI's printed name, and the route's 南通路 is named inside a route label, not tied to the gate by a page |
| S-S2 | `seibu-1f-gate` 「西武池袋線 1F改札口」 ↔ any exit or passage | **nothing** | S1, S2 (this pass) | **still FIELD** — Seibu prints the gate name only as 「1F改札口付近」, in an AED sentence (S1: 「1F改札口付近およびB1F改札口付近にAED(自動体外式除細動器)を設置しております。」), with no exit, passage or direction |
| S-S3 | `seibu-minami-guchi` 「西武南口」 ↔ a gate | **nothing** | S1 | **still FIELD** — the only printed line about 西武南口 is a service-hours entry: 「お忘れ物取扱所（西武南口）7:00～22:30」「西武南口 7:00～22:30」. Hours are not a segment |

**The two 「西武」 exit names are not gates.** T2 prints 「◆東口（中央）･･･現在の「西武東口」：37／◆東口（南）･･･現在の「西武口」：38」. Both are **exit** names, and both match the shipped POI aliases, so neither says anything about `seibu-1f-gate`, `seibu-b1f-gate` or `seibu-minami-guchi` — a «西武口 → Seibu gate» reading would be an inference, and is not made here (§3).

**Seibu has no sheet item at all.** The gap table's Seibu row says "Field check gate↔opening; no segment source", but scanning the pre-existing items 1–48 of the field-run sheet shows no item for `seibu-1f-gate`, `seibu-b1f-gate` or `seibu-minami-guchi` (§5). That is the one segment family this pass can hand to the walk, and it is added as **item 49**.

### 2.6 A class outside the brief — 交通エコロジー・モビリティ財団 transfer routes (rights UNKNOWN)

This came out of the oracle research run (`~/.local/state/oracle-ego/runs/20261026-060814-1417-ikb-segments-online`) and was then verified here from the page itself. E1 is a text-only, turn-by-turn バリアフリー transfer guide, one page per station, each route stamped 「［2024年6月時点］」 (30 stamps on the Ikebukuro page).

| id | Ends (both named prints) | Printed text naming both ends | Result |
| --- | --- | --- | --- |
| S-E1 | `metro-m-central-west-gate` 「丸ノ内線 中央通路西改札」 ↔ `jr-central-gate-1` 「JR 中央1改札」 | 「③ 右側にある東武東上線「中央改札２」の前を通過してさらに進むと、左側が丸ノ内線「中央通路西改札」です。」 (route: JR→丸ノ内線) | **PARTIAL — rights UNKNOWN.** Also names `tobu-central-gate-2` as the landmark passed |
| S-E2 | `tobu-central-gate-1` ↔ `jr-central-gate-1` | 「② しばらく直進すると、左側が東武東上線「中央改札１」です。」 (route: JR→東武東上線) | **PARTIAL — rights UNKNOWN.** The print spells it 「中央改札１」, the POI 「中央1改札」: same gate, not an exact-name match |
| S-E3 | `metro-y-south-west-gate` ↔ `jr-south-gate` | 「② 右手にある「東武百貨店」の前を通過して約20m進むと、左側が有楽町線「南通路西改札」です。」 | **PARTIAL — rights UNKNOWN** |
| S-E4 | `seibu-b1f-gate` ↔ `jr-south-gate` | 「② 「きっぷうりば（JR）」の手前を左折して約100m進みます。途中、有楽町線「南通路東改札」の前を通過します。」「③ 突き当たりを右折（「西武池袋線 池袋駅」の吊下げサインを通過して右折）し、さらに直進すると、正面が西武池袋線「B1F改札口」です。」 | **PARTIAL — rights UNKNOWN.** The strongest print there is for the Seibu gate: a direction, a hanging sign and a landmark list, still with no exit and no position |
| S-E5 | `metro-m-central-west-gate` ↔ `metro-y-south-west-gate` | 「丸ノ内線から有楽町線までは、丸ノ内線「中央通路西改札」を通過し、地下通路（オレンジロード）を経由して移動する経路です。」 | **PARTIAL — rights UNKNOWN** |
| S-E6 | `metro-y-south-east-gate` (negative fact) | 「※「南通路東改札」には、エレベーターがありませんのでご注意ください。」 (and 「同改札内にはエレベーターがありません」) | **PARTIAL — rights UNKNOWN.** A printed *absence*, which no Metro page states |
| S-E7 | Tobu 「B1改札口」 (no POI) ↔ `seibu-b1f-gate` / `jr-south-gate` | 「東武東上線から西武池袋線までは、東武東上線「B1改札口」を通過し、地下通路（オレンジロード）を経由して移動する経路です。」 | **no POI.** A Tobu gate called 「B1改札口」 that the POI set does not carry — a name for the data lane, not a segment |

**What it does not print, and this is the decisive limit:** the page contains **no 「出入口」, no 「番出口」 and no 「南口」** anywhere (zero hits on the extracted text). It is a transfer guide between operators, so it can only ever speak about gate↔gate and gate↔platform links. **Zero gate↔exit segments come out of it**, which is why the headline answer above does not change.

What it says about platform ends, for the paid loop (item 24): 「※５番線は、降車専用です。」 (Tobu 5 is alighting only), 「東武東上線（中央改札１から各ホームまで）…１番線・２番線をご利用の場合 改札を通過すると、左前方に１番線・２番線行きのエレベーターがあります。３番線・４番線をご利用の場合 改札を通過すると、右前方に３番線・４番線行きのエレベーターがあります。」, and for Seibu 「エレベーターを出て１番ホーム（降車専用）を直進し…」.

**Rights — why none of the above is a basis.** E1 was not in the brief's facts-only list, so its class is **UNKNOWN** by the brief's own rule. Its terms page (E2) prints: 「ご利用者個人で利用するため、コンテンツをダウンロードしたり、ご利用者個人のパソコンにデータを保存、またはプリントアウトすることは自由ですが、これを他のサイトや印刷媒体に転載したりすることはできません。その他著作権法で認められている範囲を超えて、サイトに収録されているコンテンツを著作権者に無断で使用することはできません。」 That wording is shaped like 豊島区's clause (personal copying fine, no reprinting, nothing beyond copyright-law allowances), but **whether a clause of that shape admits facts-only extraction is a rights-lane ruling, not mine**, and OD-34 does not cover this publisher. Until that ruling, nothing in S-E1…S-E7 may be imported, cited as closure, or turned into a connector: the rows above are recorded so the ruling can be made on a concrete list.

## 3. Drawings and lists tried, and why they do not close a segment

| What was tried | What it is | Why it does not count |
| --- | --- | --- |
| Metro 構内図 (`.../station/ikebukuro/map/`, live 403; Wayback redirects to the station top page) | The station page's 「構内図を見る」 buttons on the accessibility page all link to `../index.html#adjacent`, and the page loads `yardmap_v3.js` — an interactive map panel | A drawing. No text list of gate↔exit pairs exists behind it, and a route read off it would be inferred |
| Metro exit pages `map/exit_<n>.html` (Wayback; e.g. exit_34 2016-09-08, exit_35 2016-04-29, exit_1a 2016-09-08) | Per-exit pages: title 「34出入口 | 池袋駅/M25/Y09/F09」, then 周辺スポット and a map | The title gives a **line** attribution per exit (34 → M25/Y09/F09; 35 → M25) and 周辺スポット a proximity list. No gate name, no floor list. GAP for segments |
| Metro exit index `map/index.html` (Wayback 2019-10-19) | Reverse index, 38 exits: facility → exit numbers, e.g. 「池袋パルコ 27」「東武百貨店プラザ館 3」 | A proximity list, not an entrance tie: 東武百貨店 池袋店 appears against exits 3, 4, 5, 6a, 6b and 7 in M2, which no single entrance can be. Useless for segments; see §6 follow-up 4 |
| Metro `exit.json` (M2) | Machine-readable exit list: `exit_no`, `elevator`, `close`, `usage_limit`, `facilities` | Carries **no gate field**. It settles lift presence and closures per exit, not a gate↔exit opening |
| Seibu 構内図 `railway/station/image/SI01_1.png` (live 2026-10-26 06:12 JST, `image/png`, 145,262 bytes) | The station-inside map | A PNG. DR-RT-26 had already found Seibu's exit and lift routes are images only |
| Seibu バリアフリー情報一覧 `railway/barrierfree/list/` (live 2026-10-26 06:12 JST) | One row per station; columns バリアフリートイレ / エレベーター / エスカレーター / ワイド型改札機 / ハンドル型電動車いすのご利用 / 点字触知図版 / 点字手すりプレート / 点字運賃表; 池袋 row all 〇 | Flags only: no position, no endpoint, no floor |
| 豊島区 サインガイドライン Ver1.3（案）, 令和8年3月, PDF created 2026-05-19 13:14 JST (T2) | Signage standard, 66 pages | Its rules are about **which signs to use**, e.g. 「（駅改札から出入口までの誘導）」「原則として、改札口からは「主要出入口」を誘導する」 and 「「主要出入口」は西口（北）、西口（中央）、西口（南）、東口（北）、東口（中央）、東口（南）の６箇所とする」. That is a guidance policy, not a statement that gate X opens onto exit Y. Its gate labels (中央1改札, 中央2改札, 中央通路中央改札, 中央通路東改札, 西通路東改札, 南通路西改札, 地下改札 …) sit on a figure — positions read off it are not evidence |

Two things in T2 do hold up as **text**, and both bear on the Seibu question.

1. **A printed list of 主要出入口 against exit numbers** (also in #512 S1's Ver1.2 edition): 「主要出入口と出口番号の関係は以下の通りである。◆東口（北）･･･現在の「JR東口」：22／◆東口（中央）･･･現在の「西武東口」：37／◆東口（南）･･･現在の「西武口」：38／◆西口（北）･･･現在の「北口」：20a／◆西口（中央）･･･現在の「西口」：19／◆西口（南）･･･現在の「プリズムガーデン」：４（新たに4番を付記）」. This is a naming scheme for **exits**, and it agrees with the shipped POI aliases (`exit-4` 西口（南）, `exit-37` 東口（中央）, `exit-38` 東口（南）). It matters here because two of those current names contain 西武 — 「西武東口」 and 「西武口」 — and they are **exits 37 and 38, not the Seibu gates**. Anyone reading 「西武口」 as a Seibu Railway gate would be wrong, and no source read connects 西武口 to `seibu-1f-gate`, `seibu-b1f-gate` or `seibu-minami-guchi`.
2. **A figure label 「地下改札」** in the 西武 area of the plan drawing, beside 西武池袋本店, with 「西武線」 and 「SEIBU」 as separate text runs nearby. The runs are not one printed string, so 「西武線 地下改札」 would be a fabrication — the label reads 「地下改札」. As a figure label it is not evidence of a segment, and it does not match any POI's printed name (the POIs read 「西武池袋線 B1F改札口」 and 「西武池袋線 1F改札口」). It is recorded only so a later pass can ask the **data lane** whether 「地下改札」 is a name their Seibu gate should also carry.

## 4. What each open field item still owes, after this pass

| Field item | Still open after 2026-10-26 | Changed by this pass |
| --- | --- | --- |
| 2 (two Y09 gate lines, side, free side) | plate wording, column count, free side | **not yet** — §2.6 (S-E3) gives the side from which JR 南改札 approaches the Y09 west gate, but that source is rights-UNKNOWN and says nothing about the fare side |
| 3 (Y09 lift/escalator to Exit 4) | gate↔exit opening, floor list, gate line, fare side | **partly** — a lift/escalator span to Exit 4 is printed and a second facts-only page marks Exit 4 as lift-served (S-Y1); the opening, the floors and the fare side are not printed |
| 4 (two F09 gate lines) | plate wording, gate-line opening, free side | no |
| 5 (C exits in order, C9 lift floors) | the exit order, C9's floors | **partly** — spans to C9 and C1b are printed and both exits are flag-lift-served (S-F1, S-F2); the openings, the order and the floors are still open |
| 6 (four plates on the west run; Tobu 中央連絡西改札 wording) | all four plates, their order, the Tobu wording | **not yet** — §2.6 would place 東武 中央1改札 relative to JR 中央1改札, but that source is rights-UNKNOWN, so the walk still owns it |
| 9 (M25 east gate lift → 34 or 35) | which exit the lift lands at, plus the gate plate | **yes, in the other direction** — the two Metro pages now stand in explicit conflict (S-M2/S-M3), so the landing plate is the only settlement. A third Metro print was looked for and **not read**: Metro's 2016 elevator information table (`/safety/elevator/pdf/2016/october/marunouchi.pdf`) is 403 from this host and has no Wayback capture (E3), and it would be 2016 evidence anyway |
| 10 (free passage to 北通路, JR gate opening) | continuity, opening, plate | no |
| 11 (Tobu 北改札) | the plate, wherever it is | no — §2.6 never mentions 北改札, and its 「B1改札口」 is a different Tobu gate again |
| 19 (closures and changes) | each edge walked | **partly** — Metro's exit list marks **no closed exit** among its 35 Ikebukuro exits, and exit 1a is re-dated `202603`; the 2022 ward notice 「池袋マルイ解体工事に伴う出入口閉鎖（1a、C4 出入口閉鎖）」 (#512 S3) does not match the 2026 list — but that is **not** a reopening: `ikebukuro-line-pois-contract.md` §2 keeps 1a and C4 at **UNKNOWN** (the 2022 notice names them, the 2026-03 list includes them again), and an absent `close` flag is not evidence that a closure has ended. This is an exit-state question, not a passage-edge one, and item 19 stays open |
| 24 (Tobu platforms 1–5) | each 番線 plate and its destination | **not yet** — §2.6 prints 「※５番線は、降車専用です。」 and the 中央改札１ → 1・2番線 / 3・4番線 lift directions, but that source is rights-UNKNOWN, so the paid loop still owns it |
| — (new) 49 Seibu gates | everything | added (§5) |

## 5. Change to the field-run sheet

One item added, nothing else touched: **item 49, the Seibu gate segment.** The Seibu gates are the only open segment family with no sheet item — the Metro Y09/F09/M25 and Tobu gates are covered by items 2–6, 9 and 11, and JR East is out of this brief's scope. §2.6 does not change what the new item asks: that page prints a route *to* the Seibu B1F gate but no exit, fare side or floor, so the walk still owns all three.

The item carries the sheet's six-field format and is read at Stop 2 in the 南通路, but it is numbered 49 rather than inserted after item 19 so that no existing item is renumbered; the summary tables are updated for the new count.

## 6. Follow-ups

1. **Rights ruling needed on 交通エコロジー・モビリティ財団 (§2.6) — this is the highest-value item in the pass.** If the rights lane rules that a clause of the 豊島区 shape (personal use free, no reprinting, nothing beyond copyright-law allowances) admits facts-only extraction, six of the thirteen open gates gain a printed adjacency — including the Seibu B1F gate and both 丸ノ内線/有楽町線 south-west gates — and items 2, 6 and 24 plus the Seibu item — everything §4 marks §2.6-affected — narrow without a walk. If it rules against, §2.6 stands as a record of what was seen and nothing changes. Do not import any of it in the meantime.
2. **F09 C1b lift's floor list** is printed as a link but is not required by any item's CLOSED test — item 5 asks only for the C9 lift's floors. Either item 5 is widened to C1b, or a new item is added; that is the lead's call, not this pass's.
3. **The 34/35 conflict is an operator-internal one.** Metro's accessibility page (M1, 2026-06 snapshot) and its exit list (M2) disagree. If the data lane ever needs a printed answer before the walk, the way to get it is a fresh capture of M1 after the next Metro site revision, not another page.
4. **`exit.json`'s `facilities` list is proximity, not an entrance tie**, and it matters for three store items, so say it once: in M2 東武百貨店 池袋店 is attached to exits 3, 4, 5, 6a, 6b and 7; エソラ池袋 to exit **5**; 池袋パルコ to exits **22** and 27; 西武百貨店 to exits 36, 37 and 38. Two consequences for the sheet, neither of which this pass acts on because the brief leaves existing items alone: item 25's statement that nothing facts-only names a station element for エソラ is superseded (M2 names exit 5, while M1 prints 「4番出入口（エソラ）」 — the two Metro pages disagree here too), and item 27's "no facts-only source prints an entrance tie" can now at least start from exit 22. Both are still **entrance** ties and stay FIELD.
5. **`usage_limit` is undecoded.** Six Ikebukuro exits carry `usage_limit: "1"` (1a, 1b, 2a, 39, 40, C4) and 224 of the 1042 rows nationwide do; no page read explains the field. It is **UNKNOWN** and is not used as evidence anywhere above. Do not read it as exit-only or as limited hours without a printed key.
6. **Exit ownership is not in the list.** M2 enumerates 35 Ikebukuro exits; the POI set also carries exits 10, 11, 13–19, 23–26, 28, 30–32 and 42, which M2 does not list. Whether that means another operator owns them is **UNKNOWN** — it would be an inference from absence. Worth a data-lane question, not a fact.
7. **らくおでかけネット** is reachable and prints route prose for other stations, and Seibu's own page links to it, but its terms are commercial-use-restricted (#516 item 36), so it is corroboration only and was not fetched this pass. Nothing from it is in this document.

## 7. Sources

Timestamps are JST. Every request used curl's default User-Agent; no `-A`/`--user-agent` or UA header; ≥0.6 s between requests; no login-gated page; nothing posted.

- **M1** 東京メトロ 池袋駅 バリアフリー設備, `https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html` — live 403 from this host; **Wayback snapshot 2026-06-07** (`id_` body, CDX timestamp `20260607134058`, 152,090 bytes) read 2026-10-26 06:09 JST. Prints, per line, the 設置場所 lists quoted in §2, the 「エレベーターによる1ルートに対応」 row (mark image `icon_mark_circle.png`, `alt="あり"`) on 丸ノ内線, 有楽町線 and 副都心線, and the note 「「地上～改札～ホーム」を、エレベーターによって結ぶ経路を１以上確保している」. Facts only (OD-34 §2).
- **M2** 東京メトロ 駅出口データ, `https://www.tokyometro.jp/station/exit.json` — live 200, 445,757 bytes, read 2026-10-26 06:06 JST. 1,042 rows nationwide, 35 for `station_base_name: "ikebukuro"`, fields `exit_no`, `elevator`, `close`, `usage_limit`, `facilities.ja/en`, `update`. Ikebukuro: `elevator: "1"` for exits 4, 35, C1b, C9; `close: "1"` for none; `usage_limit: "1"` for 1a, 1b, 2a, 39, 40, C4; only exit 1a carries an `update` value (`202603`). Facts only (OD-34 §2). **`usage_limit` semantics UNKNOWN** (§6.5).
- **M3** 東京メトロ 池袋駅 出入口・周辺地図（旧デザイン）, `https://www.tokyometro.jp/station/ikebukuro/map/index.html` — live 403; **Wayback snapshot 2019-10-19** (`id_`, CDX `20191019032718`) read 2026-10-26 06:09 JST. Title 「出入口・周辺地図 | 池袋駅/M25/Y09/F09」, 「38件」, a facility→exit reverse index. No elevator column. Facts only.
- **M4** 東京メトロ 池袋駅 出入口ページ（旧デザイン）, `.../map/exit_34.html` (Wayback 2016-09-08), `exit_35.html` (Wayback 2016-04-29), `exit_1a.html` (Wayback 2016-09-08). Titles 「34出入口 | 池袋駅/M25/Y09/F09」「35出入口 | 池袋駅/M25」「1a出入口 | 池袋駅/M25/Y09/F09」; body is 周辺スポット plus a map. Facts only.
- **S1** 西武鉄道 池袋駅, `https://www.seiburailway.jp/railway/station/ikebukuro/` — live 200, 63,220 bytes, read 2026-10-26 06:08 JST. Prints 「1F改札口付近およびB1F改札口付近にAED(自動体外式除細動器)を設置しております。」「当駅は車いす渡り板を常備しています。」, the section headings 「エレベーター、エスカレーター、階段の位置」「駅構内のご案内」, the バリアフリー設備 flag list, and the hours 「お忘れ物取扱所（西武南口）7:00～22:30」「西武南口 7:00～22:30」. Its lift/escalator/stair diagram is a PNG (`railway/station/image/SI01_1.png`, `image/png`, 145,262 bytes). Registered facts-only.
- **S2** 西武鉄道 バリアフリー情報一覧, `https://www.seiburailway.jp/railway/barrierfree/list/` — live 200, 149,553 bytes, read 2026-10-26 06:12 JST. 池袋 row all 〇 across the eight equipment columns; no position, endpoint or floor. Facts only.
- **T1** 豊島区 サイトポリシー, `https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html` — live 200, 23,634 bytes, read 2026-10-26 06:12 JST. 著作権について clause quoted in §1. Facts only (OD-34 r5c; #414).
- **T2** 豊島区『池袋ターミナル案内サイン整備計画およびガイドラインの更新について』資料3, ガイドライン **Ver1.3（案）**, 令和8年3月, `https://www.city.toshima.lg.jp/documents/56546/20260519131956.pdf` — live 200, 7,971,405 bytes, PDF created 2026-05-19 13:14 JST, read 2026-10-26 06:12 JST (66 pages, text layer extracted). Same terms as T1. This is the newer edition of #512's S1 (Ver1.2).
- **E1** 公益財団法人 交通エコロジー・モビリティ財団「乗換のバリアフリー経路情報」池袋駅, `https://www.ecomo.or.jp/barrierfree/transfer/ikebukuro/` — live 200, 136,857 bytes, read 2026-10-26 06:17 JST. HTML, text only (no image map), one block per operator pair (`?p=1_5&l=2` = JR→西武, `6_5` = 西武→東武 …), each stamped 「［2024年6月時点］」 (30 stamps). Quotes in §2.6. **Rights UNKNOWN — not in OD-34, so not a basis.** Found through the oracle research run, then verified here.
- **E2** 同財団「リンク・著作権」, `https://www.ecomo.or.jp/support/link.html` — live 200, 8,648 bytes, Shift_JIS, read 2026-10-26 06:18 JST. §2 著作権について quoted in §2.6. The class of that clause is the rights lane's call.
- **E3** 東京メトロ「エレベーター情報」（2016年10月・丸ノ内線）, `https://www.tokyometro.jp/safety/elevator/pdf/2016/october/marunouchi.pdf` — **not read: GAP.** 403 (442 bytes) from this host 2026-10-26 06:18 JST, and no Wayback capture (`2017id_` → 404). If it ever becomes readable it is 2016 evidence, not current state.
- **Not re-fetched this pass, cited from earlier records:** #512 S2 (豊島区バリアフリー基本構想 route table), #512 S3 (地下空間案内図 closure notice), #512 S11 (東武ホープセンター), #529 (東武百貨店 access-map legend).

## 8. Fetch log

Own requests, in order. `wayback` = `https://web.archive.org/web/<ts>id_/<url>`.

| # | Time (JST) | URL | Result |
| --- | --- | --- | --- |
| 1 | 06:05 | `tokyometro.jp/station/ikebukuro/exit.json` | 404 (44,342 bytes, error page) |
| 2 | 06:06 | `tokyometro.jp/station/shinjuku/exit.json` | 404 — the file is station-level, not per-station |
| 3 | 06:06 | `tokyometro.jp/station/exit.json` | 200 · 445,757 — **M2** |
| 4 | 06:06 | Wayback CDX `tokyometro.jp/station/ikebukuro*` | 200 · 30,214 |
| 5 | 06:06 | Wayback CDX `seiburailway.jp/railway/station/ikebukuro*` | 200 · 174 (one capture, 2022-03-19) |
| 6 | 06:07 | `tokyometro.jp/station/ikebukuro/map/index.html` (live) | 403 · 419 |
| 7 | 06:07 | `tokyometro.jp/station/ikebukuro/map/` (live) | 403 · 405 |
| 8 | 06:07 | wayback `map/exit_34.html` 2016-09-08 | 200 · 51,860 — **M4** |
| 9 | 06:07 | wayback `map/exit_35.html` 2016-04-29 | 200 · 51,184 — **M4** |
| 10 | 06:08 | `seiburailway.jp/railway/station/ikebukuro/` | 200 · 63,220 — **S1** |
| 11 | 06:08 | Wayback CDX `…/map*` (per-month) | 200 |
| 12 | 06:08 | Wayback CDX `…/accessibility*` (per-month) | 200 — found the 2026-06 capture |
| 13 | 06:09 | wayback `accessibility/index.html` 2026-06-07 | 200 · 152,090 — **M1** |
| 14 | 06:09 | wayback `map/index.html` 2019-10-19 | 200 · 23,695 (gzip body; 1,579,479 bytes inflated) — **M3** |
| 15 | 06:10 | wayback `map/exit_1a.html` 2016-09-08 | 200 · 51,713 — **M4** |
| 16 | 06:10 | wayback `yardmap/index.html` 2024 | 200 · 91,347, redirected to the station top page (2025-01-23) — no 構内図 text page |
| 17 | 06:12 | `city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html` | 200 · 23,634 — **T1** |
| 18 | 06:12 | `seiburailway.jp/railway/station/image/SI01_1.png` | 200 · 145,262 `image/png` |
| 19 | 06:12 | `seiburailway.jp/railway/barrierfree/list/` | 200 · 149,553 — **S2** |
| 20 | 06:12 | `city.toshima.lg.jp/documents/56546/20260519131956.pdf` | 200 · 7,971,405 — **T2** |
| 21 | 06:17 | `ecomo.or.jp/barrierfree/transfer/ikebukuro/` | 200 · 136,857 `text/html` — **E1** |
| 22 | 06:17 | `ecomo.or.jp/terms/` | 404 · 2,324 (a guessed path) |
| 23 | 06:18 | `ecomo.or.jp/` | 200 · 19,217 — its footer pointed at the copyright page |
| 24 | 06:18 | `ecomo.or.jp/support/link.html` | 200 · 8,648, Shift_JIS — **E2** |
| 25 | 06:18 | `tokyometro.jp/safety/elevator/pdf/2016/october/marunouchi.pdf` | 403 · 442 — **E3**, not read |
| 26 | 06:18 | wayback `…/marunouchi.pdf` (`2017id_`) | 404 · 4,706 HTML — no capture, **E3 stays a GAP** |

26 requests of the 80 allowed. Three 404s were path guesses (the per-station exit file twice, resolved by PR #539's precedent `station/exit.json`; and `ecomo.or.jp/terms/`, resolved from the site footer); nothing was retried more than once. No block, challenge or login page was met.

## 9. Assumptions and limits

- **The contract, not the sources, is the ceiling.** Even where two named ends are printed, 「no route or connector authored from a lift end pair」 ([`ikebukuro-line-pois-contract.md`](ikebukuro-line-pois-contract.md) §3) keeps every such POI SEARCH_ONLY. This pass does not propose a connector for any of them.
- **A printed pair is evidence of a link, not of geometry.** Nothing above gives a gate's side, a column, a floor list or a fare side, and no source is stretched to imply one.
- **Old captures are dated evidence.** M3 (2019) and M4 (2016) are cited with their capture dates; M3 still carries 「三菱東京UFJ銀行」, i.e. pre-2018 wording, which is why it is only used for structure. M1 and M2 are the current pair used for facts.
- **Wayback capture timestamps are the CDX values**, and for M1 the page's own text (「2026年6月」/「2026年7月」 elevator outage blocks) supports a 2026-06 capture.
- **Nothing from §2.6 is used as evidence.** Its rows are recorded because the lead needs a concrete list to rule on; every verdict there is PARTIAL for one reason, the rights class, and no claim in §2, §4 or §5 rests on it.
- **Tobu and JR East pages were not fetched**: corroboration-only classes, by OD-34 §1 and r2. Their rows here rest on the earlier sets (facts-only ward and Tobu Hope Center pages) and are unchanged.
- **No store entrance is closed or re-classed.** §6.3 records the exit list's store names because they bear on items 25 and 27, but a 周辺施設 list is proximity, and the field items stay as they are.
