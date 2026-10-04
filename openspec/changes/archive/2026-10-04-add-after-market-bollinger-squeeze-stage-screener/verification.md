# 第一階段實作驗證（2026-10-03）

## 10/4 到期前真實流量政策複核（49／49）

使用者明確授權後，11:43核對原校準、simulation business-session、真實usage、保守帳本與最新基準配置；保存原政策及複核 proof，CAS 更新效期至 **10/10 23:59:59 Asia/Taipei**。保護池／基準保留／舊債不變，扣除後可用20,286,624bytes。正式 admission 通過，只釋放本輪確定未 dispatch 的測試保留，沒有歷史下載／login／subscription／交易；原 profile／head／failed 完整 hash 不變。62項相關回歸、strict validation／whitespace通過。原10/5到期阻礙已排除，但不以今日複核冒充未來排程或資料取得成功。詳見 [政策複核](acceptance/budget-policy-review-2026-10-04.md)。下方各時點紀錄保留，未歸檔／commit／push。

## 10/4 使用者要求完整重驗（47／47，另列明日政策到期風險）

重新以唯讀持久資料獨立重算 1977 檔／316320 日期點，原160日、320市場日及16筆分類全部一致。修正長窗查詢 `history_pending` 但 `canUseResults=true` 導致正式 decoder 拒絕的缺陷，以及完整 rowsHash 驗證的大型字串／UTF-8 中間配置成本；不改 hash、公式、日期或略過完整性檢查。509 項程式回歸、39 項 Chromium、build／型別通過，真正 API／畫面與 unknown 分頁正常，原草稿／清單／profile／head 保持或復原。原失敗不刪。**目前流量政策明天10/5 14:00到期，與下一策略時點一致；到期後拒絕新下載，明日無人值守執行尚需政策複核，不拿今天驗收冒充已排除。** 詳見 [完整重驗](acceptance/reacceptance-2026-10-04.md)。未歸檔、commit 或 push。

## 10/4 最終網路與安全驗收（47／47，可結案）

已保存主工作區指定 2408 日 K 及獨立選股頁雙清單的真實 HAR，分別 352／6 筆；修正後兩次實際查詢 HTTP 200、圖表／清單成功，快取重選及清單操作沒有額外 subscription／login／下單請求。原清單、三項草稿、IX0001 5m 與全螢幕已精準還原，profile revision1／hash 及原自動發布 head 不變。補強大量 primitive 陣列 canonical 序列化，hash 與原語意一致；50 Vitest＋30 Node、最終 build／型別通過，歷史 503／0 bytes HAR／既有帳務 400 保留。完成 7.4／8.8，詳細 counts、原件 hash、成功／失敗／unknown 與限制見 [最終驗收](acceptance/final-network-and-closeout-2026-10-04.md)。下方各時點紀錄保留，不代表最新進度。尚未歸檔、commit 或 push。

## 10/4 已授權 2408 圖表與雙清單操作（45／47，仍缺完整網路紀錄）

使用者允許的有界操作已執行：2408 指定日 K 載入、雙清單成功、只移除本輪新加 MultiView 2408.TW、原 13／6 項清單及三項草稿／IX0001 5m 已復原，正式 profile／head 未變。修正同一底稿重複驗證造成的 gateway 逾時，34 Vitest＋30 Node、build／型別通過，原 HTTP 503／非 JSON 診斷及匯出失敗保留。共享 broker connections 1／stream healthy 不等於本輪請求 counts；完整 HAR 尚未保存，7.4／8.8 不勾，也不再重複使用兩筆訂閱預算。詳見 [有界授權操作驗收](acceptance/authorized-chart-and-list-2026-10-04.md)。

## 10/4 指定圖表與清單預檢（45／47，等待有界操作授權）

09:42–09:49 使用既有 Chrome 驗證布林真實結果、還原原三項草稿及查詢，未改每日 profile／head、圖表商品或兩套清單；既有共用串流 identity／portCount 不變。指定圖表的合約解析含分頁內自動 Tick／BidAsk 訂閱，其他頁已有商品不能保證此頁零訂閱請求，故在點選前停止並提出 2408 的有界驗收方案。7.4／8.8 保持未勾，不能把預檢或舊隔離 network counts 當完成。詳見 [圖表及雙清單預檢](acceptance/chart-and-list-preflight-2026-10-04.md)。

## 10/4 真正自動發布與全市場查詢修復（45／47）

