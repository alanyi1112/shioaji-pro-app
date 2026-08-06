## Context

目前顯示中頁籤列採「拖曳把手＋名稱＋上移＋下移＋隱藏」五段控制。管理器左欄寬度有限，上下按鈕與文字版隱藏按鈕會固定占用空間，使頁籤名稱即使不長也過早省略。排序 coordinator、canonical payload 與 visibility API 已完成，本次只調整前端控制呈現與鍵盤入口，不改動資料模型或 API。

## Goals / Non-Goals

**Goals:**

- 讓頁籤名稱優先使用列內剩餘寬度。
- 移除可見的上移／下移按鈕，保留滑鼠及觸控拖曳排序。
- 將鍵盤排序整合到可聚焦的拖曳把手，維持基本無障礙操作。
- 以眼睛關閉／眼睛開啟圖示表達隱藏與取消隱藏，並保留文字語意給輔助技術與 tooltip。
- 沿用既有排序 coordinator、錯誤回復與 visibility mutation。
- 讓全台股頁籤的 6／8 圖重新取得 A／B 模式選擇，並沿用方式 B 的 document scroll 與 pane lifecycle。

**Non-Goals:**

- 不修改 `/api/tabs/reorder`、`/api/tabs/visibility` 或 D1 schema。
- 不改變取消隱藏移到最後、active/default fallback 或隱藏最後頁籤限制。
- 不放寬非台股或混合頁籤的方式 B 限制。
- 不引入第三方圖示套件，也不直接使用使用者提供的帶浮水印參考圖片。

## Decisions

### 1. 拖曳把手同時承擔鍵盤排序

移除頁籤列的兩個可見箭頭後，拖曳把手仍使用原本的 button 語意與位置 accessible name。把手取得焦點時，`ArrowUp`／`ArrowDown` 會呼叫既有單步排序流程；第一列與最後一列的無效方向不寫入。這比保留隱藏的重複按鈕更精簡，也比完全移除鍵盤操作更安全。

### 2. 使用內嵌 SVG 圖示而非圖片資產

眼睛與斜線眼睛以程式內固定 SVG 建立，使用 `currentColor`、`aria-hidden="true"` 及 `focusable="false"`。按鈕本身保留完整 `aria-label` 和 `title`，因此圖示不需要自行提供文字替代；也能避免外部資產授權、浮水印、載入失敗與深色主題不一致。

### 3. 頁籤列採彈性名稱欄與固定圖示欄

頁籤列維持拖曳把手與 visibility 圖示固定尺寸，名稱按鈕設為 `min-width: 0`、`flex: 1 1 auto`，控制區不再保留箭頭寬度。名稱仍為單行省略號，以免極端長名稱破壞左欄布局；完整名稱可由既有按鈕 accessible name 與 tooltip 取得。

### 4. 不變更 mutation 與狀態協調

圖示按鈕仍呼叫 `setManagedTabVisibility()`；鍵盤排序仍呼叫與拖曳完成相同的本機 reorder/coordinator。如此可沿用 latest-wins、canonical response、失敗回復與 mutation lock，不產生第二套排序狀態。

### 5. 6／8 圖只移除圖數限制，保留市場限制

`effectiveCompactSubchartMode()` 不再因 `currentChartCount() >= 6` 強制回傳 A；`updateChipModeControl()` 也不再因圖數停用 select。全台股頁籤因此可依保存偏好切換 A／B，非台股或混合頁籤仍由 `activeTabSupportsMultiLayerSubcharts()` 強制 A。方式 B 既有 `.is-mode-b-page-scroll`、pane lifecycle、single-flight 與窄 panel 樣式直接套用到 6／8 圖，不建立另一套模式。

### 6. 單一商品頁以目標 symbol 判斷模式資格

一般多圖仍要求目前頁籤全部商品皆為台股，避免混合頁籤建立不一致的多層 pane；但 `state.singleChartView` 存在時，畫面只有一個明確目標商品，因此 `activeTabSupportsMultiLayerSubcharts()` MUST 只檢查 `state.singleChartView.symbol`。這讓混合來源頁籤中的台股商品進入單圖後可切換 A／B，非台股單圖仍固定 A。

## Risks / Trade-offs

- [圖示語意對部分使用者不夠直觀] → 同時提供 `title`、`aria-label`、hover/focus 樣式，且眼睛開啟只出現在已隱藏區、斜線眼睛只出現在顯示區。
- [移除可見箭頭降低功能可發現性] → 拖曳把手維持明確游標與位置名稱；鍵盤焦點時可透過方向鍵操作並更新位置語意。
- [長名稱仍可能超過可用寬度] → 使用省略號保護布局，但較現況多出兩個箭頭按鈕的寬度。
- [鍵盤連按可能與 pending reorder 重疊] → 沿用既有 revision 與 latest-wins coordinator。
- [8 圖方式 B 同時顯示大量 pane 會增加頁面高度與前端負載] → 沿用 document scroll、D1 cache／single-flight 與使用者可自行切回 A；驗收 6／8 圖切換、重新載入及 console error。

## Migration Plan

1. 更新前端列組裝與 SVG icon helper。
2. 更新 CSS 欄寬、圖示尺寸及 focus 狀態。
3. 補齊 source contract 與互動測試。
4. 在本機瀏覽器驗證長名稱、拖曳、鍵盤排序、隱藏、取消隱藏、台股 6／8 圖 A／B 切換，以及台股／非台股 `view=single` 資格。
5. 若驗收失敗，回復前端與 delta spec；API 與資料無需回滾。

## Open Questions

無。
