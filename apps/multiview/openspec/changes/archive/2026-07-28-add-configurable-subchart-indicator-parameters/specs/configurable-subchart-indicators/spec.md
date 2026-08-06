## ADDED Requirements

### Requirement: 技術指標參數必須可由副圖功能表全域設定
系統 MUST 在副圖功能表「技術指標」旁提供可辨識且可鍵盤操作的小型齒輪按鈕，開啟全域參數設定視窗。視窗 MUST 提供 RSI 雙週期、KD 期間與兩段平滑權值、MACD 快慢線與訊號線週期、ATR 期間，並提供套用、取消與還原預設；所有輸入 MUST 經整數與允許範圍驗證。

#### Scenario: 從副圖功能表開啟設定
- **WHEN** 使用者點擊或以鍵盤啟動「技術指標參數設定」齒輪
- **THEN** 系統 MUST 開啟完整位於 viewport 內的設定視窗
- **AND** 視窗 MUST 顯示目前全域生效值，不得顯示某一 panel 的暫存值

#### Scenario: 套用有效設定
- **WHEN** 使用者輸入有效參數並按下「套用至所有圖表」
- **THEN** 系統 MUST 保存同一組版本化設定到目前瀏覽器
- **AND** 所有現存 panel、後續建立 panel、歷史補載與即時串流 MUST 使用相同參數
- **AND** 受舊參數影響的前端 payload cache MUST 被清除

#### Scenario: 拒絕無效設定
- **WHEN** 使用者輸入非整數、超出允許範圍，或 MACD 快線週期不小於慢線週期
- **THEN** 系統 MUST 顯示可理解的欄位錯誤並保持視窗開啟
- **AND** 系統 MUST NOT 保存、套用或發送該組參數

#### Scenario: 還原參考預設
- **WHEN** 使用者選擇還原預設
- **THEN** RSI MUST 回復 5／10、KD MUST 回復 9／3／3、MACD MUST 回復 12／26／9、ATR MUST 回復 14
- **AND** 使用者確認套用後所有圖表 MUST 使用還原值

### Requirement: RSI 必須以參考雙週期算法計算與顯示
系統 MUST 以 5 與 10 為預設週期，分別使用 Wilder 遞迴平均計算兩條 RSI。每一週期 MUST 先用最初 N 根漲跌幅的簡單平均初始化平均漲幅與平均跌幅，再以 `(前平均 × (N - 1) + 本期漲跌幅) / N` 更新；平均跌幅為零時 RSI MUST 為 100，平均漲幅與跌幅皆為零時 RSI MUST 為 50。

#### Scenario: 期數不足
- **WHEN** 某 RSI 週期尚未累積 N 根漲跌幅
- **THEN** 該週期在對應 candle 的值 MUST 為 null
- **AND** 另一個已完成暖機的 RSI 週期 MAY 繼續顯示

#### Scenario: 顯示雙 RSI 與基準線
- **WHEN** 使用者勾選 RSI
- **THEN** 副圖 MUST 顯示兩條可辨識的 RSI 線及各自目前讀值
- **AND** 同一 RSI price scale MUST 顯示 30、50、70 的細虛線
- **AND** 基準線 MUST 隱藏軸標籤，避免遮擋資料

### Requirement: KD 必須以參考 9／3／3 遞迴算法計算與顯示
系統 MUST 以期間 9、RSV 權值 3、K 權值 3 為預設。累積 9 根 candle 後 MUST 計算 RSV；K、D 前值 MUST 以 50 初始化，並分別使用 `K=(前K×(RSV權值-1)+RSV)/RSV權值` 與 `D=(前D×(K權值-1)+K)/K權值` 更新。最高價等於最低價時 RSV MUST 使用 50。

#### Scenario: KD 暖機與首值
- **WHEN** candle 未達設定期間
- **THEN** K 與 D MUST 為 null
- **AND** 第一個有效 RSV MUST 以 K、D 前值 50 完成兩段平滑，不得以前置零值參與 SMA

#### Scenario: 顯示 KD 與基準線
- **WHEN** 使用者勾選 KD
- **THEN** 副圖 MUST 顯示 K、D 兩條線及各自目前讀值
- **AND** 同一 KD price scale MUST 顯示 20、80 的細虛線
- **AND** 基準線 MUST 隱藏軸標籤，避免遮擋資料

### Requirement: candles、cache、歷史補載與 stream 必須使用一致參數
系統 MUST 將經正規化的技術指標參數套用到 `/api/candles`、歷史補載與 `/api/stream`，並將穩定參數簽章納入前端 payload cache 與 Worker candle payload cache 的 identity。未提供或不合法的 query 值 MUST 安全回復預設，不得造成任意 cache key 或 Worker 例外。

#### Scenario: 週線使用一致週界
- **WHEN** 使用者請求週線 candles
- **THEN** 系統 MUST 以交易所時區將日 K 依週一至週日聚合為週 K
- **AND** 開盤、最高、最低、收盤與成交量 MUST 分別取第一筆、全週極值、最後一筆與全週加總
- **AND** 由日 K 聚合的週線歷史 cache MUST NOT 與舊版原生週 K 混用

#### Scenario: 月線使用一致月界
- **WHEN** 使用者請求月線 candles
- **THEN** 系統 MUST 以交易所時區將同一曆月的日 K 聚合為月 K
- **AND** 開盤、最高、最低、收盤與成交量 MUST 分別取第一筆、全月極值、最後一筆與全月加總
- **AND** 未完成月份 MUST 與當月既有交易日合併，不得把最新交易日當成獨立月 K
- **AND** 由日 K 聚合的月線歷史 cache MUST NOT 與舊版原生月 K 混用

#### Scenario: 相同商品使用不同參數
- **WHEN** 同一 symbol 與 interval 先後以兩組不同有效參數請求 candles
- **THEN** 系統 MUST 回傳各自參數對應的 indicators
- **AND** 前端與 Worker MUST NOT 將第一組 payload 當作第二組的 cache hit

#### Scenario: 即時 candle 更新技術指標
- **WHEN** SSE 回傳使用目前參數計算的新 candle 與 indicators
- **THEN** 前端 MUST 更新本機 payload 的 indicators、已選技術 series 與最新 readout
- **AND** 不得只更新成交量而留下 RSI、KD、MACD 或 ATR 舊值