09:11 原 watcher 在既定冷卻後核實官方全日休市公告，排除 7/10、僅新增 2/2 合法依賴；09:11:47 自動發布 160 日／320 市場日期、1,977 檔不可變報告，後次自然輪次同鍵休眠。320 份 manifest／316,320 商品日期點及全部分類的唯讀獨立重算通過，原 158 failed／7/10 十八次失敗均保留。真實 UI 曾遇 metadata 重複 JOIN／D1 參數超限的 HTTP 503，已以分批唯讀查詢修正並保存失敗與 red→green 回歸，現真實 API／UI 正常顯示 16 檔（壓縮 14、準備 1、突破 1），unknown 61 誠實保留。Node 41／41、Vitest 45／45、型別／build 通過；完成 7.2／7.3／10.4，指定圖表與雙清單端到端操作尚未完成，7.4／8.8 不勾。詳見 [真正發布及讀取規模驗收](acceptance/live-publication-and-reader-scale-2026-10-04.md)。下方各時點原始失敗與限制保留。

## 10/4 臨時全日休市修正（42／47，待自然新窗口）

使用者指出 7/10 颱風休市後，已以真正 TWSE 公告驗證年度表遺漏臨時休市的根因，實作版本化公告優先、有界快取／租約與原文／重規劃收據，保持原年度表、18 次來源失敗及 158 failed hash 不變。真實唯讀重算排除7/10、首日由2/3延伸至2/2，仍160日；不以手動計畫冒充 watcher 完成。新入口曾因個股復牌標題誤擋，已修正並保留08:51原失敗／09:11:13.201冷卻，後次自然觸發須再核對。76 Node＋44 Vitest＋13 Chromium、型別／build 通過，TPEx-only公告自動辨識仍有界限，10.4及原四項live保持未勾。詳見 [臨時全日休市修正](acceptance/calendar-closures-2026-10-04.md)。下方較早紀錄原樣保留，不將當時的unknown抹成早已確認。

## 10/4 凌晨背景續跑（39／43，尚待完整窗口）

08:07 唯讀 snapshot 確認 **159／160 日、318／320 市場日期**，318 份 complete manifest 獨立核對通過；7/10 第十八次自然嘗試仍回 102 bytes 空批次，正式狀態已為 `source_attempts_exhausted`／nextAttemptAt=null，**等待冷卻不能再自動補齊**。原失敗與末次期限保留，不增加上限或重設嘗試。補上面板繁體中文「停止自動重試、資料保留、須排除來源缺口」訊息；新增 Chromium 回歸先 red 後全檔 **10／10** 通過，另 132 Node＋48 Vitest、型別／build 通過。來源根因尚未確認；正式官方來源 review 仍 pending，不能擅自改成 verified、推論休市或用較早日替換。publication=0、四項 live task 未勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

07:44 唯讀 snapshot 仍為 **159／160 日、318／320 市場日期**；318 份 complete manifest 獨立核對通過。7/10 第十七次自然嘗試仍回 102 bytes 空批次，原失敗與 07:49:24.326 冷卻保留，尚未耗盡 18 次上限。132 Node＋48 Vitest、兩專案型別／build 通過；publication=0、四項 live task 未勾，沒有人工下載或重設嘗試。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

07:27 唯讀 snapshot 仍為 **159／160 日、318／320 市場日期**，318 份 complete manifest 獨立 hash／逐列核對一致。7/10 保留第十六次空批次失敗與原 07:28:57.847 冷卻；實際 state 已正確回傳該期限，原 158 failed hash 不變。132 Node＋48 Vitest、兩專案型別／build 通過，publication=0、四項 live task 未勾，沒有人工下載或調整來源預算。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

07:04 唯讀 snapshot 確認 **159／160 日、318／320 市場日期**，318 份 complete manifest 獨立核對通過；僅 7/10 尚缺，不宣稱已發布。另重現並修正快取冷卻重讀漏回 `nextAttemptAt` 的診斷缺陷；07:09 原 watcher 自然觸發後，實際 state 正確顯示第十六次失敗的原 07:28:57.847 期限，沒有改冷卻／嘗試／收據或送額外請求。132 Node＋48 Vitest、型別／build 通過；來源仍回空批次，四項 live task 保持未勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

06:46 同一唯讀 DB snapshot 核對原 watcher 已備 **156／160 日、312／320 市場日期**，312 份完整 manifest 獨立 hash／逐列核對一致。7/10 第十四次自然來源嘗試仍為 102 bytes 空批次，原失敗與冷卻保留；必要窗口未完整，publication=0、四項 live task 未勾。131 Node＋48 Vitest、型別／build 通過，未人工下載或調整預算／profile。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

