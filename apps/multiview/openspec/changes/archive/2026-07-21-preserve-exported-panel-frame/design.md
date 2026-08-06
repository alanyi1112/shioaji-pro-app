## Context

現行 `renderPanelBlob` 以 html2canvas 擷取單一 `.chart-panel`，並在 clone 內將 panel 設為 `overflow: visible`，確保超出 viewport 或 `scrollHeight` 的長副圖仍能被納入。panel 外框原本由父元素的 `border` 與 `border-radius` 繪製，但瀏覽器繪製順序會讓後繪製且允許溢出的子圖內容蓋過父元素右側框線；實際 PNG 已出現上、下、左框存在，但右框及右側圓角消失的結果。

## Goals / Non-Goals

**Goals:**

- 匯出的 PNG 必須具有完整上、右、下、左框線及四個圓角。
- 外框必須沿用匯出當下 panel 的框線寬度、顏色、樣式與圓角。
- 長圖完整內容、輸出比例、圖片安全上限與本機匯出行為維持不變。
- 可透過自動化 contract 與實際 PNG 邊界像素驗證修正。

**Non-Goals:**

- 不重做 html2canvas 或改用伺服器截圖。
- 不變更畫面中 panel 的常態 CSS、hover 樣式或圖表資料。
- 不額外加入留白、浮水印、標題或下載格式。

## Decisions

### 在 clone 最後加入匯出專用 frame

於 `onclone` 取得 cloned panel 後，保留原 border 寬度但將其顏色設為透明，再建立絕對定位、`pointer-events: none`、最高堆疊層級的單一 frame，避免原框線與 frame 疊成雙線。frame 利用 panel padding box 作為定位基準，在完整擷取邊界內四周等距保留 1 CSS px，使四側框線不會落在 html2canvas 的 canvas 裁切邊界；它使用 `box-sizing: border-box`，並複製來源 panel 的四側框線與 `border-radius`。因 frame 是 cloned panel 的最後一個子元素且位於最上層，所有 K 線 Canvas、副圖與右側數值軸都無法再覆蓋它。

未採用增加 canvas 尺寸或外部 padding，因為會改變輸出尺寸；frame 的 1 CSS px 對稱內縮可在原尺寸內避免 renderer 裁切。也不採用 `overflow: hidden`，因為會重新引入長副圖被裁切的問題。

### frame 僅存在於匯出 clone

frame 不加入 live DOM，且加上 `data-export-frame` 供測試辨識。它不參與滑鼠事件、不改變 grid layout，也不會在匯出後留下節點。

### 以來源 computed style 作為唯一外觀來源

匯出前讀取 live panel 的 `borderTop/Right/Bottom/Left` 與 `borderRadius`，明確寫入 clone frame。這可保留一般框線與 hover／選取狀態，不另行硬編碼顏色。

## Risks / Trade-offs

- [html2canvas 對極高 `z-index` 或 CSS shorthand 的支援差異] → 對四側框線分別設定完整 computed value，並用實際瀏覽器產圖驗證。
- [frame 可能蓋到最外側 1px 圖表內容] → frame 只占用原本就屬於 panel 外框的邊界像素，不新增內縮或改變資料可視範圍。
- [完整擷取尺寸受安全上限縮放] → frame 與圖表由同一個 canvas scale 等比例縮放，四邊不另行計算像素比。
