## ADDED Requirements

### Requirement: 主交易畫面必須提供獨立的壓撐入口
主交易畫面 K 線工具列 MUST 在「指標」旁提供標題為「壓撐」的鍵盤可操作按鈕。按鈕 MUST 開啟 viewport-safe popover，並依序提供 `PivotPoint`、`三關價`、`CDP` 三個 checkbox；三項預設 MUST 為關閉，且啟用狀態 MUST 使用既有 canonical indicator store 的版本化、原子及同 origin 同步契約。

#### Scenario: 開啟壓撐選單
- **WHEN** 使用者以滑鼠或鍵盤啟動「壓撐」按鈕
- **THEN** 系統 MUST 顯示三個具有可讀 label 與 checked state 的 checkbox
- **AND** popover MUST 不得遮蔽價格軸、溢出可視畫面或改變目前交易模式

#### Scenario: 勾選第一個公式
- **WHEN** 三項均未啟用且使用者勾選任一 checkbox
- **THEN** 系統 MUST 保存該公式的 enabled state 並立即依自動 reference 規則建立投影
- **AND** 「壓撐」按鈕 MUST 顯示 active 狀態，但不得自動啟用其他公式

#### Scenario: storage 寫入失敗
- **WHEN** checkbox 更新成功進入 canonical in-memory snapshot，但 localStorage 寫入失敗
- **THEN** 畫面 MUST 繼續使用新的 in-memory enabled state
- **AND** UI MUST 顯示「設定尚未保存」與安全 reason code，不得清除其他 indicator 設定

### Requirement: 壓撐公式必須使用固定版本與合法 OHLC
系統 MUST 以同一根 reference K 棒的 `H`、`L`、`C` 計算已啟用的 level sets。PivotPoint MUST 使用 `traditional-pivot-tw-v1`；三關價 MUST 使用 `three-level-price-tw-v1` 的 `UP=H+(H-L)×0.382`、`MID=(H+L)/2`、`DOWN=L-(H-L)×0.382`；CDP MUST 使用 `cdp-wilder-tw-v1` 的 `CDP=(2C+H+L)/4`、`PT=H-L`、`AH=CDP+PT`、`NH=2CDP-L`、`NL=2CDP-H`、`AL=CDP-PT`。純函式 MUST 拒絕非有限值、`H<L` 或 `C` 不在 `[L,H]` 的 OHLC。

#### Scenario: 計算 PivotPoint 七線
- **WHEN** reference OHLC 合法且使用者啟用 PivotPoint
- **THEN** 系統 MUST 產生依序可識別的 P、R1、R2、R3、S1、S2、S3 七個有限價位
- **AND** 數值 MUST 與既有 Traditional Pivot 版本化 fixture 完全一致

#### Scenario: 計算三關價三線
- **WHEN** reference OHLC 合法且使用者啟用三關價
- **THEN** 系統 MUST 產生上關、 中關、下關三個有限價位
- **AND** 上關與下關 MUST 分別位於 H 以上與 L 以下，中關 MUST 等於 H 與 L 的中點

#### Scenario: 計算 CDP 五線
- **WHEN** reference OHLC 合法且使用者啟用 CDP
- **THEN** 系統 MUST 產生 AH、NH、CDP、NL、AL 五個有限價位
- **AND** 固定 fixture MUST 驗證 `AH ≥ NH ≥ CDP ≥ NL ≥ AL` 及六位小數精度

#### Scenario: 非法 reference OHLC
- **WHEN** 任一公式收到非有限值、high 小於 low 或 close 超出 high／low 的 reference
- **THEN** 系統 MUST 將該 projection 標示 unavailable 並不得畫線
- **AND** 系統 MUST NOT 以 quote、昨收或零值補造 OHLC

