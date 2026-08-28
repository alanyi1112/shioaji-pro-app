## 1. 基準證據與官方來源契約

- [x] 1.1 建立 `3008.TW` fixture，重現總根數足夠且 2026-07-31 直接跳到 2026-08-17、缺少十個官方交易日的 D1 history／state。
- [x] 1.2 以 TWSE 官方 2026 年 8 月個股日資料固定十個缺漏日期及 OHLCV 期望值，測試資料不得包含秘密或依賴即時網路。
- [x] 1.3 實測並記錄 TWSE exchange-session 與個股歷史端點在本機、Sites／Cloudflare Workers 相容 runtime 的欄位、日期、成交量單位、錯誤及快取契約。
- [x] 1.4 實測並記錄 TPEx 歷史日資料端點與既有 mirror fallback 的同日、商品代號、OHLCV、發布時間及 runtime 可達性，選定保守 fallback 順序。
- [x] 1.5 以實測 latency／request 數訂定 on-demand 與批次稽核的商品數、月份數、concurrency、timeout 及 retry 上限。

## 2. D1 migration 與 continuity state

- [x] 2.1 新增 D1 migration，為 `candle_history_state` 加入 continuity status、checked range、checked time、missing count、缺漏／排除日期 JSON 與安全 reason code。
- [x] 2.2 讓既有 state migration 後預設 `continuity_status=unknown` 且不沿用未具證據的完成狀態，同時完整保留 `candle_history` rows。
- [x] 2.3 更新 state TypeScript type、reader 與 writer，驗證有界 JSON、合法狀態及 nullable 舊資料的向後相容解析。
- [x] 2.4 移除 `full_window_complete` 的不可逆 `MAX` 行為，讓範圍擴大、新交易日、新缺口或 evidence 過期時可重設為未完成。
- [x] 2.5 增加 migration／state 測試，涵蓋舊 schema 升級、unknown 預設、complete→incomplete 重算及異常 JSON 安全 fallback。

## 3. 台股交易日與缺口稽核核心

- [x] 3.1 建立 Workers 相容的 TWSE／TPEx exchange-session adapter，加入 per-exchange／per-range cache、single-flight、timeout 與安全錯誤碼。
- [x] 3.2 建立商品官方日資料 adapter，正規化 session date、OHLCV、價格精度、成交量單位、source 與 source updated time。
- [x] 3.3 實作 requested scope 計算，明確產出 `requiredFrom`、`requiredThrough`、indicator warmup、台股 raw buffer 與 expected completed session。
- [x] 3.4 實作兩階段 continuity audit：先找 exchange-session 候選缺口，再以商品官方 row 分類 `missing_traded_session`、合法無成交／停牌、上市前及 unknown。
- [x] 3.5 對缺漏／排除日期清單施加固定上限並保存總數，避免 D1 state 與 API response 無限制膨脹。
- [x] 3.6 增加休市、連假、天然災害休市、上市前、停牌、官方未發布與官方失敗測試，確認不產生假 candle 或錯誤 complete。

## 4. History acquisition、動態修復與 cache 一致性

- [x] 4.1 在 `acquireCandleHistory` 決定 hit／tail／full 前納入 requested-scope continuity evidence，禁止只以 rows、coverage end 或舊 full flag 判定完整。
- [x] 4.2 依最早 missing session 選擇 Yahoo 可支援的最小合理 range，只有已證明連續的正常尾端更新可使用固定 `5d` tail。
- [x] 4.3 Yahoo 合併後重新執行 continuity audit，並對仍缺少且官方證明有成交的日期，以官方 OHLCV row 定點 upsert 與保存 provenance。
- [x] 4.4 讓 Yahoo／官方失敗時保留既有 candles、indicators 與 history，回傳 stale／partial／unknown 及安全 reason code，不做未受控 retry 或 cleanup。
- [x] 4.5 history 新增或更正後，以 `provider + symbol + interval` 精準失效 Worker memory 與 D1 candle payload cache，並以修復後 canonical history 產生本次 response。
- [x] 4.6 增加 dynamic range、Yahoo full 補回、官方定點補回、single-flight、D1 write failure、cache invalidation failure 及不影響其他 key 的整合測試。

