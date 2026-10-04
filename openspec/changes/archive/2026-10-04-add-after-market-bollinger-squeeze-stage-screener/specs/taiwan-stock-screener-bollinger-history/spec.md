## ADDED Requirements

### Requirement: 已驗證臨時全日休市公告必須優先於年度預定開市表

布林歷史準備 MUST 在年度日曆之外驗證官方臨時全市場全日休市公告，涵蓋颱風或其他原因，不寫死特定日期。已確認一市場全日休市 MUST 排除兩市場共同交易日並重新計算所需交易日窗口；未確認來源、公告日期／範圍／撤銷、空行情及個股或部分時段停止 MUST NOT 推論全日休市。第一版 MUST 以已核實 TWSE 年度新聞契約為公告來源，MUST NOT 冒充 TPEx 證據或宣稱已涵蓋 TPEx-only 突發公告；必要資料缺口仍 pending。

公告 MUST 保存原始回應／hash／來源 URL／公告 ID 與日期、版本化有效日曆及重規劃收據；MUST NOT 改寫原年度表、已耗來源嘗試／原失敗收據或歷史快照。當年度公告每日台北日期有界刷新，舊年度至多使用 30 日快取；三年度最多三 HTTP／180 秒／6 MiB，每次最多 30 秒／2 MiB，不重試／跟轉址，冷卻至少 20 分鐘且 429 遵循 Retry-After 與至少一小時。並行 single-flight、租約保護、有效同日 zero-write MUST 成立；價量兩 HTTP／run、broker 額度及既有連線 MUST 不變。

#### Scenario: 年度表預定開市但官方臨時公告全日休市

- **WHEN** 已驗證官方公告確認某日期集中交易市場全日休市，而年度表列為預定開市
- **THEN** MUST 從共同交易日排除該日期、依法向前延伸保持所需交易日數，保留原失敗並只以既有有界 watcher 補新增實際交易日；不得再等待該休市日期的行情或以別日行情冒充

#### Scenario: 個別公司恢復交易或部分時段停止

- **WHEN** 公告指定公司代號、個別商品、盤後／下午／夜盤或僅為條件式防災規則
- **THEN** MUST NOT 排除整個市場交易日；不明日期、撤銷／恢復全市場語意 MUST 明示待確認，來源破損或無法取得仍 pending

#### Scenario: 新官方公告改變已發布快照的依賴窗口

- **WHEN** 更正後 historySessions 不同於已有成功鍵的快照
- **THEN** MUST NOT 以舊成功鍵休眠而宣稱新窗口完成，原快照與收據保留；混合來源以新窗口 mapping 處理，舊固定 mapping 明示需重新審查

### Requirement: 布林策略必須具備獨立且足夠的官方歷史能力

系統 MUST 建立 `bollinger-history-v1` capability、progress 與來源收據，不得直接把 v4／v7 130 日成功收據解讀為新能力 ready。預設 MUST 準備至少 160 個官方交易日，且依有效設定計算每個 setup 與指標暖機的最早依賴日期；預設 120 日基準、20 日 BOLL 與前 5 日 setup MUST 至少使用 145 日原始資料。參數所需日數大於已備齊日數 MUST 回 history_pending，不得靜默縮窗；可接受設定的歷史需求上限 MUST 為 400 日。

#### Scenario: 只有既有 130 日歷史

- **WHEN** v4／v7 已 ready 但布林新能力僅有 130 日
- **THEN** 新能力 MUST 顯示所需／已備日數及 history_pending，舊條件 MUST 保持原有可用狀態

#### Scenario: 增大回看參數

- **WHEN** 使用者明確儲存的每日設定需要超過 160 日
- **THEN** 背景 history plan MUST 在有界預算內擴窗並保存新設定 revision；完成前不得把舊窗口當作完整新設定結果

### Requirement: 流動性必須使用已驗證來源的實際成交金額

系統 MUST 在 TWSE／TPEx 指定日期官方日報或獨立驗證的 Shioaji `daily_quotes` 備援上，驗證實際成交金額欄位、單位、日期、商品母體、價格／交易範圍、使用範圍及來源限制後才啟用該 mapping。每筆 MUST 保存 provider、review／mapping version、actual date、exact URL、payload hash、market mapping version、fetchedAt 與 canonical TWD 整數金額。系統 MUST NOT 以 close*volume、盤中 Snapshot、估量或其他未驗證報價替代。既有有效 OHLCV 的金額缺漏 MUST 分類 missing_turnover，不得把其他能力已驗證資料覆蓋為失敗或補入零金額。

#### Scenario: 價量存在但成交金額缺漏

