## Context

MultiView 的 canonical candle 目前只保留 OHLCV。`realtime-coordinator.js` 從本機 simulation Shioaji Kbars 建立 1 分 K、從 SSE Tick 建立 forming tail，再由 `realtime-charts.js` 聚合分鐘與日 K；`chart-payload.js`、target-date snapshot及 `app.js` readout 都沒有成交值欄位。既有 `sessionFromKbars()` 中的 `weightedAmount += close * volume` 只用於暫時計算平均價，不是 Shioaji 實際成交值，不能轉作本功能來源。

2026-08-24 已完整撤回成交值左軸、series、設定、gateway／Worker turnover payload與遠端 cache宣稱。本 change 是新的產品決策，只恢復本機 MultiView K 棒文字 readout 所需的最小精確資料鏈；不恢復軸線、圖線或遠端市場資料能力。主交易畫面的 `add-main-chart-kbar-turnover-readout` 已驗證 Shioaji `KBars.Amount`、Tick `amount／total_amount` 及萬元格式，但 MultiView 必須在自身 page-scoped cache、connection、panel generation與 crosshair hot path內重新建立契約，不能直接共享 React component 狀態。

## Goals / Non-Goals

**Goals:**

- 讓本機 MultiView 的 1／5／15／60 分與日 K readout 使用同一 canonical candle 顯示精確成交值。
- 只接受 Shioaji 提供的非負 safe integer 元值，資料不完整時以明確 unavailable 狀態呈現。
- 讓 forming Tick、歷史補載、指定日期 1 分 K、panel cache、完整 panel PNG及 1／2／4／8 panel 保持相同 identity與generation。
- 維持既有 animation-frame latest-wins、相同 candle signature gate及 panel lifecycle，不因成交值增加高頻重繪。

**Non-Goals:**

- 不建立成交值左軸、右軸、series、指標、設定 checkbox或其他視覺化。
- 不以 OHLC、close、volume、average price、`weightedAmount`、Yahoo欄位或其他來源估算成交值。
- 不替 Yahoo、國外商品、指數、Cloudflare／Sites realtime或 D1 candle history 宣稱精確成交值。
- 不修改 production、CA、broker authority、下單、智慧單、部署或服務生命週期。

## Decisions

### 1. canonical candle 使用明確的 nullable 元值

MultiView candle 新增 `turnoverTwd: number | null`。合法值只接受 Shioaji Decimal 可無損轉成的非負 safe integer；`null` 表示 unavailable。歷史 `Amount` 陣列必須與 `datetime／OHLCV` 等長才逐列接受，否則所有該 response candle 的成交值均為 `null`，但合法 OHLCV／volume 仍可使用。

替代方案是另建 time-keyed turnover map；但 history prepend、forming tail、target-date atomic commit與 crosshair lookup都必須額外 join，容易把舊 generation 的值接到新 candle，因此不採用。

### 2. 聚合只加總完整精確子集合

5／15／60 分與日 K沿用 canonical 1 分 K聚合。只有 bucket 內每根實際存在的 candle 都有合法 `turnoverTwd` 時才加總；任一 `null` 或 safe integer overflow 都讓該 bucket 為 `null`。OHLCV continuity 的 `complete／partial` 與 turnover availability 分開，避免把「分鐘缺口」錯當成可補值授權。

### 3. forming turnover 與既有 volume cursor 共用事件邊界

本機 SSE snapshot schema加入 `tickTurnoverTwd／totalTurnoverTwd` availability。Kbars bootstrap先建立同一台北交易日的 volume與turnover累計；合法 Tick以新舊 `total_amount` 差額更新 forming candle，只有累計欄位缺漏時才允許同一已接受事件的合法 `amount` fallback。連續 sequence 同時提供兩者卻矛盾、累計倒退、重送、舊 connection、舊 session、zero-volume／simtrade或不安全數值時，turnover chain fail unavailable直到可信 bootstrap；合法價格與 volume lifecycle仍依原契約處理。

