## Context

目前每個圖表面板由主 K 線圖與一個技術指標副圖組成，`/api/candles` 同時回傳 K 線、報價、指標與資料視窗；前端會在使用者向左載入歷史時延伸資料，並同步主副圖的時間軸與十字線。Sites D1 已保存 K 線快取、使用者清單、商品目錄與 TPEx 官方鏡像，Worker 也已有全市場請求快取、single-flight、保守 fallback 與安全 reason code 的實作模式。

本次資料包含盤後日頻個股籌碼與 TDCC 每週股權分散快照，不是即時行情。官方來源在上市與上櫃的欄位、發布時間、歷史查詢方式及授權邊界不同；免費歷史 API 也可能有 token、流量與資料修訂限制。介面必須清楚區分「每日買賣超」、「實際外資持股」、「信用／借券餘額」與「依集保持股級距加總的市場大戶／散戶稱呼」，不能把不同語意、頻率或尺度混在同一條線上。

## Goals / Non-Goals

**Goals:**

- 為上市與上櫃普通股建立可追溯、可快取、可增量更新的日頻籌碼與週頻股權分散資料模型。
- 以獨立同源 API 按 symbol 與日期範圍提供資料，並與既有 K 線歷史視窗協調。
- 支援外資、投信、自營商、三大法人合計、外資持股、融資、融券、借券、大戶持股及散戶持股等可獨立選取的籌碼 pane，保持時間軸、十字線與多圖 lifecycle 一致。
- 新增 3 圖版面，並讓 1／2／3 圖支援單一 pane 的方式 A 與多 pane 堆疊的方式 B；4／6／8 圖維持方式 A。
- 保存 A／B 偏好與各 panel 的選擇，跨圖數、頁籤與 panel 重建時不意外清除使用者設定。
- 使用 D1 避免每個 panel 重複抓取上游，並在來源失敗時保留最近一次驗證成功資料與明確狀態。
- 確保所有上游 token 只存在 Sites runtime 或受保護的同步環境，前端、repo、OpenSpec、log 與 response 均不含秘密。

**Non-Goals:**

- 不提供盤中即時三大法人、即時融資券或券商分點資料。
- 不提供八大行庫買賣超；此指標依賴券商／分點資料、版本化名單與額外授權來源，留待後續獨立 change 處理。
- 不涵蓋 ETF、權證、興櫃、指數、期貨、海外股票及其他非上市／上櫃普通股商品。
- 不提供投信持股比或自營商持股比，也不從買賣超累加推估這些持股。
- 不把 TDCC 級距稱為已確認身分的法人、自然人、關係人或實質受益人，也不提供券商分點大戶定義。
- 不宣稱免費來源能立即提供超過 TDCC 官方可用期間的多年股權分散歷史；較早週資料只在有合法 archive 或 D1 已累積時顯示。
- 不在第一版把日資料重新聚合為週 K／月 K 籌碼；非 `1d` 週期只顯示不適用狀態。
- 不把既有 RSI、KD、MACD、ATR 技術指標拆成獨立 pane；A／B 只管理本次新增的籌碼副圖。
- 不在第一版提供籌碼 pane 拖曳排序；方式 B 依選單的固定順序排列。
- 不以未經允許的 TWSE／TPEx 一般網頁自動爬取作正式資料鏈，也不承諾免費第三方 API 永久維持相同額度。

## Decisions

### 1. 以商品目錄判定普通股資格

只有商品目錄標示 `quoteType=EQUITY`、exchange 為 `TWSE` 或 `TPEx`，且 canonical symbol 分別以 `.TW` 或 `.TWO` 結尾時，籌碼 API 與副圖才視為可用。不能只依 suffix 推定，避免 ETF、權證或人工輸入的錯誤 symbol 誤用普通股張數語意。

替代方案是讓所有 `.TW`／`.TWO` 都嘗試查詢；此作法會混入 ETF 與其他不同交易單位商品，因此不採用。

### 2. 使用獨立 `/api/taiwan-stock-chip`，不擴大 `/api/candles` payload

