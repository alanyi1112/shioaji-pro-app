# watchlist-reordering Specification

## Purpose
TBD - created by archiving change improve-watchlist-reordering-and-chart-sync. Update Purpose after archive.
## Requirements
### Requirement: 箭頭排序必須即時且可連續操作

系統 MUST 在使用者按下商品上移或下移時立即更新目前頁籤的本機排序，不得等待網路或 D1 回應才允許下一次移動；系統 MUST 合併短時間內的連續操作並最終保存使用者最後看到的順序。

#### Scenario: 快速連續移動同一商品

- **WHEN** 使用者在前一個排序請求完成前連續按下上移或下移
- **THEN** 每次有效移動都立即反映在清單中
- **AND** 非邊界排序控制維持可操作
- **AND** 系統合併背景寫入，使最終持久化順序等於最後一次本機排序

#### Scenario: 商品位於清單邊界

- **WHEN** 商品已位於目前頁籤的第一項或最後一項
- **THEN** 系統只停用無效方向的排序控制
- **AND** 不得因其他排序請求進行中而停用所有商品的有效排序控制

### Requirement: 排序儲存必須採 latest-wins

系統 MUST 以遞增 revision 串行合併同一頁籤的排序儲存；較舊請求的成功或失敗回應不得覆蓋較新的本機排序草稿。

#### Scenario: 儲存中又產生新順序

- **WHEN** revision N 的排序請求仍在進行，使用者又產生 revision N+1
- **THEN** 系統保留 revision N+1 的本機順序
- **AND** revision N 回應不得重新套用舊順序
- **AND** 系統在可送出時保存最新 revision

#### Scenario: 最新排序儲存失敗

- **WHEN** 最新 revision 儲存失敗且沒有更新的排序草稿
- **THEN** 系統回復該頁籤最後一次確認成功的順序
- **AND** 管理清單與目前 K 線顯示使用相同回復結果
- **AND** 系統顯示不含秘密或內部錯誤細節的失敗訊息

### Requirement: 拖曳排序必須清楚且可取消

系統 MUST 以專用拖曳把手啟動商品排序，並在拖曳過程顯示拖曳中項目與明確插入位置；整列商品的其他區域 MUST 保留原本選取商品設定的行為。

#### Scenario: 使用拖曳把手移動商品

- **WHEN** 使用者從拖曳把手開始移動商品
- **THEN** 系統依 pointer 位置即時更新插入位置提示與本機順序
- **AND** 游標接近可捲動清單上下邊緣時系統自動捲動
- **AND** 放開 pointer 後系統只為該次拖曳排程一次排序儲存

#### Scenario: 取消進行中的拖曳

- **WHEN** 使用者按下 `Escape`、發生 `pointercancel` 或拖曳無法完成
- **THEN** 系統回復拖曳開始前的本機順序
- **AND** 不送出該次取消拖曳的排序寫入

#### Scenario: 清單重排時失去 pointer capture

- **WHEN** 拖曳商品造成清單 DOM 重排，且瀏覽器提早釋放把手的 pointer capture
- **THEN** 系統仍能從視窗層級接收 `pointerup` 或 `pointercancel` 並結束拖曳
- **AND** 若原始結束事件遺失，系統在偵測滑鼠按鍵已放開、視窗失焦或文件隱藏時安全清理拖曳狀態
- **AND** 不得殘留自動捲動、grabbing 樣式或「正在移動」訊息

#### Scenario: 不使用拖曳操作排序

- **WHEN** 使用者以鍵盤、輔助技術或上移／下移按鈕操作
- **THEN** 系統提供與拖曳相同的排序能力與持久化結果
- **AND** 拖曳把手具有可理解的 accessible name 與目前位置資訊

### Requirement: 排序 API 必須批次且限定頁籤範圍

`/api/instruments/reorder` MUST 接收明確的 `tabId`、`tabLabel`、`scope`、ordered item identities 與 client revision，驗證商品屬於目前使用者的指定頁籤後，以單次 D1 batch 保存 `sort_order`；排序不得修改名稱、provider 或其他商品設定欄位。

