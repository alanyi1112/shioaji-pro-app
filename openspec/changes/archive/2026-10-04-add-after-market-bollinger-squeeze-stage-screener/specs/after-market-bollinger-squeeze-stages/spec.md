## ADDED Requirements

### Requirement: 布林壓縮必須使用固定公式與前期相對帶寬

系統 MUST 從相容且已驗證的未還原價量底稿建立 BOLL(20,2)，官方優先／Shioaji 備援依獨立來源契約及不可變 manifest 選擇；標準差 MUST 採 20 日母體標準差。系統 MUST 以 `BBW=(upper-lower)/middle`、`b=(close-lower)/(upper-lower)` 判定，MUST NOT 使用顯示四捨五入值或改寫舊版公式。相對基準 MUST 是該日以前 N 個連續官方交易日的有效 BBW，不含該日；N 預設 120、允許 60–250，quantile 預設 20%、允許 5–50%。quantile MUST 採 Type-7 線性內插且保留 ties，壓縮門檻 MUST 使用 `BBW <= quantile`。寬度／中軌非正、缺日或指標暖機不足 MUST 為 unknown。

#### Scenario: 當日帶寬不參與自身基準

- **WHEN** 系統計算 D 的壓縮門檻
- **THEN** quantile 基準 MUST 只包含 D 前 120 日，並在 evidence 保存完整基準日期、算法及值

#### Scenario: 零寬度或缺一交易日

- **WHEN** 必要窗口的帶寬為零或缺少一個官方交易日
- **THEN** 相關子條件 MUST 為 unknown，不得除以零、剔除缺日後用更早資料補足筆數或把零寬度當作極佳壓縮

### Requirement: 共同濾網與歷史壓縮 setup 必須同日且可調

共同濾網 G(t) 的預設 MUST 為普通股、`close_t >= 20`、截至 t 的 20 日實際成交金額均值 `>= 50,000,000 TWD`、`close_t > MA20_t > MA60_t`、`MA60_t >= MA60_(t-5)`、70 日報酬 > 0。壓縮 setup S(t) MUST 是 G(t) 與下列全部 AND：相對帶寬通過、`BBW_t < BBW_(t-5)`、截至 t 的 5 日平均帶寬 < 20 日平均帶寬、`0.60 <= b_t <= 1.00`、截至 t 的 5 日均量 < 1.00 倍 20 日均量。

價格、成交金額／窗口、均線／比較 lag、動能窗口、帶寬短長平均／比較 lag、b 下限與量縮倍數 MUST 可調且寫入 fingerprint；BOLL(20,2) MUST 保持固定。設定 MUST 是有限、正確型別與有界值，period 上限 250、近期 setup／lag 上限 20，短窗 MUST 小於長窗、壓縮 b 下限 MUST 小於準備門檻且都不得超過 1，總歷史需求 MUST 不超過 400 日。歷史 S(t) MUST 使用同一參數版本及不晚於 t 的資料，不能以 D 的均線、濾網或 quantile 套回 t。

#### Scenario: 強勢且量縮的有效壓縮

- **WHEN** G(D)、相對帶寬、持續收縮、b 與量縮全部通過
- **THEN** S(D) MUST 為 pass；候選量能與金額基準 MUST 包含 D 且明示其日期窗

#### Scenario: 量縮但長期趨勢轉弱

- **WHEN** 股票帶寬與量能收縮，但 MA20 不高於 MA60
- **THEN** 預設 S(D) MUST 為 fail，不得只因帶寬很小就列為強勢壓縮候選

#### Scenario: 使用未來資料改寫歷史 setup

- **WHEN** 檢查 D 前某日 t 的 setup
- **THEN** 系統 MUST 以截止 t 的均線、成交金額、量能及 t 前相對基準重算；加入 t 以後的資料 MUST NOT 改變該日 evidence

### Requirement: 準備突破必須是壓縮中的上軌附近狀態

準備突破 R(D) MUST 為 `S(D) && b_D >= preparingThreshold`，預設 preparingThreshold=0.85，MUST 可調且不得超過 1。尚未有效壓縮、已收在上軌外或資料不足 MUST NOT 僅因靠近上軌而標為準備突破。文案 MUST 明示此為接近上軌的候選狀態，不是明日必然突破。

#### Scenario: 收盤位於上半部但未接近上軌

- **WHEN** S(D) 為 pass 且 b_D=0.70
- **THEN** 預設 R(D) MUST 為 fail，該股票仍可列為正在壓縮

#### Scenario: 壓縮且收盤接近上軌

