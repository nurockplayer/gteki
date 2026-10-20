# GTEki｜池袋駅・新宿駅公開資料研究與工程交接

**查核日：2026-10-20（UTC）｜研究主軸：池袋 70%、新宿 30%｜用途：商業公開 Web 3D、自由探索、室內搜尋與導航；保留 Godot 版本。**

本報告完成資料研究與少量樣本查核，沒有修改 GitHub、安裝建模工具、轉換模型或啟動工程，也沒有下載全區 CityGML、3D Tiles 或 BIM。原始資料實查限於小型中繼資料、CSV、圖面與 PDF。以下的工程步驟是後續交接建議。

## 研究結論

**池袋值得作為第一站，但目前具備的是「可合法取得的地下幾何候選＋周邊路網與 POI＋官方參考資料」，尚未證實存在一套可直接上線的完整室內導航資料包。**

1. **兩站確實有地下 LOD4 公開模型。** 官方 PLATEAU API 列出豊島区與新宿区各一個 `ubld` CityGML 單檔，約 35.43 MB／43.83 MB；原始 metadata 明示 CC BY 4.0。未下載大檔，因此每個營運方、樓層、付費區、樓梯及電梯的實際涵蓋仍未知。[G1–G4]
2. **2025 資料包不等於 2025 測量。** 地下來源 CSV 記錄東京都、2023 年、LidarSLAM、地圖資訊等級 500。這不是已驗證的每點誤差，也不能由 LOD4.1 推導公分精度。[G3]
3. **池袋可下載步行資料不是已驗證的完整室內路網。** 本次兩份 CSV 有 2,196 筆 link、1,887 筆 node；所有 node 的 `in_out=1`，依規格標為設施外，全部 elevation 空白。資料內容日期為 2019-01-28；2025 是目錄更新與格式遷移時間。[R1]
4. **新宿有明確的局部室內開放路網。** 都營大江戸線新宿 E27 有 GeoJSON 路網與分層地圖，PDL 1.0；它不代表 JR、京王、小田急或新宿西口 E01 的整體完整性。[S01]
5. **營運方官方圖面有高參考價值，但大多沒有開放重製權。** 官方、免費看、可下載 PNG/PDF，不等於可描圖重建、作貼圖、公開 GLB 或再散布導航資料。[I-01–04、S04–09]
6. **豊島區地下案內圖有特定的網站揭載／配布許可。** 其文字不足以證明商用 3D 改作與衍生資料再散布已被授權，不能套用區府開放 CSV 的 CC BY 授權。[I-05]
7. **沒有查得可直接取用的完整池袋／新宿 IFC 或 BIM 公開下載。** PLATEAU Station Navi 案例證明專案曾使用管理者 BIM/CAD、路網與 POI，但並未證明它們已對外開放。[G6]
8. **第一個後續任務應是限定範圍的資料驗證。** 先查池袋地下模型真實覆蓋與可通行邊界，再決定首段探索範圍；無證據的通道、層高、電梯連接與付費區捷徑一律不補造。

## 判讀規則：四個層次必須分開

| 層次 | 本報告的意思 | 不代表什麼 |
|---|---|---|
| E：資料存在 | 官方頁、資料目錄、API 或案例能證明該資料被製作／提供 | 不代表外部可以取得原始檔 |
| D：可下載 | **D2**＝本次已實讀內容；**D1**＝找到官方實際資源 URL／下載按鈕，未完整讀檔；**D?**＝有目錄但實際檔案入口未核／被 403 阻擋；**D0**＝未找到公開原檔 | D1 不等於檔案完整、無損、可轉換；403 不等於資料不存在 |
| L：合法再利用 | 有足以支持商用、修改與再散布的資源級授權，並履行其條件 | 網站公開、公共機關提供、工具 MIT 授權，都不會自動授權其承載的每項資料 |
| N：可轉成 3D 導航 | 幾何、樓層、拓樸、通行條件、入口與現況可核對，才能形成候選導航資料 | LOD4、GeoJSON、電梯圖示、可烘焙 navmesh 都不等於可用導航 |

**本次沒有任何資料被標為「已完成現況導航驗收」。**「需轉換」包含資料清理、座標處理、權利履行及現況查核；「可直接使用」只指在已核授權範圍內能直接作照片、通用材質或資料閱讀，不代表能直接導航。

分類：**直接**、**轉換**、**參考**、**禁重製**。後兩者常同時出現：可以研究事實，但本專案不能在未獲許可下重製原圖及受保護表現。本報告不將獨立採集的事實自動視為營運方著作權，也不以「事實」為由整批搬用地圖、編排、圖示、照片或資料庫。

可信度分為兩部分：**來源／授權證據**與**現況／導航適用性**。官方來源高可信，不表示資料在今天完整正確。所有沒有證據的值保留「未知」。

# A. 池袋與新宿公開資料矩陣

下列來源 ID 對應後面的逐項證據卡；每張卡提供官方入口、實際檔案／下載入口、範圍、格式、精度、日期、權利與待驗證事項。

## A1. 池袋優先矩陣

| 來源 | 涵蓋／格式／內容年代 | E／D／L／N | GTEki 採用判定與可信度 |
|---|---|---|---|
| G1 PLATEAU 豊島区地下街 | 池袋地下 `ubld`；CityGML LOD4，實際樓層／各公司範圍未知；來源 2023、包名 2025 | 有／D1，metadata D2／CC BY 4.0／幾何候選，路網未知 | **轉換，第一優先**；來源／授權高，覆蓋／現況待驗 |
| G1-related PLATEAU 相關 POI | 全豊島区站點、landmark 等 GeoJSON；35 個 station features、143 個 landmark；含 2023／2025 主題 | 有／D2／個別來源與再利用條款待核／搜尋格式候選 | **轉換候選，權利未准入**；不是站內商店、出口或閘口全集 |
| R1 MLIT 池袋步行網路 | node/link CSV、GeoJSON；2019-01-28；無已驗室內高度 | 有／CSV D2／PDL 1.0／周邊候選，非完整室內圖 | **轉換**；授權高、現況低；不能自動接入地下 |
| I-06 豊島區開放 POI | 全區公共設施、公廁、觀光、AED；CSV；3 份實查檔 HTTP 日期 2023-11-07 | 有／3 份 D2／CC BY 2.1 JP／搜尋可，入口未定位 | **轉換**；來源／授權高，站內涵蓋不足 |
| I-01 JR 池袋 | B1、1F–2F、立體 PNG；圖面修訂日未知；無測量精度 | 有／D1，web 可解析入口／未授權重製／僅參考 | **參考＋禁未許可重製** |
| I-02 Metro 池袋 | M25/Y09/F09；B1/B2/B4及中間連絡空間；JPEG/PNG，2026.3 | 有／D2 圖樣／未授權重製／設備連接參考 | **參考＋禁未許可重製**；樓層標籤不等於標高 |
| I-03 東武 池袋 | B1/1F、2F定期券處；GIF，HTTP 2023-12-21，圖版日未知 | 有／D2／未授權重製／參考 | **參考＋禁未許可重製** |
| I-04 西武 池袋 | B1/1F；PNG，圖面 2026.8.1 | 有／D2／未授權重製／參考 | **參考＋禁未許可重製** |
| I-05 豊島區地下案內圖 | 跨業者地下空間示意；A3 PDF，2022-01 | 有／D2／特定 2D 使用可，3D 衍生權待核／無尺度或 graph | **對 3D 僅參考**；適合詢問擴充授權 |
| I-07 Echika 店舖／樓層 | 地下商業區 HTML、JPEG；統一更新日未知 | 有／D1／未見開放授權／POI 名稱參考，入口未知 | **參考**；不整批複製目錄、Logo、圖面 |
| I-08 ISP | B1商場／B2停車場連絡；PDF／HTML；標題含 20260301 | 有／D2 PDF／未授權重製／參考 | **參考＋禁未許可重製** |
| I-09 Ecomo 跨業者無障礙圖 | B4/B2/B1/1F 等示意；PDF，2018.2 | 有／D2 PDF／明文拒絕營利利用／歷史參考 | **商用重製排除**；現況可信度低 |
| I-10 防災／無障礙規劃 | Echika 等防災 PDF 2025.10；區府無障礙計畫 2019.4 | 有／PDF 入口／無通用 3D 開放授權／避難或規劃用途 | **參考**；避難線不直接當日常無障礙路線 |
| G6 Station Navi BIM/CAD | JR 池袋／新宿案例；2026-03-31發表 | 有／D0 原檔／授權未知／案例有導航不等於資料可用 | **參考／合作取得候選** |

### 池袋已實讀的兩組資料

**R1 路網。** 計數是當次 CSV 原始資料列的解析結果，沒有宣稱去重後拓樸驗收。`node.in_out` 全部為 1，只能據此說該版本把節點標為設施外，不能進一步宣稱每條線完全不穿建築或戶外覆蓋完整。`floor` 有 0、±0.5、±1 等值，但沒有 elevation；不能用負樓層值反推已具有室內圖。link 的通行時間限制欄位空白，不能把空白解釋成 24 小時可走。[R1]

**I-06 POI。** 558 筆公共設施、6 筆公廁、5 筆觀光設施均有經緯度。這些數字來自小樣本解析，不是官網承諾的永久筆數。座標可作搜尋定位，不能自動成為店舖門口或地下一層的導航終點。網站頁面 2026-08-18 更新，也沒有使 2023 的 CSV 自動變成 2026 實查資料。

### 池袋應優先補的三個缺口

- **地下模型覆蓋表：**哪些公開通路實際在 GML 內、哪些營運區與商場不在；哪些只是外殼、哪些有可用地面及垂直連接。
- **可通行圖：**閘內外、出口時段、限時門、電梯服務層與封閉通道。先選可被資料及現勘完整證實的一小段公共路線，不先承諾整站東西貫通。
- **可搜尋且可到達的 POI：**把名稱、別名、類別、營業狀態與實際入口分開；以入口連到經驗證的 graph，避免導向建物中心或錯層。

## A2. 新宿對照矩陣

| 來源 | 涵蓋／格式／日期 | E／D／L／N | 採用判定 |
|---|---|---|---|
| G2 PLATEAU 新宿地下街 | CityGML LOD4，樓層完整表未知；來源 2023、包名 2025 | 有／D1，metadata D2／CC BY 4.0／幾何候選 | **轉換**；先用單一地下檔，不取全區 |
| S01 大江戸線新宿 E27 | 路網／樓層 GeoJSON；PDF標 1F/B1/B2/B3/B5/B6；dataset 2026-09-17、resource 2025-10-22 | 有／ZIP D1、PDF D2／PDL 1.0／局部室內骨架候選 | **轉換，最值得先做室內 graph 範例**；精度、現況未驗 |
| S02 新宿周邊路網 | CSV/GeoJSON；內容 2018-10-29、目錄 2025-10-28 | 有／D1／PDL 1.0／待範圍與現況檢查 | **轉換**；不得當 2025 現況 |
| S03 東京都設施／出口時段／路線 | 2.2 MB GeoJSON ZIP；2023-02-28發布，基於2020資料 | 有／D?，官網有按鈕／CC BY 4.0索引，resource未核／有潛力 | **轉換候選，尚未准入公開產品** |
| G5 MLIT R2屋內地圖 | 地下、地上、Busta3F/4F示意；GeoPDF等；2020-10-27 | 有／D?，CKAN403／精確利用規約未核／含階差坡度網路 | **轉換候選，先補權利與下載核驗** |
| S04 JR、S05京王、S06小田急 | 各公司構內 PNG/JPEG/PDF；各自樓層，非全站BIM | 有／圖面入口／無開放重製授權／參考 | **參考＋禁未許可重製** |
| S07 Metro M08、S08都營 S01/E27與E01 | 各站構內、出口、設備頁；精度／部分版次未知 | 有／圖面或網頁／無一般開放重製權／參考 | **參考**；不把E27、E01或新宿三丁目合併 |
| S09 新宿區 Terminal Map | 跨業者PDF、電梯樓梯圖；2025-11版 | 有／D1 下載入口／一般網站限制／示意參考 | **參考＋禁未許可重製** |
| S10 都營站內店舖 POI | 新宿／新宿西口分開CSV、API；2025-01-30 API日期 | 有／D1／CC BY，版本待核／搜尋候選 | **轉換**；缺精確室內座標；API/CSV同步待核 |
| S11 Busta、S12 Subnade | 各自樓層／商店圖；JPEG/PDF，Subnade檔名20260826 | 有／D1或D2／未見開放重製權／參考 | **參考＋禁未許可重製** |