- **WHEN** 某商品 OHLCV 合法，但必要日期實際成交金額缺漏
- **THEN** 該金額濾網 MUST 為 unknown，既有 OHLCV MUST 保留；不得用收盤價乘量修補

#### Scenario: 上櫃來源金額單位與契約不符

- **WHEN** 實際 TPEx response 的成交金額欄位或單位未通過 mapping 驗證
- **THEN** 該來源 MUST 保持 pending／invalid 並保存原因，不得將未驗證數值標成 TWD ready

### Requirement: 歷史缺口必須依官方交易日逐商品分類

窗口 MUST 使用已驗證官方交易日 authority，且 MUST 分別記錄上市前、下市後、停牌／無成交、合法來源未公布、來源失敗與真正歷史缺日。empty_report、invalid_report_date、HTML 或網路錯誤 MUST NOT 作為休市充分證據。必要交易日無合法 OHLC 或量／金額時，系統 MUST 保存逐商品 unknown reason，MUST NOT 刪除交易日、用最近 N 筆替代或造 carry-forward K 棒。兩市場當日來源完整性與單一商品 readiness MUST 分開。

#### Scenario: 官方交易日但來源回空

- **WHEN** 官方 authority 確認交易日而某市場回 empty report
- **THEN** MUST 保留來源缺口與該交易日，不得因兩市場的錯誤組合自動改為休市

#### Scenario: 新上市股票歷史不足

- **WHEN** 商品上市日至 D 不足所需暖機／相對基準
- **THEN** 商品 MUST 保留在母體並列 indicator_warmup 或 history_pending，不得補造上市前資料

### Requirement: 歷史補建與清理必須有界且跨能力安全

準備器 MUST 以 market/date 批次、最新日優先、只補缺、single-flight／租約、checkpoint 與來源 cooldown 執行，MUST 保存每次預算／request／row／bytes／成功與失敗收據。來源已驗證的 OHLCV 可重用，金額缺漏須獨立補齊；MUST NOT 增加 broker login／逐檔 subscription。清理 MUST 保留所有有效能力、尚在準備計畫及保留快照需要的日期聯集，舊 v4 prune MUST NOT 刪除新能力需要的日期；回滾不得刪除其他能力仍引用資料。

#### Scenario: 補建中程序中止

- **WHEN** 首次全市場歷史準備達預算或程序中止
- **THEN** 後續 MUST 依 checkpoint 只續缺項，已驗證資料與原失敗收據不得重抓覆寫

#### Scenario: 原始日報包含大量非普通股

- **WHEN** 合法官方日報包含權證等非策略商品，原始列數超過普通股母體上限但未超過獨立回應上限
- **THEN** 系統 MUST 以獨立的原始回應列數與 bytes 上限驗證，保留日期／schema／唯一代碼檢查，依 verified 普通股母體投影；MUST NOT 截斷前一萬列、偷偷去重、將非普通股混入母體或放寬普通股 manifest 上限；超過原始回應上限 MUST 保留 invalid，不當作完整資料

#### Scenario: 官方入口在 HTTP 回應前重設連線

- **WHEN** 官方日報或日曆請求得到 `ECONNRESET`，尚未收到 HTTP response
- **THEN** 系統 MUST 分類為 `source_connection_reset`，在新失敗收據保存傳輸階段、白名單錯誤代碼、已收到 bytes、可確認的 TLS 驗證／協商資訊及空的 HTTP status；MUST 保留原失敗收據、遵循既有冷卻與有界重試，不得冒充 HTTP 403、休市或指定日期無資料，也不得以最新日 OpenAPI 替代任意歷史日期

#### Scenario: 舊清理與新窗口同時存在

- **WHEN** v4 要清理至 130 日而新策略需要 160 日或更長
- **THEN** 清理 MUST 採需求聯集並保護新窗口與快照依賴，v4 行為契約及既有資料不得因新能力被重解釋

### Requirement: 官方優先與 Shioaji 備援必須獨立驗證且保留來源真實性

系統 MUST 優先採用有效的官方日期日報；當其失敗、冷卻或 review 未成立時，MAY 採用獨立 verified 的 `daily_quotes`。provider 的 review、invalid、嘗試與失敗收據 MUST 分開，備援成功 MUST NOT 解除或覆寫原官方失敗。共同官方交易日 authority、已驗證普通股母體及相容價格基礎 MUST 成立；備援行情 MUST NOT 推論休市或補延過期日曆。每 market/date MUST 選完整且相容的 OHLCV／Amount 批次，不混不同來源欄位；不同日期可選不同 verified provider，但 MUST 保存不可變的 source-selection manifest、切換原因與版本 hash，納入 dataMappingVersion 隔離。

#### Scenario: TPEx 入口重設但備援有效

