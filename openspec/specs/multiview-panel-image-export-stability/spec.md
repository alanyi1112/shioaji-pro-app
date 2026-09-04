# multiview-panel-image-export-stability Specification

## Purpose

確保 MultiView 匯出單一商品完整 panel PNG 時，所有已選且適用的虛擬化副圖都完成掛載與繪製，並在匯出結束後精確還原資源與互動狀態。

## Requirements

### Requirement: 完整 panel PNG 必須包含所有應顯示的虛擬化副圖

MultiView MUST 在擷取單一商品完整 panel PNG 前，讓該 panel 所有已選取、適用且應顯示的籌碼副圖完成掛載與繪製；副圖是否位於目前 viewport 或 240px 預載範圍內 MUST NOT 改變輸出內容。PNG MUST 保留每個 pane 的標題、讀值、已繪製 series、overlay、共用日期線與右側價格軸，且 MUST NOT 建立未選取、隱藏或不適用的副圖。

#### Scenario: 從 panel 頂端匯出離屏融資券與持股副圖

- **WHEN** 使用者停留在主圖附近，且已選取的融資券與持股副圖位於 viewport 預載範圍之外
- **THEN** 匯出的完整 panel PNG MUST 包含這些副圖的所有合法線條、柱狀圖及右側價格軸
- **AND** MUST NOT 只保留 pane 標題與讀值而讓 plot 區域空白

#### Scenario: 從底部副圖匯出上方離屏內容

- **WHEN** 使用者捲動至 panel 底部並從籌碼副圖右鍵選擇「儲存圖片」
- **THEN** PNG MUST 同時包含主圖、技術副圖及所有已選取籌碼副圖
- **AND** 匯出結果 MUST NOT 取決於觸發位置或匯出瞬間的 mounted controller 集合

#### Scenario: 明確不適用或無資料的副圖

- **WHEN** 某已選 pane 對目前商品／週期明確不適用，或 material availability 明確表示沒有可繪製資料
- **THEN** 系統 MUST 保留畫面上的不適用／無資料狀態或既有空狀態
- **AND** MUST NOT 補造 series、假資料或額外空白高度

### Requirement: 匯出準備必須使用目標 panel 專屬且有界的資源租約

MultiView MUST 只為被匯出的單一商品 panel 暫時掛載缺少的已選副圖，並記錄匯出前的 mounted controller 集合。匯出準備 MUST NOT 永久停用離屏虛擬化、掛載其他商品的離屏副圖、重新抓取行情／籌碼資料或變更使用者選取與群組順序。

#### Scenario: 單一商品具有多層副圖

- **WHEN** 目標 panel 開始匯出且部分已選副圖尚未掛載
- **THEN** 系統 MUST 只使用該 panel 最後已保留的合法 payload 暫時掛載所需 controller
- **AND** 其他商品 panel 的 mounted controllers 與 Canvas 數量 MUST 維持不變

#### Scenario: 成功匯出後還原資源

- **WHEN** PNG Blob 與下載均成功完成
- **THEN** 系統 MUST 卸載僅為本次匯出暫時建立的 controllers
- **AND** 匯出前已掛載的 controllers MUST 保持掛載，清理後 mounted 集合與 Canvas 數量 MUST 回復匯出前狀態

#### Scenario: 匯出期間 viewport 改變

- **WHEN** 使用者在準備或擷取期間捲動，使一般 `IntersectionObserver` 判斷改變
- **THEN** 匯出租約所需 controllers MUST 在擷取完成前保持可用
- **AND** 租約釋放後 MUST 恢復一般 viewport-near 掛載／離屏卸載政策

### Requirement: 匯出前必須確認 Canvas 與 series 已確定就緒

MultiView MUST 以 panel generation、symbol、interval、context identity、chart mounted 狀態、Canvas 有效尺寸與 expected series 狀態判斷匯出就緒。系統 MUST 有界等待 layout 與 paint 完成；只等待固定時間、只檢查一般 DOM 或只確認整張輸出非空白 MUST NOT 視為完整性證據。

#### Scenario: 離屏 pane 使用保留 payload 重新掛載

- **WHEN** 具有合法 material data 與已選 series 的 pane 為匯出重新掛載
- **THEN** 系統 MUST 在擷取前建立對應 series、非零尺寸 Canvas、目前價格軸與主圖 accepted viewport
- **AND** export readiness MUST 明確列出 expected 與 ready panes

#### Scenario: Canvas 在期限內未完成

