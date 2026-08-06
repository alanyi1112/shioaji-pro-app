# multiview-taiwan-realtime-market-data Specification

## Purpose
TBD - created by archiving change integrate-local-multiview-with-shioaji. Update Purpose after archive.
## Requirements
### Requirement: 台股即時來源必須先完成契約解析與欄位驗證
系統 MUST 將 MultiView canonical symbol 與 Shioaji contract 分離管理。`.TW`／`.TWO` MUST 去除 suffix 後透過 contract API 取得 `security_type`、`exchange`、`code`、`target_code`；`^TWII` MUST 明確映射為 `IX0001`。只有解析成功且 Snapshot／SSE shape 合法的商品才能標示 Shioaji 可用。

#### Scenario: 解析上市與上櫃商品
- **WHEN** panel 載入 `2330.TW` 或 `8069.TWO`
- **THEN** 系統以 Shioaji 回傳契約決定 TSE／OTC 與 security type，不以 suffix 猜測完整 contract body
- **AND** 相同 canonical symbol 的解析結果 MUST 在頁面內去重快取

#### Scenario: 解析台灣加權指數
- **WHEN** panel 載入 `^TWII`
- **THEN** 系統使用 `IX0001` 的 IND contract 與 `quote_idx` 事件更新價格
- **AND** IND 不得顯示可下單狀態

#### Scenario: 契約或 entitlement 不可用
- **WHEN** contract lookup、Snapshot 或 business session 失敗
- **THEN** 商品 MUST 維持 delayed-only 或 unavailable 狀態
- **AND** 系統 MUST NOT 送出猜測的 exchange、security type 或 target code

### Requirement: 使用者必須能辨識並選擇台股來源模式
MultiView MUST 提供頁面層級的 `自動`、`Shioaji 即時`、`Yahoo 延遲`來源模式，預設為 `自動`。每個 panel MUST 顯示實際來源、行情時間、新鮮度與 realtime／delayed／stale／unavailable 狀態，不得只顯示使用者偏好而隱藏實際降級。

#### Scenario: 自動模式即時可用
- **WHEN** Shioaji business request 成功且最新行情在 freshness window 內
- **THEN** 合格台股 panel 使用 Shioaji provisional bar 並標示即時來源與來源時間

#### Scenario: 自動模式即時中斷
- **WHEN** SSE 中斷、資料過期、Snapshot 失敗或 business session 未建立
- **THEN** 系統原子切換至 Yahoo 延遲當期 payload並明確標示 fallback
- **AND** MUST NOT 保留 Shioaji 當期 high／low 卻混入 Yahoo close 或 volume

#### Scenario: 強制 Shioaji 但來源不可用
- **WHEN** 使用者選擇 `Shioaji 即時` 且來源 stale 或 unavailable
- **THEN** 系統顯示最後接受值與不可用狀態，且 MUST NOT 靜默改稱 Yahoo 資料為即時

#### Scenario: 強制 Yahoo 延遲
- **WHEN** 使用者選擇 `Yahoo 延遲`
- **THEN** 頁面釋放 Shioaji panel demand，完全沿用既有 batch／stream 延遲路徑

### Requirement: 日週月未完成 K 棒必須由 canonical 歷史與當期行情正規化聚合
系統 MUST 以既有 completed canonical history 為基底，使用 Shioaji Snapshot／SSE 建立當期 provisional 日 K；週／月 MUST 將同 period 已完成日 K 與當日 provisional 聚合。相同日／週／月 period MUST 先移除既有 provisional 再加入新值，OHLCV 不得重複計入。

#### Scenario: 盤中建立日 K
- **WHEN** 合格台股在交易日取得含 open、high、low、close 與 total volume 的合法 Snapshot
- **THEN** 日 K 當期 bar 使用該 session 欄位並標示 provisional、source time 與 Asia/Taipei session date

#### Scenario: 盤中更新週 K
- **WHEN** 本週已有一個以上 completed daily bars 且今日取得最新 Snapshot
- **THEN** 週 K open 取本週第一個完成日或今日 open、high／low 取全 period 極值、close 取今日最新價、volume 只加總一次

#### Scenario: 月初沒有同月完成日
- **WHEN** 今天是目前月第一個可用交易日
- **THEN** 月 K 直接以今日 provisional OHLCV 建立，不引用前一月資料

#### Scenario: 不合法或倒序行情
- **WHEN** snapshot session date 早於目前 session、timestamp／sequence 倒序或 OHLC 不合法
- **THEN** 該更新 MUST 被丟棄並記錄安全 reason code，不得回寫圖表或 D1

