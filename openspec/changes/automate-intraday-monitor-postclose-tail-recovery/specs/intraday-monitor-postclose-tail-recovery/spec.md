## ADDED Requirements

### Requirement: 收盤後復原必須依原始 capture 分類且不可改寫原證據

系統 MUST 等到當日 13:34:30 收盤定稿、正式擷取結束並取得可驗證的原始 capture hash，才可建立復原工作。工作 MUST 綁定交易日、固定 cohort、來源 capture hash 與當次 simulation session；同一 identity 的重複觸發 MUST 冪等。原 capture、失敗狀態、排程／警示收據及已接受的 live observation MUST 維持不可變。

#### Scenario: 少量連續尾端缺口
- **WHEN** 原始 capture 的 09:01 canary 與必要安全 Gate 成立，最多 4 檔各自只缺 13:26–13:30 內連續至最後的至多 5 分鐘，且先前分鐘均為完整 live observation
- **THEN** 系統 MUST 將其分類為符合既有 Stage 160 尾端例外的候選，不得預先標記修復成功

#### Scenario: 整批收尾異常
- **WHEN** 5 檔以上同時只缺最後連續分鐘，包括 160 檔皆缺 13:30
- **THEN** 系統 MUST 將其分類為相關尾端失敗並保留原始 live NO-GO；除非逐檔拒收 reason 有證據，不得斷言原因皆為 freshness

#### Scenario: 開盤或中段亦有缺口
- **WHEN** 09:01 canary 失敗、任一缺口不是最後連續分鐘，或原始 capture 身分／安全 Gate 不完整
- **THEN** 系統 MUST 拒絕尾端自動補救資格，保留 partial／failed 與具體原因

#### Scenario: 重複觸發復原工作
- **WHEN** 相同交易日、cohort 與原始 capture hash 的復原工作已建立或完成
- **THEN** 系統 MUST 回傳既有 claim／結果，不得覆寫原始或衍生 artifact、重複抓取或重複發布

### Requirement: 盤後尾端補值必須由穩定且可比對的同日來源證明

復原工作 MUST 優先讀取既有盤後流程已發布、逐檔完整驗證的同日歷史資料與雙抓證據；未發布、只有 staging／claim／HTTP 200、來源欄位不足或 cohort／交易日不符時 MUST 保持 pending／unknown，不得填值。每檔 MUST 核對官方交易日、合約與市場、來源版本、兩次獨立擷取一致性、270 個 canonical 分鐘與可信收盤總量，並逐分鐘精確核對所有原始 live 前綴累積量。缺少零量證明、收盤編碼未知或資料衝突時 MUST 逐檔 fail closed。

#### Scenario: 已驗證盤後基準與 live 前綴一致
- **WHEN** 同日已發布的不可變來源包含完整雙抓與收盤量證據，且候選商品每個已接受 live 分鐘的累積量與歷史資料完全一致
- **THEN** 系統 MUST 只把原始 capture 中連續缺失的尾端分鐘寫入獨立衍生 artifact，逐列標記 `liveDelivered=false`、來源／hash 與驗證時間，不得改寫 live observation

#### Scenario: 來源尚未發布或證據不足
- **WHEN** 13:35 首次採集尚未有 verified receipt，或既有 manifest 不能證明雙抓、逐筆對帳或必要零量來源
- **THEN** 系統 MUST 保持 `source_pending`／`source_unverified`，僅依既有有界盤後重試繼續核對，不得為整批另外啟動無界 160 檔採集

#### Scenario: live 前綴或雙抓不一致
- **WHEN** 任一前綴分鐘累積量與歷史來源不符，或兩次獨立擷取的 canonical 內容／hash 漂移
- **THEN** 該商品 MUST 維持未復原並保存衝突原因；其他商品結果 MUST 分開判定，不得以整批成功旗標掩蓋差異

#### Scenario: 延後收盤與零成交分鐘
- **WHEN** 商品具有合法 13:33 延後收盤資料，或來源省略可能為零成交的分鐘
- **THEN** 系統 MUST 只將已驗證的延後量併入 canonical 13:30，且只有來源契約與可信總量證明零成交時才可建立 `known_zero`；不得補造 13:31–13:33 regular-session 分鐘

### Requirement: 資料復原與 live 驗收資格必須分離

系統 MUST 分別保存原始 live 完整性、既有受限尾端 derived acceptance、盤後資料復原完整性，以及下一適用交易日基準可用性。少量缺口只有在完整符合既有最多 4 檔／每檔最多 5 分鐘政策及全部其他 Gate 時，才 MAY 產生該政策既已允許的 derived acceptance。超出政策的整批補齊 MUST 只具 `postclose_data_recovered` 資格，不得把原始 `formalAcceptanceEvidence=false`、live capture NO-GO 或跨交易日實盤驗收改成成功。任何盤後補值均 MUST 不具當日即時通知、追溯觸發、production 或 broker-write 權限。

#### Scenario: 少量缺口符合既有衍生審閱政策
- **WHEN** 尾端候選的雙抓、live 前綴、收盤量、replay、資源及安全 Gate 全部通過
- **THEN** 系統 MAY 另建受限 derived acceptance，MUST 保留原始 capture 的 live 失敗狀態，且補值的 `liveDelivered`、通知與追溯觸發權限 MUST 為 false

#### Scenario: 全 160 檔只缺最後一分鐘且盤後均可補齊
- **WHEN** 每檔 13:30 均由已驗證盤後來源補齊，但原始正式擷取的 13:30 封存全部失敗
- **THEN** 系統 MUST 產生獨立的盤後資料復原結果，MUST 保持當日 live 完整性與既有 Stage 160 尾端例外資格為失敗，不得藉此勾銷跨交易日 live 驗收缺口

#### Scenario: 無來源或驗證失敗
- **WHEN** 既有盤後流程的所有有界嘗試已結束仍沒有完整可信來源，或復原核對失敗
- **THEN** 系統 MUST 保存最後一次失敗收據及原始 unknown slots，MUST NOT 將資料不足顯示為零量或成功

### Requirement: 自動復原不得建立第二條行情擷取或無界工作

復原流程 MUST 使用既有 simulation runtime、business session 與已保存的盤後來源收據；不得新增 broker login、行情訂閱、盤中輪詢、production／CA、broker write 或共用服務生命週期變更。任何少量缺口的必要額外來源讀取 MUST 有共享流量預算、期限與嘗試上限，不得搶占或使原 13:35 基準工作失敗。

#### Scenario: 盤後基準工作仍在執行
- **WHEN** 既有 13:35 基準採集尚未完成或正依既有有界重試運作
- **THEN** 復原工作 MUST 等待 verified receipt 或在同一共享預算下執行受限讀取，不得另外啟動整批 KBar 輪詢、登入或訂閱
