# Ikebukuro — minimal on-site checklist

Walking order A → G (about 60–90 min). The working copy is a private GTEki artifact that saves answers for the station lane to read back; this file is its repo record. Each answer closes or keeps the named gap: an exit stays unroutable until its answer (plus the PLATEAU match) is in.

Photo rules: public areas only; no faces; no staff-only zones; operator signage photographed for facts only and never published.

## A — 中央通路（西）

從 JR 中央1改札往西，走到西口地下広場。App 起點：Central Passage。

| # | Check | Closes |
|---|---|---|
| A1 | 丸ノ内線 中央通路 東改札／中央改札／西改札：各在通道北側還是南側？從 JR 中央1改札西緣往西數，第幾根柱子到閘門線？ (東改札 / 中央改札 / 西改札) | gap-metro-tobu-gates |
| A2 | 東武東上線 中央1改札／中央2改札：同上，哪一側、第幾根柱子？ (中央1改札 / 中央2改札) | gap-metro-tobu-gates |
| A3 | 丸ノ内線閘門附近地面上的兩個開口是樓梯嗎？通往哪裡、標示寫什麼？ | gap-metro-tobu-gates |

## B — 西口地下広場

App 起點：West Exit (B1)。大廳與往西延伸的通道。

| # | Check | Closes |
|---|---|---|
| B1 | 13番出口的樓梯，是否從大廳往西那段通道的北側上去（GTEki 路線終點那裡）？ — 是／否／不確定 | verifies af-exit-13 |
| B2 | 9番出口的樓梯從哪裡起步？以 10番出口樓梯為基準，哪一側、相隔幾根柱子？ | gap-west-stairs |
| B3 | 14番、16番出口的樓梯各從哪裡起步？ (14番 / 16番) | gap-west-stairs |
| B4 | 19番出口（西口（中央））的樓梯從哪裡起步？ | gap-west-stairs |
| B5 | 大廳西南角、靠往南通道的那段樓梯，標示為幾號出口？ | gap-west-stairs |
| B6 | 大廳西端、往副都心線那座寬樓梯旁邊的短樓梯，標示寫什麼？ | gap-west-stairs |

## C — 往 8番出口的西側通道

從西口大廳西端繼續往西。

| # | Check | Closes |
|---|---|---|
| C1 | 到 8番出口樓梯口是一般通道嗎（沒有閘門）？ — 是／否／不確定 | gap-west-stairs (Exit 8) |

## D — 西口 → 西口（南）的南北通道

東武百貨店西側，App 路線 West Exit (B1) → Exit 4 的中段。

| # | Check | Closes |
|---|---|---|
| D1 | 5、6a、6b、7番出口：各在通道東側還是西側？從南端大廳北緣往北數第幾根柱子？ (5番 / 6a番 / 6b番 / 7番) | gap-west-corridor-exits |

## E — 西口（南）地下広場

App 起點：West Exit South (B1)。

| # | Check | Closes |
|---|---|---|
| E1 | 4番出口的樓梯，是否從大廳南側起步（GTEki 路線終點那裡）？ — 是／否／不確定 | verifies af-exit-4 |

## F — 南通路（西）

西口（南）大廳往東，經過 JR 南改札。

| # | Check | Closes |
|---|---|---|
| F1 | JR 南改札的閘門線，是否在通道北側那個很寬（約 29 m）的開口？ — 是／否／不確定 | verifies af-jr-south-gate |
| F2 | 有楽町線 南通路西改札／東改札：各在哪一側？從 JR 南改札起數第幾根柱子？ (西改札 / 東改札) | gap-south-west |
| F3 | 沿 JR 西側往北、連接南通路與中央通路的那條通道：兩端有沒有閘門？不持票能通行嗎？ (南端 / 北端（東武中央1改札附近） / 不持票可否通行) | gap-tobu-jr-link |

## G — 東北側（北通路往東）

App 起點：North Passage，往 26／28番出口方向。