## 5. API metadata、官方核對範圍與前端呈現

- [x] 5.1 擴充 `/api/candles` 的 `dataQuality`／`dataWindow.cache`，回傳 continuity status、checked range、verified through、missing count 及有界 missing／excluded dates。
- [x] 5.2 擴充 `quote.verification` 的向後相容 `scope` 與逐欄位結果，正規化 TWSE／TPEx OHLCV 精度及成交量單位。
- [x] 5.3 只有 close 同日相符時回傳 `scope=close`；只有 OHLCV 全部相符時回傳 `scope=ohlcv`，其餘維持 pending／unverified 或只公開安全 mismatch 欄位名稱。
- [x] 5.4 更新 `/api/stream` 共用相同 market phase、session date、verification status／scope 與來源，避免 candles 與 stream 漂移。
- [x] 5.5 更新 MultiView 核對文案為「收盤已核對」／「OHLCV 已核對」，移除未限定範圍的「已核對」。
- [x] 5.6 在可視範圍存在已確認缺口時顯示中性「日 K 資料不完整」提示；partial／unknown 不得呈現為 complete，舊前端忽略 metadata 時維持基本 API 相容。
- [x] 5.7 增加 close-only、完整 OHLCV、volume mismatch、官方未發布、fallback scope 與 UI 文案測試。

## 6. 逐商品健康摘要與有界維護流程

- [x] 6.1 擴充健康／診斷輸出，逐商品列出 symbol、coverage end、continuity status、missing count、verified through 與 last checked。
- [x] 6.2 將全域 schema／D1 health 與逐商品 continuity 分開統計 complete、partial、unknown、尚未稽核及 latest-session coverage。
- [x] 6.3 建立只針對目前啟用 `.TW`／`.TWO` 商品的有界、可續跑稽核流程，沿用 cache、single-flight、concurrency 與每輪 request budget。
- [x] 6.4 增加多商品部分成功、官方 rate limit、重複 symbol、舊 coverage、批次中斷及續跑測試，確認不以全域成功掩蓋單一商品缺口。

## 7. 自動化與本機實際驗收

- [x] 7.1 讓大立光 fixture 先證明十個缺口可被偵測，再證明 repair 後 2026-07-31 至 2026-08-17 的官方交易日完整且 OHLC 合法。
- [x] 7.2 執行 migration 測試、candle-history focused tests、Worker integration、cache／concurrency tests、`npm run lint` 與完整 `npm test`，修正所有本變更回歸。
- [x] 7.3 以本機唯讀 SQL 稽核目前啟用的 51 個台股商品，逐檔保存 coverage end、內部缺口、continuity status 與最後核對時間證據。
- [x] 7.4 在實際 MultiView 切到包含 `3008.TW` 的頁面，驗證十根日期、panel loaded state、主副圖對齊、所有 canvas 尺寸、核對文案與 console。
- [x] 7.5 驗證一圖歷史縮放／較大 display window、D1 重用、修復後 payload cache 失效及 visible logical range 保持。
- [x] 7.6 執行 `git diff --check` 與 `openspec validate --all --strict`，確認 tasks、實作、正式 spec delta 及驗證證據一致。

## 8. 發布邊界與正式環境驗收

- [x] 8.1 在未部署前整理精準變更 scope、migration 順序、request budget、rollback 與尚未授權的正式環境操作，不主動 commit、push 或部署。
- [x] 8.2 取得使用者另行明確授權後，才依序執行 commit／push、Sites 保留站與 Cloudflare 正式站部署，不將各階段視為同一份授權。
- [x] 8.3 以既有已授權 session 在 Sites 保留站與 Cloudflare 正式站逐項驗證 `3008.TW` 連續性、逐商品健康摘要、cache lifecycle、核對 scope、canvas 與 console；匿名存取邊界不得冒充 application health。
- [ ] 8.4 正式驗收完成後更新對應正式 spec、OpenSpec tasks 與證據，再另行進入 archive／收工流程；未取得授權或未完成證據時保持 change active。
