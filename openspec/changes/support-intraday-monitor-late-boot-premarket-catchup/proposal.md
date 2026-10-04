## Why

盤中監控目前只在 08:20、08:35、08:45、08:50 觸發；若使用者於 08:20 後才開機登入，當日可能完全沒有 08:20 收據，現有補救條件便永遠不成立。日常使用不應要求電腦在 08:20 前開機，但晚開機也不能被冒稱為準時排程成功或完整盤中驗收。

## What Changes

- 增加由本機 LaunchAgent 在登入後啟動的有界盤前接續入口；它不依賴 Codex 排程，也不要求補造錯過的固定時點收據。
- 在開盤前且必要的本機雙市場日曆、前一交易日 160 檔基準、simulation business session、商品名單、設定版本與安全 Gate 全部通過時，以獨立 claim／receipt 建立當日 session；08:50 已錯過時，於截止時間前只啟動一次既有採集。
- 保留「準時排程」、「晚開機接續」、「已錯過而未執行」三種證據與 UI/API 語意；任何資料不完整、服務尚未就緒、重複啟動或已開盤時 fail closed，不宣稱今日監控已運作。
- 明確揭露前一交易日盤後基準若因關機未建成，開盤前幾分鐘不能保證有界補齊；不以圖表資料或推測取代正式基準。
- 補上晚開機、服務延遲、重複觸發、非交易日與開盤截止邊界的回歸測試及真實登入驗證；不重啟盤中現有服務或改寫舊收據。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `intraday-monitor-premarket-readiness`：盤前 session 與採集在漏掉固定排程後，可由登入後的獨立、限時且可稽核入口安全接續；原排程失敗與缺席狀態仍須保持真實。
- `intraday-relative-volume-monitor`：晚開機接續只能在完整 current-session authority 與首筆合法 KBar 證據成立後取得資料與通知權限。

## Impact

- 影響 `scripts/intraday-monitor-runtime/` 的 LaunchAgent 產生器、盤前 orchestrator、generation anchor 與 capture 驗證，以及相應測試與本機維運文件。
- 新增獨立晚開機收據與 claim；既有 08:20／08:35／08:45／08:50 原始 claim、receipt 與歷史失敗證據一律不可覆寫。
- 僅限既有 simulation runtime 與 business session；不取得 production、CA、真實下單、第二次 login／subscription 或未授權的服務啟停權限。