### Requirement: 自動 reference 必須區分盤中與完成交易日
STK／IND／WRT 的自動 reference resolver MUST 以 `Asia/Taipei` 現在時間、實際 raw 1m Kbar 交易日期、current-day 載入狀態及合法 OHLC 判定。最新資料日期早於今日時 MUST 使用該最新完整交易日；最新資料日期等於今日且早於 13:35 時 MUST 使用上一個完整交易日；13:35 後只有 current-day Kbars 載入成功、OHLC 合法且來源未標示 unavailable 時，MUST 使用今日最後一根日 K。無法證明完整時 MUST fail closed 至前一個可證明完整的交易日。

#### Scenario: 交易日盤中已有今日 K 棒
- **WHEN** 台北時間介於開盤後與 13:35 前，且 raw rows 同時包含今日 forming group 與上一個交易日
- **THEN** 自動 reference MUST 使用上一個交易日的完整 H／L／C
- **AND** 今日 forming group MUST NOT 被當成 completed reference

#### Scenario: 收盤安全邊界後資料完整
- **WHEN** 台北時間已到 13:35、今日 Kbars 載入成功、今日 group OHLC 合法且來源可用
- **THEN** 自動 reference MUST 使用今日最後一根日 K 的 H／L／C
- **AND** readout MUST 標示今日 reference 已完成

#### Scenario: 收盤後今日資料不可證明完整
- **WHEN** 已到 13:35，但 current-day Kbars 載入失敗、來源 unavailable、日期倒序或 OHLC 非法
- **THEN** 自動 reference MUST 使用前一個可證明完整的交易日或顯示 unavailable
- **AND** 系統 MUST NOT 只依本機時鐘或即時 quote 把今日標為完成

#### Scenario: 開盤前、週末或休市日
- **WHEN** 最新有效 Kbar 日期早於台北今日日期
- **THEN** 自動 reference MUST 使用資料中最新的有效交易日
- **AND** 系統 MUST NOT 因星期判斷補造不存在的交易日

### Requirement: 三套壓撐工具必須共用 1D-authoritative reference
同商品的 enabled formulas MUST 共用以 `security type + exchange + canonical code` 為 key 且不含 timeframe、formula id 或 instance id 的 reference state。只有 1D 游標觀察模式可以固定歷史 reference、回到最新或清除最後一個 formula；1m、5m、15m、60m MUST 為唯讀鏡像，且不得依自己的 history window 重選 reference。

#### Scenario: 在 1D 固定歷史 K 棒
- **WHEN** 任一壓撐公式已啟用，使用者在 1D 游標觀察模式啟動「固定歷史」並點選合法的已完成日 K
- **THEN** 所有 enabled formulas MUST 同時改用該 K 棒的 H／L／C
- **AND** reference MUST 標示為固定歷史，後續 hover、tick 或切換分鐘時框不得改變它

#### Scenario: 嘗試選取未完成日 K
- **WHEN** 使用者在盤中點選今日仍 forming 的 1D K 棒
- **THEN** 系統 MUST 拒絕固定並保留原 reference
- **AND** UI MUST 顯示今日 K 棒尚未完成的非阻斷提示

#### Scenario: 分鐘圖鏡像同一組投影
- **WHEN** 1D 已建立自動或固定 reference，使用者切換至 1m、5m、15m 或 60m
- **THEN** 分鐘圖 MUST 顯示相同 reference 日期、OHLC、完成狀態及公式價位
- **AND** 分鐘圖 MUST NOT 提供固定歷史、回到最新或會改變 enabled state 的控制

#### Scenario: 回到最新
- **WHEN** 1D 目前使用固定歷史 reference，且使用者啟動「回到最新」
- **THEN** 系統 MUST 清除 pinned state 並重新執行當下的自動 reference resolver
- **AND** 所有支援時框 MUST 原子切換至同一個新 projection

### Requirement: 壓撐線與價位標籤必須共同配置
系統 MUST 將所有 enabled level sets 交由單一 renderer 排序與配置，最多同時呈現 PivotPoint 七線、三關價三線及 CDP 五線。每條線 MUST 有 formula prefix、level label、格式化價位、可辨識色彩／線型；所有標籤 MUST 共同避碰，偏離真實價格位置時 MUST 以短 connector 指回價位。autoscale MUST 只納入目前 enabled 且有限的 levels。

