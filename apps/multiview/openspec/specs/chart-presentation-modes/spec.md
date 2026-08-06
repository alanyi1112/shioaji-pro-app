# chart-presentation-modes Specification

## Purpose
TBD - created by archiving change add-main-subchart-presentation-modes. Update Purpose after archive.
## Requirements
### Requirement: 全域主副圖控制必須提供三種語意模式

系統 MUST 將頂端全域控制標示為「主副圖」，並依序提供「主圖」、「單一副圖」、「多層副圖」三個選項；控制項 MUST NOT 顯示 A／B／C 等內部代號。全域選擇 MUST 同時套用至目前所有 panel，並在圖表數量、頁籤或單一商品頁切換後維持符合資格的 effective mode。

#### Scenario: 顯示主副圖控制
- **WHEN** 使用者載入任一市場的多圖或單一商品頁
- **THEN** 頂端控制標籤 MUST 顯示「主副圖」
- **AND** 下拉選項 MUST 依序顯示「主圖」、「單一副圖」、「多層副圖」
- **AND** 選項文字 MUST NOT 顯示內部模式代號

#### Scenario: 首次載入沒有保存偏好
- **WHEN** 裝置沒有合法的新呈現模式偏好，也沒有既有 A／B 偏好
- **THEN** 系統 MUST 預設選擇「單一副圖」
- **AND** MUST NOT 因目前是 eligible 台股而自動切為多層副圖

#### Scenario: 全域切換所有目前 panel
- **WHEN** 使用者在 1、2、3、4、6 或 8 圖選擇任一可用呈現模式
- **THEN** 所有目前 panel MUST 在同一次狀態更新中採用相同 effective mode
- **AND** 圖表數量切換 MUST NOT 把目前保存偏好重設為預設值

### Requirement: 主圖模式必須收合並停止所有副圖 lifecycle

使用者選擇「主圖」時，系統 MUST 只呈現每個 panel 的主 K 線與既有主圖 overlay／readout，MUST 將副圖列高度收合為 0 並讓主圖使用剩餘 panel 空間。不可見技術副圖與籌碼 pane MUST 停止 resize、crosshair、讀值、輪詢、背景回補與資料 request lifecycle，且 MUST NOT 清除其保存選取。

#### Scenario: 從單一副圖切到主圖
- **WHEN** 使用者在方式 A 顯示技術副圖或單一籌碼 pane 時選擇「主圖」
- **THEN** 副圖槽位 MUST 完全隱藏且主圖擴展至釋放空間
- **AND** 目前籌碼 request MUST 被取消或其 response 被隔離
- **AND** 主 K 線、candles、主圖 overlay 與可視時間範圍 MUST NOT 重建或重新請求

#### Scenario: 從多層副圖切到主圖
- **WHEN** 使用者在方式 B 顯示一個以上技術或籌碼 pane 時選擇「主圖」
- **THEN** 所有副圖 controller、group wrapper、提示與獨立 Y 軸 MUST 從作用中 lifecycle 移除
- **AND** document MUST 移除多層副圖頁面捲動版型
- **AND** 不得清除方式 B 的 pane 選取、series 或群組順序

#### Scenario: 主圖模式不載入不可見籌碼資料
- **WHEN** 主圖模式下使用者切換台股商品、週期、頁籤或圖表數量
- **THEN** 系統 MUST NOT 為不可見籌碼 pane 發出資料 request、立即回補或輪詢
- **AND** 已移除 panel MUST 依既有 lifecycle 清理 listener、observer 與 AbortController

#### Scenario: 主圖模式停用 panel 副圖設定入口
- **WHEN** panel 使用主圖模式
- **THEN** panel 內「副圖」選單 MUST 維持原工具列位置但不可展開或變更選取
- **AND** 控制 MUST 提供 `aria-disabled="true"` 或等效可存取狀態與切換模式提示
- **AND** 切回單一或多層副圖後 MUST 恢復可操作

### Requirement: 模式切換必須保留並恢復副圖偏好

主圖模式 MUST 是呈現狀態而非取消選取操作。系統 MUST 分別保留方式 A 的作用種類與單一籌碼 pane、方式 B 的技術指標、籌碼複選、series 與群組順序；離開主圖後 MUST 依目的模式恢復，且不得重新請求主 candles。

#### Scenario: 主圖切回單一副圖
- **WHEN** 使用者進入主圖前的方式 A 顯示特定技術指標或籌碼 pane，之後選擇「單一副圖」
- **THEN** 系統 MUST 在同一共用槽位恢復原作用種類與保存選取
- **AND** MUST NOT 改寫方式 B 的 pane 清單或群組順序

#### Scenario: 主圖切回多層副圖
- **WHEN** 使用者進入主圖前已在方式 B 保存多個 pane 與自訂群組順序，之後在 eligible 台股選擇「多層副圖」
- **THEN** 系統 MUST 依原選取及群組順序重建可見 pane
- **AND** 相同 dataset MUST 沿用既有 cache／single-flight，不得逐 pane 重複抓取上游

### Requirement: 呈現模式偏好必須安全遷移

系統 MUST 優先讀取合法的語意呈現模式偏好；若尚無新偏好，既有 `compactSubchartMode=A` MUST 遷移為單一副圖，`compactSubchartMode=B` MUST 遷移為多層副圖，其他缺值或損毀值 MUST 回到單一副圖。遷移與後續寫入 MUST NOT 清除舊 A／B 內的 pane selection。

#### Scenario: 遷移既有 A 偏好
- **WHEN** 新呈現模式偏好不存在且舊值為 A
- **THEN** 系統 MUST 選擇單一副圖
- **AND** 方式 A 最後作用的技術或籌碼種類 MUST 保留

#### Scenario: 遷移既有 B 偏好
- **WHEN** 新呈現模式偏好不存在且舊值為 B
- **THEN** eligible 台股 MUST 選擇多層副圖
- **AND** 既有 pane 選取、series 與群組順序 MUST 原樣保留

#### Scenario: 新偏好覆蓋舊相容值
- **WHEN** 新呈現模式偏好是合法的 main、single 或 multi，且舊 A／B 值不同
- **THEN** 系統 MUST 採用新偏好
- **AND** MUST NOT 讓舊值覆寫使用者較新的選擇
