## ADDED Requirements

### Requirement: 多圖 panel 必須支援左鍵按住上方區域直接拖曳

系統 MUST 在目前有效圖數為 2、3、4、6 或 8 且目前頁至少有兩個 canonical 商品時，讓使用者以滑鼠左鍵按住 panel 上方商品標題／報價區的非互動部分並移動，直接啟動排序；系統 MUST 提供視覺提示及可聚焦的鍵盤排序把手，但滑鼠操作不得只能命中小把手。其他 panel 區域 MUST 保留原本 K 線、選單、繪圖與雙擊新分頁互動。

#### Scenario: 左鍵按住商品 panel 上方直接移動

- **WHEN** 使用者在含至少兩個商品的 2、3、4、6 或 8 圖，以滑鼠左鍵按住 panel 上方商品標題／報價區的非互動部分並移動超過門檻
- **THEN** 系統 MUST 直接啟動該商品 panel 的拖曳排序，不要求使用者先點中小把手
- **AND** 上方可拖曳區 MUST 以 `grab`／`grabbing` 或等效方式提供可發現提示
- **AND** 鍵盤排序把手 MUST 提供 canonical 商品名稱、目前位置與總數的 accessible name

#### Scenario: 點擊但未形成拖曳

- **WHEN** 使用者在上方可拖曳區按下並放開左鍵，但 pointer 移動未超過 movement threshold
- **THEN** 系統 MUST 不啟動排序、不改變商品順序且不送出 request
- **AND** 原本合法的 click／focus 行為 MUST 保持可用

#### Scenario: 互動控制與圖表區不啟動排序

- **WHEN** 使用者在商品或週期 select、details／summary、button、input、其他互動控制、主副圖 surface 或 Canvas 按住左鍵並移動
- **THEN** 系統 MUST NOT 啟動 panel 排序
- **AND** K 線平移、縮放、十字線、繪圖及工具列控制 MUST 保持原行為

#### Scenario: 單圖或單一商品不啟用排序入口

- **WHEN** 目前有效圖數為 1、single-view 生命週期，或目前頁只有一個 canonical 商品
- **THEN** 系統 MUST 不啟用上方排序熱區，並不顯示或不啟用鍵盤排序把手
- **AND** 不得建立無法完成的 drag controller

### Requirement: pointer 拖曳必須提供跨 grid 的明確預覽

系統 MUST 依目前 panel 的實際幾何位置計算拖曳候選 slot，並以 ghost、來源狀態及插入位置提示呈現預覽；計算 MUST 適用於不同圖數、主副圖模式及 responsive grid，不得只以寫死欄數推斷。

#### Scenario: 在多列 grid 移動 panel

- **WHEN** 使用者從 panel 上方可拖曳區或提示把手，把 panel 由一個 row／column 拖向另一個可見 slot
- **THEN** 系統 MUST 依 panel rectangles 與 pointer 位置選出視覺上的目標 index
- **AND** ghost 與插入提示 MUST 清楚指出來源與預計放置位置
- **AND** 游標移回其他 slot 時提示 MUST 即時更新

#### Scenario: 拖曳期間不得移動真正圖表

- **WHEN** pointer 拖曳仍在進行且尚未合法 drop
- **THEN** 真正 panel、Canvas、controller array 與 canonical 商品順序 MUST 保持原位
- **AND** 系統 MUST NOT destroy、resize、reload panel，或新增 K 線、籌碼與 SSE request

### Requirement: 合法 drop 必須原子重排且保留圖表生命週期

系統 MUST 在合法 drop 後一次重排目前頁的 panel DOM、controller order 與 mutable position，並把同一 visible identity order 合併至頁籤 canonical 商品順序；純排序 MUST 保留每個被移動 panel 的目前內容與生命週期。

#### Scenario: 完成目前頁內拖曳

- **WHEN** 使用者在有效目標 slot 放開 pointer
- **THEN** 被拖曳 panel MUST 出現在新位置，其餘 panel 依 row-major 順序補位
- **AND** 各 panel 的目前顯示商品、interval、visible range、主副圖狀態、annotation、stream 與 cache MUST 跟隨原 controller 保留
- **AND** 系統 MUST 只排程一次必要 layout refresh，不得呼叫完整 `renderPanels()` 或重新載入資料

#### Scenario: 拖曳後雙擊新分頁

