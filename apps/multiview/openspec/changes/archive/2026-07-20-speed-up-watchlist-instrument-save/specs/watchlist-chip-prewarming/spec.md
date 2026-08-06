## MODIFIED Requirements

### Requirement: 我的清單台股會自動建立籌碼預熱目標

系統 MUST 從系統預設台股清單與所有使用者已啟用的清單項目，動態找出符合 eligibility 的 TWSE／TPEx 普通股及 ETF，並以全站去重 symbol 建立籌碼預熱目標；workflow MUST NOT 固定寫死 symbol，也 MUST NOT 擴張成未加入網站的既有全市場掃描。互動式清單儲存 MUST 只在背景註冊本次合格 symbol，MUST NOT 在 API response 前重建完整 target 集合。

#### Scenario: 使用者新增合格普通股或 ETF
- **WHEN** 使用者將尚未完整快取籌碼資料的合格台股加入「我的清單」
- **THEN** 系統 MUST 在 Worker background lifetime 冪等建立或更新該 symbol 的背景預熱目標
- **AND** 儲存 API MUST NOT 等待完整 target reconciliation，下一次 durable scheduler MUST 再次檢查並補齊未完成資料

#### Scenario: 相同台股出現在多個清單
- **WHEN** 同一 symbol 被多個使用者或多個頁籤加入
- **THEN** 背景預熱 MUST 只保留一個全站資料目標
- **AND** D1 資料 MUST 供所有相同 symbol 的圖表共用

#### Scenario: 非合格商品或已停用商品
- **WHEN** 清單項目不是支援的台股普通股／ETF，或已被停用且不再屬於其他有效目標
- **THEN** 系統 MUST NOT 建立新的籌碼預熱工作
- **AND** 既有已驗證資料 MAY 保留供診斷與快取使用，完整背景 discovery MUST 在下一週期停用孤兒 target

### Requirement: 新增清單商品後立即背景預熱

成功保存清單商品的請求 MUST 在不阻塞使用者操作的情況下，以 Worker background lifetime 註冊該 symbol 的 target 並預熱最近兩年的法人、外資持股、融資券及借券資料；立即工作失敗或未完成 MUST 由 durable scheduler 接手。Foreground MUST NOT 掃描完整官方商品目錄、所有使用者商品或所有既有 targets。

#### Scenario: 新增台股 API 快速完成
- **WHEN** 使用者新增一檔合格台股而免費來源、target 註冊或 D1 background work 回應較慢
- **THEN** 儲存清單 API MUST 在單筆清單持久化與 canonical response 完成後先成功回應
- **AND** 單一 target 註冊與籌碼下載 MUST 在 `waitUntil` 背景工作執行

#### Scenario: Foreground 工作邊界
- **WHEN** `POST /api/instruments` 保存一個商品
- **THEN** response 前 MUST NOT 呼叫完整 TDCC target reconciliation
- **AND** MUST NOT 因 active target、官方 catalog 或其他使用者清單數量增加而線性增加 foreground target queries

#### Scenario: 立即背景工作中斷
- **WHEN** Worker background lifetime 結束前仍有 target 註冊或 dataset 未完成
- **THEN** 已保存的使用者清單與 fetch-state MUST 保留已成功資料及未完成狀態
- **AND** 下一次 GitHub Actions MUST 從 durable 清單來源將該 symbol 排入 discovery 或 stale／missing targets
