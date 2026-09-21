## Context

本機選股更新器目前在 `scripts/stock-screener-update.mjs` 先以台北時間 18:00 作為固定門檻，daily collector 又在 `stock-screener-collector.ts` 重複同一門檻。這不是官方交易日曆或 D／P 選擇器本身的錯誤：publisher 已要求 TWSE、TPEx 具有相同且完整的兩期 receipt，才會選出最新共同 D 與其相鄰 P。問題是當日 receipt 在 18:00 前根本不會建立。

2026-09-03 14:32（Asia/Taipei）的唯讀核對顯示，TWSE `MI_INDEX` 與 TPEx `dailyQuotes` 已同時回傳 `20260903` 完整日期報表，但本機最新快照仍為 D=2026-09-02、P=2026-09-01，且資料庫沒有 2026-09-03 的雙市場 receipt。既有 runtime 每 5 分鐘喚醒 TDCC watcher；queue 無工作時會呼叫選股 pipeline，因此不需要新增常駐服務，但必須在選股 operator 內建立獨立、有界的盤後 publication cooldown，避免每次喚醒都請求官方來源。

現有 immutable snapshot 要求其 `anchors.daily.current`、snapshot metadata 的 `expectedSessionDate`／`effectiveSessionDate` 與技術資料日期一致。這項發布一致性應保留；「目前理應完成的日期」則由 maintenance readiness 狀態提供給 route，不能用瀏覽器時鐘覆寫 snapshot evidence。

## Goals / Non-Goals

**Goals:**

- 台灣交易日收盤後，以官方日曆及兩市場正式日報的實際發布證據及時將 D／P 推進至今日／前一交易日。
- 保留雙市場同錨點、完整 schema、全市場覆蓋、immutable snapshot 與 v2／v3／v4 日期一致性防線。
- 在尚未齊備時區分 expected session 與 effective session，讓 API／UI 顯示真實等待狀態並停止舊結果的當期操作。
- 透過 single-flight、每候選日 checkpoint、20 分鐘 publication cooldown、有界探測次數及既有錯誤 backoff 防止 busy-loop。
- 不停止或重啟既有 simulation API、watchdog、5173、5174、TDCC pipeline 或行情連線。

**Non-Goals:**

- 不變更成交量倍數、成交值、TDCC、分型、布林、均線或背離公式。
- 不使用盤中累計量、Shioaji Snapshot、K 線最後一棒或非官方來源替代正式日報。
- 不擴充 Cloudflare／Sites hosted 選股路由；本 change 僅處理本機選股底稿與 UI。
- 不把「14:00 已可開始探測」等同「官方報表必然已發布」，也不以空白、舊日期或半份市場資料冒充今日完整資料。

## Decisions

### 1. 將固定 18:00 改為交易日與 publication evidence 驅動的狀態機

operator MUST 使用 `Asia/Taipei` 與官方 TWSE／TPEx 共同交易日曆決定候選日：

```text
非交易日／交易日 14:00 前
        │ expected = 最近已完成交易日
        ▼
沿用最新共同有效快照

交易日 14:00 起
        │ expected = 今日
        ▼
探測 TWSE + TPEx 今日正式日報
        ├─ 任一未發布／日期仍舊 ──▶ awaiting-publication
        ├─ 任一 schema／完整性失敗 ▶ invalid-source（fail closed）
        └─ 兩者完整且同日 ─────────▶ collected → publish D=今日、P=前一官方交易日
```

14:00 只代表允許開始探測，是否 ready 仍以回應內正式日期、既定欄位、資料列完整性、母體 market coverage 與 receipt 為準。這比維持固定 18:00 可靠，也為官方報表產生保留收盤後緩衝時間。

替代方案「收盤立刻探測」遭排除，因為來源可能尚在產生報表；依使用者決策採 14:00 作為第一個允許探測時間。替代方案「維持 18:00」也遭排除，因為已有官方資料在 14:32 可用的反例。

### 2. 獨立記錄 expected／effective readiness，不放寬 snapshot 日期一致性

maintenance MUST 以既有 `screener_runs` 保存每個候選日的版本化 readiness checkpoint，至少包含候選 `expectedSessionDate`、兩市場 `pending／complete／invalid`、回應日期、hash、有效列數、attempt、`nextAttemptAt`、最後共同 `effectiveSessionDate` 與安全 reason。不得保存秘密或未受控原始回應。

publisher 仍只在 D／P 兩期都有 TWSE、TPEx 完整 receipt 時建立新 immutable snapshot；v3／v4 仍須與 D 對齊。GET route 從 readiness envelope 取得「現在預期資料日」，並從 snapshot 取得「實際有效資料日」。若 expected 大於 effective，route MUST 回 pending／stale、保留舊日期供查閱，但 rows 不可點選或加入清單。

