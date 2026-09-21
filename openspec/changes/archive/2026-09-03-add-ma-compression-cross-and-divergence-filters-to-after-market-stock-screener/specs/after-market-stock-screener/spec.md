## ADDED Requirements

### Requirement: 選股面板必須提供均線與背離條件控制

面板 MUST 新增可獨立啟用的「均線糾結／交叉」與「背離」條件，兩者預設關閉。均線條件 MUST 提供多頭準備突破、黃金交叉確認、空頭準備跌破、死亡交叉確認、任一多頭及任一空頭模式，並提供 2–10 日糾結窗及 0.1–5.0% 最大寬度。背離條件 MUST 提供 OBV、RSI5、RSI10、KD-K、MACD 線、MACD 能量柱來源，以及多頭、空頭、任一方向；zero-reset 控制 MUST 只在 MACD 能量柱來源可用。非法值、無啟用條件或不支援組合 MUST 阻止提交並顯示可讀原因。

#### Scenario: 只啟用黃金交叉

- **WHEN** 使用者只啟用均線條件、選擇黃金交叉並提交合法糾結參數
- **THEN** 系統 MUST 只依均線分支查詢，不因 TDCC 或 OBV 尚未 ready 而阻止已有完整均線 evidence 的商品

#### Scenario: 切換非能量柱來源

- **WHEN** 使用者從 MACD 能量柱切換至 RSI 或 OBV
- **THEN** zero-reset MUST 停用且不進入 criteria fingerprint，不得以隱藏舊值改變查詢結果

### Requirement: 新條件偏好必須版本化且安全遷移

系統 MUST 將合法 v3 選股偏好單向遷移為 v4，兩個新條件預設關閉並保留既有條件、組合、排序與成交值設定。v4 MUST 保存已驗證的 mode、來源、方向、糾結日數、寬度與 zero-reset；未知版本、非法數值或無效枚舉 MUST fail closed，不得清除舊偏好或悄悄套用不同策略。

#### Scenario: 首次載入 v3 偏好

- **WHEN** 本機只有合法 v3 偏好
- **THEN** UI MUST 建立新條件皆關閉的 v4 draft，既有篩選設定保持相同

#### Scenario: 修改但尚未提交

- **WHEN** 使用者在已有結果時修改均線或背離參數
- **THEN** 面板 MUST 標示尚未套用，舊結果繼續顯示其已提交 v4 criteria，不得被新 draft 重標

### Requirement: 結果卡必須顯示均線或背離判定證據

符合結果與可展開的 unknown 詳情 MUST 顯示實際資料日期及足以重算的摘要。均線結果至少 MUST 顯示模式、P／D、SMA5／10／20、糾結窗、各日最大寬度與交叉狀態；背離結果至少 MUST 顯示來源、方向、兩個 pivot 中心日與確認日、價位、指標值、間距、價格差及 zero-reset 狀態。數值顯示可格式化，但判定 MUST 使用未四捨五入 canonical 值；MUST NOT 只顯示「黃金交叉」或「背離」而無證據。

#### Scenario: 點選背離結果查看 K 線

- **WHEN** 使用者點選一筆可操作的背離結果
- **THEN** 指定未鎖定 K 線圖 MUST 顯示同一商品，結果卡保留 pivot／確認日期供使用者與圖表核對
- **AND** 不得自動加入清單、變更其他分頁或產生交易／行情訂閱副作用

#### Scenario: v4 結果日期落後

- **WHEN** v4 `effectiveSessionDate` 落後於當期預期完整交易日
- **THEN** UI MUST 顯示歷史／pending 狀態並停止把 rows 當作當期可操作結果，不得以圖表最新 K 棒日期覆蓋 evidence 日期

### Requirement: 新條件介面必須維持 viewport 與鍵盤可用性

新增控制、驗證訊息、結果 evidence 及 unknown 原因 MUST 可由鍵盤抵達，並在 600 CSS px 高 viewport、最小允許選股面板寬度與特大字級下透過面板內捲動完整操作。新增內容 MUST NOT 撐高選股版面 workspace 超出可視區域，也不得讓捲動誤觸面板拖曳。

#### Scenario: 窄面板設定背離條件

- **WHEN** 使用者只用鍵盤在最小允許尺寸選擇 MACD 能量柱、空頭與 zero-reset 後提交
- **THEN** 所有控制、焦點、錯誤與結果詳情 MUST 可抵達，右側 K 線面板高度與既有版面保持一致
