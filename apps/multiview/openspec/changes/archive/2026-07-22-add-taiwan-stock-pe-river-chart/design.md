## Context

目前每個 chart panel 會由 `/api/candles` 一次載入 K 線與可由 K 線直接計算的技術指標，主圖 checkbox 變更後重用既有 payload 重新建立 series／overlay。本益比河流圖不同：它需要 TWSE／TPEx 的歷史估值與官方收盤資料、最多五年的持久化 coverage、首次載入回補，以及不阻塞一般 K 線的獨立失敗邊界。

TWSE 與 TPEx 對本益比採「收盤價 ÷ 每股參考稅後純益」口徑，近滿四季純益與發行參考股數來自當時已申報的格式化財報。河流圖必須保留這個 point-in-time 語意，不能用後來公布的財報回填較早日期，也不能把公司財報直接揭露的基本 EPS、預估 EPS 或同業本益比混入計算。

專案已具備 D1-first cache、coverage／retry state、`context.waitUntil`、私有 GitHub Actions workflow dispatch／ingest、跨 panel single-flight、主圖 DOM overlay 重繪與完整 panel PNG 匯出等可沿用模式；新功能應重用這些邊界，但建立獨立資料表與 API，避免耦合台股籌碼資料。

## Goals / Non-Goals

**Goals:**

- 為台灣上市、上櫃普通股日 K 提供預設關閉、按需載入的本益比河流圖。
- 只使用經確認可自動化的 TWSE／TPEx 官方資料，保留實際來源、資料日期、財報年／季與 coverage。
- 以同日官方收盤價及官方本益比反推 point-in-time 參考 EPS，並以最近五年有效本益比分布產生可重現的五條百分位界線。
- 讓首次回補、partial coverage、retry、來源阻擋與不足 252 筆有效交易日都有清楚可見且不破壞 K 線的狀態。
- 在所有圖數、單圖分頁、縮放／平移／resize、crosshair 與 PNG 匯出中維持正確可見結果，並可完整清理資源。

**Non-Goals:**

- 不提供同業平均、產業本益比、同業中位數或任何同業估值線。
- 不使用分析師預估 EPS、forward P/E 或公司財測。
- 不支援 ETF、ETN、TDR、指數、加密貨幣、非普通股與非日 K。
- 不把本益比河流資料塞入每次 `/api/candles` 回應，也不把來源秘密暴露到前端。
- 不把百分位區帶描述成合理價、目標價或買賣訊號。

## Decisions

### 1. 以官方每日本益比口徑反推參考 EPS

每個有效交易日必須先確認官方收盤價與官方本益比屬於相同市場、股票代號及 `sessionDate`，再計算：

```text
referenceEps = officialClose / officialPeRatio
```

官方本益比為空、零、負數、非有限值，或官方收盤價無法同日配對時，該日不得產生參考 EPS。保留每日反推值，不用整季平均改寫歷史，以避免股本變動時抹除真實 point-in-time 差異；只做有限小數正規化，測試須容許官方本益比顯示精度造成的微小誤差。

替代方案是直接加總四季財報 EPS，但不同期間可能採不同加權平均股數，且不一定重現交易所歷史本益比，因此不採用。使用第三方歷史 P/E 雖較容易，卻無法滿足官方來源與口徑可追溯要求，也不採用。

### 2. 最近五年倍率在單次 response 中固定

Worker 取截至最新官方有效交易日往前五年的正本益比樣本，排序後以 `rank = (n - 1) × p` 及相鄰值線性插值計算 `P10`、`P30`、`P50`、`P70`、`P90`。同一 response 的五個倍率固定；每個歷史日期只讓參考 EPS 改變，避免 visible range 或縮放改變倍率。

若上市未滿五年，至少 252 筆有效交易日即可使用全部可用樣本，但 API 與 UI 必須標明實際 coverage；少於 252 筆時回傳 `insufficient_history`，不得用固定倍數或較少樣本冒充五年河流圖。

替代方案是固定 `10／15／20／25／30` 倍，但不同產業與個股長期估值結構差異大；以 visible range 動態重算則會讓同一天的河流因縮放而改變，因此均不採用。

### 3. 獨立按需 API 與 D1 資料模型

新增 `GET /api/taiwan-stock-pe-river?symbol=<symbol>`，不修改 `/api/candles` 的成功與快取邊界。回應至少包含 `eligibility`、`coverage`、`multipliers`、`points`、`sources`、`warnings` 與 `backfill`；錯誤只使用 allowlist reason code。

D1 分離保存：

- 逐日估值 row：exchange、symbol、session date、official close、official P/E、fiscal year／quarter、source 與 fetched timestamp。
- fetch state：requested／actual coverage、source date、status、reason、last success／attempt 與 retry-after。
- durable backfill job／month checkpoint：目標月份、狀態、attempt、lease、next retry 與安全錯誤碼。

唯一鍵以 exchange、canonical symbol 與 session date（job checkpoint 另含月份）組成；upsert 必須冪等。API cache hit 不重抓完整月份，partial coverage 只排缺月。

### 4. 五年回補不得阻塞 chart panel

首次勾選先回傳目前 D1 coverage；資料不足時建立或重用單一 durable job，透過限速 runner 逐月取得官方資料、驗證、寫入 D1，再由前端有界輪詢。可先顯示 partial coverage 與進度，但只有符合 252 筆門檻時才繪圖。

