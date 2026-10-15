# 7.7 排程與真實收據結案驗證（2026-10-15）

時間均為 Asia/Taipei。依使用者本輪明確授權，7.7 改以「已載入排程條件＋真實系統觸發及原程序收據＋翌日實際 session」驗證，不以自行推算的 next trigger、只有 loaded 或離線測試代替成功。本輪另實際取得 UserEventAgent 的 rescheduling 原文，因此也保存了系統記錄的下次觸發值。本案 61／61 完成，可同步主規格後歸檔；這不是把歷史全日行情 partial 改判為完整。

## 排程、觸發及原程序鏈

- `launchctl print gui/501/com.alanyi.realtimestock.intraday-postclose-baseline` 確認原 label、Node24 `/opt/homebrew/opt/node@24/bin/node`、原 `postclose-daily-baseline.mjs --scheduled` entry，已載入 `Hour=13, Minute=35`；系統時區為 Asia/Taipei。未執行 load、bootout 或 kickstart。
- UserEventAgent 原始記錄：10/15 **13:35:04.090193** `Running StartCalendarInterval`；**13:35:04.094071** `Rescheduling StartCalendarInterval` 明列 **2026-10-16 13:35:00 台北標準時間**。這是系統原值，不是由 plist 推算，也不是 Codex heartbeat 時間。
- 原 claim 於 13:35:05.321 建立，owner PID **11434**；原 attempt-01 於 16:14:23.092 為 partial 159／160，320 requests／2,594,132 本機 response bytes，原件保留。
- 同 PID 自然 attempt-02 於 **16:29:23.551** 完成 160／160，waiting=0、conflict=0，追加 1 request／17,119 bytes。兩次合計 **321 requests／2,611,251 本機 response bytes**，不能說首輪即成功。
- 16:29:24.013 原 PID 的 same-key-noop：`originTrigger=scheduled`、`sameOriginalProcess=true`、追加下載 0、reservation 0，完成收據 hash 一致。這是同程序第二次 collector 重用查核，不是第二個獨立排程。
- 原生官方日曆於 13:35:05.235、原 claim 前取得，`trigger=postclose`，source 10/15、target 10/16；未重新抓取或改寫日曆。

## 前日基準、翌日 session 與來源用量

- 唯讀 SQLite 並逐份使用 `isDailyMinuteVolumeBaseline` 重驗 **10/14→10/15、10/15→10/16 各 160 份**：schema、日期、payload／manifest hash、分鐘 provenance 及固定 cohort 一致；各組 TSE 121／OTC 39、每檔 270 分鐘，共 43,200 分鐘。兩組獨立收盤總量對帳仍各為 `not_observed=160`，不冒稱已獨立總量對帳。
- 10/14 基準是 operator 中斷補件結果，不能追認為當天原生排程成功。10/15 基準才有本輪核對的原生觸發及完成鏈。
- 真正 10/15 session `session-2026-10-15-4aebd580e4d9e0aec51695d1` 使用 10/14 前日基準，160 檔皆有首筆 KBar，最早 09:01:02.538。08:45:03.616 原排程保存同 session 的 generation transition，在首筆資料前完成舊 `simulation:7b2fbecb-6cf4-45ed-8aae-982465f4c234` 至新 `simulation:29420527-3b87-4c11-88d5-e6e5763af570` 的安全查核。未新增 owner、券商登入或行情連線。
- 原 08:20、08:35、08:45 收據及 session 對應成立；原 08:50 最終 `daily_minute_volume_execution_failed` 與全日 157／160、13:40 partial 均保留。跨日 session／日期／來源身分通過不等於全日 live 完整；盤後補算與尾筆例外另循新版已歸檔契約。

| 原始來源錨點 | raw used bytes | limit bytes | 用途 |
| --- | ---: | ---: | --- |
| 10/14 18:20:22.484 | 7,110,566 | 524,288,000 | 前日 operator 完成後真正來源錨點 |
| 10/15 08:20:05.534 | 877,389 | 524,288,000 | 同帳戶、同上限、跨日 raw 計數確實下降 |
| 10/15 16:29:24.080 | 66,787,448 | 524,288,000 | 原盤後程序保存的下一次比較錨點 |

三份來源原文 evidence hash 重算相符、simulation=true、`admissionAuthority=false`，帳戶 HMAC 一致但不公開其值。未建立新額度、未清 charged／carry，未將 operator 保守 carry 冒充 raw；300 MiB 保護池不變。共享用量且盤中曾換 generation，不將兩端相減宣稱獨占消耗或精確節省。

## 可重查證據與限制

- 私密證據目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/rollover-scheduler-closeout-20261015.MKQxCg/`，包含原 loaded descriptor、UserEventAgent 原文、唯讀驗證腳本、前置安全快照與 `scheduler-proof.json`。
- `scheduler-proof.json` SHA-256：`007a3abef58876ba15a7786b6c8c8817140cf680a14d1f9eaa803493f002cbce`；原系統觸發記錄 SHA-256：`e687d8d3eed3323b864a17dcc19c684da9a43ff003a9c745e16551496c9e7659`。14 個獨立查核全部成立，16 份原始收據／設定／來源檔讀取前後 hash 不變。
- 正式 collector 完成收據 SHA-256：`bf438489a071ca9676f38c279d85bc57e008b8cf33f79257102e64fbed0cab87`。
- 第一版獨立查核腳本錯把 cache trigger 期待成 `scheduled`，實際 schema 為 `postclose`，故曾拒絕；原失敗腳本 `verify-scheduler-first.mjs` 保留。修正的只是查核期待值，仍要求原生時間、日期、原 claim 與系統觸發鏈一致，沒有修改正式原件或 runtime 來使其通過。
- [17:36 跨日 dossier](closeout-dossier-2026-10-15.md) 及所有先前 failed／partial 保留原文；當時缺 next-trigger 讀回的結論由本篇新增證據接續，不回填為當時成功。

## 歸檔相容性與回歸

正式 runtime bundle hash `14e3305833b60bc76122613950359d3d771f36661d1ab1f95267a018ce12cdd5` 的四個實際檔案均在 AppSupport 不可變 bundle；manifest 的舊 change `source` 只表示來源 provenance，不作現行讀檔位置。歸檔前後均須唯讀解析 bundle，不能重裝或換設定來冒充相容。

另修正未載入服務的 standalone `install-daily-rollover-state.mjs` verifier 輸入位置，改指向本次明確 archive identity；其測試 fixture 同步調整，新增「active change 已不存在仍可 dry-run」回歸。沒有呼叫正式 installer，沒有改 loaded job、runtime config 或 Vite gateway 相依模組，沒有重載頁面／服務。

- 隔離副本 Node24：installer、runtime artifact bundle、current-session authority **22／22**。
- 同隔離副本 `tsc -b`、Vite build 通過；既有大於 500 kB chunk 警告保留。
- 四份主規格僅追加本案 **19 Requirements／44 Scenarios**；原主規格 prefix hash 不變，新增內容與 delta 逐字一致，四份 strict 通過，保留 daily v2、門檻切換、compact UI 及尾端退役契約。

本輪未代跑採集／audit、未新建排程、未改券商或 production 狀態、不下單、不 commit／push。最終 archive、全案 strict、diff／新增文字 whitespace 與前後安全比對結果見 [結案驗證](../verification.md)。
