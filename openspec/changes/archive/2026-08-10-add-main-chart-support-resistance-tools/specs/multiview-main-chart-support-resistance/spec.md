## ADDED Requirements

### Requirement: MultiView 主圖必須提供三套 panel-local 壓撐公式
MultiView 每個圖表 panel 的「主圖」選單 MUST 提供 `Pivot Point`、`三關價`、`CDP` 三個可獨立操作的 checkbox。三項開關 MUST 維持 panel-local，不得讀寫或覆蓋主交易畫面的 canonical indicator store；既有均線、布林、成交量、週期與圖表數量設定 MUST 保持不變。

#### Scenario: 在單一 panel 啟用三關價與 CDP
- **WHEN** 使用者在某一 MultiView panel 勾選三關價及 CDP
- **THEN** 系統 MUST 只在該 panel 顯示兩套壓撐線
- **AND** 其他 panel 與主交易畫面的壓撐開關 MUST 保持不變

#### Scenario: 保留所有既有 K 線週期
- **WHEN** 主圖選單加入三關價與 CDP
- **THEN** 1m、5m、15m、60m、日、週、月 K 選項 MUST 全部保留且可載入
- **AND** 任何圖表數量配置 MUST 顯示相同的三個壓撐 checkbox

### Requirement: MultiView 三套公式必須共用同一 reference K 棒與版本化公式
MultiView MUST 以該 panel 現有 Pivot reference K 棒的合法 H／L／C 同時計算 enabled formulas。Pivot Point MUST 保持 `traditional-pivot-tw-v1`；三關價 MUST 使用 `three-level-price-tw-v1`；CDP MUST 使用 `cdp-wilder-tw-v1`。worker MUST 拒絕非有限值、`H<L` 或 `C` 不在 `[L,H]` 的 OHLC，且既有 `selected-next-period-v1` Traditional Pivot 欄位 MUST 保持相容。

#### Scenario: 三套公式共用選定 K 棒
- **WHEN** 同一 panel 同時啟用 Pivot Point、三關價與 CDP
- **THEN** 三套 levels MUST 由同一根 reference K 棒的 H／L／C 計算
- **AND** 任一公式不得自行選擇不同日期或使用 quote 補造 OHLC

#### Scenario: 非法 reference OHLC
- **WHEN** reference K 棒含非法或非有限 OHLC
- **THEN** worker MUST 不產生該 reference 的任何壓撐 projection
- **AND** 前端 MUST 清除舊線而不得沿用其他期間的值

### Requirement: MultiView 必須依來源週期保存 reference 並向較短週期繼承
MultiView MUST 以 `canonical symbol + source interval` 在目前 panel document session 保存各來源週期的 enabled formulas、reference、anchor 與 pinned 狀態。週期階層 MUST 為 `月 > 週 > 日 > 60m > 15m > 5m > 1m`；來源週期建立的壓撐投影 MUST 顯示於相同或更短週期，且不得反向顯示於較長週期。直接點選合法 K 棒與「回到最新」MUST 只改變目前來源週期的所有 enabled formulas。

#### Scenario: 點選其他 K 棒
- **WHEN** 任一壓撐公式已啟用且使用者點選該 panel 的其他合法 K 棒
- **THEN** 所有 enabled formulas MUST 原子改用該 reference 並以該 K 棒為 anchor
- **AND** UI MUST 顯示共用 reference 日期、適用期與 completed／provisional 狀態

#### Scenario: 週線與月線 reference
- **WHEN** 使用者在週 K 或月 K 啟用任一壓撐公式
- **THEN** 系統 MUST 分別使用下一交易週或下一交易月投影契約
- **AND** 不得退化為 daily reference 或移除週／月 K 選項

#### Scenario: 日線投影留置於所有分鐘週期
- **WHEN** 使用者在日 K 啟用任一壓撐公式後切換至 60m、15m、5m 或 1m
- **THEN** 各分鐘圖 MUST 保留並顯示該日線來源的相同 reference 與價位
- **AND** 分鐘圖不得重新計算、改寫或反向清除日線來源投影

#### Scenario: 長週期投影向較短週期繼承
- **WHEN** 使用者在月、週、日、60m、15m 或 5m 建立壓撐投影後切換至階層中較短週期
- **THEN** 系統 MUST 合併顯示所有適用來源週期的投影
- **AND** 較短週期建立的投影 MUST NOT 顯示於任何較長週期

#### Scenario: 來源 K 棒在較短週期定位
- **WHEN** 較長週期投影顯示於較短週期圖表
- **THEN** 線段左側起點 MUST 對應該來源 K 棒涵蓋期間的第一根可見短週期 K 棒並向右延伸
- **AND** 只有該 reference 不在目前資料窗時，才可把起點夾到 plot 左側安全邊界

### Requirement: MultiView 來源週期控制與清除必須隔離
MultiView 的三個 checkbox、直接選棒及「回到最新」MUST 只代表並控制目前來源週期自己的狀態。切換週期 MUST 還原該來源週期自己的 checked state；繼承線不得使目前週期 checkbox 自動勾選。取消公式 MUST 只移除目前來源週期的該公式，繼承自其他週期的投影只能回到其來源週期取消。

#### Scenario: 在分鐘圖取消不得清除日線來源
- **WHEN** 日線來源投影正顯示於分鐘圖，且使用者取消分鐘來源的同名 checkbox
- **THEN** 系統 MUST 只移除分鐘來源的該公式
- **AND** 日線來源投影 MUST 保留，直到使用者回到日 K 取消日線來源 checkbox

#### Scenario: 回到來源週期取消繼承線
- **WHEN** 使用者回到建立投影的來源週期並取消該來源最後一個公式
- **THEN** 系統 MUST 從該來源週期及所有較短週期移除該來源的 reference、線、標籤與 autoscale contribution
- **AND** 其他來源週期及其他 panel 的投影 MUST 保持不變

#### Scenario: 切換週期還原來源週期 checkbox
- **WHEN** 日線已勾選 CDP、分鐘來源未勾選 CDP，且使用者由日切換至分鐘
- **THEN** 分鐘週期的 CDP checkbox MUST 保持未勾選
- **AND** 畫面仍 MUST 顯示帶有日線來源標示的繼承 CDP 線

### Requirement: MultiView 壓撐線必須向右投影且共同避碰
MultiView MUST 將目前目標週期可見的所有來源投影 levels 合併交由單一 overlay 與 autoscale。每條線 MUST 從其來源 reference K 棒的 anchor 向右延伸；右側標籤 MUST 顯示來源週期、公式前綴、level 名稱及格式化價位，並在相近價位共同避碰且以 connector 指回真實價格。左上角 MUST 只顯示目前來源週期的共用 reference 狀態與「回到最新」，不得重複列出任何 level 值。

#### Scenario: 三套公式同時啟用
- **WHEN** 三套公式皆有合法 projection
- **THEN** overlay MUST 呈現十五條可識別的水平線與右側價位標籤
- **AND** autoscale MUST 納入十五個有限價位且標籤不得互相遮蔽

#### Scenario: 個別取消 CDP
- **WHEN** Pivot Point、三關價與 CDP 均已啟用且使用者取消 CDP
- **THEN** 系統 MUST 只移除 AH、NH、CDP、NL、AL 的線、標籤及 autoscale contribution
- **AND** Pivot Point、三關價及共用 reference MUST 保持不變

#### Scenario: 取消最後一個公式
- **WHEN** 使用者取消該 panel 最後一個壓撐公式
- **THEN** 系統 MUST 清除 reference、overlay、右側標籤及 autoscale contribution
- **AND** 不得影響其他主圖指標或其他 panel