| # | Check | Closes |
|---|---|---|
| G1 | 購物街通道盡頭的那座樓梯標示為 24番還是 25番？另一個號碼的樓梯在哪？ (盡頭樓梯 / 另一座) | gap-ne-north |
| G2 | 23、29、30、31番出口：能從地下通道走到嗎？從哪裡起步？ | gap-ne-north |

## 沿途 — 整趟路上順手記錄

經過時記下就好，不必特地繞路。

| # | Check | Closes |
|---|---|---|
| H1 | 出口樓梯口若貼有營業時間，記下「出口號碼：時間」。 | gap-hours |
| H2 | 看到的電梯或手扶梯：位置與連接的樓層。 | gap-step-free |
| H3 | 與 App 畫面明顯不同的地方（施工、封閉、新開口）。 | gap-freshness |
| H4 | （可選）中央通路與西口大廳的地板、牆面、天花板顏色與材質。 | G3 visual reference |

## I — 公開資料研究帶出的追加確認（2026-10-22）

來源：data-research PR #177（`docs/research/gaps/DR-IK-station-facts.md`，FC-IK-01 至 03；I8 的 POI 於 PR #185 新增為 search-only）與 PR #174（`docs/research/gaps/DR-changes-since-2023.md`，CH-IK-01、02、04、05/06）。這些是「去看一眼」的項目，不是結論：公開資料沒有一項能確定開口或樓梯是哪個出口，也沒有改動任何路網、POI 或通行資料。全部在改札外（I8 的改札線只需站在改札外觀察，不必進站）；照片規則同上。順路時一併記錄即可，各項已對應到上面既有的 A–H 項目。I9、I10 來自 PR #197（`docs/research/gaps/DR-retry-unread-sources.md`，FC-RT-01、02）；I11–I13 來自 [step-free-coverage.md](step-free-coverage.md)（無障礙路線覆蓋報告：目前 67 條邊的已驗證無障礙為 0 條），只補上 H2、I2、I4、I5、I8 沒有涵蓋的「某一段通道有沒有臺階或坡道」與「短樓梯旁有沒有替代設施」。

