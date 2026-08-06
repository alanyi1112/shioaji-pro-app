## MODIFIED Requirements

### Requirement: 頁籤排序必須使用拖曳與可存取的移動控制

「我的清單」MUST 讓使用者以專用拖曳把手調整顯示中頁籤的順序，MUST NOT 在頁籤列顯示重複的上移／下移按鈕，並 MUST NOT 要求使用者直接輸入排序數字。拖曳把手 MUST 可聚焦，並提供鍵盤等效排序操作。

#### Scenario: 拖曳顯示中的頁籤

- **WHEN** 使用者從頁籤列的拖曳把手移動頁籤
- **THEN** 管理器立即顯示本機新順序與明確插入位置
- **AND** 放開 pointer 後只為該次拖曳排程一次排序儲存
- **AND** 頁籤列的其他互動區域不會誤觸拖曳
- **AND** 頁籤列不顯示上移或下移按鈕

#### Scenario: 使用鍵盤或輔助技術調整順序

- **WHEN** 使用者將焦點移到拖曳把手並按下 `ArrowUp` 或 `ArrowDown`
- **THEN** 系統提供與拖曳相同的可達順序與持久化結果
- **AND** 第一列的 `ArrowUp` 與最後一列的 `ArrowDown` 不產生無效寫入
- **AND** 拖曳把手具有包含頁籤名稱、目前位置與總數的 accessible name

#### Scenario: 顯示較長的頁籤名稱

- **WHEN** 頁籤名稱需要的寬度大於管理器左欄目前可用寬度
- **THEN** 名稱按鈕優先取得拖曳把手與 visibility 圖示以外的剩餘寬度
- **AND** 極端長名稱以單行省略號保護布局
- **AND** 完整名稱仍可由按鈕的 accessible name 或 tooltip 取得

#### Scenario: 取消頁籤拖曳

- **WHEN** 使用者按下 `Escape`、發生 `pointercancel`、視窗失焦或文件進入隱藏狀態
- **THEN** 系統安全結束拖曳、自動捲動與相關樣式
- **AND** 未完成的拖曳回復開始前順序
- **AND** 不送出該次取消操作的排序寫入

### Requirement: 管理器必須分離顯示頁籤與已隱藏頁籤

「我的清單」MUST 分別顯示「顯示中的頁籤」與可收合的「已隱藏頁籤（n）」；顯示中頁籤 MUST 以斜線眼睛圖示提供隱藏操作，已隱藏區的每個頁籤 MUST 以眼睛圖示提供取消隱藏操作，且 visibility MUST NOT 再以泛用「啟用」勾選框或常駐文字按鈕表示。

#### Scenario: 使用者開啟含隱藏頁籤的管理器

- **WHEN** effective tab model 含有一個或多個已隱藏頁籤
- **THEN** 管理器顯示正確的已隱藏數量與獨立區域
- **AND** 隱藏頁籤不參與顯示中頁籤的拖曳排序
- **AND** 已隱藏列顯示具有「取消隱藏頁籤 {名稱}」accessible name 與 tooltip 的眼睛圖示按鈕
- **AND** 使用者不需猜測排序數字或編輯頁籤表單即可找到取消隱藏入口

#### Scenario: 使用者查看顯示中頁籤

- **WHEN** 管理器呈現可隱藏的顯示中頁籤
- **THEN** 該列顯示具有「隱藏頁籤 {名稱}」accessible name 與 tooltip 的斜線眼睛圖示按鈕
- **AND** 圖示使用目前文字色並保留可見 hover 與鍵盤 focus 狀態
- **AND** 圖示本身不重複朗讀裝飾性內容

#### Scenario: 沒有任何隱藏頁籤

- **WHEN** effective tab model 的所有頁籤皆為顯示中
- **THEN** 管理器顯示「已隱藏頁籤（0）」或等效的清楚空狀態
- **AND** 不顯示無法操作的隱藏頁籤列
