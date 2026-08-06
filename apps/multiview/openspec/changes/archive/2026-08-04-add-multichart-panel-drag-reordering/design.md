## Context

目前 `public/static/app.js` 先由頁籤限定的 canonical 商品順序產生分類分頁，再以 visible symbol slice 的 index 建立 1／2／3／4／6／8 個 panel。每個 panel controller 在建立時捕捉 index，panel 內商品下拉選單則可以暫時改成目前頁的其他商品，但不會修改 canonical 清單。現有「我的清單」已具備頁籤限定 item identity、立即本機排序、revision／latest-wins、`POST /api/instruments/reorder` 批次保存、失敗回復，以及 K 線／分頁／下拉選單同步能力；籌碼群組排序也已有不搬動 Canvas 的 ghost／placeholder 與穩健 pointer cleanup 經驗。

這項變更橫跨 panel template、responsive grid 幾何、chart controller 位置身分與既有排序 coordinator。核心限制是：拖曳中不能重建或搬動正在互動的 Canvas，drop 後不能因純順序調整重新抓取 K 線／籌碼資料，而且永久保存必須送出目前頁籤的完整 canonical item identity 清單，不能只保存 visible slice。

## Goals / Non-Goals

**Goals：**

- 讓 2／3／4／6／8 圖可用滑鼠左鍵按住商品 panel 上方的商品標題／報價區直接調整目前頁內位置，並永久同步「我的清單」、分類分頁與商品下拉選單。
- 在不同桌面／窄螢幕 grid 幾何下提供明確來源、ghost 與插入位置，支援 pointer、鍵盤與輔助技術。
- drop 後沿用現有 panel controller、Canvas、visible range、主副圖狀態與即時連線，不因純重排觸發資料 request 或完整 `renderPanels()`。
- 沿用既有頁籤限定 batch API、revision／latest-wins 與安全錯誤回復，不新增 D1 schema 或第二套排序來源。
- 保留雙擊新分頁單圖、1／2／3／4 圖多層副圖資格、6／8 圖固定單一副圖及所有既有圖表操作。

**Non-Goals：**

- 不在第一版提供拖曳至上一頁／下一頁或游標靠近邊緣自動翻分類頁；跨頁移動仍使用「我的清單」。
- 不把 panel 商品下拉選單的臨時選擇改成清單增刪、交換或永久工作區配置，也不禁止同一商品暫時出現在多個 panel。
- 不讓 1 圖啟用沒有意義的排序熱區或排序把手。
- 不修改行情、籌碼、SSE、D1 schema、Cloudflare Access 或資料回補流程。
- 不引入第三方 drag-and-drop 套件。

## Decisions

### 1. 排序身分採 canonical item identity，不採目前顯示 symbol

每次 `renderPanels()` 依 visible slice 建立 panel 時，controller MUST 保存該 slot 對應的頁籤限定 canonical item identity，並提供可更新的目前 position。商品下拉選單只改變 panel 的暫時顯示內容，不改寫排序身分；即使多個 panel 暫時顯示同一 symbol，拖曳 request 仍以不重複的 canonical identities 產生合法完整順序。

排序提示／鍵盤把手的 accessible name 以 canonical 清單項目與目前位置為主；若暫時顯示商品不同，狀態提示同時揭露目前顯示商品，避免把臨時選擇誤解為新增或永久替換。選擇這個模型是因為 `/api/instruments/reorder` 只排序既有頁籤項目，不應讓 panel 臨時值改變清單成員或產生重複 symbol。另一方案是另存 per-page workspace layout，但會形成第二套順序來源並破壞清單／分頁同步，因此不採用。

### 2. 以左鍵按住商品 panel 上方區域直接拖曳

