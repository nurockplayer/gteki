# 現地記錄：Owner 隨身說明

更新：2026-11-03 18:19 JST。路線：[池袋](ikebukuro-route.md)／[新宿](shinjuku-route.md)；資料規格：[receipt-format.md](receipt-format.md)。

## 要帶什麼

- 充飽電的手機；長時間步行請帶行動電源。先在線上開啟正式網站的 `/field.html`，等「オフライン準備完了 / Ready for offline reload」出現，再斷網重新整理，確認頁面仍能開啟。兩站路線都已包含在離線副本內；開發伺服器不提供這個離線副本。
- 先把本站路線存成可離線閱讀的檔案，或使用頁面的「手順を読む / Stop instructions」。不要清除瀏覽器網站資料；記錄會自動存於目前手機、目前瀏覽器，換裝置不會跟著過去。
- 若要記距離或段差，帶尺或用步測並註明估測。只走公共區域、不擋通行、不進員工門、不詢問站務員；只有路線明列的付費段才準備有效車票。招牌照片僅留私人佐證，不交進 JSON、不提交照片或姓名。

## 怎麼記錄一站

1. 在「Station」選「池袋 / Ikebukuro」或「新宿 / Shinjuku」，核對停點 ID（例如 `IK-01`、`SJ-02`）。用「← 前 / Prev」與「次 / Next →」移動；展開「手順を読む / Stop instructions」看本站問題。
2. 按「＋ 記録 / Add record」。在「対象 ID / Target (or free text)」填路線中的實際節點／邊 ID，例如 `IK-01` 的 `w_c`、`IK-02` 的 `w_cj`。頁面會顯示「Known node」、「Known edge」或「UNKNOWN — free text / 未照合」。沒有 ID 時寫實際地點名稱並補充位置；新宿 `SJ-01`、`SJ-02` 的路線沒有提供圖節點 ID，不要猜 ID，也不要把停點 ID 當節點 ID。
3. 「項目 / Item (optional)」選這筆回答的原項目，例如 `IK-01` 的 `1`、`IK-02` 的 `4`、`SJ-01` 的 `FC-CH-01`、`SJ-02` 的 `39`。不同問題另加一筆；不要自行編數字。「左右 / Side」以沿路線前進、面向觀察目標時的左右為準，選「Left / 左」、「Right / 右」或 `n/a`。「距離 m / Offset m」填從具名參考點到觀察點的公尺數；在「補足 / Note」寫參考點、面向方向與量測／步測方式，不知道就留空。
4. 「読んだ文言 / Observed text」逐字抄實際讀到的文字；「階 / Floor label」抄樓層牌，不推測。段差填在「段差 / Step-free (level, steps:<n>, lift, escalator)」：平面 `level`、三級 `steps:3`、升降機 `lift`、電扶梯 `escalator`；未確認留空。設備服務樓層、開門方向、時段與位置關係寫在「補足 / Note」。
5. 若觀察商店入口，在「店舗 / Store POI (optional)」選實際店家；「改札内外 / Fare side」選「Free / 改札外」、「Paid / 改札内」或「Unknown / 不明」。只有確實看到入口與站內開口的直接關係才能確認連接，附近有店名不算。
6. 「観察時刻 / Observed at (JST +09:00)」新增時自動填日本時間；核對手機時鐘，補登時改成實際觀察時刻，保留 `+09:00`，例如 `2026-11-03T11:00:00+09:00`（JST）。每筆都要有「読んだ文言 / Observed text」；不知道牌文時填未讀到的原因。
7. 門關閉、找不到或看不清時，記錄搜尋位置、已讀告示與原因，保留「OPEN — unsure / 未確認」。只對已檢查的門寫「未見入口」；不要推論整棟無入口，不穿越閘門或封鎖線。「CLOSED — confirmed / 確認済み」只在該項完整確認後選；匯出仍須同時具備數字項目、已知節點、Store POI 與已知 Fare side 才會成為可套用的 `CLOSED`。其他確認會保留在附加欄位，receipt 仍是 `OPEN`。
8. 確認「この端末に自動保存 / Saved on this device」。進度的「stops with notes」只表示有筆記，不表示問題全部完成；匯出後筆記仍留在手機。

## 怎麼把 JSON 交回

每站各按一次「JSON を保存 / Export station JSON」，到手機下載檔案夾確認有 `YYYY-MM-DD-ikebukuro.json` 或 `YYYY-MM-DD-shinjuku.json`（日期為 JST）。同站匯出會包含該站所有已存筆記，不只目前停點；兩站要分別匯出。遇到「JSON saved. Notes remain on this device.」仍要確認檔案確實下載。

每站至少一筆必須選數字項目，才能匯出；FC／未指定項目會一起放在 `fieldNotes`。因此只記 `SJ-01` 的 FC 問題還不能匯出，記到 `SJ-02` 的數字項目後再匯出；不要為了下載虛構數字或觀察內容。匯出錯誤會指出停點；修正時刻、段差格式或空白牌文後再按匯出。

