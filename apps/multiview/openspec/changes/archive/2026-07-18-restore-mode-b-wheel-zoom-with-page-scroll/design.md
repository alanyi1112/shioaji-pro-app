## Context

方式 B 會讓 panel 與頁面依籌碼 pane 數量自然增高，並使用 `html/body` 作為唯一垂直捲動容器。現行 `chartInteractionOptions()` 與籌碼 pane 的同名設定函式以單一 `pageScrollEnabled` 布林值同時控制滑鼠滾輪、觸控垂直拖曳及縮放；方式 B 因而把主圖、技術副圖與所有籌碼圖的 `handleScroll.mouseWheel`、`handleScale.mouseWheel` 全部關閉。左鍵拖曳與 visible logical range 同步仍存在，但使用者無法以既有習慣縮放時間資料區間。

主圖、技術副圖與籌碼 pane 已各自透過 Lightweight Charts 的 visible logical range 事件同步同一 panel，且共用十字線會在 layout 與 document scroll 後重新量測。本變更應沿用這些機制，只重新界定輸入事件的優先權，不建立第二套時間軸狀態。

## Goals / Non-Goals

**Goals:**

- 讓方式 A 與方式 B 在圖表內具備一致的桌面滑鼠操作：中央滾輪縮放、按住左鍵拖曳移動時間範圍。
- 依滑鼠指標命中區域分流：圖表區操作圖表，圖表外與瀏覽器原生捲軸操作 document。
- 從任一可見圖表操作時，同步同一 panel 的主圖、技術副圖與所有籌碼 pane，且不影響其他 panel。
- 保留方式 B 的單一瀏覽器垂直捲軸、觸控垂直捲頁、水平拖曳與 pinch 縮放。
- 讓事件 listener 可隨 panel／pane 建立、移除與模式切換完整清理。
- 在主圖逐日浮動框顯示完整資料日期，並讓技術副圖採用不遮圖的標題列逐日讀值。

**Non-Goals:**

- 不增加新的工具列按鈕、永久說明列或另一種副圖模式。
- 不變更 K 線、技術指標、籌碼資料、TDCC 回補或 D1 schema。
- 不讓不同 panel 共用 visible range。
- 不以 WheelEvent 數值猜測使用者使用滑鼠、觸控板或高解析度滾輪。
- 不恢復 `.chart-panel`、`.subchart-slot`、`.chip-pane-region` 或 `.chip-pane-stack` 的獨立垂直捲軸。
- 不移除 K 線主圖既有的浮動框，也不改變籌碼 pane 已採用的標題列逐日讀值契約。

## Decisions

### 1. 以可見命中區域決定滾輪用途

`.chart-surface`、`.indicator-chart` 與 `.chip-pane-chart` 的實際圖表區皆視為圖表操作區。未被互動控制項攔截的普通 wheel 交給 Lightweight Charts，執行水平時間尺度縮放；滑鼠左鍵拖曳維持原本的時間範圍平移。

圖表標題列、panel 工具列、下拉選單、按鈕、頁面空白與瀏覽器原生捲軸不掛圖表 wheel 攔截器，交由瀏覽器自然捲動 document。這條界線與畫面上可見區域一致，不建立隱形的 Y 軸熱區。

替代方案包括「方式 B 全部 wheel 只捲頁」、「只有主圖可縮放」、「按住 modifier 才能縮放」及「依 deltaMode／deltaY 猜輸入裝置」。前兩者破壞既有操作一致性，modifier-only 增加記憶負擔，裝置猜測則無法可靠區分觸控板與高解析度滑鼠，因此不採用。

### 2. 拆分滑鼠與觸控互動政策

不再以 `pageScrollEnabled` 同時開關所有互動。圖表設定應拆成可明確測試的政策：

- 桌面 mouse wheel：方式 A、B 均啟用圖表時間縮放。
- `pressedMouseMove`：方式 A、B 均啟用時間範圍平移。
- `horzTouchDrag`：方式 A、B 均啟用。
- `vertTouchDrag`：方式 B 關閉，讓瀏覽器處理垂直滑動；方式 A 維持現況。
- `pinch`：方式 A、B 均啟用圖表縮放。

主圖與技術副圖必須使用相同 helper；籌碼 pane manager 應接收同一種 interaction policy，而不是再以語意模糊的 `setPageScrollEnabled()` 複製判斷。若共用 helper 以獨立靜態資源提供，必須先於 `chip-panes.js` 與 `app.js` 載入，且加入對應 cache-busting 版本。

### 3. 保留既有同 panel visible range 同步鏈

任一圖表的 wheel 或左鍵拖曳改變 visible logical range 後，沿用既有 callback 將 range 寫入同 panel 的其他可見圖表。同步寫入期間必須使用既有或等效的 re-entrancy guard，避免主圖、技術副圖與多個籌碼 pane 互相觸發無限回圈。

一次來源操作只允許該 panel 更新；其他 panel、分頁偏好、籌碼選取與資料請求狀態不得改變。若縮放接近左界，既有向左補載 K 線仍可正常啟動。

### 4. `Option/Alt + wheel` 提供強制捲頁備援

方式 B 在圖表操作區偵測到 `altKey` wheel 時，必須在圖表 library 消費事件前停止圖表縮放，並保留或等效執行瀏覽器 document 垂直捲動。此功能只是游標不方便移出圖表時的備援，不增加常駐 UI，也不得攔截 `Ctrl/Cmd + wheel`，避免干擾瀏覽器或作業系統縮放行為。

事件 listener 必須集中註冊並回傳 cleanup；pane 被移除、panel 重建或離開方式 B 時不得殘留 capture listener。若瀏覽器無法在停止圖表 listener 後自然執行預設捲動，才以正規化 `deltaMode` 後的 `window.scrollBy()` 作 fallback。

