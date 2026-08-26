# daily-minute-drilldown Specification

## Purpose
TBD - created by archiving change add-kbar-turnover-axis-and-daily-minute-drilldown. Update Purpose after archive.
## Requirements
### Requirement: 日 K 雙擊必須載入選取日期的精確 1 分 K
主交易畫面及 MultiView 單一圖表 MUST 在使用者以滑鼠左鍵雙擊有效日 K 棒時，以該 canonical candle 的 `Asia/Taipei` session date 建立指定日期 1 分 K request。系統 MUST 在原日 K 仍可見時載入並驗證該日期資料，只有合法結果可原子提交為 `1m`；不得把最近、今天或其他日期 1 分 K 當成選取日期。MultiView 多圖模式仍必須遵循 `multiview-workspace-navigation` 的雙擊開單圖契約。

#### Scenario: 成功進入歷史交易日 1 分 K
- **WHEN** 使用者雙擊一根已完成日 K，且 simulation-only source 回傳該日期至少一根合法 1 分 K
- **THEN** 圖表 MUST 原子切換為相同商品的 `1m` 並只顯示該 target date 的已接受 candles
- **AND** viewport MUST 對準該日實際第一根至最後一根 K，不得滾回 realtime 或最近三日

#### Scenario: 選取日期無資料
- **WHEN** 指定日期請求回傳空資料、混入其他日期、schema 非法、商品不符或來源不可用
- **THEN** 圖表 MUST 保留原日 K、原 viewport、原工具與原 interval
- **AND** UI MUST 顯示可辨識 target date 與安全 reason code，不得顯示空白 1 分圖或其他日期資料

#### Scenario: 快速切換造成舊結果晚到
- **WHEN** target-date request 尚未完成，使用者切換商品、interval、panel 或發起較新的 drill-down
- **THEN** 舊 request MUST 被取消或其結果被 generation guard 丟棄
- **AND** 舊資料 MUST NOT 改寫目前 interval、candles、readout、source metadata 或 viewport

### Requirement: 指定日期資料必須維持來源與 simulation 安全邊界
drill-down loader MUST 沿用目前已授權的本機 simulation market-data adapter、有界單日範圍、single-flight、response size 與 schema guard。來源只有最近 1 分資料、不能指定 target date、不是 simulation 或無法證明商品與日期時 MUST fail closed；不得因此啟動 production、CA、broker authority、遠端 realtime 或服務。

#### Scenario: MultiView 多圖雙擊不進入指定日期 loader
- **WHEN** 使用者在 MultiView 2／3／4／6／8 圖模式雙擊任一可開啟單圖的 panel 內容
- **THEN** MultiView MUST 開啟該商品單圖，且 MUST NOT 建立 target-date request

#### Scenario: MultiView 單圖日 K 精確載入
- **WHEN** 使用者在 MultiView 圖表數量為 1 時雙擊一根有效且已完成的日 K，且 local Shioaji simulation 回傳同日合法 1 分 K
- **THEN** 原 panel MUST 原子切換為該日期 `1m` 並 fit 該 session
- **AND** MUST NOT 開新分頁、接入目前 realtime candles或顯示其他日期

#### Scenario: 相同日期請求去重
- **WHEN** 相同商品與 target date 的多個 consumer 同時要求 1 分 K
- **THEN** 相同 source identity／symbol／date request MUST 使用 page-scoped single-flight
- **AND** 每個 consumer 只得提交符合自身最新 generation 的不可變 snapshot

#### Scenario: 非 simulation runtime
- **WHEN** local market-data adapter 回報 production、模式不明或 business session 未建立
- **THEN** drill-down MUST fail closed 並保留原日 K
- **AND** MUST NOT 嘗試登入、切換 mode、取得 broker authority或送出任何委託

### Requirement: 雙擊導覽必須服從圖表工具 gesture ownership
主交易畫面只有日 K、有效 candle、左鍵、一般觀察狀態且沒有 pending drawing 或交易點價 ownership 時，雙擊才 MUST 觸發 drill-down。主交易畫面日 K 觀察模式的單擊選棒 MUST 經 bounded gesture arbiter 延後提交；同一 K 棒第二擊成立時 MUST 取消單擊副作用。其他工具與交易模式 MUST 保留既有 ownership，不得被 drill-down 穿透。

#### Scenario: 觀察模式雙擊不先固定壓撐
- **WHEN** 壓撐已啟用且使用者在日 K 觀察模式雙擊同一根有效 K 棒
- **THEN** 系統 MUST 執行該日期 drill-down，且 MUST NOT 先保存或廣播該 K 棒為 pinned reference
- **AND** 若 drill-down 失敗，原 reference MUST 保持不變

#### Scenario: 單擊仍可選取壓撐 reference
- **WHEN** 使用者只單擊一根合法日 K 且 bounded double-click 判定窗結束
- **THEN** 既有壓撐選棒 MUST 正常提交一次
- **AND** 不得切換 interval 或發出 target-date request

#### Scenario: 繪圖工具持有 pointer
- **WHEN** 費波那契、價格範圍、固定範圍 VP 或其他合法圖表工具正在等待錨點
- **THEN** click／double-click MUST 只交由該工具既有狀態機處理
- **AND** MUST NOT 切換為 1m、建立半套 drill-down 或清除 pending tool

#### Scenario: 交易點價模式
- **WHEN** 主交易畫面處於 buy、sell、alert 或其他交易相關 click mode
- **THEN** 該 gesture MUST 不具 drill-down 資格，既有一次性交易／警示邊界保持不變
- **AND** 新增的雙擊 handler MUST NOT 造成延遲、重送、第二筆 broker write 或權限擴張