#### Scenario: 儲存個人頁籤順序

- **WHEN** 已識別使用者送出一個個人頁籤的合法完整順序
- **THEN** Worker 只更新該使用者與該 `tabId` 內商品的 `sort_order`
- **AND** response 回傳已接受的頁籤身分、revision 與 canonical order
- **AND** response 不以完整 instrument payload 覆蓋前端較新草稿

#### Scenario: 儲存系統頁籤個人排序

- **WHEN** 已識別使用者以 `scope=system` 送出系統頁籤的合法順序
- **THEN** Worker 依 `tabId` 與 `tabLabel` 解析該系統頁籤商品
- **AND** 以該使用者的個人 override 保存順序
- **AND** 不修改共享的 `stock_setup.md` 或其他使用者資料

#### Scenario: 排序項目不屬於指定頁籤

- **WHEN** request 含有重複 symbol、跨頁籤項目或無法由指定頁籤解析的 item identity
- **THEN** Worker 拒絕整批排序
- **AND** 不產生部分 D1 更新
- **AND** 回傳安全且可診斷的 validation error

### Requirement: 同一商品在不同頁籤的順序必須隔離

系統 MUST 以頁籤身分與 symbol 組成排序 item identity；本機套用、快照、回復與 Worker 寫入不得只以 symbol 比對。

#### Scenario: 同一 symbol 存在於兩個頁籤

- **WHEN** 使用者只在其中一個頁籤移動該 symbol
- **THEN** 只有該頁籤的 `defaultOrder` 與 `sort_order` 改變
- **AND** 另一頁籤的清單與 K 線順序保持不變

### Requirement: 所有商品順序消費端必須一致

系統 MUST 以同一個頁籤限定 canonical ordering selector 供「我的清單」、K 線 panel、分類分頁、商品下拉選單與相關預載流程使用；不得依全域 `state.instruments` 原始陣列位置推斷頁籤順序。

#### Scenario: 重新載入已排序頁籤

- **WHEN** 使用者完成排序並重新載入網站
- **THEN** 管理清單、K 線 panel、分類分頁與商品下拉選單顯示相同順序
- **AND** 系統頁籤與個人頁籤都遵循已保存的 `sort_order`

#### Scenario: 排序跨越分類分頁邊界

- **WHEN** 新順序使商品移入或移出目前分類頁
- **THEN** 分頁總數、目前頁範圍與 visible symbols 由 canonical order 重新計算
- **AND** K 線 panel 與商品下拉選單使用該頁相同的 ordered symbols

### Requirement: 管理視窗必須對齊目前 K 線頁籤

系統 MUST 在開啟「我的清單」時優先選取目前有效的 K 線頁籤，不得因存在其他個人頁籤而自動跳到不同頁籤。

#### Scenario: 從系統頁籤開啟我的清單

- **WHEN** 目前 K 線位於一個有效系統頁籤，且使用者另有個人頁籤
- **THEN** 管理視窗仍選取目前系統頁籤
- **AND** 顯示的商品清單與目前 K 線頁籤相同

#### Scenario: 在管理視窗選擇另一頁籤

- **WHEN** 使用者明確在管理視窗選擇並排序非目前 K 線頁籤
- **THEN** 系統保存該頁籤順序
- **AND** 關閉管理視窗時不擅自切換目前 K 線頁籤
- **AND** 日後切換到該頁籤時使用已保存的新順序

### Requirement: 目前頁籤排序後必須同步既有 K 線 panel

系統 MUST 在目前 K 線頁籤的排序變更確認或管理視窗關閉時，把新順序套用到目前分類頁的既有 panel；只重新載入 symbol 實際改變的 panel，並保留週期、指標、聚焦與其他 panel 設定。

#### Scenario: 排序目前 K 線頁籤後關閉管理視窗

- **WHEN** 使用者在目前 K 線頁籤完成商品排序並關閉「我的清單」
- **THEN** 現有 K 線 panel 依新順序顯示目前分類頁商品
- **AND** 不需要重新整理整個網站或先切換到其他頁籤
- **AND** 未改變 symbol 的 panel 不重複載入市場資料

