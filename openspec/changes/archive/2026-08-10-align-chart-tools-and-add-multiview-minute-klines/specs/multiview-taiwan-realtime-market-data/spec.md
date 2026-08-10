## MODIFIED Requirements

### Requirement: 使用者必須能辨識並選擇台股來源模式
本機 MultiView MUST 提供頁面層級的 `自動`、`Shioaji 即時`、`Yahoo 延遲`來源模式，預設為 `自動`。日 K 與 1m／5m／15m／60m panel MUST 顯示實際來源、行情時間、新鮮度、continuity 與 realtime／delayed／stale／unavailable 狀態，不得只顯示使用者偏好而隱藏實際降級。分鐘 K 的來源切換 MUST 以完整 canonical candle payload 為單位原子進行，不得混接不同 provider 的 OHLCV 或把 partial 冒充 complete。Cloudflare／Sites 不得因本 change 啟用 Shioaji realtime。

#### Scenario: 自動模式即時可用
- **WHEN** Shioaji business request、一次性 Kbars bootstrap 與最新行情在 freshness window 內成功
- **THEN** 合格台股分鐘 panel MUST 使用 Shioaji canonical Kbars 與 provisional bucket，並標示即時來源、來源時間及 continuity
- **AND** 日 K MUST 維持既有 Shioaji provisional bar 行為

#### Scenario: 自動模式即時中斷
- **WHEN** SSE 中斷、資料過期、Snapshot 失敗、Kbars bootstrap 失敗或 business session 未建立
- **THEN** 系統 MUST 原子切換至相同 interval 的 Yahoo 延遲完整 payload 並明確標示 fallback
- **AND** MUST NOT 保留 Shioaji open／high／low／volume 卻混入 Yahoo close、time 或其他欄位

#### Scenario: 強制 Shioaji 但來源不可用
- **WHEN** 使用者選擇 `Shioaji 即時` 且來源 stale、partial 或 unavailable
- **THEN** 系統 MUST 顯示最後接受的完整 candle set 與精確不可用／部分狀態
- **AND** 系統 MUST NOT 靜默切換或把 Yahoo 資料稱為即時

#### Scenario: 強制 Yahoo 延遲
- **WHEN** 使用者選擇 `Yahoo 延遲`
- **THEN** 頁面 MUST 釋放 Shioaji panel demand，完全沿用相同 interval 的既有 batch／stream 延遲路徑
- **AND** 分鐘 accumulator MUST NOT 繼續把晚到 Shioaji Tick 寫入目前 panel

#### Scenario: 遠端環境維持關閉
- **WHEN** Cloudflare／Sites 載入相同前端 bundle 或 `/api/config`
- **THEN** 系統 MUST 維持遠端 Shioaji realtime feature-off
- **AND** 不得要求任何 credential、帳戶、多帳戶驗收或 production 啟用
