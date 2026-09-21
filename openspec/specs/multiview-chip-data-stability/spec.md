# multiview-chip-data-stability Specification

## Purpose
TBD - created by archiving change add-kbar-turnover-axis-and-daily-minute-drilldown. Update Purpose after archive.
## Requirements
### Requirement: 同 context 籌碼刷新不得清除最後一份已驗證資料
MultiView 籌碼 manager MUST 以 canonical symbol、interval、K 棒日期範圍與排序後 dataset 集合建立 request identity。同一商品與週期刷新期間，manager MUST 保留最後一份已驗證 payload，直到新 response 成功；取消、暫時失敗或載入流程短暫傳入空 K 棒 MUST NOT 將大戶持股或其他既有 pane render 成空集合。

#### Scenario: 主圖重新整理期間暫時沒有 candles
- **WHEN** 同一商品與週期開始重新載入，panel 先以空 candles 更新 context，稍後才提交完整 candles
- **THEN** 大戶持股 MUST 保留最後可用線圖與 readout，不得先消失再出現

#### Scenario: 背景刷新暫時失敗
- **WHEN** 同一商品的籌碼刷新 request 失敗，且 manager 已有一份已驗證 payload
- **THEN** 系統 MUST 顯示暫時不可用提示並保留既有大戶持股資料
- **AND** MUST NOT 以 `{ distributionRows: [] }` 覆蓋該 payload

### Requirement: 籌碼重排與相同 identity reconciliation 不得重抓資料
籌碼 pane 增刪、群組重排或 mode reconciliation 後，若 request identity 沒有改變，manager MUST 重用目前 payload，不得重新發出相同 API request。只有 dataset 集合、商品、週期或日期範圍改變，或使用者明確觸發回補 invalidation，才可重新載入。

#### Scenario: 大戶持股群組置頂
- **WHEN** 使用者將包含大戶持股的群組置頂或置底，且資料 identity 未變
- **THEN** manager MUST 以既有 payload 重繪並只執行 layout refresh
- **AND** MUST NOT 清空大戶線圖或重新呼叫籌碼 API

#### Scenario: 切換商品或週期
- **WHEN** canonical symbol 或 interval 改變
- **THEN** manager MUST abort 舊 waiter、清除舊 payload identity 並以新 context 載入
- **AND** MUST NOT 把前一商品的大戶持股顯示在新商品

### Requirement: 副圖相同 material context 不得重複全量 render
MultiView MUST 將副圖 topology reconciliation、neutral time anchor 更新與 material data render 分開。技術副圖的初次 viewport recovery MUST 重用既有 chart 與 series；籌碼 pane MUST 以排除非可見 refresh metadata 的 payload signature，加上 pane 自身 series／threshold control signature 去重。相同 signature MUST NOT 再清除並建立相同 series。

#### Scenario: 技術副圖初次 time range 尚未成立
- **WHEN** 技術副圖已有合法 indicator points，但初次 layout 後暫時無法讀取 visible time range
- **THEN** recovery MUST resize 既有 chart 並重新套用主圖 logical range
- **AND** MUST NOT `remove()` chart 或遞迴呼叫完整 indicator render

#### Scenario: 日 K context 擴充但籌碼內容未改變
- **WHEN** 同商品日 K 日期範圍改變，籌碼 request 回傳與目前 material payload 相同的可見資料
- **THEN** manager MUST 只更新 pane 的 neutral time anchor，且每個既有 pane MUST NOT 全量重建 series
- **AND** 相同 request identity、純 layout refresh 或群組重排 MUST NOT 建立第二個 API request

#### Scenario: 籌碼實際資料或 pane 控制改變
- **WHEN** response 的可見資料、availability、warning、pane series 選擇或大戶 threshold 實際改變
- **THEN** 受影響 pane MUST 接受一次新的 material render
- **AND** render 成功前不得提前提交 signature，失敗後仍須允許安全重試

### Requirement: 持股副圖必須立即使用已驗證部分歷史

當 shareholder-distribution API 已有至少兩個可比較的 verified periods 時，大戶／散戶持股副圖 MUST 立即按實際資料日期畫線並計算相鄰官方週變化，不得等候 51 週全部完成。副圖 MUST 只比較 official period evidence 中相鄰且資料完整的日期；缺中間週、failed receipt、staging row 或衝突 row MUST NOT 被跳過後誤算為單週變化。

