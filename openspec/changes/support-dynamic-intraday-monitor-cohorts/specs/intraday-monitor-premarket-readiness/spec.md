## ADDED Requirements

### Requirement: 產品盤前就緒必須核對當日封存名單而非歷史固定名單

產品每日盤前 Gate MUST 使用該目標交易日的 daily cohort plan、對應設定 revision 與逐商品前一適用交易日基準，分別核對 control-plane、data-plane 與安全條件；MUST NOT 將歷史 Stage-160 固定名單 hash 當成日常唯一有效身分。歷史 exact-cohort Stage 驗收仍 MUST 使用原本不可變名單與收據，不能由動態 plan 回寫或代替。缺少官方交易日 authority、必要基準、API generation 或 simulation business session 時，受影響的產品就緒宣稱 MUST fail closed。

#### Scenario: 合法換股且新商品基準已驗證

- **WHEN** 目標日 plan 中有不同於歷史 Stage-160 的商品，且每檔身分、前一適用交易日基準與盤前 Gate 均通過
- **THEN** 產品 MAY 依已核准容量啟動該日 plan，MUST NOT 只因與歷史 manifest 不同而降回 20
- **AND** MUST NOT 宣稱新組合已取得歷史 Stage-160 的 exact-cohort 驗收結果

#### Scenario: 不完整的當日資料證據

- **WHEN** subscribe 已接受，但有商品未收到合法當日 KBar 或缺同分鐘基準
- **THEN** 系統 MUST 分別回報 subscription-requested、data-active 與 baseline-ready，不能將 accepted request 或舊 GO 當成資料已可用

### Requirement: 盤前差異驗證必須有界且設定變更須明示生效日

前一適用交易日收盤定稿後 MUST 產生下一交易日候選 plan，並為當時新入選商品盤後建立或重用前一適用交易日基準。其後至目標日 08:35 Gate 前的新設定修訂，系統 MUST 在既有 simulation session 與實測資源預算內安排一次有界差異驗證；只可重用身分與日期完全相符的既有基準，新增商品 MUST 通過既有歷史基準完整驗證。每檔新商品 MUST 在 08:35 前具備已封存且可追溯的 09:01–13:30 canonical 逐分鐘累積量、完整性與收盤總量對帳收據；08:45 正式 Gate MUST 核對該收據與當日 plan 相符，才可宣稱盤前可比較。成功時 MUST 原子封存新 plan；失敗或超時時 MUST 保留失敗收據與待生效原因，不得改寫先前收據、補造排程成功或靜默使用與使用者意圖衝突的舊 plan。08:35 後或盤中的新修訂 MUST 延後至下一適用交易日，不得熱換已訂閱 cohort，也不得在開盤後才補建基準並回填盤前就緒狀態。

#### Scenario: 隔夜新增商品在盤前驗證成功

- **WHEN** 前一日 plan 建立後新增一檔，且 08:35 前其歷史基準與全部 Gate 在有界預算內通過
- **THEN** 系統 MAY 封存包含該檔的新 plan，並 MUST 保存前一適用交易日的完整逐分鐘累積量基準、驗證收據、設定 revision 及生效交易日

#### Scenario: 開盤前沒有準備好新商品的比對資料

- **WHEN** 新加入商品在 08:35 前未取得完整且已封存的前一適用交易日分鐘基準，或 08:45 Gate 無法核對同一份 plan 與收據
- **THEN** 該商品 MUST NOT 於當日標示為可比較、active 或可通知，並 MUST 顯示待生效原因
- **AND** 開盤後即使取得歷史資料，也 MUST NOT 回填盤前 Gate、追認當日已就緒或補發歷史通知

#### Scenario: 新商品基準驗證失敗

- **WHEN** 新增商品的前日基準不完整、來源不可信或差異驗證超過預算
- **THEN** 該商品 MUST 保持待生效／`waiting_baseline`，不得進入當日 active 或觸發通知
- **AND** UI/API MUST 明示實際生效的舊 plan 與新設定差異；若變更含刪除或停用已規劃商品，不得未經明示確認仍宣稱以新設定監控該商品

#### Scenario: 開盤後修改名單

- **WHEN** 當日 cohort 已封存及訂閱後又有設定修訂
- **THEN** 當日 plan 與訂閱 MUST 維持不變，新修訂 MUST 顯示為待下一適用交易日處理
