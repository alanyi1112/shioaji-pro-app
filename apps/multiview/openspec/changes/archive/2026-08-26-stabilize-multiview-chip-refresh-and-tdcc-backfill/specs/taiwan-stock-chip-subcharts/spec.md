## ADDED Requirements

### Requirement: 同資料來源的暫時空狀態不得清除最後成功副圖

當 canonical symbol 與 interval 均未改變時，tab identity 變化、主圖重建期間的 `candles=[]` 或 transient fetch error MUST 保留最後一次成功 chip payload、實際 source date 與已建立 series，直到新資料成功取代或使用者切換資料來源。系統 MUST NOT 將暫時空 context 當成正式空資料集。

#### Scenario: 同商品切換分頁時主圖尚未載入
- **WHEN** 使用者切到另一個 tab，但 canonical symbol 與 interval 相同且新 context 暫時只有空 candles
- **THEN** 大戶、散戶與其他已成功副圖 MUST 維持最後成功資料與實際日期
- **AND** 主圖 candles 到達後 MUST 以新 context reconcile，不得出現先顯示後消失

#### Scenario: 同來源 refresh 暫時失敗
- **WHEN** 同 symbol／interval 的 chip fetch 發生 timeout 或 transient response error，且已有成功 payload
- **THEN** 系統 MUST 保留既有 series 並顯示可辨識的暫時狀態
- **AND** MUST NOT 清除 payload、建立零值或改寫 source date

#### Scenario: 使用者切換商品或週期
- **WHEN** canonical symbol 或 interval 真正改變
- **THEN** 系統 MUST 清除前一資料來源的 payload 與 series，並載入新來源
- **AND** 新商品載入期間 MUST NOT 顯示前一商品的大戶或散戶資料
