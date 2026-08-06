# multiview-workspace-navigation Specification

## Purpose
TBD - created by archiving change integrate-local-multiview-with-shioaji. Update Purpose after archive.
## Requirements
### Requirement: 版面選單必須以新分頁開啟 MultiView
RealTimeStock「版面」選單 MUST 提供 `MultiView（開新分頁）` action，click MUST 同步開啟設定的 loopback MultiView URL，且 MUST NOT 套用、覆寫、保存或重設目前 workspace。MultiView MUST NOT 被當成 `LAYOUT_PRESETS` 的一般 panel preset。

#### Scenario: 從版面選單開啟
- **WHEN** 使用者點擊 `MultiView（開新分頁）`
- **THEN** 瀏覽器開啟或聚焦 MultiView 分頁，原 RealTimeStock workspace、選取商品與 layout 保持不變

#### Scenario: 5174 未啟動或 popup 被阻擋
- **WHEN** 新分頁無法開啟或 MultiView service 不可用
- **THEN** 系統顯示可操作的本機服務提示
- **AND** MUST NOT 將失敗誤報為 workspace 已切換成功

### Requirement: MultiView 全商品只能選擇日週月 K
MultiView 的 UI、config、URL parser、localStorage migration、prefetch、batch 與 candle API MUST 共用 `1d`、`1wk`、`1mo` allowlist，預設 MUST 為 `1d`。1 分、3 分、5 分、15 分、30 分、1 小時、4 小時與 `intraday` MUST 維持停用。

#### Scenario: 新開 MultiView
- **WHEN** URL 與已保存設定沒有合法 interval
- **THEN** 每個 panel 預設選擇日 K，選單只顯示日、週、月

#### Scenario: 舊設定保存分 K
- **WHEN** localStorage 或分享 URL 含 `1m`、`5m`、`1h` 或 `intraday`
- **THEN** 系統 MUST 正規化為 `1d` 並以不破壞其他設定的方式保存新版值

#### Scenario: 手動呼叫停用 interval
- **WHEN** client 直接請求本機 `/api/candles` 或 batch 並指定停用 interval
- **THEN** API MUST 回明確 `unsupported_interval`，不得取得或顯示分 K

### Requirement: RealTimeStock 與 MultiView 清單必須完全獨立
RealTimeStock watchlist 與 MultiView `user_tabs`／`user_instruments` MUST 使用不同 store、API 與 mutation。任一端新增、刪除、排序、重新命名或還原清單 MUST NOT 自動修改另一端。

#### Scenario: 修改 MultiView 我的清單
- **WHEN** 使用者在 MultiView 新增商品、重排頁籤或刪除個人商品
- **THEN** 變更只寫入 MultiView 本機 D1
- **AND** RealTimeStock server-backed watchlist MUST 保持原內容與順序

#### Scenario: 修改 RealTimeStock 自選清單
- **WHEN** 使用者在 RealTimeStock 新增、刪除或重排商品
- **THEN** MultiView 的系統頁籤、個人頁籤與商品內容 MUST 保持不變

### Requirement: 非台股商品功能與資料來源必須維持相容
除週期限制為日／週／月外，美股、匯率債券、期貨期指、Hyperliquid 及其他非台股商品 MUST 沿用參考 repo 的商品 catalog、資料 provider、history、indicator、fallback 與 panel 行為。非台股商品 MUST NOT 呼叫 Shioaji adapter。

#### Scenario: 載入美股頁籤
- **WHEN** 使用者選擇既有美股商品並切換日、週或月 K
- **THEN** 系統使用既有 provider 載入圖表與指標
- **AND** Shioaji contract、Snapshot、subscribe 與 SSE demand MUST 不包含該商品

### Requirement: MultiView 個人設定遷移不得合併交易資料
若使用者選擇保留原 MultiView 個人清單，系統 MUST 只遷移該使用者的 tabs、instruments 與 MultiView 顯示設定，並 MUST remap 至不含 email／帳號的本機 opaque identity。系統 MUST NOT 匯入 Access 名單、登入稽核、Shioaji 帳戶、委託、持倉或 RealTimeStock watchlist。

#### Scenario: 執行最小化個人清單遷移
- **WHEN** 來源資料可合法讀取且使用者選擇保留 MultiView 清單
- **THEN** 匯入結果只含允許的 MultiView tabs／instruments／顯示設定
- **AND** 驗證報告只輸出筆數與安全摘要，不輸出 email 或商品清單全文
