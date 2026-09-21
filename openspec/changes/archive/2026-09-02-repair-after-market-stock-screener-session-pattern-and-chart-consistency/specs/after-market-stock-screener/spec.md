## MODIFIED Requirements

### Requirement: 結果必須呈現可追溯的資料日期與全市場覆蓋

結果區 MUST 呈現日量比較的兩個交易日、TDCC 比較的兩個官方週日期、技術型態最後交易日、`effectiveSessionDate`、快照產生時間、實際套用條件、母體總檔數、可判定檔數、符合／不符合／無法判定檔數及逐條件缺漏數。每筆成交量結果 MUST 把 P／D 日期與數值放在同一 evidence；成交值只作篩選，不在結果卡顯示數值或日期。面板 MUST 允許查看無法判定的商品與原因；MUST NOT 以當天日曆日期、請求時間、UI 重整時間、圖表最後 K 棒日期或較舊 snapshot 冒充資料日期。

未啟用且尚無資料的條件，其日期／指標 MUST 標示未提供，不以要求兩種資料都就緒阻止單條件篩選。stale 或 mixed-session response MUST 顯示最後合法日期與等待原因；其 rows MUST NOT 保持可點選、可加入清單或被描述成當期符合結果。

#### Scenario: 部分商品缺少前一週

- **WHEN** 啟用的大戶條件有商品缺前一官方週期
- **THEN** 面板 MUST 清楚呈現缺漏數與受影響商品原因，且不得以「0 檔符合」暗示全市場皆已完整比較

#### Scenario: 官方新日資料尚未公布

- **WHEN** 新交易日已收盤但來源還沒有可驗證的正式資料
- **THEN** 面板 MUST 顯示等待新資料及上次快照的原比較日期，不納入當日盤中累計量或更新舊資料日期
- **AND** 舊結果 MUST 以歷史快照呈現並停止當期操作，不得只顯示 stale 警告後繼續提供「加入清單」

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
