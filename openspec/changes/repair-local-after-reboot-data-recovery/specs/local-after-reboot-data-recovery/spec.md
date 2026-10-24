## ADDED Requirements

### Requirement: 安全且可定位的背景失敗診斷

系統 SHALL 區分 TDCC 控制端／目標同步／來源取得階段，保留安全錯誤代碼、HTTP status 與進度；不得記錄機密或以泛化錯誤冒充確證根因。

#### Scenario: 本機目標同步失敗
- **WHEN** 本機目標同步拋出例外
- **THEN** 回報同步階段及去敏感化代碼，保留原本 fail-closed 行為

#### Scenario: 控制端收到任意例外內容
- **WHEN** TDCC runner 或控制端取得非預期例外欄位
- **THEN** 僅保留固定 allowlist 的 stage、symbol、category 與合法 status，不輸出原始例外、headers 或敏感內容

### Requirement: 舊 pending 不阻斷已驗證來源重用

系統 SHALL 保留 pending 的原 review、attempts、冷卻與原因；可獨立遍歷其他 complete cache，但原 review／receipt／payload 或取得時點契約驗證不通過時不得重用或下載。

#### Scenario: review 換版且單日 pending
- **WHEN** pending cache 綁舊 review 而最新 review 已更新
- **THEN** 該日保持 pending，其他已驗證 complete cache 可繼續純重用，不修改原列或將缺日補成完整

### Requirement: 稽核完成與資料完整分開

系統 SHALL 將遍歷完成但商品 unknown/partial 的結果標示為未驗證，保留 counts 及逐商品原因，不將其回報成服務未啟動。

#### Scenario: 68 檔僅 2 檔驗證完成
- **WHEN** 稽核遍歷完成而 complete=2、target=68
- **THEN** 回報 continuity_unverified 及既有計數，不能宣稱完整

### Requirement: 事後純重用與額度驗證保持原證據

系統 SHALL 將事後純重用明示為 manual 並保留原 SLA overdue；來源計數回退且無有效保守銜接證據時拒絕 admission，不以重啟清帳。單日授權不能擴大成其他日期下載或解除 source_blocked。

#### Scenario: 同一額度身分的來源用量降低
- **WHEN** 來源用量小於已保存的高水位且缺少合法重設證據或完整的同帳戶保守銜接證據
- **THEN** 回報 broker_daily_usage_nonmonotonic 並拒絕來源請求，保留原帳本及 pending 身分

#### Scenario: 只有上市官方休市公告
- **WHEN** 已驗證公告僅證明 TWSE 全日休市
- **THEN** 僅排除上市該日，不據以推定上櫃休市

### Requirement: 盤後恢復使用共同目標與獨立週來源

系統 SHALL 以已驗證日曆決定本機籌碼目標，保留使用者休市設定。全市場 TDCC bulk SHALL 在原 lease、冷卻、完整來源驗證下獨立恢復；不得被無關歷史表單 blocked 或新一天尚未盤後遮蔽。

#### Scenario: 星期五休市後於週六恢復
- **WHEN** 日曆證明週五休市且上個交易日為週四
- **THEN** discovery、預熱及 health 都以週四為目標；週底稿僅接受官方實際揭露日期

#### Scenario: 本機日曆憑證缺失
- **WHEN** 本機預熱無有效簽章日曆憑證
- **THEN** 發送來源請求前阻擋，不退回星期推算

#### Scenario: 已驗證目錄重用
- **WHEN** 完整原目錄仍在效期內且來源雜湊、revision 與 SQL identity 一致
- **THEN** 可沿原目錄收據獨立收集公開 TDCC bulk，保留無關 blocked；目錄缺件或損壞即阻擋獨立模式

#### Scenario: 官方週來源實際揭露週四
- **WHEN** 新整批官方來源揭露的有效資料日為週四，且日期與原收據驗證通過
- **THEN** 週資料使用該實際日期並保留歷史來源原時間與雜湊，不推測週五、不刷新舊證據時間，亦不因發布而新增日報請求

#### Scenario: 借券當日無成交
- **WHEN** 官方整批資料確認目標日無該商品成交
- **THEN** 保留真實歷史成交與當日無成交證據，不補零、不將不足的歷史冒充完整

### Requirement: 休市日舊等待不可遮蔽已驗證的前一交易日

本機讀取端 SHALL 使用 request 專屬已驗簽日曆及雙市場整批來源收據決定是否忽略舊休市日等待；不得跨 request 共用可變決策，不得修改舊收據、推定未知日期休市或將缺件商品改成 ready。

#### Scenario: 舊等待 10/23、實際目標 10/22
- **WHEN** 當次有效日曆證明 10/23 雙市場休市、snapshot 對齊 10/22 且雙市場整批收據完整
- **THEN** 讀取端顯示 10/22 的有效資料與實際 partial 狀態，保留原 10/23 等待收據

### Requirement: 單日待補保持一次來源上限

系統 SHALL 以持久、具雜湊的明確單日授權限縮來源嘗試，仍遵守既有 simulation、review chain、來源租約、冷卻與集中額度 Gate。來源請求未通過 Gate 時 SHALL 保持零次嘗試；送出一次後即使失敗也不得自動擴大重試。

#### Scenario: 額度未連續而尚未送出
- **WHEN** review 接續合法但 admission 回報 broker_daily_usage_nonmonotonic
- **THEN** 保持 pending、attempts=0、sourceRequests=0，不改配額或用量帳本

#### Scenario: 單次來源失敗
- **WHEN** 單日授權的一次來源請求已送出且失敗
- **THEN** 保留失敗收據與 attempts=1，後續回報 source_single_request_exhausted，不繼續原十八次上限

### Requirement: 重開機用量保守銜接不釋放額度

系統 SHALL 分開保存原始用量與單調的保守扣帳。只有既有 simulation／健康／業務連線、安全讀取的穩定 generation、相同帳戶 HMAC、相同上限、正式額度身分與完整舊觀察收據均成立，才可在跨程序時沿原 quota epoch 保留前段全額並加入新段全額；不得據以宣稱券商重設、變更額度政策、退款或釋放任何舊 charged／quarantined／reserved。相同程序只加原始計數增量，回退即阻擋。狀態及收據 SHALL 以 CAS 與同一 transaction 寫入。

#### Scenario: 同一額度身分跨程序回退
- **WHEN** 舊保守用量 100、新程序原始用量 10，且同帳戶原始收據完整、上限與身分皆一致
- **THEN** 保守用量為 110，後續該程序回報 15 時為 115；正常消費者自動接續，不需重啟或修改原額度身分

#### Scenario: 缺件、同程序回退或重播
- **WHEN** 舊帳戶收據缺失、計數在同程序內下降、已退役 generation 被重播、帳戶／上限改變或狀態雜湊破損
- **THEN** 拒絕入帳及 admission，不更新高水位或增加來源嘗試

#### Scenario: 銜接後保護額度不足
- **WHEN** 加計原用量、新段用量、全部當期未釋放預留與既有工作承諾後不足
- **THEN** 原集中額度 Gate 仍拒絕請求，不調降保護額或清除舊預留
