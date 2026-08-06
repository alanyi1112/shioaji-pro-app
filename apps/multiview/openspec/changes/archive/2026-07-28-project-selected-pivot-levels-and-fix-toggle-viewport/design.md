## Context

現行 Worker 會為每根顯示 K 棒產生當期 P、R1～R3、S1～S3，前端以七條 `LineSeries` 的 step line 畫完整歷史。這個模型適合回看各期 Pivot，但不符合使用者以最後一根或點選 K 棒規劃「下一交易期」價位的需求，而且七條歷史線會遮蔽 K 棒、均線與布林。

Pivot 採 lazy request，開啟與關閉分別使用 `pivot:traditional` 與 `pivot:off` 的前端／Worker cache identity。歷史 prepend 可使目前 panel 持有超過預設 160 根 candle；切換 Pivot 時若讀到較短 cache，現行 `applyPreservedVisibleLogicalRange` 只補正新增 candle 數，不處理資料窗縮短，因而可能把舊 logical range 套到較短資料集。主圖同時已有費波那契、價格範圍、固定範圍 VP、十字線、雙擊開單圖與自訂 DOM／SVG overlay，新增點選行為必須有明確優先權。

## Goals / Non-Goals

**Goals:**

- 以所選參考期的 OHLC 計算下一交易日／週／月 Traditional Pivot，預設使用最後一個已完成參考期。
- 只在參考 K 棒至右側價格軸前顯示七個投影水準，保留文字、線型、價格格式及可辨識層級。
- 支援點選歷史 K 棒固定參考期、回到最新、盤中暫估、stream 更新、多 panel 與完整 panel PNG。
- Pivot 切換不得縮短目前 candle window、漂移主副圖 viewport、清除其他指標或破壞本機註記。
- 維持 Worker 為公式、完整交易期、交易所時區與日內 daily-based 參考資料的單一真相來源。

**Non-Goals:**

- 不支援其他 Pivot 公式、自訂參數、警報、買賣訊號、停利停損或自動交易。
- 不把 Pivot 選取保存為伺服器端使用者資料，也不新增 D1 schema。
- 不讓滑鼠 hover 持續改變投影或價格尺度；只有明確點選、回到最新或參考期資料更新才可改變投影。
- 不重做費波那契、價格範圍或固定範圍 VP 的既有資料模型。

## Decisions

### 1. 將 payload 改為以參考期為主的下一期投影紀錄

Worker 沿用 `computeTraditionalPivot`，但投影紀錄的 `H`、`L`、`C` 來自所選參考期本身，結果語意為「適用下一個實際交易期」。`pivot_points` 保留 `type`、`referenceInterval` 與整體 `status`，並提供依 `referenceTime`／`referencePeriodKey` 索引的 projection records；每筆包含七個水準、`referenceStatus`（`completed` 或 `provisional`）、`appliesTo`，以及歷史資料已知時的下一個實際 `applicablePeriodKey`。Pivot cache contract version 必須更新，避免舊的當期序列與新投影語意混用。

日、週、月圖分別以該根日、週、月 K 為參考。日內圖不能以單根分鐘 K 計算，必須將點選 candle 對應到來源交易所時區的交易日，並使用同 provider 的 daily-based OHLC；歷史完整日標為 `completed`，當日尚未完成但具有合法累計 OHLC 時可標為 `provisional`。下一個實際日期未知時顯示「下一交易日／週／月」，不得以固定秒數製造週末或休市日期。

替代方案是前端直接以 candle OHLC 計算，雖然簡單，但日內 session、extended hours、交易所時區與完成狀態容易分歧，因此不採用。另一方案是保留當期序列並在前端位移一格，無法產生尚未存在的下一期，也會讓語意繼續混淆，因此不採用。

### 2. 使用專用 overlay 畫右向投影，不建立未來 time point

前端不再把七組完整歷史資料建立為可見 step `LineSeries`。Pivot overlay 依 `timeToCoordinate(referenceTime)` 與 `priceToCoordinate(level)`，從參考 K 棒中心向右畫到 `surface.clientWidth - axisSafeWidth - safeGap`，右側以 P／R1～R3／S1～S3 加格式化價格標籤。P 採中性色實線；R1／S1較明顯，R2／S2虛線，R3／S3點線且較淡。標籤過近時採垂直避碰與短導引線，但線本身仍落在真實價位。

overlay 不建立假未來 timestamp，避免擴張時間軸或觸發 history loader。為讓超出目前 K 棒價格範圍的已選水準仍可見，可沿用費波那契完成態的透明上下界 autoscale helper series；helper 只在預設／固定投影改變時更新，不接受 hover preview，也不得建立價格標籤或 crosshair marker。完整 panel 匯出必須包含 overlay 與參考期標示。

替代方案是七條 native price line，但它們會從圖表最左側延伸，無法表達參考 K 棒起點；用兩點 line series 則必須為最後一根 K 棒創造未來 time point，會再次污染時間軸，因此不採用。

