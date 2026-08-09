## ADDED Requirements

### Requirement: 單一商品圖初次載入必須顯示有效 canonical viewport
MultiView 從多圖開啟單一商品圖，或直接載入合法單一商品 URL 時，系統 MUST 在行情資料與初始版面穩定後顯示目前 canonical candles，且 MUST 讓第一根與最後一根已載入 K 棒具有有限座標、可視範圍與資料索引範圍重疊，並保留既定右側 K 棒空間。系統 MUST NOT 讓全部 K 棒貼在最左側、最右側或只佔 plot 的不合理小範圍。

#### Scenario: 多圖開啟單一商品多層副圖
- **WHEN** 使用者從多圖雙擊台股商品並以多層副圖開啟單一商品日 K
- **THEN** 主圖 MUST 顯示完整初始 canonical candle 範圍及既定右側空間
- **AND** 技術副圖與所有已掛載籌碼副圖 MUST 使用相同可視範圍

#### Scenario: 單一副圖載入期間改變尺寸
- **WHEN** 單一商品圖以單一副圖載入，且 chart 容器在資料套用前後發生 resize
- **THEN** 主圖與技術副圖 MUST 維持有效 canonical viewport
- **AND** 不得因尺寸放大而在資料左側或右側產生超過資料跨度的不合理空白

### Requirement: 程式性圖表事件不得成為使用者 viewport 意圖
資料 `setData`／`update`、chart 建立或 recovery、`autoSize`、ResizeObserver、IntersectionObserver、副圖 mount／unmount、非同步籌碼 render、layout reconciliation 及程式性跨 pane 同步所產生的 range callback MUST 被視為程式性事件。未伴隨目前 pane 明確使用者手勢的程式性事件 MUST NOT 更新 panel 的最後接受 viewport，也 MUST NOT 反向改寫其他 pane。

#### Scenario: 延遲籌碼副圖掛載
- **WHEN** 多層副圖中的籌碼 pane 在主圖完成初始 refit 後才由 IntersectionObserver 掛載並繪製資料
- **THEN** 新 pane MUST 拉取主圖最後接受的 viewport
- **AND** 新 pane 自己的初始或 resize callback MUST NOT 改寫主圖或其他 pane

#### Scenario: 技術副圖 recovery 或 resize
- **WHEN** 技術副圖因資料可用性 recovery、ResizeObserver 或 layout refresh 產生 range callback
- **THEN** callback MUST NOT 被當成使用者平移或縮放
- **AND** 主圖最後接受的 viewport MUST 保持不變

### Requirement: 合法使用者 viewport 操作必須跨 pane 同步並被保留
系統 MUST 以 source、panel generation 及明確 pointer／wheel 手勢辨識使用者 viewport 意圖。合法使用者平移或縮放產生的範圍 MUST 同步至目前已掛載的主圖與副圖；後續程式性 resize、資料更新或 pane 掛載 MUST 保留該使用者範圍，不得自動回到初始全資料範圍。

#### Scenario: 使用者拖曳技術副圖
- **WHEN** 使用者在技術副圖按下並拖曳時間軸，產生合法 visible range
- **THEN** 主圖與籌碼副圖 MUST 同步到該範圍
- **AND** 同一手勢結束後的程式性 callback MUST NOT 再次漂移 viewport

#### Scenario: 多層副圖一般滾輪與縮放滾輪
- **WHEN** 使用者在多層副圖使用一般 wheel
- **THEN** 系統 MUST 維持既有頁面捲動行為，且不得授權圖表 viewport 變更
- **WHEN** 使用者使用既定 Alt／Option wheel 縮放
- **THEN** 該 pane 的合法 viewport MUST 跨 pane 同步並成為最後接受範圍

#### Scenario: 使用者操作後收到即時資料
- **WHEN** 使用者已平移或縮放，之後收到 current-bar update、新 K 棒或批次行情更新
- **THEN** 系統 MUST 依既有最新 K 棒跟隨規則更新資料
- **AND** 不得因資料事件把 viewport 重設為初始 canonical 範圍或程式性錯誤範圍

### Requirement: 初始 viewport 自我修復必須有界且不得覆蓋使用者操作
在目前 panel generation 尚未接受任何使用者 viewport 手勢時，系統 MUST 檢查 logical range、資料索引重疊、首尾 K 棒座標、canonical candle 可見佔比及右側 gap。任何 invariant 不合法時，系統 MUST 有界地把全部已掛載 pane 修復到 canonical 初始 range；接受第一個合法使用者 viewport 後，系統 MUST 停止回到初始全資料範圍的自我修復。

#### Scenario: K 棒貼左且右側大幅空白
- **WHEN** 初始 range 漂成只讓最後一至數根 K 棒出現在 plot 左側，且右側空白超過合理資料跨度
- **THEN** 系統 MUST 將主圖與所有副圖修復到 canonical 初始 range
- **AND** debug report MUST 將修復前狀態辨識為失敗

#### Scenario: 使用者刻意放大局部範圍
- **WHEN** 系統已接受合法使用者縮放，使首根或末根已載入 K 棒不在 viewport 中
- **THEN** 自我修復 MUST NOT 將範圍重設為全資料
- **AND** 後續 layout refresh MUST 回復該使用者最後接受範圍

### Requirement: 動態驗收必須覆蓋單一與多層副圖時序
MultiView MUST 提供不含帳號、秘密或完整行情內容的 panel-local debug report，至少揭露 candle count、visible logical range、首尾座標、資料可見佔比、右側 gap、viewport invariant、修復次數及各已掛載 pane range。自動化驗收 MUST 實際執行延遲 resize／掛載與重複開啟流程，不得只以原始碼字串存在作為 viewport 正確性證據。

#### Scenario: 重複開啟多層副圖單一商品
- **WHEN** browser acceptance 以相同商品、時框與多個籌碼 pane 重複開啟單一商品圖
- **THEN** 每次 settle 後的 viewport invariant MUST 通過
- **AND** 各已掛載 pane 的 range MUST 與最後接受範圍一致

#### Scenario: 單一副圖延遲 resize 驗收
- **WHEN** browser acceptance 在單一副圖載入期間改變 viewport 或容器尺寸
- **THEN** settle 後首尾座標、資料可見佔比與右側 gap MUST 同時通過
- **AND** 驗收不得因只檢查右側 gap 而把左側過大空白判定為成功
