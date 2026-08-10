## MODIFIED Requirements

### Requirement: Traditional Pivot 第一階段只能用於 STK／IND／WRT
系統 MUST 提供預設關閉、由 1D 唯一管理的 Traditional Pivot Point，並使用所選 completed 或明確 provisional reference 交易日的 `H`、`L`、`C` 計算下一交易日 `P=(H+L+C)/3`、`R1=2P-L`、`S1=2P-H`、`R2=P+(H-L)`、`S2=P-(H-L)`、`R3=R1+(H-L)`、`S3=S1-(H-L)`。projection MUST 保留與 MultiView `selected-next-period-v1` 等價的 reference period、reference status、applies-to、applicable period、target mapping 與七個 levels，且兩個 app MUST 以同一版本化 fixture 通過精度一致性測試。本 change 只允許 security type STK、IND、WRT；FUT 與 OPT MUST 保持不支援。

#### Scenario: 股票類商品建立 completed reference
- **WHEN** STK、IND 或 WRT 的 canonical raw 1m rows 依 `Asia/Taipei` 日期分組，且某日期之後已有下一個實際交易日期資料
- **THEN** 前一日期 MUST 視為 completed reference，並使用該日所有合法 rows 建立 H／L／C
- **AND** 系統 MUST NOT 使用 UTC 日界線、單根日內 candle 或畫面第一根不完整 candle 代替完整交易日

#### Scenario: 最新日只能是 provisional
- **WHEN** 最新日期尚無下一個實際交易日期資料佐證完成
- **THEN** 該 group MUST 標示 provisional
- **AND** 預設「最後完成」projection MUST NOT 把 provisional 冒充 completed

#### Scenario: FUT／OPT 明確延後
- **WHEN** 目前商品 security type 為 FUT 或 OPT
- **THEN** Pivot picker MUST 停用或顯示「第一階段尚未支援」
- **AND** 系統 MUST NOT 以午夜切割、猜測 session 或輸出 provisional Pivot

#### Scenario: 由 1D 建立並鏡像同一組七線
- **WHEN** 使用者在 STK、IND 或 WRT 的 1D 圖啟用 Pivot，且最後 completed reference 具有合法 H／L／C
- **THEN** 1D、1m、5m、15m 與 60m MUST 顯示 reference key、status、applies-to 與數值完全相同的 P、R1、R2、R3、S1、S2、S3 下一交易日右向投影
- **AND** readout MUST 顯示 reference 日期、適用下一交易日、已完成狀態與七個格式化價格
- **AND** 分鐘圖 MUST NOT 以自己的 history window 重選 reference 或重算成另一組水準

#### Scenario: 分鐘圖沒有 reference candle
- **WHEN** 目前分鐘圖資料窗不含 1D 所選 reference candle，但 canonical projection 仍合法
- **THEN** 分鐘圖 MUST 保留相同 reference 與七個水準，並將線段起點夾到 plot 左側安全邊界
- **AND** 系統 MUST NOT 隱藏 Pivot、建立假 candle 或改用畫面內最早交易日

### Requirement: Pivot overlay 與互動必須維持圖表及交易安全
Pivot MUST 只呈現目前預設或使用者在 1D 固定 reference 的七條右向水平投影，不得建立未來 timestamp、假 candle 或完整歷史 step lines。七線 MUST 對齊 MultiView 的 P／R1～R3／S1～S3 色彩、強調、實線／虛線／點線、價格軸安全邊界、標籤避碰、短導引線、autoscale helper 與中文 readout。使用者只有在 1D 游標觀察模式才可點選歷史 K 棒固定 reference、回到最新或移除 Pivot；1m、5m、15m 與 60m MUST 為同商品 projection 的唯讀鏡像。交易相關模式 MUST 優先。Pivot 的計算、選取與 cleanup MUST 依 indicator、商品及 generation 隔離，並以 product-scoped state 同步支援時框。

#### Scenario: 在 1D 點選歷史 K 棒固定 reference
- **WHEN** Pivot 已啟用、目前為 1D 游標觀察模式且使用者點選 STK／IND／WRT 的合法歷史 K 棒
- **THEN** 系統 MUST 固定該 K 棒所屬日期的 projection，後續 hover 不得改變 reference
- **AND** 目前商品的 1m、5m、15m 與 60m MUST 同步顯示該 projection
- **AND** 使用者 MUST 可透過鍵盤可操作的「回到最新」恢復最後 completed projection

#### Scenario: 分鐘圖只能檢視 Pivot
- **WHEN** 使用者在 1m、5m、15m 或 60m 查看已由 1D 啟用的 Pivot
- **THEN** UI MUST 顯示「由 1D 管理」或同等明確文字
- **AND** 固定歷史、回到最新、移除及時框可見性控制 MUST 停用或不呈現

#### Scenario: 只從 1D 刪除並同步清理
- **WHEN** 使用者在 1D 移除 Pivot
- **THEN** 同商品所有已掛載支援時框 MUST 同步移除 overlay、readout、autoscale helper 與 product-scoped selection
- **AND** 其他商品、Fibonacci、Volume Profile、技術指標、委託線與交易狀態 MUST 維持不變

#### Scenario: 價格標籤過近時維持真實價位
- **WHEN** 兩個以上 Pivot 水準的價格標籤在目前尺度下重疊
- **THEN** 標籤 MUST 依固定順序垂直避碰並在需要時顯示短導引線
- **AND** 實際七條水平線 MUST 維持各自真實價格 Y 座標

#### Scenario: 交易模式優先於 Pivot
- **WHEN** 使用者已選擇點價買、點價賣、停損、停利或警示模式後點擊圖表
- **THEN** 點擊 MUST 只依既有交易或警示流程處理，Pivot reference MUST 保持不變
- **AND** Pivot 啟用狀態不得擴大 production 權限、略過 simulation 或風險檢查

#### Scenario: 快速切換與清理
- **WHEN** 使用者 history paging、快速切換商品／時框、開關 Pivot 或銷毀 chart
- **THEN** 目前 generation 的 reference、完成狀態與七線 MUST 維持一致或安全重算
- **AND** 舊 generation 結果 MUST 被取消或丟棄，不得污染 viewport、autoscale 或其他指標
