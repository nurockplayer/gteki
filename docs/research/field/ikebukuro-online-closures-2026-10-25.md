# Ikebukuro: what public sources settle online (2026-10-25)

- **Asked by:** data-research-05 (Owner priority, 2026-10-25 17:30). **Worker:** `ds-research` (deepseek-flash), branch `ds/ikebukuro-online-closures`, based on `origin/main` `a1d13f67`.
- **Question:** close every Ikebukuro item that a lookup can settle; leave only what truly needs one field run.
- **Scope:** all 11 stops of [`ikebukuro-field-checklist.md`](ikebukuro-field-checklist.md); the ikebukuro rows of [`../lines/gap-table-2026-10-25.md`](../lines/gap-table-2026-10-25.md) marked "field check", "no source" or "NONE"; Tokyo Metro M25 / Y09 / F09 platform numbers; Tobu Tojo platforms; the floors of 西武池袋本店 and 池袋PARCO 本館. One item was added by data-research-05 at 17:47: **lift positions and lift links on the B1 public graph** (`w_c` → `x22`, and the JR gates).
- **Docs only.** No station data, no POI and no graph change in this PR; the importable results are listed in §4 for a follow-up.
- **Method:** the brief's source order — (1) facts-only operator pages, (2) 豊島区 / 新宿区 pages and PDFs, (3) Tokyo Metro / Toei / Seibu text pages, (4) Wayback snapshots of blocked or maintenance pages, (5) `oracle-ego` to find any of those. Facts only, printed text only: no position is taken from a map image, a photo or a platform diagram. curl with its default User-Agent, requests spaced ≥0.6 s, ≈115 of the 120-request budget used; no login-gated page was fetched; no form, contact or post.
- **Verdicts:** CLOSED 3 · PARTIAL 13 · FIELD 12 (28 items).

## 1. Verdicts

