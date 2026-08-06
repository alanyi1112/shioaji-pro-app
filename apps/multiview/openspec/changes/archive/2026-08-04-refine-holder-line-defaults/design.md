## Context

目前 `PANE_SERIES_OPTIONS` 將大戶與散戶的 `holders` 放入預設選取，且 holder 折線沿用籌碼 pane 的 2px 線寬與 3px／5px資料點。偏好以 `defaultsVersion`、tab、symbol 與 pane 隔離保存，因此只改靜態 defaults 不會讓既有未客製的舊預設立即更新。

## Goals / Non-Goals

**Goals:**

- 新使用者與沿用上一版完整預設的使用者，預設只看到持股比例與週變化。
- 保留右鍵獨立開啟股東人數線及保存偏好的既有能力。
- holder 比例線與人數線採主圖基準的 1px 線寬與 2px 資料點半徑。
- 客製過的 series 組合不因 defaults 版本升級被覆蓋。

**Non-Goals:**

- 不移除股東人數、標題列人數變化或詳細資料。
- 不改變集保戶數 pane、其他籌碼 pane、TDCC 計算、API 或 D1。
- 不改變 crosshair、尺度、色票與級距選單。

## Decisions

### 1. 新預設只包含比例與變化

大戶與散戶的 defaults 改為 `ratio`、`change`；`holders` 仍保留在右鍵 series 清單。這比隱藏 UI 或停止計算更能維持使用者按需開啟的能力。

### 2. 只遷移可判定為上一版完整預設的組合

提高 `SELECTION_DEFAULTS_VERSION`。讀取舊偏好時，只有大戶／散戶 stored series 完整等於 `ratio`、`change`、`holders` 時才移除 `holders`；其他組合視為客製偏好並原樣保留。這在無法記錄歷史點擊來源的前提下，最大限度避免覆蓋使用者選擇。

### 3. holder 折線明確覆寫主圖視覺基準

共用 `addLine()` 仍維持其他籌碼 pane 的 2px 預設；只在大戶／散戶的比例線與人數線傳入 1px `lineWidth` 與 2px `pointMarkersRadius`。單點資料不再放大為 5px，確保所有資料量都和主圖一致。

## Risks / Trade-offs

- [過去主動保留完整三項的使用者會被視為舊預設] → 這是儲存格式無法區分的唯一模糊情況；人數線仍可由右鍵重新開啟並再次保存。
- [線與資料點變細後辨識度降低] → 保留既有色票、crosshair marker 與右鍵切換，並以瀏覽器實際畫面驗證。
- [提高 defaults 版本影響其他 pane] → migration 僅對 `big-holder`、`retail-holder` 的精確舊預設組合生效，測試確認其他 pane 與客製組合不變。

## Migration Plan

1. 更新 defaults 與 version-aware migration，無資料格式或後端 migration。
2. 補齊新使用者、舊預設、客製偏好與折線 options 測試。
3. 執行完整 tests、lint、OpenSpec strict 與瀏覽器可見驗證。
4. 回滾時可還原前端靜態資產；已保存的新選擇仍是合法 series 組合。
