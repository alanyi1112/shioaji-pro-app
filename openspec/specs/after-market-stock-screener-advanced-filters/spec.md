# after-market-stock-screener-advanced-filters Specification

## Purpose
TBD - created by archiving change extend-after-market-stock-screener-with-turnover-and-holder-reversal. Update Purpose after archive.
## Requirements
### Requirement: 兩個選股條件必須各自提供可選的最低成交值限制

成交量與千張大戶條件 MUST 各自提供「最低成交值」開關與以萬為單位的十進位門檻。成交值限制 MUST 只與所屬條件作 AND，MUST NOT 單獨成為可通過的第三條件；兩個條件之間仍依使用者選擇的 `all`／`any` 組合。門檻 MUST 限 0.01–10,000,000 萬、最多兩位小數，並精確換算為新臺幣整數元比較。

#### Scenario: 成交量條件啟用成交值

- **WHEN** 商品成交量為前一交易日三倍，成交值低於該條件設定的最低成交值
- **THEN** 成交量條件 MUST 為 fail，且結果 MUST 分別顯示量增判定與成交值限制判定

#### Scenario: OR 模式不得由成交值單獨通過

- **WHEN** 兩個主要條件均未達標，但商品成交值高於任一已啟用門檻
- **THEN** `any` 組合 MUST 仍為 fail，成交值 MUST NOT 單獨使商品入選

#### Scenario: 停用成交值限制

- **WHEN** 某條件的成交值開關關閉，且商品缺少當日成交值
- **THEN** 該條件 MUST 只依原本訊號判定，不得因未啟用的成交值資料缺漏變成 unknown

#### Scenario: 大戶條件需要當日成交值

- **WHEN** 使用者只啟用大戶條件並開啟其最低成交值限制，但最新共同交易日 D 缺少合法成交值
- **THEN** 該商品的大戶條件 MUST 為 unknown 並指出 D 與缺漏欄位，不得沿用較早交易日成交值

### Requirement: 大戶條件必須提供單週與兩種反轉模式

大戶條件 MUST 提供 `weekly-increase`、`decrease-to-increase`、`increase-to-decrease` 三種互斥模式。單週增加 MUST 保留最新週變化大於等於可設定門檻 X 的既有語意；反轉模式的 X MUST 限 0.01–100 個百分點、最多兩位小數，預設為 0.2 個百分點，連續週數 N MUST 可設定 1–4。

#### Scenario: 單週增加維持相容

- **WHEN** 使用者選擇單週增加、門檻 0.2，且 W 與 Wprev 的第 15 級比例分別為 60.20% 與 60.00%
- **THEN** 大戶條件 MUST pass，結果與 v1 相同

#### Scenario: 由減轉增四週成立

- **WHEN** 六期比例依序造成前四次相鄰週變化皆小於 0，最新一次變化大於等於 +0.2 個百分點，且 N 設為 4
- **THEN** `decrease-to-increase` MUST pass，並顯示六個實際週期、前段連續長度與最新反轉幅度

#### Scenario: 由增轉減四週成立

- **WHEN** 六期比例依序造成前四次相鄰週變化皆大於 0，最新一次變化小於等於 -0.2 個百分點，且 N 設為 4
- **THEN** `increase-to-decrease` MUST pass，門檻 MUST 以最新減少幅度的絕對百分點比較

#### Scenario: 零變化中斷連續狀態

- **WHEN** 反轉前要求的 N 次變化中任一次等於 0.00 個百分點
- **THEN** 反轉條件 MUST fail，不得把持平視為增加或減少

#### Scenario: 門檻只限制最新反轉週

- **WHEN** 反轉前 N 次變化方向皆符合但幅度小於 X，且最新反轉幅度達到 X
- **THEN** 反轉條件 MUST pass，前段每週不得被額外要求達到 X

### Requirement: 反轉判定必須使用完整且相鄰的官方週期

