# after-market-stock-screener Specification
## Purpose
TBD - created by archiving change add-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: 主介面必須提供完整交易終端形式的收盤後選股版面

RealTimeStock 本機主介面的 viewport-safe「版面」下拉選單 MUST 在「預設版面 Presets」區提供「選股篩選」入口。啟用後 MUST 以同源新分頁開啟完整交易終端，保留頂部工具列，並套用左側「選股」、右側 K 線圖的專用 workspace；MUST NOT 顯示只有選股控制項的獨立根頁面。新頁 MUST 明示「收盤後」與「上市＋上櫃普通股」範圍，並可查閱排除 ETF、ETN、權證、特別股、興櫃及海外股票的說明。

「＋新增面板」選單 MUST 保留名稱為「選股」的原有 action，啟用後 MUST 以 `addBlock` 建立內嵌 `screener` block，且既有一個時 MUST 依 singleton 語意停用。workspace 或具名版面的 `screener` block MUST 保持可載入、移動、縮放、移除與保存。

#### Scenario: 從版面選單開啟完整選股交易頁

- **WHEN** 使用者在「版面」選單的「預設版面 Presets」區啟用「選股篩選」
- **THEN** 系統 MUST 同步開啟一個具有完整交易終端頂部工具列的新分頁
- **AND** 新分頁 MUST 只有一個左側選股面板及一個右側 K 線圖面板，兩者在桌面 viewport 並排且可各自捲動或操作
- **AND** 來源主頁的 workspace、自選清單及排行榜 MUST 保持原狀

#### Scenario: 面板高度隨可視區域調整

- **WHEN** 選股版面新頁在不同高度的 viewport 開啟，或使用者調整視窗高度使頂部工具列高度改變
- **THEN** 左側選股與右側 K 線主面板 MUST 使用相同高度，且面板底部 MUST 保持在 grid 可視區域內
- **AND** 選股內容超過面板高度時 MUST 在面板內捲動，不得以增加主面板高度造成整個 workspace 超出 viewport

#### Scenario: 新增面板保留內嵌選股

- **WHEN** 目前 workspace 尚無 `screener` block，使用者從「＋新增面板」啟用「選股」
- **THEN** 系統 MUST 在目前 workspace 建立內嵌選股面板，MUST NOT 開啟新分頁
- **AND** 已有 `screener` block 後該 action MUST 顯示已存在並停用

#### Scenario: 保存與載入含選股 block 的版面

- **WHEN** 使用者載入含 `screener` block 的目前 workspace 或具名版面
- **THEN** 系統 MUST 依原內容恢復該 block，不清除 workspace／profile storage key，也不自動開啟新分頁
- **AND** 使用者移除該 block 後 MUST 可正常保存不含它的版面

#### Scenario: 選股資料服務離線

- **WHEN** 選股版面新分頁已開啟但 5174 無法提供選股底稿
- **THEN** 完整交易終端與 K 線圖 MUST 保持可用，選股面板 MUST 呈現既有來源不可用／離線狀態及指引
- **AND** 系統 MUST NOT 自動啟動或重啟任何服務

### Requirement: 選股條件必須可獨立設定與明確提交

面板 MUST 提供「成交量 ≥ 前一交易日倍數」與「千張大戶持股週增 ≥ 百分點」兩項開關及十進位門檻，預設兩項開啟、門檻為 3 與 0.2、組合為「全部符合」。系統 MUST 支援「任一符合」，倍數限 0.01–1000、週增限 0.01–100 個百分點，均最多兩位小數。未啟用條件 MUST 不參與判定；無啟用條件或非法輸入 MUST 阻止查詢並提供可讀原因。

#### Scenario: 單獨選用成交量條件

- **WHEN** 使用者只勾選成交量條件並按「開始篩選」
- **THEN** 系統 MUST 只依成交量判定，不因 TDCC 尚未準備好而阻止有完整日量資料的商品被篩出

