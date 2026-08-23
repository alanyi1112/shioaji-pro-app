## MODIFIED Requirements

### Requirement: 使用者必須能辨識並選擇台股來源模式
本機 MultiView MUST 提供頁面層級的 `自動`、`Shioaji 即時`、`Yahoo 延遲`來源模式，預設為 `自動`。日 K 與 1m／5m／15m／60m panel MUST 顯示實際來源、行情時間、新鮮度、continuity 與 realtime／delayed／stale／unavailable 狀態；台股整股 volume MUST 顯示 canonical `common_lot`（張）單位及來源，不得只顯示使用者偏好而隱藏實際降級。分鐘 K 與日 K 的來源切換 MUST 以完整 canonical candle payload 為單位原子進行，不得混接不同 provider 或不同 volume unit 的 OHLCV，也不得把 partial 冒充 complete。Cloudflare／Sites 不得因本 change 啟用 Shioaji realtime。

#### Scenario: 自動模式 Shioaji 可用
- **WHEN** Shioaji simulation business request、一次性 Kbars bootstrap 與最新行情在 freshness window 內成功
- **THEN** 合格台股分鐘 panel MUST 使用 Shioaji canonical Kbars 與 provisional bucket，日 K panel MUST 使用由同一 Shioaji Kbars 日聚合的完整可見 display payload與當日 provisional tail
- **AND** 系統 MUST 標示 Shioaji、來源時間、continuity 與 `common_lot`，不得把 Yahoo／TWSE volume 混入該 payload

#### Scenario: 自動模式即時中斷
- **WHEN** SSE 中斷、資料過期、Snapshot 失敗、Kbars bootstrap 失敗或 business session 未建立
- **THEN** 系統 MUST 原子切換至相同 interval、已正規化 volume unit 的 Yahoo／TWSE 延遲完整 payload並明確標示 fallback
- **AND** 系統 MUST NOT 保留 Shioaji open／high／low／volume 卻混入其他 provider 的 close、time、volume 或 unit

#### Scenario: 強制 Shioaji 但來源不可用
- **WHEN** 使用者選擇 `Shioaji 即時` 且來源 stale、partial 或 unavailable
- **THEN** 系統 MUST 顯示最後接受的完整同源 candle set 與精確不可用／部分狀態
- **AND** 系統 MUST NOT 靜默切換、拼接 Yahoo 資料或把非 Shioaji 資料稱為即時

#### Scenario: 強制 Yahoo 延遲
- **WHEN** 使用者選擇 `Yahoo 延遲`
- **THEN** 頁面 MUST 釋放 Shioaji panel demand，完全沿用相同 interval 的既有 batch／stream 延遲路徑，並在 indicators 與繪圖前將可信台股 share volume 正規化為 `common_lot`
- **AND** 分鐘／日 K accumulator MUST NOT 繼續把晚到 Shioaji Tick 寫入目前 panel

#### Scenario: 遠端環境維持關閉
- **WHEN** Cloudflare／Sites 載入相同前端 bundle 或 `/api/config`
- **THEN** 系統 MUST 維持遠端 Shioaji realtime feature-off
- **AND** 不得要求任何 credential、帳戶、多帳戶驗收或 production 啟用

## ADDED Requirements

### Requirement: 本機台股整股日 K 成交量必須統一為張並與主交易畫面同源對照
本機 MultiView 對整股 STK MUST 將 canonical chart volume 單位固定為 `common_lot`（張）。Shioaji Kbars／Tick 已是 lot，MUST 採 identity conversion；Yahoo／TWSE share volume MUST 除以 1,000 並保留合法小數張。volume normalizer MUST 在成交量柱、readout、Volume MA、MFI、Volume Profile 及其他 volume-derived indicators 前執行，且 payload MUST 攜帶 provider、source volume unit 與 normalization revision。

#### Scenario: 相同 Shioaji Kbars 跨畫面 parity
- **WHEN** 主交易畫面與本機 MultiView 對同一 STK、同一台北日期及同一批合法 Shioaji 1 分 Kbars 聚合日 K
- **THEN** 兩個 runtime 的 daily open、high、low、close 與 `common_lot` volume MUST 完全相同
- **AND** volume readout、成交量柱及由 volume 衍生的輸入 MUST 使用該相同值

#### Scenario: MultiView 主圖 K 線 readout 顯示順序
- **WHEN** MultiView 主圖顯示一根具有合法 OHLCV 與前一根收盤價的 canonical candle
- **THEN** readout MUST 依序顯示日期、開、高、低、收、成交量與漲跌，且成交量 MUST 使用該 candle 的 `common_lot` 值與「張」單位
- **AND** 該 readout MUST NOT 顯示漲跌幅，也不得由另一個 DOM readout 複製成交量文字

#### Scenario: Yahoo 或 TWSE 股數正規化
- **WHEN** fallback row 的可信 source volume 為 12,345 shares
- **THEN** MultiView canonical volume MUST 為 12.345 common lots，且 provider／source unit MUST 保持可辨識
- **AND** 系統 MUST NOT 四捨五入為 12、顯示 12,345 張或宣稱 fallback 值與 Shioaji 來源值完全相同

#### Scenario: 盤中日 K 不得混用單位
- **WHEN** completed display bars 與當日 provisional bar 需要顯示在同一日 K panel
- **THEN** 所有 bars MUST 在進入同一 payload 前具有相同 `common_lot` canonical unit
- **AND** 系統 MUST NOT 把 Yahoo／TWSE shares 與 Shioaji lots 直接相加、比較或交給同一 volume-derived indicator

#### Scenario: Bootstrap 後 total volume 只推進一次
- **WHEN** Shioaji bootstrap 已包含當日累計 100 張，後續合法 Snapshot／Tick 的 `total_volume` 依序為 103、103、105 張
- **THEN** provisional 日 K MUST 依序只增加 3、0、2 張
- **AND** 重送 sequence、倒序 source time、舊 session、舊 generation 或累計量倒退 MUST NOT 再增加 volume

#### Scenario: 未知或舊單位報告
- **WHEN** cache／payload 缺少可信 provider、source volume unit 或目前 normalization revision
- **THEN** 系統 MUST 依可信 source metadata 重新正規化、失效重抓或標示 volume unavailable
- **AND** 系統 MUST NOT 將舊 share 值直接當 common lot、以布林值冒充 migration 或讓未知單位進入指標

#### Scenario: 本機 Shioaji display 不取得官方核定身分
- **WHEN** MultiView 以 Shioaji Kbars 顯示一個以上已結束台北日期的日 K
- **THEN** 該資料 MAY 作為本機同源 display 與主畫面 parity 證據，但 MUST NOT 因此寫入 D1 verified canonical history或標示 TWSE／TPEx verification 成功
- **AND** 既有收盤核定、日期對齊與 mismatch 流程 MUST 維持不變
