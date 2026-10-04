## ADDED Requirements

### Requirement: 技術型態必須提供精簡的布林三階段條件

面板 MUST 在「技術型態」加入可獨立啟用的「布林壓縮與突破」，預設關閉，預設階段集合為三類全選。條件 MUST 沿用既有 accordion，啟用後才展開階段選擇與主要門檻，其餘參數與說明 MUST 以進階設定收合。數值 MUST 可調、明示單位與含／不含當日基準，非法值／空階段集合 MUST 阻止提交且不改舊結果。所有新舊條件 MUST 仍適用全部取消、外層 AND／OR 與草稿／已套用隔離；策略內部必要價量子條件 MUST 固定 AND。

#### Scenario: 新條件尚未啟用

- **WHEN** 使用者開啟選股面板而布林三階段未啟用
- **THEN** MUST 只顯示精簡摘要，不展開全部新欄位或拉長面板，既有預設條件不變

#### Scenario: 清除所有條件

- **WHEN** 使用者按全部取消
- **THEN** 布林新分支及舊分支 MUST 全部停用，合法門檻仍留在草稿，既有結果與每日 profile 不變

### Requirement: 分類切換必須互斥且計數範圍清楚

結果 MUST 提供全部／正在壓縮／準備突破／今日正式突破切換，單檔 MUST 不跨類重複。MUST 分別標示該策略全市場分類計數與其他已啟用條件組合後的筆數，unknown／未符合 MUST 可查閱原因，不能用顯示過濾令全市場總數失衡。結果卡 MUST 顯示商品／名稱、階段、資料日、BBW／百分位／b 與適用量能倍數，完整公式 evidence MUST 可展開。

#### Scenario: 切換到準備突破

- **WHEN** 使用者切換準備突破分類
- **THEN** MUST 只顯示 preparing 標籤，不能混入純壓縮或昨日已突破的股票；資料日與所用條件 MUST 保持固定

#### Scenario: 同時啟用其他條件

- **WHEN** 使用者將布林與投信條件設為 AND
- **THEN** MUST 明示布林原始分類數與目前組合符合數，投信 unknown 原因 MUST 保留，不把布林母體數冒稱最後符合數

### Requirement: 每日自動設定必須與查詢草稿分開儲存

面板 MUST 提供明確的「套用至每日自動篩選」動作，儲存合法的本機 profile revision、生效狀態與參數，不觸發來源擷取。草稿編輯與「開始篩選」MUST 只改面板查詢，MUST NOT 隱式修改背景每日設定。合法 v7 偏好遷移 v8 MUST 保留舊值並將新分支設為關閉；不合法偏好 MUST 保留最後合法設定。已儲存每日設定在瀏覽器關閉後 MUST 仍可被本機背景讀取；所需歷史不足 MUST 顯示所需／已備日數與 pending，而不改用短窗。

#### Scenario: 編輯草稿但不儲存每日設定

- **WHEN** 使用者將量能倍數由 1.3 改為 1.5 並按開始篩選
- **THEN** 當次查詢 MUST 使用 1.5，但每日 profile MUST 保持原 revision，直到使用者明確套用至每日自動篩選

#### Scenario: v7 偏好升級

- **WHEN** 本機只保存合法 v7 偏好
- **THEN** v8 draft MUST 保留原條件、排序及顯示設定，並新增停用的布林三階段分支，不能自動啟用新策略

### Requirement: 日期警告與既有清單圖表操作必須維持真實隔離

面板 MUST 明示 expected／effective 資料日、發布狀態與無法判定原因，資料未備齊或過期警告 MUST 不被進階收合隱藏。點選股票 MUST 只更新指定未鎖定圖表且不得自動跟隨後續結果切換；只有明確加入清單才可沿用 Shioaji「選股」與 MultiView「選股篩選」同步。篩選、階段切換、展開 evidence、儲存策略與選圖 MUST 不改交易商品／草稿、建立委託或增加 broker login／subscription。文字 MUST 不宣稱明日必然突破或將外部研究報酬當本功能保證。

#### Scenario: 今日報告仍等待

- **WHEN** 舊報告存在而今日任一市場尚未公布
- **THEN** MUST 明示舊資料日與今日等待原因，不能把舊列作今日加入清單結果

#### Scenario: 股票結果更新

- **WHEN** 使用者已選定某商品而背景產生新結果
- **THEN** 指定圖表 MUST 不自動跳到另一商品，清單與交易草稿 MUST 不變

### Requirement: 新條件必須維持窄面板與鍵盤可用

面板 MUST 在 600 CSS px 高、最小允許寬度與特大字級下使階段控制、欄位、進階展開、驗證訊息、篩選／每日設定動作及結果 evidence 可聚焦或捲動抵達；MUST 不撐高 workspace、不與其他彈出／下拉控制重疊，並提供可辨識的 label 與展開狀態。

#### Scenario: 鍵盤完成策略設定

- **WHEN** 使用者在窄面板用鍵盤啟用策略、調整參數、提交查詢並展開 evidence
- **THEN** 所有必要控制 MUST 可操作，警告與結果 MUST 可讀，workspace 高度保持在 viewport 內

### Requirement: 備援結果必須清楚揭露實際來源

面板 MUST 在使用 Shioaji 備援時以簡短且可見的提示標示實際 provider、資料日及官方來源尚未可用的原因；完整 evidence MUST 可展開查閱每市場來源選擇、review／mapping version、hash 與已知衝突。MUST NOT 把備援標成 TWSE／TPEx 網站擷取成功；來源已驗證且完整時可正常操作，pending／過期／衝突警告不得被隱藏。展開 evidence MUST 仍為唯讀，不觸發來源擷取。

#### Scenario: 使用合法 Shioaji 備援的今日報告

- **WHEN** 今日報告由已驗證備援發布，而 TPEx 官方入口仍失敗
- **THEN** MUST 顯示「Shioaji 日行情備援」與有效資料日，保留 TPEx 原因可查閱；不得顯示成整份報告失敗或官方入口已成功

#### Scenario: 成交量來源差異在百分之一以內

- **WHEN** 同日期來源比對以新容差政策通過，但成交量並非完全相同
- **THEN** MUST 明示成交量差異 ≤1% 的容差通過及策略仍使用原凍結量；唯讀 evidence 顯示政策、原股數與差異樣本，不隱藏舊衝突、改寫原值或觸發來源請求

#### Scenario: 金額容差的新核對版本

- **WHEN** 使用明確新版金額政策取得來源容差通過 evidence
- **THEN** MUST 顯示量差 ≤1%、金額差 ≤1 元、原凍結金額與政策版本；僅金額差異不說成交量不同，完整來源核對仍為唯讀，不校正策略值或隱藏舊衝突
