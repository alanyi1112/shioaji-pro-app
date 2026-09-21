## Context

MultiView 以 Worker 的 Yahoo/canonical candle payload 作為延遲來源，並在本機 simulation 環境由 `realtime-coordinator.js` 取得 Shioaji Snapshot、Kbars 與 SSE。`自動`模式會在兩者間原子切換，`Shioaji 即時`與`Yahoo 延遲`則強制保留選定來源。現在只有日 K 具官方交易日 continuity；分鐘 K 沒有來源時段邊界 metadata，且 Shioaji Kbars 的時間是分鐘結束點，現行程式直接當成分鐘開始點。

實際 2026-09-21 查核顯示，四檔高流動 ETF 的 Shioaji Kbars 均為09:01–13:30共270列，代表09:00–13:30的270個一分鐘區間；Yahoo 1m則只回09:02–13:24共262列。前者可由已知來源語意正規化，後者缺少的 OHLCV 無法從其他 Yahoo row推回，不得補造。

## Goals / Non-Goals

**Goals:**

- 讓三種來源模式與所有可選週期能分辨完整、部分、來源未提供與合法不適用。
- 正確換算 Shioaji end-labelled 分鐘時間，確保1／5／15／60分 bucket數、起訖與OHLCV不偏移。
- Yahoo/canonical 缺少開收盤分鐘時保留原始資料並標示 partial；自動模式在完整 Shioaji 可用時只採用同源 Shioaji candle set。
- 以官方交易日 continuity 驗證日K，並由日K交易日集合驗證週／月 period，不將休市、停牌或上市前日期補成K棒。
- 以真實5174頁面、API與來源摘要完成可重現驗收。

**Non-Goals:**

- 不製造零成交或前值延伸的分鐘 K，也不以5分K拆出不存在的1分OHLCV。
- 不把 Shioaji 資料寫成Yahoo、TWSE或TPEx verified history。
- 不啟用production、真實下單、遠端Shioaji或新的外部行情來源。

## Decisions

1. **canonical 分鐘時間一律表示區間開始。** Shioaji Kbars保留原始`sourceTime`作稽核，`time`正規化為`sourceTime - 60秒`。替代方案是在每種聚合週期使用`time - 1秒`分桶，但會讓1m與exact-date仍保留錯誤標籤，故不採用。

2. **缺棒判定使用市場時段與來源語意，不用固定row count猜測所有商品。** 對台股已完成交易日，1m canonical窗口為09:00–13:30前的270個區間；較長分鐘週期由實際1m集合推導。若商品合法停牌或沒有成交，必須由正式來源／商品狀態分類，不自動補值。

3. **Yahoo缺列以partial呈現。** 強制Yahoo模式保留實際回傳K棒並顯示缺少的邊界／區間；自動模式若Shioaji完整便原子使用Shioaji。禁止拿Shioaji列悄悄補進Yahoo payload，避免來源與volume unit混接。

4. **日週月共用交易日真相。** 日K沿用既有官方交易日continuity；週／月以相同daily base聚合並保留涵蓋的首末交易日與partial狀態。未完成當期可標示provisional，但不可把它當作歷史缺口。

5. **驗收矩陣分層。** 離線fixture驗證時間標記、聚合與partial metadata；live API驗證 `.TW`、`.TWO`、ETF與代表普通股；瀏覽器逐一切換三種來源與七種K線週期，核對可見K棒、狀態、console與服務守恆。

## Risks / Trade-offs

- [Yahoo 1m上游本身缺列] → 不補造；強制Yahoo顯示partial，自動模式優先完整Shioaji。
- [低流動商品本來沒有每分鐘成交] → 不把所有時間空洞直接判成資料遺失；只對已知來源邊界、來源宣稱完整及有正式依據的交易窗口下結論。
- [timestamp正規化影響舊快取] → source identity加入時間語意revision，使舊page cache不會被當成新canonical分鐘資料。
- [週月當期尚未結束] → 標示provisional並只檢查已完成交易日，不要求未來日期。

## Migration Plan

先加入timestamp與continuity fixture，再修改coordinator及Worker metadata；Vite直接載入repo修正，不重啟既有服務。若live驗收失敗，可回退本change相關程式檔，既有Yahoo/canonical資料與D1不需migration或刪除。

## Open Questions

無。來源沒有提供的分鐘OHLCV一律維持partial，不以推算解決。