S01 公告公開至 **2027-03-12**。這是來源提供期間，不宜自行解讀成既有合規 PDL 衍生資料的使用權在當日自動撤回；要保存當時條款，另外查更新與提供安排。E27 的樓層標籤不能和京王或其他站圖的 B5/B6/B7 自動對齊。

新宿基圖還必須和施工資訊分開：京王新線樓層 PDF 是 2026 年 3 月末版，另有 9 月樓梯／電扶梯變動及「10月中旬」通路安排的公告。預定日期已過不等於本次已驗證工程完成。[S05]

## A3. 共用資料、照片、街景與材質矩陣

| 來源 | 可提供什麼 | 授權與四層判定 | 分類／未知 |
|---|---|---|---|
| X1 ODPT車站資料 | 站名、路線、站號等JSON；池袋／新宿可作站點搜尋種子 | 資料有；帳號/API key路徑有，payload未取；基本授權有特殊再散布／更新條件 | **轉換候選**；不是完整室內設施API；JR另有Challenge限期條款 |
| X2 Metro ODPT圖像 | 路線符號／站號圖示ZIP | 有下載入口；ZIP內特殊條款未讀 | **尚未准入**；不是構內圖授權 |
| X3 OpenStreetMap | 地面道路、入口及可能的室內tags；XML/OSM資料 | ODbL；商用修改可，署名及衍生資料庫義務；兩站室內涵蓋未實查 | **轉換候選**；不要把底圖服務當免費大量圖磚來源 |
| X4 Wikimedia個別照片 | 池袋東口CC0、池袋JR中央閘口CC BY-SA4.0、小田急新宿月台CC0 | 個別檔案頁有原圖入口；逐檔授權，非全站統一授權 | **照片可條件直接使用**；拍攝時點有限，無測量精度 |
| X5 Mapillary | 使用者街景影像與部分地圖資料 | 影像CC BY-SA，其他資料／API另有條件；站點影像ID與室內涵蓋未核 | **候選／參考**；不可先宣稱有完整地下街景 |
| X6 Poly Haven | 通用PBR材質、HDRI、模型；本次選磁磚材質 | CC0素材可商用、修改、散布；服務/API另有條件 | **通用材質可直接使用**；不是池袋／新宿實拍材質 |
| X7 Google Maps／Street View | 可供合規瀏覽的地圖與影像服務 | 服務條款限制複製、再散布、大量擷取與衍生地圖／導航資料 | **排除作GTEki可再散布原料**；不把可瀏覽等同可抽取建模 |

# B. 最值得優先下載與驗證的資料

本表是**後續取得順序**；本次沒有執行模型下載或轉檔。大小是官方 metadata 的 byte 數或資源頁標示，MB 與 MiB 不混用。優先用 API 選指定地下檔，不先取整個行政區資料。

