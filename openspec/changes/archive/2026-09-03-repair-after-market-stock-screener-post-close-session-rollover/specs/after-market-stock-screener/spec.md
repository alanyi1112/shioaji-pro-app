## MODIFIED Requirements

### Requirement: 結果必須呈現可追溯的資料日期與全市場覆蓋

結果區 MUST 呈現日量比較的兩個交易日、TDCC 比較的兩個官方週日期、技術型態最後交易日、`effectiveSessionDate`、快照產生時間、實際套用條件、母體總檔數、可判定檔數、符合／不符合／無法判定檔數及逐條件缺漏數。日量 MUST 以「成交量比較：P → D」呈現，`effectiveSessionDate` MUST 以「有效資料日」呈現；只有收盤後 `expectedSessionDate` 晚於 `effectiveSessionDate` 時，才另行顯示「預期資料日」及 TWSE／TPEx 等待原因。每筆成交量結果 MUST 把 P／D 日期與數值放在同一 evidence；成交值只作篩選，不在結果卡顯示數值或日期。面板 MUST 允許查看無法判定的商品與原因；MUST NOT 以當天日曆日期、請求時間、UI 重整時間、圖表最後 K 棒日期或較舊 snapshot 冒充資料日期。

未啟用且尚無資料的條件，其日期／指標 MUST 標示未提供，不以要求兩種資料都就緒阻止單條件篩選。stale 或 mixed-session response MUST 顯示最後合法 P／D、有效資料日、預期資料日、快照時間與等待原因；其 rows MUST NOT 保持可點選、可加入清單或被描述成當期符合結果。GET 查詢與 UI 重整 MUST NOT 直接觸發官方來源或背景更新。

#### Scenario: 部分商品缺少前一週

- **WHEN** 啟用的大戶條件有商品缺前一官方週期
- **THEN** 面板 MUST 清楚呈現缺漏數與受影響商品原因，且不得以「0 檔符合」暗示全市場皆已完整比較

#### Scenario: 官方新日資料尚未公布

- **WHEN** 新交易日已收盤但來源還沒有可驗證的正式資料
- **THEN** 面板 MUST 顯示預期資料日、最後有效資料日、逐市場等待原因及上次快照的原比較日期，不納入當日盤中累計量或更新舊資料日期
- **AND** 舊結果 MUST 以歷史快照呈現並停止當期操作，不得只顯示 stale 警告後繼續提供點選或「加入清單」

#### Scenario: OR 已符合但另一條件缺資料

- **WHEN** 某商品在「任一符合」下成交量達標但 TDCC 缺資料
- **THEN** 商品 MUST 列入符合清單，同時把 TDCC 欄位及逐條件缺漏明示為資料不足，不偽造週增零值

#### Scenario: 結果日期與圖表日期不同

- **WHEN** 選股 evidence 的 D 與指定 K 線圖目前最後一棒日期不同
- **THEN** UI MUST 同時明示選股 P／D 與圖表資料日期，不得讓使用者把不同日期的成交量柱視為同一筆判定

#### Scenario: 同日官方成交量與 Snapshot 成交量比較

- **WHEN** 使用者點選結果後取得的 Shioaji STK Snapshot 日期等於該列選股 D
- **THEN** 結果卡 MUST 將官方盤後股數除以 1,000 精確換算為張，並顯示官方盤後張數、Snapshot common lot 張數及「官方盤後減 Snapshot」的有正負號差異張數
- **AND** 不足一張的差異 MUST 保留最多三位小數，不得把 Snapshot 的 `total_volume` 標示為股
- **AND** 圖表 QuoteBoard 與主圖之間 MUST NOT 顯示另一條選股證據提示列

#### Scenario: 日期不同或 Snapshot 不可用

- **WHEN** Snapshot 日期不同於選股 D，或 Snapshot 未取得、成交量無效
- **THEN** 結果卡 MUST NOT 製造或顯示同日差異，既有 P／D 官方證據仍保持原樣

#### Scenario: 收盤後當日資料已齊備

- **WHEN** 台北交易日收盤後，API 已驗證並發布今日 TWSE／TPEx 共同快照
- **THEN** 面板 MUST 顯示「成交量比較：前一官方交易日 → 今日」與「有效資料日：今日」
- **AND** MUST NOT 繼續把再前一個交易日標示為「上一個交易日」，也不得顯示不再適用的 pending 警告

#### Scenario: 重新整理不會自行改寫日期

- **WHEN** 使用者在收盤前後重新整理選股頁，但 maintenance readiness 或 immutable snapshot 尚未改變
- **THEN** 面板 MUST 維持後端證據中的 expected／effective／P／D，不得依瀏覽器時鐘自行推進、倒退或觸發 provider 請求
