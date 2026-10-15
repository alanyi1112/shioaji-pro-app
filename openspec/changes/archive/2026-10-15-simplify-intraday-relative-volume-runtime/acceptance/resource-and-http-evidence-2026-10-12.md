# 新舊路徑成本證據核對（2026-10-12）

本輪只讀既有原件，沒有重新下載、重啟或新增訂閱。此紀錄完成 7.5 的量測保存與限制揭露，不代表今日全日驗收通過。

## 原始 HTTP 紀錄

- 舊路徑原件：`Application Support/RealTimeStock/intraday-baselines/2026-10-05-direct160-source/request-ledger.json`。逐列加總：KBar 320 次／4,964,612 response bytes；ticks 160 次／39,392,787 bytes；usage 649 次／55,814 bytes。這些是本機 HTTP 回應，不是券商傳輸額度。
- 新路徑原件：`Application Support/RealTimeStock/IntradayMonitor/daily-minute-volume-collection/2026-10-08/attempt-01-receipt.json`、`attempt-02-receipt.json`。第一輪 320 requests／2,576,173 response bytes，partial 159／160；原程序補件 1 request／16,965 bytes 後 complete 160／160。合計 321 次／2,593,138 bytes；計數範圍為採集器契約與 KBar 請求，不與舊 usage 查詢混算。
- 日期及市場實際內容不同，不從以上差值宣稱同資料量或券商額度精確節省率。第二輪重用 159 份 cached manifest 不等於完整發布後下一次同鍵 no-op；7.2 仍待真正後次證據。

## 本機資源

新路徑 10/8 原 `daily-run/2026-10-08/summary.json`：peakRssBytes 132,333,568、maxEventProcessingMs 1,211、slowEventCount 0、CPU user 556,260,074 microseconds／system 389,016,276 microseconds、evidenceDatabaseBytes 287,731,336、resourceFault null。這是原全日程序紀錄，executionOutcome 仍為 partial，不能因資源健康改判 live 完整。

今日 10:25–10:31 程序 RSS／CPU／DB 樣本及原生 provider 重設前後錨點另見 `live-2026-10-12.md`。舊 10/5 原程序未保存完整資源峰值，明列 unknown；不能以事後程序樣本補造。DB 為累積多日資料，非該日新增大小；CPU 累積時間不是瞬間利用率。

## 券商額度邊界

今日原生 CAS 所保存的同帳戶重設前後 usedBytes 為 13,788,835 與 45,526，上限同為 524,288,000 bytes；300 MiB quote 保護池不變。它們證明來源週期下降及續轉，不是獨占採集成本。共享帳戶有其他工作，沒有同範圍前後獨占錨點，故券商節省比例 unknown。

7.5 要求保存可取得量測並區分本機與券商額度、缺錨點不得宣稱精確比例；本輪依原件完成該項。今日最終峰值與收尾仍待 7.4，整案結案仍待其餘任務。
