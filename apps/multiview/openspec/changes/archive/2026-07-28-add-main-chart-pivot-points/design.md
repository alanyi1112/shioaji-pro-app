## Context

目前 `/api/candles` 與 `/api/stream` 由 Worker 取得所選週期行情、計算指標並以相同 cache contract 回傳，前端再依主圖 checkbox 建立或清除 Lightweight Charts series。現有日、週、月 K 已依來源交易所時區聚合，但日內 payload 不保證含有前一個完整交易日，尤其 `1m` range 可能只有當日資料；若直接以前一根日內 K 棒計算，會產生不符合本次產品決策的 Pivot。

Pivot Point 預設不勾選，因此設計必須同時滿足：未啟用時不得增加高週期上游請求；啟用時日內、日、週、月都使用同商品、同市場、完整參考週期；candles、stream、cache、series 與 readout 不得各自採用不同口徑。

## Goals / Non-Goals

**Goals:**

- 提供固定 Traditional 公式的 P、R1～R3、S1～S3，並使用使用者已確認的週期映射。
- 讓 Pivot 預設關閉且 lazy 載入，避免未使用的 1／2／3／4／6／8 圖額外要求日線參考資料。
- 讓 Worker 成為 Pivot 計算與參考週期選擇的單一真相來源，並保持 candles、stream 與 cache identity 一致。
- 讓七條水平階梯線、價格標籤、readout、縮放平移、panel 重建與 PNG 匯出使用同一份 payload。
- 沿用現有 Yahoo Chart、Hyperliquid、sample、candle history、交易所時區與錯誤隔離能力，不新增秘密或外部依賴。

**Non-Goals:**

- 不支援 Fibonacci、Woodie、Classic、DM、Camarilla 或自訂公式。
- 不提供 Pivot 週期、回溯組數、線色、線寬或警報參數設定。
- 不產生買賣訊號、停利停損建議、通知或自動交易。
- 不新增 D1 schema，也不將 Pivot 選取或數值保存為伺服器端使用者資料。

## Decisions

### 1. 固定採 Traditional 七線公式

以參考週期的 `H`、`L`、`C` 計算：

- `P = (H + L + C) / 3`
- `R1 = 2P - L`，`S1 = 2P - H`
- `R2 = P + (H - L)`，`S2 = P - (H - L)`
- `R3 = R1 + (H - L)`，`S3 = S1 - (H - L)`

Worker 以純函式集中計算並沿用衍生價格精度處理；參考 OHLC 缺值、非有限、`H < L` 或沒有前期資料時回傳缺值，不補零或推測。第一版固定公式可避免 UI 參數、cache 組合與跨軟體公式差異同時擴張；未來若要增加其他類型，另以新 change 擴充。

### 2. 依圖表週期選擇完整參考週期

- `1m`、`3m`、`5m`、`15m`、`30m`、`1h`、`4h`：使用前一個實際完成交易日。
- `1d`：每根日 K 使用前一個實際完成交易日。
- `1wk`：每根週 K 使用前一個實際完成交易週。
- `1mo`：每根月 K 使用前一個實際完成交易月。

「前一個」以同商品資料中的前一個實際 period 判定，不以日曆減一天／一週／一月，因此週末、休市與缺交易日不會製造假資料。日內 Pivot 必須使用相同 provider 的 daily-based candle，並依 `sourceTimeZone` 對應目前日內 candle 的 session date；不得用前一根日內 bar 或 extended-hours 聚合值替代。週、月沿用現有交易所時區聚合語意。

### 3. 以 `pivot=traditional` 建立 lazy API 與 cache contract

前端只有在 panel 勾選 Pivot Point 時，才在 `/api/candles` 與 `/api/stream` 加入 allowlist query `pivot=traditional`。Worker 將 Pivot mode 納入 candle cache key／contract version；未提供或不合法的值一律正規化為停用，不觸發額外參考資料取得。

非日內週期可利用本次 acquisition 的完整 normalized rows 計算；日內週期在 Pivot 啟用時，透過既有 candle history／provider adapter 取得 bounded 日線參考資料，並使用 single-flight 與 cache，避免多 panel 重複要求。上游參考資料失敗時只讓 `pivot_points` 顯示 unavailable／缺值，既有 K 線與其他指標仍可回應；錯誤不得洩漏 upstream body、URL credential 或內部例外。