06:23 同一唯讀 DB snapshot 核對原 watcher 已備 **149／160 日、298／320 市場日期**，298 份完整 manifest 獨立 hash／逐列核對一致。7/10 第十三次自然嘗試仍為空批次，原收據及冷卻保留；雖已取得日期數超過公式最低 145 日，必要窗口仍缺日，不能冒充完整。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

06:03 同一唯讀 DB snapshot 核對原 watcher 已備 **142／160 日、284／320 市場日期**，284 份完整 manifest 獨立 hash／逐列核對一致。7/10 第十二次自然來源嘗試仍回空批次，原失敗及冷卻保留，其他日期正常有界推進。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾；沒有人工下載或改動預算／profile。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

05:43 同一唯讀 DB snapshot 核對原 watcher 已備 **135／160 日、270／320 市場日期**，270 份完整 manifest 獨立 hash／逐列核對一致。7/10 仍為第十一次空批次後冷卻，原失敗 hash、預算保留及 simulation 安全 Gate 不變。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

05:27 同一唯讀 DB snapshot 核對原 watcher 已備 **129／160 日、258／320 市場日期**，258 份完整 manifest 獨立 hash／逐列核對一致。7/10 第十、十一次自然來源嘗試仍回空批次，原收據及冷卻保留；其餘日期有界推進，未人工補跑。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

05:03 同一唯讀 DB snapshot 核對原 watcher 已備 **121／160 日、242／320 市場日期**，242 份完整 manifest 獨立 hash／逐列核對一致。7/10 仍為第九次空批次後冷卻，原失敗 hash、預算保留與 simulation 安全 Gate 不變。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

04:47 同一唯讀 DB snapshot 核對原 watcher 已備 **115／160 日、230／320 市場日期**，230 份完整 manifest 獨立 hash／逐列核對一致。7/10 第八、九次自然來源嘗試仍為空批次，新增失敗與冷卻均保留；不人工補跑或改日期。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

04:23 同一唯讀 DB snapshot 確認原 watcher 已備 **107／160 日、214／320 市場日期**，214 份完整 manifest 獨立 hash／逐列核對一致。7/10 仍為第七次空批次後冷卻，原失敗 hash、預算保留與安全 Gate 不變。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

04:08 同一唯讀 DB snapshot 核對原 watcher 已備 **101／160 日、202／320 市場日期**，202 份完整 manifest 獨立 hash／逐列核對一致。7/10 第七次自然嘗試仍為 `source_not_published`，原收據與 04:24:53.025 冷卻保留；未人工補跑或修改日期。131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

03:43 同一唯讀 DB snapshot 核對原 watcher 已備 **93／160 日、186／320 市場日期**，186 份完整 manifest 獨立 hash／逐列核對一致。7/10 仍為既有空批次等待，原失敗／預算／安全狀態保留；131 Node＋48 Vitest、型別／build 通過，publication=0、四項 live task 未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

03:26 同一唯讀 DB snapshot 確認原 watcher 已推進 **87／160 日、174／320 市場日期**，174 份完整 manifest 獨立 hash／逐列核對一致。7/10 第五次自然嘗試仍為空批次，新增失敗保留、最早下一次 03:44:15.826；來源根因尚未確認，不人工補跑或移除日期。131 Node＋48 Vitest、型別／build 通過；publication=0、四項 live task 未勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

03:04 原 watcher 已推進 **80／160 日、160／320 市場日期**；160 份完整 manifest 在同一唯讀 DB snapshot 獨立核對一致。7/10 第四次自然來源嘗試仍為空批次，原失敗保留、最早下一次 03:23:55.910；沒有人工補跑或放寬日期。131 Node＋48 Vitest、型別／build 通過，發布仍為 0、四項 live task 未勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

02:43 原 watcher 已推進 **73／160 日、146／320 市場日期**，146 份完整 manifest 獨立核對一致。7/10 第三次自然來源嘗試仍回空批次，新增失敗與原兩份分列，最早下一次 03:03:36.427；其餘日期持續有界準備。131 Node＋48 Vitest、型別／build 通過，發布仍為 0、四項 live task 不勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

02:23 原 watcher 已推進 **66／160 日、132／320 市場日期**，132 份完整 manifest 獨立核對一致。7/10 依既定冷卻自然重試仍回空批次，原兩份失敗保留、最早下一次 02:43:20.038；沒有推論休市或人工補跑。131 Node＋48 Vitest、型別／build 通過，發布仍為 0、四項 live task 未勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

