## Context

目前收盤後選股的 v3 路徑以官方 TWSE／TPEx 全市場資料建立 60 個交易日的 canonical OHLC，publisher 預先產生分型與 BOLL evidence，再由本機唯讀 API 依條件查詢。現有 `screener_daily_ohlcv` 尚未保存歷史成交量；另外，近期兩日成交量表只為量增條件保留少數錨點，不能直接支援 OBV。均線糾結門檻可調，而背離又涉及 pivot 確認、指標暖機與零軸限制，若只在 UI 或單一商品圖表臨時計算，會破壞全市場一致性、快照可重現性與 DB-only 查詢邊界。

本 change 牽涉官方來源 adapter、本機 D1 schema、歷史 bootstrap、publisher、API domain、criteria fingerprint、前端偏好與 evidence 顯示。正式資料只允許已核對的官方全市場日報；Shioaji Snapshot 僅維持既有 chart-local 報價用途，不作選股歷史來源。

## Goals / Non-Goals

**Goals:**

- 把「均線糾結準備突破／跌破、黃金／死亡交叉」轉成固定且可測試的 SMA 公式。
- 以同一套已確認 price pivot 實作 OBV、RSI、KD、MACD 線與 MACD 能量柱的一般型多／空背離。
- 將本機官方歷史資料升級為至少 130 個交易日 OHLCV，並以有界、可續跑流程補齊全市場。
- 建立 immutable v4 technical evidence；查詢與 UI 只讀 snapshot，不觸發 provider、DDL 或背景工作。
- 在 v4 暖機期間維持既有 v3 條件可用，並清楚區分 pending、unknown 與 fail。
- 以全市場重算、API 全分頁與實際 UI／K 線連動證明結果正確且沒有交易副作用。

**Non-Goals:**

- 不做 hidden divergence、主觀趨勢線、AI 圖形辨識、盤中即時訊號、歷史回測或獲利承諾。
- 第一版不開放任意均線週期；糾結固定 SMA5／10／20，交叉固定 SMA5／20，也不做 SMA50／200。
- 不改動既有原始三 K、纏論分型、BOLL(20,2)、量增與 TDCC 大戶條件公式。
- 不以 Yahoo、Shioaji Kbars、自選清單或排行榜補全全市場底稿，不新增全市場 broker 訂閱。
- 不在本 change 自動啟停 simulation API、watchdog、5173、5174、盤後 pipeline 或行情連線，也不啟用 production／真實下單。

## Decisions

### 1. 均線糾結使用固定均線組合、可調糾結寬度與連續日數

對每個完整交易日 `t` 計算 `SMA5(t)`、`SMA10(t)`、`SMA20(t)`，並定義：

`spreadPct(t) = (max(SMA5,SMA10,SMA20) - min(SMA5,SMA10,SMA20)) / SMA20 * 100`

使用者可設定 `maxSpreadPct` 為 0.1–5.0 百分比、`compressionDays` 為 2–10 個交易日；只有截至指定終點的每一天皆有三條有效均線且 `spreadPct <= maxSpreadPct` 才算糾結。採固定均線可讓 publisher 保存最近 10 日的參數無關特徵，route 再套用門檻，不需要為任意週期組合保存大量快照。

替代方案是開放任意 SMA／EMA 週期；這會放大暖機需求、驗證矩陣與 cursor fingerprint，第一版不採用。

### 2. 「準備」與「交叉確認」使用不同終點

- 多頭準備突破：糾結窗結束於 D；`SMA5(D) <= SMA20(D)`、`gap(D) > gap(P)`，且 `close(D) > max(SMA5,SMA10,SMA20)`。
- 空頭準備跌破：糾結窗結束於 D；`SMA5(D) >= SMA20(D)`、`gap(D) < gap(P)`，且 `close(D) < min(SMA5,SMA10,SMA20)`。
- 黃金交叉確認：糾結窗結束於 P，且 `SMA5(P) <= SMA20(P)`、`SMA5(D) > SMA20(D)`。
- 死亡交叉確認：糾結窗結束於 P，且 `SMA5(P) >= SMA20(P)`、`SMA5(D) < SMA20(D)`。

其中 P、D 必須是相鄰官方完整交易日，D 等於 snapshot `effectiveSessionDate`；等於只屬交叉前一側，不可同時判定兩種交叉。UI 另提供「任一多頭」與「任一空頭」，各自在分支內使用三態 OR。

替代方案是以肉眼斜率或「即將交叉」距離推測準備狀態；因不可重現而不採用。

### 3. 背離以 price pivot 為共同時間錨點

先在官方未調整日 K 上建立嚴格 price pivot：pivot low 的中心 low 必須嚴格低於左右各 2 根 low；pivot high 反向處理，相等即不成立。第二個 pivot 必須已由右側 2 根完整 K 棒確認、中心距 D 不超過 3 個交易日，兩個中心相距 5–30 個交易日，且價格差至少 1%。候選衝突時依「第二 pivot 日期最新、第一 pivot 日期最新」決定唯一 pair。

各指標在相同 price-pivot 日期取值：

- 多頭一般背離：第二個 price low 低於第一個，第二個指標值高於第一個。
- 空頭一般背離：第二個 price high 高於第一個，第二個指標值低於第一個。

來源固定為 OBV、RSI5、RSI10、KD-K(9,3,3)、MACD line(12,26,9) 與 MACD histogram(12,26,9)。OBV 使用官方 `volume_shares` 精確整數；MACD histogram 多頭兩點須皆小於零，空頭兩點皆大於零。`requireZeroReset` 開啟時，兩個 pivot 中間還必須至少一次到達或穿越零軸；publisher 同時保存開／關兩種判定，route 不臨時計算 provider 資料。

