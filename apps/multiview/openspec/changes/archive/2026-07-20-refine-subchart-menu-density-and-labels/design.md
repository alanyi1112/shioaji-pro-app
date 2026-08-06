## Context

「副圖」選單由 `public/static/index.html` 的固定 checkbox 結構與 `public/static/styles.css` 的 popover 樣式組成。現行選單桌面最小寬度為 250px，籌碼群組主項與次項沒有明確字級差異，且完整資料名稱造成兩欄內容頻繁換行。checkbox 的 `value`、pane registry label 與保存偏好彼此獨立，因此可只調整選單顯示文字與 CSS，不需要資料遷移。

## Goals / Non-Goals

**Goals:**

- 將一般桌面副圖選單收斂為不超過 188 CSS px，6／8 圖窄面板進一步收斂為不超過 180 CSS px，窄螢幕仍限制在可用 viewport 內。
- 讓技術指標與籌碼群組主項使用較小字級，籌碼次項再小一級。
- 依使用者指定縮短籌碼選單名稱，保留操作、資料與 pane 行為。
- 移除籌碼群組內的常駐說明文字，並在目前商品或週期不適用時隱藏整個籌碼選項群組與籌碼 pane。
- 以自動化 contract 與實際瀏覽器畫面驗證寬度、字級層級及文案。

**Non-Goals:**

- 不修改 pane header、右鍵詳細資料、series label 或 API response 文案。
- 不修改 checkbox value、選取狀態格式、群組 ID、pane ID、資料來源或 D1 schema；不適用期間只暫時隱藏，切回適用商品與日 K 時還原該商品既有選取狀態。
- 不重新設計選單色彩、checkbox 樣式或其他工具列控制項。

## Decisions

1. **只改顯示文案，不改內部識別。** `foreign-flow-holding` 等 value 與 registry label 維持不變，避免既有偏好或資料載入行為失效。相較於全域改名，這能精準符合「功能表內縮短」的需求。
2. **依面板密度設定寬度並向左展開。** `.subchart-indicator-options` 一般使用 `width: min(188px, calc(100vw - 24px))`，6／8 圖使用 180px 上限；選單以 `right: 0`、`left: auto` 對齊「副圖」按鈕右側，避免窄面板中右緣超出 `.chart-panel`。既有 520px breakpoint 繼續把次項改成單欄。
3. **建立明確字級層級。** 技術指標與籌碼群組主項使用 12px，籌碼次項使用 11px；次項 line-height 維持可讀且不得靠縮放 checkbox 達成壓縮。
4. **以靜態 contract 加瀏覽器可見結果雙重驗證。** 測試鎖定文案與 CSS contract；瀏覽器檢查實際寬度、兩層字級及沒有不必要的水平捲動。
5. **以商品代號與日 K 週期控制適用性。** 前端用與既有籌碼請求一致的台股代號規則判斷 `.TW`／`.TWO` 商品，且僅在 `1d` 顯示籌碼群組。`chip-panes.js` 同時把不適用 context 的 desired pane 視為空集合，避免從台股切到美股或非日 K 後殘留舊籌碼圖；保存狀態不刪除，切回原 context 可還原。
6. **展開時解除所屬面板裁切。** 只有包含已展開 indicator menu 的 `.chart-panel` 暫時使用 `overflow: visible` 並提高 stacking order，讓完整選單可覆蓋相鄰圖表；選單關閉後立即回復原本裁切與層級，不改變圖表常態布局。
7. **技術指標固定兩欄排列。** `.technical-indicator-options` 使用兩個等寬欄位，legend 橫跨兩欄，四個既有 label 依 DOM 順序形成 `RSI／KD` 與 `MACD／ATR` 兩列；不改 checkbox value、預設勾選或鍵盤順序。
8. **移除籌碼群組分隔線並壓縮留白。** `.chip-data-group` 不再繪製 `border-top`，群組 fieldset 與群組內的垂直 gap 縮為 2px、padding 歸零，父項最小高度收斂為 22px；保留兩欄子項與完整 label 點擊區。

## Risks / Trade-offs

- [縮至 180px 後兩欄空間變少] → 次項維持短名稱與正常換行；6／8 圖實測所有標籤完整、沒有水平捲動，窄 viewport 仍可切為單欄。
- [窄面板右側裁切選單] → 不只縮寬，也讓選單右側對齊按鈕、向左展開，將完整寬度留在面板內。
- [面板 `overflow: hidden` 裁掉選單下半部] → 僅在 indicator menu 展開期間解除該面板裁切並提高層級，關閉後恢復原狀。
- [技術指標單欄增加選單高度並遮住最下方持股比] → 技術指標固定兩欄兩列，直接減少兩列高度，讓持股比群組完整露出。
- [三個籌碼群組的分隔線與留白堆高選單] → 移除群組上邊框，統一將群組間與群組內垂直 gap 收斂為 2px，不縮小 checkbox 本體。
- [顯示名稱與 pane header 不同可能讓開發者混淆] → 規格明確限定此次只改選單，測試同時保留 checkbox value 與群組 ID。
- [兩欄次項點擊區域縮小] → 保留完整 label 點擊區及既有鍵盤 focus 行為，只調整文字大小與欄寬。
- [只隱藏選單但既有 pane 殘留] → 選單與 pane manager 共用同一適用性判斷，context 切換時同步 reconcile。
