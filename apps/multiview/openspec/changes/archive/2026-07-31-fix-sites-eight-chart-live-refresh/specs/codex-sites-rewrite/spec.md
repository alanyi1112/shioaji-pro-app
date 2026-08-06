## ADDED Requirements

### Requirement: Sites 多圖即時更新必須頁面級有界

Sites 保留站 MUST 將目前可見的 1／2／3／4／6／8 個 panel 合併為頁面級有界更新，不得讓每個 panel 維持獨立且無限期占用的同源長連線。更新協調器 MUST 在新 panel 加入、分頁返回前景或網路恢復時立即安排 fresh batch，並在休市、背景分頁或離線時降低頻率或暫停。

#### Scenario: 八圖頁面首次載入

- **WHEN** 使用者開啟或切換到含八個可見商品的 Sites 頁籤
- **THEN** 八個 panel MUST 在完成初始載入後加入同一頁面級更新協調器
- **AND** 新加入的 panel MUST 立即納入下一個 batch，不得等待既有長週期 timer
- **AND** 系統 MUST NOT 為八個 panel 建立八條無限期 `EventSource`

#### Scenario: 部分 panel 較晚完成初始載入

- **WHEN** 第一個 batch 執行期間仍有其他可見 panel 完成初始載入
- **THEN** 協調器 MUST 在目前 batch 結束後立即補跑一次
- **AND** 較晚加入的 panel MUST 不必等待一般盤中或休市輪詢間隔才取得 fresh payload
- **AND** 單一商品失敗 MUST NOT 清除其他 panel 的有效資料

#### Scenario: 背景分頁恢復

- **WHEN** Sites 頁面由 hidden 返回 visible，或瀏覽器由 offline 返回 online
- **THEN** 協調器 MUST 取代尚未到期的低頻 timer 並立即刷新目前可見 panel
- **AND** 更新 MUST 保留每個 panel 的商品、週期、指標參數與已載入資料

#### Scenario: 使用者切換頁籤或圖表數量

- **WHEN** panel 被銷毀、商品被替換，或使用者切換分類頁籤與圖表數量
- **THEN** 舊 panel MUST 取消其頁面級 subscription
- **AND** 後續 batch MUST 只包含目前仍有效且可見的 panel

#### Scenario: Sites 保留站正式驗收

- **WHEN** 修正版本部署到 Sites 保留站且台股盤中有新報價
- **THEN** 驗收 MUST 確認同一八圖頁面每個 panel 都顯示本交易日的新鮮 K 線與報價時間
- **AND** MUST 實際切換至少兩個八圖頁籤並確認沒有部分 panel 長時間停留在前一交易日