替代方案是分別找價格與指標 pivot 再作日期容差配對；其配對自由度較高且容易產生多解，第一版不採用。

### 4. 歷史底稿採 additive OHLCV v4 與 130-session plan

以 additive migration 為 `screener_daily_ohlcv` 增加 nullable `volume_shares` 及來源／mapping metadata；使用十進位字串保存整數股數，避免 JavaScript 浮點精度污染。adapter 必須逐市場核對實際成交量欄名、單位、requested date、價格基礎與市場覆蓋；volume 為非負安全整數，OHLC 仍沿用既有嚴格邊界。來源不相容或某列缺 volume 時標為明確 unknown，不以成交值、張數顯示值或 Snapshot 推算。

v4 planner 建立 130 個官方 session 的 `market + session + sourceMappingVersion + dataCapability=ohlcv-v4` targets。舊 OHLC receipt 可重用其 OHLC rows，但不得直接滿足 OHLCV target；首次升級最多需為既有 60 日補 volume，再增加約 70 日 OHLCV。每個正式市場日報仍一次服務整個市場，沿用 single-flight、budget、timeout、Retry-After、冷卻與 checkpoint，不做逐商品抓取。

替代方案是擴張只保留兩日的成交量表；該表的 retention 與用途不同，會混淆量增錨點及技術歷史，因此不採用。

### 5. v4 snapshot 保存參數無關特徵與固定背離矩陣

publisher 以同一份 130-session canonical OHLCV 產生：

- 最近 11 日的 SMA5／10／20、spreadPct、SMA5−SMA20 gap 與 P／D cross facts；11 日可容納最多 10 日且結束於 P 的糾結窗，再附最新 D。
- 六種指標的有效起點與數值；依固定 pivot 規則產生多頭／空頭 evidence，MACD histogram 額外保存 zero-reset 開／關兩版。
- 每一分支的 `pass|fail|unknown`、reason、formulaVersion、sourceMappingVersion、日期與 evidence hash。

route 只依 immutable 特徵套用 `compressionDays`、`maxSpreadPct`、mode、divergence source／direction／zero-reset，並把正規化後條件、v4 formula version、snapshot、排序納入 fingerprint。這比在 GET 查 1974 檔 × 130 日原始列更有界，也避免為連續門檻組合預先展開巨大矩陣。

### 6. v4 原子發布且與 v3 fail closed 相容

v4 staging 必須涵蓋相同 universe 的完整 rows，所有必要 TWSE／TPEx session targets 已為正式終態，`effectiveSessionDate` 與 daily／technical anchors 一致，才能原子切換。新均線或背離條件啟用而 v4 未 ready 時，API 回 preparation pending／unknown，不得把舊 v3 重解釋；新條件全部停用時可繼續提供最新合法 v3 projection。v3 與 v4 snapshot、cursor、cache、偏好 key 明確隔離。

### 7. 前端只呈現已提交條件與可稽核 evidence

兩個新條件預設關閉。均線卡提供 mode、糾結日數與最大寬度；背離卡提供 source、direction 與只在 MACD histogram 顯示的 zero-reset。輸入非法、無任何條件或 v4 尚未 ready 時阻止／降級的規則沿用既有三態與 stale 防護。結果卡顯示實際 P／D 或 pivot A／B／confirm 日期、價位、指標值、均線與寬度，不只顯示策略名稱。偏好由 v3 單向遷移至 v4，未知版本 fail closed。

## Risks / Trade-offs

- [官方歷史端點部分日期沒有可核對成交量欄位] → 實作先保存分市場 source review；不相容日期維持 unknown，不能用替代值冒充。
- [首次 130 日全市場回補時間長或遇到 rate limit] → market-date 批次、可續跑 checkpoint、有界 budget／冷卻；UI 不派送回補且 v3 繼續可用。
- [pivot 確認造成訊號延遲] → UI 明示中心日與確認日；延遲是避免未來函數與訊號重繪的必要代價。
- [門檻可調造成快照資料量增加] → 只保存最近 10 日固定均線特徵與固定背離矩陣，不保存所有參數組合或整段原始 OHLCV。
- [130 日不足以支援長週期均線] → 第一版限制 SMA5／10／20 與 SMA5／20 交叉；SMA50／200 另案擴充到更長視窗。
- [舊 v3 與新 v4 混用] → 版本化 schema、receipt、snapshot、cursor、cache、preference 與 API validation，任何 mixed-session／mixed-version 都拒絕發布。

## Migration Plan

1. 新增 additive D1 migration 與向後相容 repository；舊 v3 讀寫維持可用。
2. 完成 TWSE／TPEx 歷史成交量欄位、單位、日期與市場覆蓋 source review，建立正常／缺欄／日期錯置 fixtures。
3. 部署 130-session v4 planner，先補既有 60 日 volume，再補新增 session；過程保存 checkpoint 與 receipts，不刪除 v3 資料。
4. 實作純函式均線與背離 engine、v4 publisher／repository／route；在 v4 gate 全部通過前不提供可操作的新條件結果。
5. 加入前端 v4 偏好與控制，完成 fixture、全市場、API、browser、實際 K 線點選及無副作用驗收後才宣告完成。
6. 若需 rollback，停用新條件入口並回到 v3 projection；保留 additive 欄位與已驗證 OHLCV，不做破壞性降版或刪除。

## Open Questions

無。第一版均線週期、pivot、價差、距離、確認新鮮度與 hidden divergence 邊界已在本 design 固定；未來若要開放任意參數或 SMA50／200，另建 change 並重新評估資料視窗與快照大小。
