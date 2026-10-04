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

### Requirement: 法人反轉條件必須出現在籌碼價量分類並維持精簡編輯

選股條件面板 MUST 在「籌碼／價量」分類加入「外資連賣後轉買＋爆量換手」與「投信連賣後轉買＋爆量換手」。兩項條件預設未啟用且收合；同一時間只展開目前選取的條件，摘要列 MUST 在收合狀態顯示主要預設或使用者設定值，「全部取消」MUST 同時關閉兩項新條件。

#### Scenario: 展開外資反轉條件

- **WHEN** 使用者在「籌碼／價量」分類點擊外資反轉條件
- **THEN** 面板 MUST 展開其緊湊參數編輯區、保持其他條件收合，且不得因新增欄位讓所有說明常駐展開

#### Scenario: 全部取消新舊條件

- **WHEN** 使用者已啟用外資與投信反轉條件後按「全部取消」
- **THEN** 兩項新條件及所有既有條件 MUST 全部切換為未啟用，參數草稿值仍可保留供下次使用

### Requirement: 投信反轉 UI 必須明示成交參與率不是持股比例

投信反轉設定 MUST 顯示可調整的前期日數、今日買超張數、回補強度、成交參與率上下限及共同價量參數；成交參與率欄位與說明 MUST 明確以今日投信淨買超除以今日成交量定義，且不得顯示「投信持股比例」。

#### Scenario: 使用者檢視投信參數

- **WHEN** 使用者展開投信反轉條件
- **THEN** UI MUST 顯示回補強度預設 50%、成交參與率預設大於 1% 且小於 15%，並以短說明標示其為當日流量占比而非持股存量

### Requirement: 法人反轉結果必須能核對條件日期與原因

結果列 MUST 能顯示外資／投信反轉條件總 verdict 與精簡摘要，並在展開證據時列出 `D0`、前期賣超日期、價量基準期間、回補強度、成交參與率及任何 `unknown` 原因。日期顯示 MUST 以 snapshot 的 `effectiveSessionDate` 為準，不得以瀏覽器今日或 raw table 最新日期代替。

#### Scenario: 結果因外資資料缺漏為 unknown

- **WHEN** 某商品的前期外資必要日期缺漏
- **THEN** 結果列 MUST 保留該商品並顯示 `unknown` 與缺漏日期，不得只顯示不符合或從結果中靜默移除

#### Scenario: 結果通過投信反轉

- **WHEN** 某商品投信複合條件為 `pass`
- **THEN** 展開證據 MUST 可核對今日買超張數、前期累計賣超、回補強度、成交參與率、週轉率、MA、成交量及流動性基準

### Requirement: 新條件查詢不得產生交易或清單副作用

編輯、套用、重整、排序、翻頁及檢視法人反轉證據 MUST 只讀 immutable snapshot，不得直接抓取 provider、寫入 Shioaji／MultiView 清單、建立行情訂閱、啟動交易或變更 simulation／production 狀態。

#### Scenario: 反覆調整法人門檻

- **WHEN** 使用者多次修改參數並執行篩選
- **THEN** 系統 MAY 建立不同 criteria fingerprint 的只讀查詢結果，但 provider request、交易狀態、行情訂閱與個人清單 MUST 不因查詢而改變

### Requirement: 選股條件編輯必須以分組收合介面縮短面板

選股面板 MUST 將全部 top-level 條件以「基本條件」、「技術型態」及「籌碼／價量」等可辨識群組呈現。每個群組 MUST 顯示已啟用條件數，每個條件摘要列 MUST 顯示條件名稱、啟用狀態及足以辨識目前草稿的主要參數；同一時間 MUST 至多顯示一組完整條件設定。首次載入 MUST 展開 draft 中依固定畫面順序第一個已啟用條件；若沒有啟用條件，MUST 展開最上方的成交量條件。

展開條件 MUST NOT 隱性啟用或停用該條件。使用者將停用條件切換為啟用時，系統 MUST 同時展開該條件供設定；停用已展開條件 MAY 保持其設定可見。展開群組、目前編輯條件及其他純呈現狀態 MUST NOT 寫入選股 preference、criteria fingerprint 或 API query。

#### Scenario: 初次載入既有草稿

