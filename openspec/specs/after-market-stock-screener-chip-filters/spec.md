# after-market-stock-screener-chip-filters Specification

## Purpose
TBD - created by archiving change add-chip-filters-to-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: TDCC 籌碼條件必須使用固定且完整的官方級距

系統 MUST 將「千張大戶」固定定義為 TDCC 第 15 級「1,000,001 股以上」，將「10 張以下散戶」固定定義為第 1–3 級合計，且只可使用 1–15 級、調整與合計均完整並通過對帳的官方週資料。系統 MUST 提供「千張大戶比例區間且連續上升」、「千張大戶人數下降且持股股數增加」及「10 張以下散戶持股比例下降」三項獨立條件；連續週數限 1–12，比例與最小週變門檻最多兩位小數。

#### Scenario: 千張大戶比例在區間內且連續上升

- **WHEN** 最新第 15 級比例位於使用者設定的含端點區間，且指定數量的每一個相鄰官方週差皆嚴格大於最小週增門檻
- **THEN** 千張大戶比例條件 MUST 判定 `pass`，並保存每週比例、百分點差、級距、日期與來源 evidence

#### Scenario: 大戶人數減少且持股股數增加

- **WHEN** 指定數量的每一個相鄰官方週轉換都同時呈現第 15 級 holders 減少與 shares 增加
- **THEN** 大戶籌碼集中條件 MUST 判定 `pass`，且不得只以 ratio 上升代替兩個原始欄位

#### Scenario: 散戶持股比例下降

- **WHEN** TDCC 第 1–3 級合計 ratio 在指定數量的每一個相鄰官方週轉換都下降
- **THEN** 散戶持股下降條件 MUST 判定 `pass`，並明示第 1–3 級代表 10 張以下

#### Scenario: 缺週或級距不完整

- **WHEN** 任一必要週不是 official period plan 的相鄰週，或任一級距、holders、shares、ratio、調整或合計無法驗證
- **THEN** 受影響條件 MUST 判定 `unknown` 並提供 `history_gap`、`incomplete_tdcc` 或對應原因，不得跳週、補零或用其他級距替代

### Requirement: 投信買超占股本必須使用相鄰交易日與快照分母

「投信 N 日買超占股本」MUST 將 5–10 個相鄰官方交易日的 `investmentTrustNetShares` 以 signed integer 加總，再除以同一 snapshot 綁定且大於零的 `issuedCommonShares` 並乘 100。門檻 MUST 可設定、最多兩位小數；只有累計買超為正且比率達含端點門檻時為 `pass`。

#### Scenario: 五日投信買超占股本達標

- **WHEN** 商品有連續五個官方交易日的投信淨買賣超、對應有效普通股數，且累計淨買超占股本達設定門檻
- **THEN** 條件 MUST 判定 `pass`，evidence MUST 包含五日 signed rows、累計股數、分母、百分比、日期與公式版本

#### Scenario: 區間包含賣超日

- **WHEN** N 日內同時有買超與賣超
- **THEN** 系統 MUST 依 signed sum 計算，不得只加總正值或將賣超改成零

#### Scenario: 分母或交易日不完整

- **WHEN** `issuedCommonShares` 為零、缺漏、晚於 effective session 才生效，或 N 日序列缺少必要交易日
- **THEN** 條件 MUST 判定 `unknown`，不得以外資持股分母、目前股本、前值或 requested date 代替

### Requirement: 股價上漲且融資下降條件必須比較同一交易區間

系統 MUST 提供 1–20 個相鄰交易日的 lookback。只有目前收盤價嚴格大於區間起點收盤價，且目前 `marginTodayBalanceLots` 小於或等於起點餘額時，條件才 MUST 為 `pass`；兩個端點 MUST 屬於相同商品與同一 snapshot 的官方 session plan。

#### Scenario: 價漲且融資減少

- **WHEN** 目前收盤價高於 N 個交易日前且目前融資餘額低於起點
- **THEN** 條件 MUST 判定 `pass`，並顯示兩個端點的日期、收盤價、融資張數與差值

#### Scenario: 價漲且融資持平

- **WHEN** 目前收盤價高於起點且兩端融資餘額相等
- **THEN** 條件 MUST 判定 `pass`，不得要求融資必須嚴格下降

#### Scenario: 任一端點缺漏

- **WHEN** 收盤價或融資餘額任一端點缺失、無效、日期不相鄰或來源日期不符
- **THEN** 條件 MUST 判定 `unknown`，不得 forward-fill 或跨過停牌／缺日後冒充相鄰區間

### Requirement: 券資比必須使用同日可驗證餘額

券資比 MUST 定義為同一交易日 `shortTodayBalanceLots ÷ marginTodayBalanceLots × 100`，門檻限 0.01–1000 且最多兩位小數。只有比率達含端點門檻時為 `pass`。

#### Scenario: 同日券資比達標

- **WHEN** 同日融券與融資餘額均為合法非負整數、融資大於零且計算結果達門檻
- **THEN** 條件 MUST 判定 `pass`，evidence MUST 顯示兩個原始餘額、比率、日期、單位與公式版本

