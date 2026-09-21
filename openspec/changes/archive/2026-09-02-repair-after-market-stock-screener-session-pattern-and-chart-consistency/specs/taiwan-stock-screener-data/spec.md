## MODIFIED Requirements

### Requirement: 日資料必須固定為已完成且正式公布的相鄰交易日

需要日量條件的查詢快照 MUST 固定日比較 D／P，並保存官方日曆版本、預期交易日、實際已公布日與唯一 `effectiveSessionDate`。D MUST 是可驗證、已完成且 TWSE／TPEx 兩市場同錨點的最新正式日資料，P MUST 是適用的前一官方交易日；MUST NOT 使用瀏覽器日曆昨日、盤中累計量、估量、任一批次來源單邊較新日期或最近兩筆任意跳期資料。每筆 volume evidence MUST 同時提供 P／D 日期，且成交值日期 MUST 等於 D。

#### Scenario: 週末、假日或臨時休市

- **WHEN** 查詢日期不是交易日，或前一天休市
- **THEN** 服務 MUST 依官方日曆使用正確 D／P；日曆衝突或未涵蓋時標示不可判定，不假定週一至週五均交易

#### Scenario: 其中一個市場尚未公布

- **WHEN** 上市與上櫃官方日資料日期不同，或只有一個市場已完成最新日報驗證
- **THEN** 系統 MUST 不將兩種 D 混成一份最新結果，而須保留明示日期的上一個共同快照並顯示等待新資料
- **AND** 上一個共同快照 MUST NOT 以當期「符合條件」結果提供點選或加入清單操作

#### Scenario: 個別商品缺少 D 或 P

- **WHEN** 母體商品沒有快照指定日期的合法成交量
- **THEN** 對該商品的日量條件 MUST 回 unknown 與缺漏日期，不向前跳到任意有值日期

#### Scenario: 1409 跨收盤日重新判定

- **WHEN** 1409 的 2026-08-31、2026-09-01、2026-09-02 官方成交量依序為 11,610,980、65,478,367、25,510,372 股，且 D 已推進至 2026-09-02
- **THEN** 系統 MUST 以 2026-09-01 → 2026-09-02 比較並判定未達三倍
- **AND** MUST NOT 繼續回傳以 2026-08-31 → 2026-09-01 算出的 5.6393 倍結果

### Requirement: 查詢快照必須固定條件版本與資料版本

每份結果 MUST 包含 `snapshotId`、名冊版本、公式版本、條件指紋、`effectiveSessionDate`、比較日期、計數、來源狀態及生成時間；同一 cursor MUST 綁定相同版本、條件與排序。底稿更新 MUST 在 staging 處理完整母體後原子發布新版本，保留較舊快照的真實日期；原始列缺失不可包裝成全資料 ready。任何跨日量、成交值或技術型態的 mixed-session snapshot MUST NOT 發布或成為最新查詢來源。

#### Scenario: 有效查詢跨越快照發布

- **WHEN** 使用者讀下一頁時已有較新快照
- **THEN** 服務 MUST 使用 cursor 原快照，或在原快照不存在時回 `snapshot_expired`，不靜默替換資料集合

#### Scenario: 只有部分來源就緒

- **WHEN** 已處理全母體但啟用條件仍有未發布／缺漏的來源資料
- **THEN** 回應 MUST 呈現 partial／pending 及逐條件缺口，不因 processed 等於 total 或 HTTP 200 宣稱所有資料完整

#### Scenario: 技術資料尚未追上當期 D

- **WHEN** 最新合法 v2 已使用 D，但最新 v3 的 `technicalAnchors.through` 仍早於 D
- **THEN** 純成交量／大戶查詢 MUST 使用最新合法 v2 projection，技術條件查詢 MUST 顯示當期 preparation pending
- **AND** 系統 MUST NOT 把舊 v3 rows 當成當期可操作結果，也不得發布日量 D 與技術日期不同的 v3