- **WHEN** 使用者開啟選股面板，既有合法 draft 的成交量與千張大戶條件均已啟用
- **THEN** 系統 MUST 展開包含成交量的群組與成交量設定
- **AND** 其餘條件 MUST 只顯示緊湊摘要，不同時顯示完整設定欄位與說明

#### Scenario: 展開停用條件

- **WHEN** 使用者點擊一個目前停用條件的摘要以查看設定
- **THEN** 系統 MUST 展開該條件並收合先前條件
- **AND** 該條件 MUST 保持停用，不得因此進入查詢或 criteria fingerprint

#### Scenario: 啟用條件後立即設定

- **WHEN** 使用者在摘要列將一個停用條件切換為啟用
- **THEN** 系統 MUST 將該條件設為目前展開的唯一完整設定
- **AND** 既有參數 MUST 原樣顯示，不得重設為預設值

#### Scenario: 套用長線佈局草稿

- **WHEN** 使用者啟用「套用長線佈局」草稿
- **THEN** 系統 MUST 沿用既有 preset 內容並展開固定順序中第一個已啟用的 preset 條件
- **AND** MUST NOT 在使用者按下「開始篩選」前查詢或重標既有結果

### Requirement: 選股草稿必須提供可復原的全部取消操作

選股面板 MUST 在條件摘要區提供「全部取消」按鈕及目前已啟用條件數。按下按鈕 MUST 只將全部 top-level draft condition 的 `enabled` 設為 `false`，並 MUST 保留每個條件的門檻、模式、週數、日數、period、turnover 子設定與其他參數。此動作 MUST NOT 呼叫選股 API、保存為已套用 preference、清除已套用 query、response、結果、分頁或圖表選擇。

全部取消後，面板 MUST 顯示取消數量及既有結果尚未改變的可讀回饋，MUST 沿用無啟用條件時的驗證阻止「開始篩選」。沒有任何 draft condition 啟用時，按鈕 MUST 停用。

#### Scenario: 已有結果時全部取消

- **WHEN** 使用者已有一組已套用結果，並在包含三個已啟用條件的 draft 按下「全部取消」
- **THEN** 三個 draft 條件 MUST 全部停用且原參數保持不變
- **AND** 既有結果、已套用條件及其日期證據 MUST 繼續顯示，並標示目前草稿尚未套用
- **AND** 系統 MUST NOT 發出新的 results 或 status request

#### Scenario: 重新啟用已取消條件

- **WHEN** 使用者全部取消後重新啟用其中一個條件
- **THEN** 該條件 MUST 展開並顯示取消前保留的參數
- **AND** 使用者仍須按下「開始篩選」才可提交新 query

#### Scenario: 草稿已無啟用條件

- **WHEN** 所有 draft condition 均為停用
- **THEN** 「全部取消」MUST 呈現停用狀態
- **AND** 「開始篩選」MUST 依既有驗證契約停止查詢並顯示至少啟用一項條件的原因

### Requirement: 選股結果設定與資料證據必須分層且保留主要警告

選股面板 MUST 將組合模式、結果類型、排序欄位與方向放入緊湊的「結果設定」，其摘要 MUST 顯示目前值；「開始篩選」、驗證錯誤及「條件尚未套用」狀態 MUST 保持直接可見或在正常鍵盤流程中可抵達，不得只藏於收合內容。

狀態區 MUST 常駐顯示目前 state、主要 reason，以及會影響結果可信度或可操作性的 expected／effective 日期不一致、stale／partial、來源離線或逐市場未完成警告。完整已套用條件、日期 anchors、TDCC 歷史窗、技術資料範圍、coverage、counts、逐條件缺漏及 snapshot time MUST 保留在可由鍵盤展開的「資料範圍與完整性」；收合 MUST NOT 刪除、改寫或以畫面日期推測任何 evidence。計算規則與資料來源 MAY 預設收合，但 MUST 可由鍵盤展開。

目標 K 線圖選擇與新增圖表控制 MUST 位於結果區的緊湊工具列，並 MUST 保留沒有可用目標時的可讀指引及既有圖表連動隔離。

#### Scenario: 完整資料期間預設收合

- **WHEN** 選股 response 包含 daily、weekly、technical、coverage、counts 與 snapshot time
- **THEN** 面板 MUST 以「資料範圍與完整性」摘要呈現且預設不展開全部明細
- **AND** 使用者展開後 MUST 能讀取 response 原有的完整日期、涵蓋率、缺漏與快照證據