使用者可在商品 panel 上方的商品標題／報價區域，以滑鼠左鍵按住任何非互動部分並移動來啟動拖曳，不必精準點擊小把手。系統在 `pointerdown` 後保留短距離 movement threshold；超過門檻且左鍵仍按住時才進入 dragging，未超過門檻的普通點擊仍維持原行為。上方區域顯示 `grab`／`grabbing` 游標，小把手仍保留為視覺提示、明確替代起點及鍵盤操作入口，但不是滑鼠唯一可用的命中區。

商品 select、interval select、details／summary、button、input、label 內控制項、context menu 與其他可互動元素 MUST 排除拖曳；主圖／副圖 surface 與 Canvas 也 MUST 排除，避免破壞 K 線平移、縮放、十字線及繪圖工具。拖曳完成必須抑制同一 pointer sequence 衍生的 click／dblclick，避免誤開單圖新分頁。排序熱區與提示把手只在有效圖數大於 1 且目前頁至少有兩個 canonical items 時啟用；1 圖、只有一個商品或 single-view 狀態不啟用。

### 3. 拖曳預覽只使用幾何快照、ghost 與 overlay placeholder

開始拖曳時快照目前 visible panel identities、panel rectangles、完整頁籤 canonical order、頁碼、圖數與作用頁籤。pointer 移動時依實際 `getBoundingClientRect()` 中心與 CSS grid 的視覺 row-major 順序計算候選 index；responsive 版面改變或 resize 時取消，不使用寫死欄數推測位置。

拖曳期間真正 `.chart-panel`、Canvas、controller array 與 canonical state MUST 保持原位，只移動輕量 ghost 並更新 overlay 插入提示。不得呼叫 `renderPanels()`、`applyOrderedSymbol()`、chart resize、layout measurement、stream pause、資料 load 或排序 API。這沿用籌碼群組拖曳的安全原則，避免 Canvas reparent／resize 抖動與大量重抓資料。

### 4. 合法 drop 後原子重排既有 controller 與 DOM

合法 drop 時先由 snapshot 產生新的 visible identity order，再將它替換回完整 canonical order 的相同 page slice。前端在同一個同步步驟中重排 `state.panels`、grid child nodes 與 controller 的 mutable position，更新把手位置資訊及本機 canonical `defaultOrder`；不 destroy controller、不重建 Canvas，也不變更 panel 目前顯示商品、interval、visible range、主副圖選取、annotation、stream 或 cache。

既有 `createPanel(index)` 中依固定 index 執行的雙擊、預設商品、refresh 與 debug report 必須改由 controller 的目前 position／element identity 解析，避免 DOM 重排後仍讀到舊 index。直接重新 `renderPanels()` 雖較簡單，但會銷毀 controller、重設 viewport 並重開 request／stream，不符合本變更的狀態保留與效能目標，因此不採用。

### 5. 共享既有完整清單 batch 與 latest-wins coordinator

panel drop 不新增 API；它把重排後的完整頁籤商品清單交給既有 `stageManagedInstrumentOrder()`／reorder coordinator，遞增同一頁籤 revision，立即同步本機 canonical order，並以單次 `POST /api/instruments/reorder` 保存。系統頁籤仍寫入目前使用者 override，個人頁籤仍限定該 tab identity，其他頁籤完全不受影響。

panel 來源需讓既有 coordinator 知道 controller 已依相同 canonical order 原子重排，成功 response 不得再用 `applyOrderedSymbol()` 重新載入圖表。若排序中再次拖曳或同時在「我的清單」排序，所有操作仍進入同一 revision 序列；舊 response 不得覆蓋較新草稿，最終只保存使用者最後看到的完整順序。

### 6. 取消、失敗與導覽競態共用單一回復路徑

`Escape`、`pointercancel`、主要滑鼠按鍵歸零、視窗失焦、文件隱藏、resize、切換頁籤、分類頁、圖數或 single-view 狀態時，拖曳 controller MUST 取消 ghost／placeholder、window listeners 與 pending animation frame，且因真正 panel 尚未移動，不需重建圖表，也不送出排序 request。

