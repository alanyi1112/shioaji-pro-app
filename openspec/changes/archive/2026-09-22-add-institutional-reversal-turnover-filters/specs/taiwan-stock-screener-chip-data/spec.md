## ADDED Requirements

### Requirement: 選股法人 canonical row 必須保存可驗證的外資買進賣出

每一個 `(sessionDate, symbol)` 選股法人 canonical row MUST 保存 `foreignBuyShares`、`foreignSellShares`、`foreignNetShares`、既有投信欄位、market、receipt 與 mapping version。三個外資數量 MUST 為 canonical integer shares，且只有 `buy - sell = net` 通過時才能成為已驗證資料；缺欄、非法格式或相等式不成立 MUST 保持 null 並產生明確 invalid reason。

#### Scenario: TWSE 外資組成完整

- **WHEN** TWSE T86 同一商品的一般外陸資與外資自營商買進、賣出及淨額各自通過驗證
- **THEN** canonical row MUST 保存兩組合計後的外資買進、賣出與淨額，且合計值仍須符合 `buy - sell = net`

#### Scenario: TPEx 歷史法人表完整

- **WHEN** TPEx 指定日期法人歷史表的 report date、表頭、群組位置及外資及陸資合計買進、賣出、淨額均通過驗證
- **THEN** canonical row MUST 保存對應外資三欄，不得維持目前的固定 null

#### Scenario: 官方表頭漂移

- **WHEN** TWSE 或 TPEx 外資必要欄位、群組或單位與已核對 schema 不一致
- **THEN** 該 market／date mapping MUST fail closed，receipt 不得標示新 mapping 已驗證，也不得只保存投信後宣稱外資 coverage 完成

### Requirement: 外資歷史回填必須重新驗證來源而非沿用舊 receipt 宣稱

新外資 mapping 所需的官方歷史日期 MUST 以有界、可續跑的逐市場逐交易日 targets 重新取得並驗證 report date、schema、payload hash、row coverage 與 mapping version。舊 receipt 或 hash MAY 用於確認 payload identity，但 MUST NOT 在沒有重新解析驗證時單獨證明外資欄位可用。

#### Scenario: 重新取得的 payload 與舊 hash 相同

- **WHEN** 新 mapping 重新取得的正式報表 payload hash 與既有 receipt 相同，且外資欄位通過新 schema 與公式驗證
- **THEN** 系統 MAY 連結既有 receipt identity，但 MUST 另存新 mapping verification evidence，不得改寫舊 normalization version 的歷史語意

#### Scenario: 歷史來源暫時無法取得

- **WHEN** 必要 market／date 因 provider unavailable、rate limit 或合法未發布而未完成新 mapping 驗證
- **THEN** backfill MUST 保存 checkpoint、remaining、reason 與安全 next eligible time，v6 publication MUST 維持 pending 且 v5 資料保持可用

### Requirement: 外資全市場 coverage 必須納入 v6 發布 gate

v6 readiness MUST 依 TWSE／TPEx、交易日及 institutional mapping version 回報 target、verified、missing、invalid、failed 與 last verified source date。需求驅動的圖表 cache、自選清單、單一商品資料或只有投信欄位的 row MUST NOT 代替全市場外資 coverage。

#### Scenario: 一個市場缺少外資驗證

- **WHEN** TWSE 的必要外資歷史已完成，但 TPEx 任一必要交易日仍缺新 mapping receipt
- **THEN** v6 snapshot MUST NOT 發布，readiness MUST 指出 TPEx 的日期與 reason，且不得只發布 TWSE 結果

#### Scenario: 官方報表沒有某商品 row

- **WHEN** market／date receipt 合法、完整處理全母體，但官方報表未包含個別普通股
- **THEN** 該商品 MUST 保留在母體並於相依條件回傳 `unknown`，不得縮小 universe 或製造零買賣超
