## 1. 來源契約與測試樣本

- [x] 1.1 以 TDCC 官方文件與實際回應確認歷史全市場匯出／下載是否具有穩定且允許 server-to-server 介接的 request contract，將資料日期範圍、頻率、格式與限制記錄於程式內的非秘密 metadata
- [x] 1.2 若自動介接契約可確認，建立只接受官方 `dataDate` 的 history network adapter；若無法確認，維持 `history_source_unverified` fail-closed 並實作受保護官方檔案匯入 adapter
- [x] 1.3 建立去識別且不含秘密的合法、缺欄、重複分級、日期不一致、非有限數值與合計錯誤 fixtures
- [x] 1.4 為 TDCC parser／validator 加入 schema、level、symbol／date 唯一性、分級 17 合計、合理筆數及整檔拒絕測試

## 2. D1 schema、repository 與冪等寫入

- [x] 2.1 新增 Sites D1 migration，保存 backfill job、目標日期、checkpoint、成功／失敗週數、狀態、allowlist 錯誤碼與 timestamps，且不破壞既有股權分散資料
- [x] 2.2 擴充 shareholder-distribution coverage repository，依 D1 distinct `dataDate` 計算實際起訖與已保存週數，不只依賴 job 計數
- [x] 2.3 實作按週與 row chunk 的 transaction／upsert，使 `symbol + dataDate` 重跑維持唯一且不部分覆寫驗證失敗週
- [x] 2.4 加入 migration 相容、同週重跑、checkpoint 中斷續跑與 coverage 重算測試

## 3. 受保護回補工作

- [x] 3.1 擴充受保護 ingest API，驗證 Sites 存取與獨立 ingest secret，建立一年免費官方範圍的 backfill job 並回傳安全 job 摘要
- [x] 3.2 實作固定順序、有限週數、有限 rows、低併發、timeout、429／5xx 退讓與 retry 上限的批次 runner
- [x] 3.3 讓相同 `dataDate` 的普通股與 ETF 共用同一份全市場輸入，禁止逐 panel 或逐 symbol 重複下載
- [x] 3.4 實作 queued、running、partial、completed、failed 狀態轉移；部署或 request 中斷後從 checkpoint 續跑並保留已成功週
- [x] 3.5 確認公開 `GET /api/taiwan-stock-chip` 不會同步啟動或等待完整歷史回補，且回補失敗時仍回傳 D1 既有資料
- [x] 3.6 加入 endpoint 驗證、未授權拒絕、批次上限、退讓、續跑、整週原子性與 secrets 不外洩測試

## 4. API、健康檢查與週資料契約

- [x] 4.1 擴充個股籌碼 API 的 shareholder-distribution coverage，回傳實際起訖、已保存／預期週數、最後成功時間與安全 backfill 狀態
- [x] 4.2 擴充 `/api/health` 的安全摘要，讓正式站可查證回補是否真的 queued／running／partial／completed，且不輸出秘密或完整上游錯誤
- [x] 4.3 明確回傳 `frequency=weekly`、官方實際 `dataDate` 與「當週最後營業日」語意，假日週不得自行搬移日期
- [x] 4.4 加入只有一期但無 job、實際 running、部分失敗、完成及非發布日維持 `null`／gap 的 API contract 測試

## 5. 大戶／散戶副圖狀態

- [x] 5.1 將無 running job 的單筆狀態由「首筆／歷史累積中」改為「目前僅 1 期／尚無前週比較」
- [x] 5.2 只有 API 回傳 queued／running 時顯示「歷史回補中（x/y 週）」，partial／failed 時保留資料並顯示「回補未完成」與安全原因
- [x] 5.3 在大戶／散戶 pane 固定揭露「週資料／當週最後營業日」，維持非 `dataDate` 的「當日無發布資料」與不補值行為
- [x] 5.4 加入普通股與 ETF 的單筆、回補中、回補完成、部分失敗、週變化柱及非發布日 tooltip UI 測試

## 6. 實際回補與驗收

- [x] 6.1 在本機測試 D1 先以單一官方週執行 dry run 與寫入 smoke，核對至少一檔普通股與一檔 ETF 的日期、級距、人數、股數、比例及合計
- [x] 6.2 執行免費官方可用範圍的實際分批回補或受保護官方檔案匯入，記錄完成週數、coverage 起訖、partial／failed 週與重試結果
- [x] 6.3 執行 `node --check`、相關 Worker／前端測試、`openspec validate --all --strict` 與 build，確認沒有秘密進入 repo、response、fixture 或 log
- [x] 6.4 以瀏覽器驗收普通股與 ETF：多週比例線、週增減柱、回補狀態、實際 `dataDate`、非發布日 gap、共用 crosshair 與 tooltip 行為
- [x] 6.5 依 Sites 流程部署後，驗證正式 `/api/health` 與個股籌碼 API 的 coverage／週數已增加，並抽樣比對 TDCC 官方資料與可見副圖結果
