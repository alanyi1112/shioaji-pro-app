## ADDED Requirements

### Requirement: v4 查詢快照必須固定 OHLCV 與新技術條件版本

每份 v4 結果 MUST 包含 `snapshotId`、universe／source mapping／normalization／formula／criteria version、criteria fingerprint、`effectiveSessionDate`、OHLCV coverage、逐條件計數、來源狀態及生成時間。同一 cursor MUST 綁定相同 snapshot、正規化條件、排序與方向。v4 staging MUST 處理完整母體後原子發布，任何跨市場、跨日期、跨公式或 OHLC／volume mixed-version MUST NOT 成為最新查詢來源。

#### Scenario: 合法 v4 cursor 跨越新發布

- **WHEN** 使用者讀下一頁時已有較新 v4 snapshot
- **THEN** 服務 MUST 固定 cursor 原 snapshot，或原 snapshot 已淘汰時回 `snapshot_expired`，不得混入新資料集合

#### Scenario: 修改停用分支的隱藏值

- **WHEN** 某新條件停用或 zero-reset 對目前來源不適用
- **THEN** criteria 正規化 MUST 移除其不生效參數，使等價查詢具有相同 fingerprint

### Requirement: v3 與 v4 必須相容投影且不可互相重解釋

當均線與背離條件皆停用時，服務 MUST 可使用最新合法 v3 projection 提供既有量增、大戶、分型與布林查詢；任一新條件啟用時 MUST 要求同一期 ready v4。v1／v2／v3 snapshot、row、cursor、cache 或 preference MUST NOT 套用 v4 公式重解釋，v4 也不得以較舊 technical anchor 包裝成當期結果。

#### Scenario: v4 回補期間查詢舊條件

- **WHEN** v4 尚未 ready，但最新 v3 與當期 `effectiveSessionDate` 合法，且新條件全部停用
- **THEN** 既有條件查詢 MUST 維持可用並標示 v3；不得因 v4 background remaining 阻止查詢

#### Scenario: v4 回補期間啟用背離

- **WHEN** 使用者啟用背離但只有 v3 snapshot
- **THEN** API MUST 回 v4 preparation pending 與 coverage，rows MUST 不可操作，且不得臨時從 canonical table 或外部來源計算

### Requirement: v4 API 必須維持本機有界唯讀與三態守恆

v4 status／results API MUST 只讀 repo 外本機底稿與 immutable snapshot，並以固定 schema 驗證 mode、糾結寬度、日數、背離來源、方向、zero-reset、排序、cursor 及頁大小。每個啟用分支 MUST 產生 pass、fail 或 unknown，外層沿用既有 `all`／`any` 真值表；計數 MUST 滿足 `matched + notMatched + unknown = total`。hosted target MUST 不啟用本機路由，惡意參數 MUST 有界拒絕且不得轉送外網或 Shioaji。

#### Scenario: 非法糾結門檻

- **WHEN** request 提供超界、非有限、多餘小數位或未知均線模式
- **THEN** API MUST 回固定 validation error，不查詢 provider、不執行 DDL、不派送背景工作也不回內部 stack

#### Scenario: any 模式含 pass 與 unknown

- **WHEN** 任一啟用新技術分支 pass，另一啟用分支 unknown
- **THEN** row MUST 為 matched，逐分支 unknown reason 與全市場缺漏計數仍須保留

### Requirement: v4 正式驗收必須證明來源、公式與無副作用

驗收 MUST 保存非敏感 universe／source／formula／criteria 版本、實際 130-session 範圍、每市場 target 與處理數、matched／notMatched／unknown、逐條件缺漏、結果 hash、代表性公式重算及 UI／console 結果。只有 fixtures、HTTP 200、單一商品或全域完成時間 MUST NOT 代替全市場 evidence。測試 MUST 證明自選清單只在使用者按「加入清單」時變更，TDCC 佇列、交易路由、simulation runtime 與既有行情連線不被篩選改寫。

#### Scenario: 未加入清單且非排行前百名案例

- **WHEN** 一檔全市場普通股符合均線或背離條件但不在個人清單及排行前百名
- **THEN** 該檔 MUST 出現在完整 API 結果並可由 UI 點選至指定 K 線，且沒有未解釋來源缺口或交易副作用
