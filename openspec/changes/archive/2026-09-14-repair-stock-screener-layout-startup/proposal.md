## Why

「版面 → 選股篩選」與「版面 → 盤中選股」雖然都能建立正確的新分頁，但專用頁面原本會等待整份作用中自選清單的合約解析與行情訂閱。選股篩選已先解除這項依賴；現場再次證明盤中選股也會在任一未設逾時的請求卡住時，長時間停在「載入交易終端…」。兩個專用資料 workspace 的核心資料都不依賴作用中自選清單行情，因此必須先呈現並讓清單 metadata 在背景收斂。

## What Changes

- 讓 `layout=stock-screener` 與 `layout=intraday-stock-selection` 在 grid 容器就緒後立即呈現左右專用面板，不再以自選清單初始載入作為全頁顯示閘門。
- 為兩個專用資料版面提供只讀 metadata 型 watchlist 啟動模式：可取得清單名稱以支援既有匯入／加入整合，但不解析作用中清單全部合約，也不因開頁建立其 Tick／BidAsk／Quote 行情訂閱。
- 保留一般交易 workspace 現有初始化與行情行為，不改動盤中監控的 KBar transport、SSE、cohort、Gate 或 160 檔驗證邏輯。
- 補上回歸測試與實際瀏覽器驗收，涵蓋兩個專用頁在 watchlist 尚未完成時的可見性、開頁不產生作用中清單行情訂閱，以及使用者點選結果後才載入指定圖表。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `after-market-stock-screener`: 明定專用選股新分頁不得等待作用中自選清單載入，且開頁不得替該清單建立行情訂閱。
- `workspace-layout-management`: 明定 `layout=stock-screener` 與 `layout=intraday-stock-selection` 在清單或行情服務延遲時仍須先呈現專用 workspace。

## Impact

- 前端啟動協調：`src/App.tsx` 的專用 layout boot gate、`workspaceStartupPolicy` 與 `useWatchlist` 呼叫模式。
- 自選清單：`src/hooks/use-watchlist.ts` 的 metadata-only 初始化選項；既有新增、移除、作用中清單與一般 workspace 行為不變。
- 測試：新增 watchlist 啟動政策與專用 layout 回歸測試，並更新 Chrome 端對端驗收。
- 安全邊界：維持 simulation-only，不新增 production、broker write、runtime 啟停或外部資料來源操作。
