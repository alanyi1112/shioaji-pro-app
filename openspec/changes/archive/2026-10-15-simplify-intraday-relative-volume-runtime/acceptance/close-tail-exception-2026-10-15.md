# 10/15 收盤尾筆例外與盤後補算（正式驗證完成）

全部時間為 Asia/Taipei。本紀錄追加使用者新政策，不刪改14:05的失敗與原始收據。

## 16:47完成：日常運作通過，原live仍157／160

原scheduled13:35同一PID11434在16:29:23.551完成attempt02，160／160、waiting0／conflict0；原attempt01於16:14:23.092 partial159，3017來源失敗的原件保留。原第二次只下載3017的1筆KBar，17,119本機response bytes，重用159份；全日兩次合計321 requests／2,611,251本機response bytes，不是券商quota用量或精確節省率。

16:36逐份獨立驗證source10/15→target10/16的160份v2及前日160份，schema／manifest hash／固定cohort／日期／來源通過，TSE121／OTC39，共43,200封閉分鐘。closeMode全部normal_or_revised_13_30、known-zero補列0、closeTotalCheck=not_observed160；沒有宣稱已獨立成交總量對帳或觀測到13:33。13:35:05.235原生postclose日曆原文及hash重驗通過，官方共同次交易日10/16。

原程序真正產生`attempt-02-same-key-noop.json`，originTrigger=scheduled、originalOwnerPid=auditOwnerPid=11434、sameOriginalProcess=true，重新走collector已完成重用分支，追加下載0／reservation0，原claim／receipt hash吻合。不是人工補跑或第二個owner。

### 三檔獨立補算

16:36:44.985依本次授權發布`daily-close-tail-exception.json`，state=passed_with_close_tail_exception，assessmentTrigger=operator_after_original_collection。三檔13:29銜接量與原live相同，使用原final seal前已durable生效的journal revision18及逐檔1.5倍，不讀盤後新設定代替。

| 商品 | live 13:29累積張數 | 盤後13:30累積張數 | 前日13:30累積張數 | 尾筆增量 | 量比／1.5倍判定 |
| --- | ---: | ---: | ---: | ---: | --- |
| 2355.TW | 37,718 | 39,192 | 14,374 | 1,474 | 2.7265896758／符合 |
| 6191.TW | 5,730 | 5,925 | 8,336 | 195 | 0.7107725528／不符合 |
| 6449.TW | 3,149 | 3,211 | 6,147 | 62 | 0.5223686351／不符合 |

16:47以獨立BigInt交叉相乘逐檔再驗，差異0；同鍵再次執行為alreadyPresent=true，artifact原hash不變。在本機fetch設為立即拒絕的查核下，補算入口fetch calls0；不含collector／broker／SSE／subscribe／通知port，不寫入原observation或trigger。新原生hook已接入standalone complete及no-op之後，故障不撤銷baseline；今日原程序已載入舊程式，今日補算明確是operator，未冒充新hook自然觸發。

### 正式接線、畫面與副作用邊界

原採集完成且原件hash／來源guard均通過後，以已授權的一批12檔接線載入5173，沒有手動再呼叫整頁reload。正式API及原分頁顯示「日常運作通過（收盤尾筆例外）」、原live157／160、翌日160就緒及三列「盤後補算，不通知」。原summary executionOutcome=partial、08:50 failed、13:40 coverage_incomplete全部不改。

受控載入另揭露原前端只抓第一頁100筆，收尾後無lease便不會從SSE取得其餘145筆。已修正前端本機cursor讀取，32頁／20秒有界，跨頁generation／revision變動或cursor循環拒絕混合；無額外broker port。正式API三頁及畫面均245筆。前端局部更新沒有更改Vite config或要求重啟其他服務。原2449圖表載入後曾回到等待商品，已在既有分頁用商品跳轉僅恢復原2449／5m；未選新商品，自動跟隨維持關閉。原圖表畫面已恢復，不把圖表是否可見當背景驗收前提。

16:36前與16:46後的八份原summary／08:50／13:40／collection claim-receipt-noop hash、43,197 observation、245 trigger及其hash均不變。保存設定revision46／1.5及200項名單hash不變；它與收盤比較版本18刻意分離，沒有覆寫使用者盤後修改。盤後API raw state仍feature_off／config_revision_mismatch、current=false及通知權false；這是現行設定與已結束session的Gate，未被例外規則放寬，獨立產品判定照原收盤證據通過。