#### Scenario: 變更條件但尚未提交

- **WHEN** 已有結果時使用者修改門檻或條件組合
- **THEN** 面板 MUST 標示「尚未套用」，保留舊結果的原條件標示，不以新門檻重標舊結果

#### Scenario: 無條件或門檻非法

- **WHEN** 沒有勾選條件，或已啟用條件為空白、非有限數、負值、超界或超過允許小數位
- **THEN** 「開始篩選」MUST 不發出查詢，且欄位 MUST 顯示明確驗證訊息，不悄悄改回預設值

### Requirement: 結果必須呈現可追溯的資料日期與全市場覆蓋

結果區 MUST 呈現日量比較的兩個交易日、TDCC 比較的兩個官方週日期、技術型態最後交易日、`effectiveSessionDate`、快照產生時間、實際套用條件、母體總檔數、可判定檔數、符合／不符合／無法判定檔數及逐條件缺漏數。日量 MUST 以「成交量比較：P → D」呈現，`effectiveSessionDate` MUST 以「有效資料日」呈現；只有收盤後 `expectedSessionDate` 晚於 `effectiveSessionDate` 時，才另行顯示「預期資料日」及 TWSE／TPEx 等待原因。每筆成交量結果 MUST 把 P／D 日期與數值放在同一 evidence；成交值只作篩選，不在結果卡顯示數值或日期。面板 MUST 允許查看無法判定的商品與原因；MUST NOT 以當天日曆日期、請求時間、UI 重整時間、圖表最後 K 棒日期或較舊 snapshot 冒充資料日期。

未啟用且尚無資料的條件，其日期／指標 MUST 標示未提供，不以要求兩種資料都就緒阻止單條件篩選。stale 或 mixed-session response MUST 顯示最後合法 P／D、有效資料日、預期資料日、快照時間與等待原因；其 rows MUST NOT 保持可點選、可加入清單或被描述成當期符合結果。GET 查詢與 UI 重整 MUST NOT 直接觸發官方來源或背景更新。

#### Scenario: 部分商品缺少前一週

- **WHEN** 啟用的大戶條件有商品缺前一官方週期
- **THEN** 面板 MUST 清楚呈現缺漏數與受影響商品原因，且不得以「0 檔符合」暗示全市場皆已完整比較

#### Scenario: 官方新日資料尚未公布

- **WHEN** 新交易日已收盤但來源還沒有可驗證的正式資料
- **THEN** 面板 MUST 顯示預期資料日、最後有效資料日、逐市場等待原因及上次快照的原比較日期，不納入當日盤中累計量或更新舊資料日期
- **AND** 舊結果 MUST 以歷史快照呈現並停止當期操作，不得只顯示 stale 警告後繼續提供點選或「加入清單」

#### Scenario: OR 已符合但另一條件缺資料

- **WHEN** 某商品在「任一符合」下成交量達標但 TDCC 缺資料
- **THEN** 商品 MUST 列入符合清單，同時把 TDCC 欄位及逐條件缺漏明示為資料不足，不偽造週增零值

#### Scenario: 結果日期與圖表日期不同

- **WHEN** 選股 evidence 的 D 與指定 K 線圖目前最後一棒日期不同
- **THEN** UI MUST 同時明示選股 P／D 與圖表資料日期，不得讓使用者把不同日期的成交量柱視為同一筆判定

#### Scenario: 同日官方成交量與 Snapshot 成交量比較

- **WHEN** 使用者點選結果後取得的 Shioaji STK Snapshot 日期等於該列選股 D
- **THEN** 結果卡 MUST 將官方盤後股數除以 1,000 精確換算為張，並顯示官方盤後張數、Snapshot common lot 張數及「官方盤後減 Snapshot」的有正負號差異張數
- **AND** 不足一張的差異 MUST 保留最多三位小數，不得把 Snapshot 的 `total_volume` 標示為股
- **AND** 圖表 QuoteBoard 與主圖之間 MUST NOT 顯示另一條選股證據提示列

