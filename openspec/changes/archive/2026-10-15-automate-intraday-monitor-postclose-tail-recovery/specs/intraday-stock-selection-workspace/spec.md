## ADDED Requirements

### Requirement: 盤中監控畫面必須區分原始 live 與盤後尾端復原

查詢既有舊版 v1 復原 artifact 或另經要求的 legacy diagnostic 時，盤中監控 API 與面板 MUST 分別呈現當日原始 live 資料範圍、最後連續封閉分鐘、原始收尾與正式驗收結果，以及盤後復原範圍、來源與驗證狀態。盤後補值 MUST 明示 `liveDelivered=false`，不得增加即時結果筆數、改寫觸發時間、補發通知，或以「資料已補齊」取代「正式 live 驗收未通過」。舊 client 或缺少復原欄位時 MUST 顯示未驗證，不得預設已復原。

此舊版歷史呈現契約 MUST NOT 要求 daily 建立或執行舊復原工作。現行 daily MUST 依「收盤尾筆例外必須與原live覆蓋及盤後補算分開呈現」及 `intraday-monitor-daily-runtime` 規格，分開顯示原 live partial 與新版產品例外通過；不得將舊版 4 檔／5 分鐘條件或原 Stage 資格套用至新版至多 10 檔、僅缺 13:30 的判定。

#### Scenario: 原始 live 不完整但盤後資料已核實
- **WHEN** 商品原始 live 資料只到 13:29，13:30 由盤後來源核實補齊，且正式 live 驗收未通過
- **THEN** 畫面 MUST 同時顯示盤中與盤後各自範圍、補值 provenance，以及正式 live 驗收未通過，不得把 13:30 標成即時收到

#### Scenario: 整批復原仍不具正式資格
- **WHEN** 多檔尾端缺口超過既有受限例外，盤後驗證已完成全部資料復原
- **THEN** 面板 MUST 顯示「盤後資料已核實」及「當日 live 驗收未通過」兩個獨立狀態，結果清單與通知權限 MUST 維持原始 live 判定

#### Scenario: 來源尚待發布或復原失敗
- **WHEN** verified receipt 尚不存在、來源不完整或與 live 前綴衝突
- **THEN** 面板 MUST 顯示等待或失敗原因與原始缺口，不得顯示已補齊或零成交

#### Scenario: 舊版退役但新版例外產品已通過

- **WHEN** 新版 daily 經合法 v2 與收盤尾筆 Gate 判定產品例外通過，而舊版復原案已退役
- **THEN** 面板 MUST 保留新版產品判定、原 live partial 與非即時補算各自狀態，不因缺少舊版 artifact 誤報新版失敗，也不得將歷史舊案標成 live 驗收通過
