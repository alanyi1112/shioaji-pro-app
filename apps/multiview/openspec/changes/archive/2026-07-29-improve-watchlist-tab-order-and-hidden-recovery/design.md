## Context

目前 Worker 以 `systemTabs()` 建立固定順序的系統頁籤，再把 `user_tabs` 全部附加到陣列尾端；若個人資料是某個系統頁籤的 override，原始系統頁籤與 override 仍可能同時出現。前端又自行把可見 `marketTabs` 與未出現在可見清單的 `personalTabs` 合併、依 `sortOrder` 與名稱排序，因而同一份資料在不同消費端可能得到不同結果。

現行 `POST /api/tabs` 只 upsert 單一資料列，沒有驗證排序值是否重複，也不會移動相鄰頁籤；`PATCH /api/tabs/:id` 只更新既有資料列，對尚未建立 override 的系統頁籤會形成無資料異動但回報成功的情況。管理介面以數字欄位與「啟用」勾選框同時負責順序與顯示狀態，隱藏資料仍混在同一清單，因此恢復入口不容易發現。

本變更跨越前端互動、頁籤狀態協調、Worker payload、D1 批次寫入及正式站驗收。既有 `user_tabs` 已具備 `source_tab_id`、`sort_order`、`enabled` 與 `is_default`，設計優先沿用現有 schema 並相容歷史資料。

## Goals / Non-Goals

**Goals:**

- 為每個有效頁籤建立不受資料列 ID 或顯示名稱影響的穩定邏輯身分。
- 由 Worker 組成唯一、可排序且可區分顯示／隱藏狀態的 effective tab model。
- 讓頁籤拖曳與上下移動即時反映，且快速連續操作最終只保存使用者最後看到的順序。
- 以完整清單驗證與 D1 batch 寫入消除重複 `sort_order`。
- 提供可發現的「已隱藏頁籤」區域與明確的取消隱藏操作。
- 讓系統頁籤 override、自訂頁籤刪除、目前頁籤與預設頁籤 fallback 都有可測試的規則。
- 在不遺失既有頁籤或商品資料的前提下相容舊資料並完成正式站可見驗收。

**Non-Goals:**

- 不改變頁籤內商品的既有拖曳排序契約與 `/api/instruments/reorder`。
- 不改變商品資料來源、K 線、指標、SSE 或圖表版面。
- 不把不同裝置的同步擴充為即時多人協作；跨裝置同時修改仍採最後成功寫入為準。
- 不在本變更加入頁籤群組、資料夾、跨帳號分享或復原已永久刪除頁籤。
- 除非實作驗證證明現有欄位不足，否則不新增 D1 schema migration。

## Decisions

### 1. 使用邏輯 `tabKey`，不以顯示名稱或 D1 row ID 判斷有效頁籤

Worker 與前端共同使用下列不透明字串作為邏輯身分：

- 系統頁籤：`system:<system-tab-id>`
- 自訂頁籤：`personal:<user-tab-row-id>`

系統 override 的 D1 row ID 可沿用既有值或使用新 UUID，但其 `tabKey` 一律由 `source_tab_id` 產生。這可讓系統預設與個人 override 合併為同一個邏輯頁籤，也避免改名後失去身分。

替代方案是直接沿用 `id`。此方案無法可靠區分系統原始項目、歷史上以系統 ID 儲存的 override 與真正的自訂頁籤，因此不採用。

### 2. Worker 是 effective tab model 與 canonical order 的唯一來源

Worker 依下列順序組合頁籤：

1. 讀取系統預設頁籤。
2. 依 `source_tab_id` 將每個使用者 override 合併到對應系統頁籤；同一來源若有多筆歷史資料，以可重現規則選擇最後更新的一筆並保留安全診斷。
3. 加入沒有 `source_tab_id` 的自訂頁籤。
4. 以正規化 `sortOrder`、系統預設順序與穩定身分作 deterministic fallback 排序。
5. 產生包含顯示與隱藏項目的 `managedTabs`，再由其中篩選出 canonical `marketTabs`。

`/api/instruments` 與所有頁籤異動 response 都回傳這兩個欄位。前端不得再自行把 `marketTabs` 與 `personalTabs` 拼接成另一份排序；過渡期間如保留 `personalTabs`，它只能作相容欄位，不能作 ordering source。

替代方案是在前端修正合併邏輯。這會讓 API、導覽列與管理器繼續各自解讀資料，無法根除 system override 重複與不同消費端漂移，因此不採用。

### 3. 頁籤排序採完整可見清單、單一批次及前端 latest-wins

新增 `POST /api/tabs/reorder`，request 至少包含 `orderedTabKeys` 與遞增 `revision`。Worker 必須以當前使用者的 effective tabs 驗證：

- `orderedTabKeys` 沒有重複或未知身分。
- 清單恰好包含當下全部可見頁籤，不得遺漏或混入隱藏頁籤。
- 至少保留一個可見頁籤。

驗證成功後，Worker 以單次 D1 batch 將順序寫成 `1..N`。自訂頁籤更新原資料列；系統頁籤若尚無 override，先建立使用者專屬 override，再保存順序。response 回傳 `acceptedRevision`、`managedTabs` 與 canonical `marketTabs`。

前端沿用商品排序已驗證的協調模式：每次有效移動立即更新本機草稿、短暫 debounce、同一使用者頁籤清單只允許一個 in-flight request，較新 revision 在前一請求完成後送出。舊 response 不得覆蓋較新的草稿；最新儲存失敗且沒有後續草稿時，才回復最後確認的 canonical order。

替代方案是每次只寫被拖曳頁籤的新數字。這仍需處理相鄰項目位移與競態，也會持續允許重複值，因此不採用。

