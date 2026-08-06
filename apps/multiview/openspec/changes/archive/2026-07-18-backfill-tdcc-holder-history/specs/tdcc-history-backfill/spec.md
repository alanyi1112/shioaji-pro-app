## ADDED Requirements

### Requirement: TDCC 週歷史來源驗證與安全降級

正式 Worker MUST 只從 TDCC 官方、免費且已確認允許 server-to-server 介接的歷史匯出取得股權分散週歷史；若 URL、格式、允許範圍或回應契約無法確認，network adapter MUST fail closed。經使用者明確授權後，系統 MAY 提供僅於本機執行的低速 operator runner 操作官方公開歷史表單，且取得資料仍 MUST 經受保護 ingest 與相同驗證器寫入。

#### Scenario: 官方歷史匯出契約已確認
- **WHEN** 官方歷史匯出可依資料日期取得全市場檔案，且來源、格式與允許自動介接範圍已有可追溯證據
- **THEN** history adapter MUST 只請求官方列出的實際 `dataDate`
- **AND** MUST 保存 provider、dataset、資料日期、下載時間與來源識別

#### Scenario: 只有一般歷史查詢頁
- **WHEN** 系統只能確認一般 HTML 查詢頁，無法確認其隱藏 request 或匯出 URL 可供自動介接
- **THEN** network adapter MUST 回傳 `history_source_unverified` 或同等安全狀態
- **AND** 正式 Worker、前端與公開 API MUST NOT 使用瀏覽器模擬、爬蟲或規避限制方式取得資料

#### Scenario: 使用者選擇本機低速回補
- **WHEN** 使用者明確選擇本機逐檔、逐週免費回補 fallback
- **THEN** operator runner MUST 以單一併發、固定間隔、官方日期及最新官方 OpenAPI 驗證過的明確目標 symbol 清單操作可見表單
- **AND** autocomplete 有候選時 MUST 只接受完整代號唯一匹配；6 碼證券無候選而直接送出時，回傳頁代號 MUST 完全相同
- **AND** MUST 在 CAPTCHA、封鎖、候選不一致、格式漂移或重試超限時停止，不得規避限制
- **AND** 同一日期成功取得的 rows MUST 合併後透過受保護 endpoint 匯入，secret MUST 只由執行環境提供

#### Scenario: 匯入管理者下載的官方檔案
- **WHEN** 授權管理者透過受保護 endpoint 提交 TDCC 官方歷史完整檔案
- **THEN** 系統 MUST 驗證檔案來源宣告、資料日期、schema、分級、唯一性、有限數值、合計與合理筆數後才可寫入 D1
- **AND** 驗證失敗 MUST 拒絕整個輸入，不得部分寫入

### Requirement: 可恢復的全市場週批次回補

系統 MUST 以官方實際 `dataDate` 為回補單位；正式來源對每週全市場輸入只取得及驗證一次，本機 fallback 對每週明確目標集合產生一份合併輸入，並以有限週數、有限 rows、單一併發、退讓重試與 checkpoint 分批寫入 D1；公開圖表 API MUST NOT 同步執行整段歷史回補。

#### Scenario: 啟動一年免費範圍回補
- **WHEN** 受保護工作收到合法的官方免費歷史日期範圍
- **THEN** 系統 MUST 建立具有預期日期清單、預期週數、目前 checkpoint 與狀態的 backfill job
- **AND** MUST 依日期由舊至新或其他固定順序分批處理普通股與 ETF rows

#### Scenario: 相同週含多個證券
- **WHEN** 同一個官方歷史檔案或本機 targeted batch 包含多個普通股與 ETF
- **THEN** 所有 symbol MUST 共用該週同一份已驗證寫入批次
- **AND** MUST NOT 對每個 symbol 重複下載相同資料日期

#### Scenario: 工作中途逾時或部署中斷
- **WHEN** 某批次尚未完成即逾時、發生暫時錯誤或 Worker 被中止
- **THEN** 系統 MUST 保留已成功週與最後 checkpoint
- **AND** 後續重試 MUST 從未完成批次續跑，不得刪除或複製已成功資料

#### Scenario: 重跑已完成週
- **WHEN** 工作再次處理已存在且驗證成功的 `symbol + dataDate`
- **THEN** D1 upsert MUST 維持唯一且不增加重複 row
- **AND** coverage distinct week count MUST NOT 因重跑而增加

#### Scenario: 上游回傳 429 或暫時失敗
- **WHEN** 自動 adapter 遇到 rate limit、timeout 或暫時性 5xx
- **THEN** 工作 MUST 依上限進行退讓重試並保存可重試狀態
- **AND** 圖表 API MUST 繼續回傳 D1 已保存資料，不得等待該重試完成

### Requirement: 回補作業可觀測性與安全操作

系統 MUST 讓受保護作業與健康檢查回報回補狀態、目標起訖、預期週數、已成功週數、失敗週數、目前 checkpoint、D1 實際 coverage、最後成功時間及 allowlist 錯誤碼；只有 job state 為 running 時才可宣稱正在回補。

#### Scenario: 回補正在執行
- **WHEN** backfill job 已啟動且仍有未處理週
- **THEN** 安全狀態 MUST 回傳 `running`、`completedWeeks`、`expectedWeeks` 與最近 checkpoint
- **AND** MUST NOT 回傳 ingest secret、Sites bypass token、完整上游 body 或內部受保護 URL

#### Scenario: 只有一期且沒有工作
- **WHEN** D1 只有一個 distinct `dataDate` 且沒有 queued 或 running job
- **THEN** 狀態 MUST 明確回傳歷史不足且非回補中
- **AND** MUST NOT 以「累積中」暗示背景下載正在執行

#### Scenario: 回補部分失敗
- **WHEN** 一個或多個資料週驗證失敗且其他週已成功
- **THEN** job MUST 回傳 `partial` 或同等狀態、成功／失敗週數與安全錯誤碼
- **AND** D1 已成功資料 MUST 保持可查詢

#### Scenario: 回補完成
- **WHEN** 所有目標 `dataDate` 都已成功驗證並寫入
- **THEN** job MUST 標示 completed 並保存完成時間
- **AND** coverage MUST 以 D1 distinct dates 重新計算，不得只相信 job 計數

### Requirement: TDCC 資料週期不得日頻化

系統 MUST 將股權分散資料標示為週資料，資料日期 MUST 使用 TDCC 發布的當週最後營業日；系統 MUST NOT 產生、forward-fill、插值或推算非發布日的大戶／散戶持股數值。

#### Scenario: 一週只有一個官方資料日期
- **WHEN** K 線範圍包含該週多個交易日但 TDCC 只發布一個 `dataDate`
- **THEN** 系統 MUST 只在該 `dataDate` 回傳與繪製股權分散值
- **AND** 其他交易日 MUST 保持缺值

#### Scenario: 假日改變當週最後營業日
- **WHEN** 當週最後營業日不是星期五
- **THEN** 系統 MUST 使用 TDCC 官方實際資料日期
- **AND** MUST NOT 自行移到星期五或下一個交易日
