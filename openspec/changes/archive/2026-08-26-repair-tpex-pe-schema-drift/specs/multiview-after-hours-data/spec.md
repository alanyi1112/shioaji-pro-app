## ADDED Requirements

### Requirement: TPEx PE schema drift 必須可驗證且 fail closed
MultiView 的 TPEx PE provider adapter MUST 只接受以實際來源 fixture 證明的合法 schema 變體，並 MUST 將商品代碼、實際 source date 與 PE 欄位正規化為既有 canonical row。未知 envelope、必要欄位缺失、型別不符或日期不可驗證時 MUST 回傳 `schema_mismatch` 且不得寫入 D1；系統 MUST NOT 猜測欄位、補零、forward-fill 或以 requested end date 冒充資料日期。

#### Scenario: TPEx 回傳已知合法 schema 變體
- **WHEN** provider 回應符合已保存 fixture 的合法 envelope 與必要欄位，且資料列通過商品、市場、日期與數值驗證
- **THEN** adapter 將資料正規化為 canonical PE row，pipeline 以實際 source date 執行 changed-only 寫入
- **AND** 相同 material row 重跑不得只因 fetchedAt 不同而重寫

#### Scenario: TPEx 回傳未知或不完整 schema
- **WHEN** provider 回應缺少必要欄位、欄位型別不符或 source date 無法驗證
- **THEN** 本次 attempt MUST 標示 `schema_mismatch` 且不得寫入或覆蓋最後 verified row
- **AND** 診斷只保存非機密的欄位摘要，不得保存 token、cookie、request header 或完整原始 payload

#### Scenario: 官方資料尚未發布或合法為空
- **WHEN** TPEx 以已驗證的官方訊號表示目標日期尚未發布，或回傳符合契約的合法空集合
- **THEN** 系統 MUST 使用 `official_not_published` 或對應安全 reason code，不得誤標為 `schema_mismatch`
- **AND** scheduler 依發布窗口有界重試，不得以舊值或零值宣稱本次更新成功

### Requirement: PE health 必須區分本次嘗試與最後 verified 資料
MultiView health MUST 分別呈現 TPEx PE 最近一次 provider attempt 的時間、結果與 reason code，以及最後 verified source date、coverage end 與 UI display date。最後 verified row 可在暫時失敗時維持線圖可用，但舊資料存在 MUST NOT 掩蓋本次 `schema_mismatch` 或使 pipeline 被標示為最新更新成功。

#### Scenario: 本次解析失敗但仍有最後 verified row
- **WHEN** TPEx latest attempt 回傳 `schema_mismatch`，而 D1 已有較早的 verified PE row
- **THEN** health MUST 同時顯示本次 attempt failure 與最後 verified source date
- **AND** UI MAY 保留最後 verified PE 線圖，但 MUST 顯示資料日期或 partial／pending 提示，不得顯示成當日已更新

#### Scenario: 修正後 latest pipeline 成功
- **WHEN** bounded daily pipeline 成功解析 TPEx 合法 schema 並完成 changed-only 寫入
- **THEN** health 的 attempt status、verified source date、coverage end 與 display date MUST 與實際來源列一致
- **AND** `schema_mismatch` MUST 從該商品目前 pending reason 移除，但歷史 attempt 紀錄仍可供診斷

### Requirement: PE 缺口必須逐商品分類後才能宣稱修復
PE latest 與 history 的 pending、missing 及 insufficient 商品 MUST 依實際 provider coverage、上市歷史、來源發布狀態、parser 結果與 scheduler checkpoint 逐商品分類。只有確認為 parser、排程或回補缺陷的項目可列為程式修復；來源未發布、provider 不涵蓋或合法歷史不足 MUST 維持 partial／pending 並保留可驗證 reason code。

#### Scenario: 驗收 `.TW` 與 `.TWO` 代表商品
- **WHEN** change 準備完成驗收
- **THEN** 測試 MUST 至少核對一檔 `.TW` 與一檔 `.TWO` 的 provider attempt、D1 row、實際 source date、coverage、health 與瀏覽器 PE 線圖
- **AND** 不得只以 HTTP 200、table 非空、requested end date 或其他市場的成功結果宣稱 TPEx 已修復

#### Scenario: 商品歷史確實不足
- **WHEN** gap report 證明商品上市歷史短於要求窗口，或官方 provider 在該期間沒有合法資料列
- **THEN** 系統 MUST 將該商品分類為 insufficient 或對應來源限制，不得製造缺失日期資料
- **AND** 其他可回補商品 MUST 繼續依 checkpoint 與 budget 有界處理