### 4. 顯示狀態使用明確 visibility operation

新增 `POST /api/tabs/visibility`，以 `tabKey` 與 `enabled` 表達隱藏或取消隱藏，不再以無 request body 的 `PATCH /api/tabs/:id` 猜測操作。Worker 在同一批次中更新或建立 override、重新正規化所有可見頁籤的 `sort_order`，並回傳完整 canonical payload。

- 隱藏：從可見順序移除，再將剩餘項目正規化。
- 取消隱藏：加入可見清單最後，再正規化為 `1..N`。
- 系統頁籤尚無 override 時，隱藏會建立 `enabled=0` 的 override，不能靜默成功。
- 自訂頁籤隱藏只改 metadata，不刪除其中商品。

取消隱藏採「加到最後」而非還原舊位置，因為隱藏期間可見清單可能已重新排序，舊 `sort_order` 可能重複或失效；固定加入最後最容易預期，也能避免插入位置歧義。

### 5. 管理視窗分離可見排序與隱藏恢復

左側管理區分成「顯示中的頁籤」與可收合的「已隱藏頁籤（n）」：

- 顯示列包含拖曳把手、名稱、來源提示、上移、下移與隱藏操作。
- 隱藏列不參與排序，每列提供「取消隱藏」。
- 移除使用者可編輯的排序數字及泛用「啟用」勾選框。
- 拖曳只能從把手開始，提供插入位置、`Escape`／`pointercancel` 取消、邊緣自動捲動及 accessible name；鍵盤與輔助技術可用上下按鈕完成相同行為。
- 取消隱藏成功後顯示「已取消隱藏並移到最後，可再拖曳調整。」

頁籤名稱、預設狀態與新增自訂頁籤仍使用 metadata 表單保存，但不再由 metadata save 同時承擔排序或 visibility。

### 6. 系統頁籤、自訂頁籤、目前頁籤與預設頁籤採不同規則

- 系統頁籤不可永久刪除；存在 override 時可執行「恢復系統預設」，刪除 override 後重新產生 effective tabs。
- 自訂頁籤才顯示「刪除頁籤」，並沿用明確確認流程刪除頁籤與其個人商品。
- 最後一個可見頁籤不可隱藏，Worker 與前端都必須阻擋。
- 隱藏目前頁籤時，前端優先切換到其原順序的下一個可見頁籤，沒有下一個才使用上一個；取消隱藏不自動切換目前頁籤。
- 隱藏預設頁籤時，Worker 將正規化後第一個可見頁籤設為預設；取消隱藏不自動變更預設。
- localStorage 保存的頁籤已不存在或已隱藏時，前端使用 response 中的有效預設頁籤，否則使用第一個可見頁籤。

### 7. 舊資料以讀取相容、首次異動正規化

讀取歷史 `user_tabs` 時允許重複或非連續 `sort_order`，先以 `sort_order`、系統預設順序、更新時間與 `tabKey` 產生 deterministic order。第一次成功 reorder、hide 或 unhide 後，在同一使用者範圍內寫回唯一的 `1..N`。

歷史上以系統 tab ID 當 row ID、但缺少或帶有 `source_tab_id` 的資料，必須先依已知系統 ID 與來源欄位安全辨識為 override；不得因此產生第二個可見系統頁籤或刪除其商品。若遇到無法唯一判斷的資料，回傳安全診斷並拒絕破壞性異動。

## Risks / Trade-offs

- [歷史 override 資料可能有多種形態] → 建立集中式 resolver 與 fixture，先驗證舊 row ID、`source_tab_id`、重複來源及重複順序，再允許異動。
- [拖曳 DOM 重排可能遺失 pointer 結束事件] → 沿用商品清單的視窗層級 `pointerup`／`pointercancel`、按鍵狀態、失焦與頁面隱藏清理策略。
- [排序與隱藏請求接近同時發生] → visibility 前先 flush 或取消排序草稿，所有 mutation response 重新套用 canonical payload，操作期間停用衝突的 visibility／delete control。
- [建立系統 override 會增加 D1 rows] → 只在使用者實際排序、隱藏或修改系統頁籤時建立，並以同一 `source_tab_id` 重用既有資料列。
- [跨裝置同時修改仍可能互相覆蓋] → 本變更保證單一前端 session latest-wins；response 清楚回傳 canonical order，跨裝置衝突留待未來以 server revision／ETag 擴充。
- [正式站部署後無法匿名驗證個人資料] → 使用既有登入 session 完成 browser-visible 驗收；不得讀取 cookie、保存 token 或建立 bypass credential。

## Migration Plan

1. 先加入 effective tab resolver、`managedTabs` payload 與涵蓋歷史資料的 Worker 測試，保留舊欄位供現有前端相容。
2. 加入 `/api/tabs/reorder`、`/api/tabs/visibility`、系統 override upsert 與完整批次驗證。
3. 更新前端改用 `managedTabs`／`marketTabs`，加入兩區式管理器及頁籤排序 coordinator，移除數字排序與「啟用」勾選框。
4. 補齊 metadata、刪除、恢復系統預設、active/default fallback 及所有 ordering consumers。
5. 執行單元、整合、strict OpenSpec、靜態檢查與瀏覽器驗收；確認歷史帳號載入後沒有重複頁籤或資料遺失。
6. 部署時先發布向後相容的 Worker 與前端同一版本。若發生問題，回滾程式版本；既有欄位仍可由舊版讀取，已正規化的 `sort_order` 不需回復。

## Open Questions

無；頁籤取消隱藏位置、系統 override 身分、最後可見頁籤限制與 fallback 規則均已在本設計定案。