把兩個 JSON 原檔透過本次任務的交付管道交給 lead，附上未完成／受阻項目；收到的原檔留在 repo 外，例如 `~/Downloads/field-incoming/`。**不要先複製到 `docs/research/field/receipts/`**：那是 ingest 自行管理的每日封存目錄，正式匯入時會自動封存；預先放入會讓同一份記錄被重複合併。不要交照片。lead 核對後，在 repo 根目錄執行以下命令（把 `YYYY-MM-DD` 換成檔名日期）：

```sh
pnpm field:ingest ~/Downloads/field-incoming/YYYY-MM-DD-ikebukuro.json --dry-run
pnpm field:ingest ~/Downloads/field-incoming/YYYY-MM-DD-shinjuku.json --dry-run
```

非公開 receipt（檔名以 `-private.json` 結尾）匯入時必須加上 `--private-root <gteki-private repo 根目錄>`；這類檔案絕不可放入 public repo。

成功結尾是 `dry run: no files written`；若報未知 ID、樓層不符、重複或未來時刻，交由 lead 核對原筆記，勿猜改。dry-run 通過後由 lead 移除 `--dry-run`，執行相同命令正式匯入；只有 `CLOSED` 會套用到站內資料，同份 receipt 的 `OPEN` 與 `fieldNotes` 會一起封存。**全為 `OPEN` 的 public receipt 目前回報 `applied 0 CLOSED items`，不寫站內資料，也不建立封存；務必保留收到的原檔供後續處理。** Owner 不必在手機執行 ingest。

## Lead 本機演練：build、離線與非公開停點

正式網站以外的本機演練，須使用 production build；`pnpm dev` 不提供離線副本。在 repo 根目錄安裝鎖定的依賴後，用同一個 `orb-test` host run build 並啟動 preview；瀏覽器開啟 `http://127.0.0.1:5287/field.html`。完成後以 Ctrl-C 停止自己啟動的 preview。

```sh
pnpm install --frozen-lockfile
orb-test --heavy --host -- sh -c 'pnpm build && pnpm --filter @gteki/web preview --port 5287 --strictPort --host 127.0.0.1'
```

Playwright 演練亦把 scratch script 放在 `.qa/field-e2e/`，經 `orb-test --heavy --host -- <command>` 執行；由同一支 script 完成 build、preview 啟停與 browser，三者共用一次 heavy lock。使用手機 viewport、首次連線載入、等「Ready for offline reload」後 `context.setOffline(true)`，再 reload、記錄與下載。不要直接用 `file://` 開啟 HTML；service worker 需要 localhost 或 HTTPS。兩站各匯出一次，核對 stop 數及下載檔內容；synthetic 筆記一律標 `REHEARSAL`。

非公開資料只在可丟棄的 private worktree 操作，絕不放進 public commit、PR、截圖或 review 輸入。以 `$GTEKI_PRIVATE_DIR` 指向該 private repo 根目錄，先執行 `node "$GTEKI_PRIVATE_DIR/tools/build-overlay.mjs" <gteki root>`，把 private additions（包含 `additions/<station>/field`）複製到 overlay，再執行 `pnpm build:private`。這與 private deploy 的準備順序相同；host run 使用 host 絕對路徑，orb-test container 內同一份 worktree 的路徑是 `/w/.priv`。

```sh
rtk git -C ~/Developer/gteki-private worktree add --detach "$(pwd)/.priv" origin/main
orb-test --out .priv/overlay --out apps/web/dist --env GTEKI_PRIVATE_DIR=/w/.priv -- sh -c 'node /w/.priv/tools/build-overlay.mjs /w && pnpm build:private'
export GTEKI_PRIVATE_DIR="$(pwd)/.priv"
```

Recorder 停點來自 private repo 既有的 `additions/<station>/field/private-stops.json`；上述 private builder 會將它複製至 `overlay/<station>/field/private-stops.json`，不必另造演練停點。檔案內容為陣列，每筆具有 `id`、`title`、`after`、`items`、`ids`、`instructions`；此處僅列欄位名稱，不收錄 private 內容。完成 private build 後啟動 preview：

```sh
orb-test --heavy --host -- pnpm --filter @gteki/web preview --port 5288 --strictPort --host 127.0.0.1
```

非公開 preview 使用另一個 port，避免沿用 public 版本的 service worker。等待離線準備完成後斷網，確認停點顯示「非公開 / Private」，再記錄、匯出。非公開停點可以只有 GAP／未指定筆記而無數字項目；下載的 `*-private.json` 具有 `private: true`，不會混入 public receipt。這是前述 public 數字項目規則的例外。

在正式 write 前後各執行 `pnpm coverage:matrix --check` 並比較輸出的列。`--check` 的 drift 是報告，不會令 exit status 失敗；`OPEN`／fieldNotes 不會使 public coverage 增加，private write 亦不會改變 public matrix。新宿的 `CLOSED` write 會重跑 E27 importer 與 surface bake，須備有原始資料（預設 `~/Developer/gteki-raw/shinjuku`，或指定 `GTEKI_RAW_SHINJUKU`；container 須另將資料放入 worktree）。演練後還原所有 synthetic receipt 封存及站內生成檔，移除 private worktree 與 scratch；synthetic 資料不得提交。
