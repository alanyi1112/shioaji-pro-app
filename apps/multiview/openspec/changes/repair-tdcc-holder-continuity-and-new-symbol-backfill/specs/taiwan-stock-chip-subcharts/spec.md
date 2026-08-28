## ADDED Requirements

### Requirement: 持股副圖完整度必須反映逐日期證據

大戶持股、散戶持股與集保戶數副圖 MUST 使用同一 symbol 的官方日期計畫與逐日期 resolved evidence 顯示 coverage；最新一週可先繪製，但只要中間有 missing date、計畫落後最新官方日期或 runner 尚未接手，pane MUST 顯示可判讀的歷史不足／等待背景回補／背景回補狀態。前端 MUST NOT 以 series 點數、最新日期或後端錯誤 `completed` 單獨隱藏警告。

#### Scenario: 大立光最新一週前有兩個缺週
- **WHEN** pane 可繪製 `2026-08-21`，但逐 symbol coverage 顯示 `2026-08-07` 與 `2026-08-14` 尚未 resolved
- **THEN** 大戶、散戶與集保戶數 pane MUST 保留最新已驗證 series，並顯示歷史缺少 2 週及實際缺週日期
- **AND** MUST NOT 顯示為完整可用或只呈現最新讀值而隱藏缺口

#### Scenario: 新商品只有最新一週
- **WHEN** 新加入商品只有一筆最新 TDCC 分布資料且歷史 target 已 queued
- **THEN** pane MUST 顯示該筆真實大戶／散戶資料與「等待背景回補（1/51 週）」或依實際計畫計算的等效進度
- **AND** 「首筆／無前週比較」MUST NOT 取代 queue／handoff 狀態

#### Scenario: runner 分批寫入新週
- **WHEN** 背景 runner 新增合法週資料或 gap resolution，且 expected／completed／missing evidence 比前次改善
- **THEN** 前端 MUST 使對應 symbol 的 TDCC cache 失效、重新載入並非退化重畫三種 holder panes
- **AND** 進度 MUST 依新 evidence 更新，不得保留過期的完成或排隊文字

#### Scenario: 暫時回應退化
- **WHEN** refresh 回應缺少既有已驗證週、coverage 倒退、來源 timeout 或狀態暫時不可用
- **THEN** pane MUST 保留最後已驗證 series、實際日期與先前 coverage evidence
- **AND** MUST 顯示安全狀態，不能清空線圖、補零或沿用其他 symbol 的資料

#### Scenario: 三種 holder pane 共用一致狀態
- **WHEN** 同一 panel 同時顯示大戶持股、散戶持股與集保戶數
- **THEN** 三個 pane MUST 共用相同 `shareholder-distribution` coverage／backfill evidence 與 request single-flight
- **AND** 每個 pane 的資料 series MAY 不同，但 missing dates、queue 與 handoff 狀態 MUST 一致
