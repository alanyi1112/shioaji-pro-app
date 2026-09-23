## ADDED Requirements

### Requirement: 新訊號必須使用版本化 v7 immutable snapshot

任一布林位置、RSI、KD 或 MACD 新條件啟用時，服務 MUST 只查詢同一 `effectiveSessionDate`、universe revision、source mapping、normalization、formula 與 criteria version 的 ready v7 immutable snapshot。v7 response MUST 提供 `snapshotId`、版本欄位、criteria fingerprint、OHLCV through date、逐市場 coverage、逐條件計數、生成時間與 cursor identity。跨日期、跨市場、跨版本或臨時從 canonical table 計算的 rows MUST NOT 成為可操作結果。

#### Scenario: 新條件啟用但只有 v6 snapshot

- **WHEN** 使用者啟用 RSI、KD、BOLL 位置或 MACD，而當期只有合法 v6
- **THEN** API MUST 回 v7 preparation pending／coverage，rows 不可操作，不得以 v6 rows 臨時計算新訊號

#### Scenario: 同一 cursor 跨越新發布

- **WHEN** 使用者讀下一頁時已有較新 v7 snapshot
- **THEN** API MUST 固定原 snapshot，或在原 snapshot 已淘汰時回 `snapshot_expired`，不得混合兩版集合

### Requirement: v7 criteria 與偏好必須可從 v6 決定性遷移

v7 criteria MUST 版本化保存四個新分支的 enabled、mode、合法門檻、適用方向及各自量能確認。合法 v6 MUST 決定性遷移為新分支全關閉的 v7；未知欄位、非法數值、無效 enum、非有限值或不適用的隱藏參數 MUST fail closed。停用分支、非中軌附近的 BOLL tolerance／direction、非接近零軸的 MACD distance，以及關閉的量能參數 MUST 從 effective criteria 與 fingerprint 移除。

#### Scenario: 等價停用條件具有相同 fingerprint

- **WHEN** 兩份 v7 draft 只在停用分支或不適用隱藏欄位的值不同
- **THEN** effective criteria 與 fingerprint MUST 相同，且不得產生不同查詢或 cache identity

#### Scenario: 合法 v6 投影

- **WHEN** 四個新分支皆關閉且最新合法 v6 與當期 `effectiveSessionDate` 一致
- **THEN** 既有條件查詢 MUST 可沿用 v6 projection，並明示版本；不得因 v7 background remaining 阻止舊行為

### Requirement: v7 API 必須維持本機有界唯讀與三態守恆

v7 status／results API MUST 以固定 allowlist 驗證四個分支、門檻、量能參數、排序、cursor 與頁大小，只讀 repo 外本機 D1。每個啟用分支 MUST 產生 pass、fail 或 unknown，訊號內量能依 AND 三態合併後才進入外層 `all`／`any`；計數 MUST 滿足 `matched + notMatched + unknown = total`。惡意或超界參數 MUST 有界拒絕，不查詢 provider、不執行 DDL、不派送背景工作、不回內部 stack，hosted target MUST 不啟用此路由。

#### Scenario: 非法 MACD 距離門檻

- **WHEN** request 提供非有限、超界、多餘小數位或不適用於目前模式的 MACD distance
- **THEN** API MUST 回固定 validation error，且外部來源、Shioaji、交易與 runtime 呼叫計數維持零

#### Scenario: all 模式含訊號內 unknown

- **WHEN** 某啟用新訊號的技術 verdict pass、量能 verdict unknown，其他所有啟用分支 pass，外層為 `all`
- **THEN** row MUST 為 unknown，逐子條件 reason 與全市場守恆 MUST 保留

### Requirement: v7 evidence 必須揭露公式邊界與量能判定

每個新分支的 v7 evidence MUST 包含實際參數、D／P／必要時 P2、canonical 指標或 band 值、嚴格／含邊界比較結果、量能 D、前期窗、平均值、倍數、流動性下限、逐子條件 verdict／reason、formula version 與 hash。值可在 UI 格式化，但 API 保存及判定 MUST 使用未四捨五入值；unknown MUST 指出缺少的日期、欄位或暖機責任，不得以零代替。

#### Scenario: 邊界恰好等於門檻

- **WHEN** 中軌正規化距離或量能倍數的 canonical 值恰好等於使用者門檻
- **THEN** 依規格使用 `<=` 或 `>=` 的分支 MUST pass，evidence MUST 足以由原值重算，不受顯示四捨五入影響

#### Scenario: 必要 volume session 缺失

- **WHEN** 啟用量能確認但前期 N 日中有一日缺正式成交量
- **THEN** evidence MUST 標記 `missing_volume_baseline` 與缺漏日期，MUST NOT 把平均量以較少天數重算

### Requirement: v7 正式驗收必須證明相容性與無副作用

驗收 MUST 保存非敏感 universe／source／normalization／formula／criteria 版本、實際 130-session 範圍、每市場 target／processed、逐模式 pass／fail／unknown、量能缺漏、守恆、結果 hash、代表性公式重算及實際 UI／console 結果。測試 MUST 證明 v1–v6 snapshot／cursor／偏好不被重解釋，且篩選、翻頁與點選不改動自選清單、雙清單同步、TDCC／籌碼佇列、交易路由、simulation runtime 或既有行情連線。

#### Scenario: 舊版回歸

- **WHEN** v7 已發布而查詢只使用 v6 既有條件
- **THEN** 相容投影的結果、日期、排序與 evidence MUST 與同一份合法 v6 一致，新欄位不得改變舊判定

#### Scenario: 未加入清單的全市場案例

- **WHEN** 一檔不在個人清單且非排行前百名的普通股符合任一新訊號
- **THEN** 該商品 MUST 出現在完整可走訪結果，且只有明確「加入清單」動作才能變更清單
