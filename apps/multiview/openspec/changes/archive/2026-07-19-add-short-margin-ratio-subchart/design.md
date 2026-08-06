## Context

目前 `public/static/chip-panes.js` 已將融資與融券正規化為同一個 `margin-short` dataset，單一日 row 同時包含 `marginTodayBalanceLots` 與 `shortTodayBalanceLots`。兩個既有 pane 共用 request cache、共用時間 anchor、右側價格軸、inline readout、右鍵 series 選擇與安全回補 API；Worker、D1 與上游不需要新增券資比欄位。

來源專案與目前 Sites 專案都沒有獨立保存券資比。這次功能屬於可由既有同日官方餘額證明的前端衍生視圖，不應增加另一份資料來源、持久化欄位或背景排程。

## Goals / Non-Goals

**Goals:**

- 新增可在方式 A／B 選取的獨立券資比 pane，且不改變既有預設 pane 組合。
- 使用明確且可測試的同日公式，正確保留合法 0、拒絕零分母與缺漏值。
- 以百分比線呈現券資比，並提供可選的日變化柱與完整標題列讀值。
- 完整沿用既有 `margin-short` cache、availability、回補、crosshair、range、數值軸、名稱色票與 lifecycle。

**Non-Goals:**

- 不新增 Worker API 欄位、D1 schema、資料來源或上游請求。
- 不把融券使用率、融資使用率或市場總額誤當成券資比。
- 不替缺值補 0、不跨日期配對、不平滑、不裁切極端但合法的比值。
- 不將券資比加入首次方式 B 預設清單，也不變更既有融資與融券 pane。

## Decisions

### 1. 以純函式計算同日券資比

新增可單獨測試的 `shortMarginRatioPercent(marginShort)`。只有 `marginTodayBalanceLots` 為有限且大於 0、`shortTodayBalanceLots` 為有限且大於等於 0 時，才回傳 `short / margin × 100`；其餘回傳 `null`。計算保留完整浮點精度，只有顯示時格式化為兩位小數。

替代方案是在 Worker ingest 時保存衍生欄位；這會擴大資料契約、舊 D1 相容與交叉驗證範圍，但沒有帶來額外真實資料，因此不採用。

### 2. 新增非預設 pane 與兩個 series

在 `CHIP_PANE_REGISTRY` 的融券之後加入 `short-margin-ratio`，label 為「券資比」、dataset 為 `margin-short`、kind 為 `short-margin-ratio`。`DEFAULT_MODE_B_PANES` 不加入此 id，現有偏好陣列仍可直接讀取，不需為新增可選項清除或重設使用者設定。

`PANE_SERIES_OPTIONS` 提供「券資比」百分比線與「日變化」柱，預設只選券資比。券資比採黃色 `#facc15`，日變化項目採紫紅 `#e879f9`；header 名稱直接透過既有 `seriesId` 共用相同色票。

替代方案是把券資比疊在融資或融券 pane；兩者單位、尺度及使用目的不同，會增加辨識負擔且無法獨立選取，因此不採用。

### 3. 一次建立衍生 rows，線與日變化使用不同尺度

render 時依已排序的 `payload.rows` 建立 `{ sessionDate, ratio, change }`。`ratio` 使用右側可見百分比尺度；只有前後兩筆合法 ratio 才計算 `change`。日變化被選取時使用正負 histogram 與獨立隱藏尺度，避免百分比線被小幅變化壓縮。兩個 series 都使用 candle time map，沒有合法比值的交易日不建立資料點。

替代方案是用前一個 calendar day；休市日與缺資料日會造成不穩定比較，因此採前一個具有合法券資比的交易日。

### 4. 標題列顯示比值、分子、分母與來源

readout 依共用游標日期顯示「券資比」、「日變化」、「融券餘額」、「融資餘額」與「來源」。合法比值為 0 時顯示 0.00%；比值不合法時顯示無資料，但仍可顯示同日存在的原始餘額，方便辨識零分母或單欄缺漏。第一筆合法比值的日變化顯示「首筆／無前日比較」。游標離開後恢復最新具有 `margin-short` row 的日期，不跨日期拼接欄位。

### 5. 完整沿用 `margin-short` 狀態與回補路徑

pane 的 dataset 固定為 `margin-short`，因此自動繼承現有 eligibility、availability、rate-limit、retry-after、request cache 與 `POST /api/taiwan-stock-chip/backfill`。融資、融券、券資比同時顯示時仍只有一個 `symbol + dataset + range` request；券資比不建立專用 fetch、cache 或回補工作。

## Risks / Trade-offs

- [融資餘額很小時比值可能劇烈變動] → 保留真實比值且不裁切；百分比線自動縮放，header 同列顯示原始分子與分母供判讀。
- [來源某日只提供其中一個餘額] → 該日 ratio 保留 gap，raw 欄位顯示實際值或無資料，不以不同日期補足。
- [增加 pane 使選單較長] → 固定放在融券之後，且不加入預設 B 清單，只有使用者主動選取才增加頁面高度。
- [日變化與券資比量級不同] → 日變化使用獨立隱藏 scale，不影響右側券資比百分比刻度。
- [舊偏好不知道新 id] → registry 新增不會使既有 id 失效；不提升 defaults version、不重設任何使用者勾選。

## Migration Plan

1. 先以純函式與 contract tests 固定公式、合法零、零分母、缺值與 registry／series 預設。
2. 實作 pane、readout、series 與靜態資產版本，本機驗證方式 A／B、右鍵項目、右側百分比軸及 request 去重。
3. 發布 owner-only Sites 版本，在正式站以同日有融資融券資料的台股比對手算結果、標題列、線圖、日變化柱及共用十字線。
4. 若有回歸，回滾上一 Sites version；此功能沒有 schema 或持久化資料 migration。

## Open Questions

- 無。券資比線預設啟用、日變化柱預設關閉；若未來要改成預設加入方式 B，應另行評估長頁面高度與既有使用者偏好。