02:03 原 watcher 已取得 **59／160 日、118／320 市場日期**；118 份完整 manifest 獨立核對一致，但 7/10 的實際來源請求回空批次，新增 `source_not_published` 原失敗收據並保留至 02:23:02.939 的冷卻。這是來源缺口，不以後次 `broker_rate_limited` 概括成全輪成功或推論休市；原因仍待自然重試與正式來源證據。131 Node＋48 Vitest、型別／build 通過，四項 live task 不勾，詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

01:42 原 watcher 已推進至 **52／160 日、104／320 市場日期**，104 份完整 manifest 獨立 hash／逐列數核對一致；原失敗 hash、profile revision 1、publication=0 與安全／預算保留狀態不變。131 Node＋48 Vitest、型別／build 通過；沒有人工下載或提前勾四項 task。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)，較早紀錄保留。

01:22 原 watcher 已推進至 **44／160 日、88／320 市場日期**；88 份完整 manifest 獨立 hash／逐列數核對一致，publication=0、原失敗 hash 與預算／安全 Gate 不變。原 log 確認同一 watcher 輪次的下載與後續限流是不同 capability runId；新增更正說明並保留原紀錄。131 Node＋48 Vitest、型別／build／strict 通過，四項仍未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

01:02 原 watcher 已推進至 **36／160 日、72／320 市場日期**；01:03 唯讀獨立 hash／逐列數核對 72 份完整 manifest 全部一致。publication 仍為 0，原 158 failed hash 不變；預算保留與 simulation 安全 Gate 正常。131 Node＋48 Vitest、型別／build／strict 通過，沒有人工下載、修改功能或提前勾 task。接續紀錄見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)，較早觀察原樣保留。

00:42 原 watcher 已推進至 **28／160 日、56／320 市場日期**；新增的完整 manifest hash 核對全數通過，publication 仍為 0，原失敗 hash／預算保留／runtime 安全狀態不變。正常背景續跑，未提前勾四項 live task；接續紀錄仍見下方同一 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)。

00:26 原 watcher 已推進至 **22／160 日、44／320 市場日期**，profile revision 1、publication=0。唯讀獨立重算 44 份 manifest／rows hash 全部一致，原 158 failed 收據 hash 不變；預算保留與 simulation 安全 Gate 正常。131 Node＋48 Vitest、兩專案型別／build／strict 通過；本輪不新增下載器或修改功能程式，四項正式完整窗口／發布／ready UI 驗收保持未勾。詳見 [10/4 背景續跑](acceptance/background-continuation-2026-10-04.md)，原紀錄保留。

## 最新接續：持久保守帳本與真正背景續跑（39／43）

使用者同意後完成 8.4：正式 v3 政策不偽造 broker quota epoch，持久保存身份／counter 分段累積／所有舊預留；真實基準 forecast 85,667,193 bytes 保留，加可設定 300 MiB 保護池。未逐請求中央協調的用途明列限制，不虛稱全部已接線。23:18 啟用正式 profile revision 1，既有 watcher 自動完成 10/2／10/1，四份市場日 manifest；尚非 160 日或自動發布完成。

另重現並修正全域限流逐日期污染 pending／冷卻的缺陷，原 158 failed 收據與既定冷卻保留；實際 UI 明示已備 2／160 日、資料保留與台北最早重試時間，不再誤稱完全未下載。149 Node＋9 Chromium、型別／build 通過，原 chunk 提示保留。真實 runtime healthy／simulation／production stopped／write master disabled，使用者原三項草稿已還原、每日 profile 未由瀏覽器改寫。四項真實全窗口／發布／ready APIUI 驗收仍未勾；本串後續 heartbeat 已核對實際下一觸發，不取代資料 watcher。證據見 [保守帳本與 watcher 驗收](acceptance/local-conservative-ledger-and-watcher-2026-10-03.md)，下方前階段失敗與限制原樣保留。

23:51 真實 current state 已由原 watcher 推進 **8／160 日、16／320 市場日期**，publication 仍為 0。23:52 實際 UI 正確顯示準備進度及 `broker_rate_limited`／台北重試期限；23:53 原三項草稿還原、查詢完成、圖表沒有切換、console warn／error 為空。原 158 失敗收據 hash 不變；尚未完成的四項保持未勾。

## 最新接續：金額一元政策與來源契約（38／43）

使用者確認後完成金額絕對差 ≤1 元的新版本政策，原 30 筆真實差異全部重核對通過，舊 conflict／raw／凍結值保留。兩日期全普通股 3,954 筆中 3,865 可核對、89 unknown；來源契約 Shioaji verified、未採用的 TWSE／TPEx 網站入口各自 pending，完成 1.1／8.1／9.2，不能當 160 日或正式發布完成。另修正正式 universe envelope 解析及正成交統計但四項 OHLC null 的 v2 mapping；舊 mapping／partial 不改寫。182 Node＋66 Vitest＋8 Chromium focused tests、型別／build 通過，chunk 大小提示及初次型別失敗記錄保留。

