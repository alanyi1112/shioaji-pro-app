## ADDED Requirements

### Requirement: 日 K 年線暖機必須採展示專用本機日線
系統 MUST 在合法台灣上市／上櫃股票主圖進入 1D 時，透過固定本機日線入口嘗試取得最多 500 筆 1d 歷史。新增暖機路徑 MUST NOT 以券商歷史分鐘 K 作為備援，且 MUST NOT 改寫盤中監控、盤後採集之額度、政策或排程；原圖近期資料仍沿既有行情載入路徑。

#### Scenario: 足夠日線形成年線
- **WHEN** 同商品本機日線及近期資料通過互證，合併後至少有 240 根合法日棒
- **THEN** 參考均線組 MUST 能顯示 SMA240，原始分鐘陣列及原有即時尾端 MUST 保持原權威

#### Scenario: 日線不足或來源失敗
- **WHEN** 商品歷史不足 240 根，或來源不可用、格式不符
- **THEN** 系統 MUST 保留實際日線長度及近期資料，缺少的年線值維持 whitespace，不補造資料或改抓券商分鐘 K

### Requirement: 日線合併必須核對商品、時間及價格基準
系統 MUST 核對商品、1d interval、brokerRequests=0 與 common_lot 單位，僅接受台北 09:00 標準日棒，轉成主圖日 bucket 並驗證嚴格遞增的合法 OHLCV。合併 MUST 至少取得三個已結束重疊日，且全部重疊 close 通過價格基準容差；最後一根與近期資料 MUST 優先採原主圖資料。

#### Scenario: 盤中快照與標準日棒同日
- **WHEN** 本機日線回應含同日盤中快照
- **THEN** 快照 MUST NOT 被當成另一個交易日或納入年線期數

#### Scenario: 價格基準不符
- **WHEN** 重疊已結束日少於三個，或任一重疊 close 超過實作的價格容差
- **THEN** 系統 MUST 拒絕前綴合併，不污染原始分鐘、分鐘快取或 daily indicator authority

### Requirement: 被動暖機必須有界且保持圖表視窗
本機暖機 gateway MUST 固定上游來源及參數，驗證 loopback／同來源、合併同商品請求並單序執行，維持最多八項等待、24 項快取、成功 30 分鐘與失敗 1 分鐘冷卻，以及 20 秒上游期限和 2 MiB 回應上限。暖機補入 MUST 保留原平移、縮放及價格軸設定，不代替整個供應商歷史完整性的證明。

#### Scenario: 併發請求同商品
- **WHEN** 兩份主圖同時要求同商品日線，或成功快取尚有效
- **THEN** gateway MUST 合併或重用結果，不轉送使用者 credentials 或額外產生券商暖機請求

#### Scenario: 使用者已平移或縮放
- **WHEN** 日線前綴在原主圖已顯示後被動補入
- **THEN** 原 K 棒螢幕位置及價格軸 MUST 保持，分鐘資料與量比／盤後權威 MUST NOT 被更動
