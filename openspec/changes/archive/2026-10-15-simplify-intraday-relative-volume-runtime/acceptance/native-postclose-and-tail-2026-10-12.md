# 2026-10-12 原生盤後基準、自動尾端核實及結案缺口

時間全部為 Asia/Taipei。16:47起唯讀讀取原程序收據與SQLite，沒有重跑採集、呼叫tail writer、修改原summary或另開broker連線。

## 原生採集及逐檔品質

- 原13:35程序PID96822；attempt-01 claim時間13:35:06.104，claimId `17f5fc71-7292-4f5d-b2ed-47b3e15a46c6`。第一輪16:14:25.930為159／160 partial，3017.TW `daily_minute_volume_source_failed`，320 requests／2,572,812 response bytes；原失敗保留。
- 同程序原15分鐘冷卻後的attempt-02於16:29:26.431 complete，160 ready、0 waiting、0 conflict，僅補3017一筆KBar，1 request／17,003 response bytes。159份合法manifest重用，不重抓。
- 原生10/12→10/13表格共160份；正式 `isDailyMinuteVolumeBaseline` 逐份驗schema、manifestId、payloadHash、symbol、source／target date，全數通過。TSE121／OTC39，每檔270個canonical分鐘，closeMode均為 `normal_or_revised_13_30`；無獨立收盤總量對帳仍明列 `not_observed`，不冒充v1雙抓／ticks或live成功。
- 正式LaunchAgent讀回13:35、Node24、`--scheduled`、runs4、last exit0；原14:15／14:55重試agent讀回runs8、last exit0。CalendarInterval descriptor是載入時段，不是OS提供的絕對next-fire timestamp，不把它假稱獨立next trigger證據。

## 中央預算與跨日鏈

今日08:20原生CAS的同帳戶來源重設、官方日曆、完整窗口、300MiB quote保留與v4政策已於上午核對；今天完整原生採集又驗證後續逐請求admission與有限冷卻可正常完成。中央帳本本週期 `monitor-minute-v2:` 共321筆charged、估量117,873,126 bytes、response 2,589,815 bytes，沒有此scope仍reserved／dispatched的未完成項目。其他消費者不混算。

完成後原程序保存16:29:26.616來源錨點usedBytes11,162,006、remainingBytes513,125,994、limitBytes524,288,000，generation同今日session。v4 quoteReserveBytes仍314,572,800、maxEstimatedBytes1,048,576、rateWindow60000／maxRequests2，沒有清舊帳、縮小quote池或重設原失敗。既有實測校準設定在新模式實際足額，沒有因本機回應量較小擅自降低安全估量；共享帳戶使用量不能當獨占節省率。2.5的原生排程及真實跨日驗證條件現已成立。

## 自動tail sidecar

原程序於16:29:26.564建立 `daily-run/2026-10-12/postclose-tail-reconciliation.json`，本輪僅讀取。其liveSummaryHash與原summary逐byte雜湊一致，collectionReceiptHash與原attempt-02穩定內容一致；兩檔source／target／manifest identity及原live重疊累積量成立：

| 商品 | live最後13:29累積張數 | 歷史13:30累積張數 | 歷史末分鐘增量 |
| --- | --- | --- | --- |
| 3665.TW | 2,120 | 2,260 | 140 |
| 6239.TW | 11,754 | 12,438 | 684 |

sidecar為 `postclose_verified_live_partial`、liveDelivered=false、liveAcceptance=false、notificationAuthority=false，沒有補寫live observation或追溯觸發。今天新的逐檔尾盤frame計數與此原生自動sidecar均已真實觀測；7.7可完成。新增gap診斷是後續候選補修，今日原收據仍沒有該欄位，不能宣稱來源丟包根因已修復。

## 發現的收尾語意缺口與候選修正

16:48 API實際 `dailyExecution.state=partial`、158 complete／2 partial、翌日ready160、notificationAuthority=false，然而頂層 `state=feature_off`、reason=`premarket_capture_failed`。根因是gateway只看到08:50原長時收據rolloverOutcome=failed，就把已成功啟動後的末分鐘partial分類為啟動失敗。原receipt的actualEndedAt13:34:35.828及完整summary證明這不是08:50沒啟動；不能修改該原收據以消除錯誤。

新增無副作用 `premarket-failure-classifier.mjs` 候選：只有同session／generation／cohort／日期與完整160商品身分、已接受啟動、合法完成時間一致時，不把daily terminal partial分類為startup failure；舊legacy、缺summary、錯日期／generation／cohort／session／時間仍拒絕。原真實檔案唯讀套入候選回傳null、原partial及failed收據未變，10項隔離回歸通過；不因此授予current、freshness、通知或live complete。

尚未接入現行gateway：該檔為Vite config相依，修改可能觸發5173重載及瀏覽器重新訂閱。本輪已提出一次受控5173重載的具體授權請求，未獲回覆前僅保留候選，不動正在運作的服務。因此跨日修復7.6不能提前稱UI/API全部通過。

上述為 16:48 當時狀態；後續使用者已允許一次受控重載，17:55 載入修正，真正 API／UI 不再誤標啟動失敗。原收據不變、158／160 live partial 不改判，詳見 [後續受控重載驗收](authorized-web-reload-2026-10-12.md)。

## 尚未完成

- 7.2：原生完整v2及逐檔品質已成立，但完整成功後的下一次同鍵no-op原生證據仍缺，不能把補件重用159份當成整批no-op，也不人工代跑`--scheduled`。
- 7.4：今日live仍158／160，上游末分鐘缺口仍未完全定位；保留原13:40 `coverage_incomplete`。當日完整性不因sidecar改判。
- 7.6：結案彙整先追加本文件，仍不得標完整結案。跨日修復另有收尾語意及scheduler next-trigger證據缺口，兩案不混算。

原件均在 `Application Support/RealTimeStock/IntradayMonitor/` 的daily-minute-volume-collection、daily-run、premarket、failure-audit-runs、broker-quota-reset-observations及SQLite；本輪沒有archive、commit或push。