設定 N 週 MUST 表示最新反轉之前已有 N 次連續同方向週變化，判定 MUST 使用 N+2 個 TDCC 官方週期；N=4 MUST 使用六個週期。每期 MUST 通過完整 1–15 級、調整與合計驗證，日期 MUST 依已驗證的官方週期證據相鄰。缺任一期 MUST 為 unknown，MUST NOT 跳週、forward-fill、補零或改用任意最近資料。

#### Scenario: 四週設定缺少中間一期

- **WHEN** W-5 至 W 之間缺少 W-3，但其餘五期皆存在
- **THEN** 反轉條件 MUST 為 unknown 並回報缺少的官方週期，不得用 W-6 補位

#### Scenario: 只有第 15 級比例

- **WHEN** 六期均有第 15 級數值，但其中一期未通過完整級距與合計驗證
- **THEN** 反轉條件 MUST 為 unknown，不得以數值存在宣稱可判定

### Requirement: v2 查詢必須維持分支三態與全市場守恆

每個啟用的主要條件 MUST 先組合其訊號與可選成交值限制，產生 pass、fail 或 unknown，再依既有 `all`／`any` 三態真值表組合。回應 MUST 提供每個分支的訊號、成交值、缺漏與最終 verdict，且 `matched + notMatched + unknown = total`、`evaluated = matched + notMatched`。

#### Scenario: 訊號通過但成交值未知

- **WHEN** 成交量倍數通過、該分支成交值限制已啟用但 D 成交值缺漏
- **THEN** 成交量分支 MUST 為 unknown；在 `any` 下若大戶分支 pass，組合仍 MUST pass 並保留成交值缺漏

#### Scenario: 訊號失敗且成交值未知

- **WHEN** 某分支訊號已 fail，而已啟用成交值缺漏
- **THEN** 該分支最終 MUST 為 fail，但回應仍 MUST 保留成交值缺漏，不偽造其值

### Requirement: 介面與 API 必須呈現成交值及反轉證據

結果與展開明細 MUST 呈現實際日成交值及 D、使用的 TDCC 週期、每次週變化、連續週數、反轉方向、門檻、資料版本與 unknown 原因。文案 MUST 使用「持股比例由減轉增／由增轉減」，並說明 TDCC 比例變化不等於確定買進或賣出。排序、分頁與 cursor MUST 綁定相同 v2 snapshot、criteria fingerprint 與公式版本。

#### Scenario: 查看反轉結果明細

- **WHEN** 使用者展開一筆由減轉增結果
- **THEN** 介面 MUST 顯示六期以內的實際日期與比例、各週變化及最新反轉幅度，不只顯示「符合」標籤

#### Scenario: 舊 cursor 用於 v2 查詢

- **WHEN** 用戶端送出 v1 或不同 criteria fingerprint 的 cursor
- **THEN** API MUST 有界拒絕並要求重新篩選，不得混合新舊 snapshot 列

### Requirement: v1 偏好必須安全遷移且控制項可操作

系統 MUST 將合法 v1 偏好遷移為成交值限制關閉、大戶模式 `weekly-increase`、原門檻與組合不變的 v2 偏好；未知版本或非法值 MUST 不得猜測。新增模式、週數、門檻與成交值控制 MUST 在窄面板、600 CSS px 高 viewport、特大字級及鍵盤操作下可抵達並有可辨識標籤。

#### Scenario: 載入合法 v1 偏好

- **WHEN** 使用者既有偏好為兩條件開啟、3 倍、0.2 個百分點及 `all`
- **THEN** v2 MUST 保留這些值，將兩個成交值開關設為關閉並將大戶模式設為單週增加

#### Scenario: 鍵盤設定四週反轉

- **WHEN** 使用者只用鍵盤在最小允許面板設定由增轉減、4 週、0.2 與成交值後提交
- **THEN** 所有控制與驗證訊息 MUST 可抵達，結果焦點及圖表連動 MUST 維持既有行為