- **WHEN** S(D) 為 pass 且 0.85 <= b_D <= 1.00
- **THEN** 預設 R(D) MUST 為 pass，不得同時重複列於正在壓縮分類

### Requirement: 正式突破必須連接近期 setup 與首次放量上破

正式突破 B(D) MUST 是 G(D) 與以下全部 AND：`close_D > upper_D`、`close_P <= upper_P`、D 前 K 個官方交易日內至少一日 S(t)=pass，以及 `volume_D > ratio * average(volume of previous N official sessions)`。K 預設 5、允許 1–20；ratio 預設 1.3，N 預設 20，兩者 MUST 可調且合法有界。放量基準 MUST 排除 D，P MUST 是適用的相鄰官方交易日。系統 MUST 保存最近通過的 setup 日期與當日證據；MUST NOT 要求突破日仍滿足 S(D)、縮量、帶寬收縮或昨日必須是 setup。

#### Scenario: 放量且帶寬展開的首次突破

- **WHEN** D 前 5 日內有有效 setup，今日首次收盤上破且今日量 > 前 20 日均量的 1.3 倍，但今日 BBW 已放大
- **THEN** B(D) MUST 為 pass，不得被當日帶寬不再收縮或量不再縮小否決

#### Scenario: 連續第二日在上軌外

- **WHEN** close_D > upper_D 且 close_P > upper_P
- **THEN** B(D) MUST 為 fail，不得重複列為今日首次正式突破

#### Scenario: 正好碰軌或正好等於放量倍數

- **WHEN** close_D=upper_D，或其他條件通過但今日量正好等於已設定量能倍數的基準
- **THEN** B(D) MUST 為 fail，嚴格大於規則不得因顯示 rounding 而改成通過

#### Scenario: 近期壓縮日位於有效期外

- **WHEN** 最後 setup 在 D 前第 6 個交易日且最近 5 日全部不通過
- **THEN** 預設 B(D) MUST 為 fail，不得使用無期限的曾經壓縮旗標

### Requirement: 三階段分類必須互斥且保留三態原因

系統 MUST 按 B(D) → R(D) → S(D) 優先順序判定互斥的 breakout／preparing／compressing；均確定 fail 才為 notMatched。較高階 unknown MUST NOT 直接降級成較低階的確定分類，MUST 顯示 unknown 及已知低階 setup 證據。AND 子條件 MUST 遵循 fail 優先、全 pass 才 pass 的既有三態邏輯；近期 setup 的 OR MUST 有一日 pass 即 pass、全部 fail 才 fail，其餘 unknown。系統 MUST 保持 `breakout + preparing + compressing + notMatched + unknown = total`，並分列 TWSE／TPEx。

#### Scenario: 準備與壓縮都成立

- **WHEN** R(D) 與 S(D) 同時 pass 且 B(D) 確定 fail
- **THEN** 股票 MUST 只計入 preparing，總母體不得重複計數

#### Scenario: 缺少突破基準但低階 setup 可判定

- **WHEN** B(D) 為 unknown 且 S(D) 為 pass
- **THEN** 分類 MUST 為 unknown 並保存已知壓縮狀態，不得宣稱較高階已確定不存在

#### Scenario: 外層 OR 不繞過策略內量能

- **WHEN** 布林首次上破成立但放量子條件 fail，且面板外層為 OR
- **THEN** 布林突破分支 MUST 為 fail；若其他獨立條件 pass，可由其他分支符合，但 evidence MUST NOT 宣稱布林正式突破

### Requirement: 判定必須提供足以獨立重算的版本化證據

結果 MUST 保存 D／P、參數 fingerprint、逐子條件 verdict／reason、BOLL／BBW／b、quantile 算法與日期序列、多頭／動能／金額／量能比較值、最近 setup 日期與 hash、來源 mapping／formula version。來源數量 MUST 以股及 TWD canonical 整數保存；判定與格式化 MUST 分離，unknown MUST 有可讀原因。排序與分頁 MUST 固定相同 snapshot、設定與階段集合，未知值不得假裝零值。

#### Scenario: 獨立核對突破量

- **WHEN** 使用者展開正式突破 evidence
- **THEN** MUST 能核對今日成交量、排除 D 的完整基準日期／均量、門檻、最近 setup 與 source／formula version

#### Scenario: 更換條件後沿用舊 cursor

- **WHEN** 查詢修改 percentile、階段集合或量能倍數但使用舊 cursor
- **THEN** API MUST 拒絕該 cursor，不得混合兩組條件結果
