## ADDED Requirements

### Requirement: 選股面板必須提供可設定的籌碼條件區

「選股篩選」面板 MUST 在既有條件之外提供八項籌碼／價量條件的獨立開關與參數，預設全部關閉。控制項 MUST 使用可讀中文名稱、單位、合法範圍與資料定義說明；新條件 MUST 參與既有「全部符合／任一符合」、提交、尚未套用、排序及 result state 流程。無 enabled condition 或任一 enabled condition 非法時 MUST 阻止查詢。

#### Scenario: 只啟用券資比

- **WHEN** 使用者只啟用券資比、輸入合法門檻並開始篩選
- **THEN** UI MUST 只提交券資比與全域查詢欄位，不得因 TDCC、投信或技術條件未啟用而要求其資料 ready

#### Scenario: 非法參數不送出查詢

- **WHEN** 使用者輸入最小大戶比例高於最大比例、投信日數超界、非法 SMA period 或其他不合法值
- **THEN** 面板 MUST 顯示欄位層級原因並停止 fetch，不得靜默修正、截斷或套用預設值

### Requirement: 籌碼條件偏好必須版本化遷移且保留舊行為

系統 MUST 將合法 v4 preference 單向遷移為 v5，保留既有 enabled conditions、門檻、mode、排序、方向與 result state，並把八項新條件設為 disabled。v5 MUST 保存所有可見且合法的籌碼參數；disabled condition 的隱藏值 MUST 不進入 criteria fingerprint。未知版本、額外欄位、非法數值或未知枚舉 MUST fail closed，且不得刪除最後合法 preference。

#### Scenario: 首次載入合法 v4 偏好

- **WHEN** localStorage 只有合法 v4 preference
- **THEN** 面板 MUST 建立等價 v5 draft，既有查詢行為相同且所有新條件關閉

#### Scenario: preference 寫入失敗

- **WHEN** v5 preference 無法保存至 localStorage
- **THEN** 當次已驗證查詢 MUST 仍可執行，UI MUST 顯示保存失敗且不得以舊 preference 重標目前結果

### Requirement: 籌碼結果卡必須顯示來源日期與公式證據

啟用籌碼條件時，結果摘要 MUST 顯示籌碼 daily through、TDCC weekly anchor、普通股分母 as-of、OHLCV through、`effectiveSessionDate`、snapshot time 與逐條件缺漏數。每列 MUST 可展開查看該條件的原始數值、日期、單位、公式與 verdict reason；未知值 MUST 顯示原因，不得顯示為 0 或空白成功。

#### Scenario: 投信條件有完整 evidence

- **WHEN** 某列依投信買超占股本判定
- **THEN** 展開列 MUST 顯示 N 個交易日、每日 signed net、累計股數、已發行普通股數、分母日期、百分比與來源

#### Scenario: snapshot stale

- **WHEN** 含籌碼條件的 current candidate 尚未完成而只剩最後合法 snapshot
- **THEN** UI MUST 顯示 expected／effective、逐市場等待原因與舊 snapshot 日期，舊 rows MUST 不可點選、不可加入清單且不得描述為本期符合

### Requirement: 籌碼條件與結果操作必須維持選股新分頁隔離

新增控制、預設、展開 evidence、排序及點選結果 MUST 保持在目前「選股篩選」新分頁 workspace。點選合法 current row MAY 沿用既有 chart target 連動，但 MUST NOT 改動來源主頁、其他分頁、自選清單、盤中選股、smart-order 或任何交易草稿。

#### Scenario: 籌碼結果連動同頁 K 線

- **WHEN** 使用者點選含完整 contract 的 current 籌碼結果
- **THEN** 系統 MUST 只更新同一新分頁內指定且未鎖定的 K 線圖，並保留結果 daily／weekly evidence 與圖表資料日期的分別標示

### Requirement: 籌碼控制在窄版面與鍵盤操作下必須可達

八項條件、說明、參數、長線佈局預設、開始篩選、排序、缺漏與 evidence 展開 MUST 可由鍵盤操作並有可辨識 label。於 600 CSS px 高 viewport、最小允許面板寬度及特大字級下，條件區與結果區 MUST 可在面板內捲動抵達，不得擴張 workspace 造成底部永久超出 viewport。

#### Scenario: 鍵盤完成籌碼篩選

- **WHEN** 使用者只用鍵盤套用長線佈局 draft、調整參數、提交並展開一筆結果
- **THEN** 焦點順序、可見狀態、錯誤訊息與 evidence MUST 可辨識，且操作不得觸發 workspace 拖曳
