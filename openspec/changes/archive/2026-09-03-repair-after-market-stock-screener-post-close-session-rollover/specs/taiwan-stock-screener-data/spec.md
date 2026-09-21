## MODIFIED Requirements

### Requirement: 日資料必須固定為已完成且正式公布的相鄰交易日

需要日量條件的查詢快照 MUST 固定日比較 D／P，並保存官方日曆版本、預期交易日、實際已公布日與唯一 `effectiveSessionDate`。在 `Asia/Taipei` 的官方共同交易日 14:00 前，預期交易日 MUST 是最近已完成交易日；14:00 起，預期交易日 MUST 推進為今日，但實際有效 D 只有在 TWSE／TPEx 今日正式日報的日期、schema、完整性與母體覆蓋均驗證通過後才能推進。D MUST 是可驗證、已完成且 TWSE／TPEx 兩市場同錨點的最新正式日資料，P MUST 是適用的前一官方交易日；MUST NOT 使用瀏覽器日曆昨日、盤中累計量、估量、任一批次來源單邊較新日期或最近兩筆任意跳期資料。每筆 volume evidence MUST 同時提供 P／D 日期，且成交值日期 MUST 等於 D。

當收盤後預期日尚未成為雙市場共同有效日，maintenance MUST 保存 `expectedSessionDate`、最後共同 `effectiveSessionDate`、逐市場發布狀態與下次允許探測時間。GET 查詢 MUST 只讀這些既有證據，不得因查詢或瀏覽器時間觸發 provider 抓取。探測 MUST single-flight、有界並遵守至少 20 分鐘 cooldown、每日上限及官方 `Retry-After`；固定 18:00 MUST NOT 作為允許收集當日資料的必要條件。

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

#### Scenario: 收盤前不得把今日當成完成日

- **WHEN** 官方共同交易日的台北時間尚未到 14:00
- **THEN** maintenance MUST 不探測或收集今日正式日報，expected／effective MUST 維持最近已完成共同交易日
- **AND** 盤中累計量、Snapshot 或部分報表 MUST NOT 建立今日 receipt 或快照

#### Scenario: 收盤後兩市場報表均已發布

- **WHEN** 官方共同交易日 14:00 起，TWSE 與 TPEx 都回傳今日日期且通過 schema、完整性、母體覆蓋及來源驗證
- **THEN** 系統 MUST 建立兩市場今日完整 receipt，原子發布 D=今日、P=前一官方交易日的新快照
- **AND** MUST NOT 因台北時間尚未到 18:00 而維持前一份 D／P

#### Scenario: 收盤後報表尚未齊備

- **WHEN** 14:00 起任一市場仍回舊日期、查無今日資料或尚未通過完整性驗證
- **THEN** 系統 MUST 保存 expected=今日、effective=最後共同有效日及逐市場等待原因，且不得發布 mixed-session snapshot
- **AND** 下一次外部探測 MUST 遵守至少 20 分鐘 cooldown、single-flight、每日上限與更長的官方 `Retry-After`

#### Scenario: 同日成功後重複喚醒

- **WHEN** 今日雙市場共同快照已發布，而既有 runtime 在同一候選日再次喚醒選股 pipeline
- **THEN** operator MUST 以既有 receipt／checkpoint noop，不重抓已完成日報、不重建等價快照也不觸發 Shioaji 或交易服務
