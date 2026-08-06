## ADDED Requirements

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
