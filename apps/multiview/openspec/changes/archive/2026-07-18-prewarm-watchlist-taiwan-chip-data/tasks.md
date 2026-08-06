## 1. 預熱契約與目標發現

- [x] 1.1 定義最近兩年窗口、日籌碼 datasets、單次 target 上限、新鮮期限與安全錯誤碼 metadata
- [x] 1.2 實作從 active continuous symbols 與 fetch-state 找出 missing／stale targets，依缺資料及最久未成功排序
- [x] 1.3 加入重複清單 symbol、非台股、停用商品、完整 coverage、retry-after 與有限批次測試

## 2. Worker 立即背景預熱

- [x] 2.1 將 execution context 傳入 app request handler，提供不阻塞 response 的 `waitUntil` 能力
- [x] 2.2 新增可重用的單一 symbol 日籌碼預熱 service，沿用 eligibility、FinMind adapter、官方 fallback、D1 局部合併與 fetch-state
- [x] 2.3 在新增或重新啟用清單商品後，對 eligible symbol 啟動立即預熱，停用商品不啟動
- [x] 2.4 加入 response 不等待上游、背景失敗由 durable scheduler 重試及 symbol 去重測試

## 3. Durable scheduler 與 runner

- [x] 3.1 擴充受保護 continuous endpoint，回傳目前日籌碼預熱窗口與有限 targets，不回傳使用者身分或秘密
- [x] 3.2 擴充 GitHub runner，在 TDCC latest 後逐 symbol 呼叫籌碼 API，隔離失敗並輸出安全摘要
- [x] 3.3 設定 runner 預熱批次預設值與 workflow 執行順序，維持 concurrency、timeout、最小權限及 secrets fail closed
- [x] 3.4 加入 runner target 動態取得、順序、部分失敗、rate limit、秘密遮罩與 workflow contract tests

## 4. 可觀測性與開圖行為

- [x] 4.1 新增 watchlist chip prewarming health，回傳 target、ready、pending、最近成功時間與安全狀態
- [x] 4.2 確認開圖 API 在 D1 已預熱時不呼叫上游，缺漏時仍保留按需 fallback 與 stale cache
- [x] 4.3 加入普通股、ETF、部分 dataset unavailable 與 scheduler stale 的 API／health 測試

## 5. 驗證、啟用與部署

- [x] 5.1 執行完整測試、build、OpenSpec strict validation 與 committed secret scan
- [x] 5.2 部署 Worker，將 Sites `TDCC_HISTORY_AUTOMATION_ENABLED` 設為 `true` 並重新部署套用環境 revision
- [x] 5.3 手動執行 GitHub workflow，驗證 TDCC 歷史 lane 與現有清單日籌碼預熱結果
- [x] 5.4 抽查至少一檔普通股與一檔 ETF 的 D1 coverage、正式 API、health 及第一次開圖可直接顯示
