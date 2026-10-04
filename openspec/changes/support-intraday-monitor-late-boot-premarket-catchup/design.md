## Context

既有四個 `StartCalendarInterval` 在使用者尚未登入時可能沒有執行紀錄。`--scheduled` 只接受接近固定時間的喚起；08:35／08:45 缺 session 補救又要求 08:20 原始日曆失敗收據，不能處理完全沒有 08:20 run 的晚開機。08:50 的採集入口不補建 session；generation anchor 與 Stage 160 canary 對啟動時間有嚴格限制。前一交易日已驗證基準仍是不可降低的前提。

## Goals / Non-Goals

**Goals:**

- 使用者於交易日 08:20 後、09:00 前登入時，由本機機制在可用時間內接續當日 session 與至多一條採集，不依賴 Codex 或人工改日期。
- 每個晚開機嘗試有獨立、append-only claim 與收據；四個原排程的未執行／失敗證據保持原樣。
- 對不足的暖機、基準或資料面證據維持 cold-start／partial／unknown，不冒稱完整日或 Stage 160 live 驗收成功。

**Non-Goals:**

- 不保證 08:59 才登入仍能在 09:00 前完成 API、Web、MultiView 啟動與 160 檔訂閱；截止時未就緒就 fail closed。
- 不在開盤後自動從缺漏的 KBar／圖表快取重建完整日，也不補造前一日盤後未採集的 160 檔正式基準。
- 不啟用 production、broker write、CA、第二個 Shioaji login 或第二條行情 subscription。

## Decisions

### 1. 晚開機入口與固定排程分開

另建 `RunAtLoad` 的本機 LaunchAgent，執行 `--startup-catchup`，不使用既有 `--scheduled` 時點推算或覆寫固定收據。另於 08:25、08:40、08:55、08:58 做少量本機 catch-up 觸發，涵蓋登入較早但固定節點暫時失敗，以及睡眠後在開盤前喚醒。程序只在 `Asia/Taipei` 的 08:20:00–08:58:59 執行；08:20 後先等至 08:22，讓原排程取得優先權；登入早於 08:20 或已過截止時立即記錄 no-op。登入時 API 尚未就緒者可在同一進程中每隔數秒做有界唯讀重查，最晚於 08:59:00 停止。正常四個固定排程仍是首選，不因晚開機入口而移除。

### 2. 同日接續必須取得完整 identity 與零活動證據

入口先讀本機已發布且經 hash／官方雙市場日曆驗證的 baseline，並核對當日 config revision、精確 cohort、approval、immutable bundle、simulation mode、既有 business session、2330 Snapshot、Web／MultiView、磁碟及 generation。缺任一資料即 fail closed；特別是前日盤後基準缺席時不以幾分鐘內臨時補抓作為降級替代。若當日 session 存在，僅在 identity 相符且未開始 capture 時前進；若缺失，必須證明今日尚無 capture／subscription／observation／trigger，再以獨立 claim 建立唯一 session。任一既有資料活動或不明狀態都不得重新建 session。

### 3. 晚開機採集與原排程共用一次性排他權

08:50 前接續僅準備 session，讓原排程在 08:50 啟動採集；08:50–08:58:59 若原排程未啟動，晚開機入口在重驗 Gate、generation 與當日零採集後才可啟動既有 capture runner。原排程與晚開機入口共用每日獨占 capture-start claim，capture runner 既有 run registry 仍作第二層防重。收到獨占權後失敗時不自動重試以免雙訂閱，留下明確 failed receipt。晚開機收據記錄原排程收據存在與否、實際登入／開始時間、所有 Gate、session id、generation、基準 hash 及啟動結果；不得寫成 08:20 或 08:50 準時成功。

### 4. 晚生成的 anchor 必須由獨立準備收據驗證

不直接放寬原本 generation 時間檢查。晚開機 anchor 只能引用同日不可覆寫的 prepared receipt；capture runner 驗證 receipt 與 session／baseline／generation／實際 anchor 時間一致後，才接受 08:35 後建立的 anchor。若在 08:45 後冷啟動，status 明示 cold-start risk；第一筆合法 KBar、09:01 canary 與 freshness 未通過前，不得顯示 data active 或發通知。即使資料之後完整，早期暖機缺席仍不可算作原本的準時排程驗收。

## Risks / Trade-offs

- [開機後服務啟動慢] → 有界重查至 08:59，仍不就緒便 fail closed，回報具體 Gate，不自行重啟服務。
- [登入與 08:50 排程競態] → 共用獨占 capture-start claim 與既有 run registry；不刪除鎖或重複使用 generation。
- [前一交易日基準缺席] → 不啟動當日比較或通知，明示 `baseline_missing`，另由既有歷史補建流程在適用時處理。
- [開盤前接續不等於完整暖機驗收] → 保留 late-start provenance、cold-start risk、canary 與結果資料面 Gate，不能回填原排程成功證據。

## Migration Plan

1. 先實作純判定、獨立 claim／receipt、共用排他權與晚開機 anchor 驗證，使用 fixture 跑競態、截止與 fail-closed 測試。
2. 在台北時間 08:59 後、可證明新增 `RunAtLoad` 入口只會 no-op 的時段安裝新增 LaunchAgent，讀回 `RunAtLoad` 與既有四時點；不重啟盤中 API、watchdog、Web、MultiView 或行情連線，亦不得以 plist 已載入冒充真正完成接續。
3. 下一適用交易日於真實晚登入情境保存登入、Gate、session、capture、首筆 KBar、canary 與 UI/API 收據；完整證據前保持 live acceptance 未完成。

## Open Questions

- 使用者若在 09:00 後才登入，需要另一個明確的「盤中晚加入」規格；本 change 不自動把缺少開盤 live SSE 的日子標記為完整監控。