替代方案是永遠在所有 candle payload 計算 Pivot，但會讓預設未勾選的多圖承擔額外資料與網路成本；另一方案是在前端由日內 bars 聚合，會受 range、extended hours 與 session 邊界影響，因此不採用。

### 4. 回傳與圖表 candle time 對齊的七組序列

`indicators.pivot_points` 在啟用時包含 `type`、`referenceInterval`、`status`，以及 `p`、`r1`、`r2`、`r3`、`s1`、`s2`、`s3` 七組 `{time, value}` 序列。每個點的 `time` 與所選圖表 candle 對齊；同一有效週期內重複相同水準，進入下一週期時才切換新值。前端不重新計算公式，只負責繪圖、格式化與互動。

所有 nested series 必須經既有 display time set 裁切，history prepend 後重新計算完整可見時間範圍，避免第一個可視 period 誤用畫面內第一根 candle 當參考。stream 的初始 snapshot 與後續更新使用相同 Pivot mode；參考週期沒有改變時不得因每筆即時報價漂移 Pivot 水準。

### 5. 使用七條 step line series 與條件式 readout

前端建立 P、R1～R3、S1～S3 七條主價格尺度 line series，採 step line 或等效的不斜接水平轉折。P 使用中性色實線；R 系列與 S 系列分別使用可辨識色系及不同深淺／線型，且每條線顯示 P／R／S 文字與格式化價格，不能只靠顏色辨識。線寬維持細線，crosshair marker 沿用全站小圓點契約。

主 readout 只在 Pivot 已勾選時顯示一個 Pivot row，依目前游標 candle 或最新 candle 顯示七個格式化值；價格格式沿用商品 tick-size formatter。series 使用主圖價格尺度並參與正常 autoscale、縮放、平移與完整 panel 匯出，不建立額外 DOM 截圖替代物。

替代方案是為每個 period 建立七條 price line，但歷史期數會造成 series／物件數快速增加；固定七條 step series 可讓 8 圖生命週期與 cleanup 較可控。

### 6. 沿用 panel 最新請求勝出與 cleanup

勾選 Pivot 會觸發該 panel 以新 query identity 重新載入並重建 stream；取消勾選則清除七條 series、標籤與 readout，重新回到無 Pivot 的 payload identity。商品、週期、圖表數量、分頁或單圖模式改變時沿用 AbortController／load token latest-wins，不得讓舊商品 Pivot 覆蓋新 panel。panel destroy 時必須移除全部 Pivot series 與相關 listener。

## Risks / Trade-offs

- [Risk] 8 圖同時啟用日內 Pivot 會增加日線參考資料請求 → 只在勾選時取得，並使用既有 cache、single-flight、bounded history 與相同商品請求共用。
- [Risk] 日內與 daily feed 的 OHLC／extended-hours 語意不同 → 明確使用 provider daily-based candle 與 `sourceTimeZone`，不由日內 bars 靜默重建。
- [Risk] 當期未收盤 candle 被誤當成下一期參考 → 每個有效 period 只讀其前一個已完成 reference row，缺少確認時保留 unavailable／缺值。
- [Risk] 七條線與既有 MA、Bollinger、河流圖同時顯示造成擁擠 → 預設關閉、採細 step line、明確 P／R／S 文字與條件式 readout，正式驗收涵蓋單圖與 8 圖。
- [Risk] 新 flag 未納入 cache 或 stream identity，導致勾選後仍收到舊 payload → bump candle cache contract，測試不同 Pivot mode 不共用 cache，並核對 stream query／snapshot。
- [Trade-off] 第一版不提供 TradingView Auto 或多種公式，可設定性較低，但能先建立可核對且跨市場一致的基線。

## Migration Plan

1. 先新增純計算、參考週期映射與 Worker contract 測試，再接 API／cache／stream。
2. 新增前端 checkbox、series、readout、cleanup 與 viewport-safe contract，更新靜態資產 cache key。
3. 執行 build、完整自動化測試、OpenSpec strict validation 與 `git diff --check`。
4. 本機及 owner-only 正式站驗證預設不勾選、日內／日／週／月水準、多圖選單、readout、切換 cleanup、PNG 與 console。
5. 若需 rollback，可移除 checkbox 與 Pivot query；因無 D1 migration 或持久化 schema，舊 payload 與使用者資料不需轉換。

## Open Questions

無；公式、週期映射、預設關閉與第一版不提供參數設定均已由使用者確認。
