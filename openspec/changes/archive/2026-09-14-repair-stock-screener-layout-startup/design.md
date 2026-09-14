## Context

`TradingApp` 以 `useWatchlist().initialLoading` 控制 grid 是否渲染。`useWatchlist` 的初始化會讀取 server watchlists、選定作用中清單、解析其中每個商品，接著為每檔建立 Tick／BidAsk 或 Quote 訂閱；只有全部流程 settled 後才把 `initialLoading` 設為 false。這對一般交易 workspace 有其既有用途，但 `layout=stock-screener` 的核心資料來自 5174 收盤後選股底稿，`layout=intraday-stock-selection` 的核心資料來自本機監控狀態／設定／結果 API 與 SSE。兩者都只在使用者點選結果或商品時才需要載入指定圖表，因此不應等待整份作用中清單。

現場重現顯示 opener、URL 與 layout 都正確；Chrome 文件已完成、console 無錯誤，盤中選股仍超過四分鐘停在「載入交易終端…」。既有政策測試甚至明確要求 intraday 使用完整 hydrate／subscribe，證明先前為避免干擾 160 驗證而保留舊政策的假設不成立。

## Goals / Non-Goals

**Goals:**

- 讓 `layout=stock-screener` 與 `layout=intraday-stock-selection` 在各自主資料服務可獨立運作時立即呈現專用 workspace。
- 只讀取專用頁確實需要的 watchlist metadata，不解析或訂閱作用中清單全部商品。
- 保留「加入清單」既有按鈕、指定「選股」清單的冪等寫入，以及使用者點選結果後的單一圖表連動。
- 以自動化測試證明 pending watchlist 不會阻塞畫面，且開頁不會替作用中清單建立行情訂閱。

**Non-Goals:**

- 不重寫一般交易 workspace 的 watchlist boot、離線復原或行情訂閱流程。
- 不改動盤中監控的 KBar transport、SSE、cohort、Gate、baseline、通知或 160 檔驗證流程。
- 不改變收盤後選股公式、5174 資料、圖表 K 線來源或自選清單持久化格式。
- 不啟用 production、交易寫入或服務重啟。

## Decisions

### 1. 將 watchlist 啟動需求明確建模為選項

`useWatchlist` 接受 `hydrateActiveList` 與 `subscribeQuotes` 選項，預設值皆為 true，確保一般交易 workspace 維持原行為。`layout=stock-screener` 與 `layout=intraday-stock-selection` 兩者皆設為 false：初始化仍取得清單 metadata 與作用中清單 id，但不解析清單內商品、不建立行情訂閱，並把內部 `loading` 結束。

只在 `App.tsx` 跳過 loading 畫面雖能讓 UI 出現，背景仍會建立數十筆不必要訂閱且占用 API；完全移除 `useWatchlist` 又會牽動 header、清單 invalidation 與共用 props。選項能以最小差異保留 metadata 與現有 hook API。

### 2. 兩個專用資料版面不以 initialLoading 作為 grid 閘門

`TradingApp` 依 `WORKSPACE_LAYOUT_ID` 判斷：`stock-screener` 與 `intraday-stock-selection` 都忽略 `initialLoading`，在 container mounted 後直接渲染。右側圖表初始沒有商品時沿用既有「等待商品」狀態；使用者點選選股或盤中結果後，既有 `screenerSelection` 才解析該商品並取得 Snapshot。盤中監控的資料 active、SSE 與 KBar transport 不經 `useWatchlist`，所以這項修正不會新增或取代 160 檔監控訂閱。

### 3. 測試政策與實際入口

新增可直接驗證的 layout watchlist 啟動政策，確認兩個專用頁採 metadata-only、一般 workspace 維持完整模式；在 browser／整合層讓 watchlist 保持 pending，確認專用面板仍出現。對行情 API 使用 spy 記錄，證明開頁階段沒有作用中清單的 `/api/v1/stream/subscribe`；再以實際 Chrome 從版面選單開頁，核對 URL、左右面板、console 與載入時間。

## Risks / Trade-offs

- [專用分頁初始 K 線沒有作用中清單商品] → 顯示既有等待商品狀態；第一次點選結果後才載入該檔，符合兩種選股操作目的。
- [metadata 請求本身卡住] → grid 不再等待 `initialLoading`，選股底稿仍可獨立顯示；需要清單時由既有按鈕流程自行取得後端真相。
- [選項誤套到一般 workspace] → 預設保留完整 hydrate／subscribe，並測試 null 與未知 layout 維持完整模式。
- [既有大量未提交變更造成誤覆寫] → 僅在目前檔案上做小範圍 patch，不重置、不 checkout、不整理其他差異。

## Migration Plan

1. 新增 layout 對應的 watchlist 啟動政策與測試。
2. 讓 `useWatchlist` 支援預設相容的 metadata-only 模式，接到兩個專用資料 layout。
3. 調整專用 layout 的 grid boot gate，加入 pending 初始化回歸測試。
4. 執行 focused、browser、build、OpenSpec strict 與實際 Chrome 驗收。

回退時只需還原上述啟動政策與 hook 選項；沒有資料 migration。

## Open Questions

目前沒有阻擋實作的未決問題。