8.4 仍缺可信額度週期及其他工作真實承諾接線，不虛填零或用診斷保留池冒充。7.2／7.3／7.4／8.8 尚未成立，profile／publication 未啟用。完整證據與限制見 [本輪來源契約及金額核對](acceptance/source-amount-tolerance-and-contract-review-2026-10-03.md)。

## 最新接續：預算 producer 與來源邊界（19:06，仍為 35／42）

- 接續 8.4：v2 逐已登錄工作讀取 hash／scope／quota 身份一致的新鮮承諾，以來源最舊觀察時間計算 freshness；缺項／過期不當零、不虛填現在時間。只接唯讀 producer，未改既有盤中監控／回補工作的生命週期或預算 writer。
- 回歸先重現三項失敗，修正觀察時間誤當條款修訂與 quota identity 未綁定問題；新條款 fingerprint 保護額度與證據，舊保留不覆寫。隔離 Node 11 files **153／153**、Vitest 8 files **96／96**、Chromium 2 files **32／32** 通過；前端／MultiView 型別及 build 通過（既有 bundle >500 kB 提示保留）。
- 18:59:42 真實本機唯讀 UI：5 GET、0 非 GET／blocked／console／page error，profile=null、results 為 `v8_preparation_pending`；正式新來源／歷史／profile／publication／reservation 筆數都為 0。不能把 pending 畫面或隔離 fixture 當正式發布驗收。
- 來源文件已查證：政府開放資料授權明列每日最新資源；歷史日期入口的自動下載適用範圍不能直接沿用。永豐證券 API 同意書與公開 daily_quotes 文件尚未提供足以核實本帳戶歷史篩選／展示範圍的獨立確認，本輪不代簽、不對外詢問、不寫 verified review。
- 整項 8.4 仍缺實際各工作 receipt writer、完整 roster、可信當前 quota epoch 與兩次分別觀察的真實估量；1.1／8.1／7.2–7.4／8.8 同樣未勾。詳細成功、限制、來源連結與操作錯誤保留於 [預算 producer 接續](acceptance/budget-producer-and-source-boundary-2026-10-03.md)。

## 最新接續：成交量來源容差（35／42）

- 使用者確認 ≤1% 規則已以官方量分母／BigInt 整數交叉乘法實作，包含等號、雙零特例，其餘欄位與缺漏／來源 Gate 維持嚴格。2330 歷史一股差異的純函式重算通過，未重新下載或改原值。
- append-only 新政策比較、唯讀 API／UI 容差提示與原值 evidence 已完成；舊 strict 衝突／失敗收據及凍結快照／head 不覆寫。策略門檻不放寬。
- Node 142／142、Vitest 87／87、Chromium 32／32，前端與 MultiView 型別／build／strict／diff／本輪 whitespace 通過。中間 import／build 警告／manifest 型別錯誤及修正分開記錄。
- 正式來源 review、集中 budget producer、160 日歷史與自然發布／實際結果驗收七項仍未完成；沒有啟用策略、新來源／broker 請求或正式 DB 寫入。完整紀錄見 [成交量容差驗證](acceptance/source-volume-tolerance-2026-10-03.md)。下方各階段當時的 strict 政策與進度原樣保留。

## 工作承諾 writer 與證券 API 使用範圍（21:45，35／42）

新增 append-only 工作 observation writer 與 head CAS，保留舊 v1／並行落敗原始觀察，拒絕未知、過期、身份錯誤及機密欄位；writer 最新 10 項及相關 Node／Vitest 合計 **255** 項通過。實際既有 simulation business-session Gate 成立（3 HTTP、0 history），正式 SQLite 八個新能力表全為 0，沒有正式寫入。各工作實際呼叫、完整 roster、可信 quota 與獨立實測仍未接妥，不勾 8.4。

使用者確認已線上簽署證券 API 同意書；修正先前額外要求個人分析特別書面許可的過度保守判斷，不索取憑證，程式亦已移除 Shioaji 個人本機用途的額外展示許可 Gate。個人用途範圍與技術來源／預算 Gate 分開，不能把確認當 160 日或自動發布已通過。完整紀錄見 [工作承諾及 API 範圍](acceptance/commitment-writer-and-api-purpose-2026-10-03.md)；下方原紀錄保留。

## 最新接續：歷史來源與預算前置（18:18–18:26，34／41）

