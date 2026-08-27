## ADDED Requirements

### Requirement: 多圖籌碼更新必須採非退化原子提交

系統 MUST 在 1／2／3／4 圖的多層副圖與相鄰頁預載中，讓不同完成順序的 foreground、background、cache hit 與 in-flight join 結果都先通過 generation／identity 檢查及逐 dataset reconcile，再原子提交完成 cache 與可見 UI。任一 panel 或 dataset 的弱回應不得清除其他 panel 或相同 panel 已驗證的籌碼資料，aggregate metrics 不得包含完整 payload、商品清單或秘密值。

#### Scenario: 四個 panel 依不同順序完成弱回應
- **WHEN** 四圖多層副圖先各自顯示最後有效大戶／散戶資料，之後四個背景 request 以不同順序回傳空或較舊 TDCC slice
- **THEN** 四個 panel MUST 全部保留各自最後有效持股 series 與實際資料日期
- **AND** 不得出現線圖依 request 完成順序逐欄消失的狀況

#### Scenario: 預載與前景共用候選結果
- **WHEN** 相鄰頁背景預載與目前頁前景 request 共用相同完成 response 或 in-flight request
- **THEN** 候選 response MUST 只 reconcile 一次並以相同非退化結果供兩者使用
- **AND** 未通過 reconcile 的原始候選 payload MUST NOT 寫入完成 cache

#### Scenario: 開盤期間四圖長時間驗收
- **WHEN** 驗收在台股開盤更新或等價 deterministic fixture 中，以四圖、多層副圖、至少一檔普通股與一檔 ETF 等待超過背景 revalidate 完成時間
- **THEN** 每個 panel 已選法人、融資券、大戶與散戶 pane 的 DOM、canvas、可繪製點及最後有效日期 MUST 維持一致且不退化
- **AND** console MUST 無未處理錯誤，network evidence MUST 能區分原始候選與 retained／accepted dataset 結果

#### Scenario: 技術副圖同場景隔離驗證
- **WHEN** 相同 panel 在開盤 K 棒更新期間同時顯示技術副圖與籌碼副圖
- **THEN** KD、RSI、MACD、ATR 等已選技術 series MUST 由合法 candles／indicator payload 持續更新，不得因籌碼 reconcile 被清除或重建
- **AND** 若技術副圖另有空資料退化，MUST 以其獨立 identity 與 root cause 修正，不得讀取籌碼 verified-slice store

#### Scenario: 發布資產與 rollback 驗證
- **WHEN** 本變更進入可部署版本
- **THEN** build、完整測試、migration 檢查、OpenSpec strict validation 與實際瀏覽器驗收 MUST 通過，HTML MUST 引用本次 `app.js` 與 `chip-panes.js` cache-buster
- **AND** rollback MUST 不需刪除或轉換既有 D1 籌碼 rows
