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

### Requirement: MultiView 啟動入口必須在目標服務未啟動時仍可診斷
RealTimeStock MUST 以不依賴 5174 process 的 loopback launcher 開啟 MultiView，並在導向 5174 前以有界 timeout 判斷本機服務狀態。launcher MUST 不修改目前 workspace，且 MUST 對服務未啟動、Shioaji business session 離線、使用延遲 fallback、盤後資料異常與正常可用提供可見狀態及精確重試指引。

#### Scenario: 5174 未啟動
- **WHEN** 使用者從「版面」開啟 MultiView 且 5174 無法連線
- **THEN** 新分頁 MUST 留在 5173 launcher 並顯示 MultiView 未啟動、重試按鈕與本機 runtime 啟動指引
- **AND** 目前 RealTimeStock workspace MUST 保持不變

#### Scenario: MultiView 可用
- **WHEN** launcher 取得合法且顯示 simulation 的 5174 health
- **THEN** launcher MUST 導向既定 5174 MultiView URL

#### Scenario: Shioaji 離線但延遲來源可用
- **WHEN** 5174 正常但 Shioaji business request 失敗且 Yahoo 延遲來源可用
- **THEN** launcher 或 MultiView MUST 顯示行情為延遲 fallback、來源狀態與可重試操作
- **AND** 不得把 HTTP health 或 SSE heartbeat 冒充即時行情可用

### Requirement: MultiView 全商品可選擇分鐘與日週月 K
本機 MultiView 的 UI、config、URL parser、localStorage migration、prefetch、batch 與 candle API MUST 共用 `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo` allowlist，預設 MUST 為 `1d`，且 UI MUST 將 canonical `1h` 顯示為 `60m`、`1wk` 顯示為週、`1mo` 顯示為月。本機選單 MUST 依序顯示 1m、5m、15m、60m、日、週、月七項；`intraday`、3m、30m、4h 與其他 interval MUST 不得出現在本機選單。Cloudflare／Sites MUST 維持既有 feature-off interval 與發布狀態，不得因本 change 自動開放分鐘 K、realtime 或觸發部署。

#### Scenario: 新開本機 MultiView
- **WHEN** URL 與已保存設定沒有合法本機 interval
- **THEN** 每個 panel MUST 預設選擇日 K
- **AND** 選單 MUST 依序只顯示 1m、5m、15m、60m、日、週、月

#### Scenario: 舊設定保存週月或分時
- **WHEN** 本機 localStorage 或分享 URL 含 `1wk`、`1mo`、`intraday` 或其他不在新 allowlist 的 interval
- **THEN** 系統 MUST 保留合法的 `1wk`、`1mo`，並只將 `intraday` 或其他非法 interval 正規化為 `1d`
- **AND** 商品、panel 數量、panel 順序、指標、註記與其他個人設定 MUST 保持不變

#### Scenario: UI 的 60m 使用 canonical 1h
- **WHEN** 使用者選擇畫面上的 `60m`
- **THEN** URL、cache key、batch、stream 與 candle API MUST 使用 canonical `1h`
- **AND** readout、狀態文字及匯出 MUST 顯示使用者可辨識的 `60m`

#### Scenario: 所有圖表數量顯示目前時間週期
- **WHEN** 使用者選擇 1、2、3、4、6 或 8 個圖表
- **THEN** 每個 panel 的時間週期下拉選單 MUST 完整顯示目前選取的 1m、5m、15m、60m、日、週或月標籤
- **AND** 緊湊工具列 MUST NOT 以空白欄位、只有箭頭或裁切文字取代目前週期

#### Scenario: 手動呼叫停用 interval
- **WHEN** client 直接請求本機 `/api/candles`、batch 或 stream 並指定 `intraday` 或其他停用 interval
- **THEN** API MUST 回明確 `unsupported_interval`，不得取得或顯示該週期資料

#### Scenario: 遠端部署維持 feature-off
- **WHEN** Cloudflare／Sites build 或 runtime 讀取 interval config
- **THEN** 系統 MUST NOT 因本機 allowlist 回傳已啟用分鐘 K 或 Shioaji realtime capability
- **AND** 本 change MUST NOT 要求遠端部署、多帳戶或正式站驗收