#### Scenario: 三套公式同時啟用
- **WHEN** PivotPoint、三關價與 CDP 同時具有合法 projection
- **THEN** renderer MUST 顯示十五條可識別的水平線與價位標籤，不得因價格相同或相近靜默省略公式
- **AND** 標籤 MUST 以固定排序避碰，且不遮蔽右側價格軸主要刻度

#### Scenario: reference 不在分鐘資料窗
- **WHEN** 分鐘圖目前載入範圍不包含所選 1D reference candle
- **THEN** 系統 MUST 保留相同 levels 並把線段起點夾到 plot 左側安全邊界
- **AND** 系統 MUST NOT 建立假 candle、未來 timestamp 或改用畫面內第一個交易日

#### Scenario: 價格接近造成標籤位移
- **WHEN** 兩個以上不同 formula／level 的標籤在目前尺度下重疊
- **THEN** renderer MUST 依固定順序調整 label Y 位置並為位移標籤顯示短 connector
- **AND** connector MUST 指向原始真實價格而非位移後價格

### Requirement: 個別取消與 lifecycle cleanup 必須原子且隔離
取消單一 checkbox MUST 只移除該 formula 的線、標籤、readout 與 autoscale contribution，並在其他 formula 仍啟用時保留共用 reference。最後一個 formula 取消時 MUST 清除該商品的 pinned reference 與整組 primitive data；切換商品／時框、快速更新、較新 generation、unmount 或非法資料時 MUST 清理舊投影，不得污染其他圖表。

#### Scenario: 只取消 CDP
- **WHEN** 三套公式皆啟用且使用者取消 CDP
- **THEN** 系統 MUST 只移除 AH、NH、CDP、NL、AL 及其 readout／autoscale
- **AND** PivotPoint、三關價與共用 reference MUST 保持不變

#### Scenario: 取消最後一個公式
- **WHEN** 使用者取消該圖目前最後一個 enabled formula
- **THEN** 系統 MUST 清除所有壓撐線、標籤、readout、autoscale contribution 與 pinned reference
- **AND** 下次重新勾選 MUST 依當下自動規則選擇 reference，不得恢復舊 pinned 日期

#### Scenario: reload 後恢復 enabled state
- **WHEN** canonical store 已保存 checkbox 狀態且頁面重新載入
- **THEN** 系統 MUST 恢復 enabled formulas，但 MUST NOT 恢復 document-session pinned reference
- **AND** projection MUST 重新依自動 resolver 建立並明示為自動 reference

#### Scenario: 快速切換商品與時框
- **WHEN** 使用者快速切換商品／時框且舊 generation 較晚完成
- **THEN** 舊 projection MUST 被取消、丟棄或清除
- **AND** 目前圖表 MUST 只顯示 current product key 與 current generation 的 levels

### Requirement: 壓撐工具不得擴張交易與資料權限
壓撐公式 MUST 只使用目前已授權載入的 Shioaji canonical Kbars；不得另行呼叫 Cloudflare、D1、未授權資料來源或自訂 JavaScript。交易、點價買賣、停損、停利與警示模式 MUST 優先於 reference 選棒，且壓撐 enabled state 不得啟用 production、送單或略過既有 simulation 及風險檢查。

#### Scenario: 交易模式下點擊 K 棒
- **WHEN** 使用者已選擇點價買、點價賣、停損、停利或警示模式後點擊圖表
- **THEN** 點擊 MUST 只依既有交易或警示流程處理
- **AND** 壓撐 reference、enabled formulas 與 production 權限 MUST 保持不變

#### Scenario: Shioaji Kbars 不可用
- **WHEN** 本機 Shioaji canonical Kbars 無法取得或 business session unavailable
- **THEN** 壓撐 projection MUST 明確 unavailable 或保留最後可證明完整的 reference
- **AND** 系統 MUST NOT 靜默切換至未授權外部資料或假資料