### 5. 頁面捲動與共用十字線繼續以絕對座標重算

方式 B 仍由 `html/body` 捲動，既有 window scroll hook、ResizeObserver 與共用垂直線量測繼續作用。wheel 縮放或 document 捲動完成後，主圖及所有可見副圖在相同日期的絕對 X 座標差仍須小於或等於 1 CSS px；標題列逐日讀值與 crosshair 不得因事件分流失效。

### 6. 主圖保留浮動框，技術副圖改用標題列逐日讀值

主圖 `.main-readout` 保留既有跟隨 crosshair 左右定位的浮動框，但在第一個可見欄位加入完整 `YYYY-MM-DD` 日資料日期；日期必須直接取自目前命中的 candle time，不得以瀏覽器目前日期或行情更新時間代替。

技術副圖的 `.sub-readout` 不再使用 `.cursor-tooltip` 與 crosshair 左右定位。`.indicator-wrap` 應新增與 `.chip-pane-header` 相同層級的緊湊 header，內容依序顯示標題、完整日期，以及目前勾選的 RSI、KD-K、KD-D、MACD、ATR 數值。header 與圖表共同維持既有技術副圖總高度；方式 B 不得因此超過規格允許的 96–120 CSS px，方式 A 也不得增加另一列副圖。

套用 payload 或變更技術指標勾選時，技術副圖 header 顯示最新 candle 日期與最新可用值；crosshair 指向某日時原位改為該日數值；游標離開主圖、技術副圖或籌碼 pane 時恢復最新值。技術副圖不得再建立浮動背景框、跟隨 X 座標或遮擋圖形。日期格式與籌碼 pane 使用的 `sessionDate` 一致採 `YYYY-MM-DD`，以避免兩位數年份或行情時間造成誤讀。

### 7. 籌碼 pane 以右鍵功能表取代常駐移除控制

籌碼 pane 正常取得資料時不顯示「可用」狀態，讓標題列空間優先提供日期與讀值；「部分資料」、「歷史已更新」、「等待背景回補」、「無資料」等具有判斷價值的狀態仍保留。標題列不得再建立常駐「移除」按鈕。

使用者在 `.chip-pane-chart` 圖表區按滑鼠右鍵時，顯示不超出 viewport 的自訂功能表並提供「移除副圖」。功能表支援 `ContextMenu` 鍵與 `Shift+F10`，點擊外部、按 `Escape`、捲動、resize 或視窗失焦時關閉；pane 銷毀時必須移除 menu DOM 與所有 document／window listener。方式 B 移除該 pane 並讓其後 pane 補位；方式 A 移除籌碼 pane 後恢復技術副圖槽位。

持股比例、持股變化、週變化與相關座標刻度一律使用 `%`，不得再顯示「百分比」、「百分點」或「個百分點」等較長文案；正負號及台股紅漲綠跌顏色規則維持不變。

## Risks / Trade-offs

- [使用者在圖表內滾輪時無法直接捲頁] → 圖表標題列、工具列、控制區、頁面空白及瀏覽器原生捲軸皆可直接捲頁，另提供 `Option/Alt + wheel` 備援。
- [觸控板與滑鼠都產生 WheelEvent] → 不做不可靠的裝置猜測；以游標所在區域及明確 modifier 決定行為，保持可預測。
- [多個 chart 同步造成 range 回授或抖動] → 所有 programmatic range 寫入使用 re-entrancy guard，測試一次 wheel 只產生有限次同步。
- [capture wheel listener 阻斷控制項或瀏覽器縮放] → 只綁定圖表操作區，排除按鈕與 select，且只把 `altKey` 定義為強制捲頁。
- [動態 pane 移除後殘留 listener] → controller `destroy()` 與 panel reset 必須解除 wheel routing listener，並加入重複切換模式的生命週期測試。
- [文件捲動時十字線位置短暫偏移] → 沿用 requestAnimationFrame 排程，在 scroll、wheel、resize 及 layout change 後重新量測。
- [技術副圖新增 header 壓縮繪圖區] → header 採單列、overflow 安全的緊湊高度，圖表使用剩餘高度，總高仍遵守方式 A／B 現有契約。
- [最新值與游標值狀態混淆] → 共用同一個日期解析與讀值更新函式，crosshair clear 時明確恢復 latest candle。

## Migration Plan

1. 先以測試固定方式 A 現有操作與方式 B 新的事件矩陣。
2. 拆分互動政策並套用到主圖、技術副圖與籌碼 pane。
3. 加入方式 B 的圖表區 wheel routing、`Option/Alt` 強制捲頁與 listener cleanup。
4. 調整主圖與技術副圖逐日讀值結構、日期解析、latest／hover 狀態與緊湊 header 樣式。
5. 在本機以 1／2／3 圖、多個籌碼 pane、滑鼠 wheel、左鍵拖曳、document scroll 及逐日讀值進行瀏覽器驗收。
6. 通過 syntax、測試與 OpenSpec strict validation 後部署；正式站驗證圖表縮放、頁面捲動、日期讀值、同步與 1px 對齊。
7. 驗證籌碼 pane 正常狀態不顯示「可用」、右鍵功能表可移除副圖、百分點數值使用 `%`，並確認 listener cleanup 後發布正式站。

回滾時可恢復原本方式 B 關閉 mouse wheel 的 interaction options；此變更沒有資料 migration 或後端相容性風險。

## Open Questions

無。已確定以「圖表內操作圖表、圖表外操作頁面」作為主要心智模型，`Option/Alt + wheel` 僅作備援。