#### Scenario: 排序失敗後 K 線回復

- **WHEN** 最新排序儲存失敗且系統回復最後確認順序
- **THEN** 現有 K 線 panel、分類分頁、商品下拉選單與管理清單同步回復
- **AND** 不留下管理清單與 K 線順序不一致的狀態

### Requirement: 多圖 panel 排序必須永久寫回完整頁籤順序

系統 MUST 將多圖目前頁內的 visible canonical identity 新順序合併回目前頁籤的完整商品清單，並沿用 `POST /api/instruments/reorder` 以單次 batch 保存；request MUST 包含指定頁籤全部合法 item identities，不得只送出目前頁切片。

#### Scenario: 在個人頁籤的目前頁重排 panel

- **WHEN** 已識別使用者在個人頁籤完成合法 panel drop
- **THEN** 前端 MUST 立即更新該 tab identity 的完整本機 canonical order
- **AND** Worker MUST 只更新該使用者及該個人頁籤內商品的連續 `sort_order`
- **AND** 不得修改其他頁籤或其他使用者的商品順序

#### Scenario: 在系統頁籤重排 panel

- **WHEN** 已識別使用者在系統頁籤完成合法 panel drop
- **THEN** 系統 MUST 以該使用者的 system-tab override 永久保存完整新順序
- **AND** 不得修改共享預設、`stock_setup.md` 或其他使用者看到的順序

#### Scenario: 目前頁只佔完整清單的一部分

- **WHEN** visible page slice 前後仍有不可見商品
- **THEN** 系統 MUST 以 page start／end 範圍替換完整 canonical order 的同一切片
- **AND** request MUST 保留所有不可見項目且不得重複、遺漏或跨頁籤

### Requirement: 多圖與我的清單排序必須共用 latest-wins 序列

多圖 panel、「我的清單」拖曳及鍵盤排序 MUST 對同一頁籤共用遞增 revision、單一 draft 與同一持久化序列；任一較舊 response MUST NOT 覆蓋使用者較新的本機順序或 panel 畫面。

#### Scenario: panel 排序儲存中又再次拖曳

- **WHEN** revision N 的 panel 排序 request 仍在進行，使用者又在多圖畫面完成 revision N+1
- **THEN** revision N+1 MUST 立即反映在 panel 與 canonical order
- **AND** revision N response MUST NOT 重新套用舊順序或重新載入 panel
- **AND** 系統 MUST 最終保存 revision N+1 的完整清單

#### Scenario: 多圖與我的清單連續排序

- **WHEN** 使用者先在多圖畫面排序，並在前一 request 結束前於「我的清單」再調整同一頁籤
- **THEN** 兩個操作 MUST 進入同一頁籤 revision 序列
- **AND** 多圖、管理清單、分類分頁及商品下拉選單 MUST 以最後草稿為準

### Requirement: 多圖排序成功與失敗必須同步所有順序消費端

多圖排序成功後，重新載入、切換分類頁及開啟「我的清單」MUST 使用同一個已保存 canonical order；最新排序保存失敗時，系統 MUST 回復最後一次確認成功的完整順序及可對應的 panel 位置。

#### Scenario: 重載已完成 panel 排序的頁籤

- **WHEN** panel 排序 request 已成功且使用者重新載入網站
- **THEN** 多圖 panel、「我的清單」、分類分頁與商品下拉選單 MUST 顯示相同新順序
- **AND** 系統頁籤與個人頁籤 MUST 各自遵循該使用者已保存的 `sort_order`

#### Scenario: 最新 panel 排序保存失敗

- **WHEN** 最新 revision 保存失敗且沒有更新草稿
- **THEN** canonical order MUST 回復最後一次確認成功的完整 snapshot
- **AND** 若使用者仍位於可對應的同頁籤分類頁，既有 panel controllers MUST 原子移回正確位置且不得 reload
- **AND** 若使用者已離開該 context，目前畫面 MUST 保持不變，日後返回時 MUST 使用確認順序
- **AND** 系統 MUST 顯示不含秘密或內部細節的失敗訊息