- **WHEN** 任一具有合法資料的 expected pane 在有界期限內仍缺少 chart、series 或有效 Canvas
- **THEN** 系統 MUST 取消本次匯出並顯示可理解的失敗訊息
- **AND** MUST NOT 呼叫下載或產生只有標題而缺少線圖的 PNG

#### Scenario: 匯出期間商品或 generation 改變

- **WHEN** 使用者切換商品、週期、版型或銷毀 panel，使匯出租約的 identity 失效
- **THEN** 系統 MUST 取消舊匯出並禁止混合新舊商品 DOM／Canvas
- **AND** MUST 執行與其他失敗路徑相同的資源清理

### Requirement: 匯出用副圖不得改變目前 viewport 與指向讀值

匯出時新掛載的副圖 MUST 採用主圖最後接受的 viewport、目前共用游標日期、對應讀值與 axis safe width。匯出準備所產生的 chart、ResizeObserver、range 或 crosshair callback MUST 視為程式性事件，MUST NOT 改寫主圖 accepted viewport、使用者手勢狀態或其他 pane 的合法顯示範圍。

#### Scenario: 使用者縮放後從指向日期匯出

- **WHEN** 使用者已縮放或平移主圖，並在某交易日位置開啟右鍵功能表後匯出
- **THEN** 所有為匯出新掛載的 pane MUST 使用相同 accepted viewport 與指向日期
- **AND** PNG 中的日期線、readout 與 series 水平位置 MUST 與畫面一致

#### Scenario: 匯出完成後繼續操作

- **WHEN** 匯出完成或失敗後使用者繼續縮放、平移或捲動
- **THEN** 主圖與既有副圖 MUST 從匯出前的 accepted viewport 與互動狀態繼續
- **AND** MUST NOT 因 export-time mount callback 重設成 fit-content 或其他程式性範圍

### Requirement: 失敗、取消與銷毀必須共用可重入清理

匯出租約與下載流程 MUST 綁定既有 `AbortSignal` 及 panel generation，並在成功、例外、readiness timeout、再次匯出、切換 context、panel destroy 或頁籤卸載後執行可重入清理。清理 MUST 保留最後 payload、使用者選取、群組順序、讀值與其他 panel 狀態。

#### Scenario: 第二次匯出取消第一次

- **WHEN** 同一 panel 尚在準備第一張 PNG 時又啟動第二次匯出
- **THEN** 第一個工作 MUST 安全取消且釋放自己的暫時 controllers
- **AND** 第二個工作 MUST 使用新的 generation／identity 獨立準備，不得沿用失效 ready report

#### Scenario: renderer 拋出例外

- **WHEN** `html2canvas`、Canvas 編碼或下載前步驟拋出例外
- **THEN** 系統 MUST 清除匯出 class、object URL、暫時掛載與租約狀態
- **AND** 再次匯出 MUST 能正常開始，不得被殘留狀態阻擋

### Requirement: 驗收必須執行虛擬化與 PNG 匯出的真實整合路徑

自動化與瀏覽器驗收 MUST 實際讓已選副圖先離開 viewport 並卸載，再執行完整 panel PNG 匯出及解碼檢查。僅比對函式名稱、原始碼字串、DOM 標題、整張圖片尺寸或主圖非空白 MUST NOT 作為所有副圖已成功匯出的證據。

#### Scenario: 自動化驗證掛載與還原

- **WHEN** 測試以可控制的 `IntersectionObserver` 讓部分 expected panes 進入 unmounted 狀態後執行匯出
- **THEN** 測試 MUST 驗證 prepare 階段掛載全部 expected panes、擷取前全部 ready，且 `finally` 後精確還原原集合
- **AND** MUST 覆蓋成功、abort、readiness timeout、identity 改變及 renderer 失敗

#### Scenario: 代表性台股完整長圖驗收

- **WHEN** 本機瀏覽器以具有合法籌碼資料的代表性商品（包含資料可用時的 `2449.TW` 與 `2454.TW`）從 panel 頂端與底部分別匯出多層副圖 PNG
- **THEN** 驗收 MUST 逐 pane 核對融資券與持股群組的 live plot 與 PNG plot 均包含對應 series／柱狀圖及右側軸
- **AND** console MUST 沒有 application error，清理後 Canvas 數量 MUST 回復匯出前值

#### Scenario: 單圖與多圖資源隔離

- **WHEN** 驗收分別在單一商品與多商品版型匯出其中一個 panel
- **THEN** 只有目標 panel MAY 暫時增加 Canvas
- **AND** PNG MUST 排除其他商品 panel，且其他 panel 的圖表與互動狀態 MUST 維持正常
