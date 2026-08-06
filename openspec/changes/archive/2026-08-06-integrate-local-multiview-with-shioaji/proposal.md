## Why

RealTimeStock 目前只能在單一交易工作區觀看行情，缺少可同時比較最多八張圖、保留既有台股籌碼與盤後回補能力的本機 MultiView。參考 repo 已具備完整多圖介面與盤後資料管線，但台股盤中仍依賴延遲來源且原本以 Cloudflare／Sites 為執行目標，因此需要以可追溯授權的固定版本整合到本專案，改由同一台 Mac 的 Shioaji API 在 simulation 提供即時行情，並維持資料專用、不可直接交易的安全邊界。

## What Changes

- 以 `MultiChartOnCodexSite` 最新、乾淨且已補齊授權聲明的固定 commit 匯入 `apps/multiview/`，保存 upstream URL、branch、完整 SHA、匯入日期與本地修改紀錄；自有程式採 `AGPL-3.0-only`，Lightweight Charts v5.0.9 維持 `Apache-2.0`、提供第三方聲明與 TradingView attribution，並改用本機固定 dependency 而非 unpkg CDN。
- 將 MultiView 改成本機、loopback-only 的獨立 Web／Worker 服務與本機 D1／Miniflare 儲存，由 RealTimeStock runtime 統一啟動、停止、重啟、健康檢查與狀態顯示；不得把 Shioaji 秘密、CA、帳戶識別或即時 Tick 寫入 repo、D1 或一般 log。
- 在 RealTimeStock「版面」選單新增 `MultiView（開新分頁）`，同步開啟本機 MultiView，不替換目前 workspace；RealTimeStock 與 MultiView 的「我的清單」、商品內容、排序及儲存空間保持獨立。
- 對所有商品停用分 K 與分時模式，只允許日、週、月 K，預設日 K；UI、URL、已保存狀態與 API 都不得繞過限制。
- 台股盤中最新價與當期未完成日／週／月 K 棒以本機 Shioaji Snapshot／SSE 為主，Yahoo 延遲行情為可見且可手動選擇的備援；已完成歷史 K 棒、TWSE／TPEx 收盤核定與盤後籌碼資料維持既有 canonical 管線，禁止靜默混合不同來源的同一當期資料。
- 對目前可見且已選取的技術指標，以接受後的即時 K 棒重新計算尾端結果；同頁重複商品必須共用訂閱、去重、節流並採 latest-wins，最多八圖時不得因每筆 Tick 重抓完整歷史或反覆建立 pane。
- 非台股商品維持原本資料來源、歷史、技術指標及盤後行為；台股籌碼、本益比河流、TDCC、TWSE、TPEx、FinMind 等下載、驗證與回補邏輯維持原資料語意，改由本機 D1 與本機排程執行並提供可復原的初始化、備份及回補驗收。
- MultiView 主圖右鍵選單新增「下單」，只對可安全映射為 RealTimeStock 商品契約的台灣商品開啟既有 `OrderTicket` popout，僅傳遞商品識別；不得預填帳戶、買賣別、價格或數量，也不得由 MultiView 直接呼叫任何下單、改單或刪單 API。
- 第一階段只支援 simulation；MultiView 在任何非 simulation 模式都必須停止或 fail closed，不取得該模式的 Shioaji 行情、不載入 CA、不啟用 `production-trading`、不執行真實委託。未來任何正式環境行情或交易能力都必須另立 change。

## Capabilities

### New Capabilities

- `multiview-source-governance`: 定義參考 repo 固定版本匯入、AGPL／Apache 授權、第三方聲明、TradingView attribution、來源追蹤與未來 upstream 更新規則。
- `multiview-local-runtime`: 定義 MultiView loopback-only 服務、本機 D1、統一 runtime 生命週期、健康診斷、資料專用 Shioaji adapter 與秘密隔離。
- `multiview-workspace-navigation`: 定義「版面」開新分頁、日／週／月週期限制、非台股相容行為，以及兩套清單與設定保持獨立。
- `multiview-taiwan-realtime-market-data`: 定義台股商品映射、Snapshot／SSE 訂閱、日週月未完成 K 棒、即時技術指標、來源模式、新鮮度、延遲 fallback 與收盤 canonical handoff。
- `multiview-after-hours-data`: 定義既有台股盤後資料、籌碼、PE、TDCC 回補在本機 D1 的保存、排程、備份、初始化、來源日期與故障復原。
- `multiview-order-ticket-bridge`: 定義右鍵「下單」的商品資格、跨分頁 popout、最小訊息契約與不得直接交易的安全邊界。

### Modified Capabilities

- `safe-local-runtime-mode-switch`: 將 MultiView Web／Worker 與本機資料服務納入 simulation 的啟動、狀態診斷及自動回復流程；進入任何非 simulation 模式時停止 5174 並維持 fail-closed。

## Impact

- 專案結構：新增 `apps/multiview/`、upstream provenance、授權／第三方聲明、本機 D1 狀態與 migration／seed 工具。
- RealTimeStock 前端：`src/components/hud-header.tsx`、新分頁 URL 設定、OrderTicket popout 商品解析及可見錯誤狀態。
- RealTimeStock runtime：`scripts/realtimestock-runtime`、LaunchAgent、5174 listener、健康檢查、simulation 啟動，以及非 simulation 模式停止 5174 的隔離行為。
- MultiView 前端／Worker：週期選單、圖表即時 overlay、指標尾端重算、訂閱 coordinator、資料來源狀態、右鍵選單、Shioaji data-only proxy 與本機 API 路由。
- 資料：本機 D1／Miniflare、既有 Yahoo／TWSE／TPEx／TDCC／FinMind 管線、必要的一次性 seed 或最小化遷移；RealTimeStock watchlist 不與 MultiView 個人清單合併。
- 安全：只允許 simulation 行情與商品查詢端點，非 simulation 模式回 `simulation_required`，交易 API 不得經 MultiView adapter 轉送；所有秘密以本機權限受限方式管理並不得進入 OpenSpec、Git 或 log。
- 驗證：授權掃描、來源 SHA、單元／契約／browser 測試、1／2／3／4／6／8 圖、斷線 fallback、盤後回補及 simulation 端到端；不包含任何正式環境行情或交易驗收。
