## ADDED Requirements

### Requirement: 籌碼副圖更新必須保留最後有效 series

籌碼副圖在完成 cache 首繪、stale-while-revalidate、前景載入、背景預載、手動回補、強制更新及開盤即時 K 棒擴張期間，MUST 先以逐 dataset 非退化規則 reconcile 候選 payload，再提交 request cache、manager payload、readout 與 pane render。已有可繪製 series 時，HTTP 成功但空、較舊、較少或 coverage 倒退的候選 slice MUST NOT 觸發清除該 dataset 的現有 series；不同 identity 的資料 MUST NOT 互相沿用。

#### Scenario: cache 首繪後背景回應為空
- **WHEN** pane 已由 cache 顯示某 dataset 的合法歷史線圖，背景 revalidate 回傳 HTTP 200 但該 dataset 為空或沒有可繪製點
- **THEN** pane MUST 保留最後有效 series、readout 與實際資料日期
- **AND** 完成 cache MUST NOT 被未 reconcile 的弱 payload 覆寫

#### Scenario: 開盤新 K 棒改變 request range
- **WHEN** 開盤即時行情使日 K request range 加入新交易日，而該籌碼 dataset 尚未發布新資料
- **THEN** 系統 MUST 將同一 symbol、interval 與 dataset 的最後有效切片裁切到目前 range 後繼續顯示
- **AND** MUST 明示最新有效資料日期及當期尚未更新，不得把歷史線圖整組改成「當日無資料」

#### Scenario: 混合 payload 逐 pane 更新
- **WHEN** 同一 payload 中法人或融資券 dataset 有合法更新，而大戶／散戶或借券 dataset 暫時退化
- **THEN** 使用前者的 pane MUST 顯示新資料，使用後者的 pane MUST 保留最後有效資料
- **AND** 各 pane 的讀值、詳細資料、coverage 與 notice MUST 與其實際採用的 dataset slice 一致

#### Scenario: 游標停在未發布交易日
- **WHEN** 歷史 series 被保留，但游標日期不是該 dataset 的任何實際 `sessionDate` 或 `dataDate`
- **THEN** 該日期的逐日讀值 MUST 仍顯示「當日無資料」或同等缺值狀態
- **AND** MUST NOT 把被保留的最近資料改標成游標日期

#### Scenario: 切換商品或週期
- **WHEN** 使用者切換 symbol、interval、非台股 context 或不支援籌碼的模式
- **THEN** 系統 MUST 依新 identity 重新判定資料，不得顯示前一 identity 的 verified slice
- **AND** 真正不適用或首次無資料的 pane MUST 顯示安全空狀態

#### Scenario: 手動回補未產生更好資料
- **WHEN** 使用者要求合法的籌碼回補或強制更新，但完成結果仍為空、較舊或 coverage 未增加
- **THEN** 系統 MUST 保留回補前最後有效 series 並顯示回補狀態
- **AND** 只有通過逐 dataset 非退化檢查的結果才能取代目前畫面

#### Scenario: Range 裁切與來源 metadata 一致
- **WHEN** verified store 包含目前 candle range 以外的合法歷史，而本次畫面只要求較窄範圍
- **THEN** 對外 rows、coverage start／end、rowCount 與 latest data date MUST 全部投影到目前 range
- **AND** retained rows 的 sources MUST 由實際顯示 row provenance 計算，不得改標成本次弱候選的 provider

#### Scenario: 持股副圖縱軸互動不得讓 series 消失
- **WHEN** 使用者在大戶、散戶或集保戶數副圖的縱軸拖曳、滾動或完成其他價格尺度手勢
- **THEN** pane MUST 保持主要持股 series 在 autoscale 可視範圍內，且不得只留下變化柱或空白 canvas
- **AND** 時間軸平移、縮放與跨 pane 同步 MUST 維持既有行為

#### Scenario: 同日期新價位恢復持股副圖尺度
- **WHEN** 商品收到新價位，但 candle 的起訖日期與上一筆相同
- **THEN** `chipPaneManager` MUST 仍通知既有持股 controller 恢復相關 price scale 的 autoscale
- **AND** MUST NOT 因此重建持股 series、重新抓取籌碼資料或改寫最後已驗證 payload

#### Scenario: 即時與延遲日 K 對齊相同台北交易日
- **WHEN** Yahoo 與 Shioaji 以不同 timestamp 表示同一個台北交易日，且 Shioaji 台北午夜在 UTC 屬於前一日
- **THEN** request range、cache identity 與 holder `timeMap` MUST 正規化為相同 `Asia/Taipei` 日期
- **AND** 新價位或來源切換 MUST NOT 因 UTC 日期偏移而讓 TDCC `dataDate` 失去 K 棒錨點