短工作可用 `context.waitUntil`，完整五年回補則沿用私有 workflow dispatch／ingest 或等效 durable runner；不得在單一互動 request 中無界並行數十個月份。相同 symbol 的多 panel 或重複點擊必須 single-flight／job dedupe，429／5xx 使用 bounded backoff，非 retryable schema／資格錯誤隔離為 blocked。

在正式串接歷史來源前，必須留下當次實測 schema、歷史範圍、更新頻率、自動化與再利用規範證據；若無法確認，該來源不得進 production，不能改以未授權 scraping 繞過。

### 5. 商品資格由 canonical metadata 與官方結果共同判定

`.TW`／`.TWO` 後綴只能作為市場候選，不足以證明是普通股。Worker 必須使用商品目錄 security type／group 與官方資料存在性判斷 eligibility，明確排除 ETF、ETN、TDR、指數、特別股及其他非普通股。前端保留 checkbox 的使用者意圖；切到不適用商品或非日 K 時暫停 overlay 並顯示原因，切回有效日 K 可重新載入。

### 6. 使用獨立 SVG overlay 繪製四個河流帶

在 K 線 canvas 後方加入不攔截 pointer event 的 SVG layer，利用主圖 `timeToCoordinate` 與 candle series `priceToCoordinate` 把相鄰 percentile 線組成四個 polygon band，並畫出五條邊界。P10 以下與 P90 以上不填滿整個 plot；由低到高使用低透明度綠、青黃、橘、紅色，K 線與 OHLC readout 必須保持可讀。

替代方案是疊加 Area Series，但它只可靠填到基準線／底部，難以在兩條同時變動的曲線間建立四個無溢出的色帶。SVG 也能沿用既有 overlay 的 rAF 重繪、DOM clone 與 `html2canvas` PNG 匯出流程。

### 7. readout 區分官方歷史與盤中估算

歷史 completed session 顯示官方 P/E、參考 EPS、財報年／季、五個倍率、股價所在區帶、來源與資料日期。當前尚未收盤的日 K 只可沿用最近一筆有效參考 EPS 計算河流價格與 `currentPrice / referenceEps`，並標示「盤中估算」；不得寫回官方逐日估值 table，也不得把估算值納入五年 percentile sample。

同業／產業欄位不得出現在 API、readout 或 overlay。文案必須稱為歷史估值位置或區帶，不得稱為目標價或投資建議。

### 8. 前端使用 latest-wins 與完整 cleanup

勾選後才發出估值 request。每個 panel 以 symbol／interval／load token 驗證 response，快速取消、換商品、換週期或銷毀 panel 時 abort fetch／poll、清空 SVG／readout／status，並取消 rAF／listener；晚到 response 不得畫到新商品。縮放、平移、resize、圖數切換與單圖分頁重用同一 overlay scheduler，不能觸發上游重抓。

## Risks / Trade-offs

- [官方歷史查詢可瀏覽但自動化限制未明確] → 把授權、頻率、歷史範圍與 schema 實測列為實作前 gate；未確認前不發布 production backfill。
- [五年逐月回補請求數較多] → 使用 D1 永久 cache、缺月 checkpoint、限速 durable runner、single-flight 與 bounded retry；panel request 只讀狀態。
- [TPEx 或官方端點在 Sites runtime 受阻] → 沿用已驗證的私有 GitHub Actions ingest 模式，並對 payload 日期、筆數、代號與有限數值做伺服器端驗證。
- [官方 P/E 顯示精度造成 reference EPS 微小抖動] → 保留 point-in-time 日值並正規化有限小數；不以整季平均製造 look-ahead，視覺線寬與 readout 精度避免放大無意義差異。
- [虧損或財報不完整造成長缺口] → 明確顯示 `non_positive_earnings`／`official_pe_unavailable`，不 forward-fill 或替代為零。
- [百分位被長期估值制度變化影響] → 固定五年窗口並顯示 coverage；定位為歷史相對位置，不宣稱內在價值。
- [多層 SVG 影響 dense layout 效能] → 只在勾選時建立、以單一 rAF 合併重繪、裁切 visible range polygon，並以 1／4／8 圖 browser acceptance 量測。

## Migration Plan

1. 先完成官方來源 preflight 與 fixtures，再加入 additive D1 migration；舊資料與既有 endpoint 不需轉換。
2. 部署 Worker API／D1 tables／background runner，但前端 checkbox 預設關閉；以測試 symbol 建立最小 coverage 並核對來源日期。
3. 部署前端選項、overlay 與 readout，執行本機 API、browser、PNG 及多圖驗收。
4. 正式站以一檔 `.TW`、一檔 `.TWO`、ETF、不足歷史及負 EPS 狀態驗證，確認未勾選時沒有估值 request。
5. rollback 時先移除／關閉前端入口與 route，保留 additive D1 table 以便診斷或後續恢復；不得以 destructive migration 刪除已回補資料。

## Open Questions

- 官方歷史端點對自動化批次讀取與衍生圖表揭示的最新規範、建議速率及 attribution 要求，必須在實作第一階段以官方文件或書面回覆確認。
- 若 `.TWO` 歷史資料必須經私有 mirror，需在實作時依當下 Sites runtime 實測決定沿用既有 ingest endpoint 或新增估值專用 endpoint；兩者都必須 fail closed 且不得在規格中保存秘密值。
