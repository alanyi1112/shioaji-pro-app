## Context

主 K 線、技術副圖及每個籌碼 pane 目前各自建立 Lightweight Charts instance，雖然以相同 `time` 同步 crosshair，實際可繪圖區仍會受左右價格軸寬度、label 與 pane 內容影響。因此，同一日期換算出的螢幕 X 座標可能不同，各 chart 自行畫出的垂直線看起來會左右不齊。

籌碼 pane 目前另有標題與詳細讀值列，永久顯示最新值、實際資料日期及說明。方式 B 同時顯示多個 pane 時，這些固定列會反覆占用高度；而部分非大戶／散戶 pane 尚未建立完整的游標日期 readout map，導致 hover 時仍可能顯示最新值。TDCC 是週頻資料，只有實際 `dataDate` 才代表發布值，不能把最近一週數值誤當成每天都有資料。

## Goals / Non-Goals

**Goals:**

- 同一 panel 只呈現一條由主圖頂端延伸到最後一個可見副圖底端的共用垂直線。
- 統一各 chart 的可繪圖區左右邊界，讓相同日期的螢幕 X 座標在 1 CSS px 內一致。
- 讓主圖、技術副圖及每個籌碼 pane 都依游標日期提供浮動 tooltip，並正確顯示缺值、部分資料與 TDCC 實際發布日。
- 移除籌碼 pane 永久最新讀值列，縮短方式 B 的 pane 高度，使瀏覽器 viewport 可看到更多副圖。
- 保留 A／B 選取狀態、瀏覽器整頁捲動、visible range、向左載入與 panel lifecycle。

**Non-Goals:**

- 不改變籌碼 API response schema、D1 資料表、FinMind／官方來源或快取策略。
- 不把所有圖表全面重構成 Lightweight Charts v5 的單一 multi-pane chart。
- 不對 TDCC 週資料做 daily forward-fill、插值或估算。
- 不改變 4／6／8 圖固定方式 A 的產品政策。

## Decisions

### 1. 保留獨立 chart instance，增加 panel 級共用 crosshair overlay

每個 panel 新增一個 `pointer-events: none` 的垂直 overlay line，由 canonical cursor state 控制；主圖、技術副圖與籌碼 chart 原生 crosshair 的垂直線關閉，但可保留水平線與價格 label。共用線的上界為主圖 plot top，下界為最後一個實際顯示副圖的 bottom，並隨 document 捲動、pane 增減、resize、A／B 與 focus 切換重新量測。

選擇此方案是因為現有 lifecycle、overlay、volume、技術指標與籌碼 manager 都建立在獨立 chart instance 上；全面改成單一 multi-pane chart 會擴大回歸範圍。僅繼續同步各 chart 的原生垂直線則無法保證視覺上是一條不中斷且完全對齊的線。

### 2. 將可繪圖區幾何納入同步 contract

panel layout manager 會量測主圖的安全價格軸 gutter，將一致的右側 plot boundary 套用到技術副圖及籌碼 pane；大戶／散戶 pane 不再為持股比例另開會改變左側 plot 起點的可見左 price scale，其數值改由右軸與 tooltip 辨識。每次 pane 建立、資料造成 price label 寬度改變、ResizeObserver 通知或 layout mode 改變後，都重新同步 gutter。

測試以 `chartElement.getBoundingClientRect().left + timeScale.timeToCoordinate(sessionDate)` 計算相同日期的絕對螢幕 X 座標，對主圖、技術副圖及每個可見籌碼 pane 取最大值與最小值；差值必須小於或等於 1 CSS px。只畫 overlay 而不統一 plot geometry 會讓 tooltip/data point 仍錯位，因此不採用。

### 3. 建立單一 canonical cursor state 與逐 pane readout resolver

任一作用中 chart 的 `subscribeCrosshairMove` 都只更新 panel 級 `{ sessionDate, source, screenX }`；同步程序具 re-entry guard，避免 `setCrosshairPosition` 形成循環。每個 chart controller 註冊 `resolveReadout(sessionDate)`，由資料列索引回傳該日期的原始值、組成欄位、狀態、來源與實際 `dataDate`。所有 dataset 都必須使用游標日期 resolver，不能退回標題中的最新值。

