## Context

收盤後選股頁目前透過 `stock-screener-watchlist.ts` 驗證 Shioaji STK 合約，並將商品冪等加入名稱精確為「選股」的自選清單。MultiView 使用另一套 D1 persistence：`user_tabs` 保存個人頁籤，`user_instruments` 以 `(user_id, symbol, tab_id)` 保證同一頁籤內商品唯一。兩套應用分別由本機 5173 與 5174 提供服務；瀏覽器不能依賴任意跨來源 POST，既有 screener gateway 也只有固定用途的唯讀能力。

這項變更跨越 React 選股介面、5173 本機 gateway、MultiView worker 與 MultiView 前端收斂行為。它必須在 mixed worktree 中維持既有 Shioaji 行為，並確保任何一端暫時不可用時不會把另一端已成功的資料假裝回滾。

## Goals / Non-Goals

**Goals:**

- 一次明確的「加入清單」操作，同步要求寫入 Shioaji「選股」與 MultiView「選股篩選」。
- 以兩端各自的後端確認為準，支援 `added`、`already_present`、失敗與部分成功的真實狀態。
- 讓 MultiView 頁籤與商品建立在重複點擊、重送及雙分頁併發時仍可冪等收斂。
- 驗證 canonical 台股商品 identity，保留 `.TW`／`.TWO` 市場後綴，不以裸代碼猜測市場。
- 保持 Shioaji 與 MultiView 目前作用中的清單、商品、圖表及交易草稿不變。

**Non-Goals:**

- 不將兩套資料庫合併，也不建立跨資料庫分散式 transaction 或補償刪除。
- 不同步刪除、重新排序、改名或將既有其他清單內容搬入「選股篩選」。
- 不自動切換 MultiView 頁籤、開啟 MultiView 視窗、訂閱行情、預熱籌碼資料或回補歷史資料。
- 不支援 production 交易、委託、帳務寫入或 runtime 啟停。
- 不提供可轉送任意 URL、method 或 payload 的通用代理。

## Decisions

### 1. 使用雙端獨立 mutation 與可組合結果，不做分散式回滾

選股前端 orchestration 會分別呼叫既有 Shioaji helper 與新的 MultiView helper，並保留每一端的 `added`、`already_present` 或錯誤。任一端成功後不得因另一端失敗而刪除已寫入資料；重新操作時兩端都可安全重送，已成功端以 `already_present` 收斂，未成功端再次嘗試。

選擇此方案是因為兩套服務沒有共同 transaction 邊界，補償刪除可能誤刪使用者原本已有的商品。替代方案「第一端失敗就不呼叫第二端」會讓可用服務無法完成，也無法滿足獨立可重試需求，因此不採用。

### 2. 以固定用途的 5173 loopback gateway 連接 MultiView

瀏覽器只呼叫 5173 同源的固定路徑，例如 `POST /local-multiview/api/v1/stock-screener-list/items`。gateway 僅接受預定 schema，並只轉送至已設定的 loopback MultiView endpoint；method、target host 與 path 均不可由 client 指定。MultiView worker 另提供用途明確的 endpoint，沿用既有本機 request principal 與 D1 user scope。

不直接放寬 5174 CORS，因為那會擴大跨來源 mutation 面；也不擴充既有 screener 唯讀代理為通用 proxy，以免建立 SSRF 或未授權寫入邊界。

### 3. MultiView 後端負責 ensure-tab-and-item

MultiView endpoint 接收選股結果的 canonical symbol，使用 server-side instrument catalog 驗證市場、provider、名稱與 identity，再執行以下流程：

1. 查找目前 principal 下，正規化後名稱精確為「選股篩選」且 `source_tab_id=''` 的個人頁籤。
2. 找到一個時沿用；找到多個時 fail closed，不自行挑選或合併。
3. 找不到時使用保留給此 integration 的穩定 tab id 建立非預設、啟用中的個人頁籤；若該 id 已被不同名稱佔用則 fail closed。
4. 在同一個 D1 transaction／batch 中建立頁籤（如需要）並 upsert `(user_id, canonical symbol, tab_id)` 商品，回讀確認唯一頁籤及唯一商品後才回覆成功。

穩定 tab id 與資料庫 primary key 會讓兩個請求同時建立頁籤時收斂到同一 identity。不能只用 client 先讀再連續呼叫既有 `/api/tabs` 與 `/api/instruments`，因為中途失敗與併發都可能留下重複頁籤或錯誤目標。

### 4. Client 只提供 identity，server catalog authority 為權威

