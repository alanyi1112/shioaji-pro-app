## Context

現有 `isEligibleTaiwanEquity` 只接受 `quoteType=EQUITY`，`taiwanChipEligibility` 再以此集合過濾 TDCC 全市場快照，因此 ETF 即使上游有法人、融資券、外資持股、借券或股權分散資料，也會在進入 adapter 前被排除。API 已具備 dataset 層級的 `availability`，但 top-level eligibility 仍造成 all-or-nothing 行為。

股權分散目前只自 TDCC `GET /v1/opendata/1-5` 取得最新週快照。D1 schema 已可依 `symbol + dataDate` 冪等保存多週資料，但正式站尚未匯入上線前的合法歷史，因此長日期範圍通常只有單一資料點。前端則把持股比例本身畫成 Histogram，沒有獨立呈現比例趨勢與週增減。

本變更必須維持 Codex Sites／Cloudflare Workers 相容、D1-first、全市場 TDCC single-flight、token 只存 runtime secret、A／B 副圖模式及既有普通股行為。

## Goals / Non-Goals

**Goals:**

- 讓 TWSE／TPEx 的普通股與 ETF 依資料族群能力載入籌碼，不再因 `quoteType=ETF` 全面拒絕。
- 保留 top-level 相容欄位，新增可測試的 dataset eligibility／availability，使部分可用不會拖垮整個 response。
- 由免費且允許自動介接的 TDCC 官方來源回補可取得的週歷史，並持續累積新快照。
- 以週頻比例線圖與週變化柱狀圖呈現大戶／散戶，清楚揭露頻率、級距、日期與來源。
- 在單一快照、部分資料、歷史不足及上游失敗時提供誠實且可理解的降級狀態。

**Non-Goals:**

- 不把 TDCC 週資料 forward-fill、插值或複製成每日大戶／散戶資料。
- 不把 ETF 成分股持股變化誤當成 ETF 受益人股權分散；本功能只處理 ETF 證券本身的籌碼與集保持有級距。
- 不要求 FinMind sponsor／付費資料才能完成必要功能，也不在瀏覽器或 repo 內保存 token。
- 不新增八大行庫買賣超、不改變技術指標計算與 A／B 模式政策。

## Decisions

### 1. 以資料族群能力矩陣取代 all-or-nothing eligibility

商品目錄先判斷是否為啟用中的 TWSE／TPEx `.TW`／`.TWO` 普通股或 ETF；通過後，再為每個 dataset 建立 `supported`、`reason` 與候選 providers。API 保留 `eligible` 供舊前端判斷台股證券整體適用性，並新增 `datasetEligibility`；實際是否有指定日期資料仍由既有 `availability` 回報。

