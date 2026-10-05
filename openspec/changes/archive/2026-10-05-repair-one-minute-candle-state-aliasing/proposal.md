## Why

2026-10-05 使用者切換至 1 分 K 時，圖表因相同時間戳重複而觸發 `data must be asc ordered by time`，整頁進入啟動失敗畫面。唯讀程式檢查與隔離重現顯示，1 分聚合直接回傳原始陣列，使原始資料與顯示資料共用陣列及 Candle 物件；需要獨立修復資料所有權與圖表提交邊界，避免重複 K 棒及成交量重算。

## What Changes

- 分離原始 1 分資料與顯示 Candle 的陣列、物件所有權，確保每筆合法增量只計算一次。
- 在記憶體快取與圖表提交邊界檢查時間嚴格遞增、唯一及有效性；污染的快取不得繼續送入 `setData`。
- 對不合法資料採取圖表局部、可診斷且有界的復原，不猜測合併成交量、不無限重試、不使整頁崩潰。
- 加入切換週期、歷史載入、即時更新與既有圖表行為的回歸測試，優先在今日修復後完成短時間實盤確認；若已無足夠真實事件，再延至次一適用交易日。
- 依使用者更新指示，程式可於待會兒、今日盤中開始實作，不以收盤或正式擷取 cleanup 作為前置條件。實作前後核對背景擷取與共用服務，維持不干擾進行中監控驗收的限制；這次文件調整本身不等於程式已修復。

## Capabilities

### New Capabilities

- `main-chart-candle-data-integrity`：主圖 Candle 資料所有權、唯一時間軸、快取完整性與圖表局部復原契約。

### Modified Capabilities

無。沿用既有 canonical 價量單位、成交值來源及圖表互動契約，不修改盤中監控的資料平面或驗收 Gate。

## Impact

- 預計影響 `src/lib/utils/kbars.ts`、`src/lib/chart-kbar-memory-cache.ts`、`src/components/candle-chart.tsx` 及相關測試。
- 保護 5m／15m／60m／1D、歷史拖曳與分頁、viewport、指標、CDP／三關價／Pivot Point／Fibonacci 與價量 readout。
- 不修改共用行情 SSE、broker login／subscription、監控排程、正式擷取、來源資料庫或原始驗收證據。
- 不需因純前端修復重跑完整 160 檔全日驗收；本 change 的短時間實盤確認不得替代其他監控 change 的既有結案條件。