- **WHEN** 使用者完成重排後雙擊任一 panel 的非互動區域
- **THEN** 系統 MUST 依該 panel 重排後的 controller／element identity 開啟正確商品與週期的單圖新分頁
- **AND** 不得因舊 index 開啟其他位置的商品

### Requirement: 拖曳取消必須完整且不產生副作用

系統 MUST 以單一 cleanup 路徑處理取消與遺失 pointer 結束事件，移除 ghost、placeholder、listeners、animation frame 與 dragging 樣式，並保留拖曳前順序。

#### Scenario: 使用者主動取消拖曳

- **WHEN** 使用者按下 `Escape`、將 pointer 放到無效區域，或發生 `pointercancel`
- **THEN** 系統 MUST 結束拖曳並回到開始前的 panel 與 canonical 順序
- **AND** 系統 MUST NOT 送出排序 request
- **AND** 不得殘留 ghost、插入提示、grabbing 樣式或拖曳訊息

#### Scenario: 瀏覽器遺失正常 pointerup

- **WHEN** 滑鼠主要按鍵已放開、視窗失焦、文件隱藏、viewport resize，或使用者切換頁籤／頁數／圖數
- **THEN** 系統 MUST 從 window／document 層級安全取消拖曳
- **AND** 不得留下會攔截後續圖表互動的 listener 或狀態

### Requirement: panel 排序必須提供鍵盤等效操作

每個排序把手 MUST 支援依實際 grid 幾何移動 panel，且有效鍵盤移動 MUST 與 pointer drop 使用相同的原子套用及永久保存路徑。

#### Scenario: 鍵盤在 grid 中移動 panel

- **WHEN** 焦點位於排序把手且使用者按下可到達其他 slot 的方向鍵
- **THEN** Left／Right MUST 移向同列相鄰 slot，Up／Down MUST 移向相鄰視覺列最接近的 slot
- **AND** panel MUST 立即移動、焦點 MUST 跟隨原把手
- **AND** accessible name 與 live status MUST 更新新位置

#### Scenario: 方向上沒有合法位置

- **WHEN** 使用者按下的方向鍵在目前 responsive grid 中沒有可到達 slot
- **THEN** 系統 MUST 保持順序不變
- **AND** MUST NOT 送出排序 request

### Requirement: 臨時 panel 商品不得破壞 canonical 排序身分

panel 排序 MUST 以頁籤限定的 canonical item identity／slot 為準，不得只以目前下拉選單顯示的 symbol 建立排序 request；臨時選擇與重複顯示 MUST NOT 新增、刪除或替換清單商品。

#### Scenario: 多個 panel 暫時顯示同一商品

- **WHEN** 使用者先讓兩個 panel 暫時顯示相同 symbol，再拖曳其中一個 panel
- **THEN** 系統 MUST 仍以兩個不重複的 canonical item identities 完成順序調整
- **AND** `/api/instruments/reorder` request MUST 維持指定頁籤的完整合法清單
- **AND** 本次排序 MUST NOT 把重複顯示 symbol 寫成新的清單成員

#### Scenario: 臨時顯示商品與 canonical 商品不同

- **WHEN** panel 目前顯示 symbol 不同於其 canonical slot identity
- **THEN** 上方排序區的提示、鍵盤把手或狀態訊息 MUST 讓使用者辨識實際被永久排序的 canonical 清單項目
- **AND** drop 後暫時顯示狀態 MAY 跟隨原 controller 移動，但 MUST NOT 改寫 canonical item identity

### Requirement: 第一版 panel 拖曳必須限定目前分類頁

系統 MUST 只允許在目前可見 page slice 內選擇 drop target，並以該 slice 的新順序替換完整 canonical 清單中的相同範圍；拖曳不得自動切換上一頁或下一頁。

#### Scenario: 在第二個分類頁內排序

- **WHEN** 使用者在有多個分類頁的頁籤第二頁內重排 panel
- **THEN** 系統 MUST 只改變第二頁對應 canonical index 範圍內的相對順序
- **AND** 第一頁及其他不可見項目的相對順序 MUST 保持不變
- **AND** 分頁總數與目前頁碼 MUST 保持不變

#### Scenario: pointer 移向分頁控制或頁面外

- **WHEN** 使用者把拖曳 pointer 移出 chart grid 或移向上一頁／下一頁控制
- **THEN** 系統 MUST 不自動翻頁或建立跨頁 drop target
- **AND** 在有效 grid target 之外放開 MUST 取消該次拖曳