Web971／API83566／MultiView977與generation前後完全相同；simulation、2330 business Snapshot、watchdog healthy／restart0、production stopped及write master disabled核實。沒有重啟這些服務或另開採集／行情owner。瀏覽器載入可能重接原本機頁面SSE及既有商品；本輪缺完整HAR，不能宣稱自動reload恰一次、既有訂閱重要求0或全系統零HTTP。console保留extension connection錯誤及原React未歸因限制，不以空捕捉稱全頁零error。其他MultiView盤後資料及smart-order readiness仍有各自partial／未就緒，本案不代表全系統驗收完成。

### 回歸、完整dossier與可結案範圍

正式工作區24項Node24補算、48項Vitest API／entry／view-model、5項分頁及25項Chromium面板，共102項通過；Node24 tsc -b／Vite build通過，保留既有chunk大小警告。strict／diff及新增文字whitespace納入最終檢查，不archive／commit／push。

7.1安全啟用、7.2原生基準與同鍵、7.3真實跨日來源、7.5 HTTP／資源限制及8.6盤中門檻證據沿用既有完整紀錄；7.4依本次明確授權政策由今日安全全日真實前綴及三檔完整補算成立。7.6以本文件、verification、runbook與四案矩陣彙整；舊10/7／10/8／10/12各158／160、10/13設定故障、10/14換代失敗均保留，不追認。跨日修復、動態名單、晚開機、舊尾端復原四案不自動勾選或歸檔。

私密實證根目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/close-tail-integration-20261015.q3SUiX/`，含before／after-verification.json、final-verification.json及ui-after.jpg／ui-rows.jpg。完整例外artifact位於正式`IntradayMonitor/daily-run/2026-10-15/daily-close-tail-exception.json`。

最終102項聚焦回歸、Node24型別／build、change strict、git diff --check及21份本輪文字whitespace全部通過；tasks55／55，依新授權政策可結案。未歸檔／commit／push，四案原checkbox與本機排程／服務保留。結案追蹤完成後停止其Codex heartbeat，不影響原生08:20／08:35／08:45／08:50／13:35／13:40排程或明日基準使用。

- 原complete receipt SHA256：`bf438489a071ca9676f38c279d85bc57e008b8cf33f79257102e64fbed0cab87`。
- 原scheduled no-op SHA256：`b078d310a17cd43051c279d171db8c6d6890a3002a7f89ef01e205cccc397806`。
- 例外evidenceHash：`66ab2c3a9b2e56ead6612e84ea78724b018db366d7c9d42cdfc89260c76e5ab6`。
- 例外artifactHash：`2d59901dd4d4461054486ad752e4e82723e8ece8d03e0312181c4b0be5fd02c9`；原檔SHA256：`25c381585abbf345fe0bbc735a0f823181705720d67d93386b7643a76ba29891`。
- 原245筆trigger內容hash：`41ec602b832d74c1878196081e466d026bc4451ae882ae7ddda1a4d3909597a8`。

## 以下為此前候選與等待紀錄（保留當時狀態）

## 已授權的政策及載入邊界

使用者授權原change新增「最多10／160檔、只缺canonical 13:30尾筆」例外。所有商品09:01–13:29的269分鐘必須是真實、完整、連續的live來源；其餘商品各270分鐘。盤中缺口、兩分鐘缺漏、超過10檔、來源gap／斷線／資源／健康／比較故障或身分不明仍拒絕。完整160份盤後及前日v2重驗、13:29銜接量與收尾時durable門檻均核實後，才取得「日常運作通過（收盤尾筆例外）」。

原live partial、08:50 failed及13:40 coverage_incomplete保留；不宣稱live complete或上游根因已修復。盤後列標postclose_verified、liveDelivered=false、liveAcceptance=false，無補發通知／下單權限，不寫入原observation或trigger。

已取得使用者明確授權：「允許，原採集完成後載入一次」。此授權目前尚未執行。先等真正原13:35採集完成，再一批接線及受控載入5173；8080、watchdog、5174、券商session與原採集程序不動，不新增商品或訂閱，不另開下載器。

## 隔離實作與已完成回歸

候選目錄：`/private/tmp/intraday-close-exception.k6yakr`。正式runtime／API／UI尚未改動或載入。

- 純政策與read-only SQLite補算：驗160份當日／前日v2的schema、日期、manifest hash、cohort、來源、13:29累積量；從不可變threshold journal選取final seal前真正已生效版本及個別覆寫，以BigInt整數公式判定，分母零列不可比較。
- 獨立`daily-close-tail-exception.json`使用wx／0600，不覆寫同鍵；相同證據no-op，不同證據拒絕。完成或拒絕各有可核實狀態；損壞不能假通過。
- standalone盤後入口只在原collector complete及同鍵查核後呼叫補算；補算故障不得撤銷baseline complete。獨立操作者CLI只讀完成原收據，沒有collector／HTTP／broker port。
- API保留原partial，驗artifact與160份原coverage後才呈現獨立產品判定；UI分列原live157／160、盤後補算列、門檻／版本／量比與不通知，未插入原即時結果。
- 24項Node24補算測試通過：1／10檔可通過、11檔拒絕、中段／兩分鐘／來源／hash／銜接量／設定等故障拒絕、個別覆寫、durable切換後門檻、零分母、SQLite不可變性及同鍵／損壞／偽造原claim拒絕。
- 48項Vitest通過：API正反向、原盤後入口的非干擾與既有view-model回歸。
- 24項Chromium隔離面板測試通過，包含原157／160與盤後3列分流、零音效／通知及無新增訂閱／登入／交易請求。
- Node24型別與隔離Vite build通過，保留原有chunk大小警告。規格strict及正式工作區git diff --check通過；正式接線後仍須檢查新增文字及最終差異。

這些是候選／fixture證據，不等於正式產品已通過。9.2–9.6、7.4及7.6目前均未勾；正式tasks為48／55。

## 今日真實前置查核

15:53原PID11434仍是原13:35 scheduled程序。15:51附近正式基準134／160，尚無完整receipt；此數字僅是當時進度，不是完整ready或採集失敗。未中止、重跑或另建owner。

以新純政策讀原summary、session、read-only observation及journal，43,197份真實live前綴與來源／安全Gate已通過前置檢查；因原完整基準收據未到，評估正確為pending_postclose／complete_baseline_required，未發布例外收據。原缺漏2355.TW、6191.TW、6449.TW各269筆至13:29。

15:53逐檔抽核：6449.TW盤後13:29累積量3149與live3149一致，13:30為3211；2355／6191當時尚未發布，未以其他日期替代。這不是三檔完整補算通過。

## 原採集完成後的已授權接續

私密接線交接目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/close-tail-integration-20261015.q3SUiX/`。包含12個檔案的一批`approved-integration.patch`及`source-guards.json`；補丁仍須以最後guard hash版本核對，不直接信任舊候選內容。任何正式檔案與guard不同先保留並合併差異，不覆蓋其他dirty work。

