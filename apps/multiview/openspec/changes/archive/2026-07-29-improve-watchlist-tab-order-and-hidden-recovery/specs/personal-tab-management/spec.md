## ADDED Requirements

### Requirement: 系統必須產生唯一的有效頁籤模型

系統 MUST 以穩定 `tabKey` 區分系統頁籤與自訂頁籤，並在 Worker 將系統預設、使用者的系統 override 與自訂頁籤合併成單一 effective tab model；同一個系統頁籤的預設與 override MUST NOT 同時成為兩個有效頁籤。

#### Scenario: 系統頁籤具有個人 override

- **WHEN** 使用者資料包含指向某個系統頁籤的 override
- **THEN** Worker 以 override 的名稱、順序、顯示狀態與預設狀態取代該使用者看到的系統預設
- **AND** response 中該邏輯頁籤只出現一次
- **AND** 其他使用者仍取得未被修改的系統預設

#### Scenario: 自訂頁籤與系統頁籤同名

- **WHEN** 使用者建立與系統頁籤或另一個自訂頁籤相同顯示名稱的自訂頁籤
- **THEN** 系統仍以不同 `tabKey` 保留各自資料與排序身分
- **AND** 不得只依顯示名稱合併、排序或更新頁籤

### Requirement: 頁籤排序必須使用拖曳與可存取的移動控制

「我的清單」MUST 讓使用者以專用拖曳把手及上移／下移按鈕調整顯示中頁籤的順序，並 MUST NOT 要求使用者直接輸入排序數字。

#### Scenario: 拖曳顯示中的頁籤

- **WHEN** 使用者從頁籤列的拖曳把手移動頁籤
- **THEN** 管理器立即顯示本機新順序與明確插入位置
- **AND** 放開 pointer 後只為該次拖曳排程一次排序儲存
- **AND** 頁籤列的其他互動區域不會誤觸拖曳

#### Scenario: 使用按鈕或輔助技術調整順序

- **WHEN** 使用者以鍵盤、輔助技術或上移／下移按鈕操作頁籤
- **THEN** 系統提供與拖曳相同的可達順序與持久化結果
- **AND** 每個控制具有包含頁籤名稱與目前位置的 accessible name

#### Scenario: 取消頁籤拖曳

- **WHEN** 使用者按下 `Escape`、發生 `pointercancel`、視窗失焦或文件進入隱藏狀態
- **THEN** 系統安全結束拖曳、自動捲動與相關樣式
- **AND** 未完成的拖曳回復開始前順序
- **AND** 不送出該次取消操作的排序寫入

### Requirement: 快速連續頁籤排序必須採 latest-wins

前端 MUST 以遞增 revision 序列化同一份頁籤清單的排序儲存；較舊 request 的成功或失敗 response MUST NOT 覆蓋較新的本機排序草稿。

#### Scenario: 前一個排序仍在儲存時再次移動

- **WHEN** revision N 的頁籤排序仍在進行，使用者又產生 revision N+1
- **THEN** revision N+1 立即反映在管理器與導覽列
- **AND** revision N response 不得重新套用舊順序
- **AND** 系統在前一請求結束後保存最新 revision

#### Scenario: 最新頁籤排序儲存失敗

- **WHEN** 最新 revision 儲存失敗且沒有更新的本機草稿
- **THEN** 系統回復最後一次確認成功的 canonical order
- **AND** 管理器與所有頁籤順序消費端一起回復
- **AND** 顯示不含秘密或內部錯誤細節的失敗訊息

### Requirement: 頁籤排序 API 必須驗證完整清單並批次正規化

`POST /api/tabs/reorder` MUST 接收目前使用者全部可見頁籤的 ordered `tabKey` 與 client revision，驗證完整性後以單次 D1 batch 將順序保存為唯一且連續的 `1..N`；任何 validation failure MUST 拒絕整批寫入。

#### Scenario: 儲存合法的系統與自訂頁籤混合順序

- **WHEN** 已識別使用者送出恰好包含全部可見頁籤且沒有重複的合法順序
- **THEN** Worker 更新自訂頁籤資料列並建立或重用必要的系統 override
- **AND** 單次 batch 將可見頁籤的 `sort_order` 保存為 `1..N`
- **AND** response 回傳 accepted revision、完整管理頁籤與 canonical 可見頁籤順序

