## ADDED Requirements

### Requirement: 免費來源必須分離歷史 seed 與官方最新快照職責

系統 MUST 以不需付費資料訂閱的來源完成本益比河流圖資料管線。五年歷史 seed MUST 使用 FinMind `TaiwanStockPER` 與 `TaiwanStockPrice`；最新資料與來源核對 MUST 使用政府資料開放平臺所列的 TWSE／TPEx OpenAPI。系統 MUST NOT 自動抓取 TWSE／TPEx 一般歷史查詢網頁，也不得以付費資料產品作為必要依賴。

#### Scenario: 上市普通股使用免費來源組合
- **WHEN** 系統為合資格 `.TW` 普通股建立五年河流 coverage
- **THEN** 歷史區間 MUST 由 FinMind 免費 API seed，最新官方日期 MUST 由 TWSE OpenAPI 核對或補入
- **AND** 系統 MUST NOT 呼叫 TWSE 一般歷史網頁進行自動化下載

#### Scenario: 上櫃普通股使用免費來源組合
- **WHEN** 系統為合資格 `.TWO` 普通股建立五年河流 coverage
- **THEN** 歷史區間 MUST 由 FinMind 免費 API seed，最新官方日期 MUST 由 TPEx OpenAPI 核對或補入
- **AND** 上市與上櫃資料 MUST 依 exchange 與 canonical symbol 隔離

#### Scenario: 免費來源暫時不可用
- **WHEN** FinMind 或政府 OpenAPI 暫時中斷、限流或回傳無法驗證的 schema
- **THEN** 系統 MUST 保留既有 D1 coverage 並回傳安全狀態
- **AND** MUST NOT 自動切換成未授權 scraping、付費來源或不明第三方資料

### Requirement: FinMind 五年 seed 必須以同日 P/E 與收盤價配對

系統 MUST 以相同 `data_id`、相同 `sessionDate` 的 FinMind `TaiwanStockPER.PER` 與 `TaiwanStockPrice.close` 建立歷史 seed。只有有限正數 P/E 與有限正數收盤價才能計算 `referenceEps = close / PER`；資料日期、商品或市場無法配對時 MUST 保留 gap。FinMind 沒有提供的財報年／季 MUST 保留 `null` 或安全的 unavailable 狀態，不得推測或補造。

#### Scenario: 單次範圍取得五年歷史
- **WHEN** 合資格商品尚無足夠歷史 coverage
- **THEN** runner MUST 以 bounded 日期範圍要求最近五年的 `TaiwanStockPER` 與 `TaiwanStockPrice`
- **AND** MUST 依交易日 join 後分批寫入 D1，不得把兩個資料集的列序直接視為同日

#### Scenario: 有效同日資料建立參考 EPS
- **WHEN** 同商品同交易日的 FinMind P/E 為 20 且收盤價為 200
- **THEN** 該日 `referenceEps` MUST 為 10
- **AND** row MUST 保存 provider、原資料提供機關、session date、P/E、收盤價與 fetched timestamp

#### Scenario: FinMind 欄位缺值或日期不一致
- **WHEN** P/E 為空、零、負數、非有限值，或同日收盤價不存在
- **THEN** 該交易日 MUST NOT 產生參考 EPS
- **AND** missing／invalid row MUST NOT 納入五年 percentile 樣本或 actual valid coverage

#### Scenario: FinMind 沒有財報年季
- **WHEN** 歷史 seed row 沒有 `fiscalYearQuarter`
- **THEN** 系統 MUST 明確保存為 unavailable／`null`
- **AND** MUST NOT 根據日期、P/E 變動或後來財報自行猜測歷史財報年／季

### Requirement: 官方 OpenAPI 必須補足最新交易日並核對歷史 seed

系統 MUST 使用 TWSE `BWIBBU_d` 與 TPEx `tpex_mainboard_peratio_analysis` 或其經官方公告的後繼 OpenAPI 取得免費最新快照。官方 row MUST 優先於同日 FinMind row，並 MUST 對最近可重疊交易日的 P/E 與收盤資料執行正規化核對；官方來源尚未發布時不得把 requested date 寫成 source coverage。

#### Scenario: 官方與 FinMind 最近重疊日一致
- **WHEN** 官方 OpenAPI 與 FinMind 對相同商品、相同交易日的正規化 P/E／收盤價一致
- **THEN** 系統 MUST 將該 provider pair 標示為 verified overlap
- **AND** 官方 row MUST 可補上官方才提供的財報年／季與來源 metadata

#### Scenario: 官方快照比 FinMind 新
- **WHEN** 官方 OpenAPI 已發布 D1 尚未保存的新交易日
- **THEN** 背景更新 MUST 以官方 row 冪等寫入 D1 並推進 actual coverage
- **AND** 下一次河流 API MUST 使用包含該最新交易日的資料重新計算 response

#### Scenario: FinMind 比官方快照新
- **WHEN** FinMind 已有較新日期但官方 OpenAPI 尚未發布或仍停在前一交易日
- **THEN** 系統 MUST 保留 FinMind row 與實際 provider date，但 MUST NOT 宣稱該日已完成官方核對
- **AND** job MUST 保存 `official_not_published` 或等價安全狀態，待後續排程再核對

