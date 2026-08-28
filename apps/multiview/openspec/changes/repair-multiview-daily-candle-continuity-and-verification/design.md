## Context

MultiView 目前將 `provider + symbol + interval` 的 K 線保存於 D1，並以 requested rows、warmup、台股 buffer 與 `full_window_complete` 判斷是否需要 full fetch。台股 `1d` 在 rows 足夠後只抓 Yahoo 固定 `5d` tail，而既有 coverage callback 僅檢查最後一根是否到達最近已完成交易日；因此歷史中段即使缺少十個真實交易日，仍可回傳 `complete`。

本變更跨越 history acquisition、Yahoo／官方資料 adapter、D1 state、payload cache、API metadata、健康摘要與前端核對文案。設計必須維持 Workers／Sites 相容、D1 寫入限制、既有 single-flight 身分與無秘密資料原則，並避免把休市、上市前或停牌日誤補成假 K 棒。

## Goals / Non-Goals

**Goals:**

- 在 requested display window、indicator warmup 與必要 buffer 內，逐商品證明台股日 K 的交易日連續性。
- 將「根數足夠」與「交易日完整」拆成不同訊號，讓 full／tail 決策與 D1 狀態不再掩蓋內部缺口。
- 以 Yahoo 作歷史種子，並以 TWSE／TPEx 官方資料確認可疑交易日及修復真實缺漏。
- 修復後精準更新 D1 與 payload cache，API、健康摘要及 UI 公開可操作但不含秘密的診斷資訊。
- 明確區分收盤價核對與 OHLCV 核對，不讓「已核對」超出實際驗證範圍。

**Non-Goals:**

- 不為非台股、非 `1d` interval 建立新的交易日曆或永久歷史策略。
- 不以週一至週五、插值、前值延伸或零量 candle 補造官方未證明存在的交易日。
- 不在本變更中導入付費行情、production 交易、Shioaji production 或瀏覽器端官方 API token。
- 不把所有 Yahoo 歷史無條件改寫成官方歷史；官方資料優先用於連續性確認、缺口修復及已完成日 K 的核對。

## Decisions

### 1. 以「交易所開市日候選 + 商品官方紀錄」兩階段判定缺口

系統先以可快取的 TWSE／TPEx 官方交易日來源建立 exchange session set，再對 history 缺少的候選日期查詢該商品的官方日資料。官方同日存在合法 OHLCV 才是 `missing_traded_session`；官方明確無該商品資料則記為 `confirmed_no_trade`、`pre_listing` 或其他可證明的排除原因；官方無法取得時維持 `unknown`。

這比單純使用平日規則可靠，也比對每檔商品、每個月份無條件下載完整官方歷史節省請求。替代方案「只看相鄰日期差」會誤判連假與停牌；「只看其他商品共識日期」無法證明單一商品是否成交，因此不採用為最終判定。

### 2. 在決定 tail／full 前先做 request-scope continuity audit

history acquisition 先計算 `requiredFrom`、`requiredThrough` 與 expected completed session，再檢查該範圍的 continuity state 是否仍有效。只有 rows 足夠、continuity 為 `complete` 且 coverage 到達 expected session 時才能直接命中或只做一般 tail refresh。

若存在內部候選缺口，先依最早缺口與最新 expected session 計算動態抓取範圍；Yahoo 無法精準指定日期時使用足以覆蓋最早缺口的最小支援 range，必要時升級為既有 `full`。固定 `5d` 只保留給已證明連續且缺口不早於該範圍的正常尾端更新。

### 3. Yahoo 合併後仍缺的真實交易日以官方 row 定點修復

Yahoo refresh 完成後重新稽核。官方證明存在且 Yahoo 仍缺少的日期，使用官方 OHLCV 正規化為 candle 並 upsert，row 的 `source`／provenance 必須標示實際官方來源。官方失敗、格式不合法或只有不完整欄位時，不寫入假資料，保留既有 history 並回傳 `partial` 或 `unknown`。

替代方案「只要發現缺口就重抓兩年 Yahoo」無法處理相同上游仍缺資料或 rate limit；「全面以官方來源覆蓋兩年歷史」會顯著增加請求與 migration 成本，故本階段採混合策略。

### 4. Continuity state 不再使用不可逆的 full flag

`candle_history_state` 透過 migration 增加：

- `continuity_status`：`complete`、`partial`、`unknown`。
- `continuity_from`、`continuity_through`、`continuity_checked_at`。
- `missing_session_count`、有上限的 `missing_session_dates_json`。
- `excluded_session_dates_json` 與 `continuity_reason_code`。

