## Context

十個籌碼 pane 共用 `public/static/chip-panes.js` 建立詳細資料 DOM，並共用 `public/static/styles.css` 的 `.chip-holder-details` 與 `.chip-pane-details-table` 樣式。第一版已將浮層由 680px 縮至 500px、表格最小寬度由 540px 縮至 460px，但表格的 `width: 100%` 與固定寬度仍會把四欄撐開，在項目、日期、數值及 metadata 標題後方留下明顯空白。

## Goals / Non-Goals

**Goals:**

- 讓前期與當期欄位只顯示資料日期。
- 讓桌面浮層與表格依各詳細資料的實際內容寬度收縮，不保留固定欄寬造成的空白。
- 讓所有籌碼詳細資料視窗維持一致版面，窄螢幕仍可安全捲動。
- 以自動化契約測試與實際瀏覽器量測驗證結果。

**Non-Goals:**

- 不改變詳細資料的項目、數值、變化計算、色彩語意或資料來源。
- 不改變右鍵開啟、鍵盤操作、關閉行為與浮層定位演算法。
- 不調整籌碼副圖本體、標題列或副圖功能表。

## Decisions

1. 動態表頭直接以 `model.previousDate` 與 `model.currentDate` 顯示 ISO 日期；缺少前期或當期日期時顯示「無前期資料」或目標日期／「無資料」。這比用 CSS 隱藏前綴更能維持無障礙名稱與 DOM 真實內容一致。
2. 浮層與表格改用內容固有寬度（`max-content`）計算，不設定固定桌面寬度或表格最小寬度；四欄只保留文字、數字與既有 4px 水平 padding 實際需要的空間。
3. 浮層保留 `max-width: calc(100vw - 16px)` 與 `overflow: auto`；當內容寬度超過 viewport 時，由浮層提供水平捲動，不壓縮或裁切長數字。
4. 不為不同 pane 建立特例；所有法人、融資融券、借券、券資比與 holder 詳細資料沿用同一 CSS 契約，避免未來版面漂移。

## Risks / Trade-offs

- [長 metadata 可能主導浮層固有寬度] → metadata 值維持可換行，最大寬度仍受 viewport 限制；數字比較欄則維持不換行。
- [縮窄後四個數值欄可能擁擠] → 保留 10px 字級並以正式資料的最長數值案例做瀏覽器驗證；若內容超出則由既有 overflow 提供捲動。
- [靜態 CSS 契約通過但視覺仍不理想] → 在多圖畫面實際開啟 holder、法人與融資代表視窗，量測浮層寬度並檢查內容可見性。
