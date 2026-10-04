# 2408 有界圖表／雙清單驗收（2026-10-04，45／47）

時間使用 Asia/Taipei。使用者本輪明確允許 2408 南亞科最多兩筆正常 Tick／BidAsk 訂閱及日 K 查詢、暫加 MultiView 後精準移除。使用既有 Chrome／simulation runtime，沒有自行建立第二個 login、行情連線或重啟共用服務。授權已執行，不能再將本輪描述為等待授權。

## 成功與精準復原

- 修正查詢後，實際選股 UI 顯示 16 檔：壓縮 14／準備 1／突破 1，unknown 61。2408 卡片為「正在壓縮」，資料日 10/2。
- 10:11 實際點選 2408，指定既有 K 線圖載入 2408／1D，DOM 與畫面顯示日 K／BOLL，沒有選取其他結果商品。截圖 `/tmp/bollinger-authorized-chart-20261004.png` 已實際檢視；當時 DevTools 佔用高度，因此圖表區較矮，不冒稱完成完整高度的圖表視覺稽核。
- 在該結果卡按「加入清單」，UI 明示「已加入 Shioaji『選股』與 MultiView『選股篩選』」。Shioaji 原已包含 2408，前後都是原 13 項；MultiView 真實讀取由 6 項增加至 7 項，新項只有 2408.TW。
- 10:20 使用已存在的 `/api/instruments/remove-from-tab` 精準移除 `2408.TW`／`personal:stock-screener-filtered`，HTTP 200、ok；沒有回存整份名單。10:33 唯讀重核對仍為原 6 項及原順序：2454.TW、3675.TWO、8054.TWO、3715.TW、2436.TW、1809.TW。Shioaji 仍原 13 項且保留 2408。
- 透過 UI 還原原三項草稿、AND／符合／代碼升冪，重新查詢；指定圖表回復 IX0001／5m。未按每日設定儲存。10:33 的实际 DOM／畫面確認已套用三項及原圖表，截圖 `/tmp/bollinger-authorized-final-restored-20261004.png` 已檢視。面板仍保留先前「已開啟 2408」操作訊息，不將它誤當目前圖表商品。
- 10:33 正式 SQLite 唯讀核對：head 仍 `72dd8c83-792e-4217-a8ab-398cf8513c51`，updatedAt `2026-10-04T01:11:47.246Z`；每日 profile revision 1、payload hash `4ce25d3d72813b4b0b05939920cb6779fbd96b54afecaa1415981cf035407028`，建立時間未變。

## 真實失敗與程式修正

- 初次 Chrome v8 查詢 HTTP 503，約 5,501 ms；同 URL 直接 5174 診斷曾回 HTTP 200／16 檔、6,094 ms。保存原始 `/tmp/bollinger-authorized-prequery-20261004.har`，不刪失敗或宣稱初次即成功。它含私人帳務回應，只留本機，不能提交或整份輸出。
- repository 已完整驗證後，query 對同一份 1,977 檔底稿又逐份結構／hash 驗證。改為完整驗證後深度凍結、只重用同一不可變物件的驗證結果；clone、新 DB 讀取、來源 manifest／rowsHash 仍完整驗證。沒有更改 gateway 超時、來源政策或服務生命週期。
- 最終實際 UI 重查成功；沒有保存最終請求的完整 latency，因此不能保證所有後續查詢皆不逾時。中間一筆直接 5174 診斷因回非 JSON 而解析失敗，原因未確定，列 unknown，不抹成成功。

## 安全觀察與未完成證據

- 10:33 `pnpm local-runtime status`：simulation healthy，business session／2330 Snapshot available，production stopped，write master disabled，watchdog restart count 0。沒有操作登入、委託、停損／停利或帳務寫入 UI。
- 10:22:48 與 10:33:56 `/api/v1/stream/status` 都為 healthy／active_connections 63；10:22 與 10:33 `/api/v1/auth/usage` 的 broker connections 都為 1。這些是共享狀態，不是逐操作請求數或零額外訂閱的充分證據。
- 10:22 usage 原值 bytes 2,545,677、limit 524,288,000、remaining 521,742,323；10:33 bytes 2,858,806、remaining 521,429,194。缺少同輪操作前 usage 錨點，不把兩者差額歸因於本次日 K 或布林查詢。原本機保守額度政策、300 MiB 保護池及基準保留未改。
- Chrome DevTools 顯示既有週期性帳務／成交紀錄查詢 HTTP 400 及大量 console errors，不能把瀏覽器工具返回空日志宣稱整頁乾淨。此處只觀察，未擴大修改其他帳務功能。
- 原請求紀錄仍在 DevTools。HAR 匯出儲存面板顯示 Save disabled、原生座標控制回 `noWindowsAvailable`；替代複製未取得內容。`/tmp/bollinger-authorized-chart-list-20261004.har` 為 0 bytes 的失敗匯出，保留而不覆寫成假成功。已取消儲存面板、收起 DevTools並恢復使用者畫面。
- 因本輪完整網路紀錄未成功保存，**Tick／BidAsk 實際請求數、日 K／來源請求數及零交易／login 請求證據尚缺**。安全上視兩筆訂閱預算已用，不再重複點股或新增訂閱。先尋求唯讀保存既有紀錄；不能再以先前隔離頁 network counts、fixture 或程式推理充當本輪真實 counts。

因此 7.4／8.8 仍未勾，維持 **45／47**；操作成功不等於完整結案證據。原公告、7/10 十八次、158 failed 及發布原件全部保留。舊三組維護此輪 deferred，非已驗收。

10:36 已更新原 heartbeat 接續指令，明示授權已執行、剩餘為網路證據且不得重複使用訂閱預算；頻率仍每 20 分鐘。唯讀 scheduler 實際 `next_run_at=1791081465390`，對應台北 10/4 10:37:45，不只核對 RRULE。未取得新可操作證據時保持安靜，不重複相同驗收或完整回歸。

## 回歸

- Vitest：query／gateway／雙清單同步／指定圖表選擇，4 files、34／34 通過。
- Node 24：v8／fallback publication，30／30 通過。
- `pnpm build`、`pnpm typecheck:multiview` 通過，原大 chunk 提示保留。
- OpenSpec strict validation／`git diff --check` 通過；新增文字檔 whitespace／衝突標記核對通過。初次檢查誤把既有 JPG／PNG 當 UTF-8 文字而報告 11 個假警示，修正檢查範圍排除二進位，沒有改動圖片；不以測試冒充缺少的 live network 證據。