| 優先 | 資料與實際入口 | 取得量 | 必須回答的問題／停止條件 |
|---|---|---|---|
| P0 | [PLATEAU兩區地下檔索引](https://api.plateauview.mlit.go.jp/datacatalog/citygml/13116,13104?types=ubld)；[池袋metadata](https://assets.cms.plateau.reearth.io/assets/23/b8d8c3-dbe0-4bf1-b74a-3c18b6a087c1/13116_toshima-ku_pref_2025_citygml_1_op_metadata.zip) | API約2.5KB；metadata約22KB，本次已讀 | 固定資源版本、license、來源年份、CRS證據；保存hash與時間，確認API是否改址 |
| P1 | [池袋單一地下CityGML](https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml) | **35,427,963 bytes**；未下載 | 先列gml:id、實際bbox、幾何／樓層／語意清單；若無門、電梯或通路語意，明列缺口，不補造 |
| P1 | [池袋schemas](https://assets.cms.plateau.reearth.io/assets/af/f02a4e-5049-4bbd-919a-b375ac570286/13116_toshima-ku_pref_2025_citygml_1_op_schemas.zip)、[codelists](https://assets.cms.plateau.reearth.io/assets/82/77b46c-5983-448a-9d89-c0663ddc0652/13116_toshima-ku_pref_2025_citygml_1_op_codelists.zip) | 大小未核，不先抓misc全包 | 分清CityGML版本、PLATEAU產品規格與LOD；確認uro與樓層屬性實際內容 |
| P2 | [池袋步行link CSV](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/015aaf66-9c33-412e-873d-40dc0481ec6c/download/link.csv)、[node CSV](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/03792620-1a26-4d7f-85ea-b4e46043e5b9/download/node.csv) | 合計650,341 bytes；已小樣本讀取 | 只作歷史周邊候選；檢查dangling nodes、重複ID、方向、缺值；不自動連入地下 |
| P2 | [豊島公共設施CSV](https://www.city.toshima.lg.jp/documents/11459/r5_public_facility.csv)、[公廁](https://www.city.toshima.lg.jp/documents/11459/r5_pubulic_toilet.csv)、[觀光](https://www.city.toshima.lg.jp/documents/11459/r5_tourism.csv) | 三檔約86KB；本次已讀 | 篩池袋範圍；核對名稱／座標／日期與圖像外鏈授權，入口和樓層仍未知 |
| P2 | [豊島PLATEAU related POI](https://assets.cms.plateau.reearth.io/assets/52/274fe7-b16b-4c93-805f-9382c62ceaf0/13116_toshima-ku_2025_related.zip) | 28,543 bytes；已讀 | 先核個別POI來源及資源級授權，再評估站名／landmark搜尋；不能把高さ值當室內標高 |
| P3 | [E27室內路網ZIP](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/d4519a9a-917a-4de8-9104-83e21246c04c/download/nwd_oedo_shinjuku_geojson.zip)、[分層圖ZIP](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip) | 41.9KiB＋72.7KiB；ZIP未解壓 | 小量驗證室內graph schema、source floor、電梯／樓梯分類、paid-zone與缺值；記錄公開期限 |
| P4 | [新宿單一地下CityGML](https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/13104_shinjuku-ku_pref_2025_citygml_1_op/udx/ubld/53394536_ubld_6697_op.gml)、[metadata](https://assets.cms.plateau.reearth.io/assets/e3/7cb09d-c77c-4a58-835a-5f65842426fb/13104_shinjuku-ku_pref_2025_citygml_1_op_metadata.zip) | **43,830,765 bytes**；模型未下載 | 對照E27範圍，不能因幾何接近而自動合併2023模型與較新路網 |
| P5 | [東京都2023設施／路線入口](https://www.toshiseibi.metro.tokyo.lg.jp/kotsu_butsuryu/kotsuseisaku/kotsu_suishin/shinjuku_shisetsu)、[MLIT新宿R2](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2) | 公告2.2MB ZIP／R2大小未知 | 先取得resource條款及檔案清單；沒核清之前不放入公開產品輸出 |

資料實查投入建議仍以池袋七成、新宿三成分配。新宿 E27 小檔可提早閱讀作 schema 對照，但不應因此把專案首站改為新宿。

**不優先下載：**豊島区約1.2GB全區CityGML、新宿約773MB全區CityGML、數百MB的3DTiles/MVT、完整街景庫、來源權利不明的station模型。全區大小來自目錄資訊，可能改版；決策依據是已有更精確的單一地下檔入口。[G1–G2]

# C. Blender／Three.js／Godot 匯入與資料分層建議

本節是架構建議；尚未對本案 GML 執行轉換。

## C1. 保留四類不同輸出

| 資料層 | 建議交付格式 | 核心用途與不可混淆事項 |
|---|---|---|
| 原始證據 | CityGML、CSV、GeoJSON、metadata、授權快照 | 保留原始ID、來源URL、取得時間、內容hash；不能用優化後GLB取代證據 |
| 幾何 | 原始品質glTF/GLB＋衍生Web/Godot版本 | 渲染、碰撞、遮擋；可見地板不等於准許乘客通行 |
| 導航 | node/edge JSON或GeoJSON＋明確schema | 方向、階梯、電梯、閘內外、開放時段、封閉與無障礙限制 |
| 搜尋 | POI JSON／搜尋索引＋入口對照 | 名稱、讀音、別名、分類、營運方、入口節點；POI中心點不直接當終點 |

Web與Godot共用穩定ID、樓層對照與路網規則；材質和網格可按效能衍生。公開Web交付GLB、貼圖與JSON會傳送內容至使用者端，必須審核**再散布**，不能只核「可在網頁顯示」。

## C2. CityGML到Blender

優先評估官方 [PLATEAU GIS Converter](https://github.com/Project-PLATEAU/PLATEAU-GIS-Converter) 與 [CLI文件](https://github.com/Project-PLATEAU/PLATEAU-GIS-Converter/blob/main/docs/manual/use_command_line.md)。它列有 CityGML→glTF／OBJ／3D Tiles／GeoPackage／GeoJSON 等輸出，工具為MIT；**這不是本案地下LOD4.1已成功轉換的實驗結果**。工具授權也不取代資料授權。

先讀實際GML的 `srsName`、座標軸序、單位、垂直基準與namespace。來源CSV的JGD2011平面直角9系描述，不能直接當成成品GML的序列化座標。產品規格5.0、LOD4.1與CityGML版本是三個不同概念。建立可逆的局部公尺座標轉換，保留原點與變換參數；不要把經緯度直接當公尺，也不要以「B2=-6m」代替未知標高。[G3]

Blender使用 [官方glTF匯入／匯出流程](https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html)。對小範圍樣本核對原始bbox、物件數、三角化前後形狀、法向、洞口、樓梯／坡道、透明面與貼圖連結。物件名稱保留 `gml:id`；若glTF extras不能完整保留語意，以sidecar表連回來源。簡化碰撞幾何時，不能封住實際門洞、削掉階梯或將相鄰樓層焊在一起。

沒有尺寸的示意圖不能按看起來合理的比例拉成立體車站；尺寸只能來自有權使用且可核對的資料或現勘。未知區域可在內部驗證畫面標為缺資料，不能發布為真實可通行結構。

## C3. Three.js與Godot

- **Three.js：**採用 [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) 消費經驗證GLB。以樓層／空間分塊載入；渲染物件ID與導航節點分離。Draco、Meshopt、KTX2需對應解碼／載入設定；壓縮前保留基準GLB。不要把幾何合批後遺失的ID當作無關緊要。
- **Godot：**採用 [官方支援的glTF/GLB場景匯入](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_3d_scenes/available_formats.html)。由同一原始資料產生較高細節mesh、材質與燈光；圖形壓縮擴充能否跨引擎讀取需逐項驗證，不能假設Web最佳化檔必然原樣通用。
- **導航：**mesh/navmesh可協助遊戲式移動與局部避障；跨樓層、閘口、付費區與電梯路線必須受顯式graph規則約束。電扶梯方向、限時門與停機資訊是動態條件，不能烘焙進一張永遠有效的網格。
- **定位：**有地圖與路網不等於有即時室內定位。本次未核得可持續使用的全站定位基礎設施／API。初期可讓使用者選擇目前閘口或地標作路線起點；GPS、BLE或視覺定位應另立研究任務。

## C4. 最小資料契約

| 實體 | 必須保存的欄位或關係 |
|---|---|
| Source | source_id、官方入口、資源URL、license與版本、署名、來源年度、resource更新日、取得時間、hash、加工紀錄、下載／提供期限 |
| Space／Floor | station_complex_id、operator_station_id、source_floor_id、physical_level_id、標高及其基準；未知標高為null，並附證據 |
| Node | 穩定ID、座標、樓層、出入口／閘口／轉接種類、來源ID、觀察時間、驗證狀態 |
| Edge | from/to、幾何、方向、樓梯／坡道／電梯類別、票務條件、時間區間、淨寬／坡度／階差的值或分類、封閉狀態與來源 |
| POI | 原文名、讀音、別名、類別、營運方、搜尋位置、可進入的門、入口node、樓層、營業狀態及各自更新時間 |
| Observation | 測量／照片ID、位置與方向、觀察人／時間、方法、精度或限制、現況衝突、來源權利 |

`unknown`與`false`必須分開：不知道是否有階差，不等於沒有階差；不知道是否關閉，也不等於開放。`source_floor_id → physical_level_id → verified_elevation` 的對照，必須有證據才能建立。站體相鄰、名稱相同或座標接近都不是自動連線規則。

# D. 缺少資料的實地拍攝與測繪清單

這是資料缺口清單，不是已核准的現場工作命令。將商業拍攝、測繪、掃描、腳架及受限區域的管理者要求列入行前確認；MLIT的新宿室內地圖公告也明示，在設施內進行相關調查須取得管理者許可。[G5]

## D1. 池袋：優先投入70%

| 優先 | 現場項目 | 要留下的證據 | 如何影響GTEki |
|---|---|---|---|
| 必做 | 地下模型邊界、缺口及公共通路範圍 | 模型feature與現場地標對照、走廊兩端、無資料界線、管理者邊界 | 決定首版可真實呈現區域；缺口不憑空補建 |
| 必做 | 每個交叉口、轉角、出入口與實際門 | 向各通行方向拍攝，入口號碼、所在樓層、左右關係、控制點與實測方法 | 建立正確nodes/edges，避免近距離跨牆連線 |
| 必做 | 改札與閘內外 | 公共側／付費側、進出方向、票種限制、轉乘閘口、可用時段 | 防止免費步行路線穿越不合法的付費捷徑 |
| 必做 | 樓梯、電扶梯、坡道 | 上下端及平台、source floor、垂直連接、方向、淨寬、階差／坡度；記測量不確定度 | 供多層graph與障礙條件使用，不能只拍外觀 |
| 必做 | 電梯完整路線 | 每個實際服務層、候梯廳入口、門／閘口關係、時段、限制及停機公告 | 有電梯圖示不等於整條輪椅路線連續可用 |
| 必做 | 出口開閉與施工 | 門牌、圍擋、告示有效日、繞行方向、當次觀察時間 | 舊圖仍畫出出口也不能導向封閉處 |
| 高 | POI實際入口 | 店名、別名、類別、營業／歇業、樓層、門位置、可接入節點；名稱與入口分別驗證 | 搜尋結果能抵達可進入的門，而不是建物中心 |
| 高 | 廁所、無障礙廁所、服務台、置物櫃 | 可達側、服務時段、是否在付費區；涉及尺寸才實測 | 修補市區POI沒有涵蓋的站內設施 |
| 中 | 材質、光線與辨識地標 | 經許可的地板／牆面／天花照片，拍攝距離、比例參照、方向與日期 | 改善自由探索辨識；不把裝飾材質誤認為導航證據 |

**池袋定向查核點：**JR、東武、西武、Metro之間每個打算納入的公共連接；Echika／ISP等商業區的管理界線與開放時段；Metro電梯所連接的地上出口及中間層。1a／C4在歷史圖及現有資料有封閉訊息，而新圖仍可能畫出結構；保留歷史封閉證據，目前通行狀態標為未知；核實前不納入可通行路線，不能因圖示存在推斷重新開放。[I-02、I-05]

照片應記拍攝權利與可公開用途；人物、招牌、藝術作品、Logo等另作權利／隱私處理，不能因攝影者授權照片就推定每個內容均可抽出再利用。導航量測與宣傳／材質照片分開登錄，避免用透視照片推估安全關鍵淨寬。

## D2. 新宿：驗證30%

以E27已公開小型graph作對照區域，確認其六種來源樓層標籤、電梯／樓梯上下端、付費邊界及與其他站區的接點。另查京王新線最新施工動線、2020東西自由通路資料與今日差異、Busta各層接點。E01新宿西口、新宿三丁目、西武新宿、Subnade與Busta維持獨立設施／站點身分；只有被證實的公共連接才能相連。

## D3. 現勘回傳格式與驗收

每筆回傳至少有：穩定ID、來源站／營運方、source floor、觀察時間、位置與方向、照片或測量證據、方法／精度限制、閘內外、開放時段、關聯node/edge、待確認事項。幾何測量誤差與資訊時效分別評估，不用單一「信心90%」取代證據。

完成條件是能將一條限定路線的每個接點追溯到證據，並能解釋缺口與衝突；不是拍到大量照片。輪椅路線必須整段驗證，不能只確認兩端都有電梯。

# E. 交給 Opus 5.5／Codex 的工程 Handoff

## E1. 建議分工與第一項交付

**Opus 5.5：**審核產品範圍、來源權利、資料契約、可通行規則與驗收條件；優先指出「資訊未知但被當成已知」的地方。

**Codex：**在使用者另行授權資料驗證／工程後，按P0–P2限定取得池袋樣本，產生可重現的資源清單、座標與語意檢查、範圍／樓層覆蓋表。第一項交付是資料可用性報告，不先做漂亮但無依據的整站模型。

建議第一輪僅處理一個池袋地下GML、必要schema／metadata及周邊小檔；新宿E27小檔作結構參照。不要將「有能力讀取」擴張為整區下載、repo修改、部署或外部聯絡授權。

## E2. 必須交付的研究驗證產物

1. **來源登錄表：**每個檔案的實際URL、hash、byte數、取得時間、來源年度、license、署名與加工限制。
2. **範圍與缺漏表：**每個gml:id、實際bbox、source floor、營運方／管理區域是否可辨、地板／門／樓梯／坡道／電梯是否真的有資料。未知必須可查詢。
3. **權利准入表：**可發布幾何、POI、graph與貼圖分開；reference-only來源不得混入公開GLB／JSON生成來源。
4. **座標報告：**實際CRS、軸序、垂直基準、local origin、單位、可逆變換；不憑檔名自行猜座標。
5. **一個限定範圍的轉換檢查：**若已獲工程授權，再產生小GLB及前後範圍／物件對照；不以成功開檔代替完整性驗證。
6. **一條候選路線的證據鏈：**每條edge的起終點、上下層、票務與時段條件、資料時點及現勘需求；未知連線不得列為已驗證路由。
7. **待現勘清單：**依是否阻擋可到達性排序，明列只缺外觀與真正缺拓樸的差別。

## E3. 資料與產品驗收門檻

| 門檻 | 通過條件 | 未通過處理 |
|---|---|---|
| 權利 | 每項公開輸出可追到允許其用途的授權，署名與加工聲明完整 | 來源留研究參考，不進發布資料 |
| 幾何 | 小範圍原始／轉換結果可對照，無樓層黏合、洞口封堵或座標錯軸 | 記錄轉換限制；不人工猜補實體 |
| 拓樸 | 連接都有來源或現勘證據，跨樓層只經已驗證connector | 未知edge排除正式routing |
| 通行 | 閘內外、方向、時段、封閉與票種規則有證據 | 不顯示為自由通行捷徑 |
| 無障礙 | 起點到終點整段條件可核對，未知值不變成「可」 | 不給已驗證輪椅路線標籤 |
| POI | 搜尋位置和入口分離，入口連到正確樓層／公共側 | 可顯示搜尋資訊，暫不承諾精確導航到門 |
| 時效 | 內容日期、公告生效日、觀察日期分開，未來事件不提前套用 | 標記待核，必要時停用受影響edge |

這些是後續驗證項目，不是本次已完成的測試。不能聲稱本次已成功匯入Blender、Three.js或Godot。

## E4. 可直接複製的交接提示詞

```text
你正在接手GTEki公開資料驗證。閱讀本報告後，維持池袋70%、新宿30%的優先順序。

本回合目前只有研究授權；沒有工程、GitHub修改、部署、大量下載或外部聯絡授權。
若使用者另行授權下一階段，先做限定資料可用性驗證，不直接重建整站。

已證實：
- 池袋與新宿官方PLATEAU索引各有地下ubld CityGML單檔。
- metadata明示CC BY4.0，地下來源紀錄為2023東京都LidarSLAM、mapLevel500。
- 2025是資料包年度，不能當作所有地下空間的測量日期。
- 本次沒有下載地下GML，樓層、付費區、電梯與通道完整性未知。
- 池袋Hokonavi樣本有2196筆link、1887筆node；node.in_out均為1、elevation均空。
- 新宿E27有PDL1.0室內路網／分層圖候選，但不是全新宿站。
- 官方鐵道圖面通常沒有開放重製權；不能直接描圖生成公開3D資產。

若進入獲授權的資料驗證：
1. 重新讀官方PLATEAU API，先取得metadata/schema與指定池袋單檔，不取全區大包。
2. 保存來源、license版本、署名、來源年度、取得時間、hash和byte數。
3. 實讀CRS、軸序、標高基準、gml:id與語意；列真正的範圍及樓層。
4. 幾何、導航graph、搜尋POI分開；共同ID與來源追溯必須保留。
5. source_floor_id到physical_level_id的對照須有證據，未知標高保持null。
6. 不以幾何相近、名稱相同、同為B1或navmesh連通，自動推定可以穿越。
7. 無證據的通道、門、改札、電梯、樓層和尺寸一律不補造。
8. 只在資料與通行證據足夠的小範圍提出試轉或候選路線，未驗證edge不參與正式routing。

交付：來源登錄、權利准入、範圍/樓層/缺漏表、座標報告、候選路線證據鏈、實測待辦。
明確區分資料存在、下載成功、合法再利用、導航驗收四個層次。
報告不得把規格支援、案例展示或成功開檔寫成整站資料完整、現況正確、導航可用。
```

# 授權與更新管理補充

| 授權／情形 | 商用 | 修改 | 再散布與公開Web3D | 更新／其他條件 |
|---|---|---|---|---|
| CC BY 4.0（本案PLATEAU） | 可 | 可 | 可，附署名、來源、license及變更說明 | 不保證內容或URL持續更新；第三方權利另核 |
| PDL 1.0（Hokonavi） | 可 | 可 | 依條款附出處及加工聲明；與CC BY4.0相容 | 來源提供期限與既有合規授權效力分開記；不得冒稱官方成果 |
| CC BY 2.1 JP（豊島指定CSV） | 可 | 可 | 依該版本署名條件 | 僅適用指定資料，不自動涵蓋外鏈照片與其他區府PDF |
| CC BY-SA 4.0照片 | 可 | 可 | 改作照片需依相容的相同方式共享條件處理，保留署名 | 不自動要求整個獨立軟體以同授權發布；複合／衍生關係須具體判斷 |
| CC0素材／照片 | 可 | 可 | 著作權層面可；不要求署名，但建議保留來源 | 不處理所有商標、肖像或被攝作品權利 |
| ODbL | 可 | 可 | 署名；衍生資料庫與Produced Work規則須分別履行 | 只把檔案分目錄不能消除實際衍生資料庫義務；圖磚服務另有政策 |
| ODPT Basic／Challenge | 按具體條款 | 按具體條款 | 不是無條件CC授權；原資料再散布、使用者資格與期間須核 | 有更新／再散布限制；Challenge項目不能假設永久開放 |
| 企業官網圖／一般市區PDF | 未取得GTEki重製許可 | 未取得 | 沒有足夠依據直接貼圖、描圖後發布mesh或搬用圖示 | 本次僅作研究參考，依個別明文許可例外處理 |

法律條款依據：[PLATEAU網站政策](https://www.mlit.go.jp/plateau/site-policy/)、[PDL 1.0](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)、[Hokonavi條款](https://www.hokonavi.go.jp/terms/)、[OSM版權與授權](https://www.openstreetmap.org/copyright)。PLATEAU現行網站一般政策與本案metadata並不衝突：具體資料已指定CC BY4.0，應保留具體授權證據。涉及特定測量成果的法定使用程序時，另依該來源與用途核對，不把開放著作權授權當成免除所有其他義務。

建議維護方式（不是來源承諾）：資料包以版本差異追蹤；出口、限時門、電梯及施工公告在受影響路線發布前重新核對；POI名稱、營業狀態、入口位置分別更新。沒有公開即時狀態來源時，不對外承諾即時可通行或無障礙保證。

# 逐來源證據卡

以下完整保留官方入口、原檔入口與未知項；裸檔連結用於來源核驗，不表示已取得展示、嵌入或再散布許可。來源URL可能改版，後續取得應重新檢查官方目錄。


## G：PLATEAU、地下幾何、BIM與新宿歷史室內地圖

### G1. 豊島区／池袋：最新官方下載入口

官方目錄： [官方入口／說明](https://www.geospatial.jp/ckan/dataset/plateau-13116-toshima-ku-2025) （本次目錄存取回403；官方API與metadata另行可讀）。

官方 live API： [官方入口／說明](https://api.plateauview.mlit.go.jp/datacatalog/citygml/13116,13104?types=ubld)

單一池袋地下街 CityGML：
[CityGML檔案](https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml)

API記錄：year=2025、registrationYear=2025、spec=5.0、mesh=53394576、fileSize=35,427,963 bytes、maxLod=4、features=2、lod1=1、lod4=1。**2個feature不等於2個房間或2個樓層。** API未提供4.1小版本；LOD4.1來自目錄及東京都說明，GML幾何尚未取檔驗證。

metadata：
[ZIP檔案](https://assets.cms.plateau.reearth.io/assets/23/b8d8c3-dbe0-4bf1-b74a-3c18b6a087c1/13116_toshima-ku_pref_2025_citygml_1_op_metadata.zip)

完整CityGML（約1.2GB，勿優先取）：
[ZIP檔案](https://assets.cms.plateau.reearth.io/assets/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op.zip)

3D Tiles/MVT（約701MB，未取）：
[ZIP檔案](https://assets.cms.plateau.reearth.io/assets/07/2b2fd3-0115-4afb-9292-cfbebb2cfe08/13116_toshima-ku_pref_2025_3dtiles_mvt_1_op.zip)

related POI：
[ZIP檔案](https://assets.cms.plateau.reearth.io/assets/52/274fe7-b16b-4c93-805f-9382c62ceaf0/13116_toshima-ku_2025_related.zip)

索引圖：
[PDF檔案](https://assets.cms.plateau.reearth.io/assets/53/5ede99-c96b-43b0-ab20-db828ff20665/13116_indexmap_op.pdf)

schema： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/af/f02a4e-5049-4bbd-919a-b375ac570286/13116_toshima-ku_pref_2025_citygml_1_op_schemas.zip)

codelists： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/82/77b46c-5983-448a-9d89-c0663ddc0652/13116_toshima-ku_pref_2025_citygml_1_op_codelists.zip)

specification： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/b7/a002d0-ed56-4227-9e7f-382de4a1c031/13116_toshima-ku_pref_2025_citygml_1_op_specification.zip)

misc（約13MB，本次不取）： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/fc/915225-3ef1-4b75-9ca8-103d6a3cb936/13116_toshima-ku_pref_2025_citygml_1_op_misc.zip)

讀到的官方起源鏡像： [官方入口／說明](https://search.ckan.jp/datasets/www.geospatial.jp__ckan__dataset:plateau-13116-toshima-ku-2025) 。它列目錄發佈2026-03-16、修改2026-03-27；bldg LOD0/1/2.0/2.2，ubld LOD1/4.1。**mirror舊全市ZIP的asset UUID與 live API 不同；工程應重新讀live API，不把此研究URL永久硬編碼。**

#### G1-related：小型POI實查

related ZIP有7份GeoJSON：shelter2023、park2023、landmark2025、station2025、railway2025、emergency_route2025、border2025。station共35 features，landmark143。池袋站點含JR／西武／東武／丸ノ内／有楽町／副都心等名稱與線別資料。未包含室內房間、各樓層POI、改札或出口圖。`高さ`欄位用途未驗證，不能當作室內樓層高程。這不是完整店舖或站內搜尋資料。**權利限制：本次只證實同目錄公開可下載；未核得related ZIP及各GeoJSON的資源級授權。CityGML metadata的CC BY4.0不能自動套用至此。商用、修改、再散布與公開Web3D使用均待核；分類為可解析的轉換候選，尚未准入。**

### G2. 新宿：最新官方下載入口

官方目錄： [官方入口／說明](https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025) （本次403）。

單一地下街 CityGML：
[CityGML檔案](https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/13104_shinjuku-ku_pref_2025_citygml_1_op/udx/ubld/53394536_ubld_6697_op.gml)

API：year2025、spec5.0、mesh53394536、fileSize43,830,765 bytes、maxLod4、features2、lod1=1、lod4=1。完整樓層／公司／付費區涵蓋未知。

metadata：
[ZIP檔案](https://assets.cms.plateau.reearth.io/assets/e3/7cb09d-c77c-4a58-835a-5f65842426fb/13104_shinjuku-ku_pref_2025_citygml_1_op_metadata.zip)

全市CityGML約773MB： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/13104_shinjuku-ku_pref_2025_citygml_1_op.zip)

3D Tiles/MVT約563MB： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/2f/422bdf-d9a5-439a-8c2c-acc9c5f23f3d/13104_shinjuku-ku_pref_2025_3dtiles_mvt_1_op.zip)

related約40KB（本次未取，個別來源與資源級授權亦待核）： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/23/55e3ae-7f14-4e7e-b922-a4a09da0a714/13104_shinjuku-ku_2025_related.zip)

索引圖： [PDF檔案](https://assets.cms.plateau.reearth.io/assets/78/53ad93-07eb-438e-b822-51ecf507c969/13104_indexmap_op.pdf)

schema： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/10/d3bda5-575e-43f8-a134-3fc3ef6b56ab/13104_shinjuku-ku_pref_2025_citygml_1_op_schemas.zip)

codelists： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/e9/b1d234-ec4d-422c-8dd9-2748c965730c/13104_shinjuku-ku_pref_2025_citygml_1_op_codelists.zip)

specification： [ZIP檔案](https://assets.cms.plateau.reearth.io/assets/42/e0872f-4aea-4f60-9448-73a95faab87a/13104_shinjuku-ku_pref_2025_citygml_1_op_specification.zip)


官方起源鏡像： [官方入口／說明](https://search.ckan.jp/datasets/www.geospatial.jp__ckan__dataset:plateau-13104-shinjuku-ku-2025) 。發佈2026-03-16。其他同池袋。

### G3. 日期、精度與許可的直接證據

兩份metadata ZIP的CSV與XML本次已實讀。來源CSV對地下模型同樣列：

```
feature=uro:UndergroundBuilding
property=bldg:lod4MultiSurface
sourceName=LidarSLAM計測
authority=東京都
date=2023
srs=JGD2011/9（X,Y）
mapLevel=500
```

這是**來源地圖資訊等級500**，不等於實測誤差500 mm，更不等於可供安全導航的精度認證。整體metadata分母2500與地下來源500是不同層級，不衝突。沒有取得池袋／新宿地下幾何的獨立實測RMS報告，不應報稱公分級。

XML明示 `Licensed under CC BY 4.0`。其citation/specification date為2026-03-13，底部`dateStamp`卻仍2025-02-28，存在日期欄位差異；不要將任一元資料日期視為現場測繪日。XML表示：R5資料先由規格3.4升4.1，R7更新建築、道路、都市計畫、災害風險並新增水部，其餘地物作版本更新。結合CSV，**地下幾何來源年代是2023，而不是2025／2026實測**。

XML CRS同時列JGD2011/(B,L)、JGD2011, TP/(B,L),H；最終GML須讀srsName與軸序，不能因來源CSV平面直角9系就直接以平面直角解析成品。

PLATEAU網站政策： [官方入口／說明](https://www.mlit.go.jp/plateau/site-policy/) 。最新原則為PDL1.0，且說明相容CC BY4.0、可商業利用、編輯、重製等；但資料個別條款優先。本案原始metadata已指定CC BY4.0。工程保留原始署名、來源、版本及修改說明；不要將加工成果標成政府官方成果；各外加照片、logo、第三方材質另查權利。不存在保證隨時最新或永續URL的承諾。若用途涉及測量成果再使用法定程序，另外檢查該具體用途，不能把開放著作權授權等同免除所有法律義務。

### G4. 地下覆蓋範圍的官方說明與未知

東京都官方WG PDF：
[官方入口／說明](https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_bunyabetsu_machizukuri_pdf_digital08_3)


明示東京八重洲、新宿、池袋、澀谷地下街LOD4.1，能表現樓梯、斜坡、柱等。這支持「地下內部幾何存在」，**不能推論每個車站、每層、改札、垂直連接及付費區皆完整**。索引圖主要顯示bldg LOD1/LOD2網格，無逐樓層覆蓋；不能以索引圖顏色當室內覆蓋證據。

CityGML標準地下LOD4.1：
[官方入口／說明](https://www.mlit.go.jp/plateaudocument/toc4/toc4_16/toc4_16_01/toc4_16_01_05/_88fa30a3-83c4-0ee7-83bc-98821c1be9c9/)

規格允許Solid/MultiSurface、內部空間等表現；規格能力不等於特定實際檔案已具所有物件。LOD是表現詳細度；CityGML產品規格5.0、LOD4.1、CityGML本身版本是不同概念。

東京都Digital Twin： [官方入口／說明](https://info.tokyo-digitaltwin.metro.tokyo.lg.jp/3dmodel/) 。2026-09-25頁面更新並非地下測量日。不要把viewer畫面可見等同可下載可再利用。

### G5. 新宿R2（2020）高精度屋內地圖

官方公告： [官方入口／說明](https://www.mlit.go.jp/report/press/tochi_fudousan_kensetsugyo17_hh_000001_00002.html) 

官方下載目錄： [官方入口／說明](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2)

範圍／更新說明PDF： [PDF檔案](https://www.mlit.go.jp/report/press/content/001369414.pdf) 

官方2020-10-27發佈，加入2020-07新宿東西自由通路。包含通路／樓梯等屋內圖與階差／坡度步行網路；公開供第三方導航服務開發。附圖明示地下部、地上部、Busta新宿3F/4F，沒有完整逐層清單，不能填作「B1～4F完整站體」。官方提GeoPDF；常見配套SHP/PDF/JPEG需本次資源清單再核。地理誤差、實測日期細節、本次檔案版本均未知。

本次官方CKAN及API403，因此**實際資料ZIP URL未驗證**，只確定真正官方下載入口。歷年鏡像與索引提Government Standard Terms，但2020資料個別利用規約PDF未取得，不能把舊版H29/H30授權直接當作R2已核驗。後續應小量取README／利用規約，再取單層GeoPDF/SHP。現況2020距離2026且新宿持續改建，不宜直接上線導航。

官方專案： [官方入口／說明](https://www.mlit.go.jp/tochi_fudousan_kensetsugyo/tochi_fudousan_kensetsugyo_tk17_000001_00009.html) 。BLE位置環境歷史試驗不能當作現在仍運作。

### G6. BIM/CAD與應用案例

[官方入口／說明](https://www.mlit.go.jp/plateau/use-case/bz25-05/) ，2026-03-31案例。

JR東日本Consultants於JR池袋／新宿範圍，用CityGML加設施管理者BIM/CAD/圖面，再結合POI及步行網路製作Station Navi。這證明專案資料存在及方法可行；沒有發現對外完整IFC/BIM、網路、POI下載或開放授權。列為參考與潛在合作窗口。不得從應用網站抓取模型後假設可再散布。


## I：池袋營運方、跨業者圖面與POI

### I-01 JR 東日本 池袋構內圖

- 官方：[官方入口／說明](https://www.jreast.co.jp/estation/stations/108.html)
- 實際官方圖檔入口（已確認官方頁圖檔連結；本次原始檔HTTP讀取回403，未完成原始位元組驗證）：
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0108_1f-2f.png)
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0108_b1.png)
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0108_all.png)
- 格式：PNG；頁面分 1F–2F、B1、立體圖。JR 站內為主，含與其他業者銜接的示意。不是 BIM，不是可度量平面圖。
- 空間精度：沒有公布測量精度／比例尺／座標基準。圖元位置只供示意；不能推斷通路寬度、高程、樓梯尺寸或精確出入口座標。
- 日期：本次未能確認圖面修訂日期；網頁爬取日不是資料更新日。
- 授權：[官方入口／說明](https://www.jreast.co.jp/site/rules.html/) 明確拒絕資料之複製、轉用、轉載、電磁加工、傳送、頒布、二次使用等；亦未保證更新與正確性。
- 四層：存在=是；可下載=有官方圖檔URL及可解析的網頁入口；本次原始檔HTTP讀取回403；合法再利用=未取得公開 3D 重製權；導航=只能參考，需要獨立測量／授權資料、連通圖及現況查證。
- 分類：僅供參考；原圖與受保護表現未經許可禁止重製。可信度：官方位置關係高，現況／幾何精度未知。

### I-02 東京メトロ 池袋構內圖、出口與無障礙設備

- 官方：[官方入口／說明](https://www.tokyometro.jp/station/ikebukuro/index.html)
- 大圖：[JPEG圖檔](https://www.tokyometro.jp/station/yardmap_img/figure_yardmap_ikebukuro_all.jpg)
- 簡圖：[PNG圖檔](https://www.tokyometro.jp/station/yardmap_img/figure_yardmap_ikebukuro_simple.png)
- 印刷入口：[官方入口／說明](https://www.tokyometro.jp/station/ikebukuro/yardmap/index_print.html)
- 取得：JPEG 小樣本 1,390,811 bytes 已驗。印刷標注 **2026.3 現在**；HTTP Last-Modified 2026-03-05，兩者分開記錄。
- 範圍：丸ノ内線 M25、有楽町線 Y09、副都心線 F09；圖面明確顯示 B1F、B2F、B4F 與地上出口、樓梯／電梯；中間連絡層與中二階另須確認，不能直接為其捏造絕對標高。圖含 JR、東武、西武換乘方向與 Echika/Esola 關係，但不代表他社完整室內資料。
- 格式／精度：JPEG/PNG 立體示意圖，無測量精度或可量尺寸；圖為 2D 點陣，不是可下載的 3D mesh。
- 無障礙官方文字：[官方入口／說明](https://www.tokyometro.jp/station/ikebukuro/accessibility/index.html)
  - 提供每條線至少一條地上–改札–月台電梯路線的有無、個別電梯／電扶梯所在點對與部分運轉時間。
  - 例：丸ノ内線中央通路東改札–34 番出入口電梯；有楽町線南通路西改札–4 番出入口（Esola）；副都心線ホーム中央–中二階–西通路東改札，以及改札外 C9/C1b。
  - 月度運轉停止資訊可參考，現有頁顯示2026年10月/11月；不等同完整 outage API，也不保證即時故障更新。
- 授權：[官方入口／說明](https://www.tokyometro.jp/terms/index.html)，許可外使用、轉載、複製、再配布、販售等不開放，商用 Web 3D 複製原圖／描圖權未獲授權。
- 四層：存在=是；可下載=圖檔是、結構化室內圖未知；合法再利用=Web原圖/衍生3D待許可；導航=可參考設施連接事實，不能直接作精確導航圖。
- 分類：僅供參考／未授權禁止重製。可信度：官方現況資訊高；圖面2026.3仍需現況對照。

### I-03 東武 池袋

- 官方：[官方入口／說明](https://www.tobu.co.jp/railway/guide/station/info/7105/)
- 地圖入口：[官方入口／說明](https://www.tobu.co.jp/railway/guide/station/insidemap/7105/)
- 圖檔（由該頁原始HTML直接驗得）：[GIF圖檔](https://www.tobu.co.jp/cms-img/stations/20231221095530V2Amh3nWeUA4TlFcBebONQ.gif)
- 格式：GIF，63,935 bytes；圖面 B1、1F、2F 定期券售票處，中央1/中央2/北/南改札與 JR 連絡方向、輪椅路線。無尺規／座標基準。
- 日期：HTTP Last-Modified 2023-12-21，圖面未見印刷修訂日；不可將檔案上傳日宣稱為測量日。
- 駅頁列出電梯、電扶梯、無障礙廁所及各月台縮小高差/間隙的車門位置，無公開 navigation graph。
- 授權：[官方入口／說明](https://www.tobu.co.jp/sitepolicy/) 第7條：除承認外，不可超越著作權法私用範圍複製、銷售、出版。無再散布 3D 授權。
- 四層：存在=是；可下載=已驗小圖；合法再利用=待許可；導航=圖為參考、需獨立幾何和節點邊。
- 分類：僅供參考；未經許可原圖重製禁止。可信度：官方高、現況日期待核。

### I-04 西武 池袋

- 官方：[官方入口／說明](https://www.seiburailway.jp/railway/station/ikebukuro/)
- 構內圖：[PNG圖檔](https://www.seiburailway.jp/railway/station/image/SI01_1.png)
- 電梯／電扶梯／樓梯月台位置：
  - [PNG圖檔](https://www.seiburailway.jp/railway/station/image/si01_pos_10.png)
  - [PNG圖檔](https://www.seiburailway.jp/railway/station/image/si01_pos_8.png)
- 格式：PNG；構內圖145,262 bytes，印刷日期 **2026.8.1**，HTTP Last-Modified2026-08-12。
- 範圍：1F 月台/改札、B1F地下改札與換乘方向、西武南口；個別通路字母標記、昇降設施及無障礙移動方向。非其他業者完整空間。無測量精度、無比例尺或座標。
- 授權：[官方入口／說明](https://www.seiburailway.jp/policy/)，私用範圍外未經權利人許可，複製、轉用、轉載、頒布、改變全部或一部禁止。
- 四層：存在=是；可下載=已驗；合法再利用=待許可；導航=參考示意，不能直接導航。
- 分類：僅供參考／未經許可禁止原圖衍生重製。可信度官方高、精確幾何未知。

### I-05 豊島區 池袋地下空間案內圖（值得優先詢問授權）

- 官方：[官方入口／說明](https://www.city.toshima.lg.jp/405/1705251510.html)
- 實際PDF：[PDF檔案](https://www.city.toshima.lg.jp/documents/17300/undergroundmap_202201.pdf)
- 文件2022-01-06，2022年1月更新；2頁，A3横／彩色地下案內圖及利用說明。地下空間全域的跨業者統合示意；這是入口頁原文的 coverage claim，不代表每層測量完整。
- 更新事項為丸井解體導致1a/C4出入口閉鎖。主頁另記2021-10先有局部閉鎖更新。
- 精度：PDF示意圖；無座標系、量測精度、樓高與施工/BIM資料。全域示意不能當精密平面。
- 特定利用條款（同PDF首頁）允許自行加註資訊、刊物登載、配布、HP掲出；但禁止鐵道路線符號與商業設施Logo的色/字體/比例修改、未經許可的流用及二次使用；其他用途請洽區府。
- 判斷：**作為2D案內圖按條件揭載有明文許可；商業模式與描圖轉3D／可再散布導航資料沒有明文充分授權**，應要求確認範圍及標誌可移除／替代方式。不要直接把它標CC BY；城市開放資料授權只涵蓋專頁列出資料。
- 四層：存在=是；可下載=是；合法再利用=特定2D用途有條件，3D未知；導航=不可直接（無graph/尺度/現況）。
- 分類：2D條件使用；對GTEki3D僅參考、待許可。可信度高但2022歷史版，2026現況未知。

### I-06 豊島區開放POI CSV（可合法轉換的優先來源）

- 官方：[官方入口／說明](https://www.city.toshima.lg.jp/020/kuse/electronic/open-data/1511041608.html)
- 直接小檔：
  - 公共施設：[CSV檔案](https://www.city.toshima.lg.jp/documents/11459/r5_public_facility.csv)
  - 公衆トイレ：[CSV檔案](https://www.city.toshima.lg.jp/documents/11459/r5_pubulic_toilet.csv) （原檔名拼字確為pubulic）
  - 観光施設：[CSV檔案](https://www.city.toshima.lg.jp/documents/11459/r5_tourism.csv)
  - AED：[CSV檔案](https://www.city.toshima.lg.jp/documents/11459/r5_aed.csv) （入口已確認，未抓raw）
- 範圍：全豊島區，不限池袋站；不含完整站內商家與改札內設施。公共施設558筆、經緯度558筆；公廁6筆全部有座標，其中池袋駅北口前公衆便所；觀光5筆全部有座標。這些計數為2026-10-20本次小樣本CSV實際解析結果。
- public facility 81,198 bytes；toilet1,558 bytes；tourism3,631 bytes。頁面寫80KB/2KB/4KB。
- 目前入口網頁更新2026-08-18；這三份CSV HTTP Last-Modified皆2023-11-07。`r5`與表內內容可提示令和5年度，但不可將HTTP或檔名等同測量日期；資料實地查核日未知。
- 格式：CSV，含名稱、地址、緯度經度、POI碼/用途/可用時段/部分無障礙欄位，很多欄位空白；無統一floor/入口節點ID、無站內graph。經緯度數字的小數位不等於測量精度，CRS聲明本次未驗證。
- 授權：**CC BY 2.1 日本**，專頁明示可商用、自由複製改變與產生二次作品，需標示使用豊島區資料；僅對該頁指定資料適用。資料可能變動移除，無正確/完整性保證；圖片欄位須另看個別画像_ライセンス，不能把外鏈圖片自動視為同授權。
- 四層：存在=是；可下載=3份bytes已驗；合法再利用=有明文商用修改散布許可附署名；導航=只可轉成搜尋POI，需要將入口/樓層接到經驗證路網。
- 分類：需轉換（CSV→POI JSON/GeoJSON）；資料本身不提供站內拓樸，用於導航時仍須定位實際入口、樓層及其路網接點。可信度授權高、現況/入口準確度中低待survey。

### I-07 Echika 池袋 與 Metro 設施商店

- 店家官方入口：[官方入口／說明](https://www.metropro-sc.jp/echika-ikebukuro/shop/floor.jsp)
- 圖檔：[JPEG圖檔](https://www.metropro-sc.jp/photo/2041-2400.jpg)
- 東京Metro站內店家：[官方入口／說明](https://www.tokyometro.jp/station/ikebukuro/shop/index.html)
- 範圍：東京メトロ池袋地下商業區店舖區劃與名錄；不是站內全商家。Echika圖只標「区画」，不可假裝有已驗證每層精密floor資料。
- 格式：HTML店名/分類/電話/營業時間、JPEG區劃示意。未提供公開bulk POI/API/座標/量測精度。
- 日期：未標統一資料修訂日；個店有異動公告。兩官方來源部分營業時間文字不同，所以應帶source+observed_at，不合併出假的唯一權威現況。
- 授權：Echika頁footer All rights reserved；未找到其專屬開放授權。營運公司網站條款 [官方入口／說明](https://www.metro-pro.jp/terms/) 禁未經許可複製轉用，但該條款之scope是否法律上完整涵蓋metropro-sc子站應確認，不過**無開放權仍不可列可直接複製**。Metro站頁則受Metro terms限制。
- 四層：存在=是；可下載=JPEG/HTML可見；合法重製=未確認/需許可；導航=POI參考但缺座標入口floor和路網。
- 分類：僅供參考；不能原樣抄整個名錄、照片、Logo或地圖當開放資料。事實性店名/地址應透過自採或取得資料權、保留source與更新時間。

### I-08 池袋ショッピングパーク ISP

- 官方：[官方入口／說明](https://www.web-isp.co.jp/floorguide/)
- PDF：[PDF檔案](https://www.web-isp.co.jp/assets/pdf/floorguide/floormap.pdf)
- 設施：[官方入口／說明](https://www.web-isp.co.jp/facilities/)
- 格式：1頁PDF，南館/北館/レンガ通り、店鋪/出入口/樓梯/電梯/坡道/洗手間與B2停車場連絡。
- 樓層：商場B1、公共地下駐車場B2（官方facilities文字明示）；不是完整車站樓層或B2測量圖。
- 日期：PDF metadata title `20260301_新フロアガイド`；只能記作標題含2026-03-01，不能單憑metadata斷言所有店舖2026-03-01現況。無精度/座標/比例保證。
- 條款：[官方入口／說明](https://www.web-isp.co.jp/terms/) 第3條未經事前許可禁止超法律許可範圍複製、改變、銷售、上傳別站、公開展示、分發等；資料可預告外變更。第5條不歡迎深層連結/iframe，產品若連結宜連主頁。研究矩陣提供直接下載位址是為查核，不意味可嵌入或再發布。
- 四層：存在=是；可下載=官方PDF可讀；合法再利用=未獲；導航=僅參考，需floor/entrance拓樸與現況。
- 分類：僅供參考／未經許可禁止重製。可信度官方高，現況日期不完整。

### I-09 跨業者 Ecomo らくらくおでかけネット

- 官方財團：[官方入口／說明](https://www.ecomo-rakuraku.jp/ja/station_map/%E6%B1%A0%E8%A2%8B/)
- PDF：[PDF檔案](https://www.ecomo-rakuraku.jp/static/stationmap/pdf/22513.pdf)
- 日期：PDF明示 **2018年2月現在**。
- 範圍：JR/東武/西武/Metro共構與無障礙移動圖，涉及B4/B2/B1/1F與出口方向。示意圖，無尺度，含已過時店名（丸井）。站頁自己要求併看各社最新圖。
- 條款：[官方入口／說明](https://www.ecomo-rakuraku.jp/ja/info/rule.html) 明確不得無斷轉載，轉載須聯絡；**營利目的利用謝絕**。
- 四層：存在=是；下載=是；商用公開3D重製=否，依當前條款排除；導航=舊參考不能用作現況。
- 分類：禁止商用重製；可研究參考。可信度2018歷史中高、當前低。

### I-10 官方地下防災與無障礙規劃（參考、不可當現況graph）

- Echika地下街等防災推進計畫：入口Metro站頁，PDF [PDF檔案](https://www.tokyometro.jp/station/toppdf/disaster_prevention_ikebukuro.pdf)
- 5頁、2025年10月，Echika（副都心線）、有楽町線池袋與東京芸術劇場／Metro City西池袋部分；圖例有地下街範圍/地上出口/避難路徑。Metro條款；沒有資料庫/3D授權。導航用途只能比較公開出口及管理範圍，不能把災害避難線直接當日常無障礙通路。
- 豊島區基本構想：[官方入口／說明](https://www.city.toshima.lg.jp/303/machizukuri/toshikekaku/shisaku/021391/1610311619.html)
- 頁更新2026-08-12，但計畫本身是2019年4月版；含分割PDF下載。此是規劃，不能把「計畫將改善」當「設施已可走」。不在open-data指定表，受一般區府sitepolicy限制。


## S：新宿營運方、開放路網與POI

### S01 — MLIT ほこナビDP：大江戸線新宿站室內網路＋樓層圖（高優先）

- 官方入口：[官方入口／說明](https://ckan.hokonavi.go.jp/dataset/station_oedo_shinjuku)
- 路網 GeoJSON ZIP（41.9 KiB）：[ZIP檔案](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/d4519a9a-917a-4de8-9104-83e21246c04c/download/nwd_oedo_shinjuku_geojson.zip)
- 樓層地圖 GeoJSON ZIP（72.7 KiB）：[ZIP檔案](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip)
- 確認 PDF（248.1 KiB，9頁）：[PDF檔案](https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/3b1dede4-10db-4e5f-862a-95983f16cc40/download/station_oedo_shinjuku.pdf)
- 另有 CSV／Shapefile 下載；不用將各格式全下載。
- 範圍：官方明寫「都營地下鐵大江戸線 新宿站」；不可視為整個新宿站、JR／京王全部、或新宿西口站。資料由構內圖建立；不是公開 BIM。
- PDF 樓層標籤：1F（2頁）、B1F（2頁）、B2F（2頁）、B3F、B5F、B6F。不可自行補 B4/B7；必須與營運方樓層標示、標高另作對應。
- 地理：JGD2011；路網依 MLIT 2024-07規格，樓層資料依 GSI 2019-03「階層別屋内地理空間情報データ仕様書（案）」。有樓梯、電梯、電扶梯、坡道、通路、空間及設施類別。
- 更新：dataset 自述 2026-09-17；個別 resource metadata 2025-10-22（建立2025-10-20）。皆不能直接視為測量日期。精度數字／測量方法未見。
- 授權：PDL1.0；出處與加工聲明、不得冒稱政府製作。站點條款 [官方入口／說明](https://www.hokonavi.go.jp/terms/) 明示與 CC BY 4.0相容。商用／修改／再散布原則有授權，第三方權利仍依 PDL 排除。
- 公開期限：頁面明示僅公開至 **2027-03-12**（公共交通開放資料挑戰2026期間）。這是來源公開期限；不能自動推論所有既有合法衍生作品必須該日下架。應保存當時授權、確認到期後更新與下載可用性。
- E=是；D=實際 ZIP URL及 MIME確認、PDF讀取成功，ZIP本次未解壓；L=條件式是；N=可轉換為候選導航骨架，拓樸／尺度／現場狀態尚未驗證。分類：**需轉換**。
- 信心：來源／授權高；現況／精度中低。

### S02 — MLIT ほこナビDP：新宿站周邊歩行空間網路（舊資料）

- 官方：[官方入口／說明](https://ckan.hokonavi.go.jp/dataset/nwd_shinjuku)
- link GeoJSON：[GeoJSON檔案](https://ckan.hokonavi.go.jp/dataset/18bc3f49-51b0-4d90-b0e2-afbdf142de29/resource/5abd6a98-2025-4323-b09d-ed4ea2ddf4aa/download/link.geojson)
- node GeoJSON：[GeoJSON檔案](https://ckan.hokonavi.go.jp/dataset/18bc3f49-51b0-4d90-b0e2-afbdf142de29/resource/462f206a-b231-419d-a8a8-1500760b3a02/download/node.geojson)
- 亦有 CSV nodes/links。dataset 說周邊範圍，完整 bbox、室內比率／樓層數本次未驗證。
- **資料內容日期2018-10-29**；catalog建2025-09-05、metadata更新2025-10-28。頁面指2024-07規格，不能把規格年份當測繪年份。
- PDL1.0（同上），可商用、加工、再散布但需出處／加工說明。精度未列。
- E=是 D=下載URL已解析、GeoJSON MIME可辨但未讀原始byte L=條件式是 N=需轉換＋現況重查。分類需轉換。信心來源高、現況低。

### S03 — 東京都都市整備局 2023 設施、形狀、出入口使用時間、路徑 GeoJSON

- 官方：[官方入口／說明](https://www.toshiseibi.metro.tokyo.lg.jp/kotsu_butsuryu/kotsuseisaku/kotsu_suishin/shinjuku_shisetsu)
- 下載入口：同頁「新宿駅周辺の施設情報及び施設から目的地への移動ルート情報（ZIP 2.2MB）」；精確二進位URL未取得，不能虛構。官方catalog：[官方入口／說明](https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000037)
- 規格資源：[官方入口／說明](https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000037/resource/a50b59ff-6d92-4ae6-b9cd-89ff6c7e11ca)
- 內容：設施位置、名稱、形狀、出入口利用時間；步行路徑及始終點資訊。GeoJSON（2.2MB ZIP）、488KB規格PDF、510KB參考PDF。
- 2023-02-28公開，基於2020-03資料更新。catalog索引更新2025-12-11，但不可當內容測量日期。
- 範圍「新宿駅周辺」；實際樓層／權利涵蓋的設施清單、精度、完整性均未解壓驗證。
- 授權：官方catalog的 CC BY4.0篩選結果含此項，惟原catalog讀取403，尚未完成 resource級條款核對。**列為高潛力待核，不給全面綠燈**。
- E=是 D=官網列出實際下載入口但原ZIP未取得 L=CC BY4.0索引證據／原頁核驗待完成 N=待檔案與空間範圍驗證。分類：需轉換候選（尚未准入）。

### S04 — JR東日本 新宿構內圖／無障礙

- 官方：[官方入口／說明](https://www.jreast.co.jp/estation/stations/866.html)
- 實際圖面：
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0866_1f.png)
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0866_2f.png)
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0866_b1f.png)
  - [PNG圖檔](https://www.jreast.co.jp/estation/stations/img/floormap/0866_all.png)
- 涵蓋JR B1/1F/2F、1–16月台、閘口、垂直動線和轉乘參考。PNG示意／立體導覽圖，不是量測3D，無測量精度或原始座標。原圖版次本次未確認。
- 條款 [官方入口／說明](https://www.jreast.co.jp/site/rules.html/) 第2項明列不允許圖片、文字等複製、轉用、電磁加工、傳送、散布、二次使用；不是開放資料授權。
- E=是 D=PNG可達 L=未授權公開再用 N=不能由可閱覽推成可合法3D tracing。分類：**僅供事實核對；原圖未授權禁止重製**。

### S05 — 京王線／京王新線 新宿構內與階層、電梯樓梯圖

- 官方：[官方入口／說明](https://www.keio.co.jp/train/station/ko01_shinjuku/)
- 實際PDF：
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_shinjuku.pdf)
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_shinjuku_floor_map.pdf)
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_newline_shinjuku.pdf)
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_newline_shinjuku_floor_map.pdf)
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_shinjuku_terminal_map.pdf)
  - [PDF檔案](https://www.keio.co.jp/train/station/station_map/pdf/ko01_shinjuku_elevator_map.pdf)
- 京王線樓層圖顯示1F/B1閘口/B2月台；新線B1閘口/B4轉乘/B5月台，連接大江戶線等。示意PDF，精度未列、無實測座標。
- 新線樓層PDF明示 **2026年3月末現在**。目前動線通知更晚：[PDF檔案](https://www.keio.co.jp/assets/pdf/dousen_shinsen.pdf) — 2026-09-16電扶梯啟用／10月中旬通路預定啟用（本次未核實完成）、2026-09-04起月台部分樓梯縮窄；動態與基圖必須分離。
- 條款 [官方入口／說明](https://www.keio.co.jp/contact/site/) 著作權節明列拒絕複製、加工、再散布、二次使用等。下載PDF不等於可追蹤描圖發布。
- E=是 D=是（PDF解析成功）L=無開放授權 N=僅現況／連接核對。分類參考／未許可禁重製。信心來源高、3D尺度未知。

### S06 — 小田急 新宿構內／POI

- 官方：[官方入口／說明](https://www.odakyu.jp/station/shinjuku/)
- 圖面入口：[官方入口／說明](https://www.odakyu.jp/station/shinjuku/homeview/)（本次一再timeout；首頁有同圖）
- 可達立體圖：[JPEG圖檔](https://www.odakyu.jp/station/data/o5oaa10000000k1h-img/shinjuku_all.jpg)
- 含小田急地上／地下月台、付費區／非付費區、南口及地下閘口、電梯無障礙線，店舖ATM和服務；精確建模尺度、標高與圖面版本未確認。官網南口→地上／地下月台電梯連接說明可用於核對。
- 官網公告2027-03（預定）中央地下JR連絡閘口改為IC專用；要作未來規則，不可當現況。
- 條款 [官方入口／說明](https://www.odakyu.jp/policy/) （文末2022-03）要求事前許可，禁止無許可複製、加工、傳送、二次使用。E=是 D=JPEG是 L=否（無許可）N=參考。分類參考／禁未許可重製。可信度：官方來源高，現況及導航精度未驗。

### S07 — 東京Metro丸之內線 M08 新宿

- 官方：[官方入口／說明](https://www.tokyometro.jp/station/shinjuku/index.html)
- 印刷圖／出口列表：[官方入口／說明](https://www.tokyometro.jp/station/shinjuku/yardmap/index_print.html)
- 圖：[JPEG圖檔](https://www.tokyometro.jp/station/yardmap_img/figure_yardmap_shinjuku_all.jpg)
- 僅Metro新宿M08；新宿三丁目M09/F13/S02須另列，不能合併為同站。JPEG構內立體圖與出口/附近POI/電梯停機網頁；測量精度與座標無。
- 首頁圖片alt有202505，但不能自動視為測量日期。抓取首頁的hidden/template出口欄位出現「大手町」，因此**不能直接把HTML抽取結果當新宿出口表**，應以印刷版／圖面核對。
- 條款 [官方入口／說明](https://www.tokyometro.jp/terms/index.html) 要求超出法律許可的使用、複製、再散布需許諾，沒有公開Web3D授權。E=是 D=JPEG是 L=無許可否 N=參考；圖像不得未許可複製。可信度：來源／條款高；確切版次及幾何精度未知。

### S08 — 都營 S01/E27 新宿 vs E01 新宿西口（分開）

- 新宿：[官方入口／說明](https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html?id=solid)
- 新宿西口：[官方入口／說明](https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku-nishiguchi.html)
- 官方兩站區別／轉乘示意：[官方入口／說明](https://www.kotsu.metro.tokyo.jp/subway/map/shinjyuku.html)
- 構內圖、出口、設備、店舗頁；本次未解析站內圖的原圖URL。圖面能瀏覽，非已核開放的GIS。圖面版次、完整樓層清單與數值精度本次未知。
- 站頁明示新宿線電梯1台／大江戸線2台、無障礙1路線確保；這是營運資訊，不可推論每個出口可無障礙通行。
- 官網footer明文：文書及圖像無許可使用／轉載禁止。此限制與本報告S01（E27室內資料）另行PDL授權並不矛盾，需分離資料來源。
- E=是 D=網頁圖可看、獨立原圖下載URL未核 L=無許可否 N=參考。可信度：官方來源與限制高；幾何、圖版時點及導航適用性未知。

### S09 — 新宿區最新跨業者 Terminal map／電梯與樓梯圖

- 最新官方入口：[官方入口／說明](https://www.city.shinjuku.lg.jp/kusei/toshikei01_002159_00001.html)
- 日英Terminal Map PDF：[官方入口／說明](https://www.city.shinjuku.lg.jp/content/000423320.pdf)（2頁，4.8MB）
- 日英電梯樓梯PDF：[官方入口／說明](https://www.city.shinjuku.lg.jp/content/000423322.pdf)（2頁，2.6MB）
- 官網明示圖面 **2025-11版**；頁面header卻寫2025-09-29，兩者不同。舊「新宿ターミナル協議會」2023-03-23已廢止，新圖轉「案内サイン連絡會」。
- 跨站／周邊商業建築的概念路徑、出入口、電梯／樓梯；無地理座標精度，不是BIM；不能認定所有空間均可供公眾24h穿越。
- 新宿區一般網站條款 [官方入口／說明](https://www.city.shinjuku.lg.jp/kusei/about.html) 明確禁未授權二次利用，個人非營利下載不等於平台商用。該區另有OpenData只適用明確列入之資料，不能泛推到本PDF。
- E=是 D1=官方PDF下載入口已核，本次未完成逐頁圖面及現況驗證 L=未授權 N=參考。分類參考／禁未許可重製。可信度：官方來源高，現況及導航精度未驗。

### S10 — 東京都交通局開放POI：駅構内のお店（新宿／新宿西口）

- 整體catalog：[官方入口／說明](https://catalog.data.metro.tokyo.lg.jp/dataset/t000018d0000000039)
- 新宿API說明：[官方入口／說明](https://spec.api.metro.tokyo.lg.jp/spec/t000018d0000000039-7612091588ade77cd214ea1f353f73da-0?lang=en)
- 新宿CSV：[CSV檔案](https://www.opendata.metro.tokyo.lg.jp/kotsu/other_stores_shinjuku.csv)
- 新宿西口API說明：[官方入口／說明](https://spec.api.metro.tokyo.lg.jp/spec/t000018d0000000039-e2375c546ff431bcecfd0205dc9187a9-0?lang=en)
- 新宿西口CSV：[CSV檔案](https://www.opendata.metro.tokyo.lg.jp/kotsu/other_stores_shinjuku-nishiguchi.csv)
- API頁列JSON/XML，CSV是源資料。設施名稱、設置地點文字、營業時間、locker大小/數量、電話、homepage等可支援搜尋；不能當精確室內座標。涵蓋都營資料，非整站所有商店。
- API metadata Data Last Updated=2025-01-30；較新catalog新宿西口resource搜索結果為2026-09-04，但原頁403。**不可保證API／CSV與catalog最新版本同步**。
- API明列CC BY但版本未在可讀API頁顯示；需讀取該資源實際CC版本。商用加工再散布可依CC BY，須署名，logos/photos不自動包含。
- E=是 D=官方實際CSV入口已找到但本次未讀取原始內容 L=CC BY確認（版本待核）N=可轉換搜尋POI，導航需定位。分類需轉換。可信度：來源高，資源級版次及導航定位待核。

### S11 — バスタ新宿（非新宿全站）

- 官方：[官方入口／說明](https://shinjuku-busterminal.co.jp/floormap/4f.html)
- 4F圖：[JPEG圖檔](https://shinjuku-busterminal.co.jp/images/floormap/4f.jpg)
- 其他floor入口：頁面連結3F高速bus下車／2F步行區與站設施。4F發車、有服務POI、電梯、樓梯。
- 更新日／測繪精度未列；JPEG示意無GIS。條款：[官方入口／說明](https://shinjuku-busterminal.co.jp/term/) 私用引用外，無事前承認不得複製或配信。
- E=是 D=JPEG是 L=無許可否 N=參考。分類參考／禁止未許可重製。可信度：官方來源高，現況及導航精度未驗。

### S12 — 新宿サブナード 地下街 POI／樓層

- 官方：[官方入口／說明](https://www.subnade.co.jp/floorguide/)
- PDF：[官方入口／說明](https://www.subnade.co.jp/pdf/floorguide/floorguide20260826.pdf)（1頁；**檔名含20260826不是獨立測量證明**）
- 範圍地下街四個區域、店舖、地上出口、B2停車場連絡口、電梯等；不是JR新宿站。店舖搜尋HTML、PDF示意無GIS精度。
- 條款：[官方入口／說明](https://www.subnade.co.jp/legal/) 限法律許可範圍內，超出私用無許可不可使用；未見open data。
- E=是 D=PDF是 L=無許可否 N=參考。分類參考／禁未許可重製。可信度：官方來源高，現況及導航精度未驗。



## R：池袋開放步行網路

### R1. MLIT ほこナビDP：池袋駅周辺步行空間網路

- **官方與原檔：**[資料集](https://ckan.hokonavi.go.jp/dataset/nwd_ikebukuro)、[link CSV](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/015aaf66-9c33-412e-873d-40dc0481ec6c/download/link.csv)、[node CSV](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/03792620-1a26-4d7f-85ea-b4e46043e5b9/download/node.csv)。另有[link GeoJSON](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/3a384823-0c28-4621-915f-4550537404a6/download/link.geojson)、[node GeoJSON](https://ckan.hokonavi.go.jp/dataset/324ba112-3bc0-4b9c-8a36-7d30edf4cf92/resource/f5d9a6e5-fd54-4b77-acd3-6f73e77676ff/download/node.geojson)。
- **範圍與格式：**池袋周邊node/link，CSV及GeoJSON；不是有明確逐層覆蓋表的完整站內資料。依[MLIT步行空間網路規格](https://www.mlit.go.jp/sogoseisaku/soukou/content/001757259.pdf)解讀欄位；CRS、序列化軸序及座標範圍應在實際選用格式再次確認。規格的淨寬、階差或坡度可能是級距，不能一律當精確連續測量。
- **日期與精度：**內容日期2019-01-28；資料集metadata更新2025-10-28，資源上傳2025-09-08，轉為2024-07規格。未核得本資料的獨立實測誤差報告。
- **本次小樣本解析：**link.csv 370,498 bytes、2,196筆資料列；node.csv 279,843 bytes、1,887筆。node的 `in_out` 全部為1（依規格為設施外），elevation全部空白。floor數值：0.0共1,852筆、1.0共7筆、-0.5共8筆、-1.0共12筆、0.5共8筆。這不等於樓層／拓樸已經現場核驗。link通行時段與維護日期等多個欄位為空，不能填成「全天有效」。本次沒有保存這兩份原CSV的hash，後續正式取得應補足可重現紀錄。
- **授權：**PDL1.0，依[站點條款](https://www.hokonavi.go.jp/terms/)及[PDL原文](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)附出處／加工聲明，可在適用範圍內商用、修改、再散布；不保證現況、完整性或永續供應。
- **判定：**E有／D2 CSV實讀／L附條件可／N可轉為周邊路網候選，不能稱為完整池袋室內導航；**需轉換**。來源與授權可信度高，現況／入口連接可信度未建立。

## X：共用搜尋、開放影像、街景與通用材質

### X1. ODPT 車站JSON：現行資料與舊API需分離

- **官方入口：**[開發者入口](https://developer.odpt.org/)、[Metro組織目錄](https://ckan.odpt.org/organization/tokyometro)、[Metro車站資料集](https://ckan.odpt.org/dataset/r_station-tokyometro)、[實際資源入口](https://ckan.odpt.org/dataset/r_station-tokyometro/resource/9a17b58f-9258-431b-a006-add6eb0cacc6)。API使用需依官方流程註冊取得key；本次未登入、未取API payload，實際生產API請求與回傳內容未驗證。
- **範圍／格式／日期：**Metro車站JSON可作池袋M25/Y09/F09、新宿M08等站名與路線識別候選；不代表完整出口、電梯、室內樓層或商店。統一內容更新日、API座標精度及本次payload涵蓋未知。
- **權利：**[公共交通開放資料基本授權入口](https://developer.odpt.org/terms/data_basic_license.html)及[官方授權說明投影片](https://challenge2025.odpt.org/materials/webinar01-01-3.pdf)說明可商用，但對原資料再散布及資料更新有特別要求。不是CC0／一般CC BY。發布前須核現行完整條款、註冊資格、指定出處、快取與JSON再散布方式；本次沒有因「開放資料」三字就判定可整包鏡像。
- **JR另列：**[JR East車站資料](https://ckan.odpt.org/dataset/jreast__r_station)標為Challenge2026限期授權；[Challenge條款入口](https://developer.odpt.org/challenge_license)。商用、改作、散布與保留期間必須依該項契約核對，不能套Metro Basic License。原始payload、站點精度與更新日期本次未知。東武／西武的現行相關API與資源級條款未在本次完成核驗。
- **重要缺口：**本次Metro組織目錄列10個資料集，未見獨立StationFacility。舊[2014 Metro API文件](https://tokyometroopendataapi.docs.apiary.io/)存在設施介面說明，不足以證明今日可呼叫或權利不變。
- **判定：**E車站資料有／D有註冊與資源入口，payload未讀／L特殊條件待完整核驗／N站點搜尋候選，室內graph未知；**需轉換候選**。存在證據高，產品准入與現況中低待核。

### X2. ODPT Metro 路線符號／站號圖示

- **官方及下載入口：**[圖像資料集](https://ckan.odpt.org/dataset/r_image-tokyometro)、[ZIP資源入口](https://ckan.odpt.org/dataset/r_image-tokyometro/resource/c7fdc672-c373-436c-bae2-f48a8a92b17b)。具體圖像使用條款在ZIP內PDF，本次未解壓核驗。
- **範圍／格式／日期：**Metro路線符號、站號圖示；ZIP。不是池袋或新宿構內地圖，不提供樓層或空間精度。內容更新日未知。
- **權利與判定：**E有／D1資源入口／L特殊條款未核，不能先認定商用改作散布全部可／N不適用導航幾何；**准入前僅參考**。可採中性自製文字標籤，待權利核清才使用官方圖示；不得自行改色或改比例後仍標稱官方標識。

### X3. OpenStreetMap

- **官方／實際取得入口：**[OSM](https://www.openstreetmap.org/)、[bbox匯出](https://www.openstreetmap.org/export)、[版權／ODbL](https://www.openstreetmap.org/copyright)、[Produced Work官方指引](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)。本次未匯出兩站區域，沒有把未知室內tag涵蓋寫成已存在。
- **範圍／格式／日期／精度：**可選池袋／新宿周邊道路、建物、入口、設施以及可能的indoor/level tags；OSM XML等。逐要素有編輯時間，但編輯日不是實測日；資料精度、最新施工狀態及室內完整性未知。
- **權利：**ODbL允許商用／修改，需署名；衍生資料庫的分享相同方式與提供義務，須和渲染產物的規則分開。獨立軟體程式不會僅因顯示OSM自動變成ODbL，但不能以檔案分開存放規避實際資料庫衍生關係。標準圖磚另受[服務使用政策](https://operations.osmfoundation.org/policies/tiles/)限制。
- **判定：**E平台／相關區域地圖有，特定室內要素未知／D1匯出入口，未取樣／L附條件可／N需轉換及逐段核對；**轉換候選**。授權證據高，兩站室內適用性未知。

### X4. Wikimedia Commons：三個已核個別授權的照片候選

檔案頁是作者與授權的第一手發布頁；實際下載入口為各頁的 **Original file**。下列不是完整站景套件。原圖解析度是像素規格，不是測量精度。

| 個別來源與下載入口 | 範圍／格式／時點 | 授權與商用、修改、再散布 | 精度、狀態與未知 |
|---|---|---|---|
| [池袋東口2023-11-09](https://commons.wikimedia.org/wiki/File:East_entrance_of_Ikebukuro_Station_2023-11-09.jpg) → Original file | 東口室外；JPEG，3793×2845，約1.39MB；拍攝2023-11-09，作者Asanagi | **CC0**；照片著作權層面可商用、修改及散布 | 可作入口辨識／參考照片；無實測尺度，非今日施工保證；D1原圖入口，未將原圖作素材發布 |
| [JR池袋中央改札2022-12-03](https://commons.wikimedia.org/wiki/File:JR_East_Ikebukuro_Station_Central_Gate_2_20221203.jpg) → Original file | 中央改札；JPEG，5328×4000，約3.09MB；拍攝2022-12-03，作者Mister0124 | **CC BY-SA4.0**；可商用及改作，保留署名／license／變更；改作照片遵守SA | 圖中室內區域不能推出完整樓層或尺度；舊照片不能證明當前閘口規則 |
| [小田急新宿第10月台照片](https://commons.wikimedia.org/wiki/File:Odakyu-Shinjuku-STA_Platform10.jpg) → Original file | 特定月台視角；JPEG；本次未完整核對拍攝日期、原圖像素與作者欄 | 檔案頁確認 **CC0** | 個別畫面，不是新宿站3D模型；後續取圖前補齊完整來源紀錄 |

三張均是E有、D1原圖入口、L依各檔條件可、N不能單靠照片生成精確導航；分類為**照片可條件直接使用／幾何僅參考**。授權頁可信度高；攝影者授權不自動處理畫面內人物、商標或其他被攝作品，抽出Logo或做招牌貼圖需另外檢查。

### X5. Mapillary

- **官方／取得入口：**[Mapillary地圖與影像入口](https://www.mapillary.com/app/)、[影像CC BY-SA說明](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data)、[網頁下載地圖資料說明](https://help.mapillary.com/hc/en-us/articles/4407521157138-Downloading-map-data-via-the-Mapillary-web-app)、[OSM相容／衍生資料說明](https://help.mapillary.com/hc/en-us/articles/115001777705-OpenStreetMap-compatibility)。
- **範圍／格式／時效：**平台有街景影像及部分GeoJSON地圖資料，但本次沒有核實池袋／新宿的特定image ID、拍攝日期、樓層、全景串連或地下覆蓋；不能列作已取得的室內街景。個別照片像素、座標精度與可用下載格式待選檔核驗。
- **權利：**官方說明影像CC BY-SA，需署名與適當改作條件；API、非影像資料、下載方式及衍生資料另有政策。不得把影像授權泛化至整個網站所有資料或無限制bulk API。
- **判定：**E平台資料有、兩站特定室內資源未知／D入口有、具體檔未核／L具體影像待選檔履行／N不明；**候選／參考**。平台政策可信度高，兩站覆蓋可信度尚未建立。

### X6. Poly Haven：可重用的通用建築材質

- **官方及實際下載入口：**[floor_tiles_06素材頁](https://polyhaven.com/a/floor_tiles_06)，頁面可選1K–8K、ZIP／Blender／glTF／MaterialX及個別貼圖；[官方授權](https://polyhaven.com/license)。本次未下載材質包，亦未下載其他站體模型。
- **範圍／格式／精度／日期：**通用地板磁磚PBR，作者Rob Tuytel；素材頁標示3m材質範圍。這是素材製作尺度，與池袋或新宿實際磁磚尺寸無關。精確發佈／更新日期本次未核，檔案大小隨解析度及格式變動。
- **權利：**素材CC0，可商用、修改及再散布；API與服務條款另計。作GTEki的示意表面可直接採用，必須避免宣稱是該站實測材質。
- **判定：**E有／D1下載選項已核／L素材可／N不提供導航資料；**通用素材可直接使用**。授權高可信，真實車站外觀符合度未知。
- **3D模型缺口：**除PLATEAU地下候選外，本次沒有核實另一套更完整、現況可靠且可合法再散布的池袋／新宿全站模型。不要以網路預覽或可購買模型頁代替資源級授權與範圍驗證。

### X7. Google Maps／Street View：不作可再散布建模原料

- **官方與條款：**[Google Maps](https://www.google.com/maps)、[Maps／Earth附加條款](https://www.google.com/help/terms_maps/)（頁面標示2026-01-27更新）。
- **範圍／取得：**服務可展示地圖與影像，但本次未盤點兩站影像日期或室內樓層；沒有找到供GTEki抽出、重製並再散布的開放原始影像／導航資料下載授權。觀看入口不是開放素材下載入口。
- **商用／修改／再散布：**條款對複製、再散布、大量下載、由內容建立或擴充地圖／導航／POI產品有約束。沒有特別書面授權時，本案不將其截圖、街景影像、幾何或POI擷取成果作發布資料。
- **判定：**E服務有／D0所需開放原料／L所述用途不具授權／N排除資料管線；**禁止依現有條款擷取重製為本案原料**。這不表示一切正常瀏覽或合規官方嵌入都被禁止。

## 本次證據與限制紀錄

- 已直接讀取兩站PLATEAU API及兩份metadata ZIP；池袋related POI小ZIP；池袋兩份步行CSV；豊島區三份POI CSV；部分官方小圖與確認PDF。
- 已找到地下CityGML的官方單檔URL，但未下載或解析；沒有完成Blender／Three.js／Godot匯入測試。
- 部分G空間及東京都目錄回403；報告保留官方入口、可驗證的替代官方API，以及未知的ZIP／授權欄位。未繞過登入、驗證或存取限制。
- 原圖可讀、原檔可下載、可合法改作與可導航四種證據始終分開。沒有查到不等於不存在；未知欄位不以推測補全。
- 中繼資料的相互矛盾日期、HTTP時間與內容年代均原樣區分；沒有把抓取日、網站footer年份或圖片解析度當成測繪現況或空間精度。
- 本報告的下載URL與授權判定以查核日為準。後續取得／發布前，應核對同一資源版本及條款，不以本研究的靜態URL替代版本管理。