- 有界人工診斷 2026-02-02 官方雙市場，2 HTTP／2,011,447 bytes／0 broker；四檔對照先前 Shioaji 紀錄，2330 成交量有 1 股差異，其餘三檔所列 OHLC／量／金額相同。來源差異根因未知，未改數值、加入容差或寫 verified review，且不能把摘要比較當全部 raw replay。
- 修正 admission 政策前置驗證、usage 後與 dispatch 前重驗；缺失／stale／超限時零 usage／Snapshot 查詢，途中換版不發歷史請求。真實本機新 Gate 在 18:26:41 追加 denied，HTTP=0、reservation=0，原 denied 未變；profile／head／publication／review 均為 0。
- Node 10 files 最終 138／138、型別／strict／diff／本輪 whitespace 通過；服務 listener PID 不變。8.4 正式 producer 尚未完成；不勾來源／160 日／自動發布／UI 任務。完整證據見 [來源與預算前置](acceptance/source-contract-and-budget-preflight-2026-10-03.md)。下方早期狀態原樣保留。

目前 **34／41**。最新 17:06 唯讀探測已確認 TPEx 10/2 指定日期入口恢復，並修正原始日報列數限制；task 1.1／8.1、7.2–7.4、8.4／8.8 仍缺正式來源 review／預算、真實全窗口與自動發布／結果驗收，策略保持停用。下方各階段紀錄原樣保留；最新證據見 [TPEx 恢復與日報修正](acceptance/tpex-recovery-and-report-row-bound-2026-10-03.md)，前一階段見 [備援預算與發布驗證](acceptance/provider-budget-publication-2026-10-03.md)，原本機接線見 [本機接線驗證](acceptance/local-activation-2026-10-03.md)。

## 備援 schema 精準安裝（18:03 接續，仍為 34／41）

- 先建立新的 online backup／權限 600／`quick_check=ok`，以單一 transaction 只安裝 additive 0037–0039，新增 10 表及真實 migration 記錄。舊 schema hash、head hash 與九個關鍵表筆數保持不變；不等同全部舊資料逐列 checksum。
- 18:04 實際唯讀 Chromium：5 次 GET、0 寫入／broker／SSE、0 console／page error，結果仍為 `v8_preparation_pending`。18:05 以真實本機 DB／admission 檢查缺政策路徑，追加 1 筆 `denied` 收據，HTTP=0、reservation=0；未建立虛構 verified 政策或抓行情。
- Node 相關 128 項及 retention 4 項分開執行，132／132 通過。保留前輪 242 項完整回歸結果，不把本輪重跑再累加。服務 PID 1273／933／938 保持不變。
- 第一方 Shioaji 文件明示指定日期 daily_quotes、盤後歷史查詢與快取，以及交易日 08:00 流量重置；文件沒有提供本帳號當前 quota epoch identity 或其他工作的即時承諾。因此不能單憑日期建立免債 epoch，或更新靜態時間戳冒充觀測。正式來源相容性與使用範圍 review 仍未通過。
- 完整新紀錄見 [備援 schema 安裝與 Gate](acceptance/fallback-schema-activation-2026-10-03.md)。本輪未啟用每日 profile、發布、archive、commit 或 push。

## 指定日期入口恢復與日報列數修正（最新：34／41）

- 17:06:27 TPEx 指定 10/2 回應 HTTP 200、合法 JSON／日期、1,796,554 bytes、11,928 列；同一資料日 TWSE 亦成功。這不是 160 日或 watcher 發布證據，原傳輸失敗保留。
- 原始日報含權證等非普通股，不能套用普通股母體 10,000 檔上限。改為合計兩表、轉換前獨立 20,000 列硬上限；仍驗 8 MiB、schema、日期與唯一代碼，不截斷或偷偷去重，普通股投影及 manifest 上限維持原規則。
- Node 10 files 132／132、Vitest 8 files 78／78、Chromium 2 files 32／32，合計 242 項；型別及 build、strict／diff 與本輪 scoped whitespace 通過。實際本機 17:14 唯讀 UI 的 5 次 GET 無 console error／broker 請求，仍誠實顯示 pending；17:15 DB profiles／publications／batches／daily 全為 0。首次 fixture wrapper 斷言及 Browser Mode 指令錯誤與後續修正重跑分開記錄。
- 第一方網站條款與政府開放資料集的例外範圍尚不足以確認兩個指定日期歷史 JSON 入口；沒有寫入 verified review、啟用下載或把 pending 當 ready。Shioaji 的契約／集中預算／真實 fallback 任務仍獨立，不因 TPEx 恢復而刪除。

## 備援協調、集中預算與發布接線（前一階段：34／41）