#### Scenario: 有效資料日落後預期資料日

- **WHEN** `expectedSessionDate` 晚於 `effectiveSessionDate`
- **THEN** 面板 MUST 在未展開詳細證據時仍直接顯示日期不一致及主要等待原因
- **AND** 舊 rows 的可操作性 MUST 沿用既有 fail-closed 契約，不得因 UI 收合而恢復

#### Scenario: 服務離線但保留舊結果

- **WHEN** 本機選股服務離線且畫面仍保留最後已套用結果
- **THEN** 離線與舊資料警告 MUST 常駐可見
- **AND** 收合詳細證據 MUST NOT 清除舊結果的條件、來源日期或 snapshot time

#### Scenario: 鍵盤操作緊湊面板

- **WHEN** 使用者在 600 CSS px 高、最小允許面板寬度與特大字級下只用鍵盤選擇群組、展開條件、修改參數、查看資料完整性並提交
- **THEN** 焦點順序、展開狀態、可存取名稱、驗證訊息與主要警告 MUST 可辨識
- **AND** 內容 MUST 透過面板內捲動抵達，不得產生水平 overflow、誤觸 workspace 拖曳或讓收合內容取得不可見焦點

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

### Requirement: 技術分類必須提供收合的五種反轉形態控制

「選股篩選」版面的「選股」面板 MUST 在技術型態中緊接 K 棒分型提供「K 線反轉型態」，預設停用、初始五種子型態全選。展開後 MUST 提供紅三兵、看跌吞噬、晨星、三隻烏鴉、刺透五個具可存取選取狀態的複選按鈕與看多／看空文字，刺透屬看多。多選 MUST 表示任一型態，不代表全部同時成立；所有必要子條件仍固定 AND。

摘要 MUST 顯示啟用狀態、選中型態及成立／確認模式；完整設定 MUST 遵守既有同時至多一組展開。數值、十字晨星子型、跳空、烏鴉首根限制及刺透回補／開盤／長首棒 MUST 可檢視／設定，工程預設 MUST 不冒稱影片原始統計參數。純展開、切換說明 MUST 不改 enabled、不提交查詢，也不覆寫每日 profile。

#### Scenario: 啟用後選擇晨星

- **WHEN** 使用者啟用新條件並只保留晨星
- **THEN** MUST 展開晨星適用設定、以單一分支查詢，其他四種不得成為必要條件

#### Scenario: 空型態集合

- **WHEN** 新分支啟用但五個按鈕皆未選
- **THEN** MUST 顯示可讀驗證錯誤且不送 API，不默默恢復全選或清除舊結果

### Requirement: 形態說明必須揭露統計來源與研究口徑

面板 MUST 提供預設收合、鍵盤可展開的「型態條件」、「統計與來源」、「配合條件」說明。統計 MUST 使用版本化 catalog 顯示紅三兵 82%／原研究排名 3、看跌吞噬 79%／5、一般晨星 78%／6、三隻烏鴉 78%／7；晨星十字 MUST 另標 76%／8，不與一般晨星混用。

說明 MUST 明示影片四強名次不等於原研究全部 103 種排名，約 470 萬根為整體研究規模不是各型態例數；顯示來源連結／核對日，並區分反轉頻率、綜合表現與交易勝率。MUST NOT 把外部數字宣稱為本功能台股回測、使用者改參數後的勝率或未來保證。若顯示烏鴉綜合表現第 3，MUST 另列指標名稱，不改其反轉率排名 7。未核實的研究數字 MUST 不補寫。

刺透 MUST 另列 Bulkowski 64% 反轉率與 Lu／Shiu／Liu（2012）Table 1 的台股研究扣除成本後平均報酬 13.25%、獲利比例 90.91%、11 筆有效交易觀察數；母體、2002-10-29 至 2008-12-31 期間、假設每次完整交易 1% 成本及相反型態出場的變動持有期 MUST 隨說明可見。MUST NOT 將其寫成 90.91% 反轉率、年化 13.25%、目前全台股勝率或省略小樣本。樣本外數字若顯示 MUST 另列期間與 12 筆樣本，不混用。MUST 揭露本功能 OLS 趨勢、改參數／額外過濾及僅篩選不重製原研究持有策略的差異。

#### Scenario: 刺透研究數字不可混成一個成功率