#### Scenario: 融資餘額為零

- **WHEN** 融資餘額為零，或融資與融券不是同一 session
- **THEN** 條件 MUST 判定 `unknown`，不得回傳 Infinity、零或自動改用融資限額

### Requirement: 近期新高與均線突破必須是獨立且可重現的價格條件

「收盤價創近期新高」MUST 使用 2–120 個相鄰交易日，要求目前收盤價嚴格大於前 N-1 日所有收盤價。「收盤價突破均線」MUST 只允許 SMA5、SMA10、SMA20、SMA60，並要求前一交易日 close 小於或等於同日 SMA、目前 close 大於目前 SMA。兩者 MUST 與既有均線糾結／黃金交叉條件分開。

#### Scenario: 收盤價創二十日新高

- **WHEN** 目前 close 嚴格高於前十九個相鄰交易日 close
- **THEN** 近期新高條件 MUST 判定 `pass`，evidence MUST 包含期間、先前最高 close、目前 close 與各自日期

#### Scenario: 收盤價向上突破 SMA20

- **WHEN** 前一日 close 不高於前一日 SMA20，且目前 close 高於目前 SMA20
- **THEN** 均線突破條件 MUST 判定 `pass`，並保存前後兩日 close 與 SMA20

#### Scenario: 歷史或暖機不足

- **WHEN** N 日 close 或 SMA period 所需的相鄰 OHLCV 不完整
- **THEN** 對應條件 MUST 判定 `unknown` 並區分 `insufficient_history`、`missing_ohlcv` 與 `non_adjacent_sessions`

### Requirement: 新舊條件必須共用可驗證的三態組合

八項新條件 MUST 與既有成交量、TDCC、K 棒、BOLL、均線與背離條件共同參與一個全域 `all`／`any` 組合。`all` MUST 在任一 enabled condition 為 fail 時為 fail，沒有 fail 但至少一項 unknown 時為 unknown；`any` MUST 在任一 enabled condition 為 pass 時為 pass，沒有 pass 但至少一項 unknown 時為 unknown。disabled condition MUST 不參與判定、缺漏統計或 fingerprint。

#### Scenario: 任一符合已有一項 pass

- **WHEN** 組合為 `any`，投信條件為 pass 而 TDCC 條件因缺週為 unknown
- **THEN** 商品 MUST 列入 pass 結果，同時保留 TDCC 的 unknown evidence 與逐條件缺漏數

#### Scenario: 全部符合含未知條件

- **WHEN** 組合為 `all`，沒有 enabled condition 為 fail，但至少一項為 unknown
- **THEN** 商品總 verdict MUST 為 unknown，不得以其餘 pass 條件推定全部符合

### Requirement: 籌碼結果必須提供逐條件證據與穩定排序

每筆結果 MUST 保存 snapshot ID、criteria fingerprint、formula／mapping version、daily／weekly anchors、逐條件 verdict／reason 與 canonical evidence hash。UI MUST 能展開查看原始日期、數值、單位、分子、分母與比較式，並提供與新條件對應的穩定排序；cursor MUST 綁定相同 snapshot 與 criteria。

#### Scenario: 依投信占股本排序

- **WHEN** 使用者依投信 N 日買超占股本排序並翻頁
- **THEN** 每頁 MUST 使用相同 snapshot、N、門檻、分母 revision 與 deterministic code tie-break，不得跨頁重複或遺漏

#### Scenario: 新快照在翻頁期間發布

- **WHEN** 既有 cursor 所屬 snapshot 已被新 snapshot 取代
- **THEN** API MUST 完成同 snapshot 的安全分頁或回報 snapshot expired，不得混合新舊 evidence

### Requirement: 長線佈局預設不得直接執行或宣稱績效

系統 MUST 提供「長線佈局」draft 預設，啟用千張大戶比例連續三週上升、10 張以下散戶比例下降及股價上漲且融資下降或持平，並將組合設為 `all`。套用預設 MUST 只更新尚未提交的 draft，不自動查詢、寫入清單、通知或宣稱勝率。

#### Scenario: 套用長線佈局預設

- **WHEN** 使用者啟用「長線佈局」預設
- **THEN** UI MUST 顯示上述 enabled conditions 與參數並標示尚未套用，直到使用者明確按「開始篩選」

### Requirement: 缺少券商分點或持股存量資料的名稱不得出現在本次條件

本次產品 MUST NOT 提供或宣稱「主力連買」、「買賣家數差」、「主力未賣超」或「投信初次認養」條件，除非未來另有 change 證明券商分點或投信實際持股存量的正式來源、授權、日期、coverage 與公式。三大法人／投信每日買賣超是流量資料，MUST NOT 被標示為上述存量或主力資料。

#### Scenario: 只有三大法人買賣超資料

- **WHEN** snapshot 只有外資、投信、自營商或三大法人每日買賣超
- **THEN** UI 與 API MUST 只使用對應法人名稱，不得輸出主力連買、買賣家數差、主力未賣超或投信持股由零轉正的 verdict
