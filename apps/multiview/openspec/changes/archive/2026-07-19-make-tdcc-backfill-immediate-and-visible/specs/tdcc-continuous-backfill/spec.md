## MODIFIED Requirements

### Requirement: 動態發現所有新加入網站的合格台股

每次背景工作 MUST 從目前 base setup、D1 商品目錄、使用者已加入商品及 baseline 後的官方新上市增量重建目標集合；任何首次出現且符合 TWSE／TPEx 普通股或 ETF eligibility 的 symbol MUST 在一個排程週期內建立逐 symbol coverage 與歷史回補工作，不得只使用部署時固定清單。目標同步 MUST 以至少 51 週且沒有 missing dates 作為 `completed` 的最低條件；只有少量最新週資料的 `queued`／`partial` symbol MUST NOT 被覆寫為 `completed`。

#### Scenario: 使用者新增一檔既有台股
- **WHEN** 使用者將尚無完整 TDCC coverage 的合格台股普通股或 ETF 加入網站清單
- **THEN** 背景 discovery MUST 將該 symbol 設為 queued 或 partial
- **AND** MUST 依官方免費歷史範圍建立 missing weeks，不要求重新部署或修改 workflow

#### Scenario: 少量既有資料不得誤判完成
- **WHEN** 新增 symbol 已保存 1 至 50 週資料，且 expected weeks 尚未規劃或低於最低歷史週數
- **THEN** 目標同步 MUST 保留可 claim 的 `queued` 或 `partial` 狀態
- **AND** 下一次 claim MUST 能取得該 symbol 並建立完整官方日期計畫

#### Scenario: 官方新增上市證券
- **WHEN** baseline 後的官方商品目錄出現新的 active TWSE／TPEx 普通股或 ETF
- **THEN** discovery MUST 在 catalog revision 更新後自動建立該 symbol 的 coverage 與 queue
- **AND** 上市日前 MUST 保持 `pre_listing` 缺值，不得補造 rows

#### Scenario: 首次啟用背景同步
- **WHEN** migration 第一次建立 continuous-backfill baseline
- **THEN** 系統 MUST 將目前已支援 symbol 記錄為 baseline 並保留既有 coverage
- **AND** MUST NOT 將未加入網站的整個既有市場誤當成新 symbol 而啟動全市場歷史掃描

#### Scenario: 商品停用或下市
- **WHEN** 目標 symbol 後續變成 inactive、非普通股或非 ETF
- **THEN** 系統 MUST 停止建立新的歷史工作與最新週寫入
- **AND** MUST 保留已驗證歷史供既有資料查詢與稽核

### Requirement: 新 symbol 與缺週的背景歷史回補

受保護背景 operator workflow MUST 自動 claim 新 symbol 或 gap 工作，以官方歷史日期、單一併發、至少一秒間隔、有限 symbol／週批次與 checkpoint 操作 TDCC 可見歷史表單；成功資料 MUST 經受保護 ingest 與相同 validator 寫入 D1。workflow MUST NOT 自行擴張至 queue 以外的 symbol，且每次 target refresh MUST 保留未達最低週數的人工或清單 queue。

#### Scenario: 新 symbol 沒有完整歷史 coverage
- **WHEN** queue claim 取得一檔新加入且最新官方資料可驗證、但未達最低 51 週的合格 symbol
- **THEN** runner MUST 比對官方免費歷史日期與 D1 distinct dates，按固定順序處理 missing weeks
- **AND** 完成後 MUST 保存 expected、completed、failed weeks 與 coverage 起訖

#### Scenario: 新上市商品的上市前週次
- **WHEN** 完整官方日期集合包含商品上市日前的週次
- **THEN** 系統 MUST 將上市前週次納入 expected weeks，並以 `pre_listing` 合法缺值標記為完成
- **AND** MUST NOT 產生虛構 TDCC rows 或線圖點，也 MUST NOT 因實際上市後資料少於 51 週而反覆 claim 空工作

#### Scenario: 既有 symbol 漏掉中間一週
- **WHEN** 官方歷史日期集合包含 D1 未保存且不屬於 `pre_listing` 的 `dataDate`
- **THEN** 系統 MUST 將該日期建立為 gap item 並由背景 runner 自動補洞
- **AND** 不得重抓已存在且通過驗證的其他週

#### Scenario: 官方表單合法回覆查無此資料
- **WHEN** queue 指定 symbol／官方日期的 TDCC 公開表單明確回覆「查無此資料」，且沒有 CAPTCHA、封鎖或候選代號不一致
- **THEN** runner MUST 將該週完成為 `not_published` gap 並保留原因，不得寫入虛構 rows
- **AND** MUST 繼續同一有限批次的後續週，不得將合法缺值誤判為 `invalid_response`

#### Scenario: 工作時間或批次用完
- **WHEN** runner 達到單次 symbol、週數或總執行時間上限
- **THEN** MUST 保存 checkpoint、釋放或續租目前工作並正常結束
- **AND** 下一次排程 MUST 從未完成週續跑

#### Scenario: 歷史頁回傳 CAPTCHA 或封鎖
- **WHEN** runner 偵測 CAPTCHA、封鎖、候選不一致、使用規範不允許自動操作或 HTML 格式漂移
- **THEN** MUST 停止該次歷史工作並將原因設為 allowlist blocked 狀態
- **AND** MUST NOT 規避限制、持續高速重試或影響最新 OpenAPI snapshot 工作

#### Scenario: parser 修正後由 operator 重新排入誤判工作
- **WHEN** 已部署並驗證的 parser 修正可處理先前 `candidate_mismatch` 或 `invalid_response`，且 operator 透過受保護控制面指定原 reason 與有限 symbol 清單
- **THEN** 系統 MAY 只將仍為該 blocked reason 的明確 symbols 重設為 `queued`
- **AND** CAPTCHA、來源封鎖或未指定 symbols MUST NOT 被自動解鎖或視為可重試
