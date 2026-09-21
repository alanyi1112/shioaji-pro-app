# 2026-09-17 真實盤中修復與驗收證據

## 完成範圍

移除自行加入的每日 8 次硬上限，未替換成其他每日次數。保留 1.5 秒節流、同商品／交易日 pending 與 Web Locks、逾時、資料大小限制及原有每日計數，新增持久失敗退避、Retry-After 與 request reason。重連先等即時累計量判定缺口，載入／冷卻中的修復需求不丟失；契約物件刷新不重置 session。獨立成交明細頁自行建立 SSE／Tick 訂閱，避免主頁帳務輪詢。browser offline 立即關閉該頁連線並保持部分狀態，online 重建，不操作共用服務。

歷史核對允許第二份 RangeTime 比 AllDay 晚到而多出尾端，但共同前綴必須逐筆一致。Snapshot 落後時只重查一次輕量 Snapshot，不重抓歷史；只有 Snapshot 精確對上 AllDay、RangeTime 為一致延伸且真實 live 累計量已跨過尾端、成交量連續，才允許 UI 確認交接。舊快取不直接當成重新連線的即時核實。

## 原因與不能確認的部分

- 原碼每次重連強制抓一組 AllDay／RangeTime，重複掛載及缺口再補造成放大風險。每日 8 次只容許四組核對，並非來源可核實限制。
- 舊計數沒有逐次原因，不能宣稱今天最初 8 次都是 SSE 重連；現新增 reason 以便日後查證。
- 實測另外找出獨立頁缺少串流啟動、browser offline 未立即降級、來源取得時差引發 Snapshot 落後，已修正。驗收腳本早期 dialog selector 和斷線前取樣時點錯誤也已修正，失敗結果保留。
- 排程在上下文壓縮後錯接歷史收工，並非當日沒有執行。已建立持久 checkpoint、轉綁目前 task、明訂本輪優先順序，當日下午實際 trigger 已核對；仍需下午實際執行結果才能確認修復效果。

## 真實資料證據

成功原始檔：`outputs/tick-tape-verification/live-sse-acceptance-2026-09-17-2026-09-17T022233625Z.json`。

- 台北 10:22:34–10:23:13，2330，simulation 真實行情。
- 最早成交 09:00:08.789371；首次已核實 2,276 筆，live 增至 2,277。
- 10:22:48 斷線，2,281 筆完整保留 12 秒；10:23:00 恢復。
- 恢復快取 2,295 筆，先前已保存成交識別碼全部保留，重複識別碼 0、累計成交量缺口 0。
- 歷史核對 AllDay 2,285、RangeTime 2,286，共同前綴 2,285；Snapshot 8,009 比歷史 7,999 更新，由後續真實 live 及累計連續核對。保留來源 metadata 的 partial/snapshot_ahead_of_history，沒有改寫成歷史本身完全同時取得。
- 實體歷史請求正好 4：initial AllDay／RangeTime 各一次、reconnect_gap 各一次；SSE 2 次建立。offline 的 ERR_INTERNET_DISCONNECTED 為預期，pageErrors 為空。
- 帳戶 usage 前 5,651,160 bytes、後 6,042,615 bytes，limit 524,288,000；connections 維持 1。此 usage 是共用帳戶觀測，不宣称全部增量只來自本頁。
- 10:26:51 原使用者 Chrome 主視窗成交明細另顯示「已核實」，2,249 筆並持續更新；未清除原 profile，未重開以避開舊 cap。

## 請求計量與保留紀錄

7 次真實驗收各新增 2、2、2、4、4、4、4 次，共 **22 次**。最後成功 run 為其中 4 次。原 profile 先前已知 8 次另列；不能把兩者相加當券商全帳戶或原 profile 的精確實測總量。

隔離驗收 profile 的 26→30 是匯入已知累計 baseline 後的測試計量，不是讀取原 Chrome 的 IndexedDB。早期 harness 每次 seed 該隔離計量且 events 重新起算，原始每次 network/event JSON 均保留；已修正 harness 為只有缺少 budget record 才初始化，下午不得再 seed 或清除。原使用者 profile 不曾清除；所有失敗／中間結果不覆寫、不刪除。

## 上午檢查與當時待辦（已由下方收盤證據接續）

- 最後 browser 回歸 2 檔 20 項通過；來源／串流／bounded API 16 項通過；tsc／Vite build 通過，保留原有大 chunk 警告。
- runtime：simulation=true，business session available，watchdog healthy、0 failures／0 restarts；API、5173、5174 皆 up，production 停止、交易寫入 disabled。沒有停止共用服務。
- 上午驗收不重跑。**13:25 大單排除與今天真實收盤列仍未驗收，task 5.1 保持未完成。** automation-2 已轉綁目前 task，scheduler next_run_at=1789622841000，即台北 2026-09-17 13:27:21。
- 下午執行已準備好的 closing-only 腳本，保留同一驗收 profile；等實際收盤成交且來源與累計量核實，才勾 task。若延後撮合或資料不完整，保留未完成並修正，不能預先宣稱通過。

## 2026-09-17 13:30 收盤終驗完成

13:27:54–13:30:25 沿用同一隔離驗收 profile，沒有重設計數。原始證據：`outputs/tick-tape-verification/closing-acceptance-2026-09-17T052754576Z.json`。首次 AllDay／RangeTime 各 4,555 筆、Snapshot 13,993 張一致；其後 SSE 收到 13:30:00 的 1,958 張收盤成交，全部清單增至 4,556 筆，最早 09:00:08.789371 不消失，重複識別碼與累計缺口均為 0。收盤成交 isLarge=false，reason=outside_continuous_session，13:25 起大單數為 0。來源 metadata 的 verifiedThrough 仍保留首次歷史核對的 13:24:58，不冒充收盤後又重查歷史；收盤尾端由真實 live 累計量驗證。

本次僅新增 2 次歷史請求；加上午 7 次驗收的 22 次，共 24 次本任務新增實體歷史請求。原使用者 profile 已知 8 次及其他共用帳戶使用仍另列。上午首次載入／歷史即時交接／隔離 SSE 斷線恢復不重跑。先前零成交、來源空白、截斷與分類邊界測試，加上今天上午和收盤真實證據，已完成 task 5.1；本 change 21/21，不代表已歸檔或提交。