替代方案「把 UI 日期直接設成今天」遭排除，因為瀏覽器時鐘不能證明官方資料完成。替代方案「放寬 snapshot 內所有日期必須一致」也遭排除，因為會增加 mixed-session 發布風險。

### 3. 日報探測採雙市場並行、整批驗證、原子升級

operator 對候選日使用既有 date-specific 官方 URL，TWSE 與 TPEx 最多各一個在途請求並完整 drain。舊日期／查無資料屬 `source_not_published`，不寫成該候選日 receipt；HTTP、CAPTCHA、429、timeout 與 schema 錯誤沿用既有 fail-closed 分類。只有兩市場都完成後，才由既有 `resolveEffectiveSessionPair` 選出 D／P 並啟動 v2、v3、v4 staging／CAS publication。

單一市場可先留下驗證 receipt 供下一次重用，但 route 必須維持上一個共同 snapshot，不得把上市 9/3 與上櫃 9/2 混合。

### 4. 使用既有 runtime 喚醒，新增 20 分鐘 publication cooldown

不新增 LaunchAgent。14:00 前 operator 零當日報表請求返回；14:00 起若候選日尚未齊備，checkpoint 設定至少 20 分鐘 `nextAttemptAt`，期間即使既有 watcher 每 5 分鐘喚醒也不得請求來源。每候選交易日最多 18 次 publication probe；來源 429 必須尊重更長的 `Retry-After`，transport／blocked 錯誤仍使用既有較嚴格預算。達上限仍未齊備時保持 stale／pending 並留下明確原因，不自動換來源或繞過阻擋。

成功發布後，同一候選日後續喚醒 MUST 直接 noop；既有 6 小時 receipt reuse 可保留，但不得阻止新候選日首次探測。

### 5. UI 分開顯示比較日期與 freshness

選股面板 MUST 以 snapshot evidence 顯示「成交量比較：P → D」與「有效資料日：D」。只有 expected 與 effective 不同時，另顯示「預期資料日：expected；等待 TWSE／TPEx 盤後資料」及最後合法快照時間。歷史 rows 可供稽核但不可作為當期可點選、加入清單或符合結果。

避免沿用單一「有效交易日」標籤同時代表 expected 與 effective；也不得顯示成交值日期來取代 D／P。

## Risks / Trade-offs

- [官方報表在 14:00 後仍可能尚未完成] → 以 exact date、schema、完整列數與雙市場 receipt 判定；未完成只進入 publication cooldown，不發布。
- [既有 5 分鐘 watcher 可能造成過量請求] → readiness checkpoint 強制 20 分鐘冷卻、single-flight 與每候選日 18 次上限，429 使用更長 `Retry-After`。
- [只完成一個市場形成 mixed-session] → 單市場 receipt 只作底稿，publisher 與 route 仍要求 TWSE／TPEx 共同 D／P。
- [v2 已前進而 v3／v4 技術資料尚未完成] → 保留現有 projection 規則；純日量條件可用最新合法 v2，啟用技術條件時維持 preparation pending，不拿舊技術 rows 冒充當期。
- [系統休眠錯過首次盤後探測] → 下次既有 runtime 喚醒依 checkpoint 補做；成功後同日 noop。
- [官方臨時休市或日曆不完整] → 交易日曆衝突時 fail closed，不以 weekday 或日曆昨日推導。

## Migration Plan

1. 先增加純函式與 fixture 測試，固定 expected/effective、14:00 邊界、20 分鐘 cooldown、兩市場狀態及假日案例。
2. 修改 operator／collector，移除兩處 18:00 硬門檻，加入 readiness checkpoint 與候選日探測；保留舊 snapshot 可讀。
3. 更新 publisher／route／API metadata 與 UI 標籤、pending 操作鎖定，再更新 browser 測試。
4. 使用隔離資料庫驗證 9/2 舊快照在單市場 ready 時不變，雙市場 ready 後原子前進為 P=9/2、D=9/3。
5. 在不停止既有服務下執行本機 live maintenance，核對 D1 receipts、API、實際 DOM、結果操作狀態與 console。
6. 若新流程異常，回復 operator gate／route 讀取邏輯即可；既有 immutable snapshots 與正式底稿不刪除、不倒退日期。

## Open Questions

- 無阻擋實作的問題。20 分鐘 publication cooldown 與每日 18 次上限先作為保守預設；live evidence 若顯示官方來源有更明確 `Retry-After` 或發布節奏，必須採更嚴格者並在 verification 記錄。
