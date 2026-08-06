## Context

目前前端以 `watchlistReorderPendingKey` 把一次排序視為不可重入的完整儲存交易。每次按上移／下移或完成一次原生 HTML drag-and-drop，都會立即將整份商品物件送到 `/api/instruments/reorder`；等待期間會停用同一份清單的排序控制。Worker 端再沿用一般 `saveInstrument()` 流程逐筆 upsert D1，最後重新組合完整 instrument payload，因此一次小幅移動仍包含多次遠端寫入與完整狀態回讀。

拖曳目前套在整列商品上，列本身同時又負責選取商品設定，且拖曳過程沒有專用把手、插入位置提示、邊緣自動捲動或取消回復。另一方面，管理視窗以 `orderedWatchlistInstrumentsForTab()` 顯示 `defaultOrder`，但 K 線、分類分頁與下拉選單的 `symbolsForTab()` 只依原始 `state.instruments` 陣列篩選；關閉管理視窗也只清除訊息，沒有把新順序套用到既有 panel。

正式站唯讀檢查另確認：K 線位於系統頁籤時，開啟「我的清單」可能先落到第一個個人頁籤，而不是目前 K 線頁籤。這使使用者可能在不同頁籤完成排序後回到原 K 線，進一步放大「排序沒有生效」的感受。

本變更跨越 vanilla JavaScript UI、Worker API、D1 持久化與 K 線 panel 同步，但既有 `user_instruments.sort_order` 足以保存順序，不需要新的資料表或秘密值。

## Goals / Non-Goals

**Goals:**

- 讓上移／下移在本機立即生效，並在伺服器請求進行中仍可連續操作。
- 讓拖曳有清楚把手、即時位置回饋、邊緣自動捲動、取消能力與單次落點儲存。
- 確保舊請求回應不會覆蓋較新的排序草稿，且最終 D1 順序等於使用者最後看到的順序。
- 以頁籤範圍隔離排序；同一 symbol 位於不同頁籤時不得互相修改。
- 讓管理視窗、K 線 panel、分類分頁與商品下拉選單共用相同排序來源。
- 僅在排序影響目前 K 線頁籤時更新 panel 商品，同時保留 panel 的週期、指標與其他設定。
- 以自動測試與正式 Codex Sites 瀏覽器驗收證明快速操作、持久化與可見同步結果。

**Non-Goals:**

- 不重新設計商品新增、刪除、搜尋、頁籤建立或頁籤本身的排序介面。
- 不改變行情、指標、SSE、第二資料源核對或 K 線計算 contract。
- 不引入 SortableJS 等第三方拖曳套件，也不新增 D1 migration，除非實作時發現現有 schema 無法滿足已定義需求。
- 不在使用者於管理視窗選擇另一頁籤時，擅自切換目前 K 線頁籤。

## Decisions

### 1. 以頁籤排序草稿作為互動期間的單一真相

前端為每個頁籤維護排序協調狀態，至少包含 `tabKey`、最後確認快照、目前草稿、遞增 revision、debounce timer、in-flight revision 與 dirty 狀態。上移／下移會先更新草稿與 `state.instruments`，立即重繪管理清單；不再使用一個 pending flag 停用整份清單。

箭頭操作在最後一次移動後等待約 250ms，再將最新草稿送出。若請求進行期間又有操作，新的 revision 保留在草稿中；舊請求完成後若發現 revision 已落後，只確認該請求成功，不得把舊 payload 套回畫面，並繼續送出最新草稿。這是 serialized coalescing，不允許多個排序寫入無序並行。

Alternative considered：每次點擊仍立即 await API，但只縮短後端時間。即使後端改快，網路 latency 仍會造成按鈕停頓，也無法保證使用者快速連點時的 latest-wins，因此不採用。

### 2. 拖曳使用專用把手與 Pointer Events

每列新增可辨識且可聚焦的拖曳把手，只有把手會啟動拖曳；列其餘區域仍用於選取商品設定。pointerdown 後使用 pointer capture，pointermove 依清單列的 `getBoundingClientRect()` 與游標 Y 計算插入索引，直接更新草稿與視覺位置；接近可捲動容器上下邊緣時，以受限速度自動捲動。

由於拖曳過程會重排同一批 DOM 節點，瀏覽器可能在節點被重新插入時提早失去 pointer capture。因此拖曳生命週期事件改由 `window` capture phase 監聽，pointer capture 只作為輔助；即使把手在清單重排時失去 capture，`pointerup`／`pointercancel` 仍會完成清理。若滑鼠按鍵已放開但遺失原始 `pointerup`，下一個 `pointermove` 也會依目前位置完成或取消拖曳。視窗失焦或文件隱藏時一律安全取消，避免殘留 grabbing、auto-scroll 與「正在移動」狀態。

拖曳列、插入位置與容器分別使用明確 CSS state，並透過 status／live region 回報目前位置。pointerup 只排程一次持久化；`Escape`、`pointercancel` 或失去有效目標時回到拖曳前快照。把手需設定適當 `touch-action`，但上移／下移按鈕仍保留，作為鍵盤及不適合拖曳情境的完整替代。

Alternative considered：繼續使用整列 HTML5 drag-and-drop，只補 CSS。這仍會讓點選與拖曳競爭，觸控支援與 pointer cancel 行為也不一致，因此不採用。

