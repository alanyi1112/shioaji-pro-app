## Why

目前 RealTimeStock 只能由使用者逐檔觀察盤中成交量，無法針對一組指定商品，持續比較今日與上一交易日同一時間點的累積成交量並即時提示異常放量。全市場即時監控又受 Shioaji subscription 計數維度、現有行情 ownership 與本機 gateway 容量尚未證實等限制，因此需要先建立可設定、可量測、會在資源或資料不完整時 fail closed 的限定範圍試辦。

## What Changes

- 新增「盤中監控」設定能力，讓使用者以搜尋、批次貼上或從既有清單匯入方式管理最多 200 檔候選商品，並可設定全域或個別的 1.5、2、3 倍或合法自訂量比門檻。
- 將「已設定候選數」與「實際啟用監控數」分開；最多仍可設定 200 檔，但本 change 的 simulation 試辦固定只取排序前 20 檔，透過既有 `subscribe/kbars` 單一多商品 request 與專用 KBar SSE 連線監控，不輪替、不在同一 session 回收後補位，也不宣稱已證實 Shioaji physical subscription 計數或 200 檔同時啟用。
- 新增常駐、可重播的盤中分鐘累積量記錄與基準完整度狀態；只用最後一個已完成交易分鐘，比較今日與上一個適用交易日的同分鐘累積成交量，基準缺漏、分母為零、來源過期、亂序或單位不明時不得觸發。
- 新增「盤中選股」完整交易終端新分頁，安排盤中監控、即時達標結果與 K 線圖面板；只有該頁持有有效 lease 時才進行比較、結果推送與通知，關頁後釋放頁面 demand，但不以關頁中斷合法的基準記錄生命週期。
- 達標商品以可稽核的首次觸發事件加入即時結果清單；同一交易日與門檻層級不得重複通知。頁面較晚開啟時可補算當日已完成分鐘並標示歷史觸發，但不得補發聲音或系統通知。
- 點選結果只連動同一「盤中選股」分頁內指定且未鎖定的 K 線圖；結果卡右上方提供獨立「加入清單」動作，將合法商品冪等加入名稱精確為「盤中選股」的自選清單，不隱性切換清單或改動交易草稿。
- 建立盤中監控專用的 bounded KBar batch transport；它只管理自己建立的一個 SSE 與最多 20 檔固定 cohort，不接管、重排或推論 chart、watchlist、alert、smart order、MultiView 及外部 client 的既有 subscription。禁止用 Snapshot、ticks 或 Kbars 輪詢及輪替監控代替即時 KBar 串流。
- 新增 shadow recording、離線重播、盤中 dry run、20 檔固定 cohort 護欄、資料完整度與 UI 驗收證據；收盤 recorder 必須涵蓋台股個股可能延後至 13:33 撮合的規則，在沒有可信逐檔延後旗標時保守維持整批訂閱至 13:33 後的有界寬限期。功能驗收以「一個完整盤中日＋上一個適用交易日的可信基準」為必要條件；可信基準可來自完整 live capture，或經嚴格驗證的正常歷史 1 分 K。第二個完整盤中日改列非阻擋的穩定性追蹤，不再作為功能核准或歸檔的必要條件。本 change 僅涵蓋本機 simulation 環境，不啟用 production、真實下單、雲端持續監控或正式站部署。
- 將完整盤中驗收日改為同日三件式 contract：KBar capture、既有頁面的被動 K 線新鮮度 evidence、runtime assurance 必須同日齊全且逐一通過；10:00 後缺少被動證據即告警，13:34:30 後任一缺件即固定為該日不可作為完整盤中驗收日，不得只以 capture 成功宣稱功能驗收完成。capture 本身若完整，仍可獨立作為下一交易日的可信 live baseline。
- 強化完整日 capture 工具：20 檔 × 270 分鐘 evidence 使用專用且有界的 canonical hash 容量，主 evidence 採原子 exclusive create；最終化失敗則另存 immutable `.failure.json`，固定拒絕 baseline／live acceptance。背景執行改用明確 `KeepAlive=false` 的 one-shot LaunchAgent，不得在錯過開盤後重複 subscribe 或無限重啟。
- 新增「收盤後驗證式歷史 1 分 K 回補」：盤中中斷仍立即逐檔標為 partial／degraded 並停止新判定；最早於該交易日 13:34:30 收盤定稿後，才可一次性取得歷史資料。只有交易日、商品、時區、來源版本、單位、欄位結構、分鐘連續性、live 重疊、收盤總量、13:30／13:33 收盤語意及重抓 payload hash 全部逐檔通過者，才可保存 immutable manifest 並升格為 `historical_repaired_verified`，供下一個適用交易日作 baseline。回補成功不得補發中斷當天 trigger／通知，也不得冒充完整即時串流驗收日。
- 新增正常冷啟動的「前一交易日歷史 1 分 K 驗證基準」：當上一交易日沒有完整 live baseline 時，可在前一交易日收盤定稿後、下一交易日比較開始前，對固定 cohort 逐檔執行有界 fetch／refetch、完整分鐘與收盤量對帳、13:30／13:33 canonicalization、來源與 payload hash 穩定性驗證。全數通過的商品才可保存 immutable manifest、標示 `historical_baseline_verified`，並只供緊接的下一個適用交易日作 baseline；不得產生歷史 trigger 或通知，也不得冒充 live capture evidence。

## Capabilities

### New Capabilities

- `intraday-relative-volume-monitor`: 規範可設定監控名單、盤中分鐘累積量、上一交易日同分鐘基準、量比判定、通知去重、subscription 容量治理、fail-closed 狀態及分階段試辦證據。
- `intraday-stock-selection-workspace`: 規範「盤中選股」新分頁的 viewport-safe 版面、監控與結果互動、頁面 lease、K 線連動，以及加入名稱精確為「盤中選股」自選清單的安全邊界。

### Modified Capabilities

- 無。既有收盤後選股、「選股」自選清單、MultiView 與智慧單規格保持原語意；新需求由獨立 capability 擴充。

## Impact

- 前端將新增盤中監控設定／狀態／結果 UI、專用 workspace 啟動入口、頁面 lease、通知權限與 K 線 target 協調，並擴充自選清單寫入流程以支援獨立的「盤中選股」清單。
- 本機 RealTimeStock sidecar／gateway 將新增監控名單、bounded KBar batch、分鐘聚合、交易日基準、觸發事件與狀態查詢介面；不需要修改已安裝的 Shioaji HTTP server，也不要求把需求提交到上游 repo。
- 需要本機持久化非敏感的監控設定、分鐘觀測、基準完整度與觸發稽核資料，並定義版本、來源、單位、交易日與 retention／清理規則。
- 需要新增逐商品 immutable historical baseline／repair manifest、monotonic revision 與 conflict detection；`baselineUsable=true` 與 `liveCaptureAcceptance=false` 必須可同時成立，且不得由歷史基準或回補流程取得通知、production、broker write 或服務生命週期權限。
- 需要覆蓋 domain、API、重播、斷線重連、bounded transport、瀏覽器互動與 accessibility 的測試，以及固定 20 檔 cohort、實際收到分鐘棒的 active 數與未知 provider physical usage 分開記錄的實機 simulation 證據。
- 不修改 broker write、委託、持倉、帳務、production 模式、遠端 Cloudflare／Sites 功能或既有盤後選股資料管線。
