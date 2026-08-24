## MODIFIED Requirements

### Requirement: 三套壓撐工具必須共用 1D-authoritative reference
同商品的 enabled formulas MUST 共用以 `security type + exchange + canonical code` 為 key 且不含 timeframe、formula id 或 instance id 的 reference state。只有 1D 游標觀察模式可以固定歷史 reference、回到最新或清除最後一個 formula；1m、5m、15m、60m MUST 為唯讀鏡像，且不得依自己的 history window 重選 reference。1D 觀察模式的直接單擊選棒 MUST 經 bounded gesture arbiter；若同一 K 棒在判定窗內形成合法左鍵雙擊，系統 MUST 取消單擊 reference 副作用並將 gesture 交由指定日期 1 分 K drill-down。

#### Scenario: 在 1D 直接點選其他歷史 K 棒
- **WHEN** 任一壓撐公式已啟用，使用者在 1D 游標觀察模式單擊合法的已完成日 K，且 bounded double-click 判定窗結束
- **THEN** 所有 enabled formulas MUST 同時改用該 K 棒的 H／L／C
- **AND** reference MUST 標示為固定歷史，後續 hover、tick 或切換分鐘時框不得改變它，且不得要求先啟動額外選棒控制

#### Scenario: 雙擊日 K 不固定歷史 reference
- **WHEN** 任一壓撐公式已啟用，使用者在 1D 游標觀察模式雙擊同一根有效日 K
- **THEN** 單擊選棒 MUST 被取消且原 pinned／automatic reference 保持不變
- **AND** gesture MUST 交由 daily-minute drill-down；載入失敗亦不得提交新的 reference

#### Scenario: 嘗試選取未完成日 K
- **WHEN** 使用者在盤中單擊今日仍 forming 的 1D K 棒，且 gesture 未形成 drill-down 雙擊
- **THEN** 系統 MUST 拒絕固定並保留原 reference
- **AND** UI MUST 顯示今日 K 棒尚未完成的非阻斷提示

#### Scenario: 投影以計算依據 K 棒為起點
- **WHEN** 自動 resolver 或使用者直接點選決定一根 reference K 棒
- **THEN** 每條壓撐價格線 MUST 以該根 reference K 棒在圖表上的位置作為左側起點並向右延伸
- **AND** 系統 MUST NOT 向該根 K 棒左側回畫歷史線；reference 不在分鐘資料窗時才可夾到 plot 左側安全邊界

#### Scenario: 分鐘圖鏡像同一組投影
- **WHEN** 1D 已建立自動或固定 reference，使用者切換至 1m、5m、15m 或 60m
- **THEN** 分鐘圖 MUST 顯示相同 reference 日期、OHLC、完成狀態及公式價位
- **AND** 分鐘圖 MUST NOT 提供固定歷史、回到最新或會改變 enabled state 的控制

#### Scenario: 回到最新
- **WHEN** 1D 目前使用固定歷史 reference，且使用者啟動「回到最新」
- **THEN** 系統 MUST 清除 pinned state 並重新執行當下的自動 reference resolver
- **AND** 所有支援時框 MUST 原子切換至同一個新 projection