新增 `GET /api/taiwan-stock-chip?symbol=<symbol>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>`。前端只有在使用者選取籌碼副圖且商品／週期適用時才請求，日期範圍使用目前已載入 K 線的最早與最晚 `sessionDate`。單次回傳最多 2,600 個交易日；更早歷史隨 K 線向左載入再分段取得。

Response 至少包含：

- `symbol`、`exchange`、`interval: "1d"`、`eligible`、`availability`。
- `rows[]`，每列以 `sessionDate` 為主鍵，指標欄位可為數字或 `null`。
- `coverage`，包含最早／最晚日期、各資料族群完整度及是否仍可向前載入。
- `sources[]`，包含 provider、dataset、sourceUpdatedAt、fetchedAt 與狀態，不含秘密或完整上游錯誤。
- `cache` 與 `warnings[]`，使用穩定 reason code，例如 `unsupported_instrument`、`unsupported_interval`、`not_published`、`partial_data`、`rate_limited`、`provider_unavailable`、`stale_cache`。

替代方案是把所有籌碼資料塞進 `/api/candles`；這會讓海外商品、未選取籌碼的 panel 與背景預取都付出額外成本，因此不採用。

### 3. 採資料族群 adapter 與逐欄來源 provenance

Worker 將來源拆成 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending`、`shareholder-distribution` 五個 adapter。前四組歷史回補可使用依個股與日期範圍查詢的免費 API；最新資料優先使用允許自動介接的 TWSE／TPEx OpenAPI 或政府開放資料。`shareholder-distribution` 使用 TDCC `GET /v1/opendata/1-5` 或同資料集的官方開放 CSV，一次取得全市場同一資料日期的週快照並保存 provider、dataset 與資料日期。若某一資料族群失敗，其他族群仍可回傳。

第一版允許設定 `FINMIND_API_TOKEN` 提高歷史查詢額度，但 token 為可選；未設定時使用上游允許的匿名額度與更保守的範圍／重試。正式資料鏈不得呼叫需要模擬瀏覽器或規避限制的一般網頁端點。

來源 payload 先經 adapter 正規化，再通過日期、symbol、有限數值、合理比率與欄位完整度驗證。任何欄位都要能追溯到來源 dataset；不同來源合併時不以較舊資料覆蓋較新且已驗證資料。

TDCC adapter 必須依官方欄位名稱解析持股分級 1 至 17，確認同一證券與資料日期沒有重複分級。分級 1 至 15 為持股級距、分級 16 為差異數調整、分級 17 為合計；16 與 17 只用於驗證與顯示總量，不得加入大戶或散戶級距。

### 4. 內部保存股數，普通股顯示時才換算張數

三大法人買賣超與持股、借券資料在 D1 與 API 使用整數股數；普通股 UI 以 `shares / 1000` 顯示張數，可保留一位小數以容納零股。`institutionalTotalNetShares` 必須在外資、投信與自營商合計都有效時才計算，且等於三者相加；若來源同時提供三大法人總計，adapter 必須用它交叉驗證，差異未釐清時標示該日資料不完整。融資融券官方欄位若原始單位已是交易單位，adapter 必須先依 dataset 定義轉成一致的 `lots` 欄位，並在 provenance 保存原始單位。

`0` 只代表來源明確發布零值；缺欄位、未發布或不適用一律使用 `null`。外資持股比使用百分比數值，不與買賣超或餘額共用價格尺度。

TDCC 股權分散內部同樣保存整數股數、人數與官方 `占集保庫存數比例%`。預設散戶為分級 1 至 3，即 1 至 10,000 股；預設大戶為分級 15，即 1,000,001 股以上。UI 可沿用市場慣稱「1,000 張大戶」，但 label 或說明 MUST 揭露實際下界為 1,000,001 股，不能宣稱包含剛好 1,000,000 股。可調門檻只接受官方級距可精確組成的選項，不能對任意數字做線性拆分。

### 5. D1 以日列保存正規化資料，局部 upsert 不清空其他族群

在 `db/schema.ts` 新增：

- `taiwan_stock_chip_daily`：以 `(symbol, session_date)` 為複合主鍵，保存 exchange、法人買賣超股數、外資持股股數／比率、融資融券流量／餘額、資券互抵、借券與借券賣出欄位、各族群來源 JSON、完整度 JSON、來源更新時間及資料列更新時間。
- `taiwan_stock_chip_fetch_state`：以 `(symbol, dataset)` 為複合主鍵，保存已覆蓋起訖日期、最近成功時間、最近嘗試時間、可重試時間與安全 reason code。
- `taiwan_stock_shareholder_distribution`：以 `(symbol, data_date)` 為複合主鍵，保存 exchange、分級 1 至 15 的已驗證 levels JSON、分級 16 差異調整、分級 17 合計人數／股數、來源比例、provider、來源更新時間及資料列更新時間；levels JSON 是正規化結構，不保存未驗證的原始上游 payload。
- `taiwan_stock_chip_fetch_state` 對 `shareholder-distribution` 另保存最新全市場快照日期、最近成功時間、retry 時間與安全 reason code；此 dataset 的抓取鍵不是逐 symbol 歷史 range。

每個 adapter 只更新自己擁有的欄位與 provenance；不得用 `null` 覆蓋其他 adapter 已寫入的資料。實作需由 Drizzle 產生 migration，並在 runtime `ensureDb` 以每個 `prepare()` 一個 SQL statement 的方式保持新舊 deployment 相容。

替代方案是每次把完整上游 JSON 存成 blob；雖然初期較快，但不利日期範圍查詢、局部更新、來源合併與索引，因此不採用。

### 6. D1-first、缺口回補、single-flight 與節流

API 先查 D1，依 `fetch_state` 判斷請求範圍是否有缺口或過期。前四個 dataset 只有缺口才呼叫上游，且相同 `symbol + dataset + range` 共用 single-flight。`shareholder-distribution` 不逐 panel 抓個股，而是由每週受保護同步一次下載 TDCC 全市場最新快照；必要的即時補抓也只允許全站共用一個 `dataset + source data date` single-flight。成功資料批次 upsert 後重新由 D1 組 response；429、timeout 或供應者失敗會寫入短期 retry state，避免多 panel 同時重試。

若 D1 已有部分或過期資料，上游失敗時仍回傳舊資料並標示 `stale_cache`／`partial_data`；完全沒有資料才回傳可診斷的 unavailable 狀態。背景預取不得自動抓取所有商品的籌碼，只能對目前可見且已選取籌碼副圖的 panel 工作。

排程更新沿用既有受保護同步模式：private workflow 可在盤後抓取允許介接的官方資料，驗證日期、筆數、重複代號與數值後，使用 Sites bypass 與獨立 ingest secret 寫入內部 endpoint。上游秘密及 bypass token 不得出現在 payload、log 或 repo。

TDCC 週快照同步必須驗證全檔資料日期一致、每個納入的證券具唯一分級、分級 17 合計與分級資料可合理核對，再以同一資料日期冪等 upsert。官方 OpenAPI 主要提供最新快照，因此首次上線只保證合法取得的 history 與之後由 D1 累積的週資料；一般個股查詢頁即使可人工查看一年歷史，也不得在未確認允許自動介接前用爬蟲回補。

### 7. 以 pane registry 定義可獨立顯示的籌碼項目

現有技術指標副圖保持不變；每個 panel 另加入 `chip-pane-stack`。前端以固定順序的 pane registry 定義十個 leaf view，資料族群與顯示 pane 分離：

1. `institutional-foreign-flow`：外資每日買賣超。
2. `institutional-trust-flow`：投信每日買賣超。
3. `institutional-dealer-flow`：自營商每日買賣超，讀值分列自行買賣與避險。
4. `institutional-total-flow`：三大法人合計每日買賣超，讀值分列三個組成項。
5. `foreign-holding`：外資及陸資持股比率，讀值同時顯示持股股數。
6. `margin`：融資餘額與當日增減，讀值顯示買進、賣出及償還。
7. `short`：融券餘額與當日增減，讀值顯示買進、賣出、償還及資券互抵。
8. `securities-lending`：來源實際提供的借券成交、借券餘額或借券賣出餘額。
9. `big-holder`：TDCC 大戶持股百分比柱狀圖，預設分級 15。
10. `retail-holder`：TDCC 散戶持股百分比柱狀圖，預設分級 1 至 3。

同一資料族群可供多個 pane 共用，例如四個法人 pane 共用 `institutional-flow` response、融資與融券共用 `margin-short` response、大戶與散戶共用 `shareholder-distribution` response。pane 的建立或移除不得導致相同 `symbol + dataset + range` 重複抓取上游。

正負買賣超遵循台股既有紅漲綠跌語意，另以線型、label 與讀值確保不只靠顏色辨識。大戶／散戶柱高代表當週 `占集保庫存數比例%`，顏色代表與前一筆實際發布週資料相比的方向：增加為紅、減少為綠、持平或第一筆為中性色。兩個 pane 都同時顯示方向箭頭或文字；使用者改變官方級距門檻時只重算已載入的 levels，不重新抓取上游。

### 8. A／B 模式與圖表數量採全域政策、panel 選擇分開保存

圖表列旁新增全域「副圖模式」控制，使用者介面顯示描述性名稱「A 單一副圖」與「B 多層副圖」。1、2、3 圖允許切換 A／B，首次使用預設 B；4、6、8 圖固定 A，控制項顯示目前為 A 並停用 B，說明「4 圖以上固定單一副圖」。4／6／8 圖即使進入 focus mode 也不改為 B。

方式 A 採單選語意，每個 panel 只有 `modeAActivePaneId`；選擇另一項時替換目前 pane，不重建主圖或技術副圖。方式 B 採複選語意，以 `modeBSelectedPaneIds` 的固定 registry 順序建立多個獨立 pane；取消勾選只銷毀該 pane。首次 B 預設選取 `institutional-total-flow`、`margin`、`short`、`big-holder`、`retail-holder`，之後使用裝置端保存值。

全域 `compactSubchartMode` 與各 panel 選擇以 device-local preference 保存，不寫入 D1。panel 狀態以 `tabId + canonical symbol` 作穩定鍵，不能只依畫面 index。從 1／2／3 圖的 B 切換到 4／6／8 圖時只套用 effective mode A，不覆寫 B 偏好；A 顯示最後互動的已選 pane，沒有時使用 registry 第一個可用項目。返回 1／2／3 圖時恢復原 B 模式及勾選組合。A 與 B 各自保存選擇，切換模式不互相清空。

3 圖在寬螢幕採三欄一列；低於專案既定的多圖可讀性 breakpoint 時改成單欄，不採不對稱的二加一版面。方式 B 保留主圖與每個 pane 的最低高度，超出 panel 可用高度時由 panel 內部垂直捲動，不把所有 pane 等比例壓縮到不可讀。pane 標題列顯示名稱、最新值、實際資料日期、狀態與可操作的移除控制。

### 9. 使用 pane manager 完成日 K 對齊、缺口保留與同步

目前單一 `indicatorChart` 的假設不適用方式 B；每個 panel 新增 pane manager，以 `Map<paneId, PaneController>` 管理籌碼 chart、series、time anchor、listener、ResizeObserver、request generation 與 destroy。主 K 線是 visible logical range 的同步 authority；主圖、既有技術副圖及所有作用中的籌碼 pane 共用日期座標與 crosshair，並使用 reentrancy guard 避免循環更新。

日頻籌碼以台北交易日 `sessionDate` 對齊 `1d` candle；TDCC 股權分散以來源 `dataDate` 對齊該週最後營業日。沒有官方資料的日期保留 gap，不 forward-fill、插值或複製到其他交易日。每個 pane 仍以全部 candle 日期建立不可見 time anchor，使只有週資料的 pane 也能與主圖精確對齊。

切換 symbol、台股頁籤排序或 panel 數量時，pane manager 必須取消或忽略舊請求並完整銷毀被移除 pane；舊 response 不得覆蓋新 panel。切換成非 `1d` 時保留 A／B 與 pane 選擇、清除舊 series 並顯示「籌碼資料僅支援日 K」；切回 `1d` 後以共享 response cache 重新載入。向左載入只由主圖觸發，再把新增日期缺口扇出到所有作用中的 pane。

## Risks / Trade-offs

- [免費來源額度或方案改變] → adapter 與 UI 不依賴單一 provider；D1 保存已驗證歷史，來源能力由 runtime health metadata 呈現，不把升級付費列為完成條件。
- [TDCC OpenAPI 只提供最新週快照，免費多年歷史不完整] → 正式站清楚顯示 coverage 起日；只匯入合法取得的官方 archive，上線後每週持續保存，不以未授權爬蟲或付費資料冒充免費來源。
- [全市場 TDCC 快照放大寫入量] → 每週只下載一次、只保存 eligible 普通股、以 `symbol + data_date` 一列正規化 levels JSON 冪等 upsert，並在實作期量測 D1 年增長後決定保留上限。
- [「大戶／散戶」被誤認為投資人身分] → UI 固定標示「依集保持股級距計算」，tooltip 說明經 ID 歸戶與特殊專戶計算邊界，不推論實質受益人。
- [TWSE／TPEx 欄位名稱或格式調整] → 以 fixture 與欄位語意 parser 驗證，未知欄位不靠固定 index 猜測；解析失敗保留上一版資料並回報安全 reason code。
- [第三方資料與官方資料短時間不一致] → 保存 provider 與 sourceUpdatedAt，不跨日期混合；最新資料可在一至兩個交易日後重抓修訂，UI 顯示實際資料日期。
- [D1 隨歷史回補增長] → 只按使用者實際查詢個股寫入、使用複合索引與分段查詢；不預先鏡像全市場多年資料。
- [多圖同時選取籌碼造成流量放大] → D1-first、single-flight、可見 panel 限定與取消機制；同 symbol/range 只產生一次上游請求。
- [一般網頁資料可看但不允許自動擷取] → 正式 adapter 只接受可介接 API／開放資料；若官方個別資料缺少合法 API，使用明確授權的歷史 API 或將該欄位標示 unavailable，不規避限制。
- [方式 B 同時建立大量 chart 壓縮版面或降低效能] → 僅在 1／2／3 圖開放 B，各 pane 與主圖保留最低高度並使用 panel 內捲動；資料依 dataset 共用 request／cache，chart 只為已勾選 pane 建立，實作期以 3 panel 乘全部 pane 的最壞案例量測後再決定是否需要明確上限。
- [切換圖數時 panel 重建導致使用者選擇消失] → 在 destroy 前以 `tabId + canonical symbol` snapshot A／B 狀態，4／6／8 圖只強制 effective mode A 而不覆寫 B 偏好，重建後依穩定鍵還原。

## Migration Plan

1. 先加入 adapter contract、parser fixture、D1 schema 與 migration，不啟用前端入口。
2. 部署相容 migration，確認既有清單、商品目錄、K 線快取與 TPEx mirror 資料不受影響。
3. 加入 API 與 feature capability metadata，以代表上市／上櫃普通股驗證歷史回補、TDCC 週快照 ingest、增量更新及 stale fallback。
4. 加入 3 圖、A／B 控制、pane manager 與籌碼副圖 UI，先在本機驗證 1／2／3 圖模式切換、4／6／8 圖強制 A、跨圖數狀態恢復、時間同步、interval／symbol 切換、取消舊請求、多 pane 負載與大戶／散戶級距重算。
5. 完成 build、測試與 strict validation 後保存 Sites version，使用 owner-only deployment 發布並在已登入正式站驗收。
6. 若正式站資料源或 UI 發生嚴重問題，先關閉前端籌碼入口並回滾上一個 Sites version；新增 D1 table 可保留，不影響既有功能，後續再清理。

## Open Questions

- 實作前需再次確認 TWSE 個股法人與外資持股最新資料中，哪些端點明確允許正式自動介接；若只有一般網頁報表，第一版將以 FinMind 歷史／每日 API 為該族群來源並保留官方人工抽查。
- 借券第一版最終顯示「借券成交」、「借券餘額」或「借券賣出餘額」的組合，需依上市與上櫃可取得的共同欄位決定；規格允許缺欄位為 `null`，不以不同概念互相替代。
- D1 歷史保留上限先以按需個股全期間為目標；若實測容量成長過快，再以最近十年作預設視窗並提供分段回補，不在未量測前硬性截斷。
- TDCC 官方個股查詢頁雖提供一年歷史，實作前仍需確認是否有允許批次介接的官方歷史 archive；若沒有，第一版只匯入可合法取得的資料並從上線日開始每週累積。