### Requirement: drill-down commit 與返回操作必須維持一致 context
成功 commit MUST 同時更新 interval、canonical candles、來源 metadata、readout、成交量 availability、day boundaries、indicators 與 viewport，且保持相同商品及 panel identity。使用者後續以既有 interval selector 返回日 K 時 MUST 走一般日 K 載入契約，不得把單日 1 分 payload 冒充日 K cache。

#### Scenario: 原子提交所有圖層
- **WHEN** target-date payload 通過驗證並成為最新 generation
- **THEN** K 棒、成交量、readout、技術指標與跨日 primitive MUST 同步切換至同一 1 分 candle set
- **AND** 畫面 MUST NOT 短暫混用日 K overlay、其他日期 volume 或舊來源 readout

#### Scenario: 返回日 K
- **WHEN** 使用者在 drill-down 後由 interval selector 選回日 K
- **THEN** 系統 MUST 依既有日 K source、cache 與 viewport 契約重新載入
- **AND** 單日 1 分 payload MUST NOT 被保存或誤讀為日 K canonical history

#### Scenario: MultiView 單圖載入期間 context 漂移
- **WHEN** exact-date response 返回前，圖表數量、商品、週期、panel generation 或較新的 drill-down 已改變
- **THEN** 舊 response MUST 被丟棄且不得停止新 context stream或改寫 interval
- **AND** 原日 K或新 context MUST 保持完整，不得顯示半套 target-date projection

### Requirement: MultiView指定日期1分K必須原子保留成交值availability
MultiView單圖的target-date loader MUST 從同一次simulation Shioaji Kbars response驗證`Amount`，並把每根合法`turnoverTwd`或明確unavailable狀態納入不可變response、staged projection與atomic commit。成交值缺漏 MUST NOT 阻止合法OHLCV drill-down，但系統 MUST NOT 在commit後從目前realtime、其他日期、Yahoo、舊cache或估算來源補接。

#### Scenario: 指定日期Amount完整
- **WHEN** target-date response的datetime、OHLCV、Volume與Amount欄位長度一致，且每根Amount均為合法非負safe integer元值
- **THEN** 原子commit後每根1分K MUST 保留同列精確成交值
- **AND** candles、volume、turnover availability、readout、indicators及viewport MUST 屬於同一target date與generation

#### Scenario: 指定日期Amount缺漏但OHLCV合法
- **WHEN** target-date response具有合法同日OHLCV與Volume，但Amount欄位缺漏、長度不符或某列無效
- **THEN** drill-down MUST 仍可提交合法OHLCV，受影響candle readout MUST 顯示`值 —`
- **AND** 系統 MUST NOT 以close乘volume、其他日期Amount或目前realtime Tick補值

#### Scenario: 快速切換後舊turnover結果晚到
- **WHEN** target-date staged snapshot尚未commit，商品、panel、interval、source identity、schema revision或generation已改變
- **THEN** 舊snapshot的candles與turnover availability MUST 一起被丟棄
- **AND** MUST NOT 只把舊成交值接到目前panel

#### Scenario: 返回一般日K
- **WHEN** 使用者從指定日期1分K切回日K
- **THEN** 系統 MUST 依一般日K provider及cache契約重新載入成交值availability
- **AND** 單日simulation Amount MUST NOT 寫入或冒充Yahoo、Cloudflare或D1日K成交值

### Requirement: 主交易畫面指定日期1分K必須原子保留成交值availability
主交易畫面的target-date loader MUST 從同一次Shioaji simulation Kbars response驗證每根1分K的`Amount`，並將合法精確成交值或明確unavailable狀態與相同symbol、target date、generation及canonical candle一起提交。成交值缺漏 MUST NOT 阻止合法OHLCV drill-down，但系統 MUST NOT 在commit後從其他日期、最新行情或估算來源補接成交值。

#### Scenario: 指定日期回傳完整Amount
- **WHEN** 主交易畫面指定日期response的datetime、OHLCV、Volume及Amount欄位長度一致，且每根Amount均合法
- **THEN** atomic commit後每根1分K readout MUST 顯示同列精確成交值的萬元格式
- **AND** candles、volume、turnover availability、readout、indicators及viewport MUST 屬於同一不可變snapshot與generation

#### Scenario: 指定日期Amount缺漏但OHLCV合法
- **WHEN** target-date response具有合法同日OHLCV與Volume，但Amount欄位缺漏、長度不符或某列無效
- **THEN** drill-down MUST 仍可原子顯示合法1分K，受影響readout MUST 顯示`值 —`
- **AND** 系統 MUST NOT 以close乘volume、其他日期Amount或目前realtime Tick補值

#### Scenario: 舊target-date response晚到
- **WHEN** 含成交值的舊response返回前，商品、日期、interval、panel identity或generation已改變
- **THEN** 舊candles與成交值 MUST 一起被丟棄
- **AND** 舊成交值 MUST NOT 單獨寫入目前readout或形成中cursor

#### Scenario: MultiView指定日期loader
- **WHEN** MultiView單圖依既有契約載入指定日期1分K
- **THEN** MultiView的Amount、成交值readout與turnover metadata MUST 依`multiview-kbar-turnover-readout` capability及自身target-date atomic commit契約處理
- **AND** 主交易畫面的request、snapshot、generation或forming cursor MUST NOT 被重用或寫入MultiView