- **WHEN** 官方 TPEx 日期入口為 source_connection_reset 或 source_contract_pending，且 Shioaji review 及共同 Gate 成立
- **THEN** MUST 允許在有界預算內選用備援，不等待 TPEx 網站恢復；MUST 保留 TPEx 原因並標示實際 provider，而非聲稱官方入口已成功

#### Scenario: 行情有資料但日曆過期

- **WHEN** Shioaji 有請求日期的行情，但官方 authority 缺少或過期
- **THEN** MUST 保持 calendar pending，不依資料存在判定交易日或允許正式發布

#### Scenario: 官方恢復後數值與備援衝突

- **WHEN** 已凍結備援批次之後取得超過成交量容差、或其他必要欄位不相容的官方資料
- **THEN** MUST 追加來源核對及衝突 evidence，不自動覆寫凍結批次／head；正式更正 MUST 使用新的可稽核資料版本

### Requirement: 成交量來源比較必須允許有版本且可稽核的百分之一容差

同商品／日期／股數單位的來源比較 MUST 使用明確版本政策。原政策 `bollinger-source-comparison-volume-1pct-v1` 的金額完全相容規則 MUST 保留；明確選新政策 `bollinger-source-comparison-volume-1pct-turnover-1ntd-v2` 時，實際成交金額差 MUST 只允許絕對 ≤1 元。兩政策官方量非零時，`abs(備援量−官方量)*100 <= 官方量` MUST 為容差內通過，使用 BigInt 整數交叉乘法而非 rounding 後比例。官方量為零 MUST 只在雙方皆零時通過；MUST NOT 放寬 OHLC、日期、readiness、來源 review／schema／缺漏檢查。MUST 保存政策版本、原股數／金額、絕對差異及 exact／within_volume_tolerance／within_source_tolerance／conflict assessment；新政策 MUST NOT 覆寫或重解釋舊比較／收據時間、凍結列、manifest、快照及 head。策略計算 MUST 使用原凍結來源數值，MUST NOT 將來源容差套到策略門檻。

#### Scenario: 一股差異或剛好百分之一

- **WHEN** 官方量 33,342,359 與備援量 33,342,358，或官方量 100 與備援量 99／101，其餘必要欄位相容
- **THEN** MUST 新增容差內通過證據而非阻擋數值相容性；原值及差異保留，不將備援改成官方量

#### Scenario: 零量、超過百分之一或其他欄位不同

- **WHEN** 官方量 0 而備援非零、量差超過 1%，或金額差超過所選政策、價格／日期／readiness 不同或缺漏
- **THEN** MUST 保留 conflict／原來源失敗，不以成交量容差放行其他不相容情況

#### Scenario: 舊 strict 衝突與新政策並存

- **WHEN** 同一來源樣本已有 strict conflict，使用新容差政策再次比較
- **THEN** MUST 只追加帶新政策版本的比較，同鍵重跑 no-op；舊 conflict／createdAt 保留，原快照／head／cursor 不變

#### Scenario: 金額一元與兩元邊界

- **WHEN** 價格／日期／readiness 相同，金額差為正負 1 元或 2 元，呼叫端明確選新金額政策
- **THEN** MUST 一元通過、兩元 conflict，保存原金額與差異；舊 v1 的一元衝突仍保留，不讓策略門檻借用來源容差

#### Scenario: 四項價格缺漏但成交統計存在

- **WHEN** 新 v2 daily_quotes mapping 收到四項 OHLC 全 null、正量／金額／筆數
- **THEN** MUST 逐股 missing_ohlcv、保留原統計及其他有效列，不造價格或說無成交；舊 v1 規則、partial 收據與原始回應不覆寫，部分 null 或非法 OHLC 仍拒絕

### Requirement: 每日行情批次必須有界共享且驗證原始整數

備援 MUST 使用既有 simulation API／business session 的 `POST /api/v1/data/daily_quotes`，指定 date 與 exclude=true；MUST NOT 新增 login、subscription 或逐檔分鐘 K 備援。九個 column arrays MUST 等長、Date 全部符合請求日、Code 唯一且 OHLC 合法；原始 Volume／Amount／Transaction int64 MUST 無精度流失地解析。Volume MUST 依獨立驗證的股數 mapping，不沿用 KBars 張數規則或盲乘 1,000；Amount MUST 為實際成交金額。普通股及市場 MUST 由 verified universe／商品主檔判定，exclude=true MUST NOT 被解讀為已排除 ETF 等其他商品。

同日期兩市場 MUST 共用 single-flight／持久批次快取，只有一次成功 date-level fetch；request／usage／bytes 與市場投影收據 MUST 可相互引用。下載 MUST 經集中持續保留的可設定用量預算、行情保留額度及 broker 速率限制 admission，不以寫死的剩餘流量門檻啟動；程序中止後租約與 reservation MUST 可核對回收。每輪價量來源合計最多兩次 HTTP request／8 MiB，包含官方與備援；整輪最多 15 分鐘。預算不足 MUST 續存 progress 而非侵占盤中額度。

