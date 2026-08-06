## MODIFIED Requirements

### Requirement: 動態發現所有新加入網站的合格台股

每次背景工作 MUST 從目前 base setup、D1 商品目錄、使用者已加入商品及 baseline 後的官方新上市增量重建目標集合；任何首次出現且符合 TWSE／TPEx 普通股或 ETF eligibility 的 symbol MUST 在一個排程週期內建立逐 symbol coverage 與歷史回補工作，不得只使用部署時固定清單。完整 target discovery／reconciliation MUST 由 durable scheduler、受保護 control plane 或商品目錄 ingest 執行，MUST NOT 阻塞互動式清單儲存 response。

#### Scenario: 使用者新增一檔既有台股
- **WHEN** 使用者將尚無 TDCC coverage 的合格台股普通股或 ETF 加入網站清單
- **THEN** Worker MAY 在 response 後以單一 symbol background upsert 先將該 target 設為 queued，且下一次背景 discovery MUST 再次納入該 symbol
- **AND** MUST 依官方免費歷史範圍建立 missing weeks，不要求重新部署或修改 workflow

#### Scenario: 互動式儲存不執行完整 discovery
- **WHEN** 使用者新增、更新或重新儲存一個清單商品
- **THEN** foreground request MUST NOT 重掃完整官方 catalog、所有使用者商品或逐一 reconcile 所有 active targets
- **AND** full discovery 的延後 MUST NOT 影響該次使用者清單 D1 持久化成功

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
- **THEN** 下一次完整背景 discovery MUST 停止建立新的歷史工作與最新週寫入
- **AND** MUST 保留已驗證歷史供既有資料查詢與稽核