- **WHEN** 使用者展開刺透統計說明或只查刺透
- **THEN** 64% MUST 標反轉率；13.25% MUST 標平均交易報酬；90.91% MUST 標原研究獲利比例且同列 11 筆、期間與策略，不能當成當次查詢預測勝率

#### Scenario: 晨星十字結果

- **WHEN** 符合結果的第二根為精確十字線
- **THEN** MUST 顯示晨星十字子型及其 76% 原研究參考，不只顯示一般晨星 78%

#### Scenario: 使用者調整形態門檻

- **WHEN** 使用者調整長實體、回補或跳空設定
- **THEN** catalog MUST 仍標示來源參考並揭露變體／門檻差異，不將來源百分比改作當次查詢實測成功率

### Requirement: 偏好遷移與全部取消必須保留原有設定

合法 v8 preference MUST 決定性遷移至 v9，保留所有舊條件、組合、排序及顯示值，新增反轉分支停用，內部子型態初始全選。未知版本或非法數值 MUST fail closed 並保留最後合法偏好；晨星回補低於 50%、不合法枚舉、重複／空選集合或超出合法參數範圍 MUST 阻止提交，不悄悄修正。

全部取消 MUST 關閉新舊 top-level 分支，保留選中子型態與參數，不改已套用 query、結果、圖表、清單或布林每日 profile。改草稿 MUST 不改舊結果 evidence；只有明確提交才套用。

#### Scenario: v8 偏好升級

- **WHEN** 使用者已有合法 v8 設定
- **THEN** MUST 保留其既有行為及每日布林 revision，不自動啟用五型態或重算舊 snapshot

#### Scenario: 全部取消後重新啟用

- **WHEN** 使用者全部取消後重新啟用反轉條件
- **THEN** MUST 顯示取消前的子集合與合法數值，舊結果保持原條件直到再次提交

### Requirement: 反轉結果必須依台灣陰陽配色顯示可稽核證據

結果卡 MUST 顯示商品、命中型態／子型、看多／看空、最新完整資料日、形成／確認模式，並可展開逐棒及子條件 evidence。陽線圖示與看多標記 MUST 採台灣紅色，陰線圖示與看空標記採綠色，同時提供不依賴顏色的文字；不能把漲跌昨收代替 open／close 的陰陽判定。

缺資料、pending、stale、來源能力不足與日期不一致 MUST 常駐揭露主要原因，不隱藏在統計說明內。五型態的零結果 MUST 誠實顯示，不以外部高反轉率為由放寬條件或製造案例。

#### Scenario: 第三根最高價過中點但收盤不足

- **WHEN** 晨星第三根 high 超過中點而 close 未超過
- **THEN** 證據 MUST 顯示收盤回補條件 fail，不能以圖上紅棒或影線判 pass

#### Scenario: 沒有符合的三隻烏鴉

- **WHEN** 嚴格參數的全市場完整查詢沒有符合烏鴉
- **THEN** MUST 顯示正確零結果及母體／unknown，不能偷偷取消長實體或前期上漲限制

### Requirement: 新控制必須維持窄面板與既有操作隔離

新控制及說明 MUST 在 600 CSS px 高、最小允許寬度、特大字級及明暗主題下可捲動與鍵盤操作，不產生水平 overflow、不可見焦點或 workspace 拖曳誤觸。切換型態、排序、翻頁及展開證據 MUST 不觸發行情下載、委託、交易草稿、清單寫入或 runtime lifecycle。

點選股票 MUST 沿用指定未鎖定圖表政策，後續結果更新不得自動切換商品；只有明確加入清單才可沿用既有雙清單同步。驗收若需要改商品、清單或額外行情請求，MUST 明確界定操作與權限、保存前後 network／狀態並精準復原測試增量，不能用共用 stream healthy 代替逐請求副作用證據。

#### Scenario: 鍵盤設定晨星條件

- **WHEN** 使用者在窄面板用鍵盤選擇晨星、修改回補、展開統計並查詢
- **THEN** 所有控制、警告及結果 evidence MUST 可抵達，整個 workspace 不因說明展開超出 viewport

#### Scenario: 查詢更新後保留指定圖表

- **WHEN** 使用者已點選一檔結果，之後變更型態查詢或背景發布新資料
- **THEN** 圖表 MUST 保持原商品，交易與兩套清單不得自動改動