### 3. `/api/instruments/reorder` 改為頁籤限定的排序 API

request 只傳排序必要資訊：頁籤識別（`tabId`、`tabLabel`、`scope`）、ordered symbols／item identities，以及 client revision；不再把一般商品編輯欄位當成排序來源。Worker 必須從目前使用者可見的該頁籤商品解析合法項目，拒絕重複、遺漏必要身分、跨頁籤或不屬於該頁籤的項目。

系統頁籤的排序仍以 `tab_id = ''` 個人 override 保存，但必須搭配明確的 `scope=system` 與 `tabLabel` 解析；個人頁籤則以實際 `tabId` 保存。所有 `sort_order` 寫入組成單次 `env.DB.batch()`。response 回傳已接受的 tab key、revision 與 canonical order，不回傳會覆蓋整個前端狀態的完整 stale payload。

Alternative considered：保留 generic `saveInstrument()` 並將迴圈改成 batch。這只能改善延遲，仍允許排序請求修改名稱、provider 等無關欄位，也無法清楚驗證頁籤範圍，因此不採用。

### 4. 所有排序消費端共用 `orderedInstrumentsForTab()`

建立一個以頁籤身分篩選並依 `defaultOrder`、穩定 tie-breaker 排序的 canonical selector。管理清單、分類分頁、K 線預設商品、panel 商品下拉選單與預載 symbol 清單都必須透過這個 selector 取得順序，不得各自依 `state.instruments` 原始陣列位置推斷。

本機套用與 rollback 也以頁籤限定 item key，而不是只用 symbol 建 Map；這避免同一 symbol 存在於多個頁籤時被一起覆寫。Worker 的 instrument payload 仍可維持全域陣列格式，前端 selector 負責在頁籤範圍內產生 deterministic order。

### 5. 管理視窗與 K 線同步採明確頁籤語意

開啟「我的清單」時，先在 `state.marketTabs` 中找目前 `activeMarketTabId`，只有找不到有效目前頁籤時才使用預設個人頁籤或第一個可見頁籤。使用者若在管理視窗手動選擇其他頁籤，關閉時不得自動切換 K 線頁籤。

若排序變更屬於目前 K 線頁籤，關閉管理視窗或最新草稿確認後，系統依目前分類頁碼取得 ordered visible symbols，逐一更新既有 panel 的 symbol 與 options；只有 symbol 實際改變的 panel 才重新載入。此流程不得銷毀 panel，因此週期、指標、聚焦與其他 panel 設定可以保留。若排序屬於非目前頁籤，待使用者日後切換到該頁籤時自然使用 canonical order。

### 6. 失敗處理以最後確認快照為界

若失敗的是過時 revision 且已有較新草稿，保留較新草稿並嘗試送出最新 revision；不得用舊快照回復。若最新 revision 也失敗且沒有更新草稿，回復該頁籤最後確認快照、同步管理清單與目前 K 線，並顯示不含秘密或上游細節的錯誤。成功後顯示低干擾的「排序已儲存」，不得因訊息重繪造成拖曳位置跳動。

## Risks / Trade-offs

- [Risk] debounce 期間關閉管理視窗，可能讓畫面先於 D1 完成更新。→ 關閉時立即 flush 最新草稿，但不阻塞 dialog；失敗時依最後確認快照回復並保留下次可見的錯誤狀態。
- [Risk] 舊 response 回傳後觸發全量狀態套用，會復原較新順序。→ 排序 API 不回傳完整 instrument payload，前端以 revision 檢查確認結果。
- [Risk] Pointer Events 拖曳在長清單中頻繁重繪，可能卡頓。→ pointermove 只在目標索引改變時更新草稿，auto-scroll 使用單一 animation frame，避免每個 pixel 都重建 DOM。
- [Risk] 拖曳列重排 DOM 後瀏覽器提早釋放 pointer capture，導致把手收不到 `pointerup` 而僵在拖曳狀態。→ 以 `window` capture phase 接收生命週期事件，並在滑鼠按鍵已放開、視窗失焦或文件隱藏時執行 fail-safe cleanup。
- [Risk] 排序目前 K 線頁籤後重新載入 panel 會增加市場資料請求。→ 只載入 symbol 改變的 panel，沿用現有 payload cache，並保留 interval／indicator 設定。
- [Risk] 系統頁籤使用空 `tab_id` 保存 override，頁籤身分容易模糊。→ API 強制 `scope`、`tabId`、`tabLabel`，Worker 先以系統設定解析合法商品再 batch 寫入。

## Migration Plan

1. 先完成 Worker 新排序 contract、D1 batch 與測試，再切換前端呼叫，確保同一 Sites version 內前後端一致。
2. 使用既有 `sort_order` 資料；首次讀取時由 canonical selector 正確排序，不需資料搬移。
3. 執行完整 build／test、OpenSpec strict validation 與本機互動驗收，再部署新的 Codex Sites version。
4. 在正式站驗證快速連點、拖曳、關閉後 K 線同步、重新載入持久化與同 symbol 跨頁籤隔離。
5. 若部署失敗，可回滾到上一個 Sites version；既有 D1 rows 與 `sort_order` 格式相容，不需資料回復。

## Open Questions

無。debounce 初始值採約 250ms，實作後可依本機與正式站互動驗收微調，但不得改變「即時本機更新、latest-wins、背景合併儲存」契約。
