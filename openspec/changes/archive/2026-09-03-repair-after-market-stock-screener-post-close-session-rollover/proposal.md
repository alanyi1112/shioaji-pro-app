## Why

目前收盤後選股更新器與收集器把當日正式資料固定延後至台北時間 18:00 才允許收集，導致台股已收盤且 TWSE、TPEx 當日官方日報均已發布時，系統仍沿用前一份快照，把再前一個交易日錯當成「上一個交易日」。例如 2026-09-03 收盤後兩市場皆已提供 9/3 日報，選股卻仍使用 9/1 → 9/2，而非正確的 9/2 → 9/3。

## What Changes

- 以台北交易時段、官方交易日曆與 TWSE／TPEx 當日日報的實際可驗證狀態，取代固定 18:00 的當日資料門檻；官方共同交易日改為 14:00 後才允許探測當日報表。
- 收盤後有界探測兩市場當日日報；只有兩市場日期、schema、完整性與母體覆蓋均通過時，才原子發布新的 D／P 快照。
- 若其中一個市場尚未發布或驗證失敗，保留最後合法共同快照，明示預期資料日、實際有效資料日及等待原因，並禁止把歷史 rows 當成本期可操作結果。
- 修正選股 UI 的日期語意，分別顯示「成交量比較 P → D」、「有效資料日」及必要時的「預期資料日／等待狀態」，不得把舊快照日期描述成今日已完成。
- 調整更新排程、冷卻與重試狀態，使收盤後能及時前進，又不形成 busy-loop、未受控外部請求或單邊市場混期。
- 增加收盤前、收盤後尚未發布、單市場就緒、雙市場就緒、週末／休市、延遲發布與跨日 rollover 的自動化及本機 live 驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-screener-data`：修正正式日資料 D／P 的收盤後推進、雙市場發布就緒、expected／effective session 與快照可操作性契約。
- `after-market-stock-screener`：修正選股面板的日期、等待狀態及舊快照不可操作呈現。

## Impact

- 影響本機選股 operator、daily collector、官方交易日／日報發現、快照 publisher／repository／route、排程與 retry policy。
- 影響選股 API 的 freshness metadata、狀態原因及選股面板日期／操作狀態顯示；不改變既有條件公式、全市場母體範圍、TDCC 週資料或 K 線歷史來源。
- 需更新相關單元、整合、browser 與本機 live 驗收；不得啟動 production／真實下單，不得改寫自選清單、TDCC 長歷史佇列、simulation runtime 或行情連線。