#### Scenario: 日期不同或 Snapshot 不可用

- **WHEN** Snapshot 日期不同於選股 D，或 Snapshot 未取得、成交量無效
- **THEN** 結果卡 MUST NOT 製造或顯示同日差異，既有 P／D 官方證據仍保持原樣

#### Scenario: 收盤後當日資料已齊備

- **WHEN** 台北交易日收盤後，API 已驗證並發布今日 TWSE／TPEx 共同快照
- **THEN** 面板 MUST 顯示「成交量比較：前一官方交易日 → 今日」與「有效資料日：今日」
- **AND** MUST NOT 繼續把再前一個交易日標示為「上一個交易日」，也不得顯示不再適用的 pending 警告

#### Scenario: 重新整理不會自行改寫日期

- **WHEN** 使用者在收盤前後重新整理選股頁，但 maintenance readiness 或 immutable snapshot 尚未改變
- **THEN** 面板 MUST 維持後端證據中的 expected／effective／P／D，不得依瀏覽器時鐘自行推進、倒退或觸發 provider 請求

### Requirement: 結果清單必須支援排序分頁與真實值說明

符合清單 MUST 顯示代碼、名稱、市場、成交量倍數與大戶週增；兩天的成交量、兩週的第 15 級持股比例、實際日期、單位及來源說明 MUST 可從欄位或展開列查閱。面板 MUST 提供代碼、成交量倍數及週增的穩定排序與分頁，顯示總匹配數；MUST NOT 將只顯示一頁混同只掃描該頁商品。

#### Scenario: 符合股票不在自選清單也不在排行前百名

- **WHEN** 該股票屬官方普通股母體且符合條件
- **THEN** 股票 MUST 出現在可走訪的完整符合清單中，不要求先加入自選清單或開啟圖表

#### Scenario: 千張大戶說明

- **WHEN** 使用者查看大戶條件或結果的指標說明
- **THEN** 系統 MUST 明示 TDCC 第 15 級為 1,000,001 股以上，比例是占集保庫存數比例，週增單位為百分點，不解讀成確定買進或特定投資人身分

#### Scenario: 翻頁期間資料更新

- **WHEN** 使用者翻頁時後端已發布新快照
- **THEN** 既有查詢 MUST 維持相同快照及條件，或明確要求重新篩選，不混入新快照造成重複或遺漏

### Requirement: 選股點選必須只連動新頁內指定且未鎖定的 K 線圖

選股版面新分頁 MUST 沿用同一個 `TradingApp` workspace 內的 chart target 協調。點選或以鍵盤啟用結果內容後，系統 MUST 重新驗證 target 仍存在且未鎖定，將合法合約只送到該新頁內指定圖表，並為該 chart block 取得與商品一致的行情 Snapshot。只有一個可用目標時 MUST 自動選定；有多個時 MUST 提供可辨識的選擇器。contract、Snapshot 與目標狀態 MUST 綁定同一 selection generation。系統 MUST NOT 改動來源主頁、其他分頁、其他圖表、全域自選商品、個人清單、下單或智慧下單商品與草稿，MUST NOT 發出任何交易寫入。

#### Scenario: 點選未加入自選清單的股票

- **WHEN** 使用者在選股版面新分頁點選具有完整識別與合法合約的符合股票
- **THEN** 新頁內指定圖表 MUST 顯示該商品 K 線及一致的商品標題／報價，不將選股歷史列冒充最新行情 Snapshot
- **AND** 盤後沒有新 quote event 時 MUST 以 chart-local Snapshot 提供可用行情摘要，或明示 Snapshot 不可用原因，不得無提示地讓全部欄位顯示 `—`
- **AND** 來源主頁、自選清單內容與下單面板的商品、數量、價格及草稿 MUST 保持不變

#### Scenario: 所有圖表已鎖定或沒有圖表

