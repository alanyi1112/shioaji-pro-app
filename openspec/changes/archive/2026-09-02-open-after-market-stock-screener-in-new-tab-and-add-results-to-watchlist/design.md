## Context

目前 `StockScreenerPanel` 由 `TradingApp` 直接當成 workspace block 渲染，並以同一棵 React tree 內的 callback 取得未鎖定圖表清單及更新指定 K 線。篩選結果本身是一個可啟用的列按鈕，既有規格刻意禁止點列時修改自選清單或交易狀態。

MultiView 已在「版面」選單使用開新分頁入口。選股新頁不應只搬出 `StockScreenerPanel`，而必須保留完整交易終端、頂部工具列與可直接連動的 K 線圖。同時，新頁的版面狀態不能污染來源主頁的持久化 workspace。自選清單的既有 `addSymbol` 只寫入目前作用中的清單，也不能直接滿足固定寫入「選股」且不切換作用中清單的需求。

## Goals / Non-Goals

**Goals:**

- 從「版面」下拉選單的「選股篩選」入口開啟完整交易終端新分頁，套用左選股、右 K 線的專用 workspace。
- 讓新分頁 workspace 只存在於該分頁 session，不修改來源主頁的持久化 workspace。
- 保留「＋新增面板」中「選股」原有的 singleton 內嵌 block 行為。
- 讓選股只連動新頁同一 workspace 中仍存在且未鎖定的目標 K 線。
- 在每筆結果右上方提供與結果內容啟用互不干擾的「加入清單」動作。
- 冪等建立或使用名稱精確為「選股」的自選清單，寫入成功後跨分頁收斂到同一後端狀態，且不切換目前作用中的清單。
- 保留既有內嵌選股 block 的載入相容性與結果點選安全邊界。

**Non-Goals:**

- 不新增批次全選、移除商品、重新命名「選股」清單或跨清單搬移功能。
- 不改變選股公式、全市場底稿、5174 資料補齊排程或官方資料來源。
- 不把選股結果自動加入清單，也不因開啟分頁啟動、停止或重啟 5173、5174、Shioaji 或其他 runtime。
- 不啟用 production、真實下單、交易 API 或新的行情訂閱。
- 不把既有 workspace／profile 中的 `screener` block 靜默刪除或自動開新分頁。

## Decisions

### 1. 使用同源 `?layout=stock-screener` 開啟完整交易終端

`src/main.tsx` 對 `layout=stock-screener` 仍渲染 `TradingApp`；`App.tsx` 在初始化 workspace 時載入專用 24 欄版型，左側選股 5 欄、右側 K 線 19 欄，兩者皆高 29 grid rows。「版面」選單透過專用 opener 同步呼叫 `window.open(..., '_blank', 'noopener')`，不呼叫來源頁的 `onLoadPreset` 或 `addBlock`。由於 `noopener` 在成功與阻擋情形都可能回傳 `null`，介面不以此回傳值顯示自製阻擋通知；實際阻擋由瀏覽器原生指示負責。

替代方案是繼續使用 `?popout=screener` 的單一選股根頁面，但它會缺少頂部工具列與右側 K 線，不符合使用者指定的版型，因此不作為「版面 → 選股篩選」的入口。

### 2. 新入口與舊版面採非破壞式相容

`screener` 完整保留在「＋新增面板」的既有位置、「選股」名稱、singleton 停用條件與 `addBlock` 行為。`BlockType`、block renderer 與 storage schema 也維持不變，使現有 workspace／具名版面能繼續載入、操作、移除及保存內嵌選股面板。「版面」內的「選股篩選」是獨立 action，不自動改寫 localStorage，也不在 profile 載入時開分頁。

替代方案是載入時刪除全部舊 block，但這會無聲改寫使用者已保存版面，且自動開頁會受到瀏覽器 popup policy 影響，因此不採用。

### 3. 專用新頁 workspace 採 session-only 持久化邊界

`loadWorkspaceForLayout()` 只在 query 為 `stock-screener` 時回傳專用 workspace；`updateWorkspace()` 在此模式不呼叫 `saveWorkspace()`。因此新頁可在該 session 內拖拉、縮放、新增或移除面板，但不會覆寫來源頁的 `sj-pro-workspace-v2`。選股點選直接使用同一 React tree 的 chart selection callback，無需跨分頁尋找來源圖表。