16:00:38最後查核：原程序仍PID11434，正式145／160、尚無任何attempt完成receipt；原summary／08:50／13:40／collection claim四份hash均與14:05錨點一致，Web971／API83566／MultiView977未變。私密補丁最終SHA256為`fec10c2d45178b2125bd04ae96dfbf65676f39e703e7378a99aa109de3ed585c`，與guard相符；12檔正式來源衝突0。既有主heartbeat已更新新政策、最新tasks與已授權接線步驟，仍沿用原每日08:05／09:05／14:05／17:05，不另建下載或五分鐘輪詢。

1. 核原PID11434的真正complete receipt、claim、160份source10/15→target10/16、270分鐘、來源／hash／品質、原生日曆與same-key-noop；原partial attempt保留。只有筆數160不夠，不代跑原collector或audit。
2. 核原summary、08:50 receipt、13:40 audit與13:35 claim仍與`Acceptance/intraday-close-20261015.PwZAwc/audit.json`的originalHashes一致；保存服務／generation、設定／名單／245筆原trigger的接線前錨點。
3. 原採集真正完成後，核最新guard並以apply_patch一批接入正式12檔，再依本次已授權受控載入5173一次。避免以程式啟停服務，不擅動8080／5174／watchdog或選新商品。
4. 執行僅衍生補算的`assess-daily-close-tail.mjs --source-date 2026-10-15`，不執行postclose下載入口；今日標operator_after_original_collection，未來原入口自然標scheduled_after_original_collection。核三檔當日／前日、13:29銜接、durable revision18（若journal有新資料仍以final seal有效版本為準）、13:30整數公式、零通知／新broker請求及原件未變，再重入唯讀補算核同鍵no-op。
5. 核正式API與既有頁面，同時保留157／160原live與例外產品通過／三檔盤後結果；不能以API200或fixture畫面替代真實資料。若有拒絕／損壞如實記錄，不硬勾任務。
6. 實證完整才更新9.2–9.6、7.4及7.6、verification／runbook與四案矩陣；不自行archive／commit／push。原13:40稽核仍保持coverage_incomplete。
