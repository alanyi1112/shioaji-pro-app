## Context

河流 overlay 已以同一個 SVG 繪製七條線與六個 band，七種 multiplier 及 pointed-date 詳情則由 `pe-river-overlay.js` 動態塞入主圖 `.readout-row-pe-river`。Panel 另有既存的自製右鍵選單與完整清理生命週期，可直接增加需要時才展開的詳情區，不需要建立新的全域 modal。

## Goals / Non-Goals

**Goals:**

- 七條線各自在顯示區左側呈現同色、帶框的 `—Pxx N.NNx—` SVG 標籤；線距不足時避讓排列並以同色短連接線指回對應河流線。
- 主圖左上 readout 不再建立河流詳情文字，釋放 K 線顯示空間。
- 右鍵選單在目前河流圖有可用 pointed-date 詳情時顯示「本益比河流圖詳細說明」，點擊後才展開全部原 readout 內容。
- 保留 provisional、盤中估算、來源、授權、coverage 與排除投資建議的既有語意。
- 取消河流、切換內容與銷毀 panel 時完整清除詳情狀態。

**Non-Goals:**

- 不變更 percentile、reference EPS、河流價格、band、資料 API、D1 或背景回補。
- 不把右鍵詳情改成常駐面板、hover tooltip 或全域 modal。
- 不讓右鍵選單及展開詳情進入 PNG；PNG 只保存主圖上實際可見的河流線、band、線上標籤與狀態提示。

## Decisions

1. 在現有河流 SVG `plot` 群組最後加入七個 label group。每個 group 含深色半透明 `rect` 與同色 `text`，先以第一個可見有效點的對應 Y 座標定位；若標籤框互相重疊，純函式會依價格高低順序避讓，並以同色 1px 短連接線指回原河流線。標籤固定靠 plot 左側並受既有 clip path 裁切。
2. multiplier 標籤沿用 `COLORS` 與線條 key；P50 仍只在線寬上維持 1.4px，標籤框線統一 1px，避免文字框過重。
3. controller 不再接收 readout DOM，而是在 `updateReadout` 時計算並保存 `detailLines`。保留方法名稱以降低 app 呼叫面變更，並新增 `getDetailLines()` 回傳副本供 panel 右鍵選單讀取。
4. Panel 右鍵選單新增一個 `aria-expanded` 按鈕與 hidden 詳情容器。開啟右鍵選單時先依 pointed date 同步 controller 詳情；無詳情時不顯示該按鈕，點擊只切換同一選單內的詳情容器。
5. 移除 `index.html` 的 `.readout-row-pe-river`，避免主圖 readout 高度仍被空節點或舊樣式保留。既有 bottom status 仍用於載入、資料不足、provisional 等狀態。

## Risks / Trade-offs

- [七個左側標籤在 multiplier 接近時可能互相靠近] → 依價格高低順序做垂直避碰，必要位移以同色短連接線維持對應關係；瀏覽器驗收覆蓋實際單圖與密集狀態。
- [右鍵時 pointed-date 詳情可能尚未更新] → `openPanelContextMenu` 以已解析的日期及 candle 同步呼叫 controller，再決定按鈕可見性與內容。
- [展開後選單超出視窗] → 沿用選單 max-height／overflow，展開時重新夾限 top 位置。
- [原 PNG 不再含來源文字] → 這是常駐 readout 移除後的預期結果；線上 multiplier 標籤隨 SVG 一起匯出，右鍵詳情維持 export-excluded。