`full_window_complete` 改為依目前已稽核範圍重算；requested range 擴大、expected session 前進、偵測到新缺口或官方結果過期時都可由 `1` 回到 `0`。不得再以 `MAX(previous, full fetch)` 永久保持完成。

缺漏日期 JSON 只保存有界診斷集合；完整逐日 rows 仍在 `candle_history`，避免 state 無限制膨脹。

### 5. History 修復與 payload cache 採同 key 精準失效

當 upsert 新增或更正任何 candle，系統立即以 `provider + symbol + interval` 失效 Worker memory payload 與對應 D1 candle cache，再由已合併 canonical history 產生本次 response。不同商品、interval 或 provider 的 cache 不受影響。

若 D1 cache 刪除失敗，本次仍使用修復後的記憶體 history 回應，並以安全 reason code 標示 write／invalidation failure；不得回退到已知有缺口的舊 payload。

### 6. 核對 metadata 明確宣告 scope

為保持 API 向後相容，`quote.verification.status` 保留既有值，新增 `scope` 與逐欄位結果：

- 只有同交易日 close 相符時：`status=verified`、`scope=close`，UI 顯示「收盤已核對」。
- 同交易日 O、H、L、C、V 全部依官方精度與單位正規化後相符時：`status=verified`、`scope=ohlcv`，UI 才顯示「OHLCV 已核對」。
- close 相符但其他欄位不符時，仍只宣告 `scope=close`，並在 `dataQuality` 公開安全的 mismatch 欄位名稱；不把完整官方原始 row 放入 response。
- 官方尚未發布、失敗或同日無可比資料時，沿用 pending／unverified 的保守語意。

### 7. 逐商品健康摘要採有界、可續跑稽核

健康與維護流程只針對目前啟用的使用者商品，以有限 concurrency、每輪上限及既有 single-flight／cache 執行。摘要至少列出 symbol、coverage end、continuity status、missing count、verified through 與 last checked；全域 schema／D1 health 不得替代逐商品結果。

一般 `/api/health` 不因背景稽核未完成而阻塞，但必須分開回報 `complete`、`partial`、`unknown` 與尚未稽核數量。正式驗收使用受控批次完成當次啟用清單的逐商品稽核。

## Risks / Trade-offs

- [官方端點 rate limit、格式或 runtime 可達性不穩] → 使用 per-exchange／per-date 或 per-month cache、single-flight、有限 concurrency、指數退避與安全 fallback；失敗維持 `unknown`，不假造完整。
- [舊 D1 state 被誤視為已完成] → migration 預設 continuity 為 `unknown`、`full_window_complete=0`，由後續 on-demand／批次稽核重新建立證據。
- [停牌或上市前日期被誤判為缺漏] → exchange session 只產生候選，必須再以商品官方紀錄或可證明 metadata 分類；無法證明時保持 `unknown`。
- [修復後舊 payload 仍被回傳] → 將 history upsert、state 更新、cache invalidation 與本次 payload 產生納入同一協調流程並增加回歸測試。
- [新增 metadata 讓 response 變大] → 缺漏與排除日期採有界陣列，詳細歷史只存 D1，既有 client 可忽略新增欄位。
- [逐商品背景稽核耗用 Free-tier 配額] → 預設 on-demand 修復；批次流程限制商品數、月份數與 concurrency，並在部署前用實際請求量驗證預算。

## Migration Plan

1. 新增 D1 migration 與向後相容 state reader；既有 rows 全數保留，新 continuity 欄位預設為 `unknown`。
2. 先部署只讀 continuity audit 與 metadata，驗證不會誤判休市、停牌及上市前日期。
3. 啟用動態 Yahoo refresh、官方定點修復與 cache 精準失效，並以大立光缺口 fixture 驗證。
4. 啟用 UI scope 文案及逐商品健康摘要，完成本機、Sites 保留站與 Cloudflare 正式站授權驗收後才視為完成。
5. 若需 rollback，程式回退時保留新增欄位與官方來源 rows；舊程式可忽略欄位並依原 `candle_history` 唯一鍵讀取，不執行破壞性資料降版。

## Open Questions

- TPEx 歷史日資料在 Sites／Cloudflare runtime 的穩定端點與 fallback 順序需在實作第一階段以 live evidence 確認；若只能使用既有 mirror，必須維持同日、商品代號、OHLCV 完整性與來源日期驗證。
- 批次稽核的每輪商品數、月份數與 concurrency 上限，應以 staging 實測 request budget 與 latency 決定；在取得證據前採保守預設，不影響 on-demand 單商品修復。
