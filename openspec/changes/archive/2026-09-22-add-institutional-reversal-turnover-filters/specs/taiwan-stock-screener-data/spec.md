## ADDED Requirements

### Requirement: 法人反轉條件必須使用版本化 v6 immutable snapshot

系統 MUST 以新的 criteria、formula、schema 與 source mapping version 建立 v6 immutable snapshot。每列 MUST 綁定同一 `effectiveSessionDate` 的已發布 v5 base、官方交易日序列、外資與投信 daily flows、完整 OHLCV、已發行普通股數、receipts hash 及逐列 evidence hash；任一來源日期或版本不一致時不得成為 v6 publication head。

#### Scenario: 所有 v6 來源對齊

- **WHEN** v5 base、兩市場法人新 mapping、OHLCV、股本分母及必要交易日都對齊相同 `effectiveSessionDate` 並通過 coverage gate
- **THEN** publisher MUST 在完整 staging rows 寫入及 hash readback 成功後原子發布 v6 snapshot

#### Scenario: 原始列比 publication head 更新

- **WHEN** D1 已有較新的 OHLCV 或法人 raw rows，但最新合法 v5／v6 publication head 尚未推進
- **THEN** 新條件 MUST 使用 publication head 的 `effectiveSessionDate`，不得把較新 raw rows 混入舊 snapshot

### Requirement: v6 criteria 與偏好必須可從 v5 決定性遷移

v6 criteria MUST 新增外資反轉與投信反轉設定、嚴格驗證參數範圍並納入 canonical fingerprint。既有 v5 preference MUST 可決定性遷移至 v6，所有舊條件、排序、方向及結果狀態保持不變，兩項新條件預設關閉並使用規格預設值；v5 儲存內容不得就地改寫。

#### Scenario: 開啟既有 v5 偏好

- **WHEN** 使用者只有合法 v5 preference
- **THEN** UI MUST 遷移為等價 v6 draft，保留所有舊值，新增條件為未啟用，且未按「開始篩選」前不得送出新查詢

#### Scenario: 新參數超出範圍

- **WHEN** API 收到負日數、非整數張數、平均期間不足、參與率下限不小於上限或其他非法 v6 criteria
- **THEN** route MUST 拒絕查詢為 `invalid_criteria`，不得自動截斷成另一策略

### Requirement: v6 evidence 必須揭露逐子條件 verdict 與缺漏原因

每個法人反轉 outcome MUST 保存總 verdict、逐子條件 verdict、使用日期、原始 canonical 整數、UI 單位換算、平均窗、分母、公式值、receipt IDs、mapping／formula version 及 safe reason。任何必要輸入缺漏 MUST 產生 `unknown`，不得與一般 `fail` 合併。

#### Scenario: 只有成交量歷史不足

- **WHEN** 法人連賣轉買資料完整，但商品上市時間不足以建立設定的 20 日流動性平均
- **THEN** 法人與今日轉買子條件 MAY 保存已知 verdict，流動性與總 outcome MUST 為 `unknown` 並回報 `insufficient_history`

#### Scenario: 代表性公式重算

- **WHEN** 驗收工具從 snapshot 取出一個 `pass`、一個 `fail` 與一個 `unknown` row
- **THEN** 工具 MUST 能只用保存的 dates、raw integers、分母與版本重算相同子 verdict 及總 verdict

### Requirement: v6 失敗不得破壞 v5 publication 與個人資料

v6 migration、backfill、staging、publication 或 readback 任一步驟失敗時，系統 MUST 保留最後合法 v5／v6 head、既有 snapshots、個人清單與偏好來源資料。UI MAY 回退至 v5，但 MUST 顯示 v6 pending／unavailable 真實狀態，不得清空選股結果或改寫使用者清單。

#### Scenario: v6 staging hash 不一致

- **WHEN** 任一 staging row 的 evidence hash 或全體 material hash readback 不一致
- **THEN** staging v6 MUST 不得發布，最後合法 head MUST 保持不變，且錯誤不得觸發資料表重建或個人資料刪除
