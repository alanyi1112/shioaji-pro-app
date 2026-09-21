## ADDED Requirements

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