普通股與 ETF 都可嘗試 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending`、`shareholder-distribution`。來源沒有該 ETF 或該日紀錄時，只將該 dataset 標示 `not_published`／`unavailable`，不得把缺值補零，也不得阻止其他 dataset 回傳。

替代方案是把 ETF 整體改成 eligible 後沿用單一布林值；此作法仍無法區分「商品支援但某資料族群沒有紀錄」，因此不採用。

### 2. TDCC 最新快照與歷史回補使用同一正規化／驗證邊界

保留最新全市場 OpenAPI single-flight，並新增受保護的 TDCC history adapter。history adapter 只能呼叫可直接取得、免費且允許自動介接的官方歷史匯出／檔案；不得以模擬瀏覽器、繞過限制或未授權爬取實作。每個歷史檔先驗證資料日期、證券代號、分級 1 至 17 唯一性、有限數值與合計，再沿用既有 `DistributionRow` 正規化與 D1 upsert。

歷史同步以資料日期為工作單位，並以 market-wide single-flight／ingest state 防止多個 panel 重複下載。請求早於官方免費保存範圍時，coverage 回報真實起日及 `history_not_archived`；history adapter 暫時不可用時，繼續使用 D1 已累積與最新快照。

替代方案是直接使用 FinMind `TaiwanStockHoldingSharesPer`；目前免費層無法保證可用，會讓必要功能依賴付費方案，因此只可作未來可選 provider，不作本變更必要路徑。

### 3. D1 優先重用現有週資料模型

優先重用現有 `symbol + dataDate` 股權分散唯一鍵與 dataset state。只有在實作確認無法表達「歷史匯入範圍／最近嘗試／失敗退讓」時才新增 migration；任何 migration 只增加欄位、table 或 index，不改寫及不刪除既有 rows。

歷史回補先讀 coverage，只請求缺口；相同 `dataDate` 重匯必須冪等。ETF 與普通股共用同一全市場快照，但分別保存各自 symbol rows。

### 4. 大戶／散戶使用比例線與週變化柱的複合 pane

每個 holder pane 建立兩個 series：

- 比例線：顯示該 TDCC 級距加總的 `ratioPercent`，以百分比 price format 呈現。
- 週變化柱：顯示本週比例減前一個實際發布週比例的百分點；增加用台股紅色、減少用綠色、零值用中性色。

兩個 series 只使用 TDCC 真實 `dataDate`，不為中間交易日補值。第一筆沒有前週基準時不畫變化柱，並顯示「首筆／無前週比較」；即使只有一筆，UI 仍以比例讀值、資料點標記及明確狀態讓使用者知道資料存在。hover 同時顯示比例、週增減、張數、人數、門檻、日期與 provider。

替代方案是繼續以柱色表達比例增減；單一柱難以辨識，且比例值與變化量混在同一視覺語意，因此改採線柱分工。

### 5. 前端以 dataset 狀態決定 ETF pane，不隱藏整組籌碼

ETF 日 K 可選取所有既有籌碼項目；pane 請求後依 dataset 的 `datasetEligibility` 與 `availability` 顯示可用、無紀錄、部分、過期或來源不可用。某 dataset 不支援時只清除該 pane series，其他 pane 與技術副圖保持運作。選單與 pane 必須標示「TDCC 週資料／週變化」，避免被理解為每日大戶變化。

## Risks / Trade-offs

- [TDCC 歷史匯出格式或可自動介接方式變動] → 將 history adapter 與 parser 分離，以 fixture／schema 驗證 fail closed；無法確認時只保留最新快照與 D1 累積資料。
- [ETF 並非每個交易日都有所有籌碼紀錄] → dataset 層級回報 unavailable／not_published，不把缺值當零，也不阻擋其他資料族群。

## TDCC 歷史來源確認紀錄（2026-07-16）

- TDCC 官方 `GET https://openapi.tdcc.com.tw/v1/opendata/1-5` 為可直接介接的「集保戶股權分散表」OpenAPI，但回應只包含目前最新週快照。
- TDCC 官方查詢頁 `https://www.tdcc.com.tw/portal/zh/smWeb/qryStock` 明載歷史資料保存一年，表單 `POST` 至同一路徑，並含 `SYNCHRONIZER_TOKEN`／`SYNCHRONIZER_URI`；此頁未提供可證明允許自動介接的 API 契約。
- 因此本變更不以模擬瀏覽器、保存 cookie 或重播同步 token 方式擷取歷史頁。`createTdccHistoryAdapter` 預設回傳 `history_source_unverified`，只有注入已驗證的 batch source 才會解析；正式資料鏈使用 OpenAPI 最新快照與 D1 逐週累積。
- 受保護的 `/api/internal/tdcc-shareholder-distribution` 只接受明確標示為 `tdcc-official-openapi-1-5` 的完整 17 級距 payload，沿用現有 ingest secret 驗證、全市場解析、`symbol + dataDate` 冪等 upsert 與 coverage 更新；不得把一般歷史頁 HTML 當成輸入來源。
- [一次回補一年全市場資料增加 Worker 時間與 D1 寫入量] → 受保護分批 ingest、日期 single-flight、批次 upsert、coverage 缺口查詢及 negative cache。
- [比例線與變化柱尺度不同導致誤讀] → 使用獨立 price scale／scale margins、明確 `%` 與 `百分點` formatter、文字 legend 與 hover 讀值。
- [只有一筆歷史時仍無法形成趨勢] → 顯示單點標記與「首筆／歷史累積中」，不得繪製假的水平線或每日柱。

## Migration Plan

1. 先加入 dataset capability matrix、ETF parser／service contract 測試及相容 API 欄位，不改前端顯示。
2. 加入 TDCC ETF 最新快照解析與歷史 adapter／受保護 ingest，必要時套用 additive D1 migration，回補官方免費可用範圍。
3. 更新 holder pane 為比例線＋週變化柱，加入 ETF partial availability 與單點狀態。
4. 執行 build、完整測試、migration 檢查、OpenSpec strict validation，並於已登入正式站驗收普通股與 ETF。
5. 若發布失敗，回滾應用版本；已匯入的合法 D1 週 rows 保留，舊版會忽略新增欄位／狀態，不需刪除資料。

## Open Questions

- 實作時需再次確認 TDCC 官方歷史匯出的穩定 URL、日期參數、檔案格式與自動介接授權；若任一項無法證明，該 adapter 必須 fail closed，改以最新 OpenAPI 每週累積。
- 各 ETF 在 TWSE／TPEx 官方 fallback 的實際欄位覆蓋可能不同， capability matrix 以 fixture 與正式 response 驗證結果為準，不預先宣稱每一檔 ETF 的每個 dataset 都有資料。
