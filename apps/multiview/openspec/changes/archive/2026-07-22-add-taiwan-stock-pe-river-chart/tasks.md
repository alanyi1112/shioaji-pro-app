## 1. 官方來源與契約確認

- [x] 1.1 實測 TWSE 與 TPEx 上市／上櫃普通股的歷史個股本益比、官方收盤價、財報年／季、日期格式、最早可查範圍與 schema，保存不含秘密的 response fixtures 與欄位對照。
- [x] 1.2 以官方文件或可驗證回覆確認歷史端點的自動化、呼叫頻率、再利用、attribution 與衍生圖表揭示規範；未確認前將 production backfill 設為 fail-closed。
- [x] 1.3 定義 `.TW`／`.TWO` canonical symbol、ordinary-stock eligibility、ETF／ETN／TDR／指數／特別股排除規則與 allowlist reason code，並以商品目錄及官方 fixture 建立測試案例。

## 2. D1 資料模型與 migration

- [x] 2.1 在 `db/schema.ts` 新增逐日估值 row、fetch state、durable job 與月份 checkpoint schema，包含 exchange、canonical symbol、實際 coverage、source date、fiscal year／quarter、attempt、lease、retry 與安全 reason code。
- [x] 2.2 產生 additive Drizzle migration、更新測試用 SQLite D1 helper，驗證唯一鍵、index、冪等 upsert 與 migration 不刪改既有 K 線／籌碼資料。
- [x] 2.3 實作 D1 repository：依 symbol／日期範圍讀寫逐日 row、計算 actual coverage／missing months、保存 job checkpoint，且 requested end 不得偽造成 source coverage。

## 3. 官方解析與河流計算核心

- [x] 3.1 實作 TWSE 歷史本益比與官方收盤資料 parser，依欄位名稱、安全日期及 canonical code 配對，不依賴固定 table index／欄位順序。
- [x] 3.2 實作 TPEx 歷史本益比與官方收盤資料 parser，以及 Sites 無法直接存取時可供私有 mirror ingest 使用的正規化 contract。
- [x] 3.3 實作同市場、同 symbol、同 `sessionDate` 配對及 `referenceEps = officialClose / officialPeRatio` 純函式；空白、零、負數、非有限值與日期不一致保留 gap。
- [x] 3.4 實作五年 sample window、至少 252 筆門檻、`rank = (n - 1) × p` 線性插值的 `P10／P30／P50／P70／P90`，以及每日五條 river price 計算與 gap 分段。
- [x] 3.5 為 parser、point-in-time 配對、百分位插值、上市未滿五年、負 EPS、schema drift、禁止同業／forward P/E 欄位建立單元測試。

## 4. Coverage、回補與安全攝取

- [x] 4.1 實作 D1-first valuation service：完整 coverage 只讀 cache、partial coverage 只排 missing months、同 symbol job dedupe／single-flight，並回傳 eligibility、coverage、sources、warnings 與 backfill 狀態。
- [x] 4.2 實作限速且可續跑的月份 runner，支援 lease、checkpoint、bounded retry／retry-after、429／5xx 隔離、non-retryable blocked 與安全錯誤正規化。
- [x] 4.3 若完整五年工作超出 `context.waitUntil` 邊界，新增或沿用私有 GitHub Actions workflow dispatch／ingest；驗證 Sites 身分／bypass 與估值 ingest 授權，且不得把秘密寫入 repo、response 或 log。
- [x] 4.4 為 cache hit、missing-month retry、重複 panel request、來源阻擋、未授權 ingest、payload schema／日期／筆數驗證與保留既有 coverage 建立整合測試。

## 5. 河流圖 API

- [x] 5.1 新增 `GET /api/taiwan-stock-pe-river?symbol=<symbol>` route，回傳 eligibility、actual coverage、有效樣本數、multipliers、逐日 points、sources、warnings 與 backfill，且不修改 `/api/candles` payload。
- [x] 5.2 定義普通股日 K、unsupported symbol／interval、insufficient history、partial／running／blocked／retry waiting／available 的穩定 response contract 與安全顯示文案。
- [x] 5.3 將估值 coverage／job 摘要加入適當 health 診斷，只揭示 target／ready／pending／blocked／retry waiting、實際日期及安全 reason code。

## 6. 主圖 UI 與互動生命週期

- [x] 6.1 在主圖選單加入預設未勾選的「本益比河流圖」checkbox，依 canonical eligibility 與 `1d` 顯示支援／不適用狀態，未勾選時不得發出估值 request。
- [x] 6.2 實作每 panel 按需 fetch、bounded polling、symbol／interval／load-token latest-wins、AbortController 與取消勾選／切換／銷毀時完整 cleanup。
- [x] 6.3 新增 `pointer-events: none` 的主圖 SVG layer，以 `timeToCoordinate`／`priceToCoordinate` 繪製五條界線、四個 `P10–P90` 半透明 band、visible-range clipping 與 gap 分段。
- [x] 6.4 將 SVG 重繪接入既有 rAF overlay scheduler、縮放／平移／resize、1／2／3／4／6／8 圖、單圖新分頁與 panel layout，保持線與 K 線 X 座標差小於或等於 1 CSS px。
- [x] 6.5 新增 pointed-date readout：官方／盤中估算 P/E、交易所參考 EPS、財報年／季、五個 multiplier、所在區帶、來源與 coverage；不得顯示同業、產業、目標價或投資建議語意。
- [x] 6.6 讓完整 panel PNG 匯出包含目前可見 SVG 河流帶與 readout，並驗證未啟用、不適用、資料不足或取消後沒有殘留圖層。

## 7. 驗證與交付

- [x] 7.1 新增 frontend contract 測試，涵蓋 checkbox 預設、按需 request、不適用商品、late response 丟棄、SVG cleanup、readout 禁止欄位與 PNG clone contract。
- [x] 7.2 使用本機 Worker／Sites preview 對至少 `2330.TW`、一檔 `.TWO` 普通股、`0050.TW`、負 EPS／官方 P/E 空白 fixture 與少於 252 筆 fixture 執行 API smoke。
- [x] 7.3 以 browser 實際驗證 1／4／8 圖的勾選、首次回補狀態、完整河流、crosshair、縮放平移、快速換商品、非日 K、不適用提示與完整 panel PNG。
- [x] 7.4 執行 `npm run lint`、完整 `npm test`、`openspec validate --all --strict` 與 `git diff --check`，修正所有問題並記錄可重現的驗證結果。
- [x] 7.5 發布後以正式 Sites HTML／JS／API／已登入 browser 驗證實際可見河流圖與來源狀態；確認未勾選時無估值 request，且 private／custom access 的匿名 `401` 不誤判為部署失敗。