#### Scenario: 兩市場同時需要同一日期

- **WHEN** 上市與上櫃準備器同時選用同日期備援
- **THEN** MUST 共用同一請求及凍結 hash，不能各打一次 daily_quotes；回復後只續缺項，已持久化批次不重抓

#### Scenario: 工作承諾重新觀察但額度沒有修訂

- **WHEN** reserve 與 dispatch 之間僅更新來源觀察時間，額度、實測、來源證據、效期及 quota identity 都未改變
- **THEN** 系統 MUST 每次獨立驗證 freshness，但 MUST NOT 只因時間不同拒絕合法保留；條款 fingerprint MUST 只略去觀察時間，其餘政策仍綁定。舊 fingerprint 保留紀錄 MUST 不改寫，不能直接當作新政策的 dispatch 授權

#### Scenario: 已登錄工作承諾缺少或 quota identity 不一致

- **WHEN** 正式 v2 配置登錄的任一工作觀察缺席、未知、過期、payload hash 不符，或 scope／quota epoch／quota 證據不同
- **THEN** 唯讀 producer MUST 拒絕政策，不先查 Snapshot／usage，不把未知用量填零或重填觀察時間；usage 必須符合已綁定政策的 quota identity，查詢中途及 dispatch 前換版 MUST 保留未送 reservation 並拒絕歷史請求

#### Scenario: 原始整數超過安全 Number 範圍或欄位破損

- **WHEN** response 有大 int64、重複代碼、不同日期、arrays 長度不一致或非法 OHLC
- **THEN** MUST 無損解析大整數並依契約驗證，其餘破損批次保持 invalid；不得四捨五入、靜默略列或發布為完整資料

#### Scenario: 共用額度已被其他工作保留

- **WHEN** 實際可用額度扣除持續保留工作與行情額度後不足本批次預算
- **THEN** MUST 不發行情歷史請求，保存 admission 原因及續跑狀態，不另登入或改用無界分鐘下載

#### Scenario: 本機預算政策未齊、過期或在 admission 途中變更

- **WHEN** 政策／實測／工作承諾缺失或過期、估量超過設定上限，或 usage 查詢及 dispatch 前政策已換版
- **THEN** MUST 先驗本機政策，前置拒絕不送 Snapshot／usage；查詢後及 dispatch 前 MUST 重驗同一政策，換版或到期不發歷史請求、不覆寫原保留與收據，並依安全 settlement／回收流程處理未 dispatch 保留

### Requirement: 缺少來源額度週期時必須採持久保守帳本而非偽造重設

新 v3 本機政策 MAY 使用 `local-conservative-v1` 的不可變 CAS 錨點，MUST 明示不是 provider quota identity，且原始用量與保守累計分列。換日、API generation 改變或共享 counter 下降 MUST NOT 解除既有消耗／reservation；counter 下降後下一段正增量 MUST 繼續累加。原 scope／epoch 已耗保留、速率與 single-flight MUST 仍納入。limit 改變、身份破損、政策到期或觀察競爭 MUST fail closed，MUST NOT 自動清帳。舊 v1／v2 政策及證據 MUST 保留。

#### Scenario: API 用量計數下降後又增加

- **WHEN** 真實 counter 從 1,500 降到 10，之後增加到 110
- **THEN** 本機保守值 MUST 從 1,500 增至 1,600，已耗預留不變，不將下降當成來源確認的 quota reset

#### Scenario: 原背景工作尚未逐請求採中央 admission

- **WHEN** 新政策仍有未接線的互動／背景消費者
- **THEN** MUST 明示並持續扣住配置保護池，盤後基準另使用已驗證真實 budget 的完整 forecast／底額；不得虛填零、冒稱全工作接線完成或挪用保護額度。來源或配置破損 MUST 停止而非假稱已完成

#### Scenario: 使用者在政策到期前授權複核

- **WHEN** 使用者明確授權複核，原政策仍有效，原始實測／不可變錨點／真實 simulation 用量及最新基準保留均通過驗證，且無活躍 reservation、扣除舊債與保護池後仍足以容納一批
- **THEN** MAY 以 CAS 更新有限效期，MUST 保存原政策與新複核收據；新效期 MUST 不超過複核起七日或原實測三十日期限，不修改 quota identity、原用量、charged／quarantined、保護池、速率或來源授權。watcher MUST NOT 自行延長；證據失效、limit 改變、額度不足或競爭時 MUST 拒絕，不以人工換日期冒充排程成功