合法 drop 後若最新 revision 保存失敗，coordinator 以最後一次確認成功的完整 canonical snapshot 回復。若使用者仍位於相同頁籤及可對應的分類頁，系統依 identity 原子移回既有 controllers；若已導覽到其他 context，只回復 canonical state，待日後 render 時自然呈現確認順序，不得破壞目前頁面。錯誤訊息沿用既有清理規則，不顯示內部或秘密內容。

### 7. 鍵盤移動依實際 grid 幾何

拖曳把手 MUST 支援鍵盤等效排序。`ArrowLeft`／`ArrowRight` 移到同一視覺列的相鄰 slot，`ArrowUp`／`ArrowDown` 依 rectangle 中心選擇上一／下一視覺列最接近的 slot；單欄 responsive 版面自然以 Up／Down 移動，一列版面自然以 Left／Right 移動。無合法目標時不改順序、不發 request。每次有效鍵盤移動立即原子套用並走同一 latest-wins coordinator，焦點跟隨被移動的 panel 把手。

### 8. 驗證必須同時覆蓋資料流與部署後可見行為

純函式／contract tests 覆蓋 page-slice 合併、identity 不重複、grid target 計算、鍵盤鄰接、取消 cleanup、latest-wins 與 failure rollback；chart lifecycle tests 斷言拖曳及 drop 不呼叫 destroy／load、不新增 candles／chip requests 或 SSE connections。瀏覽器驗收需在 Sites 保留站與 Cloudflare 正式站分別驗證 2／3／4／6／8 圖、至少一個有第二頁的頁籤、重載持久化、我的清單同步、臨時重複商品、雙擊隔離、6／8 圖單一副圖與 console 0 errors。

## Risks / Trade-offs

- **[臨時顯示商品與 canonical identity 不同]** → 上方排序區的提示與鍵盤把手揭露 canonical 清單項目；只排序 slot identity，不把臨時 symbol 寫成清單成員。
- **[Canvas 在重排時閃動或尺寸錯位]** → 拖曳中不 reparent，drop 後只做一次 DOM／controller 原子重排，再排程一次必要 layout refresh，不 destroy 或 reload。
- **[grid 欄數會因圖數、模式及 viewport 改變]** → 以實際 rectangles 計算視覺鄰接與 target；resize 直接取消當次拖曳。
- **[排序 request 進行中又切頁或再次拖曳]** → 共用同一頁籤 revision／latest-wins coordinator，response 依 revision 與目前 context 決定是否更新畫面。
- **[拖曳與工具列／雙擊新分頁互相誤觸]** → 只讓上方非互動區及提示把手啟動，使用 movement threshold 與 interaction guard，drop／cancel 後吞掉同一 pointer sequence 的 click／dblclick。
- **[只允許目前頁內移動限制較大]** → 第一版避免無可見目標的跨頁拖曳與自動翻頁競態；既有「我的清單」仍可完成全清單跨頁調整。

## Migration Plan

1. 先加入不改資料的 identity／geometry helper、panel controller mutable position 與 contract tests。
2. 加入上方排序熱區、提示／鍵盤把手、ghost／placeholder、pointer／keyboard controller 與取消 cleanup，再串接既有 reorder coordinator。
3. 以本機 API／D1 fixture 驗證系統與個人頁籤完整 batch、latest-wins、失敗回復及重載結果；不需 D1 migration。
4. 完成 lint、完整測試、OpenSpec strict validation、`git diff --check` 與本機瀏覽器驗收後，先部署 Sites 保留站再部署 Cloudflare 正式站，分別完成登入後可見驗收。
5. 若發布後需 rollback，可移除 panel 排序熱區、提示把手與拖曳 controller 並恢復固定 index；已保存的是既有合法 `sort_order`，不需資料回填或 schema rollback。

## Open Questions

無。使用者已確認拖曳後要永久同步「我的清單」與分頁順序；跨頁拖曳及臨時商品永久工作區配置明確不在第一版範圍。