主圖、技術副圖與每個籌碼 pane 各自擁有一個不參與 layout flow 的 HTML tooltip。tooltip 以共用 X 座標定位；靠近右緣時翻到線左側，靠近左緣時翻到右側，並限制在該 chart/pane 可視範圍。游標離開 panel、日期超出 range、pane 隱藏或 panel 銷毀時立即隱藏。

採用 HTML tooltip 而非 series label，是為了同時容納日期、組成值、狀態與無資料語意，並能做邊界換側與可及性文字。

### 4. TDCC 僅以實際 dataDate 回報發布值

大戶／散戶 resolver 以 `dataDate` 精確查找。若 `sessionDate === dataDate`，tooltip 顯示持股比例、週增減、張數、人數、門檻與來源；若游標日期不是任何發布日，tooltip 顯示「當日無發布資料」，不得顯示 0、不得沿用前週值，也不得把參考資料標成該日資料。為協助判讀，可另列「最近一筆：YYYY-MM-DD」及其值，但必須與當日狀態分區並明確標示為參考。

### 5. 讀值移出永久 layout，方式 B 採緊湊 pane

籌碼 pane header 只保留名稱、簡短 availability／staleness 狀態、TDCC 級距選單及移除控制，不再永久顯示最新值、日期或組成明細；原 `.chip-pane-details` 讀值列移除或不占 layout。桌面方式 B 的籌碼 pane 目標總高為 88–104 CSS px，技術副圖目標為 96–120 CSS px；窄螢幕可因控制換行放寬，但 tooltip 仍不可撐高 pane。

方式 A 仍使用既有單一副圖槽位及其可讀高度，只共用新的 tooltip 與 crosshair 行為。方式 B 繼續由 document 提供唯一垂直捲動，不新增 panel 內捲軸。

### 6. 可及性與觸控退化

tooltip 使用 `role="status"` 或同等可讀容器，內容不只以顏色表示正負與缺值。滑鼠與支援 hover 的 pointer 顯示跟隨式 tooltip；觸控裝置沿用 chart crosshair／tap 行為固定日期，點到 panel 外才隱藏。鍵盤仍可操作副圖選單、級距與移除控制；本變更不要求用鍵盤逐點巡覽 canvas。

## Risks / Trade-offs

- [價格軸 label 在資料更新後變寬，短暫造成 X 軸錯位] → 在 price-scale width 同步後排程第二次 layout refresh，並以 ResizeObserver 與 1px debug assertion 驗證穩定狀態。
- [document 捲動時 overlay line 的 viewport 座標過期] → 以 panel-relative 座標保存 X，只在顯示期間監聽 scroll／resize 並透過 `requestAnimationFrame` 合併量測。
- [大量 pane 同時更新 tooltip 造成 pointer move 過重] → 先用日期索引 O(1) 查值，DOM 寫入合併至單一 animation frame，只更新可見且內容有變化的 tooltip。
- [緊湊高度使長狀態或級距控制擁擠] → header 使用單行截斷與原生 title／tooltip；窄螢幕允許控制換行及略高上限。
- [最近一筆 TDCC 參考值被誤讀為當日值] → tooltip 固定先顯示「當日無發布資料」，參考值必須附實際日期且不得畫到游標日期。

## Migration Plan

1. 先加入 geometry／readout contract 測試與 debug alignment report，再實作共用 gutter、overlay line 與 canonical cursor state。
2. 補齊所有 pane 的日期索引與 tooltip resolver，確認缺值及 TDCC 語意後再移除永久讀值列。
3. 套用方式 B 緊湊 CSS，回歸 A、4／6／8、focus、窄螢幕與 document page scroll。
4. 通過自動化與本機瀏覽器驗收後部署 Sites 新版本，以已登入正式站確認可見行為與 console。
5. 若正式站出現重大對齊或互動回歸，回滾至前一個 Sites version；資料與 D1 schema 沒有 migration，因此不需資料回復。

## Open Questions

- 無；本 proposal 預設 KD／ATR 等技術副圖也使用逐日浮動 tooltip，但方式 B 仍可保留不占額外列高的短 series legend。
