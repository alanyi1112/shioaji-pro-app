## ADDED Requirements

### Requirement: 多層副圖必須預載下一頁已選取籌碼資料

當 effective presentation mode 為多層副圖時，系統 MUST 在下一頁 K 線預載取得合法日 K candles 後，讀取每個目標 tab／symbol 保存的 mode B pane 選項，將其所需 TDCC／日籌碼 datasets 去重並合併為每檔商品一個 chip prefetch request。系統 MUST NOT 無條件抓取未選取 datasets。

#### Scenario: 下一頁商品具有多個已選 pane
- **WHEN** 下一頁某商品已選外資買賣超＋持股、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 依該商品保存選項產生去重後的 `institutional-flow`、`foreign-holding`、`margin-short` 與 `shareholder-distribution` dataset 集合
- **AND** 相同 dataset 被多個 pane 使用時 MUST 只在該商品的合併 request 出現一次

#### Scenario: 新商品沒有既有 selection
- **WHEN** 下一頁商品尚未保存 mode B selection
- **THEN** 系統 MUST 套用與可見 panel 相同的 migration 及 mode B defaults 計算 datasets
- **AND** 預載 MUST NOT 為該商品寫入或變更使用者 selection

#### Scenario: K 線預載尚未提供有效日期範圍
- **WHEN** 下一頁 K 線 request 失敗、candles 為空或不含可驗證起訖日期
- **THEN** 系統 MUST 略過該商品的 chip prefetch
- **AND** MUST NOT 使用猜測日期、requested end date、零值 candles 或目前頁面日期範圍建立 cache identity

#### Scenario: 非多層副圖 context
- **WHEN** effective mode 為主圖或單一副圖、圖數為 6／8、週期不是日 K，或商品不是合格 `.TW`／`.TWO`
- **THEN** 系統 MUST NOT 建立下一頁 chip prefetch job
- **AND** 既有 K 線預載及目前可見 panel 行為 MUST 維持不變

### Requirement: 籌碼預載快取必須安全重用最後 verified payload

籌碼預載 MUST 沿用 foreground chip request 的 canonical identity、完成 response cache 與 in-flight single-flight，並採 dataset-aware stale-while-revalidate。切頁時系統 MUST 可先使用最後 verified payload；只有同 identity 的新 payload 完整驗證成功後才可取代，暫時錯誤、partial、空資料或失效 generation MUST NOT 清除既有副圖。

#### Scenario: 前景 panel 加入進行中的預載 request
- **WHEN** 使用者切到下一頁時相同 symbol、interval、日期範圍與 dataset 集合的預載仍在進行
- **THEN** foreground panel MUST join 同一 in-flight request
- **AND** MUST NOT 建立第二個 `/api/taiwan-stock-chip` request

#### Scenario: 使用已完成但需要更新的 cache
- **WHEN** 下一頁已有最後 verified chip payload，但其 dataset freshness 需要 revalidate
- **THEN** panel MUST 先以 cache 顯示實際 source date、coverage 與已選副圖
- **AND** 背景更新成功並通過 material 驗證後才可原子取代 payload

#### Scenario: 背景更新暫時失敗
- **WHEN** chip prefetch 或 revalidate 遇到 timeout、HTTP error、rate limit、partial 或合法暫時空資料
- **THEN** 系統 MUST 保留最後 verified payload 與 series
- **AND** MUST 顯示可辨識的 stale／partial 狀態，不得補零、改寫 source date 或讓副圖消失

#### Scenario: Offscreen 預載不建立副作用
- **WHEN** 系統為下一頁執行 chip prefetch
- **THEN** MUST NOT 建立 offscreen chart、canvas、observer、crosshair、SSE、Shioaji demand、backfill polling 或 `/api/taiwan-stock-chip/backfill` request
- **AND** 預載失敗 MUST NOT顯示目前頁面的 notice 或改變目前 panel lifecycle
