## Why

現有收盤後選股已具備量增、大戶持股、分型與布林反轉條件，但尚無可重現的均線糾結／交叉與背離判定，使用者只能逐檔目視 K 線。這些策略的市場說法常帶有主觀空間，因此需要先固定公式、確認日線與成交量資料完整，再以全市場一致的 evidence 提供可稽核篩選。

## What Changes

- 在既有選股面板新增「均線糾結與交叉」條件，第一版固定使用 SMA5、SMA10、SMA20 作糾結帶，並以 SMA5／SMA20 判定黃金交叉或死亡交叉；糾結最大寬度與連續交易日數可設定。
- 提供「多頭準備突破」、「黃金交叉確認」、「空頭準備跌破」、「死亡交叉確認」及方向整合選項；所有「準備」狀態以均線距離收斂、收盤價位置及尚未完成交叉的明確公式判斷。
- 新增一般型背離條件，可選價量 OBV、RSI5、RSI10、KD-K(9,3,3)、MACD 線或 MACD 能量柱，並選擇多頭背離、空頭背離或任一方向；第一版使用已確認的左右各 2 根 pivot、相距 5–30 個交易日、最新 pivot 確認後 3 個交易日內及至少 1% 價格差。
- MACD 能量柱多頭背離只比較零軸下方低點，空頭背離只比較零軸上方高點，並支援是否要求兩波之間經過零軸的設定；第一版不包含 hidden divergence。
- 將官方全市場歷史底稿由 60 個交易日 OHLC 擴充為至少 130 個交易日 OHLCV，成交量統一保存為股，透過有界、可續跑、可稽核的背景流程完成既有日期與新增日期回補。
- 建立 v4 不可變選股快照與 criteria fingerprint：資料未齊、指標暖機不足或 pivot 尚未確認時回傳 `unknown`，不得以零值或較舊結果冒充不符合／符合；v4 尚未完整發布時保留既有 v3 條件可用。
- 結果卡與狀態區顯示實際均線值、糾結寬度、交叉日期，或兩個 pivot 的日期、價格、指標值與確認日期，並維持既有排序、分頁、加入「選股」清單及指定 K 線圖連動。
- 保持查詢路徑 DB-only、無 provider request、無 DDL、無寫入；不新增行情訂閱、交易／智慧下單寫入，也不變更既有分型與布林通道公式。

## Capabilities

### New Capabilities

無；本 change 擴充既有收盤後選股、技術型態與全市場歷史資料能力。

### Modified Capabilities

- `after-market-stock-screener-technical-patterns`: 新增均線糾結／交叉及一般型背離的精確公式、確認時點、三態結果與 evidence 契約。
- `after-market-stock-screener`: 新增條件控制、偏好保存、結果說明及與既有 AND／OR、清單與 K 線連動的整合行為。
- `taiwan-stock-screener-daily-ohlcv-history`: 將全市場官方日線視窗擴充為至少 130 個交易日 OHLCV，並建立成交量欄位驗證、回補、續跑與保留契約。
- `taiwan-stock-screener-data`: 新增 v4 快照發布 gate、criteria fingerprint、游標隔離與 v3 相容投影要求。

## Impact

- 主要影響 `scripts/stock-screener-ohlcv-bootstrap.mjs`、`scripts/stock-screener-update.mjs`、MultiView worker 的官方日資料 parser／repository／publisher／route，以及前端 stock screener domain、API、面板與測試。
- D1／本機 SQLite 需採 additive migration 補上歷史成交量與 v4 metadata；舊 OHLC receipt 不得直接視為 OHLCV 完整。
- 一次性回補量約為既有 60 日補成交量，加上新增約 70 日的 OHLCV；每一市場交易日請求涵蓋整個市場，流程需遵守官方來源冷卻、重試與完整性限制。
- 第一版以 130 個交易日提供充足指標暖機與穩定的背離搜尋視窗；不納入 SMA50／SMA200、盤中訊號、hidden divergence、回測績效承諾或自動下單。
- 不在本 change 內 commit、部署 Sites／Cloudflare 或啟停既有 simulation API、watchdog、5173、5174、盤後 pipeline 與行情連線；相關動作需另行執行與驗收。