- **WHEN** 點選結果時新頁沒有未鎖定的 K 線圖
- **THEN** 系統 MUST 提示先解鎖或明確開啟新 K 線圖；只有使用者啟用新增動作時才建立日 K 圖，不自動解除既有 pin

#### Scenario: 連點與目標失效

- **WHEN** 使用者快速點選 A 再點 B，或 contract／Snapshot 載入期間目標被移除、鎖定或改選
- **THEN** A 的任何過時 contract 或 Snapshot 回應 MUST 不得覆寫 B 或新的目標，且不得把目標失效的 A 顯示為連動成功
- **AND** 來源主頁、其他 chart block 與全域商品 MUST 保持原狀

#### Scenario: 多個主交易頁同時開啟

- **WHEN** 瀏覽器同時存在來源主頁與一個或多個選股版面新分頁
- **THEN** 每個分頁的 workspace、selection generation 與 chart target MUST 隔離，選股點選只作用於發生操作的分頁
- **AND** 選股版面新分頁的拖拉、縮放、新增或移除面板 MUST NOT 覆寫來源主頁持久化 workspace

#### Scenario: 直接開啟選股版面網址

- **WHEN** 使用者從書籤或貼上網址直接開啟合法的選股版面 URL
- **THEN** 系統 MUST 顯示完整交易終端、左側選股與右側 K 線圖，不得退回只有選股控制項的獨立根頁面

#### Scenario: 新增日 K 圖

- **WHEN** 使用者在選股面板明確啟用「新增日 K 圖」
- **THEN** 系統 MUST 在同一個新頁 workspace 建立一個未鎖定日 K 圖，並在建立完成後選用該目標

#### Scenario: 回到全域清單連動與鎖定

- **WHEN** 使用者在選股點選後明確選擇自選清單另一商品，或鎖定目前選股目標圖表
- **THEN** 全域清單選擇 MUST 讓未鎖定圖表恢復既有跟隨語意；鎖定動作 MUST 鎖定當下真正顯示的圖表商品，不誤鎖舊全域商品

### Requirement: 面板狀態必須可恢復且不可偽報最新

系統 MUST 保存本機選股條件、組合及排序等非敏感偏好，結果只作為帶日期與條件識別的暫時快照；重整 MUST 重新核對後端資料狀態。面板 MUST 區分未篩選、載入中、無符合、部分資料、等待前期資料、來源不可用及離線；每次查詢 MUST 以 generation 與條件指紋隔離舊回應。偏好保存失敗 MUST 不影響當次篩選。

#### Scenario: 較舊查詢最後才回來

- **WHEN** 新條件 B 的結果已返回，而舊條件 A 的回應較晚抵達
- **THEN** UI MUST 保留 B，不讓 A 覆寫日期、結果列、總數或錯誤狀態

#### Scenario: 本機資料服務離線

- **WHEN** 5174 無法提供選股底稿
- **THEN** 面板 MUST 顯示服務不可用，已有結果可保留但須明示舊日期與離線，不自動重啟任何服務
- **AND** 其他面板 MUST 可獨立操作；Shioaji 離線只影響依賴它的圖表載入，不使可讀底稿的篩選失效

### Requirement: 選股介面必須在窄面板及鍵盤操作下可用

條件、開始篩選、目標圖表、結果啟用、分頁及資料不足說明 MUST 可用鍵盤抵達並有可辨識標籤。面板 MUST 在 600 CSS px 高 viewport、最小允許面板寬度與特大字級下保持必要控制可達；列表捲動不得意外拖動工作區，列點選不得誤觸面板拖曳。

#### Scenario: 窄面板使用完整篩選流程

- **WHEN** 使用者在最小允許尺寸調整條件、篩選、查看缺漏並啟用結果
- **THEN** 控制項與焦點 MUST 保持可見或可捲動抵達，重要文字不被永久裁切，目標圖表能顯示該商品

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