| # | Check | Closes / 對應 | Source |
|---|---|---|---|
| I1 (FC-IK-01) | 東武中央1改札以西的通道、往西口樓梯與 19番出口方向：有沒有電梯？服務哪些樓層？有沒有貼營業時間？標示寫幾號出口？ | gap-step-free、`exit-19`；與 B4、H1、H2 一起看 | 現場確認。沿用 #177 的項目編號 FC-IK-01，但不引用任何 JR 東日本資料（OD-02：[#165 留言](https://github.com/nurockplayer/gteki/issues/165#issuecomment-6335071234)） |
| I2 (FC-IK-02) | 中央通路東改札之外，往 34番、35番：電梯與手扶梯各通到幾號出口？（東京 Metro 兩個頁面的說法不一致：無障礙頁寫電梯到 34、出口表把地上電梯標在 35）另外 Sunshine City 網站寫 35番有電梯通到地面（OD-24：facts-only、UNVERIFIED），和 Metro 的說法也不一致，一併確認。 | gap-step-free（東側）、`metro-m-central-east-gate`；與 A1、H2 一起看 | #177 FC-IK-02 |
| I3 (FC-IK-03) | 購物街區東側的 30番與 31番：是同一座樓梯兩個號碼，還是兩座樓梯？ | `exit-30`、`exit-31`；與 G2 一起看 | #177 FC-IK-03 |
| I4 (CH-IK-04) | 36番、37番出口的樓梯：現在有沒有加裝手扶梯或電梯？樓梯或通道的形狀與 App 畫面有沒有不同？（豊島區協議會 2024-11-05 有「考慮 4 座手扶梯與電梯」的發言；結果未知） | gap-freshness、gap-step-free；與 H2、H3 一起看 | #174 CH-IK-04 |
| I5 (CH-IK-01) | 副都心線 C1b 出口：有沒有這個出口？與 C1（現稱 C1a）怎麼分？有電梯嗎？（Metro 稱新設，開通日未確認） | gap-freshness、gap-step-free；與 H2、H3 一起看 | #174 CH-IK-01 |
| I6 (CH-IK-02) | 東京 Metro 2b番出口現在開著嗎？（原定 2024-09-30 至 2025-07-07 封閉，沒找到重新開放的紀錄） | gap-freshness、gap-hours；與 H1、H3 一起看 | #174 CH-IK-02 |
| I7 (CH-IK-05/06) | 西口一帶（西池袋一丁目、三丁目）：通道、樓梯、圍籬或施工與 2023 年測量的 App 畫面有沒有不同？「池袋駅付近地下道第3號線、第4號線」對應到哪兩條實際通道？（2024-11-11 西口地区再開発計畫決定；都市計畫公告列為「變更」，另有二手摘要寫「廃止」，尚未在原文確認） | gap-freshness、gap-west-stairs、gap-west-corridor-exits；與 B 區、D1、H3 一起看 | #174 CH-IK-05、06 |
| I8 (DR-IK-02) | 有楽町線 南通路西改札：改札線實際在哪裡？對照柱子（從 JR 南改札起數第幾根）與東改札的相對位置；哪一側是付費區？從這道改札走到 4番出口（エソラ）的路線怎麼走？途中的改札外電梯與手扶梯是否存在、各通到哪幾層、有沒有貼營業時間？拍下改札的名稱牌。（Tokyo Metro 無障礙頁只寫「南通路西改札～４番出入口（エソラ）」有改札外電梯與手扶梯，沒有寫改札位置，也沒有通道的形狀；PLATEAU 也無法定位這道改札。以上都是「去確認」，通道目前不能視為已驗證） | `gap-south-west`、`metro-y-south-west-gate`（search-only POI，無節點、無邊）、`exit-4`；與 F2 一起看 | Tokyo Metro 無障礙頁（僅取事實）、#177 DR-IK-02、POI 於 #185 新增（search-only） |
| I9 (FC-RT-01) | 東京 Metro 的 1a番、2b番、C1b、C4 出口：現在開著嗎？出口牌或公告有沒有寫開放日期、使用時間？有電梯嗎？（C4 的指示牌，依 Metro 的豊島区委員會資料，有加「電梯」顯示；C1b 依 Metro 新聞稿有 1 座電梯，開通日未確認）2b 通往東京芸術劇場的樓梯與電梯，現在有沒有在使用？只抄牌面文字，照片不放進 repo | `gap-freshness`、`gap-hours`、`gap-step-free`；與 H1、H3、I5、I6 一起看（I5、I6 已問 C1b、2b，這裡補 1a、C4 與牌面文字，同一處不必重複拍） | PR #197 FC-RT-01（DR-RT-10：豊島区 2026-03-25 委員會資料2，1a、C4「3月6日」供用開始，年份未印；DR-RT-18；DR-RT-20、22）。公開資料只寫到這裡，沒有一項證明現在開著 |
| I10 (FC-RT-02) | 池袋ショッピングパーク（ISP）的入口：明治通り 步道側與中央通路側各一處，入口牌寫幾號出口？（照抄牌面）中央通路側的入口有沒有坡道？明治通り步道上的地下入口有沒有高低差或臺階？（豊島区 2020 年的特定事業計畫寫「步道上入口的高低差要消除」與「中央通路側入口的坡道構造考慮改修」，兩項在 2019 年度末都是未著手；現況未知，原文也沒有出口號碼） | `gap-ne-north`（出口號碼）、`gap-step-free`；與 G1、G2、I3 一起看 | PR #197 FC-RT-02（DR-RT-24）。新聞稿裡的 ISP 出口數字是二手報導，不當事實（OD-05） |
| I11 | 看起來平的通道：有沒有一階以上的臺階、門檻、坡道或明顯的斜面？記在哪一段（對照柱子或店面）。資料只有 0.07–0.56 m 的高低差，其中多數小於測量取樣誤差（0.35 m），不能當成有沒有坡道的證據。重點段落：中央通路東段（`c_c`→`c_e1`→`c_n`，以及 `c_e1`→`c_s`）、東口大廳往 27番方向（`c_e2`→`e_27j`→`e_hall`）、南通路與通往東南通道的段（`c_s`→`sp_j`、`e_hall`→`se_1`→`se_j`）、西口（南）往北的長通道（`sw_h`→`w_cj`，152 m）。順便記每個閘門開口與通道最窄處，輪椅看起來過不過得去（目測，不必量）。看起來平不等於無障礙，只記看到的 | `gap-step-free`；與 H2、H3 一起看，不取代 H2 | 本檔案旁的 [step-free-coverage.md](step-free-coverage.md) 第 2 節（PLATEAU 的 z 值，12 條 slope 邊；資料為「僅形狀」，未驗證） |
| I12 | 短樓梯段旁邊有沒有坡道、電梯或手扶梯可以繞過？(a) 東口大廳往 34／35番低層通道的那段樓梯（`e_hall`→`e_low`，下 0.91 m）；(b) 南通路東端「上一小段、下一小段」的樓梯（`sp_e`→`s38_w`，1.47 m；`s41_j`→`s41_f`，0.83 m）；(c) 北通路往購物街通道的短樓梯（`n_e`→`ne_j`，2.21 m）。有的話記：位置、通到哪一層、在改札外還是改札內、有沒有貼時間 | `gap-step-free`；與 H2 一起看；(a) 與 I2 同一區 | step-free-coverage.md 第 2、5 節（資料把這些邊記為樓梯，附近沒有任何公開資料提到替代設施） |
| I13 | PLATEAU 測量裡有 3 座手扶梯，目前沒有任何邊使用：(1) 35番出口樓梯旁（併入 I2 一起看）；(2) 33番出口樓梯旁；(3) 北通路往購物街通道的短樓梯旁（與 I12 (c) 同一處）。每座：真的是手扶梯嗎？往哪個方向？有在運轉嗎？旁邊有沒有電梯？ | `gap-step-free`；(1) 併入 I2、H2 | `scene/dressing_anchors.json`（esc01 至 esc03，PLATEAU 測量；種類、方向、運轉時間沒有任何來源）、step-free-coverage.md 第 4 節 |
| I14 (OD-22) | 西口（北）／20a番出口：現場有沒有 20a 這個出口？在哪裡（離西口地下廣場或哪條通路最近）？標示牌寫什麼？（豊島区サインガイドライン（案）Ver1.3 p20 把西口（北）對應到 20a；那是草案，只能當名稱來源，資料裡沒有這個 POI） | 新 POI 候選（目前沒有）；與 B 區一起看 | 豊島区 Ver1.3（案）p20（OD-22，#165 comment 6340635823） |
| I15 (FC-RT-03) | 4番和5番出口的標示牌：還有沒有「(新)」或「(旧4)」這類註記？拍下牌面文字。 | `exit-4`、`exit-5`；與 I14、B 區一起看 | #233（R8b，豊島区 資料3 標示變更表） |
| I16 | 26番出口樓梯頂端：量階梯最上面一階的淨寬，以及兩側側牆比最上面一階高多少（捲尺即可）；側牆在街面那一端是否與地面齊平。App 的路線在這裡離側牆約 0.33 m，是離牆 0.35 m 規則唯一的例外（`CLEARANCE_EXCEPTIONS`；依 PLATEAU 測量，最窄處的側牆頂比那裡的踏面高約 0.44 m）；實測可用來確認或移除這個例外 | `ne_j__x26`；與 G 區一起看 | `pipeline/build_station.py` `CLEARANCE_EXCEPTIONS`（Refs [#227](https://github.com/nurockplayer/gteki/issues/227)） |

另外兩項補充，併入既有項目：

- **A1／A2**：順便拍下閘門的名稱牌（Metro 西改札的牌子寫什麼，對照東武百貨店寫的「丸ノ内線中央連絡西改札」；東武中央1／中央2），只為記錄名稱。（#177）
- **B2**：9番出口樓梯口的出口名牌，拍照記錄文字。（#177）