#### Scenario: 最近重疊日不一致
- **WHEN** 官方與 FinMind 的同商品同交易日數值超出允許的顯示精度誤差
- **THEN** 系統 MUST 保存 `source_mismatch` 並停止將未核對資料推進為 verified coverage
- **AND** MUST 保留先前已驗證資料、隔離問題商品且不得把原始 response body 暴露給前端或 log

### Requirement: 五年缺口與最新資料必須由耐久背景工作補齊

系統 MUST 提供不依賴 chart panel 流量的耐久背景流程，從 D1 actual coverage 規劃五年缺口與最新交易日更新。工作 MUST 保存 durable job、checkpoint、lease、attempt、last success、next retry 與安全 reason code，並可在 Worker、workflow 或程序中斷後從未完成 checkpoint 續跑。

#### Scenario: 首次使用建立五年回補工作
- **WHEN** 合資格商品 D1 沒有至少 252 筆有效估值資料或五年 coverage 有缺口
- **THEN** API MUST 立即回傳目前 coverage 並建立或重用單一背景 job
- **AND** panel request MUST NOT 同步等待完整五年下載與 D1 寫入才回應

#### Scenario: 沒有使用者開啟圖表仍補最新資料
- **WHEN** 已追蹤商品進入新的台灣交易日且官方資料已發布
- **THEN** 排程工作 MUST 主動取得並保存最新官方 P/E／收盤資料
- **AND** 更新 MUST NOT 依賴任何 panel request、browser session 或使用者登入中狀態

#### Scenario: 工作中斷後續跑
- **WHEN** workflow、Worker 或 ingest 在部分月份完成後中斷
- **THEN** 下一次 runner MUST 從未完成 checkpoint 繼續
- **AND** completed checkpoint 與既有有效 row MUST NOT 被重抓、刪除或降級

#### Scenario: 每日最新資料暫未發布
- **WHEN** 排程執行時 TWSE／TPEx 尚未發布當日資料
- **THEN** job MUST 保存實際 source date 與 bounded next retry
- **AND** MUST NOT 以日曆日期、K 線日期或 requested end 偽造 coverage end

#### Scenario: 同商品多個觸發來源
- **WHEN** 首次勾選、每日排程與重複 panel request 同時要求相同商品
- **THEN** 系統 MUST 以 symbol job dedupe／single-flight 只保留一個有效 owner／lease
- **AND** 其他請求 MUST 共用同一進度，不得重複消耗免費 API 額度

### Requirement: 免費 API 額度必須受全域節流與有限重試保護

系統 MUST 在未付費、無帳號秘密的前提下遵守 FinMind 公開免費額度與來源回應限制。runner MUST 對每個商品合併日期範圍、限制每批 target 數、控制全域每小時 request budget，並對 402／429／retryable 5xx 採 bounded retry／retry-after。來源回傳的 retry 指示 MUST 優先於本地預設退避。

#### Scenario: 五年 seed 合併為有限請求
- **WHEN** 單一商品需要完整五年歷史
- **THEN** runner MUST 對 `TaiwanStockPER` 與 `TaiwanStockPrice` 各使用 bounded range request，而非逐日呼叫
- **AND** 同一 job retry MUST 重用已成功 dataset／checkpoint，不得每次重新下載全部資料

#### Scenario: 接近免費額度上限
- **WHEN** 全域 request budget 已接近設定的免費安全上限
- **THEN** runner MUST 停止 claim 新 target 並保存 `rate_limit_waiting` 與 next retry
- **AND** 既有 D1 河流資料與其他市場功能 MUST 繼續可用

#### Scenario: FinMind 回傳額度或暫時錯誤
- **WHEN** FinMind 回傳 402、429 或 retryable 5xx
- **THEN** 該商品 MUST 進入 bounded retry／retry-after，不得 busy loop
- **AND** error、health、response 與 log MUST 只包含 allowlist reason code，不得包含 token、cookie 或完整上游 body

### Requirement: D1 必須保存實際來源、驗證狀態與冪等 coverage

系統 MUST 以 exchange、canonical symbol、session date 為逐日 row 唯一鍵，並保存 provider、original source、validation status、official overlap date、source date 與 fetched timestamp。actual coverage MUST 只由已保存的有效 row 計算；FinMind seed、官方快照與 retry 重跑 MUST 使用冪等 upsert，且較低信任或較舊資料不得覆蓋較新官方 row。

#### Scenario: 重跑相同五年 seed
- **WHEN** 相同商品與日期範圍被再次攝取
- **THEN** D1 row 數量 MUST 維持穩定且不得產生重複交易日
- **AND** 已有官方 verified row MUST 優先於 FinMind historical seed row

#### Scenario: 部分資料成功
- **WHEN** 五年範圍只有部分月份通過驗證與寫入
- **THEN** coverage MUST 回傳實際最早／最晚有效日期、有效樣本數與 missing periods
- **AND** requested start／end MUST NOT 被保存為 actual coverage

