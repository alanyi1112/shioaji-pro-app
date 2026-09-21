# 2026-09-17 當日盤中完成計畫

使用者要求今天完成可完成的盤中驗收，已完成項不重做；失敗保留證據，修正後只重驗受影響路徑。主執行 task 為 `01a0aad9-e62b-7171-b0d3-fd2a2d675fe6`；原 task 已停止補跑，避免 compaction 再次回到歷史收工。

## 已完成，不重新消耗來源請求

- 移除自行加入的每日 8 次硬上限，沒有替換成其他每日次數；保留 usage 計数與現有資料。
- 維持 1.5 秒間隔、同商品／日 single-flight、Web Locks、逾時、資料量限制；新增跨視窗持久失敗退避及 Retry-After。
- 重連先等累計量判定缺口；載入中、冷卻中缺口排程保留；同一契約物件刷新不重置 session。
- 獨立成交明細頁自行建立 SSE 與 Tick 訂閱，不載入主交易頁帳務輪詢。
- 瀏覽器 offline 立即使本頁串流失效並保持部分資料；online 建立新連線，不停止共用 server。
- 10:17 最新 browser 回歸 2 檔 20 tests 通過；來源與 stream 的針對性回歸已通過。後續僅有程式新變更或失敗時重跑相關測試。

## 上午已驗收完成，不重跑

- 10:22:34–10:23:13 真實 2330：首次載入、歷史/live 交接、本頁 offline 12 秒、恢复補齊通過。斷線 2,281 筆保持，恢复快取 2,295 筆，既有識別碼保留、重複 0、累計缺口 0。
- 成功 run 的歷史請求 4 次：initial 2 次＋reconnect_gap 2 次。7 次含修復前失敗的驗收合計 22 次新增歷史請求；原使用者 profile 先前已知 8 次另列，不冒充券商全帳戶總請求。詳細紀錄見 live-acceptance-2026-09-17.md。
- 最後型別修正及 cache 來源標記後，20 項 browser 測試、tsc／build 通過。原使用者 Chrome 視窗 10:26:51 顯示「已核實」，沒有清除該 profile。

## 今天的特定時點

- 唯一 automation-2 已轉綁主執行 task；scheduler 實際 next_run_at：**2026-09-17 13:27:21 Asia/Taipei**。
- 執行 `node outputs/tick-tape-verification/closing-acceptance-2026-09-17.mjs`，沿用 `.codex/tick-tape-live-profile`；不重新 seed counter。腳本已於 13:27:54 實際啟動，13:30:25 通過；原始結果見下方。
- 13:27 起只做尚未完成的 13:25 大單排除與隨後收盤成交驗收，不重跑已通過的斷線情境。
- 13:27 尚未收盤，必須等待今天實際收盤成交，對照全部清單保留收盤，大單不包含 13:25 起成交。未達時點不得預先勾 task 5.1。
- 驗收完成後更新 source／verification／tasks。依 2026-09-17 最新使用者要求，當輪結束維持 automation-2 每日 08:26／10:26／13:26／16:26／20:26 五時段，不恢復舊 09:02；Cloudflare 每日優先補檔且今日已完成period不重寫，下一缺期依Cloudflare adaptive-backfill-plan.md的fresh實際額度可同日續補，保留本機資料待辦；不自行 commit／push／archive。

## 失敗處理

保留舊結果，按失敗路徑修正；不清 counter、不用換 profile 掩飾、不放寬資料完整性、不啟停共用 API、行情串流、watchdog、5173／5174 或其他監控。不能確認的項目明確列未完成及原因，不能默默順延至下一交易日。

## 2026-09-17 13:30 收盤終驗完成

13:27:54–13:30:25 沿用同一隔離驗收 profile，沒有重設計數。原始證據：`outputs/tick-tape-verification/closing-acceptance-2026-09-17T052754576Z.json`。首次 AllDay／RangeTime 各 4,555 筆、Snapshot 13,993 張一致；其後 SSE 收到 13:30:00 的 1,958 張收盤成交，全部清單增至 4,556 筆，最早 09:00:08.789371 不消失，重複識別碼與累計缺口均為 0。收盤成交 isLarge=false，reason=outside_continuous_session，13:25 起大單數為 0。來源 metadata 的 verifiedThrough 仍保留首次歷史核對的 13:24:58，不冒充收盤後又重查歷史；收盤尾端由真實 live 累計量驗證。

本次僅新增 2 次歷史請求；加上午 7 次驗收的 22 次，共 24 次本任務新增實體歷史請求。原使用者 profile 已知 8 次及其他共用帳戶使用仍另列。上午首次載入／歷史即時交接／隔離 SSE 斷線恢復不重跑。先前零成交、來源空白、截斷與分類邊界測試，加上今天上午和收盤真實證據，已完成 task 5.1；本 change 21/21，不代表已歸檔或提交。
