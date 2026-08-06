## Context

每個 chart panel 由 template 複製出「主圖」與「副圖」兩個原生 `<details>` 功能表。共用 `.indicator-options` 目前使用相對於 summary 的 `position: absolute` 並固定向下展開；`.chart-panel:has(.indicator-menu[open])` 只會解除 panel 裁切，無法避免內容超出瀏覽器 viewport。副圖功能表另有 `max-height` 與垂直捲動，但主圖功能表包含七個指標、數值顯示及四個單欄繪圖按鈕，沒有相同保護，因此 4／6／8 圖下排特別容易截掉末端操作。

`wireIndicatorMenus` 已負責同一 panel 選單互斥、外部左鍵收合、Escape 與 cleanup，適合在不改變狀態模型的前提下加入展開定位。主圖 checkbox、button 與 select 的 class／value 已被指標渲染、偏好保存及繪圖生命週期使用，必須維持相容。

## Goals / Non-Goals

**Goals:**

- 讓主圖與副圖功能表在 1／2／4／6／8 圖、上排／下排及不同 viewport 高度下，所有選項都可看見或經由功能表內捲動操作。
- 依實際可用空間自動選擇向下或向上展開，並保留 viewport 安全邊距。
- 以兩欄指標與兩欄繪圖工具降低主圖功能表高度，同時維持長標籤可讀、正常 checkbox／button 點擊範圍及既有鍵盤順序。
- 讓定位計算可用純函式測試，DOM wiring 可清理且不累積事件監聽器。

**Non-Goals:**

- 不改主圖／副圖可選項目、checkbox value、預設勾選、指標計算、繪圖工具語意或偏好保存格式。
- 不改圖表 panel 尺寸、主副圖資料、Worker API、D1／R2 schema、Sites 存取控制或外部資料來源。
- 不將功能表改為 dialog、drawer、全畫面設定頁或第三方 popover 元件。

## Decisions

### 1. 以共用純函式決定展開方向與可用高度

新增可測試的定位計算，輸入 summary 邊界、內容自然高度、viewport 高度與安全邊距，輸出 `down`／`up` 方向及可用 `max-height`。內容能放入下方時優先向下；下方不足且上方空間較多時向上；兩側都不足時選擇空間較大的一側並限制高度。

相較於只用 8 圖 `nth-child` 判斷下排，幾何計算也能正確處理 4／6 圖、頁面捲動、瀏覽器工具列造成的高度差與 resize。相較於把功能表改成 `position: fixed`，保留絕對定位與既有 panel stacking 可降低水平定位、縮放及 panel 重建的複雜度。

### 2. 在既有 `wireIndicatorMenus` 生命週期套用定位並可重新計算

選單 `toggle` 成為 open 時先清除上一輪限制、讀取內容自然高度，再套用方向 class 與 CSS custom property。開啟期間遇到 viewport resize 或可捲動祖先／window scroll 時重新計算；關閉及 panel cleanup 時移除暫態 class、style 與新增 listener。另一選單展開、外部左鍵及 Escape 行為維持不變。

定位邏輯不移動 DOM、不重建 input，也不在功能表內操作後自動收合，因此多選、焦點及鍵盤順序不受影響。

### 3. 以 CSS class 與動態高度變數建立 viewport-safe fallback

一般狀態沿用向下展開；向上狀態改用 `bottom: calc(100% + 6px)` 並清除 `top`。主圖與副圖 options 共用由定位器寫入的可用高度變數、`overflow-y: auto`、`overflow-x: hidden` 與 `overscroll-behavior: contain`。寬度繼續限制在 `calc(100vw - 24px)` 內，主圖／副圖分別維持適合內容的寬度與既有左右對齊。

只增加 `max-height` 而不翻轉的替代方案會讓下排短空間產生不必要的小型捲動區；只翻轉而不限制高度則無法處理低高度視窗，因此兩者必須同時存在。

### 4. 主圖內容分為緊湊指標格與繪圖工具格

主圖七個 checkbox 包在語意不改的專屬 grid 容器中：短標籤以兩欄依 DOM 順序排列，`Volume Profile`、「本益比河流圖」與「估算融資成本」等較長標籤可跨兩欄，避免截字或極窄換行。文字採 12 CSS px 與可讀 line-height，checkbox 不縮放，完整 label 仍可點擊。

「數值顯示」維持全寬控制列；「繪圖工具」標題橫跨兩欄，費波那契回撤／拓展、價格範圍／清除繪圖形成兩列。button 保留至少 26 CSS px 高度、focus 樣式與原 DOM 順序。這比全面縮成 10px 或折疊繪圖工具更兼顧可讀性與直接操作。

### 5. 驗證同時鎖定計算、結構與實際可見結果

自動化測試覆蓋上方足夠、下方不足、兩側不足、resize 後重算、cleanup、兩欄結構與相容 class／value。瀏覽器驗收至少包含 1／4／6／8 圖、首末欄與上下排 panel，並使用較矮桌面 viewport 驗證功能表邊界、內部捲動、checkbox／select／button 操作、外部收合與 Escape。

## Risks / Trade-offs

- [開啟後的 `max-height` 影響下一次自然高度量測] → 每次計算前移除舊高度變數與方向 class，讀取 `scrollHeight` 後再套用限制。
- [向上展開會覆蓋上一排圖表] → 沿用 open panel 的提高層級；覆蓋只存在於操作期間，且比截掉選項更可操作。
- [功能表內滾輪連帶捲動頁面] → 使用 `overscroll-behavior: contain`，內容到頂／到底時不把捲動傳給背景頁面。
- [兩欄造成長標籤換行或點擊區縮小] → 長標籤跨欄，維持 12px、正常 checkbox 尺寸及完整 label 點擊範圍。
- [多個 panel 重建後累積 viewport listener] → 所有新增 listener 納入 `wireIndicatorMenus` 回傳的既有 cleanup，測試 listener 數量歸零。
- [瀏覽器不支援 CSS `:has`] → 專案現行已依賴 `.chart-panel:has(...)`；本變更不新增更高的相容性門檻。

## Migration Plan

1. 先加入純定位計算與互動測試，再接入 `wireIndicatorMenus` 的 toggle／resize／scroll／cleanup。
2. 加入向上展開與動態高度 CSS，讓主圖、副圖先具備 viewport-safe fallback。
3. 將主圖指標與繪圖工具改為緊湊 grid，保留既有 selector、value 與事件綁定；更新靜態資產 cache key。
4. 完成自動化、production build 與多圖瀏覽器驗收後發布；若發生互動回歸，可回退至前一 Sites version，無需資料遷移。

## Open Questions

無；採空間感知翻轉、動態高度限制與主圖兩欄重排的組合方案。
