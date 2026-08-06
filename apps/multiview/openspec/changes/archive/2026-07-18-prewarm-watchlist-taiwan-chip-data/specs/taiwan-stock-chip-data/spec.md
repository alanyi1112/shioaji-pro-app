## MODIFIED Requirements

### Requirement: D1-first 快取、single-flight 與失敗退讓

系統 MUST 先讀 D1，只對缺口或過期範圍呼叫上游；相同 symbol、dataset 與日期範圍 MUST 共用 single-flight，並對 rate limit 或供應者失敗採取可重試退讓。「我的清單」內合格台股的法人、外資持股、融資券與借券資料 MUST 由立即背景工作及 durable scheduler 預先填入 D1，開圖時按需補抓只能作為 fallback，不得是取得歷史資料的唯一觸發。

#### Scenario: 多個 panel 同時查詢相同個股
- **WHEN** 多個 panel 同時請求相同 symbol、dataset 與日期範圍
- **THEN** 系統 MUST 最多建立一個進行中的上游請求
- **AND** 所有 panel 共用同一結果

#### Scenario: D1 已完整覆蓋請求範圍
- **WHEN** coverage 顯示 D1 已包含完整且仍有效的日期範圍
- **THEN** API MUST 直接回傳 D1 資料
- **AND** MUST NOT 呼叫上游

#### Scenario: 上游失敗但有舊資料
- **WHEN** 上游 timeout、429 或暫時不可用且 D1 已有部分／過期資料
- **THEN** API MUST 回傳最近成功資料
- **AND** cache 或 warnings MUST 標示 `stale_cache`、`rate_limited` 或 `provider_unavailable`

#### Scenario: 多個 panel 同時需要股權分散資料
- **WHEN** 多個 panel 同時顯示相同或不同台股個股的大戶／散戶副圖
- **THEN** 各 panel MUST 先共用 D1 已保存的週快照
- **AND** 若需要更新最新 TDCC 資料，全站最多執行一個全市場 snapshot 請求，不得逐 panel 或逐 symbol 重複下載

#### Scenario: 清單台股尚未開圖
- **WHEN** 合格台股已加入「我的清單」但使用者從未開啟該商品線圖
- **THEN** 背景立即預熱或 durable scheduler MUST 主動補齊最近兩年可取得的日籌碼
- **AND** 第一次開圖 MUST 優先使用已保存 D1 rows，不等待完整歷史下載才開始顯示
