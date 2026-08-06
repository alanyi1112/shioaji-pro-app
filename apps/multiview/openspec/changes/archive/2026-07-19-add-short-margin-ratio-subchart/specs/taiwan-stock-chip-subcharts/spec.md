## ADDED Requirements

### Requirement: 券資比獨立副圖

系統 MUST 提供可獨立選取的「券資比」籌碼 pane，並 MUST 只以同一交易日、同一筆正規化 `margin-short` row 的融券餘額除以融資餘額後乘以 100 計算百分比。券資比 pane MUST 預設繪製百分比線，MUST 允許使用者從既有右鍵「線圖項目」另行顯示相對前一個合法交易日的日變化柱，並 MUST 沿用 `margin-short` 的 availability、provenance、request cache、回補操作、共用時間軸、右側數值軸與 pane lifecycle。

#### Scenario: 同日融資融券餘額有效
- **WHEN** 某交易日的 `shortTodayBalanceLots` 為 250 張，`marginTodayBalanceLots` 為 10,000 張
- **THEN** 券資比 MUST 計算為 2.50%，並在該交易日繪製百分比線資料點
- **AND** 標題列 MUST 顯示日期、券資比 2.50%、融券餘額 250 張、融資餘額 10,000 張與 `margin-short` 來源

#### Scenario: 融券餘額為零
- **WHEN** 同日融券餘額為 0 且融資餘額為合法正數
- **THEN** 券資比 MUST 顯示並繪製為 0.00%
- **AND** MUST NOT 將合法零值標示為無資料

#### Scenario: 分母為零或任一餘額不合法
- **WHEN** 同日融資餘額為 0，或融資／融券任一餘額缺漏、為負值或非有限值
- **THEN** 券資比 MUST 為 `null` 並在該交易日保留 gap，標題列 MUST 顯示「無資料」
- **AND** MUST NOT 產生無限值、補成 0、沿用其他日期或以不同日期的兩個餘額交叉計算

#### Scenario: 計算券資比日變化
- **WHEN** 目前交易日與前一個具有合法券資比的交易日分別為 2.80% 與 2.50%
- **THEN** 日變化 MUST 顯示為 +0.30%，並在已選取日變化 series 時繪製正值柱
- **AND** 正值 MUST 使用台股紅色、負值 MUST 使用綠色、零值 MUST 使用中性色
- **AND** 查詢範圍內第一個合法券資比 MUST 顯示「首筆／無前日比較」且不得繪製假的日變化柱

#### Scenario: 右鍵選擇券資比線與日變化柱
- **WHEN** 使用者開啟券資比 pane 的既有右鍵功能表
- **THEN** 「線圖項目」MUST 提供「券資比」與「日變化」，預設只勾選券資比
- **AND** 券資比名稱與百分比線 MUST 共用同一系列色，日變化名稱 MUST 使用其項目色，只有數值與柱體依正負方向變色
- **AND** 取消或重新勾選任一 series MUST 原地更新 pane，不得重新請求 `margin-short`

#### Scenario: 方式 A 與方式 B 選取券資比
- **WHEN** 使用者在方式 A 選擇券資比，或在方式 B 將券資比加入既有 pane 組合
- **THEN** 方式 A MUST 在共用副圖槽位顯示券資比，方式 B MUST 依固定 registry 順序建立獨立 pane
- **AND** 券資比 MUST 預設不加入首次方式 B 清單，不得改變既有使用者的預設頁面高度
- **AND** 與融資或融券 pane 同時顯示時 MUST 共用相同 `symbol + margin-short + range` response

#### Scenario: 游標日期與缺資料狀態
- **WHEN** 共用游標移到具有合法券資比的交易日、缺少合法比值的交易日，或游標離開 panel
- **THEN** 標題列 MUST 分別顯示該日真實比值、該日「無資料」，或恢復最新合法日期讀值
- **AND** pane MUST 保持與主圖及其他副圖相同 visible range、共用垂直線與小於等於 1 CSS px 的日期對齊
- **AND** `margin-short` 為 partial、stale、rate-limited 或等待回補時 MUST 顯示既有安全狀態與相同回補操作，不得建立券資比專用上游請求
