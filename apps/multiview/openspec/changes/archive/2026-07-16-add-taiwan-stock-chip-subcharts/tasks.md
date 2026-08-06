## 1. 資料來源契約與測試基線

- [x] 1.1 重新核對 TWSE、TPEx、FinMind 與 TDCC 目前可自動介接的法人、外資持股、融資融券、借券及股權分散端點、授權條件、欄位名稱、資料單位與發布時點，特別記錄 TDCC `GET /v1/opendata/1-5`、官方 CSV、最新快照與歷史覆蓋邊界。
- [x] 1.2 定義 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending`、`shareholder-distribution` 的 TypeScript adapter contract、正規化 row、provenance、coverage、frequency 與安全 reason code 型別。
- [x] 1.3 為上市與上櫃代表資料建立去識別且不含 token 的 parser fixtures，涵蓋正常回應、部分欄位、明確零值、空值、重複日期、錯誤 symbol、TDCC 分級 1 至 17 與格式變更。
- [x] 1.4 建立 adapter 單元測試，驗證欄位以語意名稱解析、股數與張數單位轉換、有限數值、日期排序及 `null`／`0` 不混用。
- [x] 1.5 建立資料語意測試，確認自營商合計只由來源定義相容的自行買賣與避險淨額組成、三大法人合計只在三個分項完整時相加並通過來源總計驗證、不由買賣超推算持股，且大戶／散戶只代表 TDCC 持股級距而非投資人身分。
- [x] 1.6 建立 TDCC 級距加總測試，驗證分級 1 至 3 的 10 張以下散戶、分級 15 的 1,000,001 股以上大戶、分級 16 差異調整、分級 17 合計及不支援門檻拒絕行為。

## 2. D1 Schema 與 Migration

- [x] 2.1 在 `db/schema.ts` 新增 `taiwan_stock_chip_daily`，包含複合主鍵、四個資料族群欄位、來源／完整度 metadata 與日期範圍查詢索引。
- [x] 2.2 在 `db/schema.ts` 新增 `taiwan_stock_shareholder_distribution`，以 `symbol + dataDate` 保存正規化 levels JSON、差異調整、合計、provider 與週快照 metadata。
- [x] 2.3 在 `db/schema.ts` 新增 `taiwan_stock_chip_fetch_state`，保存逐 symbol dataset coverage，以及 `shareholder-distribution` 全市場最新快照日期、成功／嘗試時間、retry 時間與安全 reason code。
- [x] 2.4 更新 Worker runtime `ensureDb`，以每個 `prepare()` 僅執行一個 SQL statement 的方式相容建立新 table 與 index。
- [x] 2.5 使用專案既有 Drizzle 流程產生並檢查 migration，確認沒有刪除、重命名或重建既有 table 的破壞性操作。
- [x] 2.6 擴充 Fake D1 與 migration 測試，驗證新舊資料庫都能升級，既有清單、商品目錄、K 線快取及 TPEx mirror 仍可讀寫。

## 3. Adapter 與正規化資料層

- [x] 3.1 以商品目錄實作台股普通股 eligibility 判定，要求 `quoteType=EQUITY`、正確 exchange 與 `.TW`／`.TWO` canonical symbol 同時成立。
- [x] 3.2 實作 FinMind 個股日期範圍 adapter 與可選 `FINMIND_API_TOKEN` 的伺服器端設定，匿名模式採保守查詢範圍且 response／log 不含 token。
- [x] 3.3 依 1.1 的核對結果實作允許自動介接的 TWSE／TPEx 最新資料 adapter；沒有合法 API 的欄位回傳 unavailable，不以一般網頁爬取補足。
- [x] 3.4 實作三大法人正規化，保存外資、投信、自營商自行買賣、自營商避險、自營商合計與三大法人合計的每日淨買賣超股數；合計須驗證分項完整性及來源總計。
- [x] 3.5 實作外資及陸資持股正規化，保存持有股數、發行股數、持股比率、來源日期與可用申報 metadata。
- [x] 3.6 實作融資融券正規化，保存買進、賣出、償還、前日／今日餘額、每日增減與資券互抵，並統一來源單位。
- [x] 3.7 實作借券正規化，只映射來源實際提供的借券成交、借券餘額與借券賣出餘額，不以融券或其他概念替代。
- [x] 3.8 實作 TDCC 全市場週快照 adapter，依欄位名稱解析分級 1 至 17，驗證同日一致性、分級唯一性、有限數值、比例與合計後只保留 eligible 普通股。
- [x] 3.9 實作股權分散級距 aggregator，回傳支援門檻的比例、股數、人數與精確範圍說明，且不將分級 16／17納入大戶或散戶。
- [x] 3.10 實作逐資料族群 partial upsert 與 provenance 合併，確認更新一個族群不會清空其他族群，較舊或驗證失敗資料也不覆蓋較新有效資料。

## 4. D1-first 抓取與快取協調

- [x] 4.1 實作按 `symbol + sessionDate` 查詢、分段批次 upsert、遞增排序與不重複的 D1 repository。
- [x] 4.2 實作各 dataset coverage 與 freshness 判定，只為請求範圍的缺口或過期區段呼叫上游。
- [x] 4.3 為相同 `symbol + dataset + range` 實作 single-flight，並以測試確認多 panel 同時查詢只產生一次上游請求。
- [x] 4.4 實作 timeout、429 與供應者錯誤的 retry state、退讓及短期 negative cache，避免每次 request 立即重試。
- [x] 4.5 實作 partial／stale fallback：D1 有資料時回傳最近成功內容與 `partial_data`／`stale_cache`，完全無資料才回傳安全 unavailable 狀態。
- [x] 4.6 實作每週 TDCC 全市場 snapshot 同步與全站 single-flight，以資料日期冪等寫入 D1，任何 panel 都不得逐 symbol 重複抓取上游。
- [x] 4.7 如其他最新官方資料需要排程同步，沿用 private Sites workflow 模式新增受保護 ingest endpoint，驗證 Sites 存取、獨立 secret、資料日期、symbol、重複值、筆數與有限數值。（本次 TWSE／TPEx 最新 fallback 可安全即時讀取合法 OpenAPI，不需要新增排程 ingest。）
- [x] 4.8 更新 health／capability metadata，回報五個籌碼資料族群的可用來源、頻率、coverage、最近成功日期與安全狀態，不洩漏 upstream error 或秘密。

## 5. 個股籌碼 Worker API

- [x] 5.1 新增同源 `GET /api/taiwan-stock-chip` route，驗證 symbol、`start`、`end` 與日頻限制，拒絕錯誤日期及超過 2,600 個交易日的範圍。
- [x] 5.2 組出穩定 response contract，包含 `symbol`、`exchange`、`interval`、`eligible`、`availability`、`rows`、`coverage`、`sources`、`cache` 與 `warnings`。
- [x] 5.3 擴充 response contract 的 `distributionRows`，依 `dataDate` 回傳正規化 levels、差異調整、合計、週頻、provider 與股權分散實際 coverage。
- [x] 5.4 確保日頻 rows 依 `sessionDate`、週頻 `distributionRows` 依 `dataDate` 遞增且不重複，所有數值為有限數值或 `null`，source metadata 不含 token、完整上游錯誤或內部憑證。
- [x] 5.5 為 eligible `.TW`／`.TWO`、不支援商品、錯誤日期、完整快取、部分資料、過期快取、完全無資料、`history_not_archived` 及來源失敗建立 API 測試。
- [x] 5.6 建立併發與隔離測試，確認重複日資料 request 共用 single-flight、TDCC 全站只抓一次快照、不同 symbol／range 不共用錯誤結果，且某一族群失敗不影響 K 線與其他族群。

## 6. 籌碼副圖介面與互動

- [x] 6.1 將 `CHART_COUNTS`、圖數選單、grid class、分頁與診斷擴充為 1／2／3／4／6／8 圖，新增寬螢幕三欄一列與 breakpoint 以下單欄的 3 圖樣式及測試。
- [x] 6.2 在圖數控制旁新增全域「A 單一副圖／B 多層副圖」控制，實作 1／2／3 圖首次預設 B、4／6／8 圖強制 A 與 focus mode 仍維持 A 的政策及提示文字。
- [x] 6.3 實作 `compactSubchartMode`、`modeAActivePaneId`、`modeBSelectedPaneIds` 狀態與 device-local persistence；以 `tabId + canonical symbol` snapshot／restore，跨圖數重建時保留 B 勾選組合與 A 最後項目。
- [x] 6.4 建立固定順序的 pane registry 與 `Map<paneId, PaneController>` pane manager，支援 A 單選替換、B 複選增刪、獨立 Y 軸、time anchor、狀態列、讀值、ResizeObserver 及完整 destroy，且不改變既有技術副圖行為。
- [x] 6.5 實作 panel lazy request、dataset requirements 合併、共享 response cache、AbortController／request generation 隔離與 destroy cleanup，切換 symbol、interval、頁籤、排序或圖數時不殘留舊資料。
- [x] 6.6 實作外資、投信、自營商與三大法人合計四個獨立買賣超 pane，呈現正負零軸 series，並在讀值分列三個組成項及自營商自行買賣與避險；四者共用 `institutional-flow` response。
- [x] 6.7 實作外資持股 pane，以百分比尺度呈現來源發布比率，並在讀值顯示持股股數、發行股數、實際資料日期與來源。
- [x] 6.8 實作融資與融券兩個獨立 pane，分別呈現餘額及每日增減，讀值顯示買進、賣出、償還與資券互抵，兩者共用 `margin-short` response。
- [x] 6.9 實作借券 pane，只為非 `null` 的借券成交、借券餘額或借券賣出餘額建立正確名稱的 series。
- [x] 6.10 實作大戶與散戶兩個獨立週頻百分比柱狀 pane，預設使用分級 15 與分級 1 至 3，共用 TDCC response，並顯示比例、張數、人數及資料日期。
- [x] 6.11 實作官方級距門檻選單與邊界說明，切換時使用已載入 levels 重算；柱色依前一筆週資料增紅減綠、持平中性，並以文字／箭頭同步呈現方向。
- [x] 6.12 實作 `null` gap、零值、股數轉張數、百分比、日期與來源 readout；日頻與週頻資料缺少時顯示「無資料」，不得 forward-fill、插值或畫成零線。
- [x] 6.13 以主 K 線為同步 authority，同步技術副圖與所有籌碼 pane 的 visible logical range、crosshair、resize、focus mode 與向左載入，加入 reentrancy guard，週資料只落在實際 `dataDate`。
- [x] 6.14 實作方式 B 的 pane stack 最小高度、panel 內垂直捲動、固定排序、移除控制、窄螢幕與鍵盤操作，確保資訊不只依賴紅綠顏色且不把多 pane 壓縮到不可讀。
- [x] 6.15 實作非 `1d`、非 eligible 商品、loading、partial、stale、not published、history not archived、provider unavailable 等中性狀態，保留模式偏好但清除上一商品 series，且不誤發上游請求。
- [x] 6.16 確認背景 K 線預取不會觸發未顯示商品的籌碼回補，且 1／2／3／4／6／8 圖中相同 `symbol + dataset + range` 共用 API、D1 週快照與快取結果；量測 3 panel 乘全部 pane 的最壞案例後再決定是否需要選取上限。

## 7. 整合驗證與 Sites 發布

- [x] 7.1 執行 adapter、D1、API、前端與既有 regression tests，並依專案驗證梯子完成 typecheck／build、`git diff --check` 與 `openspec validate --all --strict`。
- [x] 7.2 在本機以 `2330.TW` 與 `8069.TWO` 驗證十個 pane 的日期、頻率、單位、來源、缺值、三大法人合計及來源交叉驗證、時間同步、hover 讀值、向左載入與快速切換隔離。
- [x] 7.3 在本機驗證 1／2／3 圖 A／B、首次 B 預設五項、3 圖 responsive、A 單選替換、B 複選增刪、4／6／8 圖強制 A、focus 維持 A，以及跨圖數與重建後選擇恢復。
- [x] 7.4 在本機驗證非日 K、非台股普通股、部分／過期／來源失敗、多圖重複 symbol、panel 排序、五個以上 pane 捲動與最大勾選負載，確認既有 K 線與技術副圖不受影響。
- [x] 7.5 檢查 migration、D1 容量、查詢成本與方式 B chart 數量／記憶體／互動流暢度，記錄實測資料列成長、索引使用、歷史保留與是否需要 pane 上限；若需調整，先更新 design 與 spec。
- [x] 7.6 依 Sites 流程保存並發布 owner-only 正式版本，輪詢 deployment 成功後以已登入正式站驗證同源 API 與可見 UI，不把匿名 `401` 誤判為部署失敗。
- [x] 7.7 在正式站完成至少一檔 `.TW` 與一檔 `.TWO` 的十個 pane 驗收，另核對 1／2／3 圖 A／B、4／6／8 圖強制 A、3 圖版面、大戶／散戶預設級距、柱色、週資料 gap 與 TDCC 官方數值，記錄 Sites version、實際資料日期、provider、單位、瀏覽器錯誤與容錯結果。
- [x] 7.8 更新 README 與 Obsidian 專案駕駛艙的資料來源、runtime 變數名稱、A／B 操作方式、圖數規則、驗證結果、已知限制及後續維運方式，且不寫入任何秘密值。
- [x] 7.9 所有核取方塊、strict validation、正式站驗收與文件更新完成後，才歸檔此 OpenSpec change；未達成前保持 active。
