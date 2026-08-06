## MODIFIED Requirements

### Requirement: 合法且可追溯的免費資料來源

系統 MUST 優先使用允許自動介接的 TWSE／TPEx／TDCC OpenAPI、政府開放資料或具明確 API 規範的免費歷史來源，並 MUST 為每個資料族群保留 provider、dataset、資料日期及來源更新時間；必要功能 MUST NOT 依賴付費會員資料。經使用者明確啟用的背景 operator workflow MAY 以低速 session 操作 TDCC 公開頁面的原生 GET／POST 表單欄位，但 MUST 遵守當時使用規範、不得規避 CAPTCHA／封鎖，且正式 Worker／前端 MUST NOT 內嵌歷史 HTML parser、cookie／token session 或使用未驗證隱藏 API。

#### Scenario: 使用官方 OpenAPI
- **WHEN** TWSE 或 TPEx OpenAPI 提供目標普通股／ETF 與資料族群
- **THEN** adapter MUST 依官方欄位名稱解析並保存官方 provider metadata
- **AND** 不得以欄位固定位置猜測未知格式

#### Scenario: 使用免費歷史 API
- **WHEN** 官方 OpenAPI 只提供最新快照或不便依證券回補歷史
- **THEN** 系統 MAY 使用具明確 API 規範的免費歷史來源依 symbol 與日期範圍回補
- **AND** response MUST 清楚標示該 provider，不得誤稱為交易所直接回應

#### Scenario: 一般網頁禁止自動擷取
- **WHEN** 某資料只出現在明確限制自動擷取的一般網頁報表
- **THEN** 正式資料鏈與背景 operator workflow MUST NOT 以模擬瀏覽器、爬蟲或規避限制方式抓取
- **AND** 該歷史工作 MUST 標示 `history_automation_not_permitted` 或 unavailable，保留最新合法 OpenAPI 累積資料

#### Scenario: 使用 TDCC 受保護背景 operator workflow
- **WHEN** 使用者已明確啟用背景回補，且 TDCC 公開歷史查詢頁當時規範未禁止該低速操作
- **THEN** GitHub runner MAY 以單一併發、固定間隔、同一 cookie／synchronizer token session 及頁面原生表單取得 queue 指定 symbol／日期
- **AND** MUST 在 CAPTCHA、封鎖、候選不一致或格式漂移時停止，不得規避

#### Scenario: 取得 TDCC 最新全市場週快照
- **WHEN** 受保護同步工作呼叫 TDCC `GET /v1/opendata/1-5` 或同資料集官方 CSV
- **THEN** 系統 MUST 將其標示為 TDCC `shareholder-distribution` 來源
- **AND** MUST 驗證全檔資料日期、證券代號、分級唯一性、有限數值與合計後才寫入 D1

#### Scenario: 使用 TDCC 官方歷史匯出
- **WHEN** TDCC 提供可直接取得、免費且允許自動介接的歷史匯出或檔案
- **THEN** history adapter MUST 保存官方資料日期、下載時間及來源識別，並沿用最新快照的嚴格驗證
- **AND** 若 URL、格式或授權無法確認，正式 network adapter MUST fail closed

### Requirement: 免費股權分散歷史覆蓋

系統 MUST 在免費官方來源允許的範圍內，以背景排程持續保存普通股與 ETF 的 TDCC 股權分散週資料；任何新加入網站且符合 eligibility 的台股 symbol MUST 自動建立 coverage、回補官方免費歷史並持續保存後續新週。系統 MUST 清楚回報 D1 實際保存起訖與 gap，且 MUST NOT 虛構、forward-fill、插值或規避來源限制取得較早週資料。

#### Scenario: 無流量仍保存最新週資料
- **WHEN** 正式站沒有圖表請求但 TDCC 已發布新的合法週快照
- **THEN** 背景排程 MUST 取得、驗證並冪等保存目前目標集合 rows
- **AND** opportunistic refresh MUST 只作為補充，不得是唯一更新機制

#### Scenario: 新加入普通股或 ETF
- **WHEN** 商品目錄或使用者清單首次加入尚無完整 coverage 的合格台股 symbol
- **THEN** 系統 MUST 在下一個排程週期自動建立歷史回補工作
- **AND** 完成後 MUST 持續納入未來最新週 snapshot

#### Scenario: 回補官方可用的一年週歷史
- **WHEN** 背景 discovery 發現 D1 缺少 TDCC 官方免費保存範圍內的週資料
- **THEN** 系統 MUST 依官方實際資料日期分批取得、驗證並冪等寫入普通股與 ETF rows
- **AND** 本機／背景 targeted batch MUST 只處理明確 queue symbol，正式全市場歷史來源則 MUST 共用同一資料日期輸入

#### Scenario: D1 只有部分累積資料
- **WHEN** 使用者查詢早於 D1 最早合法保存日期或官方免費歷史範圍的資料
- **THEN** coverage MUST 回傳實際可用起日、missing weeks 與逐 symbol queue／blocked 狀態
- **AND** 副圖 MUST 只顯示真實可用的週資料

#### Scenario: 歷史來源暫時不可用
- **WHEN** history runner 逾時、格式驗證失敗、來源封鎖或使用規範不允許背景操作
- **THEN** 系統 MUST 保留 D1 已累積與最新 OpenAPI 快照
- **AND** MUST 回傳安全 warning 且不得刪除既有週資料或規避來源限制

#### Scenario: 匯入相同資料日期
- **WHEN** 排程或人工重試再次取得已成功保存的官方週資料
- **THEN** D1 upsert MUST 維持 `symbol + dataDate` 唯一且不得產生重複 rows
- **AND** coverage 與來源狀態 MUST 反映最近一次成功驗證時間
