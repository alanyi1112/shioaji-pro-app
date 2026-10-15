# 布林位置遭未啟用籌碼日期阻擋：修復與驗證

日期：2026-10-15，時間均為 Asia/Taipei。使用者要求查明並修復；另明確允許今晚限定載入 5174 選股 worker 與 5173 回應解碼，不手動重啟其他服務、不動排程或盤後採集、不 commit／push。

## 已確認根因

- 「布林通道位置」走 v7，原 publisher 依序依賴 v6／v5 籌碼整合底稿。20:29 截圖與本輪唯讀查核一致：v5／v6／v7 停在 10/14，預期 10/15；不是前次 v8／v9 查詢失敗後借用 v7 日期的問題。
- 當日正式 v4 技術底稿已為 10/15，snapshot `6629aed5-bd47-4a0d-88b5-c32898d7b7cf`；獨立 v8「布林壓縮與突破」亦已發布 10/15。兩者並非共用同一發布依賴。
- 當時兩市場 10/15 institutional-flow 已 verified，當日 margin-short 收據尚未存在。本機 `chipDownloadDecision` 的融資融券採集窗口為 21:00；這是現行程式政策，不宣稱官方必定於該時間公布。未勾選籌碼的布林位置仍被此依賴阻擋，才是本次錯誤。

## 最終修正

1. 原 v4 背景 publisher 完成／同鍵重用後，獨立準備 v7 技術底稿，不再等待 v5／v6。沿用同一母體與 130 個官方 session canonical 未還原 OHLCV、既有公式與逐檔 unknown 語意。
2. 底稿只寫入 `screener_runs` 的兩個新 scope：`screener-v7-technical-feature`／`screener-v7-technical-manifest`。以 v4 immutable snapshot ID 綁定每股 evidence hash／完整 rowsHash；未完成、損毀或過期時不解鎖。僅保留仍對應最近兩份 v4 的本輪新底稿，不刪改舊來源、原 head、failed／partial 或採集收據。
3. 僅啟用 BOLL／RSI／KD／MACD（含各自量能確認）的 GET，唯讀已封存底稿再套門檻，不讀 raw OHLCV、不計算指標、不下載或更新。回應明列 `queryDataScope=technical-only`、`sourceSnapshotVersion=4`；未選用籌碼／法人 evidence 與 coverage 為 null，前端只在明確 scope 下接受，不假造其日期或 hash。
4. 任一額外舊條件啟用，仍走原整合查詢與同日 Gate，不把新技術日期套到舊籌碼。原 v7 完整底稿與舊 cursor 保持相容；新 cursor 綁定實際 v4 ID／條件／排序。
5. 今天已發布的 v4 由本輪限定修復一次準備技術底稿：20:50:36–20:50:38，共 1,978 份 feature＋1 份 manifest；原 snapshot head／metadata 不變、來源請求 0；緊接同鍵重用 `unchanged`、追加寫入 0。這是操作員修復，不冒充原本自動排程成功。後續由原 v4 publisher 接續，不新增或改動任何排程。

## 正式資料與查詢驗證

- 最終 frozen GET：20:51:47 起，5174 HTTP 200／2,878 ms（含載入後首次查詢）、5173 HTTP 200／785 ms，兩份 body SHA-256 均為 `76de4ad09f072445f9f15fcc27366df4832970dfed6f6c02be41f0bd8f9bbbd9`。有效／預期皆 10/15，公式與 mapping 保持原版本。
- 下軌外、量能確認關閉：母體 1,978、符合 190、不符合 1,501、unknown 287。unknown 保留，不把「日期已正確」說成每股歷史全部完整。底稿 readiness 為 continuity unknown 282、invalid OHLCV 1；另有短歷史／暖機不足，使本次條件合計 unknown 287。
- 返回首頁 100 份符合結果，逐份以原 canonical 最近 20 筆收盤價獨立計算 BOLL 下軌並依既有指標契約取 6 位小數，差異 0；本輪未宣稱所有 190 份均已做此獨立抽查。
- 最終候選以 SQLite readOnly adapter 封鎖 raw OHLCV SQL／任何寫入／所有網路呼叫後，仍能完成同一查詢；約 519 ms、23 次本機讀取。這不是整個系統的獨占流量或資源節省數字。
- 原頁面當時已由使用者改選外資條件並開啟 4961 圖表；本輪僅唯讀查看，未更改草稿、商品、圖表、清單或每日布林 profile。實際頁面點選布林的端到端操作未另代按；正式 API 與 Chromium 呈現分開列證。

## 回歸與品質

- Node24：4 檔 55／55，涵蓋舊版整合、v4 publisher、純技術分流、缺底稿、損毀、過期、immutable cursor、同鍵 no-op、零 GET 寫入／零 raw SQL。正式工作樹亦通過同一組 55 項。
- Vitest：3 檔 34／34；Chromium：3 檔 68／68，新增舊籌碼日期切換當日純布林、null 籌碼證據可解碼與零清單操作。
- Node24 前端 `tsc -b`、後端相關模組 strict typecheck（依現行設定開啟 allowJs）、Vite build 通過；既有 >500 kB chunk 警告保留。七份正式檔案與隔離驗證版本 SHA-256 一致。
- OpenSpec 全案 strict 69／69、`git diff --check`、本輪新增文字 whitespace 通過。沒有修改其他 active change 的任務或宣稱明日已驗收。

## 中間失敗與修正原件

- 初稿讀取 raw OHLCV 使用 OFFSET／全表排序，正式資料唯讀約 17.9 秒；改為既有索引 keyset 後約 2.2 秒。再次規格複核確認 GET 不應重算指標，最終改為上述背景封存＋GET 純讀取；短暫載入的第一版與其 HTTP／直接讀取證據均保留，不當成最終設計。
- 獨立公式驗證第一次使用過嚴的未取位 1e-8 比較，與既有指標封存 6 位小數產生最多約 4.98e-7 的差異；未改正式公式或放寬產品 Gate，改用原契約精度重驗後差異 0。原失敗報告保留。
- 隔離副本起初缺測試依賴／fixture／SHIOAJI_VERSION、Node test 放置於 top-level await 初始化之前，以及獨立 typecheck 未帶現行 allowJs，均如實修正後重驗。`--configLoader runner` 不支援本專案既有 `__dirname`；最後使用原標準 Vite build，未修改正式 Vite config。

## 安全前後比對

20:45–20:52 本輪前後：Web 971／API 56546／MultiView 977、simulation generation `simulation:92bd78f3-a5fb-4dd3-859e-4d5dae2db2bf` 相同；260 份保護檔（監控程式、兩案 artifact、LaunchAgent、明日授權／heartbeat、今日盤後 claim／receipt）hash 相同。監控設定 revision 55／3 倍／200 項、盤後 job loaded 狀態、HEAD 與 staged 均不變。

未手動重啟 API／watchdog／Web／MultiView；只依本輪授權載入選股修正。載入可能造成既有頁面／SSE 重連；未保存所有瀏覽器網路錨點，不能宣稱整個系統恰零重連／零訂閱請求。沒有主動 broker login／subscribe、選新商品或交易操作，不更動明日 10/16 動態驗收與盤後採集排程；不 commit／push。

私密證據：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/bollinger-position-20261015.G5mUxK/`。包含 before／after／final、原始與 frozen HTTP、cache-preparation、兩份獨立公式報告、候選及原始中間失敗證據；不納入公開來源資料。
