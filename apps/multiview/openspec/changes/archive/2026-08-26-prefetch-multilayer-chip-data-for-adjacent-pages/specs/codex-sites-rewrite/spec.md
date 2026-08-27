## MODIFIED Requirements

### Requirement: 多圖籌碼請求必須受快取與併發保護

系統 MUST 讓多個 panel、同一 panel 的多個籌碼 pane，以及多層副圖下一頁預載共用相同 symbol、dataset 與日期範圍的 D1 資料、完成 response cache 及 single-flight，不得因 1／2／3／4／6／8 圖、方式 B 同時顯示或背景預載而逐 panel、逐 pane 重複抓取相同上游資料。

#### Scenario: 八個 panel 含重複台股 symbol
- **WHEN** 八圖模式中多個 panel 同時選取相同普通股與籌碼族群
- **THEN** 相同缺口最多產生一個上游請求
- **AND** 各 panel 取得一致的 rows、來源與資料日期

#### Scenario: 多層副圖背景預取下一頁商品
- **WHEN** 現有 K 線背景預取完成下一頁 eligible 台股商品，且 effective presentation mode 為多層副圖
- **THEN** 系統 MUST 只為每檔商品已選 pane 所需的去重 datasets 建立一個 bounded chip prefetch request
- **AND** 相同 request identity 的前景 panel、其他 panel 與背景 job MUST 共用完成 cache 或 in-flight request
- **AND** 未選取 dataset、單一副圖、非日 K、非合格台股或 6／8 圖 MUST NOT 自動觸發籌碼預載或籌碼歷史回補

#### Scenario: 多個 panel 使用同一 TDCC 週快照
- **WHEN** 多個 panel 同時顯示相同或不同個股的大戶／散戶副圖
- **THEN** Worker MUST 從同一份 D1 全市場週快照提供各 symbol 資料
- **AND** MUST NOT 逐 panel、逐 symbol 重複下載 TDCC 全市場資料

#### Scenario: 同一 panel 的多個 pane 共用 dataset
- **WHEN** 方式 B 同時顯示外資、投信、自營商及三大法人合計四個 pane
- **THEN** 四個 pane MUST 共用同一份 `institutional-flow` response 與 D1 查詢結果
- **AND** MUST NOT 為每個 pane 分別呼叫相同上游

## ADDED Requirements

### Requirement: 分類下一頁預載必須依圖表數量與資源預算執行

系統 MUST 以目前分類頁圖表數量作為下一頁預載商品上限，依 canonical ordering 只處理下一頁實際商品，並以 priority、並行、timeout、generation、visibility 與 network gate 保護可見頁面及資料來源。背景預載 MUST 為 best-effort，不得阻塞或改寫目前頁面。

#### Scenario: 四圖模式預載完整下一頁
- **WHEN** 使用者位於四圖模式且下一頁至少有四檔 canonical 商品
- **THEN** K 線預載完成後 MUST 最多排入四檔下一頁 chip prefetch jobs
- **AND** jobs MUST 保持 canonical 下一頁順序，不得擴張至再下一頁或相鄰頁籤

#### Scenario: 最後一頁商品不足
- **WHEN** 目前圖表數量為四，但下一頁只剩兩檔商品
- **THEN** 系統 MUST 只預載該兩檔商品
- **AND** MUST NOT 以 placeholder、重複商品或前一頁商品補滿四檔

#### Scenario: 分頁 context 在預載期間改變
- **WHEN** 使用者在 chip prefetch 尚未完成時切換頁面、頁籤、圖數、presentation mode、週期或 canonical ordering
- **THEN** 舊 generation 的未開始 jobs MUST 取消，已失效 callback MUST NOT 操作目前 panel 或 notice
- **AND** 相同 request identity 已完成的合法 payload MAY 留在 bounded cache 供後續使用

#### Scenario: 頁面隱藏或使用節省流量
- **WHEN** 頁面不可見，或瀏覽器明確回報 `saveData=true` 或受支援的低速網路狀態
- **THEN** 系統 MUST 暫停啟動新的籌碼預載 request
- **AND** 目前頁面前景載入、既有 cache 與使用者主動切頁 MUST 繼續正常運作

### Requirement: 預載效益必須能以安全指標驗收

系統 MUST 以不含個人清單、秘密值、完整商品清單或完整 payload 的 aggregate metrics，區分籌碼預載 request、完成 cache hit、in-flight join、切頁後實際使用、未使用淘汰、失敗與 queue depth，並量測切頁至主圖及已選副圖首繪完成時間。

#### Scenario: 使用者切到已完成預載的下一頁
- **WHEN** 下一頁所需 K 線與 chip payload 已在 cache，且使用者切換至該頁
- **THEN** debug／驗收報告 MUST 將該 payload 計為 `usedAfterNavigation`
- **AND** foreground revalidate MUST NOT 被誤計為第二次背景預載

#### Scenario: 預載完成但沒有被使用
- **WHEN** payload 因 cache 上限淘汰前未被對應頁面使用
- **THEN** aggregate metrics MUST 計入 `evictedUnused`
- **AND** report MUST NOT 暴露該使用者的頁籤名稱、完整 symbol 清單或 request URL