- additive 0039 持久 reservation、單調 usage、可設定行情保留額度及其他工作承諾；不使用固定剩餘 bytes 門檻，不以 HTTP bytes 取代 broker 消耗。generation 換代／租約逾時不清債，已送出但用量未知維持 quarantine。
- 官方優先、獨立 verified 備援與原 staging 來源續跑；同 run 最多 2 次來源 HTTP、8 MiB、15 分鐘。官方交易日 08:30–14:00 不新增 broker 歷史下載，日曆／母體／來源／預算 unknown 均 fail closed。
- 逐市場／日期 manifest 進入 frozen features、mapping、publication key 與 cursor；官方恢復只追加 matched／conflict，API／UI 明示備援與已知衝突。進度計數綁定目前母體 revision，不混算舊母體。
- 最終 Node 10 files **129／129**、Vitest 8 files **78／78**、Chromium 2 files **32／32**；合計 **239 項**不重複測試通過。型別／build／strict 通過，bundle >500 kB 提示仍保留。這些是隔離測試，不是正式來源／自動發布驗收。
- 16:40:25 實際本機唯讀頁面：profile=null，v8 results pending／v8_preparation_pending／rows=0；5 次 GET、0 寫入、0 broker／SSE、console／pageErrors 為空。16:41:52 唯讀 DB：0037–0039 未套用，profile／publication 皆 0，來源與預算 policy 未建立。本輪未安裝 schema、啟用策略或抓新行情。

2026-10-03 接續 TPEx 查證：最新日 OpenAPI 已取得 HTTP 200 合法 JSON，指定日期日報／日曆仍在 TLS 驗證成功後被重設連線；一般 Chrome 的官方頁面也無法完成日報查詢。已補強傳輸分類及新失敗收據，相關 91 項測試通過；沒有把診斷補強當作歷史連線恢復，來源 task 仍未完成。分層證據見 [TPEx 連線查證](acceptance/tpex-connection-diagnosis-2026-10-03.md)，下方原失敗紀錄保留。

## 來源帳本與不可變 manifest（最新：31／41）

完成 8.3：新增 0038 additive schema、獨立 review／母體 identity registry／來源選擇／逐列 provenance／恢復比對 repository。8.2 的 provider-date attempts 與 append-only receipts 保持原樣；不可變 market/date 選擇與全窗口 mapping hash 不重解釋舊官方 mapping／cursor。官方恢復只能追加 matched／conflict，不改凍結列／舊 head。21 項新測試及相關 Node／Vitest 合計 **152／152** 通過，型別與 build 通過；詳細紀錄見 [來源帳本驗證](acceptance/source-selection-repository-2026-10-03.md)。0038 未套用 live，沒有新來源請求、verified review 或自動 provider／發布接線。

本輪查明現有 baseline budget 為各自估算及 usage 檢查，尚無共用的持續 reservation repository。不能把它或 JSON bytes 當作已保留的實際 broker 額度；8.4 保持未完成，先實作集中帳本、實測估量、外部工作保留額度與安全回收，再做 8.5–8.6 正式接線。

## Shioaji 備援核心實作（前階段：30／41）

已完成 task 8.2 的獨立 transport／無損 parser／日期共享持久快取，新增 0037 migration 與 schema／journal，但尚未套用本機資料庫或接入 watcher。正式來源 review（8.1／1.1）、集中實際額度 admission（8.4）及 provider 選擇／發布／UI／實盤（8.3、8.5–8.8、7.2–7.4）仍未完成，策略保持停用。詳細程式、112 項 focused tests、真實唯讀 UI 與限制見 [備援核心實作](acceptance/shioaji-fallback-core-2026-10-03.md)。

## Shioaji 備援規格擴充（本輪實作前紀錄）

- 已補官方優先／獨立備援 review、同日期跨市場共享、來源 manifest／不覆寫、無損 int64／股數／實際金額 mapping、集中可設定 broker 預算與每日發布／UI 規則；既有 v8 選股公式不變。
- 已保存前一輪兩次真實 daily_quotes 唯讀探測摘要，見 [可行性紀錄](acceptance/shioaji-daily-quotes-feasibility-2026-10-03.md)。只有兩日期／代表商品確認，沒有完整歷史或使用權／自動發布驗收，不勾新任務。
- 下一步先完成 8.1 的來源契約與可用額度查證，再依 8.2–8.7 接線與回歸；確認共同日曆 Gate 後，才以有界續跑完成 8.8／7.2–7.4。官方 TPEx 失敗仍保留，不因備援可行就宣稱原入口恢復。
- 本輪 artifact 驗證：OpenSpec strict 通過，apply instructions 核對 41 項／29 完成／12 未完成；git diff --check 及本輪九份 artifact 的新增檔 whitespace 檢查通過。沒有程式變更，因此未另跑功能測試；前述 91 項屬原 TPEx 診斷補強，不是新備援回歸。