Transport／React 合併造成 sequence 跳號時，`total_amount`差額可能涵蓋多筆成交，不能拿最後一筆 `amount` 強制作相等比較。UI 對同一 snapshot 的重複觀察不得再次消耗 cursor。

### 4. schema revision與page-scoped cache一併輪替

Kbars parser、SSE snapshot、canonical candle、chart payload與 target-date snapshot使用新的 turnover schema revision；page-scoped range cache key／entry必須綁定 source identity與revision。舊的 OHLCV-only cache entry不得被補一個布林值後沿用，必須重新從同一 simulation Shioaji response建立。這只輪替瀏覽器／本機 runtime cache，不修改 D1 schema或遠端 candle persistence。

### 5. readout只消費目前 candle，不建立視覺 series

`app.js` 在既有 OHLC row 的成交量後加入成交值欄位。crosshair、latest fallback與 forming update都從 `candleAt(time)` 取得 `turnoverTwd`，沿用目前每 panel animation-frame與 commit signature；turnover變更必須納入 payload revision，但不得觸發 chart、overlay、技術副圖或籌碼 pane重建。

格式與主交易畫面一致：0元顯示`0萬`、小於1,000元顯示`<0.1萬`、低於100萬元保留一位小數、100萬元以上四捨五入為整數萬元並加千分位；可見標籤為`值`，完整 accessible name／tooltip為`成交值 …萬元`。成交量與成交值各自為不可拆分欄位，欄位邊界可以換行。

### 6. 指定日期 1 分 K把turnover納入原子snapshot

MultiView單圖 target-date response validator從同一次 Kbars response驗證 `Amount`，並把 `turnoverTwd` availability納入 staged snapshot、projection layers及 atomic commit。不能在 commit 後用目前 realtime、其他日期或 cache補接。返回日 K後重新走一般 provider契約；Yahoo日 K因此仍顯示 unavailable，不把單日 simulation Amount寫入遠端或一般日 K cache。

### 7. 明確維持撤回能力與安全邊界

production residual tests必須證明沒有 turnover price scale、series、axis formatter、indicator consumer、Cloudflare／D1 payload或交易路徑。所有實際驗收只使用既有 127.0.0.1:5174 與 simulation market-data adapter，不啟停服務、不發出 broker write。

## Risks / Trade-offs

- [Yahoo／遠端日 K沒有精確Amount，部分畫面會顯示`值 —`] → 明確顯示 unavailable，只有 local Shioaji exact source才提供非空值，不用估算換取表面一致。
- [舊page cache被誤當成新schema] → revision綁定cache entry與payload validator，舊entry直接miss並重新載入。
- [SSE重送或UI重複觀察造成成交值重複] → 與volume共用identity／session／source time／sequence，並在UI前排除non-trade snapshot及相同event identity。
- [新增欄位使多圖crosshair變慢] → 沿用per-panel requestAnimationFrame、相同candle commit key與DOM signature，只更新一個readout field。
- [成交值外溢到已撤回左軸能力] → residual scan與browser DOM assertion禁止turnover series、axis、設定及額外price scale。

## Migration Plan

1. 先建立 strict turnover parser／formatter、canonical candle與schema revision，補齊invalid／missing／overflow tests。
2. 接入 local Kbars、分鐘／日聚合、forming dual cursor及page cache rotation；保留OHLCV-only fallback。
3. 接入 chart payload、readout與target-date staged snapshot，完成focused／integration／fault injection。
4. 在127.0.0.1:5174實際驗收歷史、forming、1／5／15／60分、日K、指定日期、1／2／4／8 panel、窄版及完整panel PNG。
5. TypeScript、MultiView build、OpenSpec strict、`git diff --check`與獨立P0/P1 closure全部通過後才勾選tasks。若回滾，移除新readout consumer並讓新revision payload fail unavailable；不得回退成估算或沿用舊cache。

## Open Questions

目前沒有未決產品問題；第一階段正式範圍固定為本機 simulation Shioaji MultiView，其他 provider只顯示 unavailable。