#### Scenario: 新資料修正舊的 provider row
- **WHEN** 官方 OpenAPI 對相同交易日提供可驗證 row
- **THEN** 系統 MUST 依來源優先序更新該日 metadata 與 validation status
- **AND** MUST NOT 清除其他交易日或重置 job 的 completed checkpoint

### Requirement: 免費來源的授權、顯名與存取邊界必須可見且可驗證

系統 MUST 標示原資料提供機關、FinMind 作為歷史 API intermediary，以及政府資料開放授權條款第 1 版。FinMind 免費資料 MUST 只用於目前 private／custom、非商業且不提供原始資料再散布的河流圖服務；API 與 UI MUST 只揭示必要的單日 readout、衍生 percentile 與來源 metadata，不得提供五年原始 P/E／價格資料 dump 或建立等同 FinMind 的鏡像服務。

#### Scenario: 顯示上市資料來源
- **WHEN** 河流圖使用 FinMind seed 與 TWSE 官方最新快照
- **THEN** readout／說明 MUST 標示「原資料提供機關：臺灣證券交易所」與「歷史資料介接：FinMind」
- **AND** MUST 揭示政府資料開放授權或等價 attribution 連結

#### Scenario: 顯示上櫃資料來源
- **WHEN** 河流圖使用 FinMind seed 與 TPEx 官方最新快照
- **THEN** readout／說明 MUST 標示「原資料提供機關：證券櫃檯買賣中心」與「歷史資料介接：FinMind」
- **AND** MUST NOT 把 FinMind 描述成交易所或官方授權代理機構

#### Scenario: 嘗試取得五年原始資料
- **WHEN** 前端或未授權呼叫者要求逐日原始 P/E／收盤完整 dump
- **THEN** 公開 API MUST 拒絕或不提供該資料形態
- **AND** 只允許既有河流圖所需的衍生 points、倍率、coverage 與單日 readout

#### Scenario: Sites 存取模式不再是 private custom
- **WHEN** 正式站準備改為 public、workspace-wide 或商業用途
- **THEN** 發布流程 MUST 將 FinMind 免費歷史管線標示為需要重新授權審查
- **AND** 在取得相應許可前 MUST NOT 宣稱該免費來源可供公開或商業再利用

### Requirement: API 與 health 必須揭示背景回補及最新資料狀態

河流圖 API MUST 回傳安全的 `sources`、`coverage`、`warnings` 與 `backfill`，可區分 `historical_seed`、`official_verified`、`official_not_published`、`partial`、`rate_limit_waiting`、`source_mismatch`、`available` 與 `blocked`。health MUST 彙總 target、ready、pending、running、blocked、retry waiting、stale、最近成功時間與實際 source date，且不得洩漏原始上游錯誤或秘密。

#### Scenario: 五年回補完成且最新日已核對
- **WHEN** 商品至少有 252 筆有效資料且最新可得官方交易日已保存
- **THEN** API MUST 回傳 `available`、actual coverage、有效樣本數與 verified source date
- **AND** health MUST 將該商品計入 ready

#### Scenario: 歷史足夠但最新官方日待發布
- **WHEN** 五年樣本已足夠但最新官方快照尚未發布
- **THEN** 河流圖 MAY 使用既有 verified coverage 繼續顯示並附上 stale／pending warning
- **AND** health MUST 將最新更新工作列為 pending 或 retry waiting，不得誤報 blocked

#### Scenario: 來源核對失敗
- **WHEN** 商品被標記 `source_mismatch` 或 schema mismatch
- **THEN** API MUST 保留既有安全河流資料與可診斷 warning
- **AND** health MUST 只揭示 allowlist reason、實際日期與計數，不得輸出完整 payload

### Requirement: 免費資料管線必須維持既有河流圖計算與產品邊界

免費來源只得替換資料取得與背景維護方式，MUST NOT 改變既有交易所參考 EPS、最近五年 percentile、至少 252 筆有效樣本、普通股日 K 適用性、gap、不使用同業／產業本益比，以及不提供目標價或投資建議的規則。

#### Scenario: 免費 seed 完成後計算河流
- **WHEN** FinMind seed 與官方核對產生至少 252 筆有效每日參考 EPS／P/E
- **THEN** 系統 MUST 依既有算法計算固定 P10／P30／P50／P70／P90 與每日五條價格界線
- **AND** 縮放、visible range 或資料 provider MUST NOT 改變同一 response 的 multiplier

#### Scenario: 不適用商品出現在免費來源
- **WHEN** FinMind 回傳 ETF、ETN、TDR、指數、特別股或其他非普通股資料
- **THEN** 系統 MUST 仍依 canonical 商品 metadata 判為不適用
- **AND** MUST NOT 因免費來源有資料就繪製河流圖

#### Scenario: 使用者要求同業比較
- **WHEN** API 或 UI 組合免費來源資料
- **THEN** response、readout 與 overlay MUST NOT 新增同業平均、產業 P/E、forward P/E、合理價或目標價