| # | Item | Gap id | Verdict | Evidence | Field filled |
| --- | --- | --- | --- | --- | --- |
| 1 | `exit-22` prints 22番出口 and 東口（北）; the ward's former name for it is 「JR 東口」 | G12 | **CLOSED** | S1 p.5–6: 「◆東口（ 北 ）･･･現在の「JR 東口」：22」 | POI name/alias |
| 2 | Printed names and former names of the other five main exits (37, 38, 20a, 19, 4) | OD-22 aliases (gap-table Seibu row), G12 context | **CLOSED** | S1 p.5–6: 東口（中央）＝西武東口＝37, 東口（南）＝西武口＝38, 西口（北）＝北口＝20a, 西口（中央）＝西口＝19, 西口（南）＝プリズムガーデン＝4 | POI aliases for exits 37/38; names for 19/20a/4 |
| 3 | Is `west-exit-b1` printed anywhere as 「西口（地下）」? | G12 | PARTIAL | No printed source uses that name. S1 built the whole exit scheme on six names 「東口（北）（中央）（南）／西口（北）（中央）（南）」 (p.5) and keeps 「北通路」「中央通路」「南通路」 for the passages; the POI still rests on the 2022 map's area name | POI name justification — a plate check is still the only way |
| 4 | `af-central-passage-west`: does a Tobu Tojo central gate open onto the westbound B1 passage? | G4, G7 | PARTIAL | S11 prints, under the 東武東上線 heading, 「中央改札を出て地下通路を西口方面へ」 (the clause PR #485 could not corroborate). S2 p.27 prints the 中央通路 barrier-free route as 「中央通路 西口五差路 EV～東口メトロ EV」, which establishes the passage but names no gate, so the two sources overlap only on the passage, not on the gate | `accessFacts` — the Tobu clause now has a facts-only operator page behind it, but S2 prints the route, not the gate connection; gate side/column still open |
| 5 | Fare state of the central passage: is it 改札外? | G7 | PARTIAL | S5 prints 改札外 equipment as 「中央通路東改札～34番出入口」 and 「中央通路東改札外広場」: the passage between 中央通路東改札 and exit 34 is outside the fare area, and the concourse in front of that gate is a 改札外 square. Nothing printed covers the west run past the Marunouchi and Tobu gates | `accessFacts` fare state (east half only) |
| 6 | `af-east-jr-passage-north`: public passage north of the JR concourse to 北通路 | G4, G2 | PARTIAL | S10 prints the free-side walk 「JR池袋駅の北改札を出たら、右に曲がってください。」→「いけふくろう」→ stairs. S2 p.28 prints 北通路 as 「アップルロード～北口（東武鉄道）」. S10 is corroboration-only (JR East class) and S2 is facts-only (ward); neither establishes the complete graph connection | `accessFacts` |
| 7 | `af-north-passage`: is 北通路 east of the Exit 22 stairwell? | G4 | **FIELD** | No operator, ward or Tokyo text describes the passage's east end relative to the Exit 22 stairwell. Only a walk can | `accessFacts` |
| 8 | いけふくろう's position relative to JR 北改札 and the Exit 22 stair | G11 | PARTIAL | S12: 「JR北改札を出て右に進む」（the page splits this phrase across a heading and a line）「いけふくろうの像の横を通りすぎ、地上へ行く階段は上がらずに地下通路をそのまま道なりに進む」. S4: 「JR池袋駅 東口」「地下1階JR改札付近にあります。」. S10: statue on the right, stairs in front of it. Still no distance, node or side-of-passage | Landmark note — a printed name plus a route, not a position |
| 9 | Is the `n_c → x22` flight the Exit 22 stair? | G5 | **FIELD** | Both S1 (number ↔ name) and S10 (statue → stairs → street) are consistent with it, but neither places the stair on the graph's `n_c` node; the PLATEAU closure match stays a hypothesis | edge identity |
| 10 | Step count on `n_c → x22` | G6 | **FIELD** | Nothing printed states a step count for any Ikebukuro exit stair | edge stairs |
| 11 | What the Exit 22 stair top opens onto | G13 | **FIELD** | S10 (5121) prints 「階段を上がると、池袋の待ち合わせ場所「いけふくろう」に到着です。」 and 「「いけふくろう」正面の階段を上がると、Cafe&Bar RAGE ST池袋東口が右手に見えます。」 — street level beside a named tenant, **but the source names no exit number**, so it settles only the stair facing the statue, and that is Exit 22 only if G5 (row 9) is confirmed. The street name is not printed | POI landing note |
| 12 | Posted passage hours on the 9 edges | G1 | **FIELD** | No operator or ward text prints 通行可能時間 for 中央通路, 北通路 or the Exit 22 stair. S5 prints escalator **service** hours only (「…西通路東改札始発～24：00」); shop hours (ISP and 東武ホープセンター 10:00–21:00) and first/last trains are not passage hours. Absence of a printed hour is not evidence of 24-hour access | `hours` |
| 13 | Step-free facts on the 9 edges and at Exit 22 | G2 | **FIELD** | S5 and S2 place lifts at exits 34, 4 (エソラ) and C9 and name the 中央通路 route's two end lifts, but no source prints a lift or escalator at Exit 22 or on the north run. The walk's edges stay `wheelchair: null` | `wheelchair` |
| 14 | **Lift positions and lift links on the B1 public graph** (`w_c`→`x22` area; JR gates) — added by data-research-05 | G2 | PARTIAL | Metro's printed lift links (each a 改札外 lift): 丸ノ内線 「中央通路東改札～34番出入口」 (S5); 有楽町線 「南通路西改札～4番出入口（エソラ）」 (S5); 副都心線 「西通路東改札～C9番出入口」 (S5); route end lifts 「西口五差路 EV」「東口メトロ EV」「メトロポリタンプラザセンターエレベーター」 (S2 p.27–28); S9 counts 7 Metro lifts (11人) with no exit named. **No printed lift sits on `w_c`→`x22` or at the JR 北改札** | lift POIs / candidate lift edges (data lane decides) |
| 15 | Closures and changes on the walk | G3 | **FIELD** | No source prints a closure or change on any of the 9 edges. S3 (2022-01-06, ward letter) prints 「池袋マルイ解体工事に伴う出入口閉鎖（1a、C4 出入口閉鎖）」 — a dated closure of exits 1a and C4, explicitly unrelated to this walk; it is context for G3 as a class, not evidence for the route. `stale` on the route is source age and no walk clears it | closure note |
| 16 | Metro M25 platform numbers and directions | FC-IK-02, WP2 `notFound` | PARTIAL | S7 prints 「1番線／荻窪方面行き」「2番線／荻窪方面行き」 in text (not a diagram) — **corroboration only**, S7's terms carry a flat ban (S7b 第6条5). S6 prints the 荻窪方面 direction with no numbers. Metro's own barrier-free PDFs print no 池袋 platform number at all (see §5) | platform POIs |
| 17 | Metro Y09 platform numbers | F2 / I8 (WP2) | PARTIAL | S7 prints 有楽町線 as 「和光市方面行き」「新木場方面行き」 with **no** numbers; S5 prints gate↔exit links but no platform numbers; S6 directions only | platform POIs |
| 18 | Metro F09 platform numbers | WP2 `notFound` | PARTIAL | Same as 17: S7 prints 副都心線 directions without numbers; S5 names 西通路 gates and C exits; the F09 barrier-free PDF prints 池袋 only as a station name in a list | platform POIs |
| 19 | F09 geometry / C exits | "no geometry source" (gap table) | **FIELD** | No printed geometry for the Echika / C-exit side in any source read; mapping it needs a survey, not a text page | graph |
| 20 | Tobu Tojo platform numbers | "platforms have no source" | PARTIAL | Existence of 1–5 番線 from three grades: S2 「ホームドアを設置する。※1～3 番ホームは設置済み」 (2019-04, facts-only); S9 「ホームドア：1～4番線あり」 (2024-02-16 data, rights UNKNOWN); S8 「1番線　9号車4番ドア」…「5番線　9号車4番ドア」 (corroboration only). Which platform serves which destination is printed nowhere; only 1–3 sit on a facts-only source | platform POIs — import 1–3; 4 and 5 wait |
| 21 | JR gate↔opening (A2, FC-IK-01) | A2, FC-IK-01 | PARTIAL | S10 gives the 北改札 opening as a walk: out of the gate, right, past the statue, up the stairs. That is a JR-East-media description, corroboration only, and it does not name the opening | gate POI / `accessFacts` |
| 22 | Marunouchi and Tobu gate side and column (A1/A3) | A1, A3 | **FIELD** | S5 confirms that 中央通路西改札 and 中央通路東改札 are distinct printed gate names, but no text gives side or column of any gate; the 中央連絡西改札 wording stays unchecked | gate POIs |
| 23 | 南通路西改札 side and column (F2) | F2 | **FIELD** | S5 prints only the name. Column counting from the JR South Gate is a walk | POI |
| 24 | 南通路西改札 fare side and the route to 4番出入口 (I8) | I8 | PARTIAL | S5 prints both devices as 改札外: 「南通路西改札～4番出入口（エソラ）」(lift) and the same pair for escalators, so a free-side link exists; where the gate line sits is still unprinted | POI / `accessFacts` |
| 25 | 西武池袋本店 floors | gap-table Table B 西武 row | PARTIAL | S16 (2026-06-30): 「改装中の西武池袋本店は地下２階から地上８階に入居し…段階的にオープン。秋以降全面開業する見込みだ。」 with the same article printing 「縮小しリニューアルする西武」. S17 (東京都, 2024-06) prints 5階 as a 紳士雑貨売場. The range is an announcement date, the store is mid-renovation, and the trade-press terms are unread | store POI + floors |
| 26 | JR East (IK) platform numbers and platform access — the gap table's "no platform source" | gap-table Table A JR row | **FIELD** | S9's JR block prints equipment data only (車椅子対応トイレ B1F); S2's JR section prints 「ホームドアを設置する。※山手線は設置済み」 with no platform number. No printed list of JR platforms at Ikebukuro was found in any source class | platform POIs |
| 27 | Tobu Tojo gate↔opening — the gap table's "same field check" for Tobu | A2-equivalent (gap-table Tobu row) | **FIELD** | Nothing printed places the Tobu 中央1／中央2 gates or their opening on a named passage; S11 gives only 「中央改札を出て地下通路を西口方面へ」 | gate POIs / `accessFacts` |
| 28 | 池袋PARCO 本館 floors | gap-table Table B PARCO row | **CLOSED** (rights caveat) | S13: 「名称：池袋パルコ」「所在地:東京都豊島区南池袋１－２８－２」「階数：地下２階～地上８階」 (2021-10-29); S14 prints a B2F tenant, S15 an 8F tenant. PARCO's own site (S14b/S15b class) prints the same range but is corroboration only | store POI + floors — **import waits on the rights line** (DR-RT-06) |

## 2. Sources

Artifacts are in the worker's scratch directory (not committed); `sha256` prefixes are of the fetched bytes, timestamps are JST on 2026-10-25.

- **S1** 豊島区『池袋ターミナル案内サインガイドラインVer1.2』本編（令和2年3月改定）, page `https://www.city.toshima.lg.jp/405/1705251510.html` (更新日 2025年8月4日), PDF `https://www.city.toshima.lg.jp/documents/17300/saingaidorain-honpen_kaitei1-2.pdf`, `441c38b9…`, 17:33. Prints 「・「東口」「西口」の二方向で誘導する」 and, under 「主要出入口の設定」: 「東口（北）、東口（中央）、東口（南）／西口（北）、西口（中央）、西口（南）の６名称とする」 followed by 「◆東口（ 北 ）･･･現在の「JR 東口」：22」「◆東口（中央）･･･現在の「西武東口」：37」「◆東口（ 南 ）･･･現在の「西武口」：38」「◆西口（ 北 ）･･･現在の「北口」：20a」「◆西口（中央）･･･現在の「西口」：19」「◆西口（ 南 ）･･･現在の「プリズムガーデン」：４（新たに 4 番を付記）」. Facts only (OD-34 r5c).
- **S2** 豊島区『池袋駅地区バリアフリー基本構想 本編（平成31年4月改定）』, page `https://www.city.toshima.lg.jp/303/machizukuri/toshikekaku/shisaku/021391/1610311619.html` (更新日 2026年8月12日), PDF `https://www.city.toshima.lg.jp/documents/15443/ikebukuro-barifuri2019.pdf`, `25f6f799…`, 17:26. Route table p.27–28 prints 「中央通路 西口五差路 EV～東口メトロ EV（豊島区）」「南通路 有楽町線西改札～西武線改札（東京メトロ）」「北通路 アップルロード～北口（東武鉄道）」「西通路 マルイシティ出入口～西口五差路ＥＶ前（東京メトロ）」「南通路～メトロポリタンプラザセンターエレベーター（ジェイアール東日本ビルディング）」; the 池袋駅（東武鉄道（株）） block prints 「ホームドアを設置する。※1～3 番ホームは設置済み」. Facts only.
- **S3** 豊島区都市整備部「池袋駅地下空間案内図の配布について（令和4年1月更新版）」令和4年1月6日, 豊都都発第1071号, PDF `https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf`, `db85abf7…`, 17:29. Prints 「池袋マルイ解体工事に伴う出入口閉鎖（1a、C4 出入口閉鎖）」. The letter's 留意点 allow printing, distribution, HP posting and added information, and ask against logo alteration, 無断流用 and unlicensed 2次利用. The map itself was not read for positions.
- **S4** 豊島区 観光ページ（いけふくろう）, `https://www.city.toshima.lg.jp/132/bunka/kanko/006337/017492.html`, 更新日 2025年5月20日, `7b18757d…`, 17:42. Prints 「JR池袋駅 東口」「地下1階JR改札付近にあります。」. Facts only.
- **S5** 東京メトロ 池袋駅 バリアフリー設備, `https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html` — the live URL answers 403 from this host, so the **Wayback snapshot of 2024-02-06 00:44:04 UTC** was read (`https://web.archive.org/web/20240206004404/https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html`), `2f15a75a…`, 17:23. Printed locations, verbatim: 丸ノ内線 「ホーム（終端寄り）～中央通路西改札」(改札内 lift), 「中央通路東改札～34番出入口」(改札外 lift), 「中央通路東改札～35番出入口」(escalator), 「ホーム（荻窪寄り）～中央通路東改札」; 有楽町線 「ホーム（和光市寄り）～南通路西改札」, 「南通路西改札～4番出入口（エソラ）」, 「ホーム（中央・和光市寄り）～南通路西改札」, 「ホーム（中央・新木場寄り）～南通路東改札」; 副都心線 「ホーム（中央）～中二階～西通路東改札」, 「西通路東改札～C9番出入口」, 「西通路西改札～C6番出入口」, 「西通路西改札～C7番出入口」, 「西通路東改札～C8番出入口」; 改札外トイレ 「中央通路東改札外広場」; escalator service hours 「ホーム（中央・和光市寄り）～中二階～西通路東改札始発～24：00」, 「ホーム（渋谷寄り）～丸ノ内線乗降階連絡通路始発～24：15」. Facts only.
- **S6** 東京メトロ 池袋駅 駅情報, `https://www.tokyometro.jp/station/ikebukuro/` — live 403; **Wayback snapshot of 2025-09-12** read, `93baf34e…`, 17:23. Prints line directions only (丸ノ内線 荻窪方面; 有楽町線 新木場方面・和光市方面; 副都心線 渋谷方面・和光市方面), no 番線.
- **S7** 東京メトロ「ベビーメトロ」池袋 乗車位置案内, `https://www.babymetro.jp/position/ikebukuro.html`, live 200, no page date, `39c5658f…`, 17:43. Prints 「1番線／荻窪方面行き」「2番線／荻窪方面行き」 (丸ノ内線) and, for 有楽町線 and 副都心線, 「和光市方面行き」「新木場方面行き」「渋谷方面行き」 with no numbers; notes 「※ 出口によってはご利用頂けない時間帯があります」.
- **S7b** ベビーメトロ 利用規約, `https://www.babymetro.jp/terms/`, `0c85d62f…`, 17:43. 第6条5: 「…事前に当社から書面による承諾を得ることなく、複製、転載、再配布等する行為」 — flat ban, so S7 is **corroboration only**.
- **S8** 東武鉄道 池袋駅, `https://www.tobu.co.jp/railway/guide/station/info/7105/`, live 200, no page date, `af8b2604…`, 17:42. Barrier-free section prints 「1番線　9号車4番ドア」…「5番線　9号車4番ドア」. **Corroboration only** (OD-34 r2).
- **S9** 東京都「だれでも東京」池袋駅, `https://www.daredemo-tokyo.metro.tokyo.lg.jp/facility/traffic/101010695/` — the live page is the maintenance/403 response recorded in WP6; the **Wayback snapshot of 2024-12-06** was read (`id_` body, which carries no banner; the timestamp comes from this session's CDX query), page self-dated 「2024.02.16時点の情報」, `7a9a1c77…`, 17:28. Prints 「ホームドアは２～６番ホーム。」 (西武 block), 「ホームドア：1～4番線あり」 (東武 block), and for the Metro 「エレベーター① 台数 7台 定員数 11人」 with no exit named. Rights **UNKNOWN** (OD-26).
- **S10** JREメディア `https://media.jreast.co.jp/articles/5120` and `/5121` (`datePublished` 2025-09-19 for both, `dateModified` 2025-12-19 for both; 5120 also prints 「2025年10月28日」 in its text), `6fcd52db…` and `f5b5e17f…`, 17:42. 5121's title prints 「いけふくろうはどこ？行き方をご紹介！池袋駅 東口(北)の待ち合わせ場所」. Prints 「JR池袋駅の北改札を出たら、右に曲がってください。」「北改札を右に曲がったら「いけふくろう」の看板に沿って、直進してください。」「まっすぐお進みいただくと、右手に「いけふくろう」があります。」「「いけふくろう」正面の階段を上がると、Cafe&Bar RAGE ST池袋東口が右手に見えます。」 and 「階段を上がると、池袋の待ち合わせ場所「いけふくろう」に到着です。」. JR East class: **corroboration only** (OD-34 §1).
- **S11** 東武ホープセンター アクセス, `https://tobuhopecenter.jp/info/access/`, live 200, `d4aca3a3…`, 17:34. Under the 東武東上線 heading prints 「東武東上線池袋駅より徒歩1分 中央改札を出て地下通路を西口方面へ」. Facts only.
- **S12** 池袋ショッピングパーク（ISP）アクセス, `https://www.web-isp.co.jp/access/`, live 200, `74388c91…`, 17:34. Prints 「JR北改札 を出て右に進む」 and 「いけふくろうの像の横を通りすぎ、地上へ行く階段は上がらずに地下通路をそのまま道なりに進む」. Facts only.
- **S13** 一般社団法人日本ショッピングセンター協会 施設概要, `https://www.jcsc.or.jp/pt_events/p_20211029_90046` (url dated 2021-10-29; no separate update date printed), `0e39457c…`, 17:42. Prints 「名称：池袋パルコ」「所在地:東京都豊島区南池袋１－２８－２」「階数：地下２階～地上８階」. Rights UNKNOWN (no OD entry; non-PARCO body, no ban clause read).
- **S14** 資生堂 店舗ページ `https://www.shiseido.co.jp/sw/navi/shopdetail.html?shopCd=627847`, `62c8c237…`, 17:43 — prints 「…池袋ＰＡＲＣＯ本館Ｂ２Ｆ」. **S14b** 資生堂 サイト利用規約, `38cf9ea6…`, 17:44 — 「自らの個人利用目的以外に利用…無断使用・複製等することを禁止」, a flat ban, so S14 is **corroboration only**.
- **S15** ひつまぶし名古屋備長 店舗ページ `https://hitsumabushi.co.jp/store_details/Ikebukuro_Parco`, `1257e784…`, 17:43 — prints 「池袋パルコ本館8Ｆ」; no ban clause found on the page.
- **S16** ダイヤモンド・チェーンストアオンライン（時事通信配信）`https://diamond-rm.net/flash_news/550074/`, page date 2026/06/30 12:23, `10f729f5…`, 17:49. Prints 「…西武池袋本店の建物を全面改装。ヨドバシの家電量販店と、縮小しリニューアルする西武が主力店舗となる。」 and 「改装中の西武池袋本店は地下２階から地上８階に入居し、日本最大級の化粧品売り場や食品のデパ地下、充実させた海外高級ブランド売り場を段階的にオープン。秋以降全面開業する見込みだ。」. Terms not read.
- **S17** 東京都『福祉保健』2024年6月号, `https://www.fukushi1.metro.tokyo.lg.jp/soumu/fkhk/2024/2406/index.html`, `19be5e28…`, 17:49. Prints 「西武池袋本店：５階(中央B７)＝紳士雑貨売場」 — a 2024-06 placement, not the current one.
- **S18** 西武・そごう公式ページ `https://www.sogo-seibu.jp/ikebukuro` — 「地下2階から8階まで」 per the oracle run; **not used as evidence** (corroboration-only class, OD-34 r3) and not re-fetched by this worker.

## 3. Oracle runs

- `~/.local/state/oracle-ego/runs/20261025-172608-89946-ikb-online-closures` (GPT-6, high) — 5-item lookup. Its いけふくろう, だれでも東京, PARCO and Tobu findings were checked against the pages and kept (S3–S10, S13, S14, S15). Two claims were **rejected on inspection**: 「池袋(1番線)」 in the Marunouchi barrier-free PDF (that PDF prints no 池袋 text at all, see §5) and a Plan International quote (the page answers with a maintenance notice until 2026-11-05).
- `~/.local/state/oracle-ego/runs/20261025-174520-14815-ikb-seibu-floors` (GPT-6, high) — 西武池袋本店 floors. Returned S16 (and S17 as a historical corroboration); both quotes were re-fetched and verified here. The tenant shop pages it listed came back without URLs in the answer text, so they are not cited; S16 alone carries the range.
- Fetch budget note: the oracle agent browses on the host under its own profile. Its requests are not counted here; this worker's own count is in the fetch log.

## 4. Import-ready closures (follow-up, not this PR)

| What | Value to import | Source | Rights read | Blocks |
| --- | --- | --- | --- | --- |
| `exit-22` alias | 東口（北）, former name 「JR 東口」 | S1 | facts only | nothing — confirms what is shipped |
| Exit aliases 37 / 38 | 東口（中央） / 東口（南）; former names 西武東口 / 西武口 | S1 | facts only | POI exists; alias merge per OD-22 |
| Exit names 19 / 20a / 4 | 西口（中央） / 西口（北） / 西口（南） | S1 | facts only | 20a's letter suffix must not collide with an id such as `exit-20` |
| 池袋PARCO 本館 floors | 地下2階–地上8階 (B2–8F, 10 levels); B2F and 8F tenant-confirmed | S13 (S14/S15 tenants) | **UNKNOWN** — DR-RT-06 private-use-only | **director rights line**, then the store POI |
| 西武池袋本店 floors | 地下2階–地上8階 as announced 2026-06-30, staged opening, full opening from autumn 2026 | S16 (+S17 for 5F in 2024-06) | trade-press terms unread | terms read + one re-check after the autumn opening; no POI before that |
| Metro M25 platform directions | 1番線・2番線 both 荻窪方面 | S7 | **corroboration only** (S7b flat ban) | a second, non-banned source, or a rights ruling |
| Tobu Tojo platforms | **1–3 番線** (home doors fitted as of 2019-04); 4 and 5 exist but only on S9 (rights UNKNOWN) and S8 (corroboration only) | S2 | facts only for 1–3 only | 4 and 5 need an independently usable source or an explicit rights decision; per-platform destination is printed nowhere — needs the field run |
| Metro lift links | 中央通路東改札～34番出入口; 南通路西改札～4番出入口（エソラ）; 西通路東改札～C9番出入口 | S5 | facts only | the data lane decides whether these become lift POIs/edges |

## 5. Fetch log

Own requests, in order (JST). Every request used curl's default User-Agent, with ≥0.6 s between calls; no `-A`/`--user-agent`, no login-gated page, no form or post.

| # | Time | URL | Result | Artifact (`sha256` prefix) |
| --- | --- | --- | --- | --- |
| 1 | 17:22 | `https://www.tokyometro.jp/station/ikebukuro/` | 403 (397-byte body) | `8ca15ee2…` |
| 2–4 | 17:22 | `…/station/ikebukuro/{marunouchi,yurakucho,fukutoshin}/index.html` | 403 | `07358ba0…`, `15f53c43…`, `26cec0bd…` |
| 5 | 17:22 | `http://web.archive.org/cdx/search/cdx?url=tokyometro.jp/station/ikebukuro*…` | 200 | `bd37b987…` |
| 6 | 17:23 | Wayback `…/station/ikebukuro/` (2025-09-12) | 200 | `93baf34e…` |
| 7 | 17:23 | Wayback `…/station/ikebukuro/accessibility/index.html` (2024-02-06) | 200 | `2f15a75a…` |
| 8 | 17:25 | Wayback Metro timetable pages (×3) and `yardmap` | 200 / empty / 200 | `153ca91e…`, `29839225…`, `6fd38035…`, `1b6bb361…` |
| 9 | 17:25 | `https://www.tokyometro.jp/safety/barrierfree/…pdf` (×3) | challenge page, 458 bytes each | `fd3ed28f…`, `3d154b4b…`, `d2826fbe…` |
| 10 | 17:26 | Wayback barrier-free PDFs `barrierfree7_{marunouchi,yurakucho,fukutoshin}.pdf` | 200 | `6f3f72e6…`, `eccfb48b…`, `e147db59…` |
| 11 | 17:26 | 豊島区 `…/documents/15443/baria_gaiyou.pdf`, `ikebukuro-barifuri2019.pdf` | 200 | `b143196d…`, `25f6f799…` |
| 12 | 17:28 | Wayback `daredemo-tokyo.metro.tokyo.lg.jp/facility/traffic/101010695/` (2024-12-06) | 200 | `7a9a1c77…` |
| 13 | 17:29 | 豊島区 `…/documents/17300/undergroundmap_202201.pdf` | 200 | `db85abf7…` |
| 14 | 17:30 | 豊島区 PDFs: サインガイドライン概要版, 池袋駅コア整備方針, 基盤整備方針本編, 策定ガイドライン | 200 | `b0e32b22…`, `902dc69a…`, `6f1e5dac…`, `a21c0bce…` |
| 15 | 17:32 | Wayback `…/station/ikebukuro/index.html` (2026 snapshot) | 200 | `cbaf8c63…` |
| 16 | 17:32 | 豊島区 ページ 17300 / 15443 / トップ | 200 | `c366843b…`, `3956ffa6…`, `61b3bc99…` |
| 17 | 17:33 | 豊島区 `…/documents/17300/saingaidorain-honpen_kaitei1-2.pdf` | 200 | `441c38b9…` |
| 18 | 17:34 | `tobuhopecenter.jp` access / floor guide / news | 200 | `d4aca3a3…`, `c9315ef9…`, `d9203ab4…` |
| 19 | 17:34 | `web-isp.co.jp` access / news | 200 | `74388c91…`, `b127dc17…` |
| 20 | 17:39 | `https://www.tokyometro.jp/…/barrierfree7_*.pdf` (direct retry) | challenge page | `fd3ed28f…` |
| 21 | 17:41 | Wayback `…/safety/barrierfree/…` and `…/station/ikebukuro/map` | 200 / partial | `bf7_*`, `060e6fd9…` |
| 22 | 17:42 | `https://www.tobu.co.jp/railway/guide/station/info/7105/` | 200 | `af8b2604…` |
| 23 | 17:42 | `https://railway.tobu.co.jp/guide/station/info/7105.html`, `www.tobu.co.jp/railway/station/ikebukuro/` | 404 | `80c3fe2a…` |
| 24 | 17:42 | `media.jreast.co.jp/articles/5120`, `/5121` | 200 | `6fcd52db…`, `f5b5e17f…` |
| 25 | 17:42 | 豊島区 ページ 006337/017492; `jcsc.or.jp` 施設概要 | 200 | `7b18757d…`, `0e39457c…` |
| 26 | 17:43 | `babymetro.jp` トップ / position / terms | 200 | `9ae195b6…`, `39c5658f…`, `0c85d62f…` |
| 27 | 17:43 | `shiseido.co.jp` 店舗; `hitsumabushi.co.jp`; `store.kinokuniya.co.jp`; `loft.co.jp` | 200 | `62c8c237…`, `1257e784…`, `b638f31e…`, `f8356241…` |
| 28 | 17:44 | `parco.co.jp/about/business/store/`; `shiseido.co.jp` 規約 | 200 | `c76fe652…`, `38cf9ea6…` |
| 29 | 17:44 | `seiburailway.jp/railway/station/ikebukuro/`; `plan-international.jp/about/data/access/` | 200 | `6f0f8ff6…`, `44ff75ff…` |
| 30 | 17:45 | 東京都メトロ barrier-free 整備計画（様式2, 令和8年6月30日）PDF | 200 | `44034ef8…` (URL not recorded in the scratch dir; identified by the printed document title) |
| 31 | 17:49 | `https://diamond-rm.net/flash_news/550074/` | 200 | `10f729f5…` |
| 32 | 17:49 | `https://www.fukushi1.metro.tokyo.lg.jp/soumu/fkhk/2024/2406/index.html` | 200 | `19be5e28…` |
| 33 | 17:50 | Wayback CDX `tokyometro.jp/station/ikebukuro*` (re-query for snapshot dates) | 200 | printed in-chat |

Roughly 115 requests against the 120 cap, counting the multi-URL steps above; no source was retried more than the one PDF/direct-page retry logged at rows 9 and 20.

## 6. What is still a field item

Only these need the walk: **G1** posted hours on the 9 edges; **G2** step-free facts on the walk and at Exit 22 (and confirmation of what no lift exists there); **G3** closures on the walk; **G5** whether the `n_c → x22` flight is the Exit 22 stair; **G6** the step count; **G7** the fare line on the west run; **G4/af-north-passage** east of the Exit 22 stairwell; **A1/A3** and **F2** gate side and column; **F09 geometry**; **JR East platform numbers** (no printed source exists at any grade); **Tobu gate↔opening**.

Three PARTIAL items still end in a check as well, and none of them is settled by the text found here: the **`west-exit-b1` name** (no printed source uses 「西口（地下）」, so only a plate can confirm or replace it); the **Y09 and F09 platform numbers** (directions are printed, numbers are not, and no field run has read those plates yet); and the **Tobu per-platform destinations** (1–5 exist; which platform serves what is printed nowhere). The Exit 22 landing (row 11) is FIELD for the same reason: the printed stair is the one facing いけふくろう, not an exit-numbered one.

The gap table's "NONE" for Seibu and Metro **walkable segments** is a data-lane status, not a lookup: no text page can produce a segment. The lift item added at 17:47 stays PARTIAL: the printed links are all for the east, south and Echika sides, so **observing the `w_c`→`x22` area and the JR 北改札 from the free side is the only remaining way** to say where a lift is on that stretch.

## 7. Assumptions and limits

- 「西口（地下）」 is a data name, not a printed one. Nothing was renamed; S1 only shows that the ward's official scheme has six names and that `west-exit-b1` is not among them.
- Every JR East, Tobu, Sogo-Seibu and ベビーメトロ page is used as corroboration only, per OD-34; no import rests on them.
- S9 (だれでも東京) is quoted with its rights class left **UNKNOWN** (OD-26): its home-door lines are used only to cross-check the 1–3 platform count that S2 already carries; its 1～4 line is not treated as evidence for platform 4.
- A dated snapshot is evidence as of its date: S5 (2024-02), S6 (2025-09), S9 (2024-12). Metro's direct pages are 403 from this host, so S5 and S6 could not be re-checked live.
- Absence of a printed hour is not 24-hour access, and a facility's opening hours are not passage hours.
- The map-image ban was respected: S3's map and S5's 構内図 links were not read for positions; only printed location strings were used.