前端從 `UniverseStock.symbol` 傳送包含 `.TW` 或 `.TWO` 的 canonical symbol，以及僅供一致性比對的顯示資訊；MultiView 必須以自己的 server-side catalog authority 查到同一商品後才可寫入。先使用 `instrument_catalog` 的精確 symbol 資料；若該表沒有商品，才可從最新已發布、`sourceReview=verified` 的選股 snapshot 取得 `universeRevision`，並以該 revision 下的 `screener_universe` 單一列作為 fallback。fallback 必須重新驗證 `review=verified`、official ordinary-stock classification、市場後綴、名稱與 revision 一致性；不得使用未發布、部分收集或 client-supplied metadata。

查無商品、後綴不符、provider／市場矛盾或非台股 STK 時拒絕 mutation，不從裸代碼推測上市櫃市場。fallback 只讀取已持久化的驗證資料，不觸發 provider fetch 或更新 `instrument_catalog`。

這可避免兩套應用的顯示名稱或市場分類漂移，也防止 client 任意建立 catalog 外商品。

### 5. UI 以兩端確認決定整體狀態

按鈕 pending 期間阻擋同一卡片重複送出。結果模型保留 `shioaji` 與 `multiview` 子狀態：兩端都確認存在才顯示整體「已加入」；兩端都原已存在可顯示「兩邊原已存在」；只有一端成功時顯示已完成端、失敗端與可重試提示。錯誤資訊須可診斷但不得包含憑證或內部秘密。

卡片內容的 chart pick 與加入按鈕仍維持事件隔離。加入成功不切換 Shioaji 作用中清單，也不導向或切換 MultiView 頁籤。

### 6. MultiView 以 focus／visibility 事件做唯讀收斂

已開啟的 MultiView 頁面在 window focus 或 document 恢復 visible 時，以 single-flight 方式重抓個人頁籤與商品；多個短時間事件合併為一個 request。刷新只更新清單 model，若目前作用中頁籤不是「選股篩選」，不得切換頁籤或重選圖表；不新增 polling。

跨來源應用無法安全共用既有同源 invalidation channel，因此選擇生命週期事件上的唯讀刷新。它能在使用者回到 MultiView 時收斂，同時避免背景輪詢與隱性訂閱。

### 7. 同步 endpoint 不沿用會觸發預熱的互動式 save side effects

用途明確的 integration endpoint 只寫 `user_tabs` 與 `user_instruments` 並回讀確認，不呼叫 watchlist chip prewarming、行情訂閱或 service lifecycle 管理。使用者之後在 MultiView 正常操作該頁籤時，才沿用 MultiView 既有載入與訂閱政策。

## Risks / Trade-offs

- [兩端無法原子提交] → 明確呈現部分成功，保留已成功資料，並以冪等重試收斂；禁止補償刪除。
- [既有資料已有重複「選股篩選」頁籤] → fail closed 並回報需整理的衝突，不自行合併或猜測目標。
- [兩個請求同時建立頁籤] → 使用固定 integration tab id、D1 primary key 與 transaction／batch，再回讀確認唯一性。
- [MultiView 未執行] → Shioaji 結果仍可成功；介面標示 MultiView 未完成並允許稍後重試。
- [`instrument_catalog` 僅有本地化 seed] → 精確 symbol 缺少時，只讀取最新已發布 verified snapshot 所鎖定的 `screener_universe`；未知、ETF、未發布或矛盾 identity 仍 fail closed。
- [focus 與 visibility 事件短時間重複] → 以 single-flight 合併，不使用持續 polling。
- [新增本機寫入邊界] → 僅允許固定 loopback target、固定 path、固定 method 與受限 schema，測試非 loopback／任意 path 均被拒絕。

## Migration Plan

1. 先新增 MultiView worker endpoint、D1 冪等 transaction 與單元／整合測試；沿用現有資料表，不執行 schema migration。
2. 新增 5173 固定用途 gateway 與安全邊界測試。
3. 新增前端 MultiView client 與雙端 orchestration，再更新按鈕狀態與 browser tests。
4. 加入 MultiView focus／visibility 唯讀刷新與不切換頁籤的測試。
5. 在本機 simulation 環境驗證缺少頁籤、既有頁籤、重複加入、雙分頁併發、`.TW`／`.TWO`、5174 中斷與恢復重試。

回滾時先停止前端雙端呼叫並恢復只寫 Shioaji；保留已建立的「選股篩選」個人頁籤與商品，不自動刪除使用者資料。worker endpoint 與 gateway 可在沒有呼叫端時安全停用。

## Open Questions

- 無。頁籤名稱固定為「選股篩選」，Shioaji 目標仍固定為「選股」，且本 change 不處理刪除或雙向同步。