### 4. 結果卡片分為內容 action 與右上方清單 action

結果卡片不再由單一外層 `<button>` 包住全部內容，而以可鍵盤啟用的內容 action 與同層「加入清單」按鈕組成。清單按鈕使用 `stopPropagation` 只是額外保護，DOM 結構本身不得形成巢狀 button。焦點順序、可辨識名稱與 loading／success／error live feedback 必須獨立；按清單按鈕不得送出 chart pick，啟用內容也不得送出 watchlist mutation。

### 5. 新增指定名稱清單的冪等 mutation，而不重用 active-list `addSymbol`

watchlist domain 層新增「依名稱加入商品」操作：解析篩選結果為合法 STK 合約，重抓清單，尋找正規化後名稱精確為「選股」者；不存在時以空合約或首個合約建立，再以後端回傳 id 完成加入。已包含相同 canonical 合約時回覆 `already_present` 成功終態。兩分頁同時建立造成 duplicate/conflict 時，操作重抓清單並只採用唯一合法同名清單；其他錯誤不得自動宣稱成功。

此操作不得寫入目前作用中清單的 localStorage key，也不得呼叫既有會切換 active list 的 `createList`。成功後以不含敏感資訊的跨分頁 invalidation 事件通知其他頁重抓清單；若目前作用中清單不是「選股」，只刷新清單 metadata，不改變使用者目前選擇。

替代方案是先切換作用中清單再呼叫既有 `addSymbol`，但會造成可見導覽副作用與跨分頁競態，因此不採用。

### 6. 成功狀態以後端確認為準

按鈕狀態至少區分 `idle`、`pending`、`added`／`already_present` 與 `error`。只有 create/add 成功回覆或重抓確認商品已存在時才顯示「已加入」。斷線、合約不合法、同名清單異常或 API 失敗時保留可重試錯誤，不能只改前端陣列冒充持久化成功。

## Risks / Trade-offs

- [內嵌選股面板與獨立選股分頁共存，容易混淆] → 選單名稱與位置明確區分：「＋新增面板 → 選股」新增 block，「版面 → 預設版面 → 選股篩選」開新分頁，並以測試防止兩者行為互換。
- [新頁拖拉或移除面板污染來源版面] → `layout=stock-screener` 模式的 workspace update 不寫入共用 current-workspace storage key，並以單元測試與雙頁實測驗證。
- [多分頁同時建立「選股」清單] → 後端寫入後重抓、duplicate/conflict recovery 與 canonical contract 去重；仍出現多個同名清單時停止並提示，不任意選取。
- [按鈕與結果列 click／keyboard 事件互相穿透] → 使用同層互斥 action、事件測試與實際鍵盤驗收，不依賴單一 `stopPropagation`。
- [跨分頁同步通知遺失] → 後端清單 API 是唯一真相；頁面取得焦點、切換清單或收到 invalidation 時均重抓，不依賴通知保存資料。
- [5174 離線被誤認為分頁開啟失敗] → 分頁仍正常呈現，選股資料狀態沿用既有 pending／offline 語意，不自動操作 runtime。
- [`noopener` 使成功開頁仍回傳 `null` 而被誤報為 popup blocked] → 保留原生 `noopener` 隔離，不再以歧義回傳值觸發自製 alert；實際阻擋交由瀏覽器原生指示呈現。

## Migration Plan

1. 增加指定名稱 watchlist mutation、冪等與競態測試，再接上結果卡片按鈕。
2. 建立 `stock-screener` 專用 workspace 與 session-only 載入／更新邊界。
3. 將「版面」選單預設版面區的「選股篩選」接到 `?layout=stock-screener` opener，保留「＋新增面板」的 `screener` block 建立、singleton 與 storage 語意。
4. 完成完整交易終端 DOM、5／19 欄版型、workspace 隔離、雙分頁 live 驗收及副作用對帳後交付。

## Open Questions

目前沒有阻擋實作的未決問題；本 change 依已確認的非破壞式舊版面相容策略執行。