### 3. 點選為固定動作，並明確定義與繪圖工具的優先權

Pivot 啟用時預設選取最後一個 `completed` projection；若沒有已完成紀錄但有合法 provisional 紀錄，才以暫估狀態顯示。一般主圖單擊會以 `nearestCandleForCoordinate` 找到 candle，再對應 projection 並固定。readout 顯示「參考 K／適用期／完成或暫估」與七個水準；hover 仍可驅動既有 OHLC、技術指標及跨 pane 十字線，但不改變固定 Pivot。提供可鍵盤操作的「回到最新」控制，讓使用者解除歷史固定並回到最新完成參考期。

點擊優先權依序為：進行中的費波那契／價格範圍、進行中的固定範圍 VP、既有 overlay 控制／選取，最後才是 Pivot 參考 K 棒。被高優先權工具消耗的事件不得同時變更 Pivot。panel 的雙擊開單圖維持既有行為；第一下可能產生的 Pivot 選取不得保存到其他 panel 或伺服器。

### 4. Pivot 切換只改變 Pivot 資源，不得替換較長 candle window

取消 Pivot 時先在本地移除 overlay、autoscale helper、標籤與 readout，並以目前 `lastPayload.candles` 繼續顯示；只需關閉 Pivot stream 並重連不含 Pivot mode 的 stream，不得套用較短的 `pivot:off` cache payload。啟用 Pivot 或因參考資料不足需要重抓時，request 必須帶入至少目前 candle 數的 `display_count`；前端 cache entry 必須記錄／檢查 display window，少於目前 candle 數者不得用來替換現有 panel 資料。

若回應仍因 provider 邊界而具有不同 time set，前端以切換前可視區第一／最後 candle time、右側是否貼近最新 K 與 bar spacing 還原 viewport；只有相同 time set 或純 prepend 才可使用 logical delta。主圖、技術副圖與籌碼副圖必須套用同一個結果。若固定參考期不在新 payload，回退到最新 completed projection 並更新 readout，不保留指向不存在 candle 的狀態。

替代方案是任何 checkbox 切換都完整 `load()`／`fitContent()`，雖可避開失效 logical range，卻會破壞使用者縮放與歷史位置，因此不採用。

### 5. Stream 只更新受影響的 projection，不反覆重建全部圖表

Pivot stream 沿用最新請求勝出與前景 request 暫停／恢復機制。收到同一參考期的 provisional 更新時，只更新該 projection、overlay、readout 與 autoscale helper；參考期完成或進入下一期時，才重新判定預設最新完成期。已由使用者固定的歷史 completed projection 不得因最新報價改變。

取消 Pivot 後的晚到 request／stream event 必須由 load token、目前 mode 與 panel identity 擋下。多 panel 各自保存選取的 reference key、projection map 與 cleanup，不共用可變 overlay 狀態。

## Risks / Trade-offs

- [下一個實際交易日期尚未知] → 使用「下一交易日／週／月」語意標籤；只有資料中已知的歷史下一期才顯示具體日期，絕不自行推算休市日。
- [七個價位非常接近造成標籤重疊] → 使用垂直避碰、短導引線、固定排序與 axis safe width；文字與線型仍須可辨識真實價位。
- [provisional OHLC 隨盤中報價更新] → 明確顯示「暫估」，只更新目前暫估投影，不把它冒充完成值或保存為歷史完成值。
- [投影 autoscale 壓縮 K 棒] → helper 只納入目前固定的最小／最大水準並保留合理 scale margin；hover 不得改動 autoscale。
- [舊 cache 與新 contract 混用] → 更新 cache contract/version，並在 payload 缺少 projection contract 時安全顯示 unavailable，不以前端猜算補值。
- [點選與繪圖工具衝突] → 依明確優先權消耗事件，加入費波那契、價格範圍及固定範圍 VP 回歸測試。

## Migration Plan

1. 先更新 Worker projection contract、cache version 與純函式／API／stream 測試，保留 Pivot 預設關閉。
2. 加入前端 projection state、overlay、readout、點選優先權與 viewport time-anchor 還原，再移除可見歷史 step series。
3. 以 160 根、320 根以上歷史、單圖與八圖完成本機測試；確認取消 Pivot 前後 candle time set、visible range、主副圖對齊與註記相同。
4. 通過 lint、完整測試、build、strict OpenSpec 與 `git diff --check` 後部署完整 HEAD，於正式 Sites 驗證日／週／月、暫估、點選、回到最新、匯出及 console。
5. 若正式站出現回歸，回滾至前一個 Sites version；因不含 D1 migration 或使用者伺服器資料，回滾不需資料轉換。

## Open Questions

- 無。下一個實際交易日期未知時一律使用相對語意標籤，已足以避免將市場行事曆擴張進本次範圍。