#### Scenario: 8103 從單點變成多期資料

- **WHEN** 8103 已由 verified archive 補入多個相鄰 period，而 official 51 週補缺仍在進行
- **THEN** 大戶與散戶持股副圖 MUST 顯示所有可用 verified points、最新數值與合法前週變化
- **AND** 不得繼續顯示「首筆／無前週比較」作為整體狀態

#### Scenario: 歷史日期不相鄰

- **WHEN** 兩個 verified rows 中間缺少 official period plan 的必要週次
- **THEN** 副圖 MAY 顯示兩個實際資料點，但週變化 MUST 標示不可比較或 history gap
- **AND** 不得把跨週差值冒充單週變化

### Requirement: 副圖必須分離快速補入與完整回補進度

API 與 UI MUST 以可讀狀態區分快速資料準備中、快速補入完成但官方補缺中、51 週完整、來源暫時受阻與資料衝突，並顯示 `displayWeeks`、`expectedWeeks`、`remainingWeeks` 或等價資訊。Archive seed 完成不得讓 51 週未完成的商品顯示為完整；official remaining 不得讓已可用的多期線圖顯示為無資料。

#### Scenario: 快速補入完成而官方仍待 33 週

- **WHEN** 商品有 18 個可顯示 verified periods，51 週 plan 仍有 33 個 distinct dates 待補
- **THEN** UI MUST 顯示類似「已快速補入 18 期；其餘 33 期由 TDCC 背景補足」的事實狀態
- **AND** 線圖與已可計算的相鄰週變化 MUST 保持可用

#### Scenario: Archive 失敗但官方 lane 可用

- **WHEN** archive lane 回傳安全錯誤而 official backfill 仍可繼續
- **THEN** UI MUST 顯示快速來源暫不可用且官方背景補足中，不得顯示全資料失效
- **AND** 最後已驗證 payload、日期、coverage 與線圖 MUST 保留

### Requirement: Progress 更新不得造成資料消失或重複 render

持股 manager MUST 將 distribution material rows 與 progress／receipt metadata 分別建立 signature。只有 material rows、availability 或使用者可見進度實際改變時才可 render；純 heartbeat、fetchedAt、lease 或相同計數更新 MUST NOT 清空 series、重建相同 canvas 或覆蓋最後 verified payload。

#### Scenario: 背景 heartbeat 但資料列未變

- **WHEN** archive／official runner 只更新 heartbeat、lease 或相同 remaining 計數
- **THEN** 已有大戶／散戶 series MUST 保持原 chart／points，不得全量重建
- **AND** 不得重新發出相同 shareholder-distribution GET

#### Scenario: 新 period 完成

- **WHEN** 新的 verified period 使 material rows 或可見 remaining 真正改變
- **THEN** manager MUST 接受一次 material update 並安全重繪受影響副圖
- **AND** render 成功前不得提交新 signature，失敗後仍須保留舊 payload 並允許重試

### Requirement: 持股副圖驗收必須逐商品核對可見資料

完成前 MUST 在實際本機、Sites 保留站與 Cloudflare 正式站逐一核對至少一檔 `.TW`、一檔 `.TWO` 與 8103 的 API distribution rows、實際日期、大戶／散戶聚合值、週變化、狀態文案、可見 canvas 尺寸與 console。全域 pipeline 成功、table 非空、fixture 或單一環境成功 MUST NOT 取代逐商品可見驗收。

#### Scenario: 驗收 8103 最新一期

- **WHEN** 驗收資料 through date 包含 2026-08-28
- **THEN** 8103 的千張以上持股最新值 MUST 與該期 verified source row 的 32.16% 與 11 人一致，散戶聚合 MUST 由相同完整級距計算
- **AND** 線圖 MUST 顯示所有通過 receipt 的實際日期，不得補造不存在的週次

#### Scenario: 某環境仍只有單點

- **WHEN** 本機、Sites 保留站或 Cloudflare 正式站任一環境的 8103 仍只回傳一期或 canvas 無可見歷史
- **THEN** 該環境的資料／UI 任務 MUST 維持未完成並保存 coverage、receipt、network 與 console 證據
- **AND** 不得以其他環境的完成結果代替