### Requirement: 專用選股版面啟動不得依賴作用中自選清單行情

`layout=stock-screener` MUST 在 grid 容器就緒後先呈現完整交易終端、左側選股面板與右側 K 線面板，不得等待作用中自選清單全部商品完成合約解析、Snapshot 載入或行情訂閱。系統 MAY 在背景讀取 watchlist metadata 以支援清單整合，但開頁本身 MUST NOT 替作用中清單商品建立 Tick、BidAsk 或 Quote 訂閱。使用者明確點選可操作的選股結果後，系統才 MUST 為該次 selection generation 載入指定圖表所需的單一商品資料。

#### Scenario: 自選清單初始化持續等待

- **WHEN** 使用者開啟 `layout=stock-screener`，且 watchlist metadata、合約解析或既有清單行情仍在等待
- **THEN** 新頁 MUST 先顯示可操作的選股面板與右側 K 線面板，不得持續只顯示「載入交易終端…」
- **AND** 初始尚無圖表商品時 MUST 顯示可理解的等待商品狀態

#### Scenario: 開頁不訂閱作用中清單

- **WHEN** 專用選股版面完成首次渲染，且使用者尚未點選選股結果
- **THEN** 系統 MUST NOT 因作用中自選清單內容呼叫 `/api/v1/stream/subscribe`
- **AND** 來源主頁既有行情訂閱與一般交易 workspace 行為 MUST 保持不變

#### Scenario: 點選結果後載入指定商品

- **WHEN** 使用者明確點選一筆可操作的選股結果並指定未鎖定 K 線圖
- **THEN** 系統 MUST 只為該 selection generation 解析商品並取得圖表與 Snapshot 所需資料
- **AND** MUST NOT 因這次點選回頭載入或訂閱整份作用中自選清單

#### Scenario: 選股底稿可用但 Shioaji watchlist 延遲

- **WHEN** 5174 選股底稿可讀，但 Shioaji watchlist 請求延遲或失敗
- **THEN** 使用者 MUST 仍可設定條件、檢視底稿狀態及執行不依賴 Shioaji 的選股查詢
- **AND** 依賴清單或圖表的操作 MUST 個別呈現其錯誤，不得重新封鎖整個 workspace

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

### Requirement: 選股資料能力升級相容性
系統 MUST 讓OHLC條件讀取已驗證v1與v2行情，且低能力清理不可刪除高能力歷史。資料不足 MUST 顯示無法判定或等待，不可冒充零檔。

#### Scenario: 既有行情升級為含成交量版本
- **WHEN** v4將共用行情升級為canonical-complete-v2
- **THEN** v3分型及布林仍使用相同OHLC並保留有效判定

#### Scenario: 關閉高版本條件但保留排序
- **WHEN** 使用者停用最後一個高版本條件
- **THEN** 查詢使用其版本合法排序而不回傳400

### Requirement: 交易日與週次不得壓縮
系統 MUST 依官方時間序列對齊均線、背離及持股週趨勢；缺少所需日期時 MUST 回傳無法判定，不可將較早日期當今日或將隔週當連續週。

#### Scenario: 最近交易日缺行情
- **WHEN** 計算窗缺少必要官方交易日
- **THEN** 該商品回傳 non_adjacent_sessions，不發布過期訊號為今日訊號

#### Scenario: 個別商品缺週資料
- **WHEN** 某商品缺少所需官方期別
- **THEN** 只有該商品無法判定，其他商品仍按完整期別計算

### Requirement: 成功收據不可掩蓋資料遺失
準備器 MUST 同時核對實際逐商品資料覆蓋；有歷史成功收據但資料缺少時 MUST 只重新開啟缺少的市場日期。

#### Scenario: 高能力歷史遭舊清理器刪除
- **WHEN** 既有收據完整但實際高能力歷史列缺少
- **THEN** 有界修復缺口且保留其他已完成日期，不以收據數量冒充資料完整