#### Scenario: 排序清單含重複、未知、遺漏或隱藏頁籤

- **WHEN** request 含重複或未知 `tabKey`、遺漏任何可見頁籤，或把隱藏頁籤放入排序清單
- **THEN** Worker 拒絕整批排序
- **AND** 不產生部分 D1 更新或新的系統 override
- **AND** 回傳安全且可診斷的 validation error

#### Scenario: 不同使用者具有相同自訂頁籤 ID

- **WHEN** 使用者送出頁籤排序
- **THEN** Worker 只解析並更新該 Sites 使用者識別範圍內的頁籤
- **AND** 不得讀取或修改其他使用者的順序、override 或自訂頁籤

### Requirement: 管理器必須分離顯示頁籤與已隱藏頁籤

「我的清單」MUST 分別顯示「顯示中的頁籤」與可收合的「已隱藏頁籤（n）」；已隱藏區的每個頁籤 MUST 提供明確的「取消隱藏」操作，且 visibility MUST NOT 再以泛用「啟用」勾選框表示。

#### Scenario: 使用者開啟含隱藏頁籤的管理器

- **WHEN** effective tab model 含有一個或多個已隱藏頁籤
- **THEN** 管理器顯示正確的已隱藏數量與獨立區域
- **AND** 隱藏頁籤不參與顯示中頁籤的拖曳排序
- **AND** 使用者不需猜測排序數字或編輯頁籤表單即可找到取消隱藏入口

#### Scenario: 沒有任何隱藏頁籤

- **WHEN** effective tab model 的所有頁籤皆為顯示中
- **THEN** 管理器顯示「已隱藏頁籤（0）」或等效的清楚空狀態
- **AND** 不顯示無法操作的隱藏頁籤列

### Requirement: 隱藏與取消隱藏必須保留資料並正規化順序

系統 MUST 以明確 visibility operation 隱藏或取消隱藏頁籤；隱藏自訂頁籤 MUST 保留其商品，取消隱藏 MUST 將頁籤加入可見清單最後並將全部可見順序重新正規化為 `1..N`。

#### Scenario: 隱藏既有自訂頁籤

- **WHEN** 使用者隱藏一個不是最後可見項目的自訂頁籤
- **THEN** 該頁籤移至已隱藏區
- **AND** 頁籤內商品與 metadata 保留
- **AND** 剩餘可見頁籤的順序正規化為 `1..N`

#### Scenario: 取消隱藏頁籤

- **WHEN** 使用者對已隱藏頁籤選擇「取消隱藏」
- **THEN** 該頁籤加入顯示清單最後
- **AND** response 與重新載入後均使用正規化的新順序
- **AND** 系統提示「已取消隱藏並移到最後，可再拖曳調整。」或同等明確訊息
- **AND** 不自動切換目前頁籤或變更預設頁籤

#### Scenario: 隱藏尚無 override 的系統頁籤

- **WHEN** 使用者第一次隱藏沒有個人 override 的系統頁籤
- **THEN** Worker 建立該使用者專屬且 `enabled=0` 的系統 override
- **AND** response 與重新載入後該系統頁籤都只出現在已隱藏區
- **AND** API 不得在零資料異動時回報隱藏成功

### Requirement: 系統頁籤與自訂頁籤必須使用不同刪除規則

系統頁籤 MUST NOT 被永久刪除；系統頁籤存在個人 override 時 MUST 提供「恢復系統預設」，只有自訂頁籤 MAY 提供永久刪除操作。

#### Scenario: 使用者管理系統頁籤

- **WHEN** 使用者選取系統頁籤
- **THEN** 管理器不顯示可永久刪除該頁籤的操作
- **AND** 若存在個人 override，管理器提供「恢復系統預設」
- **AND** 恢復後 Worker 移除 override 並重新產生 canonical effective tabs

#### Scenario: 使用者刪除自訂頁籤

