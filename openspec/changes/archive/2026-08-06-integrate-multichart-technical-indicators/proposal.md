## Why

RealTimeStock 雖已提供主圖與副圖指標，但與 `alanyi1112/MultiChartOnCodexSite` 的實際公式、預設週期、輸出線數及多圖狀態契約不一致；例如目前 RSI 是單線 RSI(14)，KD 採兩段 SMA，而參考 repo 使用 Wilder RSI(5／10) 雙線與 K、D 以 50 初始化的 9／3／3 遞迴算法。需要以參考 repo 目前最新且可驗證的 commit `ecae7cac837f06085801c96f3da0c570051d66e7` 為固定基準整合，同時保留 RealTimeStock 已有指標、本機 Shioaji 資料邊界與 simulation 安全模式。

## What Changes

- **BREAKING**：將既有 `rsi` 實例改為可設定的 Wilder RSI 短／長雙週期，預設 5／10；平盤時兩線皆回傳 50，副圖顯示 30／50／70 基準線。共用單週期 Wilder RSI 核心，避免破壞 StochRSI。
- **BREAKING**：將既有 `kd` 從 RSV 的兩段 SMA 改為 K、D 前值固定以 50 初始化的 9／3／3 兩段遞迴平滑，並顯示 20／80 基準線。
- **BREAKING**：MACD 與 ATR 的暖機、空值、參數驗證及輸出值改以固定參考 commit 的 `worker/indicators.ts` 為準；MACD 保留 RealTimeStock 現有 `hist`／`macd`／`signal` output keys，以保存既有樣式對應。
- 新增「參考均線組」主圖指標，一次顯示 SMA5／10／20／60／120；保留既有可重複加入的單一 SMA／EMA／WMA。
- 讓成交量柱可同時顯示 Volume MA5／MA10／MA20，並明確綁定 `vol` price scale。MA5／MA10 對齊參考 repo；MA20 是 RealTimeStock 採相同 SMA 契約新增的延伸功能，不宣稱來源 parity。
- 將參考 repo 的 BOLL(20,2)、Fair Value Gaps 與 candle-based Volume Profile（24 bins、POC、VAH、VAL）整合為可選主圖指標。K 線 Volume Profile 採每張圖獨立選取的固定起訖 K 棒區間，不隨平移、縮放、可視範圍或 history paging 自動改變。
- 將參考 repo 的 Traditional Pivot Point 整合為預設關閉的主圖指標，使用完整交易日 OHLC 計算下一交易日 P、R1～R3、S1～S3。第一階段只支援股票（STK）、指數（IND）與權證（WRT）；期貨（FUT）與選擇權（OPT）因缺少權威 `trading_day`／session metadata 而明確延後。
- 保留 RealTimeStock 既有 VWAP、SAR、SuperTrend、Donchian、Keltner、StochRSI、CCI、OBV、MFI、Williams %R、DMI、ROC、BIAS 與自訂指標，不因參考公式整合而移除。
- 將既有 indicator instances 同步改為單一 canonical external store：所有 mutation 使用 functional update；設定視窗使用 local draft，取消時不得以整份舊快照覆蓋其他圖表的更新。
- 將歷史載入、即時未收 K、歷史補載、時框切換與回測圖表統一使用同一份公式與 instance 版本；current bar 更新重用既有 series／pane，遞迴型指標使用完整歷史狀態或等價 checkpoint，不得裁成暖機期後造成數值漂移。
- 對舊版 `sj-pro-indicators-v2` 與 `sj-pro-ind-defaults-v1` 執行版本化、可重入且非破壞 migration，保留實例 id、樣式、顯示時框、隱藏狀態與順序；storage 寫入失敗時仍維持本次 document 的記憶體 canonical snapshot，並提供安全提示。
- 指標 runtime 狀態依 `chart identity + instanceId + generation` 隔離；單一圖表上的計算錯誤不得污染其他商品／時框或寫入全域持久化設定。
- 以四個可獨立驗收的實作階段進行：公式與 migration、canonical store 與 stable renderer、FVG 與固定區間 Volume Profile、股票類 Pivot；每一階段通過自己的測試與可見驗收後才進入下一階段。

## Capabilities

### New Capabilities

- `chart-technical-indicators`: 定義固定參考版本的 OHLCV 技術指標公式、主副圖顯示、版本化設定、多圖同步、穩定即時更新、固定區間 overlay、股票類 Pivot、migration 與驗證契約。

### Modified Capabilities

- 無。

## Impact

- 主要程式：`src/lib/indicators.ts`、`src/lib/indicator-defs.ts`、`src/lib/chart-indicators.ts`、`src/lib/utils/kbars.ts`、`src/components/candle-chart.tsx`、`src/components/indicator-dialog.tsx`、既有 chart primitive／overlay 架構、對應樣式與測試。
- 資料：沿用本機 Shioaji `/api/v1/data/kbars`、history paging 與 SSE；不新增遠端市場資料服務、資料庫、production 登入或下單路徑。
- 持久化：新增 indicator instances v3 envelope 與 per-type defaults 新版 envelope；保留舊 key 作 migration source，不得清空與本次無關的設定。
- 效能：最多可同時存在八個 chart block；current-bar 更新採有界 latest-wins、stable series 及遞迴狀態／checkpoint，不得每 tick 全量 teardown pane，也不得以縮短歷史輸入犧牲公式 parity。
- 明確不納入：FUT／OPT Pivot、本益比河流圖、估算融資成本、籌碼／法人／融資券／TDCC 副圖、週線／月線 Pivot，以及來源 repo 的 Worker、D1、Cloudflare API。FUT／OPT Pivot 必須待權威交易日／session 資料可用後另開 change；費波那契回撤與拓展由獨立繪圖工具 change 處理。
