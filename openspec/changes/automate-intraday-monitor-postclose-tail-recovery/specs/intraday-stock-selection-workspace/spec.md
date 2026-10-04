## ADDED Requirements

### Requirement: 盤中監控畫面必須區分原始 live 與盤後尾端復原

盤中監控 API 與面板 MUST 分別呈現當日原始 live 資料範圍、最後連續封閉分鐘、原始收尾與正式驗收結果，以及盤後復原範圍、來源與驗證狀態。盤後補值 MUST 明示 `liveDelivered=false`，不得增加即時結果筆數、改寫觸發時間、補發通知，或以「資料已補齊」取代「正式 live 驗收未通過」。舊 client 或缺少復原欄位時 MUST 顯示未驗證，不得預設已復原。

#### Scenario: 原始 live 不完整但盤後資料已核實
- **WHEN** 商品原始 live 資料只到 13:29，13:30 由盤後來源核實補齊，且正式 live 驗收未通過
- **THEN** 畫面 MUST 同時顯示盤中與盤後各自範圍、補值 provenance，以及正式 live 驗收未通過，不得把 13:30 標成即時收到

#### Scenario: 整批復原仍不具正式資格
- **WHEN** 多檔尾端缺口超過既有受限例外，盤後驗證已完成全部資料復原
- **THEN** 面板 MUST 顯示「盤後資料已核實」及「當日 live 驗收未通過」兩個獨立狀態，結果清單與通知權限 MUST 維持原始 live 判定

#### Scenario: 來源尚待發布或復原失敗
- **WHEN** verified receipt 尚不存在、來源不完整或與 live 前綴衝突
- **THEN** 面板 MUST 顯示等待或失敗原因與原始缺口，不得顯示已補齊或零成交