- **WHEN** 使用者確認永久刪除自訂頁籤
- **THEN** Worker 只刪除該使用者的頁籤與頁籤內個人商品
- **AND** 剩餘可見頁籤順序重新正規化
- **AND** 其他使用者與共享系統頁籤不受影響

### Requirement: 系統必須保留至少一個可見頁籤並採用可預期 fallback

前端與 Worker MUST 阻止隱藏或刪除最後一個可見頁籤；隱藏目前頁籤或預設頁籤時，系統 MUST 依 canonical order 選擇可預期的替代頁籤。

#### Scenario: 嘗試隱藏最後一個可見頁籤

- **WHEN** 使用者嘗試隱藏唯一可見頁籤
- **THEN** 前端停用或拒絕該操作
- **AND** Worker 即使收到 request 仍拒絕異動
- **AND** 原頁籤維持可見且資料不變

#### Scenario: 隱藏目前頁籤

- **WHEN** 使用者隱藏目前正在顯示的頁籤
- **THEN** 前端優先切換到原順序的下一個可見頁籤
- **AND** 沒有下一個時切換到上一個可見頁籤
- **AND** 目前圖表、分類分頁與商品選單使用替代頁籤的資料

#### Scenario: 隱藏預設頁籤

- **WHEN** 使用者隱藏目前的預設頁籤
- **THEN** Worker 將正規化後第一個可見頁籤設為新預設
- **AND** response 與重新載入後恰好有一個有效預設頁籤

#### Scenario: 保存的目前頁籤已隱藏

- **WHEN** 頁面載入時 localStorage 指向不存在或已隱藏的 `tabKey`
- **THEN** 前端使用有效預設頁籤
- **AND** 沒有有效預設時使用 canonical order 的第一個可見頁籤

### Requirement: 所有頁籤消費端必須使用同一 canonical order

系統 MUST 以 Worker 回傳的 canonical `marketTabs` 作為導覽列、管理器顯示區、目前頁籤 reconciliation、預設頁籤及相鄰預載流程的唯一可見排序來源；前端 MUST NOT 再自行拼接或另行排序出第二份有效頁籤清單。

#### Scenario: 重新載入已排序頁籤

- **WHEN** 使用者完成頁籤排序並重新載入網站
- **THEN** 上方頁籤導覽與管理器顯示區呈現完全相同的順序
- **AND** active/default reconciliation 與相鄰預載都依該順序運作
- **AND** 系統頁籤與自訂頁籤不會重複出現

#### Scenario: visibility operation 回傳新順序

- **WHEN** 使用者隱藏或取消隱藏頁籤且 Worker 回傳新的 canonical payload
- **THEN** 所有頁籤消費端在同一次狀態套用中更新
- **AND** 不留下管理器、導覽列與目前圖表頁籤互不一致的中間終態

### Requirement: 歷史重複順序與舊系統 override 必須安全相容

系統 MUST 能讀取重複、非連續 `sort_order` 及歷史系統 override row ID，產生 deterministic effective order；第一次成功 reorder、hide 或 unhide 後 MUST 在該使用者範圍內正規化可見順序，且不得遺失頁籤或商品。

#### Scenario: 歷史資料含重複排序數字

- **WHEN** 使用者載入兩個以上具有相同 `sort_order` 的歷史頁籤
- **THEN** Worker 以穩定 fallback 產生可重現順序
- **AND** 畫面不要求使用者先手動修正重複數字才能管理頁籤
- **AND** 下一次成功頁籤異動將可見順序保存為唯一的 `1..N`

#### Scenario: 歷史 override 使用系統頁籤 ID

- **WHEN** 歷史 `user_tabs` row 的 ID 或 `source_tab_id` 可對應既有系統頁籤
- **THEN** resolver 將其辨識為該系統頁籤的使用者 override
- **AND** 不建立第二個可見頁籤
- **AND** 不刪除或改綁該頁籤既有商品

#### Scenario: 歷史資料無法安全解析

- **WHEN** 多筆資料無法唯一判斷應對應哪個系統頁籤或自訂頁籤
- **THEN** 系統回傳不含秘密的安全診斷
- **AND** 拒絕會刪除、覆蓋或重新綁定資料的異動
