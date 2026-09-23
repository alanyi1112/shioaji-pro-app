## ADDED Requirements

### Requirement: 選股面板必須提供布林位置與震盪指標訊號控制

面板 MUST 在既有「技術」分類新增可獨立啟用的布林位置、RSI 交叉、KD 交叉與 MACD 訊號條件，預設皆關閉。布林位置 MUST 提供上軌外、下軌外及中軌附近；中軌附近 MUST 提供 1–25% 容許範圍與任意／上升／下降中軌方向，預設 10% 與任意。RSI 與 KD MUST 提供高檔死亡交叉及低檔黃金交叉，高／低檔預設 80／20 且可調。MACD MUST 提供零軸接近、零軸穿越、零軸上／下黃金或死亡交叉及任一黃金／死亡交叉。非法門檻、未知枚舉或 `low >= high` MUST 阻止提交並顯示可讀原因。

#### Scenario: 只啟用 RSI 低檔黃金交叉

- **WHEN** 使用者啟用 RSI 交叉、選擇低檔黃金交叉、保留合法門檻並提交
- **THEN** 查詢 MUST 只要求 RSI 分支及其他已啟用條件，不得因 KD、MACD、BOLL 或其量能設定未準備而阻止查詢

#### Scenario: 中軌附近展開必要欄位

- **WHEN** 使用者選擇布林中軌附近
- **THEN** UI MUST 顯示容許範圍與中軌方向，並收起上／下軌外模式不適用的設定

#### Scenario: 高低檔門檻顛倒

- **WHEN** RSI 或 KD 的低檔門檻大於或等於高檔門檻
- **THEN** 「開始篩選」MUST 不送出請求，且不得悄悄交換或還原數值

### Requirement: 每個新技術條件必須提供可選的量能確認

布林位置、RSI、KD 與 MACD 各自 MUST 提供預設關閉的量能確認。啟用後 MUST 可設定 5–60 個交易日的基準窗、1.0–10.0 倍的當日量門檻，預設分別為 20 日與 1.2 倍；並可另行啟用平均量流動性下限，預設 1,000 張。量能設定 MUST 位於該技術條件內，並明示基準不含當日；MUST NOT 建立可被外層 `any` 單獨判定為 pass 的平行條件。

#### Scenario: 啟用 RSI 量能確認

- **WHEN** RSI 交叉成立但當日量未達已設定的前期平均量倍數
- **THEN** RSI 分支 MUST 為 fail，即使外層組合為 `any`，量能也不得被視為另一個獨立 pass 分支

#### Scenario: 量能確認保持關閉

- **WHEN** 使用者未啟用某技術條件的量能確認
- **THEN** 該分支 MUST 只依技術訊號判定，隱藏的量能參數不得進入 criteria fingerprint 或要求 volume ready

### Requirement: v7 偏好必須安全遷移且維持精簡介面

系統 MUST 將合法 v6 偏好決定性遷移為 v7，保留所有既有條件、組合、排序與顯示設定，並將四個新條件及其量能確認設為關閉。技術分類 MUST 沿用精簡 accordion：摘要列顯示條件名稱、啟用狀態及主要模式，只有目前操作的條件才展開完整設定；「全部取消」MUST 同時關閉新舊所有條件但保留合法草稿值。未知版本或非法 v7 MUST fail closed，不清除最後合法偏好。

#### Scenario: 首次載入合法 v6 偏好

- **WHEN** 本機只有合法 v6 偏好
- **THEN** UI MUST 建立新條件皆關閉的 v7 draft，既有篩選行為與排序保持相同

#### Scenario: 修改後尚未提交

- **WHEN** 使用者修改任一新訊號門檻但尚未按「開始篩選」
- **THEN** 面板 MUST 標示尚未套用，既有結果仍顯示其原 v7 criteria 與 evidence

#### Scenario: 窄面板操作新條件

- **WHEN** 使用者在 600 CSS px 高、最小允許寬度及特大字級下用鍵盤設定 MACD 與量能確認
- **THEN** 摘要、展開控制、欄位、驗證訊息、開始篩選及結果 evidence MUST 可聚焦或捲動抵達，且不得撐高 workspace 超出 viewport

### Requirement: 新訊號結果必須提供可稽核證據且不產生副作用

符合結果與 unknown 詳情 MUST 顯示訊號模式、實際門檻、D／P／必要時 P2 日期、未四捨五入判定值的可核對格式、逐子條件 verdict／reason、量能基準窗與結果、formula version 及 evidence hash。點選結果 MUST 只更新指定未鎖定圖表；只有使用者另按「加入清單」才可執行既有雙清單同步。篩選、展開 evidence 或點選結果 MUST NOT 建立委託、改動交易草稿、啟動行情訂閱、觸發 provider 回補或管理 runtime。

#### Scenario: 檢視 MACD 接近零軸結果

- **WHEN** 使用者展開一筆 MACD 接近零軸的符合結果
- **THEN** UI MUST 顯示 D／P／P2 的 DIF、收盤價正規化距離、連續靠近判定、門檻及量能 verdict，不得只顯示「即將突破」

#### Scenario: 點選未加入清單的符合商品

- **WHEN** 使用者點選一檔新訊號符合商品且已有指定未鎖定日 K 圖
- **THEN** 只有該圖表 MUST 切換商品，自選清單、雙清單同步狀態、交易草稿與 runtime MUST 保持不變
