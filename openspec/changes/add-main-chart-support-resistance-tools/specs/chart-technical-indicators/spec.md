## MODIFIED Requirements

### Requirement: Traditional Pivot 第一階段只能用於 STK／IND／WRT
系統 MUST 將 Traditional Pivot Point 公式保留為主交易畫面「壓撐」中的 `PivotPoint`，不得再於通用 indicator picker 提供可建立第二份線組的入口。PivotPoint MUST 使用所選 reference 交易日的 `H`、`L`、`C` 計算 `P=(H+L+C)/3`、`R1=2P-L`、`S1=2P-H`、`R2=P+(H-L)`、`S2=P-(H-L)`、`R3=R1+(H-L)`、`S3=S1-(H-L)`；STK、IND、WRT MUST 可用，FUT 與 OPT MUST 保持不支援。盤中預設 MUST 使用上一個完整交易日，13:35 後且今日 Kbars 可證明完整時 MUST 可使用最後一根日 K；無法證明完整時不得把 provisional 冒充 completed。

#### Scenario: 股票類商品建立 reference days
- **WHEN** STK、IND 或 WRT 的 canonical raw 1m rows 依 `Asia/Taipei` 日期分組
- **THEN** 每個交易日 MUST 使用該日所有合法 rows 建立 H／L／C
- **AND** 系統 MUST NOT 使用 UTC 日界線、單根日內 candle、quote 或畫面第一根不完整 candle 代替完整交易日

#### Scenario: 盤中最新日維持 provisional
- **WHEN** 今日已有 forming Kbars，但台北時間尚未到 13:35
- **THEN** 今日 group MUST 標示 provisional，預設 projection MUST 使用上一個完整交易日
- **AND** 通用 indicator picker MUST NOT 另行建立使用今日 provisional group 的 Traditional Pivot

#### Scenario: 收盤後最後一根日 K 可成為 completed
- **WHEN** 台北時間已到 13:35，current-day Kbars 載入成功、OHLC 合法且來源可用
- **THEN** 今日 group MUST 可作為自動 reference，並產生 PivotPoint 七線
- **AND** reference readout MUST 顯示日期、已完成狀態與格式化七值

#### Scenario: FUT／OPT 明確延後
- **WHEN** 目前商品 security type 為 FUT 或 OPT
- **THEN** 「壓撐」中的 PivotPoint MUST 停用或顯示「第一階段尚未支援」
- **AND** 系統 MUST NOT 以午夜切割、猜測 session 或輸出 provisional Pivot

#### Scenario: 由 1D 建立並鏡像七線
- **WHEN** 使用者在 1D 的「壓撐」啟用 PivotPoint，且自動或固定 reference 具有合法 H／L／C
- **THEN** 1D、1m、5m、15m 與 60m MUST 顯示 reference 與數值相同的 P、R1、R2、R3、S1、S2、S3 右向投影
- **AND** 分鐘圖 MUST NOT 以自己的 history window 重選 reference 或重算另一組水準

### Requirement: Pivot overlay 與互動必須維持圖表及交易安全
PivotPoint MUST 只呈現目前自動或使用者在 1D 固定 reference 的七條右向水平投影，不得建立未來 timestamp、假 candle 或完整歷史 step lines。使用者只有在 1D 游標觀察模式才可點選已完成歷史 K 棒固定 reference、回到最新或取消 PivotPoint；1m、5m、15m、60m MUST 為唯讀鏡像。交易相關模式 MUST 優先。PivotPoint 的計算、選取、共用 primitive、readout、autoscale helper 與 cleanup MUST 依商品及 generation 隔離，並與三關價、CDP 共用 formula-independent product reference state。

#### Scenario: 在 1D 點選歷史 K 棒固定 reference
- **WHEN** PivotPoint 已啟用、目前為 1D 游標觀察模式且使用者點選 STK／IND／WRT 的合法已完成歷史 K 棒
- **THEN** 系統 MUST 固定該 K 棒所屬日期的 projection，後續 hover、tick 或切換分鐘時框不得改變 reference
- **AND** 使用者 MUST 可透過鍵盤可操作的「回到最新」恢復自動 projection

#### Scenario: 分鐘圖只能檢視 PivotPoint
- **WHEN** 使用者在 1m、5m、15m 或 60m 查看已由 1D 啟用的 PivotPoint
- **THEN** UI MUST 顯示「由 1D 管理」或同等明確文字
- **AND** 分鐘圖 MUST NOT 提供固定、回到最新、取消或其他會改變 canonical reference／enabled state 的控制

#### Scenario: 交易模式優先於 PivotPoint
- **WHEN** 使用者已選擇點價買、點價賣、停損、停利或警示模式後點擊圖表
- **THEN** 點擊 MUST 只依既有交易或警示流程處理，PivotPoint reference MUST 保持不變
- **AND** PivotPoint 啟用狀態不得擴大 production 權限、略過 simulation 或風險檢查

#### Scenario: 快速切換與清理
- **WHEN** 使用者 history paging、快速切換商品／時框、開關 PivotPoint 或銷毀 chart
- **THEN** 目前 generation 的 reference、完成狀態與七線 MUST 維持一致或安全重算
- **AND** 舊 generation 結果 MUST 被取消或丟棄，不得污染 viewport、autoscale、三關價、CDP 或其他指標

#### Scenario: 舊 Traditional Pivot instance 遷移
- **WHEN** canonical indicator store 載入合法的 legacy `traditional-pivot` instance
- **THEN** 可見 instance MUST 遷移為已勾選 PivotPoint，hidden instance MUST 遷移為未勾選，且通用 picker 不得再顯示 legacy entry
- **AND** migration MUST 可重入、不得產生兩份七線，且新版 state 成功保存前 MUST 保留可復原的舊資料