## 第一階段當時完成範圍（歷史紀錄）

本輪完成 9／33 項：1.2、1.3、2.1–2.4、2.6、3.1、3.4。這是公式／設定／歷史規劃與保留政策的程式實作，不是整體功能完成。

- `src/lib/stock-screener-v8.ts`：v8 版本化契約、v7 偏好遷移、新分支預設停用、有界參數、固定 BOLL 母體標準差、未 rounding BBW／b、Type-7 quantile、三態共同濾網、近期 setup、首次放量上破與互斥分類。
- 量／金額以 canonical 整數與 BigInt 交叉乘法比較，超過 Number.MAX_SAFE_INTEGER 仍不因浮點 rounding 改變是否嚴格大於。
- 背景 builder 先儲存 BOLL 與 prefix statistics；query evaluator 不重新建立指標。缺交易日保留於 session grid，不偷換最近 N 筆，歷史 setup 不使用後續日期資料。
- `src/lib/stock-screener-bollinger-history.ts`：只接受 verified authority、預設 160 日、依參數有界擴窗與最新日期優先 market/date targets；目前是 planner，尚未接上下載器。
- 舊 v3／v4 prune 加入新能力計畫／快照保留聯集；破損依賴 fail closed，不在未知狀態刪資料。新能力保存計畫／快照的 writer 尚未實作，因此現在沒有新增正式計畫或 v8 head。

## 測試證據

正式回歸使用 `/opt/homebrew/opt/node@24/bin/node`，Node 24.19.0。shell 預設 Node 26.0.0 的初次查證／初輪測試不當成支援版本驗收；已改用專案允許的 24.x 重跑。

- Vitest 9 files／109 tests 通過：v8、布林 history、v7、v6、v5、v4、domain、API 與 condition-ui。
- Node tests 15／15 通過：既有 OHLC／OHLCV bootstrap 與 retention。
- Node tests 新增 4／4 通過：v3／v4 與 v8 計畫／快照的保留聯集、破損依賴禁止刪除。
- `pnpm exec tsc -b --pretty false` 通過。
- `pnpm build` 通過；仍有 bundle 超過 500 kB 的提示，並非本輪新增功能已進面板的證據。
- 此 change 的 OpenSpec strict validation 通過；`git diff --check` 與本輪新增檔案的空白檢查通過。
- 首輪 31 項 v8 測試曾有 2 項 fixture 日期選錯：原樣本日期共同濾網不通過。核對每日 verdict 後，改用符合公式的隔離樣本日期，未放寬程式門檻；24.x 重跑全部通過。

測試 fixture 日期 grid 不是官方日曆；fixture 不當作正式來源、160 日回補或自動發布證據。

## 受阻與未完成

- task 1.1：上櫃指定日期日報與 OpenAPI 都沒有可驗證回應，原錯誤 `ECONNRESET` 留於 [來源前置查證](acceptance/source-contract-2026-10-03.md)。歷史指定日期入口的適用使用範圍尚待核實。不能把 fixture 或現有 parser 當作來源驗證已通過。
- task 2.5：公式 evidence／setup hash／設定 fingerprint 已完成；查詢排序、cursor 與分頁尚未接線，因此整項未勾。
- task 3.2–3.3／3.5：尚未建立新資料持久化 mapping、正式下載與有界 checkpoint 續跑；不得宣稱 history ready。
- task 4.x／5.x／6.x：獨立 publisher、profile API、watcher／idle gate、新面板均尚未接線或啟用。這次在畫面上還看不到新選股功能。
- task 7.x：尚未完成所有所需回歸、實際來源獨立重算、真實自動盤後發布與 API／UI 視覺驗收；仍不具備歸檔條件。

## 保護範圍

除 `scripts/stock-screener-ohlcv-bootstrap.mjs` 的 additive retention 保護外，既有程式未改；新增模組未匯入主面板。未啟停服務、增加 login／subscription、啟用 production、改交易草稿、安裝排程或 commit／push；其他 dirty tree 保留。

## 第一階段當時下一步（歷史紀錄）

先恢復並核實 TPEx 指定日期正式入口與使用範圍，再接新資料 mapping／有界準備器／獨立 publisher。沒有來源契約前，不開正式下載或用代理金額充數。待此阻礙解除後接續未勾任務，不從已完成公式重做。