### Requirement: 即時成交量不可用時不得猜測
系統 MUST 分別追蹤 price 與 volume availability。若 IND 或其他 contract 沒有合法 total volume，系統 MUST NOT 以 amount、昨量、零值或 Yahoo volume 混入 Shioaji 即時 bar；依 volume 的即時指標 MUST 顯示 unavailable／canonical-only。

#### Scenario: 指數只有即時價格
- **WHEN** `quote_idx` 提供 OHLC／close／total amount 但沒有合法 total volume
- **THEN** 價格與價格型指標 MAY 即時更新，volume、Volume MA、MFI 與 volume profile MUST NOT 冒充即時
- **AND** UI MUST 顯示成交量來源限制

### Requirement: 同頁必須共用單一 SSE 與去重訂閱
每個 MultiView document MUST 最多建立一條 Shioaji SSE，並以解析後 contract 做 reference-counted subscribe。相同商品出現在多個 panel 時只允許一次實際訂閱；最後 consumer 離開後經短 cooldown 才取消。頁面 visibility、重連、切換與 destroy MUST 清理 demand 並丟棄舊 generation 事件。

#### Scenario: 八圖含重複商品
- **WHEN** 八個 panel 中三個使用相同台股商品
- **THEN** 系統只建立一個該 contract 的行情訂閱，三個 panel 接收同一正規化 snapshot
- **AND** document 中 Shioaji SSE 連線數維持一條

#### Scenario: 快速切換商品
- **WHEN** panel 在 unsubscribe cooldown 內切回原商品
- **THEN** 系統重用原 demand 並取消不必要的 unsubscribe／subscribe 抖動
- **AND** 前一商品的晚到事件不得更新新商品

#### Scenario: 頁面關閉或隱藏
- **WHEN** document 銷毀或依 visibility policy 暫停即時更新
- **THEN** 系統釋放或暫停所有 panel demand，且重連後以目前可見商品重新建立完整 demand snapshot

### Requirement: 即時技術指標必須反映接受後的當期 K 棒
系統 MUST 在合併最新 provisional bar 後，對目前選取且資料可用的主圖／副圖技術指標重算必要尾端。每個 `symbol + interval + indicator signature` MUST 最多有一個 latest-wins job，100～250ms 或 animation frame 內節流；單純 Tick 更新 MUST 重用 pane／series，且不得每筆 Tick 重抓完整 candles 或寫入 D1。

#### Scenario: 同一日 K 連續更新
- **WHEN** 多筆合法 SSE 在 250ms 內改變 current close／high／low／volume
- **THEN** 舊計算被合併或取消，第一個完成的 latest-wins 結果反映最後接受 bar
- **AND** MA、BOLL、KD、MACD、RSI、ATR 與合法 volume 指標的最新值 MUST 與相同 candles 的 full recompute 一致

#### Scenario: 遞迴指標需要前序狀態
- **WHEN** RSI、ATR、EMA 或 MACD 更新 current bar
- **THEN** 計算 MUST 使用完整前序狀態或經證明等價的 checkpoint
- **AND** 系統 MUST NOT 只取可視 window 導致尾端值漂移

#### Scenario: 快速切換 interval
- **WHEN** 舊 interval 計算尚未完成時切換日／週／月
- **THEN** 舊 generation 結果 MUST 被取消或丟棄
- **AND** 新圖不得短暫顯示前一 interval 指標或重建 pane 尺寸

### Requirement: 收盤後必須由官方核定資料取代 provisional
Shioaji provisional bar MUST NOT 直接寫成 completed canonical history。只有既有 TWSE／TPEx 流程完成來源日期對齊、收盤價核對及 verification 成功後，系統才能以 canonical 日 K 取代當日 provisional；週／月 MUST 再由 completed 日 K 重聚合。

#### Scenario: 收盤整理尚未核定
- **WHEN** 市場已收盤但官方日 K 尚未完成核對
- **THEN** panel 保留最後 provisional 並顯示「等待收盤核定」
- **AND** MUST NOT 把最後 Tick 標成已完成或已核對

#### Scenario: 官方核定完成
- **WHEN** canonical payload 的 verification status 與 session date 證明當日已核定
- **THEN** 系統原子移除 realtime provisional、採用 canonical 日 K 並重算週／月與指標
- **AND** 當日 OHLCV MUST 只存在一次

#### Scenario: 官方來源延遲或不一致
- **WHEN** TWSE／TPEx 缺列、日期未對齊或 verification mismatch
- **THEN** 系統保持可見 pending／mismatch 狀態，不得自動把 Shioaji 或 Yahoo 值寫成 verified canonical
