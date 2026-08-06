## Context

大戶與散戶 pane 共用 `createPaneController`、`resolveReadout` 與既有右鍵功能表。現行 holder `resolveReadout` 會把持股、週變化、官方級距、張數、人數、來源與提醒全部輸出到 `.chip-pane-inline-readout`，另外還在 header 放入頻率、回補狀態及級距選單；在三欄或窄面板中會自然換成多列並壓縮線圖。

這次只調整前端資訊呈現與互動，不改變 TDCC 聚合、週資料日期語意、回補狀態或資料 API。

## Goals / Non-Goals

**Goals:**

- 大戶與散戶 pane 預設標題列只保留名稱、實際資料日期、持股比例、週變化、持股增減張數與最右側級距選單。
- 將原本完整明細放入右鍵「詳細資料」所開啟的結構化表格。
- 滑鼠右鍵與鍵盤 Context Menu／`Shift+F10` 使用同一入口，詳細資料可關閉且不遮蔽其他面板操作。
- 切換級距或十字線日期時，標題與已開啟的詳細資料使用同一筆 holder snapshot。

**Non-Goals:**

- 不改變 TDCC 官方級距的聚合公式、線圖或週變化柱。
- 不新增 API、資料庫欄位、外部相依套件或 header 按鈕。
- 不調整 TDCC 回補 runner、scheduler、頻率或權限。

## Decisions

### 1. Holder 使用專用的精簡 readout

`resolveReadout` 對 holder 回傳持股比例「持股」、「週變化」與張數變化「持股」三個預設 segment；張數變化只用 `+`／`-` 與台股紅綠色表達方向，不在精簡標題另寫「增減」。日期繼續使用實際 `dataDate`。張數變化使用本週聚合張數減去前一筆實際發布週的聚合張數，不以每日資料補值。完整資料另以同一個 snapshot 建立 detail model，並在表格保留「持股增減」完整欄名，避免與持股總張數混淆。

替代方案是沿用所有 segment 再用 CSS 隱藏，但被隱藏內容仍混在 live region 與 DOM 中，無法清楚定義可存取輸出，因此不採用。

### 2. 級距選單為 holder header 的尾端控制

holder header 加上專用 class，級距選單使用 `margin-left: auto` 固定在可用列的最右側。選項文字縮成「1,000 張以上」等慣用顯示；精確官方範圍仍在詳細資料表列出，避免誤把市場慣稱當成精確下界。

在極窄畫面仍允許 header 換行，選單會保持新列右對齊，不製造水平捲動。

### 3. 詳細資料採與 pane 關聯的非模態 viewport popover 表格

每個 holder pane 建立一個預設隱藏、附 `role="dialog"` 的詳細資料區塊，內容以兩欄 table 列出日期、持股比例、週變化、官方級距、張數、人數、來源、資料頻率與提醒。右鍵功能表的「詳細資料」只負責切換這個區塊，不新增常駐按鈕。區塊掛在 `document.body` 並依觸發 pane 的可視位置採 fixed 定位，避免被 chart panel 的邊界裁切。

選擇非模態 viewport popover，而不是全頁 modal，原因是使用者仍需對照同頁其他商品與圖線；表格限制於 viewport 內，必要時自身捲動。

### 4. 共用既有選單生命週期與可存取行為

「詳細資料」只在 holder pane 出現。選單開啟時可以滑鼠或鍵盤選取；點選後將標題與表格鎖定在最新已發布的 holder snapshot，避免右鍵落點及共享十字線的延後事件又把內容覆寫成非 TDCC 發布日。關閉詳細資料時解除鎖定；Escape、點擊 pane 外、viewport resize、切換商品、移除 pane 或 destroy 都會關閉或清理詳細資料 DOM。方式 B 的頁面 scroll 只關閉右鍵選單，不關閉已開啟的 fixed 詳細資料表，避免 focus／layout 造成的 scroll event 將表格立即關掉。一般十字線停在沒有 TDCC 發布資料的日期時，標題仍明確顯示當日無資料及最近一筆參考，不沿用成當日值。

## Risks / Trade-offs

- [詳細資料 popover 可能遮住部分線圖] → 限制寬高、靠 pane 右上角顯示，使用者可用 Escape 或外部點擊立即關閉。
- [最窄欄位仍可能換行] → 保留自然換行，但移除高密度欄位並使級距選單獨立靠右，確保不產生水平捲動。
- [十字線快速移動造成表格頻繁更新] → 只重用已解析的 holder snapshot 更新文字，不發送網路請求或重建 chart。

## Migration Plan

1. 先以 contract tests 固定精簡 header、右鍵項目與詳細表格 DOM／清理行為。
2. 更新前端程式、CSS 與靜態資產版本，執行完整測試與嚴格 OpenSpec 驗證。
3. 發布 owner-only Sites 版本，以正式站驗證大戶、散戶 header、右對齊選單與右鍵詳細資料。
4. 若需回復，重新部署前一個 Sites version；資料層不需 migration 或 rollback。

## Open Questions

無。
