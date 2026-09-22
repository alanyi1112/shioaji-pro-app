# multiview-stock-screener-list-sync Specification

## Purpose
TBD - created by archiving change sync-stock-screener-results-to-multiview-list. Update Purpose after archive.
## Requirements
### Requirement: MultiView 必須冪等建立選股篩選頁籤並加入合法商品

MultiView MUST 依目前 request principal，在個人頁籤中尋找正規化後名稱精確為「選股篩選」的目標。目標不存在時 MUST 以保留給選股 integration 的穩定 identity 建立一個啟用中、非預設的個人頁籤，並將經 server-side catalog 驗證的 canonical 台股 STK 商品持久化一次；頁籤或商品已存在時 MUST 回覆 `already_present` 或等價成功終態，不得建立重複資料。

#### Scenario: 頁籤不存在時第一次加入

- **WHEN** 目前使用者沒有「選股篩選」個人頁籤，且送入的 `.TW` 或 `.TWO` 商品可由 MultiView catalog 驗證
- **THEN** 系統 MUST 建立一個「選股篩選」頁籤並使該 canonical 商品在頁籤中持久存在一次
- **AND** 新頁籤 MUST NOT 成為預設頁籤或自動成為目前作用中頁籤

#### Scenario: 既有頁籤加入第二檔商品

- **WHEN** 唯一「選股篩選」頁籤已存在但不含目前商品
- **THEN** 系統 MUST 沿用該頁籤 identity 加入商品，且不得建立第二個同名頁籤

#### Scenario: 重複加入同一商品

- **WHEN** 同一 canonical 商品已存在於「選股篩選」，或相同請求被重送
- **THEN** 系統 MUST 保持單一商品項目並回覆可辨識的成功終態

#### Scenario: 兩個請求同時建立頁籤

- **WHEN** 同一使用者的兩個請求在尚未看見「選股篩選」頁籤時同時執行
- **THEN** 系統 MUST 以穩定 tab identity、資料庫唯一鍵及回讀確認收斂為一個頁籤與每檔商品一筆

### Requirement: MultiView 必須由後端驗證商品與唯一目標

同步 endpoint MUST 以 MultiView server-side catalog authority 驗證 canonical symbol、market、provider 與商品種類。系統 MUST 先使用 `instrument_catalog` 的精確 symbol 資料；當該表沒有目標時，MAY 使用最新已發布且 `sourceReview=verified` 的選股 snapshot 所鎖定的 `screener_universe` 單一 ordinary-stock 資料作為 fallback。fallback MUST 驗證 revision、`review=verified`、official classification、市場後綴與名稱，MUST NOT 使用未發布、未驗證或 client-supplied metadata，也 MUST NOT 觸發 provider fetch。系統 MUST 保留 `.TW`／`.TWO` identity，不得以裸代碼猜測上市櫃市場。若同一使用者已有多個名稱正規化後精確為「選股篩選」的個人頁籤，或保留 tab identity 被其他名稱佔用，系統 MUST fail closed。

#### Scenario: 上市商品驗證成功

- **WHEN** 請求提供 catalog 中一致的 `2449.TW` canonical identity
- **THEN** 系統 MUST 將 `2449.TW` 寫入目標頁籤，不得改成裸代碼或 `.TWO`

#### Scenario: 上櫃商品驗證成功

- **WHEN** 請求提供 catalog 中一致的 `.TWO` canonical identity
- **THEN** 系統 MUST 保留 `.TWO` 後綴及其 catalog market／provider 資訊

#### Scenario: 本地化 catalog 沒有真實選股商品

- **WHEN** `2454.TW` 不在 `instrument_catalog`，但存在於最新已發布 verified snapshot 所鎖定的 `screener_universe`，且列內 identity 完整一致
- **THEN** 系統 MUST 以該 server-side verified universe 資料驗證並加入 `2454.TW`
- **AND** 系統 MUST NOT 發出 provider 請求、寫入 catalog 或使用 client 名稱補齊資料

#### Scenario: 商品 identity 無法驗證

- **WHEN** symbol 不在 catalog、後綴與市場矛盾或商品不是支援的台股 STK
- **THEN** 系統 MUST 拒絕寫入並回覆可診斷錯誤，MUST NOT 以名稱或裸代碼猜測商品

#### Scenario: 多個同名頁籤或保留 identity 衝突

- **WHEN** 系統發現多個「選股篩選」個人頁籤，或保留 identity 已屬於不同名稱頁籤
- **THEN** 系統 MUST 拒絕選擇、合併或改寫任一頁籤，並回覆衝突錯誤

### Requirement: MultiView 同步必須限制在固定本機寫入邊界

5173 gateway MUST 僅接受固定 method、固定 schema 與固定用途 path，並只可轉送至已設定的 loopback MultiView endpoint。client MUST NOT 指定 target host、URL 或任意 downstream method；MultiView endpoint MUST 沿用 request principal 隔離不同使用者資料。

#### Scenario: 合法同源同步請求

- **WHEN** 5173 收到符合 schema 的選股清單同步 POST
- **THEN** gateway MUST 只轉送允許欄位至固定 loopback MultiView endpoint，且回傳結構化結果

#### Scenario: 嘗試指定任意目標

- **WHEN** client payload 夾帶 target URL、host、path、method 或非允許欄位以改變轉送目標
- **THEN** gateway MUST 拒絕或忽略該控制資訊，且 MUST NOT 對任意網路目標發出請求

#### Scenario: 使用者資料隔離

- **WHEN** 不同 principal 加入相同商品
- **THEN** MultiView MUST 只查找及修改各自的 `user_tabs` 與 `user_instruments`

### Requirement: MultiView 開啟頁面必須在重新聚焦時收斂且不改變目前視圖

已開啟的 MultiView 頁面 MUST 在 window focus 或 document 由 hidden 恢復 visible 時，以 single-flight 唯讀刷新個人頁籤及商品。刷新 MUST NOT 輪詢、切換目前頁籤、改變目前圖表商品或改寫交易草稿。

#### Scenario: 回到已開啟的 MultiView

- **WHEN** 其他頁面已新增「選股篩選」商品，使用者再聚焦或恢復顯示 MultiView
- **THEN** MultiView MUST 重抓並顯示最新頁籤內容一次，同時保持原作用中頁籤與圖表選取

#### Scenario: focus 與 visibility 連續觸發

- **WHEN** 同一輪回到頁面同時觸發多個 focus／visibility 事件
- **THEN** 系統 MUST 合併為 single-flight refresh，不得建立並行重抓或持續 polling

### Requirement: 選股同步不得觸發 MultiView 資料與 runtime 副作用

用途明確的同步 endpoint MUST 僅建立或更新目標 `user_tabs` 與 `user_instruments`，並回讀確認結果。它 MUST NOT 觸發行情訂閱、籌碼預熱、provider 回補、DDL、委託、帳務寫入或 5173／5174 runtime 啟停。

#### Scenario: 成功加入 MultiView 清單

- **WHEN** endpoint 成功建立頁籤或加入商品
- **THEN** 既有行情連線、訂閱 demand、籌碼 pipeline、交易狀態與服務生命週期 MUST 保持不變

#### Scenario: MultiView 同步失敗

- **WHEN** endpoint 因服務、catalog、D1 或唯一性問題失敗
- **THEN** 系統 MUST 回覆失敗且不得以預熱、回補、訂閱或 runtime restart 作為隱性補救
